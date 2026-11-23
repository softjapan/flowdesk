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

/** 論理削除済みは見つからないものとして扱う */
export async function findCustomer(
  organizationId: string,
  id: string,
  db: Db = getPrisma(),
) {
  return db.customer.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
}

/** 画面から登録・編集できる列（organizationId・id・deletedAt は変えさせない） */
export type CustomerFields = {
  name: string;
  nameKana: string;
  email: string;
  phone: string;
  note: string;
};

export async function createCustomer(
  organizationId: string,
  fields: CustomerFields,
  db: Db = getPrisma(),
) {
  return db.customer.create({ data: { ...fields, organizationId } });
}

/** 更新できたら true。他の組織・論理削除済み・存在しない場合は false */
export async function updateCustomer(
  organizationId: string,
  id: string,
  fields: Partial<CustomerFields>,
  db: Db = getPrisma(),
): Promise<boolean> {
  const { count } = await db.customer.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: fields,
  });
  return count === 1;
}

/** 論理削除。既に削除済みなら false（2 回目の削除は「見つからない」） */
export async function softDeleteCustomer(
  organizationId: string,
  id: string,
  deletedAt: Date,
  db: Db = getPrisma(),
): Promise<boolean> {
  const { count } = await db.customer.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: { deletedAt },
  });
  return count === 1;
}
