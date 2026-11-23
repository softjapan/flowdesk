/** DB を使わない Service のテスト。DB を使うものは services.db.test.ts */
import { describe, expect, it } from "vitest";
import { parseCustomerListQuery } from "@/server/services/customers";
import { parseCalendarQuery } from "@/server/services/reservations";

describe("parseCalendarQuery", () => {
  it("不正なクエリは既定値に倒す", () => {
    expect(
      parseCalendarQuery(
        { view: "month", date: "2026-02-30", staff: "x' OR 1=1" },
        "2026-11-23",
      ),
    ).toEqual({ view: "week", date: "2026-11-23", staffId: null });
  });
});

describe("parseCustomerListQuery", () => {
  it("検索語は前後の空白を除いて 100 文字まで、ページは 1 以上", () => {
    expect(
      parseCustomerListQuery({
        q: `  ${"あ".repeat(120)} `,
        page: "0",
      }),
    ).toEqual({ q: "あ".repeat(100), page: 1 });
  });
});
