import { describe, expect, it } from "vitest";
import { isActive, navItems, navItemsFor } from "./nav-items";

const keysFor = (role: "owner" | "admin" | "staff") =>
  navItemsFor(role).map((item) => item.key);

describe("navItemsFor（docs/screens.md の権限列）", () => {
  it("Owner・Admin には、メンバー管理と監査ログも出す", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(keysFor(role)).toEqual([
        "dashboard",
        "reservations",
        "customers",
        "members",
        "audit-logs",
      ]);
    }
  });

  it("Staff には全ロール向けの 3 画面だけを出す", () => {
    expect(keysFor("staff")).toEqual([
      "dashboard",
      "reservations",
      "customers",
    ]);
  });
});

describe("isActive", () => {
  const byKey = (key: string) => {
    const item = navItems.find((i) => i.key === key);
    if (!item) throw new Error(`項目がない: ${key}`);
    return item;
  };
  const dashboard = byKey("dashboard");
  const customers = byKey("customers");

  it("ダッシュボードは完全一致のときだけ現在地にする", () => {
    expect(isActive("/demo-salon", "demo-salon", dashboard)).toBe(
      true,
    );
    expect(
      isActive("/demo-salon/customers", "demo-salon", dashboard),
    ).toBe(false);
  });

  it("配下のページでも現在地にする", () => {
    expect(
      isActive("/demo-salon/customers/new", "demo-salon", customers),
    ).toBe(true);
    expect(
      isActive("/demo-salon/customers-x", "demo-salon", customers),
    ).toBe(false);
  });
});
