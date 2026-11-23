import { type Db, getPrisma } from "@/server/db";

/** DB に接続してクエリを 1 本実行する。失敗すれば例外 */
export async function pingDatabase(db: Db = getPrisma()) {
  await db.$queryRaw`SELECT 1`;
}
