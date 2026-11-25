import {
  addDays,
  formatTime,
  startOfWeek,
  toZonedYmd,
  zonedToUtc,
} from "@/lib/datetime";
import { type Db, runInTransaction } from "@/server/db";
import type { ReservationStatus } from "@/server/domain";
import { createAuditLog } from "@/server/repositories/audit-logs";
import {
  findLocation,
  findService,
  findStaffProfile,
  findStaffProfileByMember,
  listLocations,
  listServices,
  listStaffProfiles,
} from "@/server/repositories/catalog";
import {
  findCustomer,
  listCustomerOptions,
} from "@/server/repositories/customers";
import {
  createReservation as createReservationRow,
  findReservation,
  isReservationOverlapError,
  listReservationsWithNames,
  updateReservationWithVersion,
  type ReservationChanges,
} from "@/server/repositories/reservations";
import {
  canManageAllReservations,
  canManageReservation,
} from "@/server/services/authz";
import {
  createJob,
  dispatchJobs,
  JOB_TYPES,
  reservationMailJob,
  type Dispatch,
} from "@/server/services/jobs";
import type { OrgContext } from "@/server/services/org-context";
import { fail, ok, type Result } from "@/server/services/result";
import type { ReservationInput } from "@/server/validation/reservation";
import {
  calendarQuerySchema,
  type SearchParams,
} from "@/server/validation/search-params";
import { traceService } from "./traced";

export type CalendarView = "day" | "week";

export type CalendarQuery = {
  view: CalendarView;
  /** 表示の基準日（店舗のタイムゾーンでの YYYY-MM-DD） */
  date: string;
  /** スタッフで絞り込む。null は全員 */
  staffId: string | null;
};

/** 不正な値は既定値（今日・週表示・全員）に倒す */
export function parseCalendarQuery(
  params: SearchParams,
  todayYmd: string,
): CalendarQuery {
  const parsed = calendarQuerySchema.parse(params);
  return {
    view: parsed.view,
    date: parsed.date ?? todayYmd,
    staffId: parsed.staff,
  };
}

export type CalendarReservation = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  serviceName: string;
  staffName: string;
  status: ReservationStatus;
};

export type Calendar = {
  query: CalendarQuery;
  timezone: string;
  todayYmd: string;
  /** 前後の期間へ移動するときの基準日 */
  prevDate: string;
  nextDate: string;
  staff: { id: string; displayName: string }[];
  days: { date: string; reservations: CalendarReservation[] }[];
};

/**
 * カレンダー・ダッシュボードの表の 1 行。論理削除された顧客と無効になった
 * スタッフは、以前（組織の有効な顧客・スタッフの一覧から名前を引いていた
 * とき）と同じく「（不明）」と表示する
 */
export function toReservationListItem(
  r: Awaited<ReturnType<typeof listReservationsWithNames>>[number],
): CalendarReservation {
  return {
    id: r.id,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    customerName: r.customer.deletedAt ? "（不明）" : r.customer.name,
    serviceName: r.service.name,
    staffName: r.staffProfile.active
      ? r.staffProfile.displayName
      : "（不明）",
    status: r.status,
  };
}

async function getCalendarImpl(
  ctx: OrgContext,
  params: SearchParams,
  now: Date,
): Promise<Calendar> {
  const tz = ctx.timezone;
  const todayYmd = toZonedYmd(now, tz);
  const parsed = parseCalendarQuery(params, todayYmd);

  const staff = await listStaffProfiles(ctx.organizationId);
  // 他の組織や存在しないスタッフの ID は、指定なしとして扱う
  const query: CalendarQuery = {
    ...parsed,
    staffId: staff.some((s) => s.id === parsed.staffId)
      ? parsed.staffId
      : null,
  };

  const dayCount = query.view === "day" ? 1 : 7;
  const firstYmd =
    query.view === "day" ? query.date : startOfWeek(query.date);
  const reservations = await listReservationsWithNames(
    ctx.organizationId,
    {
      from: zonedToUtc(firstYmd, tz),
      to: zonedToUtc(addDays(firstYmd, dayCount), tz),
    },
    query.staffId,
  );

  const days = Array.from({ length: dayCount }, (_, i) => ({
    date: addDays(firstYmd, i),
    reservations: [] as CalendarReservation[],
  }));
  const dayByYmd = new Map(days.map((d) => [d.date, d]));
  for (const r of reservations) {
    dayByYmd
      .get(toZonedYmd(r.startsAt, tz))
      ?.reservations.push(toReservationListItem(r));
  }

  return {
    query,
    timezone: tz,
    todayYmd,
    prevDate: addDays(query.date, -dayCount),
    nextDate: addDays(query.date, dayCount),
    staff: staff.map((s) => ({
      id: s.id,
      displayName: s.displayName,
    })),
    days,
  };
}

