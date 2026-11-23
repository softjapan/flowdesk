import { pingDatabase } from "@/server/repositories/health";

export type Health = { database: "ok" | "unavailable" };

/**
 * ヘルスチェック（ALB から呼ばれる）。接続できない理由は応答に含めず
 * サーバーのログにだけ出す（接続先やエラーの詳細を外に漏らさない）。
 */
export async function checkHealth(): Promise<Health> {
  try {
    await pingDatabase();
    return { database: "ok" };
  } catch (error) {
    console.error("health: database unavailable", error);
    return { database: "unavailable" };
  }
}
