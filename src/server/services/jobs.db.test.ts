/**
 * 第11章の非同期処理のテスト（F-11・F-12・F-13）。テスト用 DB を使う
 * （npm run test:db）。S3・SQS・SMTP は差し替える。
 *
 * - 同じメッセージが 2 回届いても、メールの送信・CSV の作成は 1 回
 * - 失敗したら再試行し、3 回失敗したら failed（メッセージは DLQ へ）
 * - CSV エクスポートは Owner・Admin のみ、添付ファイルは他の組織の顧客に付けられない
 *
 * 他のテストファイルがシードの件数を見るので、作った行は消す。
 * 作る予約はシードの範囲外（2027 年）に置く。
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/server/db";
import { DEMO_USER_ID } from "@/server/demo-user";
import type { Mail } from "@/server/mail";
import { insertJob } from "@/server/repositories/jobs";
import {
  completeUpload,
  listAttachments,
  requestUpload,
  type StorageDeps,
} from "@/server/services/attachments";
import {
  getCustomerExportUrl,
  listCustomerExports,
  requestCustomerExport,
} from "@/server/services/customer-exports";
import {
  createJobHandlers,
  scheduleReminders,
} from "@/server/services/job-handlers";
import {
  enqueueMail,
  JOB_TYPES,
  MAX_ATTEMPTS,
  runJob,
  sweepStrandedJobs,
  type JobHandlers,
} from "@/server/services/jobs";
import {
  getOrgContext,
  type OrgContext,
} from "@/server/services/org-context";
import {
  createReservation,
  updateReservation,
} from "@/server/services/reservations";
import { TEST_NOW } from "../../../test/db-fixture";

const ORG_A = "org_a";
const startedAt = new Date();
const createdReservations: string[] = [];

async function contextOf(
  slug: string,
  userId: string,
): Promise<OrgContext> {
  const ctx = await getOrgContext(slug, userId);
  if (!ctx)
    throw new Error(`組織に所属していない: ${slug} ${userId}`);
  return ctx;
}

// demo-salon（org_a）：Owner＝デモユーザー、Admin＝user_a1、Staff＝user_a2
const owner = () => contextOf("demo-salon", DEMO_USER_ID);
const admin = () => contextOf("demo-salon", "user_a1");
const staff = () => contextOf("demo-salon", "user_a2");

/** 送ったメールを記録する（SMTP の代わり） */
function fakeMail() {
  const sent: { mail: Mail; messageId: string }[] = [];
  return {
    sent,
    send: async (mail: Mail, options: { messageId: string }) => {
      sent.push({ mail, messageId: options.messageId });
    },
  };
}

/** キューに送ったジョブを記録する（SQS の代わり） */
function fakeQueue() {
  const ids: string[] = [];
  return {
    ids,
    dispatch: async (jobIds: string[]) => {
      ids.push(...jobIds);
    },
  };
}

async function jobOf(id: string) {
  return getPrisma().job.findUniqueOrThrow({ where: { id } });
}

let keySeq = 0;
const uniqueKey = (name: string) =>
  `test:${name}:${startedAt.getTime()}:${++keySeq}`;

afterAll(async () => {
  const prisma = getPrisma();
  await prisma.reservation.deleteMany({
    where: { id: { in: createdReservations } },
  });
  await prisma.job.deleteMany({
    where: { createdAt: { gte: startedAt } },
  });
  await prisma.customerExport.deleteMany({
    where: { createdAt: { gte: startedAt } },
  });
  await prisma.attachment.deleteMany({
    where: { createdAt: { gte: startedAt } },
  });
  await prisma.auditLog.deleteMany({
    where: { createdAt: { gte: startedAt } },
  });
});

