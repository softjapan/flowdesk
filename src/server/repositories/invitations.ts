/**
 * 招待（Better Auth の invitation テーブル）。status は Better Auth と
 * 同じ値（pending・accepted・rejected・canceled）を使う。
 * 組織の画面からの操作は organizationId で絞り込む。招待された人は
 * まだメンバーではないので、招待の ID と本人のメールアドレスで引く。
 */
import { randomUUID } from "node:crypto";
import { toRole } from "@/server/access-control";
import { type Db, getPrisma } from "@/server/db";
import type { Role } from "@/server/domain";

/** 有効期限内の、未対応の招待 */
export async function listPendingInvitations(
  organizationId: string,
  now: Date,
  db: Db = getPrisma(),
) {
  const rows = await db.invitation.findMany({
    where: {
      organizationId,
      status: "pending",
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      user: { select: { name: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  return rows.flatMap((r) => {
    const role = toRole(r.role);
    return role ? [{ ...r, role }] : [];
  });
}

export async function findPendingInvitation(
  organizationId: string,
  id: string,
  db: Db = getPrisma(),
) {
  const row = await db.invitation.findFirst({
    where: { id, organizationId, status: "pending" },
    select: { id: true, email: true, role: true },
  });
  if (!row) return null;
  const role = toRole(row.role);
  return role ? { ...row, role } : null;
}

/** 同じアドレスへの未対応の招待を取り消す（招待し直したとき） */
export async function cancelPendingInvitationsForEmail(
  organizationId: string,
  email: string,
  db: Db = getPrisma(),
): Promise<number> {
  const { count } = await db.invitation.updateMany({
    where: { organizationId, email, status: "pending" },
    data: { status: "canceled" },
  });
  return count;
}

export async function createInvitation(
  input: {
    organizationId: string;
    email: string;
    role: Role;
    inviterId: string;
    expiresAt: Date;
  },
  db: Db = getPrisma(),
) {
  return db.invitation.create({
    // ID は招待のリンクに入る。推測できない値にする
    data: { id: randomUUID(), status: "pending", ...input },
    select: { id: true },
  });
}

/** status が from のときだけ to に変える（同時の受諾・取り消しを 1 回にする） */
export async function transitionInvitation(
  organizationId: string,
  id: string,
  from: "pending",
  to: "accepted" | "rejected" | "canceled",
  db: Db = getPrisma(),
): Promise<boolean> {
  const { count } = await db.invitation.updateMany({
    where: { id, organizationId, status: from },
    data: { status: to },
  });
  return count === 1;
}

/**
 * 招待された本人が開く画面（S-05）用。招待の ID と本人のメール
 * アドレスの両方が一致するものだけを返す（他人宛ての招待は見えない）
 */
export async function findInvitationForEmail(
  id: string,
  email: string,
  db: Db = getPrisma(),
) {
  const row = await db.invitation.findFirst({
    where: { id, email },
    select: {
      id: true,
      organizationId: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      organization: { select: { name: true, slug: true } },
      user: { select: { name: true } },
    },
  });
  if (!row) return null;
  const role = toRole(row.role);
  return role ? { ...row, role } : null;
}
