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