describe("ジョブの二重処理の防止と再試行", () => {
  it("同じ依頼（idempotencyKey）を 2 回積んでも 1 件になる", async () => {
    const queue = fakeQueue();
    const mail = {
      to: "a@example.com",
      subject: "件名",
      text: "本文",
    };
    const key = uniqueKey("dup");
    const first = await enqueueMail(
      mail,
      { key, organizationId: ORG_A },
      queue.dispatch,
    );
    const second = await enqueueMail(
      mail,
      { key, organizationId: ORG_A },
      queue.dispatch,
    );
    expect(second).toBe(first);
    expect(
      await getPrisma().job.count({
        where: { idempotencyKey: `mail:${key}` },
      }),
    ).toBe(1);
  });

  it("同じメッセージが 2 回届いても、メールは 1 通だけ送る", async () => {
    const smtp = fakeMail();
    const handlers = createJobHandlers({ mail: smtp });
    const id = await enqueueMail(
      {
        to: "user@example.com",
        subject: "パスワード再設定",
        text: "https://example.com/reset?token=secret",
      },
      { key: uniqueKey("mail"), organizationId: null },
      async () => {},
    );

    expect(await runJob(id, handlers, { now: TEST_NOW })).toEqual({
      status: "done",
    });
    expect(await runJob(id, handlers, { now: TEST_NOW })).toEqual({
      status: "done",
    });
    expect(smtp.sent).toHaveLength(1);
    // Message-ID はジョブごとに固定
    expect(smtp.sent[0]?.messageId).toBe(
      `<job-${id}@flowdesk.local>`,
    );

    const job = await jobOf(id);
    expect(job).toMatchObject({ status: "succeeded", attempts: 1 });
    // 送った後は本文（再設定のリンク）を DB に残さない
    expect(JSON.stringify(job.payload)).not.toContain("secret");
  });

  it("他の Worker が処理中のジョブは処理しない。止まって期限が切れたら取り直せる", async () => {
    const id = await insertJob({
      organizationId: ORG_A,
      type: JOB_TYPES.mailSend,
      payload: { to: "a@example.com", subject: "s", text: "t" },
      idempotencyKey: uniqueKey("busy"),
    });
    await getPrisma().job.update({
      where: { id },
      data: {
        status: "running",
        lockedUntil: new Date(TEST_NOW.getTime() + 30_000),
      },
    });
    const smtp = fakeMail();
    const handlers = createJobHandlers({ mail: smtp });
    expect(await runJob(id, handlers, { now: TEST_NOW })).toEqual({
      status: "busy",
    });
    expect(smtp.sent).toHaveLength(0);

    const later = new Date(TEST_NOW.getTime() + 60_000);
    expect(await runJob(id, handlers, { now: later })).toEqual({
      status: "done",
    });
    expect(smtp.sent).toHaveLength(1);
  });

  it("失敗したら再試行し、3 回失敗したら failed にして onFailed を呼ぶ", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onFailed = vi.fn(async () => {});
    const handlers: JobHandlers = {
      "test.fail": {
        run: async () => {
          throw new Error("SMTP に接続できない");
        },
        onFailed,
      },
    };
    const id = await insertJob({
      organizationId: ORG_A,
      type: "test.fail",
      payload: {},
      idempotencyKey: uniqueKey("fail"),
    });

    expect(MAX_ATTEMPTS).toBe(3);
    expect(await runJob(id, handlers, { now: TEST_NOW })).toEqual({
      status: "retry",
      attempts: 1,
    });
    expect((await jobOf(id)).status).toBe("queued");
    expect(await runJob(id, handlers, { now: TEST_NOW })).toEqual({
      status: "retry",
      attempts: 2,
    });
    expect(onFailed).not.toHaveBeenCalled();
    // 3 回目：メッセージは消さずに置き、SQS に DLQ へ移させる
    expect(await runJob(id, handlers, { now: TEST_NOW })).toEqual({
      status: "dead",
    });
    expect(onFailed).toHaveBeenCalledTimes(1);
    const job = await jobOf(id);
    expect(job).toMatchObject({ status: "failed", attempts: 3 });
    expect(job.lastError).toContain("SMTP に接続できない");

    // その後に届いたメッセージは処理しない
    expect(await runJob(id, handlers, { now: TEST_NOW })).toEqual({
      status: "done",
    });
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it("形式の違う payload は再試行せずに failed にする", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const smtp = fakeMail();
    const id = await insertJob({
      organizationId: null,
      type: JOB_TYPES.mailSend,
      payload: { to: "not-an-email" },
      idempotencyKey: uniqueKey("bad"),
    });
    expect(
      await runJob(id, createJobHandlers({ mail: smtp }), {
        now: TEST_NOW,
      }),
    ).toEqual({ status: "done" });
    expect(await jobOf(id)).toMatchObject({
      status: "failed",
      attempts: 1,
    });
    expect(smtp.sent).toHaveLength(0);
  });

  it("キューに送れなかったジョブは、掃除の処理が送り直す", async () => {
    const id = await insertJob({
      organizationId: ORG_A,
      type: JOB_TYPES.mailSend,
      payload: { to: "a@example.com", subject: "s", text: "t" },
      idempotencyKey: uniqueKey("stranded"),
    });
    const queue = fakeQueue();
    // 作った直後はコミット後の送信と競合しないよう拾わない
    await sweepStrandedJobs(new Date(), queue.dispatch);
    expect(queue.ids).not.toContain(id);
    await sweepStrandedJobs(
      new Date(Date.now() + 60_000),
      queue.dispatch,
    );
    expect(queue.ids).toContain(id);
  });
});

