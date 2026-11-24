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
