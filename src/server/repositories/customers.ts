import { Prisma } from "@/generated/prisma/client";
import { type Db, getPrisma } from "@/server/db";

/**
 * 論理削除済みは含めない。全件を返すので、画面の一覧には使わない
 * （searchCustomers を使う）。CSV エクスポート（Worker）が使う。
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

/** 検索で無視する空白（JavaScript の \s のうち、氏名・メールに現れうるもの） */
const SPACES = String.raw`[[:space:] 　﻿]`;

export type CustomerSearch = {
  /** 小文字にして空白を除いた検索語。空なら絞り込まない */
  text: string;
  /** 検索語の数字だけ。空なら電話番号では探さない */
  digits: string;
  skip: number;
  take: number;
};

export type CustomerListRow = {
  id: string;
  name: string;
  nameKana: string;
  email: string;
  phone: string;
};

/**
 * 顧客一覧の検索とページング（第15章）。以前は全件を読んで Node で
 * 絞り込み・並べ替えをしていたが、1 万件で 1 回 150ms かかったので SQL に
 * 寄せた（docs/performance.md）。
 *
 * - 氏名・フリガナ・メールは小文字にして空白を除いた値の部分一致、電話番号は
 *   数字だけにした値の部分一致（ハイフンの有無を問わない）
 * - 並びはフリガナの日本語の照合順序（ICU の ja。Node の
 *   localeCompare("ja") と同じ順）、同じなら ID
 * - 件数はウィンドウ関数で同じクエリから取る。範囲外のページでは行も件数も
 *   返らない（total は 0 になる）ので、呼び出し側で読み直す
 */
export async function searchCustomers(
  organizationId: string,
  search: CustomerSearch,
  db: Db = getPrisma(),
): Promise<{ rows: CustomerListRow[]; total: number }> {
  const normalized = (column: Prisma.Sql) =>
    Prisma.sql`strpos(lower(regexp_replace(${column}, ${SPACES}, '', 'g')), ${search.text}) > 0`;
  const conditions = [
    normalized(Prisma.sql`name`),
    normalized(Prisma.sql`"nameKana"`),
    normalized(Prisma.sql`email`),
  ];
  if (search.digits !== "") {
    conditions.push(
      Prisma.sql`strpos(regexp_replace(phone, '[^0-9]', '', 'g'), ${search.digits}) > 0`,
    );
  }
  const filter =
    search.text === ""
      ? Prisma.empty
      : Prisma.sql`AND (${Prisma.join(conditions, " OR ")})`;
  const rows = await db.$queryRaw<
    (CustomerListRow & { total: bigint })[]
  >(Prisma.sql`
    SELECT id, name, "nameKana", email, phone, count(*) OVER () AS total
    FROM customer
    WHERE "organizationId" = ${organizationId}
      AND "deletedAt" IS NULL
      ${filter}
    ORDER BY "nameKana" COLLATE "ja-x-icu", id COLLATE "C"
    LIMIT ${search.take} OFFSET ${search.skip}`);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      nameKana: r.nameKana,
      email: r.email,
      phone: r.phone,
    })),
    total: Number(rows[0]?.total ?? 0),
  };
}

/** 予約フォームの選択肢。必要な列だけを、フリガナの順に返す */
export async function listCustomerOptions(
  organizationId: string,
  db: Db = getPrisma(),
): Promise<{ id: string; name: string; nameKana: string }[]> {
  return db.$queryRaw(Prisma.sql`
    SELECT id, name, "nameKana"
    FROM customer
    WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL
    ORDER BY "nameKana" COLLATE "ja-x-icu", id COLLATE "C"`);
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
