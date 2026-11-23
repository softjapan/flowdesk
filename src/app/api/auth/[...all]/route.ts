// Better Auth のハンドラー（docs/screens.md の /api/auth/[...all]）。
// ログイン・登録・ログアウト・パスワード再設定などはすべてここで受ける
import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";

// 読み込み時に Better Auth を作らないよう、リクエストのたびに取り出す
export function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
