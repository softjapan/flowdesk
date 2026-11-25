/**
 * Next.js の instrumentation（第18章、docs/observability.md）。サーバーの起動時に
 * 1 回だけ register が呼ばれる。SDK は Node.js でだけ動くので、
 * NEXT_RUNTIME が nodejs のときだけ読み込む（同梱のドキュメント
 * 01-app/02-guides/open-telemetry.md の手動の設定）。
 */
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}

/**
 * 描画・Route Handler・Server Action で捕まらなかった例外。
 * ヘッダー（Cookie）・本文は出さず、どの経路で起きたかと digest だけを残す
 * （error.tsx の画面に出る digest と照らし合わせる）
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  ctx,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("@/server/logger");
  const digest = (error as { digest?: unknown }).digest;
  logger.error("リクエストの処理中に例外", {
    err: error,
    digest: typeof digest === "string" ? digest : undefined,
    method: request.method,
    // クエリ文字列（検索語・トークン）を出さない
    path: request.path.split("?")[0],
    routePath: ctx.routePath,
    routeType: ctx.routeType,
    routerKind: ctx.routerKind,
  });
};
