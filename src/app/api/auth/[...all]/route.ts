// Better Auth のハンドラー（docs/screens.md の /api/auth/[...all]）。
// ログイン・登録・ログアウト・パスワード再設定などはすべてここで受ける
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

export const { GET, POST } = toNextJsHandler(auth);
