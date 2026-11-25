import { runInTransaction } from "@/server/db";
import { createAuditLog } from "@/server/repositories/audit-logs";
import {
  createCustomer as createCustomerRow,
  findCustomer,
  searchCustomers,
  softDeleteCustomer,
  updateCustomer as updateCustomerRow,
  type CustomerFields,
} from "@/server/repositories/customers";
import {
  canDeleteCustomer,
  canEditCustomer,
} from "@/server/services/authz";
import type { OrgContext } from "@/server/services/org-context";
import { fail, ok, type Result } from "@/server/services/result";
import type { CustomerInput } from "@/server/validation/customer";
import {
  customerListQuerySchema,
  type SearchParams,
} from "@/server/validation/search-params";

export const CUSTOMER_PAGE_SIZE = 10;

export type CustomerListQuery = { q: string; page: number };

export function parseCustomerListQuery(
  params: SearchParams,
): CustomerListQuery {
  return customerListQuerySchema.parse(params);
}

export type CustomerListItem = {
  id: string;
  name: string;
  nameKana: string;
  email: string;
  phone: string;
};

export type CustomerList = {
  query: CustomerListQuery;
  items: CustomerListItem[];
  total: number;
  pageCount: number;
};

/**
 * 氏名・フリガナ・メール・電話番号（ハイフンの有無を問わない）で検索し、
 * フリガナの順に 1 ページ分を返す。絞り込み・並べ替え・ページングは SQL で
 * 行う（searchCustomers）
 */
export async function listCustomers(
  ctx: OrgContext,
  params: SearchParams,
): Promise<CustomerList> {
  const parsed = parseCustomerListQuery(params);
  const search = (page: number) =>
    searchCustomers(ctx.organizationId, {
      text: parsed.q.toLowerCase().replace(/\s/g, ""),
      digits: parsed.q.replace(/[^0-9]/g, ""),
      skip: (page - 1) * CUSTOMER_PAGE_SIZE,
      take: CUSTOMER_PAGE_SIZE,
    });

  let page = parsed.page;
  let { rows, total } = await search(page);
  // 範囲外のページは件数も返らないので、1 ページ目で件数を数えて最後の
  // ページを読み直す
  if (rows.length === 0 && page > 1) {
    ({ total } = await search(1));
    page = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE));
    ({ rows } = await search(page));
  }
  return {
    query: { q: parsed.q, page },
    items: rows,
    total,
    pageCount: Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE)),
  };
}

export type CustomerDetail = CustomerFields & {
  id: string;
  /** 画面で削除ボタンを出すか（Service でも必ず判定する） */
  canDelete: boolean;
};

/** 他の組織・論理削除済みの顧客は null（呼び出し側で 404） */
export async function getCustomer(
  ctx: OrgContext,
  id: string,
): Promise<CustomerDetail | null> {
  const row = await findCustomer(ctx.organizationId, id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    nameKana: row.nameKana,
    email: row.email,
    phone: row.phone,
    note: row.note,
    canDelete: canDeleteCustomer(ctx.role),
  };
}

const auditTarget = "customer";

/**
 * 監査ログには変わった項目の名前だけを残す（値は個人情報なので、
 * 監査ログを閲覧できる人にまで複製しない）
 */
function changedFields(
  before: CustomerFields,
  after: CustomerFields,
): (keyof CustomerFields)[] {
  return (Object.keys(after) as (keyof CustomerFields)[]).filter(
    (k) => before[k] !== after[k],
  );
}

export async function createCustomer(
  ctx: OrgContext,
  input: CustomerInput,
): Promise<Result<{ id: string }>> {
  if (!canEditCustomer(ctx.role)) return fail("forbidden");
  return runInTransaction(async (tx) => {
    const row = await createCustomerRow(
      ctx.organizationId,
      input,
      tx,
    );
    await createAuditLog(
      {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "customer.create",
        targetType: auditTarget,
        targetId: row.id,
        diff: { fields: Object.keys(input) },
      },
      tx,
    );
    return ok({ id: row.id });
  });
}

export async function updateCustomer(
  ctx: OrgContext,
  id: string,
  input: CustomerInput,
): Promise<Result<{ id: string }>> {
  if (!canEditCustomer(ctx.role)) return fail("forbidden");
  return runInTransaction(async (tx) => {
    const before = await findCustomer(ctx.organizationId, id, tx);
    if (!before) return fail("not_found");
    const fields = changedFields(before, input);
    if (fields.length === 0) return ok({ id });
    const updated = await updateCustomerRow(
      ctx.organizationId,
      id,
      input,
      tx,
    );
    // 読んだ後に別の操作で削除された
    if (!updated) return fail("not_found");
    await createAuditLog(
      {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "customer.update",
        targetType: auditTarget,
        targetId: id,
        diff: { fields },
      },
      tx,
    );
    return ok({ id });
  });
}

/** 論理削除。予約の履歴から顧客をたどれるよう、行は消さない */
export async function deleteCustomer(
  ctx: OrgContext,
  id: string,
  now: Date,
): Promise<Result<{ id: string }>> {
  if (!canDeleteCustomer(ctx.role)) return fail("forbidden");
  return runInTransaction(async (tx) => {
    const deleted = await softDeleteCustomer(
      ctx.organizationId,
      id,
      now,
      tx,
    );
    if (!deleted) return fail("not_found");
    await createAuditLog(
      {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "customer.delete",
        targetType: auditTarget,
        targetId: id,
        diff: { deletedAt: now.toISOString() },
      },
      tx,
    );
    return ok({ id });
  });
}
