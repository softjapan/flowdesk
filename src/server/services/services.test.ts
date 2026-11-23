/** DB を使わない Service のテスト。DB を使うものは services.db.test.ts */
import { describe, expect, it } from "vitest";
import { isReservationOverlapError } from "@/server/repositories/reservations";
import {
  canDeleteCustomer,
  canManageReservation,
} from "@/server/services/authz";
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

  it("正しいクエリはそのまま使い、同じキーが複数なら最初の値", () => {
    expect(
      parseCalendarQuery(
        {
          view: ["day", "week"],
          date: "2026-12-01",
          staff: "stf_a2",
        },
        "2026-11-23",
      ),
    ).toEqual({ view: "day", date: "2026-12-01", staffId: "stf_a2" });
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

  it("指定がなければ空の検索語と 1 ページ目", () => {
    expect(parseCustomerListQuery({})).toEqual({ q: "", page: 1 });
    expect(
      parseCustomerListQuery({ q: ["ヤマダ", "x"], page: "3" }),
    ).toEqual({ q: "ヤマダ", page: 3 });
  });
});

describe("authz（docs/authz-matrix.md）", () => {
  it("顧客の削除は Owner・Admin のみ", () => {
    expect(canDeleteCustomer("owner")).toBe(true);
    expect(canDeleteCustomer("admin")).toBe(true);
    expect(canDeleteCustomer("staff")).toBe(false);
  });

  it("予約は Owner・Admin は誰の担当でも、Staff は自分の担当のみ", () => {
    expect(canManageReservation("owner", "stf_1", null)).toBe(true);
    expect(canManageReservation("admin", "stf_1", null)).toBe(true);
    expect(canManageReservation("staff", "stf_1", "stf_1")).toBe(
      true,
    );
    expect(canManageReservation("staff", "stf_2", "stf_1")).toBe(
      false,
    );
    // スタッフ情報のない Staff は何も操作できない
    expect(canManageReservation("staff", "stf_1", null)).toBe(false);
  });
});

describe("isReservationOverlapError", () => {
  const prismaError = (
    originalCode: string,
    originalMessage: string,
  ) => ({
    code: "P2039",
    meta: {
      driverAdapterError: {
        cause: { originalCode, originalMessage },
      },
    },
  });

  it("排他制約 reservation_no_overlap の違反だけを true にする", () => {
    expect(
      isReservationOverlapError(
        prismaError(
          "23P01",
          'conflicting key value violates exclusion constraint "reservation_no_overlap"',
        ),
      ),
    ).toBe(true);
    expect(
      isReservationOverlapError(
        prismaError("23505", "duplicate key value"),
      ),
    ).toBe(false);
    expect(isReservationOverlapError(new Error("x"))).toBe(false);
    expect(isReservationOverlapError(undefined)).toBe(false);
  });
});
