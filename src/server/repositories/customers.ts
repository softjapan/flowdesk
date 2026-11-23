import { type Db, getPrisma } from "@/server/db";

/**
 * 論理削除済みは含めない。検索とページングは今は Service 側で行う
 * （電話番号のハイフンを無視する検索を SQL に寄せるかは第15章で計測して決める）。
 */
export async function listCustomers(
  organizationId: string,
  db: Db = getPrisma(),
) {
  return db.customer.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { id: "asc" },
  });
}
