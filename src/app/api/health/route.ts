// ヘルスチェック（docs/screens.md の /api/health）。DB に接続できれば 200、
// できなければ 503 を返す。認証は不要で、組織のデータは返さない
import { connection } from "next/server";
import { checkHealth } from "@/server/services/health";

export async function GET() {
  // Cache Components では、何もしないと GET がビルド時に事前描画される。
  // リクエストのたびに DB を確かめるよう、先にリクエスト時の処理にする
  await connection();
  const health = await checkHealth();
  const ok = health.database === "ok";
  return Response.json(
    { status: ok ? "ok" : "error", ...health },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
