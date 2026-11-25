/**
 * Worker が処理するジョブの中身（F-11・F-13）。仕組み（取得・再試行・
 * 二重処理の防止）は src/server/services/jobs.ts。
 *
 * どのハンドラーも、同じジョブがもう一度動いても結果が変わらないように書く：
 * - 業務のメール（予約の確定・リマインド・エクスポートの完了）は、ここでは
 *   送らずに mail.send のジョブを積む。idempotencyKey が決まっているので、
 *   2 回動いてもメールの依頼は 1 件になる
 * - CSV は決まった鍵に置く（上書きになるだけ）。完了の記録は pending のときだけ
 * - SMTP に送るのは mail.send だけ。送った後に完了を記録する前に落ちると
 *   再送されうる（SMTP には冪等性がないため、ここだけは少なくとも 1 回）。
 *   Message-ID をジョブごとに固定し、受信側で同じメールと分かるようにする
 *
 * Worker はすべての組織のジョブを扱うが、組織のデータは payload の
 * organizationId で必ず絞り込んで読む。
 */
import { z } from "zod";
import { toRole } from "@/server/access-control";
import { addDays, toZonedYmd, zonedToUtc } from "@/lib/datetime";
import { appUrl } from "@/server/app-url";
import { toCsv } from "@/server/csv";
import {
  buildCustomerExportReadyMail,
  buildReservationConfirmedMail,
  buildReservationReminderMail,
} from "@/server/job-mails";
import { sendMail, type Mail } from "@/server/mail";
import { listLocations } from "@/server/repositories/catalog";
import {
  findCustomerExport,
  markCustomerExportDone,
  markCustomerExportFailed,
} from "@/server/repositories/customer-exports";
import { listCustomers } from "@/server/repositories/customers";
import {
  insertJobs,
  listUnpublishedJobIds,
  type NewJob,
} from "@/server/repositories/jobs";
import {
  findMember,
  findOrganizationById,
  listAllOrganizations,
} from "@/server/repositories/organizations";
import {
  findReservationForMail,
  listConfirmedReservationsAt,
} from "@/server/repositories/reservations";
import { findUserById } from "@/server/repositories/users";
import { canExportCustomers } from "@/server/services/authz";
import {
  customerExportKey,
  customerExportPath,
} from "@/server/services/customer-exports";
import {
  dispatchJobs,
  JOB_TYPES,
  PermanentJobError,
  reservationMailJob,
  type Dispatch,
  type JobContext,
  type JobHandler,
  type JobHandlers,
  type JobRecord,
} from "@/server/services/jobs";
import { putObject } from "@/server/storage";

