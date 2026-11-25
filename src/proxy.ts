/**
 * Next.js 16 の proxy（旧 middleware）。ページを描画する前に、
 * セッション Cookie がなければ /login へ送る（元のパスを callbackUrl に付ける）。
 *
 * ここでは Cookie があるかだけを見て、DB には問い合わせない。
 * Cookie は偽造も期限切れもありうるので、本当の確認はサーバー側
 * （src/server/session.ts の getCurrentUserId）で毎回行う。
 *
 * あわせて Content-Security-Policy を付ける（S3 のオリジンを実行時の
 * 環境変数から決めるため。src/lib/security-headers.ts）。
 *
 * 応答に x-request-id（このリクエストのトレース ID、第18章）を付ける。
 * 問い合わせのときにこの値を聞けば、ログ（traceId）とトレースを引ける。
 */
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import {
  REQUEST_PATH_HEADER,
  loginUrlFor,
  requiresLogin,
} from "@/lib/auth-paths";
import { cspFromEnv } from "@/lib/security-headers";
import { currentTraceId } from "@/server/telemetry/tracing";

function withCsp(response: NextResponse): NextResponse {
  response.headers.set(
    "Content-Security-Policy",
    cspFromEnv(process.env, process.env.NODE_ENV === "development"),
  );
  const traceId = currentTraceId();
  if (traceId) response.headers.set("x-request-id", traceId);
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const path = `${pathname}${search}`;

  if (requiresLogin(pathname) && !getSessionCookie(request)) {
    return withCsp(
      NextResponse.redirect(new URL(loginUrlFor(path), request.url)),
    );
  }

  // サーバー側でセッションが無効と分かったときの戻り先に使う。
  // クライアントが同じ名前のヘッダーを送ってきても上書きする
  const headers = new Headers(request.headers);
  headers.set(REQUEST_PATH_HEADER, path);
  return withCsp(NextResponse.next({ request: { headers } }));
}

export const config = {
  // 静的ファイルと画像の最適化、拡張子の付いたファイル（favicon など）は除く
  matcher: ["/((?!_next/static|_next/image|.*\\.\\w+$).*)"],
};
