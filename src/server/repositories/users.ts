/**
 * ユーザー（Better Auth の user テーブル）。ユーザーは組織に属さないので
 * organizationId では絞り込めない。呼び出し側は「ログイン中の本人」か
 * 「組織の監査ログ・メンバーに現れるユーザー」の ID だけを渡す。
 */
import { type Db, getPrisma } from "@/server/db";

export async function findUserById(id: string, db: Db = getPrisma()) {
  return db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true },
  });
}

export async function findUserIdByEmail(
  email: string,
  db: Db = getPrisma(),
): Promise<string | null> {
  const row = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  return row?.id ?? null;
}

export async function listUserNames(
  ids: string[],
  db: Db = getPrisma(),
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}
