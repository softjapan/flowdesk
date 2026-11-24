/**
 * メンバーとスタッフ情報の更新（S-13）。すべて organizationId で絞り込む。
 * ロール変更・削除は lockOrganization（organizations.ts）でロックした
 * トランザクションの tx を渡して呼ぶ。
 */
import { toRole } from "@/server/access-control";
import { type Db, getPrisma } from "@/server/db";
import type { Role } from "@/server/domain";

/** ロールが FlowDesk のものでないメンバーは含めない */
export async function listMembers(
  organizationId: string,
  db: Db = getPrisma(),
) {
  const rows = await db.member.findMany({
    where: { organizationId },
    select: {
      id: true,
      userId: true,
      role: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.flatMap((m) => {
    const role = toRole(m.role);
    return role ? [{ ...m, role }] : [];
  });
}

export async function findMemberById(
  organizationId: string,
  id: string,
  db: Db = getPrisma(),
) {
  const row = await db.member.findFirst({
    where: { id, organizationId },
    select: { id: true, userId: true, role: true },
  });
  if (!row) return null;
  const role = toRole(row.role);
  return role ? { ...row, role } : null;
}

export async function countOwners(
  organizationId: string,
  db: Db = getPrisma(),
): Promise<number> {
  return db.member.count({
    where: { organizationId, role: "owner" },
  });
}

export async function updateMemberRole(
  organizationId: string,
  id: string,
  role: Role,
  db: Db = getPrisma(),
): Promise<boolean> {
  const { count } = await db.member.updateMany({
    where: { id, organizationId },
    data: { role },
  });
  return count === 1;
}

/**
 * メンバーを削除する。スタッフ情報は担当した予約の履歴に必要なので
 * 消さずに無効にし、メンバーとの紐づけを外す（外部キーは SET NULL）
 */
export async function deleteMember(
  organizationId: string,
  id: string,
  db: Db = getPrisma(),
): Promise<boolean> {
  await db.staffProfile.updateMany({
    where: { organizationId, memberId: id },
    data: { active: false, memberId: null },
  });
  const { count } = await db.member.deleteMany({
    where: { id, organizationId },
  });
  return count === 1;
}

/** 招待を受けて加わったメンバーのスタッフ情報（予約の担当に選べる） */
export async function createStaffProfile(
  input: {
    organizationId: string;
    memberId: string;
    displayName: string;
  },
  db: Db = getPrisma(),
) {
  return db.staffProfile.create({
    data: input,
    select: { id: true },
  });
}
