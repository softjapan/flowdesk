import { DEMO_USER_ID } from "@/server/demo-user";

/**
 * ログイン中のユーザー ID。
 * TODO: 第8章で Better Auth のセッションから取得する形に置き換える。
 */
export async function getCurrentUserId(): Promise<string> {
  return DEMO_USER_ID;
}
