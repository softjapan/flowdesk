import { Prisma } from "@/generated/prisma/client";
import { type Db, getPrisma } from "@/server/db";
import type { ReservationStatus } from "@/server/domain";

/** startsAt が [from, to) の予約を開始時刻順に */
export async function listReservations(
  organizationId: string,
  range: { from: Date; to: Date },
  db: Db = getPrisma(),
) {
  return db.reservation.findMany({
    where: {
      organizationId,
      startsAt: { gte: range.from, lt: range.to },
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
}

/**
 * カレンダーとダッシュボードの表に出す予約（startsAt が [from, to)）。
 * 顧客・メニュー・担当の名前を同じ呼び出しで取る（第15章。以前は名前を
 * 引くために組織の顧客を全件読んでいた）。参照は (organizationId, xxxId)
 * の複合外部キーなので、他の組織の行にはつながらない
 */
export async function listReservationsWithNames(
  organizationId: string,
  range: { from: Date; to: Date },
  staffProfileId: string | null = null,
  db: Db = getPrisma(),
) {
  return db.reservation.findMany({
    where: {
      organizationId,
      startsAt: { gte: range.from, lt: range.to },
      ...(staffProfileId && { staffProfileId }),
    },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      customer: { select: { name: true, deletedAt: true } },
      service: { select: { name: true } },
      staffProfile: { select: { displayName: true, active: true } },
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
}

export type ReservationSummary = {
  reservationCount: number;
  customerCount: number;
  revenueYen: number;
};

/**
 * startsAt が [from, to) の、キャンセルを除いた予約の件数・顧客数（重複
 * なし）・料金の合計。行を読まずに DB で集計する（ダッシュボード）
 */
export async function summarizeReservations(
  organizationId: string,
  range: { from: Date; to: Date },
  db: Db = getPrisma(),
): Promise<ReservationSummary> {
  const [row] = await db.$queryRaw<
    {
      reservationCount: bigint;
      customerCount: bigint;
      revenueYen: bigint;
    }[]
  >(Prisma.sql`
    SELECT count(*) AS "reservationCount",
           count(DISTINCT "customerId") AS "customerCount",
           coalesce(sum("priceYen"), 0)::bigint AS "revenueYen"
    FROM reservation
    WHERE "organizationId" = ${organizationId}
      AND "startsAt" >= ${range.from} AND "startsAt" < ${range.to}
      AND status <> 'cancelled'`);
  return {
    reservationCount: Number(row?.reservationCount ?? 0),
    customerCount: Number(row?.customerCount ?? 0),
    revenueYen: Number(row?.revenueYen ?? 0),
  };
}

/**
 * startsAt が [from, to) の、キャンセルを除いた予約の日別の件数。日付は
 * timezone での YYYY-MM-DD（toZonedYmd と同じ）。予約のない日は返らない
 */
export async function countReservationsByDay(
  organizationId: string,
  range: { from: Date; to: Date },
  timezone: string,
  db: Db = getPrisma(),
): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ date: string; count: bigint }[]>(
    Prisma.sql`
      SELECT to_char("startsAt" AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS date,
             count(*) AS count
      FROM reservation
      WHERE "organizationId" = ${organizationId}
        AND "startsAt" >= ${range.from} AND "startsAt" < ${range.to}
        AND status <> 'cancelled'
      GROUP BY 1`,
  );
  return new Map(rows.map((r) => [r.date, Number(r.count)]));
}

export async function findReservation(
  organizationId: string,
  id: string,
  db: Db = getPrisma(),
) {
  return db.reservation.findFirst({ where: { id, organizationId } });
}

export type NewReservation = {
  locationId: string;
  staffProfileId: string;
  customerId: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
  status: ReservationStatus;
  priceYen: number;
};

/**
 * 同じスタッフで時間が重なると、DB の排他制約 reservation_no_overlap で
 * 失敗する（isReservationOverlapError で判定する）
 */
export async function createReservation(
  organizationId: string,
  data: NewReservation,
  db: Db = getPrisma(),
) {
  return db.reservation.create({ data: { ...data, organizationId } });
}

/**
 * 排他制約 reservation_no_overlap の違反か。Prisma 7 のドライバアダプター
 * 経由では PrismaClientKnownRequestError の meta.driverAdapterError.cause
 * に PostgreSQL のエラーコード（23P01）とメッセージが入る。
 */
export function isReservationOverlapError(error: unknown): boolean {
  const cause = (
    error as {
      meta?: {
        driverAdapterError?: {
          cause?: {
            originalCode?: unknown;
            originalMessage?: unknown;
          };
        };
      };
    }
  )?.meta?.driverAdapterError?.cause;
  return (
    cause?.originalCode === "23P01" &&
    typeof cause.originalMessage === "string" &&
    cause.originalMessage.includes("reservation_no_overlap")
  );
}

/** 楽観ロックで更新できる列（organizationId・id・version は変えさせない） */
export type ReservationChanges = Partial<{
  locationId: string;
  staffProfileId: string;
  customerId: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
  status: ReservationStatus;
  priceYen: number;
}>;

export type UpdateReservationResult =
  | {
      status: "updated";
      reservation: NonNullable<
        Awaited<ReturnType<typeof findReservation>>
      >;
    }
  /** 読んだ後に他の人が更新した。画面を読み込み直してもらう */
  | { status: "conflict"; currentVersion: number }
  /** 存在しないか、他の組織の予約（区別せず 404 にする） */
  | { status: "not_found" };

/**
 * 楽観ロック付きの更新。画面で読んだときの version を expectedVersion に
 * 渡す。WHERE に version を含めた 1 本の UPDATE なので、同時に 2 人が
 * 更新しても後から来た方は 0 件更新になり、上書きされない。
 *
 * 他の Repository 関数とまとめて 1 つのトランザクションにするときは、
 * runInTransaction のコールバックが受け取る tx を db に渡す：
 *
 *   await runInTransaction(async (tx) => {
 *     const r = await updateReservationWithVersion(
 *       orgId, id, version, { status: "cancelled" }, tx);
 *     if (r.status !== "updated") return r;
 *     await createAuditLog({ ... }, tx); // 失敗すれば予約の更新も戻る
 *     return r;
 *   });
 */
export async function updateReservationWithVersion(
  organizationId: string,
  id: string,
  expectedVersion: number,
  changes: ReservationChanges,
  db: Db = getPrisma(),
): Promise<UpdateReservationResult> {
  const { count } = await db.reservation.updateMany({
    where: { id, organizationId, version: expectedVersion },
    data: { ...changes, version: { increment: 1 } },
  });
  const current = await findReservation(organizationId, id, db);
  if (!current) return { status: "not_found" };
  if (count === 0) {
    return { status: "conflict", currentVersion: current.version };
  }
  return { status: "updated", reservation: current };
}

/** 予約のメール（確定・リマインド）の文面に使う、顧客・店舗・メニュー・担当付きの予約 */
export async function findReservationForMail(
  organizationId: string,
  id: string,
  db: Db = getPrisma(),
) {
  return db.reservation.findFirst({
    where: { id, organizationId },
    include: {
      organization: { select: { name: true } },
      customer: {
        select: { name: true, email: true, deletedAt: true },
      },
      location: { select: { name: true, timezone: true } },
      service: { select: { name: true } },
      staffProfile: { select: { displayName: true } },
    },
  });
}

/** 店舗の、startsAt が [from, to) の確定済みの予約（前日リマインドの対象） */
export async function listConfirmedReservationsAt(
  organizationId: string,
  locationId: string,
  range: { from: Date; to: Date },
  db: Db = getPrisma(),
) {
  return db.reservation.findMany({
    where: {
      organizationId,
      locationId,
      status: "confirmed",
      startsAt: { gte: range.from, lt: range.to },
    },
    select: { id: true, startsAt: true },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
}
