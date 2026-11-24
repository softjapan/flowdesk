/**
 * 招待の受諾（S-05、F-03）。招待された人はまだ組織のメンバーではないので
 * OrgContext ではなくログイン中のユーザー ID を受け取り、招待のメール
 * アドレスと本人のメールアドレスが一致するときだけ扱う。他人宛ての
 * 招待は、存在しない招待と同じく null・not_found にする（組織名を漏らさない）。
 */
import { runInTransaction } from "@/server/db";
import type { Role } from "@/server/domain";
import { createAuditLog } from "@/server/repositories/audit-logs";
import {
  findInvitationForEmail,
  transitionInvitation,
} from "@/server/repositories/invitations";
import { createStaffProfile } from "@/server/repositories/members";
import {
  createMember,
  findMember,
  lockOrganization,
} from "@/server/repositories/organizations";
import { findUserById } from "@/server/repositories/users";
import { canAddStaff } from "@/server/services/plan-limits";
import { fail, ok, type Result } from "@/server/services/result";

export type InvitationState =
  /** 受諾できる */
  | "pending"
  | "expired"
  | "accepted"
  /** 辞退・取り消し済み */
  | "closed";

export type InvitationView = {
  id: string;
  organizationName: string;
  slug: string;
  role: Role;
  inviterName: string;
  expiresAt: Date;
  state: InvitationState;
};

function stateOf(status: string, expiresAt: Date, now: Date) {
  if (status === "accepted") return "accepted";
  if (status !== "pending") return "closed";
  return expiresAt <= now ? "expired" : "pending";
}

async function findForUser(userId: string, id: string) {
  const user = await findUserById(userId);
  if (!user) return null;
  return findInvitationForEmail(id, user.email.toLowerCase());
}

export async function getInvitationForUser(
  userId: string,
  id: string,
  now: Date,
): Promise<InvitationView | null> {
  const invitation = await findForUser(userId, id);
  if (!invitation) return null;
  return {
    id: invitation.id,
    organizationName: invitation.organization.name,
    slug: invitation.organization.slug,
    role: invitation.role,
    inviterName: invitation.user.name,
    expiresAt: invitation.expiresAt,
    state: stateOf(invitation.status, invitation.expiresAt, now),
  };
}

/**
 * 招待を受けてメンバーになる。予約の担当に選べるよう、スタッフ情報も作る。
 * すでにメンバーなら招待を受諾済みにするだけで、ロールは変えない
 * （招待のリンクでロールを上書きさせない）。
 * Free プランでスタッフが上限（2 人）に達していれば plan_limit
 * （docs/authz-matrix.md のテストケース 5）
 */
export async function acceptInvitation(
  userId: string,
  id: string,
  now: Date,
): Promise<Result<{ slug: string }>> {
  const invitation = await findForUser(userId, id);
  if (!invitation) return fail("not_found");
  if (
    stateOf(invitation.status, invitation.expiresAt, now) !==
    "pending"
  ) {
    return fail("not_found");
  }
  const { organizationId } = invitation;
  return runInTransaction(async (tx) => {
    if (!(await lockOrganization(organizationId, tx))) {
      return fail("not_found");
    }
    const alreadyMember = await findMember(
      organizationId,
      userId,
      tx,
    );
    // プランの上限（F-15）。招待は残すので、Pro にした後で受諾できる。
    // 組織をロックした後に数えるので、同時の受諾でも上限を超えない
    if (!alreadyMember && !(await canAddStaff(organizationId, tx))) {
      return fail("plan_limit");
    }
    // 同時に受諾・取り消しされたときは、先に変えた方だけが通る
    const accepted = await transitionInvitation(
      organizationId,
      id,
      "pending",
      "accepted",
      tx,
    );
    if (!accepted) return fail("not_found");
    if (alreadyMember) {
      return ok({ slug: invitation.organization.slug });
    }
    const member = await createMember(
      { organizationId, userId, role: invitation.role },
      now,
      tx,
    );
    const user = await findUserById(userId, tx);
    await createStaffProfile(
      {
        organizationId,
        memberId: member.id,
        displayName: user?.name ?? invitation.email,
      },
      tx,
    );
    await createAuditLog(
      {
        organizationId,
        actorUserId: userId,
        action: "member.add",
        targetType: "member",
        targetId: member.id,
        diff: { userId, role: invitation.role, invitationId: id },
      },
      tx,
    );
    return ok({ slug: invitation.organization.slug });
  });
}

/** 招待を辞退する */
export async function rejectInvitation(
  userId: string,
  id: string,
  now: Date,
): Promise<Result<{ id: string }>> {
  const invitation = await findForUser(userId, id);
  if (!invitation) return fail("not_found");
  if (
    stateOf(invitation.status, invitation.expiresAt, now) !==
    "pending"
  ) {
    return fail("not_found");
  }
  const changed = await transitionInvitation(
    invitation.organizationId,
    id,
    "pending",
    "rejected",
  );
  return changed ? ok({ id }) : fail("not_found");
}
