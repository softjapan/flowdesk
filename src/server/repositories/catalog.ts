/**
 * 店舗・スタッフ・メニュー。並び順は ID 順で固定する
 * （「最初の店舗」のタイムゾーンを組織の既定に使うため）。
 */
import { type Db, getPrisma } from "@/server/db";

export async function listLocations(
  organizationId: string,
  db: Db = getPrisma(),
) {
  return db.location.findMany({
    where: { organizationId },
    orderBy: { id: "asc" },
  });
}

export async function countLocations(
  organizationId: string,
  db: Db = getPrisma(),
): Promise<number> {
  return db.location.count({ where: { organizationId } });
}

export async function createLocation(
  organizationId: string,
  data: { name: string; timezone: string },
  db: Db = getPrisma(),
) {
  return db.location.create({
    data: { ...data, organizationId },
    select: { id: true },
  });
}

/** 変更した行の数（0 なら他の組織の ID か、存在しない） */
export async function updateLocation(
  organizationId: string,
  id: string,
  data: { name: string; timezone: string },
  db: Db = getPrisma(),
): Promise<number> {
  const { count } = await db.location.updateMany({
    where: { id, organizationId },
    data,
  });
  return count;
}

/**
 * 予約が参照している店舗は外部キー（NoAction）で DB が拒否する
 * （isForeignKeyViolation で判定する）。削除と同時に予約が作られても、
 * 予約のない店舗だけが消える
 */
export async function deleteLocation(
  organizationId: string,
  id: string,
  db: Db = getPrisma(),
): Promise<number> {
  const { count } = await db.location.deleteMany({
    where: { id, organizationId },
  });
  return count;
}

/**
 * 外部キーの違反（PostgreSQL の 23503）か。Prisma 7 のドライバアダプター
 * 経由では meta.driverAdapterError.cause.originalCode に入る
 * （isReservationOverlapError と同じ）
 */
export function isForeignKeyViolation(error: unknown): boolean {
  const cause = (
    error as {
      meta?: {
        driverAdapterError?: { cause?: { originalCode?: unknown } };
      };
    }
  )?.meta?.driverAdapterError?.cause;
  return cause?.originalCode === "23503";
}

/**
 * プランの上限（F-15）で数えるスタッフ。メンバーを削除して無効に
 * なったスタッフ情報（予約の履歴のために残している）は数えない
 */
export async function countActiveStaffProfiles(
  organizationId: string,
  db: Db = getPrisma(),
): Promise<number> {
  return db.staffProfile.count({
    where: { organizationId, active: true, memberId: { not: null } },
  });
}

/** 有効なスタッフのみ */
export async function listStaffProfiles(
  organizationId: string,
  db: Db = getPrisma(),
) {
  return db.staffProfile.findMany({
    where: { organizationId, active: true },
    orderBy: { id: "asc" },
  });
}

/** 無効なスタッフも返す（呼び出し側で active を見る） */
export async function findStaffProfile(
  organizationId: string,
  id: string,
  db: Db = getPrisma(),
) {
  return db.staffProfile.findFirst({ where: { id, organizationId } });
}

/** メンバー自身のスタッフ情報（Staff が「自分の担当」かを判定する） */
export async function findStaffProfileByMember(
  organizationId: string,
  memberId: string,
  db: Db = getPrisma(),
) {
  return db.staffProfile.findFirst({
    where: { organizationId, memberId },
  });
}

export async function findLocation(
  organizationId: string,
  id: string,
  db: Db = getPrisma(),
) {
  return db.location.findFirst({ where: { id, organizationId } });
}

export async function findService(
  organizationId: string,
  id: string,
  db: Db = getPrisma(),
) {
  return db.service.findFirst({ where: { id, organizationId } });
}

export async function listServices(
  organizationId: string,
  db: Db = getPrisma(),
) {
  return db.service.findMany({
    where: { organizationId },
    orderBy: { id: "asc" },
  });
}

type ServiceData = {
  name: string;
  durationMinutes: number;
  priceYen: number;
};

export async function createService(
  organizationId: string,
  data: ServiceData,
  db: Db = getPrisma(),
) {
  return db.service.create({
    data: { ...data, organizationId },
    select: { id: true },
  });
}

/** 変更した行の数（0 なら他の組織の ID か、存在しない） */
export async function updateService(
  organizationId: string,
  id: string,
  data: ServiceData,
  db: Db = getPrisma(),
): Promise<number> {
  const { count } = await db.service.updateMany({
    where: { id, organizationId },
    data,
  });
  return count;
}

/** 予約が参照しているメニューは DB が拒否する（isForeignKeyViolation） */
export async function deleteService(
  organizationId: string,
  id: string,
  db: Db = getPrisma(),
): Promise<number> {
  const { count } = await db.service.deleteMany({
    where: { id, organizationId },
  });
  return count;
}