// ---------------------------------------------------------------
// 予約の作成・変更・キャンセル（F-08・F-09）
// ---------------------------------------------------------------

type Option = { id: string; label: string };

export type ReservationFormOptions = {
  customers: Option[];
  services: Option[];
  /** Staff には自分だけを出す（自分が担当の予約しか作れないため） */
  staff: Option[];
  locations: Option[];
};

/** 操作する人自身のスタッフ情報の ID（すべての予約を操作できるロールは判定に使わない） */
async function ownStaffProfileId(
  ctx: OrgContext,
  db?: Db,
): Promise<string | null> {
  if (canManageAllReservations(ctx.role)) return null;
  const own = await findStaffProfileByMember(
    ctx.organizationId,
    ctx.memberId,
    db,
  );
  return own?.id ?? null;
}

export async function getReservationFormOptions(
  ctx: OrgContext,
): Promise<ReservationFormOptions> {
  const [customers, services, staff, locations, own] =
    await Promise.all([
      listCustomerOptions(ctx.organizationId),
      listServices(ctx.organizationId),
      listStaffProfiles(ctx.organizationId),
      listLocations(ctx.organizationId),
      ownStaffProfileId(ctx),
    ]);
  return {
    // フリガナの順（ICU の ja）は SQL で並べる
    customers: customers.map((c) => ({
      id: c.id,
      label: `${c.name}（${c.nameKana}）`,
    })),
    services: services.map((s) => ({
      id: s.id,
      label: `${s.name}（${s.durationMinutes} 分）`,
    })),
    staff: staff
      .filter((s) => canManageReservation(ctx.role, s.id, own))
      .map((s) => ({ id: s.id, label: s.displayName })),
    locations: locations.map((l) => ({ id: l.id, label: l.name })),
  };
}

export type ReservationDetail = {
  id: string;
  version: number;
  status: ReservationStatus;
  priceYen: number;
  timezone: string;
  /** フォームの初期値 */
  values: Omit<ReservationInput, "status"> & {
    status: ReservationStatus;
  };
  /** 変更・キャンセルできるか（Service でも必ず判定する） */
  canManage: boolean;
  /** キャンセル済み・来店済みは変更できない */
  editable: boolean;
  options: ReservationFormOptions;
};

const FINAL_STATUSES: readonly ReservationStatus[] = [
  "cancelled",
  "done",
];

/** 他の組織・存在しない予約は null（呼び出し側で 404） */
export async function getReservation(
  ctx: OrgContext,
  id: string,
): Promise<ReservationDetail | null> {
  const r = await findReservation(ctx.organizationId, id);
  if (!r) return null;
  const [location, options, own] = await Promise.all([
    findLocation(ctx.organizationId, r.locationId),
    getReservationFormOptions(ctx),
    ownStaffProfileId(ctx),
  ]);
  const tz = location?.timezone ?? ctx.timezone;

  // 論理削除された顧客・無効になったスタッフでも、今の値は選択肢に残す
  if (!options.customers.some((c) => c.id === r.customerId)) {
    options.customers.unshift({
      id: r.customerId,
      label: "（削除された顧客）",
    });
  }
  if (!options.staff.some((s) => s.id === r.staffProfileId)) {
    const staff = await findStaffProfile(
      ctx.organizationId,
      r.staffProfileId,
    );
    options.staff.unshift({
      id: r.staffProfileId,
      label: staff?.displayName ?? "（不明）",
    });
  }

  return {
    id: r.id,
    version: r.version,
    status: r.status,
    priceYen: r.priceYen,
    timezone: tz,
    values: {
      customerId: r.customerId,
      serviceId: r.serviceId,
      staffProfileId: r.staffProfileId,
      locationId: r.locationId,
      date: toZonedYmd(r.startsAt, tz),
      time: formatTime(r.startsAt, tz),
      status: r.status,
    },
    canManage: canManageReservation(ctx.role, r.staffProfileId, own),
    editable: !FINAL_STATUSES.includes(r.status),
    options,
  };
}

function startOf(input: ReservationInput, timezone: string): Date {
  const [hour, minute] = input.time.split(":").map(Number);
  return zonedToUtc(input.date, timezone, hour, minute);
}