describe("予約確定・前日リマインドのメール（F-13）", () => {
  it("確定で作った予約は、同じトランザクションで確定メールを依頼する", async () => {
    const queue = fakeQueue();
    const result = await createReservation(
      await owner(),
      {
        customerId: "cus_a_002",
        serviceId: "svc_a1",
        staffProfileId: "stf_a1",
        locationId: "loc_a1",
        date: "2027-03-01",
        time: "10:00",
        status: "confirmed",
      },
      queue.dispatch,
    );
    if (!result.ok) throw new Error(result.reason);
    createdReservations.push(result.value.id);
    expect(queue.ids).toHaveLength(1);
    const confirmJob = await jobOf(queue.ids[0] ?? "");
    expect(confirmJob).toMatchObject({
      organizationId: ORG_A,
      type: JOB_TYPES.reservationConfirmed,
      status: "queued",
    });

    // Worker：確定のジョブはメールの依頼を積む。2 回動いても依頼は 1 件
    const followUps = fakeQueue();
    const smtp = fakeMail();
    const handlers = createJobHandlers({ mail: smtp });
    await runJob(confirmJob.id, handlers, {
      now: TEST_NOW,
      dispatch: followUps.dispatch,
    });
    await getPrisma().job.update({
      where: { id: confirmJob.id },
      data: { status: "queued" },
    });
    await runJob(confirmJob.id, handlers, {
      now: TEST_NOW,
      dispatch: followUps.dispatch,
    });
    expect(new Set(followUps.ids).size).toBe(1);

    const mailJobId = followUps.ids[0] ?? "";
    await runJob(mailJobId, handlers, { now: TEST_NOW });
    await runJob(mailJobId, handlers, { now: TEST_NOW });
    expect(smtp.sent).toHaveLength(1);
    expect(smtp.sent[0]?.mail.to).toBe("cus_a002@example.com");
    expect(smtp.sent[0]?.mail.text).toContain(
      "2027年3月1日(月) 10:00",
    );
  });

  it("pending の予約は送らず、確定に変えたときに送る。キャンセル後のジョブは送らない", async () => {
    const queue = fakeQueue();
    const ctx = await owner();
    const input = {
      customerId: "cus_a_003",
      serviceId: "svc_a1",
      staffProfileId: "stf_a1",
      locationId: "loc_a1",
      date: "2027-03-02",
      time: "10:00",
      status: "pending" as const,
    };
    const created = await createReservation(
      ctx,
      input,
      queue.dispatch,
    );
    if (!created.ok) throw new Error(created.reason);
    createdReservations.push(created.value.id);
    expect(queue.ids).toHaveLength(0);

    const updated = await updateReservation(
      ctx,
      created.value.id,
      1,
      { ...input, status: "confirmed" },
      queue.dispatch,
    );
    expect(updated.ok).toBe(true);
    expect(queue.ids).toHaveLength(1);

    // ジョブが処理される前にキャンセルされたら、メールは依頼しない
    await getPrisma().reservation.updateMany({
      where: { id: created.value.id, organizationId: ORG_A },
      data: { status: "cancelled" },
    });
    const followUps = fakeQueue();
    await runJob(queue.ids[0] ?? "", createJobHandlers(), {
      now: TEST_NOW,
      dispatch: followUps.dispatch,
    });
    expect(followUps.ids).toHaveLength(0);
  });

  it("前日リマインドは、明日の確定済みの予約ごとに 1 件だけ積む", async () => {
    const first = fakeQueue();
    const count = await scheduleReminders(TEST_NOW, first.dispatch);
    // シード：TEST_NOW の翌日（2026-11-24）の確定済みの予約
    const tomorrow = await getPrisma().reservation.count({
      where: {
        status: "confirmed",
        startsAt: {
          gte: new Date("2026-11-23T15:00:00Z"),
          lt: new Date("2026-11-24T15:00:00Z"),
        },
      },
    });
    expect(tomorrow).toBeGreaterThan(0);
    expect(count).toBe(tomorrow);
    expect(first.ids).toHaveLength(tomorrow);

    // 2 回目は同じジョブになり、新しく送るものはない
    await getPrisma().job.updateMany({
      where: { id: { in: first.ids } },
      data: { publishedAt: TEST_NOW },
    });
    const second = fakeQueue();
    expect(await scheduleReminders(TEST_NOW, second.dispatch)).toBe(
      tomorrow,
    );
    expect(second.ids).toHaveLength(0);
    expect(
      await getPrisma().job.count({
        where: {
          type: JOB_TYPES.reservationReminder,
          createdAt: { gte: startedAt },
        },
      }),
    ).toBe(tomorrow);
  });
});

