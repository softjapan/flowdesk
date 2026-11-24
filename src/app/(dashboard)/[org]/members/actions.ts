"use server";
/**
 * メンバー管理の Server Action（F-03・F-04）。行うのは入力の検証・認証・
 * Service の呼び出しだけ。権限（Admin は Staff⇔Admin のみなど）と
 * 最後の Owner の確認は Service が判定する。
 *
 * slug と ID は .bind で渡すが、利用者が書き換えて送れるので必ず検証する。
 * 他の組織のメンバー・招待（存在しないものと区別しない）は 404 にする。
 */
import { refresh } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  failureMessage,
  requireId,
  requireOrgContext,
} from "@/server/request-context";
import {
  cancelInvitation,
  changeMemberRole,
  inviteMember,
  removeMember,
} from "@/server/services/members";
import {
  fieldErrorsOf,
  formValues,
  type FormErrors,
} from "@/server/validation/form";
import {
  INVITATION_FIELDS,
  invitationInputSchema,
  roleSchema,
  type InvitationFieldName,
} from "@/server/validation/organization";

export type MemberActionState = { form?: string; notice?: string };

export async function changeRoleAction(
  slug: string,
  memberId: string,
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const ctx = await requireOrgContext(slug);
  const id = requireId(memberId);
  const role = roleSchema.safeParse(formData.get("role"));
  if (!role.success) return { form: "ロールを選んでください。" };

  const result = await changeMemberRole(ctx, id, role.data);
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return { form: failureMessage(result.reason) };
  }
  refresh();
  return { notice: "ロールを変更しました。" };
}

export async function removeMemberAction(
  slug: string,
  memberId: string,
): Promise<MemberActionState> {
  const ctx = await requireOrgContext(slug);
  const result = await removeMember(ctx, requireId(memberId));
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return { form: failureMessage(result.reason) };
  }
  // 自分を削除したら、もうこの組織は開けない
  if (result.value.removedSelf) redirect("/orgs");
  refresh();
  return { notice: "メンバーを削除しました。" };
}

export type InviteFormState = FormErrors<InvitationFieldName> & {
  values?: Partial<Record<InvitationFieldName, string>>;
  notice?: string;
};

export async function inviteMemberAction(
  slug: string,
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const ctx = await requireOrgContext(slug);
  const raw = formValues(formData, INVITATION_FIELDS);
  const values = {
    email: typeof raw.email === "string" ? raw.email : "",
    role: typeof raw.role === "string" ? raw.role : "",
  };
  const parsed = invitationInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { fields: fieldErrorsOf(parsed.error), values };
  }

  const result = await inviteMember(ctx, parsed.data, new Date());
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return { form: failureMessage(result.reason), values };
  }
  refresh();
  if (!result.value.mailSent) {
    return {
      form: "招待を作成しましたが、メールを送信できませんでした。時間をおいて、もう一度招待してください。",
    };
  }
  return {
    notice: `${parsed.data.email} に招待メールを送りました。`,
  };
}

export async function cancelInvitationAction(
  slug: string,
  invitationId: string,
): Promise<MemberActionState> {
  const ctx = await requireOrgContext(slug);
  const result = await cancelInvitation(ctx, requireId(invitationId));
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return { form: failureMessage(result.reason) };
  }
  refresh();
  return { notice: "招待を取り消しました。" };
}
