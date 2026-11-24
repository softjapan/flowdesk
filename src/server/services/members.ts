/**
 * メンバー管理（S-13、F-03・F-04）。招待・ロール変更・削除。
 *
 * docs/authz-matrix.md のテストケース：
 * 3. Admin は自分を（他の人も）Owner に昇格できない → authz.canChangeRole
 * 4. 最後の Owner は削除・降格できない → 組織の行をロックしてから Owner の
 *    人数を数える（同時に 2 人の Owner がお互いを降格しても、どちらかは失敗する）
 * 6. 権限の変更は、変更と同じトランザクションで監査ログに残す
 * 5. Free プランでスタッフが上限なら招待できない → plan-limits.canAddStaff
 *    （受諾の時点でも確かめる。invitations.ts）
 */
import { buildInvitationMail } from "@/server/auth-mails";
import { runInTransaction } from "@/server/db";
import { ROLE_LABELS, type Role } from "@/server/domain";
import { createAuditLog } from "@/server/repositories/audit-logs";
import {
  cancelPendingInvitationsForEmail,
  createInvitation,
  findPendingInvitation,
  listPendingInvitations,
  transitionInvitation,
} from "@/server/repositories/invitations";
import {
  countOwners,
  deleteMember,
  findMemberById,
  listMembers,
  updateMemberRole,
} from "@/server/repositories/members";
import {
  findMember,
  lockOrganization,
} from "@/server/repositories/organizations";
import {
  findUserById,
  findUserIdByEmail,
} from "@/server/repositories/users";
import {
  canCancelInvitation,
  canChangeRole,
  canInvite,
  canRemoveMember,
  canViewBilling,
  changeableRoles,
  invitableRoles,
} from "@/server/services/authz";
import {
  createMailJob,
  dispatchJobs,
  type Dispatch,
} from "@/server/services/jobs";
import type { OrgContext } from "@/server/services/org-context";
import {
  canAddStaff,
  getPlanUsage,
  type PlanUsage,
} from "@/server/services/plan-limits";
import { fail, ok, type Result } from "@/server/services/result";
import type { InvitationInput } from "@/server/validation/organization";

/** Better Auth の既定（invitationExpiresIn）と同じ 48 時間 */
export const INVITATION_EXPIRES_IN_HOURS = 48;

export type MemberListItem = {
  id: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
  isSelf: boolean;
  /** 変更先として選べるロール（現在のロールを含む）。空なら変更できない */
  roleOptions: Role[];
  canRemove: boolean;
};

export type InvitationListItem = {
  id: string;
  email: string;
  role: Role;
  inviterName: string;
  expiresAt: Date;
  canCancel: boolean;
};

export type MembersPage = {
  members: MemberListItem[];
  /** Owner・Admin にだけ返す（Staff には招待中のアドレスを見せない） */
  invitations: InvitationListItem[];
  /** 招待で選べるロール。空なら招待できない */
  inviteRoles: Role[];
  /** プランとスタッフの上限（料金プランを閲覧できる Owner・Admin だけ） */
  planUsage: PlanUsage | null;
};

/**
 * メンバーの一覧は全ロールが見られる（docs/authz-matrix.md）。
 * 操作の可否は画面のための目安で、更新時に Service でも判定する。
 * 最後の Owner かどうかは画面では見ず、更新時に判定する
 */
export async function getMembersPage(
  ctx: OrgContext,
  now: Date,
): Promise<MembersPage> {
  const inviteRoles = invitableRoles(ctx.role);
  const [members, invitations, planUsage] = await Promise.all([
    listMembers(ctx.organizationId),
    inviteRoles.length > 0
      ? listPendingInvitations(ctx.organizationId, now)
      : Promise.resolve([]),
    canViewBilling(ctx.role)
      ? getPlanUsage(ctx.organizationId)
      : Promise.resolve(null),
  ]);
  return {
    members: members.map((m) => {
      const options = changeableRoles(ctx.role, m.role);
      return {
        id: m.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        joinedAt: m.createdAt,
        isSelf: m.id === ctx.memberId,
        roleOptions: options.length > 1 ? options : [],
        canRemove: canRemoveMember(ctx.role, m.role),
      };
    }),
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      inviterName: i.user.name,
      expiresAt: i.expiresAt,
      canCancel: canCancelInvitation(ctx.role, i.role),
    })),
    inviteRoles,
    planUsage,
  };
}

export async function changeMemberRole(
  ctx: OrgContext,
  memberId: string,
  role: Role,
): Promise<Result<{ id: string }>> {
  return runInTransaction(async (tx) => {
    if (!(await lockOrganization(ctx.organizationId, tx))) {
      return fail("not_found");
    }
    const target = await findMemberById(
      ctx.organizationId,
      memberId,
      tx,
    );
    if (!target) return fail("not_found");
    // ロックを取るまでに自分のロールが変わっていることがあるので読み直す
    const actor = await findMember(
      ctx.organizationId,
      ctx.userId,
      tx,
    );
    if (!actor) return fail("not_found");
    if (!canChangeRole(actor.role, target.role, role)) {
      return fail("forbidden");
    }
    if (target.role === role) return ok({ id: memberId });
    if (
      target.role === "owner" &&
      (await countOwners(ctx.organizationId, tx)) <= 1
    ) {
      return fail("last_owner");
    }
    if (
      !(await updateMemberRole(
        ctx.organizationId,
        memberId,
        role,
        tx,
      ))
    ) {
      return fail("not_found");
    }
    await createAuditLog(
      {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "member.update_role",
        targetType: "member",
        targetId: memberId,
        diff: { userId: target.userId, from: target.role, to: role },
      },
      tx,
    );
    return ok({ id: memberId });
  });
}

