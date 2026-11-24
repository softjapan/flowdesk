import type { Prisma } from "@/generated/prisma/client";
import { type Db, getPrisma } from "@/server/db";

export type AuditLogEntry = {
  organizationId: string;
  actorUserId: string;
  /** customer.update など */
  action: string;
  targetType: string;
  targetId: string;
  diff: Prisma.InputJsonValue;
};

/** 変更と同じトランザクションの tx を渡し、変更と記録を一緒に確定させる */
export async function createAuditLog(
  entry: AuditLogEntry,
  db: Db = getPrisma(),
) {
  return db.auditLog.create({ data: entry });
}

export type AuditLogFilter = {
  /** この日時以降（含む） */
  from: Date | null;
  /** この日時より前（含まない） */
  to: Date | null;
  actorUserId: string | null;
  targetType: string | null;
};

function whereOf(
  organizationId: string,
  filter: AuditLogFilter,
): Prisma.AuditLogWhereInput {
  return {
    organizationId,
    createdAt: {
      ...(filter.from && { gte: filter.from }),
      ...(filter.to && { lt: filter.to }),
    },
    ...(filter.actorUserId && { actorUserId: filter.actorUserId }),
    ...(filter.targetType && { targetType: filter.targetType }),
  };
}

/** 新しい順。インデックス (organizationId, createdAt) を使う */
export async function listAuditLogs(
  organizationId: string,
  filter: AuditLogFilter,
  page: { skip: number; take: number },
  db: Db = getPrisma(),
) {
  const where = whereOf(organizationId, filter);
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: page.skip,
      take: page.take,
    }),
    db.auditLog.count({ where }),
  ]);
  return { rows, total };
}

/** 組織の監査ログに現れる操作者（絞り込みの選択肢） */
export async function listAuditActorIds(
  organizationId: string,
  db: Db = getPrisma(),
): Promise<string[]> {
  const rows = await db.auditLog.findMany({
    where: { organizationId },
    distinct: ["actorUserId"],
    select: { actorUserId: true },
  });
  return rows.map((r) => r.actorUserId);
}
