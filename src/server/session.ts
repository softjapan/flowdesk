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
import { getAuth } from "@/server/auth";

/**
 * 現在のセッション（未ログインなら null）。
 * レイアウトと各ページから呼ばれるので、同じリクエストでは一度だけ取得する
 */
export const getSession = cache(async function getSession() {
  // headers() を先に読む。getAuth() を先に呼ぶと、リクエストに依存する
  // 処理に入る前（事前描画の時点）で DB の接続を作ろうとする
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
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