/**
 * 重複は DB の排他制約で防ぐ。アプリ側で「空いているか確かめてから
 * INSERT」すると、同時に来たリクエストが両方とも確認を通ってしまう。
 * 制約違反はトランザクションごと失敗するので、外側で slot_taken にする。
 */
async function translateOverlap<T>(
  fn: () => Promise<Result<T>>,
): Promise<Result<T>> {
  try {
    return await fn();
  } catch (error) {
    if (isReservationOverlapError(error)) return fail("slot_taken");
    throw error;
  }
}

const auditTarget = "reservation";

/**
 * 確定（confirmed）になった予約の確定メールを、変更と同じトランザクションで
 * 依頼する（F-13）。送信は Worker が行う。日時を変えて確定し直したときは
 * 新しい日時で 1 通送る（同じ日時なら 2 通目は積まれない）
 */
async function createConfirmedMailJob(
  organizationId: string,
  reservation: { id: string; startsAt: Date },
  tx: Db,
): Promise<string> {
  return createJob(
    reservationMailJob(
      JOB_TYPES.reservationConfirmed,
      organizationId,
      reservation.id,
      reservation.startsAt,
    ),
    tx,
  );
}

/** コミットした後にキューへ送る（送れなくても Worker が送り直す） */
async function dispatchAfterCommit<T>(
  result: Result<T>,
  jobIds: string[],
  dispatch: Dispatch,
): Promise<Result<T>> {
  if (result.ok) await dispatch(jobIds);
  return result;
}

async function createReservationImpl(
  ctx: OrgContext,
  input: ReservationInput,
  dispatch: Dispatch = dispatchJobs,
): Promise<Result<{ id: string }>> {
  const jobIds: string[] = [];
  const result = await translateOverlap(() =>
    runInTransaction(async (tx) => {
      const org = ctx.organizationId;
      // 他の組織の ID は、組織で絞り込んだ検索で見つからず not_found になる
      const location = await findLocation(org, input.locationId, tx);
      const service = await findService(org, input.serviceId, tx);
      const staff = await findStaffProfile(
        org,
        input.staffProfileId,
        tx,
      );
      const customer = await findCustomer(org, input.customerId, tx);
      if (!location || !service || !staff?.active || !customer) {
        return fail("not_found");
      }

      const own = await ownStaffProfileId(ctx, tx);
      if (!canManageReservation(ctx.role, staff.id, own)) {
        return fail("forbidden");
      }

      const startsAt = startOf(input, location.timezone);
      const row = await createReservationRow(
        org,
        {
          locationId: location.id,
          staffProfileId: staff.id,
          customerId: customer.id,
          serviceId: service.id,
          startsAt,
          endsAt: new Date(
            startsAt.getTime() + service.durationMinutes * 60_000,
          ),
          status: input.status,
          // 予約時点の料金を保存する
          priceYen: service.priceYen,
        },
        tx,
      );
      await createAuditLog(
        {
          organizationId: org,
          actorUserId: ctx.userId,
          action: "reservation.create",
          targetType: auditTarget,
          targetId: row.id,
          diff: {
            staffProfileId: staff.id,
            startsAt: row.startsAt.toISOString(),
            endsAt: row.endsAt.toISOString(),
            status: row.status,
          },
        },
        tx,
      );
      if (row.status === "confirmed") {
        jobIds.push(await createConfirmedMailJob(org, row, tx));
      }
      return ok({ id: row.id });
    }),
  );
  return dispatchAfterCommit(result, jobIds, dispatch);
}

type AuditValue = string | number;

function auditDiff(
  before: Record<string, unknown>,
  changes: ReservationChanges,
): Record<string, [AuditValue, AuditValue]> {
  const toValue = (v: unknown): AuditValue =>
    v instanceof Date
      ? v.toISOString()
      : typeof v === "number"
        ? v
        : String(v);
  return Object.fromEntries(
    Object.entries(changes).map(([k, v]) => [
      k,
      [toValue(before[k]), toValue(v)],
    ]),
  );
}

/**
 * 予約の変更（楽観ロック）。expectedVersion は画面で読んだときの version。
 * Staff は自分が担当の予約だけを、担当を自分のまま変更できる。
 */
