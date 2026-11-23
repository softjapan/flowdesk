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

export async function listServices(
  organizationId: string,
  db: Db = getPrisma(),
) {
  return db.service.findMany({
    where: { organizationId },
    orderBy: { id: "asc" },
  });
}
