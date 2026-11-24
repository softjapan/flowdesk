/**
 * 更新の入口（Server Action・Route Handler）で共通に使う補助。
 * 入口は「入力の検証・認証・Service の呼び出し」だけを行い、
 * 業務の判断は Service（src/server/services/）に任せる。
 */
import { notFound } from "next/navigation";
import {
  getOrgContext,
  type OrgContext,
} from "@/server/services/org-context";
import type { Failure } from "@/server/services/result";
import { getCurrentUserId } from "@/server/session";
import { idSchema } from "@/server/validation/form";

/**
 * ログインを確かめ（未ログインは /login へ）、組織のメンバーでなければ 404。
 * Server Action の引数は利用者が書き換えられるので、スラッグも検証する
 */
export async function requireOrgContext(
  slug: unknown,
): Promise<OrgContext> {
  const parsedSlug = idSchema.safeParse(slug);
  if (!parsedSlug.success) notFound();
  const ctx = await getOrgContext(
    parsedSlug.data,
    await getCurrentUserId(),
  );
  if (!ctx) notFound();
  return ctx;
}

/** 形式が不正な ID は、存在しない ID と同じく 404 */
export function requireId(id: unknown): string {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) notFound();
  return parsed.data;
}

/** not_found 以外の失敗を、フォームに出すメッセージにする */
export function failureMessage(
  reason: Exclude<Failure, "not_found">,
): string {
  switch (reason) {
    case "forbidden":
      return "この操作を行う権限がありません。";
    case "conflict":
      return "ほかの人が先に更新しました。画面を読み込み直してから、もう一度操作してください。";
    case "slot_taken":
      return "その時間は、担当スタッフの別の予約で埋まっています。";
    case "not_editable":
      return "キャンセル済み・来店済みの予約は変更できません。";
    case "last_owner":
      return "組織には Owner が 1 人以上必要です。先に別のメンバーを Owner にしてください。";
    case "already_member":
      return "このメールアドレスのユーザーは、すでに組織のメンバーです。";
    case "slug_taken":
      return "この URL はすでに使われています。別の URL を指定してください。";
    case "upload_mismatch":
      return "ファイルのアップロードを確認できませんでした。もう一度アップロードしてください。";
    case "plan_limit":
      return "Free プランの上限（スタッフ 2 人・店舗 1 つ）に達しています。Owner が料金プランを Pro に変更すると追加できます。";
    case "already_subscribed":
      return "すでに Pro プランです。プランの変更・解約はカスタマーポータルで行ってください。";
    case "no_billing_account":
      return "まだお支払いの情報がありません。Pro プランに申し込むと、カスタマーポータルを使えます。";
    case "in_use":
      return "予約で使われているため削除できません。名前を変えて使い続けてください。";
    case "billing_unavailable":
      return "課金の設定が完了していないため、現在は申し込めません。";
  }
}