async function updateReservationImpl(
  ctx: OrgContext,
  id: string,
  expectedVersion: number,
  input: ReservationInput,
  dispatch: Dispatch = dispatchJobs,
): Promise<Result<{ id: string; version: number }>> {
  const jobIds: string[] = [];
  const result = await translateOverlap(() =>
    runInTransaction(async (tx) => {
      const org = ctx.organizationId;
      const current = await findReservation(org, id, tx);
      if (!current) return fail("not_found");

      const own = await ownStaffProfileId(ctx, tx);
      if (
        !canManageReservation(ctx.role, current.staffProfileId, own)
      ) {
        return fail("forbidden");
      }
      if (FINAL_STATUSES.includes(current.status)) {
        return fail("not_editable");
      }
      if (current.version !== expectedVersion)
        return fail("conflict");

      const location = await findLocation(org, input.locationId, tx);
      if (!location) return fail("not_found");

      // 変えていない参照は、今の状態（削除・無効）を問わずそのまま残す
      if (input.staffProfileId !== current.staffProfileId) {
        const staff = await findStaffProfile(
          org,
          input.staffProfileId,
          tx,
        );
        if (!staff?.active) return fail("not_found");
        // 担当の付け替え先も判定する（Staff は他の人に付け替えられない）
        if (!canManageReservation(ctx.role, staff.id, own)) {
          return fail("forbidden");
        }
      }
      if (input.customerId !== current.customerId) {
        const customer = await findCustomer(
          org,
          input.customerId,
          tx,
        );
        if (!customer) return fail("not_found");
      }
      // メニューを変えたときだけ、所要時間と料金を今のメニューから取る
      let durationMs =
        current.endsAt.getTime() - current.startsAt.getTime();
      let priceYen = current.priceYen;
      if (input.serviceId !== current.serviceId) {
        const service = await findService(org, input.serviceId, tx);
        if (!service) return fail("not_found");
        durationMs = service.durationMinutes * 60_000;
        priceYen = service.priceYen;
      }

      const startsAt = startOf(input, location.timezone);
      const next: Required<ReservationChanges> = {
        locationId: input.locationId,
        staffProfileId: input.staffProfileId,
        customerId: input.customerId,
        serviceId: input.serviceId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + durationMs),
        status: input.status,
        priceYen,
      };
      const changes: ReservationChanges = Object.fromEntries(
        Object.entries(next).filter(([k, v]) => {
          const before = current[k as keyof typeof next];
          return v instanceof Date && before instanceof Date
            ? v.getTime() !== before.getTime()
            : v !== before;
        }),
      );
      if (Object.keys(changes).length === 0) {
        return ok({ id, version: current.version });
      }

      const result = await updateReservationWithVersion(
        org,
        id,
        expectedVersion,
        changes,
        tx,
      );
      if (result.status !== "updated") return fail(result.status);
      await createAuditLog(
        {
          organizationId: org,
          actorUserId: ctx.userId,
          action: "reservation.update",
          targetType: auditTarget,
          targetId: id,
          diff: auditDiff(current, changes),
        },
        tx,
      );
      const updated = result.reservation;
      // 確定にした、または確定のまま日時を変えたときに知らせる
      if (
        updated.status === "confirmed" &&
        (changes.status !== undefined ||
          changes.startsAt !== undefined)
      ) {
        jobIds.push(await createConfirmedMailJob(org, updated, tx));
      }
      return ok({ id, version: updated.version });
    }),
  );
  return dispatchAfterCommit(result, jobIds, dispatch);
}

async function cancelReservationImpl(
  ctx: OrgContext,
  id: string,
  expectedVersion: number,
): Promise<Result<{ id: string; version: number }>> {
  return runInTransaction(async (tx) => {
    const org = ctx.organizationId;
    const current = await findReservation(org, id, tx);
    if (!current) return fail("not_found");

    const own = await ownStaffProfileId(ctx, tx);
    if (
      !canManageReservation(ctx.role, current.staffProfileId, own)
    ) {
      return fail("forbidden");
    }
    if (FINAL_STATUSES.includes(current.status)) {
      return fail("not_editable");
    }

    const result = await updateReservationWithVersion(
      org,
      id,
      expectedVersion,
      { status: "cancelled" },
      tx,
    );
    if (result.status !== "updated") return fail(result.status);
    await createAuditLog(
      {
        organizationId: org,
        actorUserId: ctx.userId,
        action: "reservation.cancel",
        targetType: auditTarget,
        targetId: id,
        diff: { status: [current.status, "cancelled"] },
      },
      tx,
    );
    return ok({ id, version: result.reservation.version });
  });
}

export const getCalendar = traceService(
  "reservations.calendar",
  getCalendarImpl,
);

export const createReservation = traceService(
  "reservations.create",
  createReservationImpl,
);

export const updateReservation = traceService(
  "reservations.update",
  updateReservationImpl,
);

export const cancelReservation = traceService(
  "reservations.cancel",
  cancelReservationImpl,
);
