"use server";
/**
 * 招待の受諾・辞退（S-05、F-03）。招待の ID は .bind で渡すが、
 * 書き換えて送れるので検証する。本人宛てでない・受諾できない招待は 404。
 */
import { notFound, redirect } from "next/navigation";
import { requireId } from "@/server/request-context";
import {
  acceptInvitation,
  rejectInvitation,
} from "@/server/services/invitations";
import { getCurrentUserId } from "@/server/session";

export async function acceptInvitationAction(id: string) {
  const userId = await getCurrentUserId();
  const result = await acceptInvitation(
    userId,
    requireId(id),
    new Date(),
  );
  if (!result.ok) {
    // プランの上限は、招待を残したまま理由を表示する（Pro にした後で受諾できる）
    if (result.reason === "plan_limit") {
      redirect(
        `/invitations/${encodeURIComponent(id)}?error=plan_limit`,
      );
    }
    notFound();
  }
  redirect(`/${result.value.slug}`);
}

export async function rejectInvitationAction(id: string) {
  const userId = await getCurrentUserId();
  const result = await rejectInvitation(
    userId,
    requireId(id),
    new Date(),
  );
  if (!result.ok) notFound();
  redirect("/orgs");
}
