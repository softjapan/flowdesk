import { demoDb } from "@/server/demo-data";
import type { OrgContext } from "@/server/services/org-context";
import {
  firstValue,
  positiveInt,
  type SearchParams,
} from "@/server/services/search-params";

export const CUSTOMER_PAGE_SIZE = 10;
const MAX_QUERY_LENGTH = 100;

export type CustomerListQuery = { q: string; page: number };

export function parseCustomerListQuery(
  params: SearchParams,
): CustomerListQuery {
  const q = (firstValue(params, "q") ?? "")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
  return { q, page: positiveInt(firstValue(params, "page"), 1) };
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
  const all = await demoDb.listCustomers(ctx.organizationId);
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