export async function removeMember(
  ctx: OrgContext,
  memberId: string,
): Promise<Result<{ id: string; removedSelf: boolean }>> {
  return runInTransaction(async (tx) => {
    if (!(await lockOrganization(ctx.organizationId, tx))) {
      return fail("not_found");
    }
    const target = await findMemberById(
      ctx.organizationId,
      memberId,
      tx,
    );
    if (!target) return fail("not_found");
    const actor = await findMember(
      ctx.organizationId,
      ctx.userId,
      tx,
    );
    if (!actor) return fail("not_found");
    if (!canRemoveMember(actor.role, target.role)) {
      return fail("forbidden");
    }
    if (
      target.role === "owner" &&
      (await countOwners(ctx.organizationId, tx)) <= 1
    ) {
      return fail("last_owner");
    }
    if (!(await deleteMember(ctx.organizationId, memberId, tx))) {
      return fail("not_found");
    }
    await createAuditLog(
      {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "member.remove",
        targetType: "member",
        targetId: memberId,
        diff: { userId: target.userId, role: target.role },
      },
      tx,
    );
    return ok({
      id: memberId,
      removedSelf: target.userId === ctx.userId,
    });
  });
}

function invitationUrl(id: string): string {
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return new URL(`/invitations/${id}`, base).toString();
}

/**
 * 招待を作り、招待メールの送信を依頼する。同じアドレスへの未対応の招待は
 * 取り消して作り直す（リンクは最新のものだけが有効）。メールの依頼は
 * 招待と同じトランザクションで作るので、招待だけができてメールが
 * 送られない、ということはない（送信は Worker が行い、失敗すれば再試行する）
 */
export async function inviteMember(
  ctx: OrgContext,
  input: InvitationInput,
  now: Date,
  dispatch: Dispatch = dispatchJobs,
): Promise<Result<{ id: string }>> {
  if (!canInvite(ctx.role, input.role)) return fail("forbidden");
  const result = await runInTransaction(async (tx) => {
    if (!(await lockOrganization(ctx.organizationId, tx))) {
      return fail("not_found");
    }
    const userId = await findUserIdByEmail(input.email, tx);
    if (
      userId &&
      (await findMember(ctx.organizationId, userId, tx))
    ) {
      return fail("already_member");
    }
    // 上限に達していれば、受諾できない招待を送らない（受諾の時点でも
    // 確かめる。招待中の人数は数えないので、招待が上限を超えることはある）
    if (!(await canAddStaff(ctx.organizationId, tx))) {
      return fail("plan_limit");
    }
    await cancelPendingInvitationsForEmail(
      ctx.organizationId,
      input.email,
      tx,
    );
    const invitation = await createInvitation(
      {
        organizationId: ctx.organizationId,
        email: input.email,
        role: input.role,
        inviterId: ctx.userId,
        expiresAt: new Date(
          now.getTime() +
            INVITATION_EXPIRES_IN_HOURS * 60 * 60 * 1000,
        ),
      },
      tx,
    );
    await createAuditLog(
      {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "invitation.create",
        targetType: "invitation",
        targetId: invitation.id,
        diff: { email: input.email, role: input.role },
      },
      tx,
    );
    const inviter = await findUserById(ctx.userId, tx);
    const jobId = await createMailJob(
      buildInvitationMail({
        to: input.email,
        organizationName: ctx.organizationName,
        inviterName: inviter?.name ?? "組織のメンバー",
        roleLabel: ROLE_LABELS[input.role],
        url: invitationUrl(invitation.id),
        expiresInHours: INVITATION_EXPIRES_IN_HOURS,
      }),
      {
        key: `invitation:${invitation.id}`,
        organizationId: ctx.organizationId,
      },
      tx,
    );
    return ok({ id: invitation.id, jobId });
  });
  if (!result.ok) return result;
  // キューへはコミットした後に送る（送れなくても Worker が送り直す）
  await dispatch([result.value.jobId]);
  return ok({ id: result.value.id });
}

export async function cancelInvitation(
  ctx: OrgContext,
  invitationId: string,
): Promise<Result<{ id: string }>> {
  return runInTransaction(async (tx) => {
    const invitation = await findPendingInvitation(
      ctx.organizationId,
      invitationId,
      tx,
    );
    if (!invitation) return fail("not_found");
    if (!canCancelInvitation(ctx.role, invitation.role)) {
      return fail("forbidden");
    }
    const changed = await transitionInvitation(
      ctx.organizationId,
      invitationId,
      "pending",
      "canceled",
      tx,
    );
    if (!changed) return fail("not_found");
    await createAuditLog(
      {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "invitation.cancel",
        targetType: "invitation",
        targetId: invitationId,
        diff: { email: invitation.email, role: invitation.role },
      },
      tx,
    );
    return ok({ id: invitationId });
  });
}