describe("顧客一覧の CSV エクスポート（F-11）", () => {
  it("Staff は依頼できず、一覧も出ない", async () => {
    const queue = fakeQueue();
    expect(
      await requestCustomerExport(await staff(), queue.dispatch),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(await listCustomerExports(await staff())).toBeNull();
    expect(queue.ids).toHaveLength(0);
  });

  it("Admin が依頼すると、Worker が CSV を 1 回だけ作り、完了メールを 1 通送る", async () => {
    const queue = fakeQueue();
    const ctx = await admin();
    const result = await requestCustomerExport(ctx, queue.dispatch);
    if (!result.ok) throw new Error(result.reason);
    const exportId = result.value.id;
    expect(queue.ids).toHaveLength(1);
    expect(
      await getPrisma().auditLog.count({
        where: {
          organizationId: ORG_A,
          action: "customer.export",
          targetId: exportId,
        },
      }),
    ).toBe(1);

    const puts: { key: string; body: string | Uint8Array }[] = [];
    const smtp = fakeMail();
    const handlers = createJobHandlers({
      mail: smtp,
      export: {
        put: async (input) => {
          puts.push(input);
        },
      },
    });
    const followUps = fakeQueue();
    const jobId = queue.ids[0] ?? "";
    await runJob(jobId, handlers, {
      now: TEST_NOW,
      dispatch: followUps.dispatch,
    });
    // 同じメッセージがもう一度届いた
    await runJob(jobId, handlers, {
      now: TEST_NOW,
      dispatch: followUps.dispatch,
    });
    // 完了を記録する前に落ちて、ジョブがもう一度動いた
    await getPrisma().job.update({
      where: { id: jobId },
      data: { status: "queued" },
    });
    await runJob(jobId, handlers, {
      now: TEST_NOW,
      dispatch: followUps.dispatch,
    });
    expect(puts).toHaveLength(1);
    expect(puts[0]?.key).toBe(
      `orgs/${ORG_A}/exports/${exportId}.csv`,
    );
    const csv = String(puts[0]?.body);
    // 論理削除済みの顧客と他の組織の顧客は含めない
    const rows = csv.split("\r\n").filter(Boolean);
    expect(rows[0]).toBe("﻿氏名,フリガナ,メール,電話番号,メモ");
    expect(rows).toHaveLength(1 + 32);
    expect(csv).not.toContain("cus_b");
    expect(csv).not.toContain("cus_a033@example.com");

    expect(new Set(followUps.ids).size).toBe(1);
    for (const id of new Set(followUps.ids)) {
      await runJob(id, handlers, { now: TEST_NOW });
      await runJob(id, handlers, { now: TEST_NOW });
    }
    expect(smtp.sent).toHaveLength(1);
    expect(smtp.sent[0]?.mail.to).toBe("user-a1@example.com");
    expect(smtp.sent[0]?.mail.text).toContain(
      `/api/exports/${exportId}?org=demo-salon`,
    );

    const list = await listCustomerExports(ctx);
    expect(list?.[0]).toMatchObject({
      id: exportId,
      status: "done",
      rowCount: 32,
    });

    // ダウンロード：Staff は不可、他の組織からは見つからない
    const sign = async () => "https://s3.example/signed";
    expect(await getCustomerExportUrl(ctx, exportId, sign)).toEqual({
      ok: true,
      value: { url: "https://s3.example/signed" },
    });
    expect(
      await getCustomerExportUrl(await staff(), exportId, sign),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(
      await getCustomerExportUrl(
        await contextOf("other-office", "user_c0"),
        exportId,
        sign,
      ),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("3 回失敗したエクスポートは「失敗」になる", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const queue = fakeQueue();
    const ctx = await owner();
    const result = await requestCustomerExport(ctx, queue.dispatch);
    if (!result.ok) throw new Error(result.reason);
    const handlers = createJobHandlers({
      export: {
        put: async () => {
          throw new Error("S3 に接続できない");
        },
      },
    });
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await runJob(queue.ids[0] ?? "", handlers, { now: TEST_NOW });
    }
    const row = await getPrisma().customerExport.findFirstOrThrow({
      where: { id: result.value.id, organizationId: ORG_A },
    });
    expect(row.status).toBe("failed");
  });
});

describe("添付ファイルのアップロード（F-12）", () => {
  function fakeStorage(
    head: { contentType: string; sizeBytes: number } | null,
  ): StorageDeps {
    return {
      presignPut: async ({ key }) => `https://s3.example/put/${key}`,
      presignGet: async ({ key }) => `https://s3.example/get/${key}`,
      headObject: async () => head,
    };
  }
  const input = {
    customerId: "cus_a_004",
    fileName: "写真.png",
    contentType: "image/png" as const,
    sizeBytes: 2048,
  };

  it("他の組織・論理削除済み・存在しない顧客には付けられない（404）", async () => {
    const storage = fakeStorage(null);
    for (const customerId of ["cus_c_001", "cus_a_033", "no-such"]) {
      expect(
        await requestUpload(
          await staff(),
          { ...input, customerId },
          storage,
        ),
      ).toEqual({ ok: false, reason: "not_found" });
    }
    expect(
      await listAttachments(await owner(), "cus_c_001", storage),
    ).toBeNull();
  });

  it("Staff もアップロードでき、S3 のファイルを確かめてから登録する", async () => {
    const ctx = await staff();
    const ticket = await requestUpload(ctx, input, fakeStorage(null));
    if (!ticket.ok) throw new Error(ticket.reason);
    const row = await getPrisma().attachment.findFirstOrThrow({
      where: { id: ticket.value.attachmentId, organizationId: ORG_A },
    });
    // 鍵はサーバーが決める（利用者のファイル名を使わない）
    expect(row.s3Key).toMatch(
      new RegExp(`^orgs/${ORG_A}/customers/cus_a_004/[0-9a-f-]{36}$`),
    );
    expect(row.status).toBe("pending");
    expect(ticket.value.uploadUrl).toContain(row.s3Key);

    // PUT されていない・申告とサイズや形式が違うものは登録しない
    for (const head of [
      null,
      { contentType: "image/png", sizeBytes: 9999 },
      { contentType: "text/html", sizeBytes: 2048 },
    ]) {
      expect(
        await completeUpload(
          ctx,
          ticket.value.attachmentId,
          fakeStorage(head),
        ),
      ).toEqual({ ok: false, reason: "upload_mismatch" });
    }
    expect(
      await listAttachments(ctx, "cus_a_004", fakeStorage(null)),
    ).toEqual([]);

    // 他の組織からは完了にできない
    expect(
      await completeUpload(
        await contextOf("other-office", "user_c0"),
        ticket.value.attachmentId,
        fakeStorage({ contentType: "image/png", sizeBytes: 2048 }),
      ),
    ).toEqual({ ok: false, reason: "not_found" });

    const ok = fakeStorage({
      contentType: "image/png",
      sizeBytes: 2048,
    });
    expect(
      await completeUpload(ctx, ticket.value.attachmentId, ok),
    ).toEqual({ ok: true, value: { id: ticket.value.attachmentId } });
    // 2 回目は見つからない（pending ではない）
    expect(
      await completeUpload(ctx, ticket.value.attachmentId, ok),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await getPrisma().auditLog.count({
        where: {
          organizationId: ORG_A,
          action: "attachment.upload",
          targetId: ticket.value.attachmentId,
        },
      }),
    ).toBe(1);

    const list = await listAttachments(ctx, "cus_a_004", ok);
    expect(list).toHaveLength(1);
    expect(list?.[0]).toMatchObject({
      fileName: "写真.png",
      isImage: true,
      url: `https://s3.example/get/${row.s3Key}`,
    });
  });
});
