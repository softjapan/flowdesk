import { describe, expect, it } from "vitest";
import { isActive, navItems, navItemsFor } from "./nav-items";

const keysFor = (role: "owner" | "admin" | "staff") =>
  navItemsFor(role).map((item) => item.key);

describe("navItemsFor（docs/screens.md の権限列）", () => {
  it("実装済みの 3 画面は全ロールに出す", () => {
    for (const role of ["owner", "admin", "staff"] as const) {
      expect(keysFor(role)).toEqual([
        "dashboard",
        "reservations",
        "customers",
      ]);
    }
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
