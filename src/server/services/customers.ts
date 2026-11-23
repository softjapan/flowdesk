import { runInTransaction } from "@/server/db";
import { createAuditLog } from "@/server/repositories/audit-logs";
import {
  createCustomer as createCustomerRow,
  findCustomer,
  listCustomers as listCustomerRows,
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

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** 氏名・フリガナ・メール・電話番号（ハイフンの有無を問わない）で検索 */
function matches(c: CustomerListItem, q: string): boolean {
  const needle = q.toLowerCase();
  const fields = [c.name, c.nameKana, c.email].map((v) =>
    v.toLowerCase().replace(/\s/g, ""),
  );
  if (fields.some((v) => v.includes(needle.replace(/\s/g, "")))) {
    return true;
  }
  const digits = digitsOnly(q);
  return digits.length > 0 && digitsOnly(c.phone).includes(digits);
}

export async function listCustomers(
  ctx: OrgContext,
  params: SearchParams,
): Promise<CustomerList> {
  const parsed = parseCustomerListQuery(params);
  const all = await listCustomerRows(ctx.organizationId);
  const filtered = all
    .map(({ id, name, nameKana, email, phone }) => ({
      id,
      name,
      nameKana,
      email,
      phone,
    }))
    .filter((c) => parsed.q === "" || matches(c, parsed.q))
    .sort(
      (a, b) =>
        a.nameKana.localeCompare(b.nameKana, "ja") ||
        a.id.localeCompare(b.id),
    );

  const pageCount = Math.max(
    1,
    Math.ceil(filtered.length / CUSTOMER_PAGE_SIZE),
  );
  const page = Math.min(parsed.page, pageCount);
  const start = (page - 1) * CUSTOMER_PAGE_SIZE;
  return {
    query: { q: parsed.q, page },
    items: filtered.slice(start, start + CUSTOMER_PAGE_SIZE),
    total: filtered.length,
    pageCount,
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
