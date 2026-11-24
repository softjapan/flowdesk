/** 顧客一覧の CSV エクスポート（F-11）。すべて organizationId で絞り込む */
import { type Db, getPrisma } from "@/server/db";

export async function createCustomerExport(
  organizationId: string,
  requestedByUserId: string,
  db: Db = getPrisma(),
) {
  return db.customerExport.create({
    data: { organizationId, requestedByUserId },
  });
}

export async function findCustomerExport(
  organizationId: string,
  id: string,
  db: Db = getPrisma(),
) {
  return db.customerExport.findFirst({
    where: { id, organizationId },
  });
}

export async function listRecentCustomerExports(
  organizationId: string,
  limit: number,
  db: Db = getPrisma(),
) {
  return db.customerExport.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
}

/** pending のときだけ完了にする（2 回目の処理では何も変えない） */
export async function markCustomerExportDone(
  organizationId: string,
  id: string,
  result: { s3Key: string; rowCount: number; completedAt: Date },
  db: Db = getPrisma(),
): Promise<boolean> {
  const { count } = await db.customerExport.updateMany({
    where: { id, organizationId, status: "pending" },
    data: { status: "done", ...result },
  });
  return count === 1;
}

export async function markCustomerExportFailed(
  organizationId: string,
  id: string,
  completedAt: Date,
  db: Db = getPrisma(),
): Promise<void> {
  await db.customerExport.updateMany({
    where: { id, organizationId, status: "pending" },
    data: { status: "failed", completedAt },
  });
}
