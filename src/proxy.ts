/**
 * Next.js 16 の proxy（旧 middleware）。ページを描画する前に、
 * セッション Cookie がなければ /login へ送る（元のパスを callbackUrl に付ける）。
 *
 * ここでは Cookie があるかだけを見て、DB には問い合わせない。
 * Cookie は偽造も期限切れもありうるので、本当の確認はサーバー側
 * （src/server/session.ts の getCurrentUserId）で毎回行う。
 */
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import {
  REQUEST_PATH_HEADER,
  loginUrlFor,
  requiresLogin,
} from "@/lib/auth-paths";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const path = `${pathname}${search}`;

  if (requiresLogin(pathname) && !getSessionCookie(request)) {
    return NextResponse.redirect(
      new URL(loginUrlFor(path), request.url),
    );
  }

  // サーバー側でセッションが無効と分かったときの戻り先に使う。
  // クライアントが同じ名前のヘッダーを送ってきても上書きする
  const headers = new Headers(request.headers);
  headers.set(REQUEST_PATH_HEADER, path);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // 静的ファイルと画像の最適化、拡張子の付いたファイル（favicon など）は除く
  matcher: ["/((?!_next/static|_next/image|.*\\.\\w+$).*)"],
};
