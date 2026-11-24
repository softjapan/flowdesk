import type { Role } from "@/server/domain";

export type NavItem = {
  key: string;
  label: string;
  /** `/[org]` からの相対パス。ダッシュボードは空文字 */
  segment: string;
  roles: readonly Role[];
};

const all = ["owner", "admin", "staff"] as const;
const ownerAdmin = ["owner", "admin"] as const;
const ownerOnly = ["owner"] as const;

/**
 * サイドバーの項目。roles は docs/screens.md の「権限」列に合わせる。
 * 表示を絞るのは使い勝手のためで、認可は各ページの Service 層で判定する。
 * 項目は、そのページを実装した章で足す（未実装のページへのリンクは
 * 先読みで 404 になり、コンソールにエラーが出るため）。
 */
export const navItems: readonly NavItem[] = [
  {
    key: "dashboard",
    label: "ダッシュボード",
    segment: "",
    roles: all,
  },
  {
    key: "reservations",
    label: "予約カレンダー",
    segment: "reservations",
    roles: all,
  },
  {
    key: "customers",
    label: "顧客一覧",
    segment: "customers",
    roles: all,
  },
  {
    key: "members",
    label: "メンバー管理",
    segment: "members",
    roles: ownerAdmin,
  },
  {
    key: "audit-logs",
    label: "監査ログ",
    segment: "audit-logs",
    roles: ownerAdmin,
  },
  {
    key: "billing",
    label: "料金プラン",
    segment: "billing",
    roles: ownerOnly,
  },
];

export function navItemsFor(role: Role): NavItem[] {
  return navItems.filter((item) => item.roles.includes(role));
}

export function navHref(slug: string, item: NavItem): string {
  return item.segment ? `/${slug}/${item.segment}` : `/${slug}`;
}

/** 現在のパスがその項目の配下か。ダッシュボードは完全一致のみ */
export function isActive(
  pathname: string,
  slug: string,
  item: NavItem,
): boolean {
  const href = navHref(slug, item);
  if (!item.segment) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