function parsePayload<T>(schema: z.ZodType<T>, job: JobRecord): T {
  const parsed = schema.safeParse(job.payload);
  if (!parsed.success) {
    throw new PermanentJobError(
      `payload の形式が不正: ${job.type} ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------
// mail.send
// ---------------------------------------------------------------

const mailPayloadSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  text: z.string(),
});

export type MailHandlerDeps = {
  send: (mail: Mail, options: { messageId: string }) => Promise<void>;
};

export function mailSendHandler(
  deps: MailHandlerDeps = { send: sendMail },
): JobHandler {
  return {
    async run(job, ctx) {
      const mail = parsePayload(mailPayloadSchema, job);
      await deps.send(mail, {
        messageId: `<job-${job.id}@flowdesk.local>`,
      });
      // 本文（パスワード再設定のリンクなど）は送った後に DB から消す
      return {
        payload: {
          to: mail.to,
          subject: mail.subject,
          sentAt: ctx.now.toISOString(),
        },
      };
    },
  };
}

// ---------------------------------------------------------------
// reservation.confirmed / reservation.reminder
// ---------------------------------------------------------------

const reservationPayloadSchema = z.object({
  organizationId: z.string().min(1),
  reservationId: z.string().min(1),
  startsAt: z.iso.datetime(),
});

function reservationMailHandler(
  kind: "confirmed" | "reminder",
): JobHandler {
  return {
    async run(job, ctx) {
      const payload = parsePayload(reservationPayloadSchema, job);
      const r = await findReservationForMail(
        payload.organizationId,
        payload.reservationId,
      );
      // 依頼の後に予約がキャンセル・日時変更された、顧客が削除された、
      // メールアドレスがない、もう始まっている、ときは送らずに終える
      if (
        !r ||
        r.status !== "confirmed" ||
        r.startsAt.toISOString() !== payload.startsAt ||
        r.customer.deletedAt !== null ||
        r.customer.email === "" ||
        r.startsAt <= ctx.now
      ) {
        return;
      }
      const input = {
        to: r.customer.email,
        customerName: r.customer.name,
        organizationName: r.organization.name,
        locationName: r.location.name,
        serviceName: r.service.name,
        staffName: r.staffProfile.displayName,
        startsAt: r.startsAt,
        timeZone: r.location.timezone,
      };
      await ctx.enqueue({
        organizationId: payload.organizationId,
        type: JOB_TYPES.mailSend,
        payload:
          kind === "confirmed"
            ? buildReservationConfirmedMail(input)
            : buildReservationReminderMail(input),
        // 元のジョブ（予約・種類・日時で決まる）ごとに 1 通
        idempotencyKey: `mail:${job.type}:${job.id}`,
      });
    },
  };
}

/**
 * 前日リマインドの対象（店舗のタイムゾーンで「明日」始まる確定済みの予約）を
 * 探してジョブを積む。Worker が定期的に呼ぶ（本番は EventBridge Scheduler で
 * 起動する想定）。同じ予約・日時のジョブは 1 件にまとまるので、何度呼んでもよい
 */
export async function scheduleReminders(
  now: Date,
  dispatch: Dispatch = dispatchJobs,
): Promise<number> {
  // ジョブは最後にまとめて作る（予約ごとに作ると予約の数だけクエリが増える）
  const jobs: NewJob[] = [];
  for (const org of await listAllOrganizations()) {
    for (const location of await listLocations(org.id)) {
      const tomorrow = addDays(toZonedYmd(now, location.timezone), 1);
      const range = {
        from: zonedToUtc(tomorrow, location.timezone),
        to: zonedToUtc(addDays(tomorrow, 1), location.timezone),
      };
      const reservations = await listConfirmedReservationsAt(
        org.id,
        location.id,
        range,
      );
      for (const r of reservations) {
        jobs.push(
          reservationMailJob(
            JOB_TYPES.reservationReminder,
            org.id,
            r.id,
            r.startsAt,
          ),
        );
      }
    }
  }
  const jobIds = await insertJobs(jobs);
  // 定期的に何度も呼ぶので、まだキューに送っていないものだけを送る
  // （前回までに積んだものは送信済み。送れなかったものは掃除の処理が拾う）
  await dispatch(await listUnpublishedJobIds(jobIds));
  return jobIds.length;
}

// ---------------------------------------------------------------
// customer.export
// ---------------------------------------------------------------

const exportPayloadSchema = z.object({
  organizationId: z.string().min(1),
  exportId: z.string().min(1),
});

const CSV_HEADER = ["氏名", "フリガナ", "メール", "電話番号", "メモ"];

export type ExportHandlerDeps = { put: typeof putObject };

export function customerExportHandler(
  deps: ExportHandlerDeps = { put: putObject },
): JobHandler {
  return {
    async run(job, ctx) {
      const { organizationId, exportId } = parsePayload(
        exportPayloadSchema,
        job,
      );
      let exp = await findCustomerExport(organizationId, exportId);
      if (!exp || exp.status === "failed") return;

      // 依頼の後にロールが下がった・組織を抜けた人には渡さない
      const member = await findMember(
        organizationId,
        exp.requestedByUserId,
      );
      const role = toRole(member?.role);
      if (!role || !canExportCustomers(role)) {
        await markCustomerExportFailed(
          organizationId,
          exportId,
          ctx.now,
        );
        return;
      }

      if (exp.status === "pending") {
        const customers = (await listCustomers(organizationId)).sort(
          (a, b) =>
            a.nameKana.localeCompare(b.nameKana, "ja") ||
            a.id.localeCompare(b.id),
        );
        const key = customerExportKey(organizationId, exportId);
        // 鍵が決まっているので、前回の途中で落ちていても上書きになるだけ
        await deps.put({
          key,
          body: toCsv(
            CSV_HEADER,
            customers.map((c) => [
              c.name,
              c.nameKana,
              c.email,
              c.phone,
              c.note,
            ]),
          ),
          contentType: "text/csv; charset=utf-8",
        });
        await markCustomerExportDone(organizationId, exportId, {
          s3Key: key,
          rowCount: customers.length,
          completedAt: ctx.now,
        });
        exp = await findCustomerExport(organizationId, exportId);
        if (!exp) return;
      }

      const [user, org] = await Promise.all([
        findUserById(exp.requestedByUserId),
        findOrganizationById(organizationId),
      ]);
      if (!user || !org) return;
      await ctx.enqueue({
        organizationId,
        type: JOB_TYPES.mailSend,
        payload: buildCustomerExportReadyMail({
          to: user.email,
          name: user.name,
          organizationName: org.name,
          rowCount: exp.rowCount ?? 0,
          url: appUrl(customerExportPath(org.slug, exportId)),
        }),
        idempotencyKey: `mail:${JOB_TYPES.customerExport}:${exportId}`,
      });
    },
    async onFailed(job, ctx: JobContext) {
      const parsed = exportPayloadSchema.safeParse(job.payload);
      if (!parsed.success) return;
      await markCustomerExportFailed(
        parsed.data.organizationId,
        parsed.data.exportId,
        ctx.now,
      );
    },
  };
}

/** Worker が使うハンドラーの一覧 */
export function createJobHandlers(
  deps: {
    mail?: MailHandlerDeps;
    export?: ExportHandlerDeps;
  } = {},
): JobHandlers {
  return {
    [JOB_TYPES.mailSend]: mailSendHandler(deps.mail),
    [JOB_TYPES.reservationConfirmed]:
      reservationMailHandler("confirmed"),
    [JOB_TYPES.reservationReminder]:
      reservationMailHandler("reminder"),
    [JOB_TYPES.customerExport]: customerExportHandler(deps.export),
  };
}
