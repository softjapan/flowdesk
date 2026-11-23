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
