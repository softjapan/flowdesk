/**
 * サーバー側でのセッションの取得。Server Component・Server Action・
 * Route Handler からはここを通してログインユーザーを得る。
 *
 * proxy（src/proxy.ts）は Cookie の有無しか見ないので、
 * セッションが本当に有効かはここで DB に問い合わせて確かめる。
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { REQUEST_PATH_HEADER, loginUrlFor } from "@/lib/auth-paths";
import { auth } from "@/server/auth";

/**
 * 現在のセッション（未ログインなら null）。
 * レイアウトと各ページから呼ばれるので、同じリクエストでは一度だけ取得する
 */
export const getSession = cache(async function getSession() {
  return auth.api.getSession({ headers: await headers() });
});

/**
 * ログイン中のユーザー ID。未ログインなら /login へ送り、
 * ログイン後に元のページ（proxy が付けたヘッダー）へ戻す。
 */
export async function getCurrentUserId(): Promise<string> {
  const session = await getSession();
  if (!session) {
    const path = (await headers()).get(REQUEST_PATH_HEADER) ?? "/";
    redirect(loginUrlFor(path));
  }
  return session.user.id;
}
