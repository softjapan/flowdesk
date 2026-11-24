/** DB を使わない Service のテスト。DB を使うものは services.db.test.ts */
import { describe, expect, it } from "vitest";
import { isReservationOverlapError } from "@/server/repositories/reservations";
import { roles, toRole } from "@/server/access-control";
import { describeAuditDiff } from "@/server/services/audit-logs";
import {
  can,
  canChangeRole,
  canDeleteCustomer,
  canInvite,
  canManageReservation,
  canRemoveMember,
  canViewAuditLogs,
  canViewRevenue,
  changeableRoles,
  invitableRoles,
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

describe("ロールの定義（src/server/access-control.ts）", () => {
  it("owner・admin・staff だけを定義し、既定の member は使わない", () => {
    expect(Object.keys(roles).sort()).toEqual([
      "admin",
      "owner",
      "staff",
    ]);
    expect(toRole("member")).toBeNull();
    expect(toRole("admin,staff")).toBeNull();
    expect(toRole(null)).toBeNull();
    expect(toRole("staff")).toBe("staff");
  });

  it("組織の削除と料金プランの変更は Owner だけ", () => {
    expect(can("owner", { organization: ["delete"] })).toBe(true);
    expect(can("admin", { organization: ["delete"] })).toBe(false);
    expect(can("admin", { organization: ["update"] })).toBe(true);
    expect(can("staff", { organization: ["update"] })).toBe(false);
    expect(can("owner", { billing: ["update"] })).toBe(true);
    expect(can("admin", { billing: ["update"] })).toBe(false);
    expect(can("admin", { billing: ["read"] })).toBe(true);
    expect(can("staff", { billing: ["read"] })).toBe(false);
  });

  it("CSV エクスポート・監査ログ・売上は Staff に許さない", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(can(role, { customer: ["export"] })).toBe(true);
      expect(canViewAuditLogs(role)).toBe(true);
      expect(canViewRevenue(role)).toBe(true);
    }
    expect(can("staff", { customer: ["export"] })).toBe(false);
    expect(canViewAuditLogs("staff")).toBe(false);
    expect(canViewRevenue("staff")).toBe(false);
    // 顧客の閲覧・作成・編集は Staff も可
    expect(
      can("staff", { customer: ["read", "create", "update"] }),
    ).toBe(true);
  });
});

describe("メンバーの権限（docs/authz-matrix.md）", () => {
  it("ケース 3：Admin は自分も他の人も Owner に昇格できない", () => {
    expect(canChangeRole("admin", "admin", "owner")).toBe(false);
    expect(canChangeRole("admin", "staff", "owner")).toBe(false);
    expect(changeableRoles("admin", "admin")).toEqual([
      "admin",
      "staff",
    ]);
    expect(changeableRoles("admin", "owner")).toEqual([]);
  });

  it("Admin は Staff⇔Admin のみ、Owner は何でも変更できる", () => {
    expect(canChangeRole("admin", "staff", "admin")).toBe(true);
    expect(canChangeRole("admin", "admin", "staff")).toBe(true);
    expect(canChangeRole("admin", "owner", "admin")).toBe(false);
    expect(canChangeRole("owner", "staff", "owner")).toBe(true);
    expect(canChangeRole("owner", "owner", "staff")).toBe(true);
    expect(canChangeRole("staff", "staff", "admin")).toBe(false);
  });

  it("削除は Owner は誰でも、Admin は Staff のみ", () => {
    expect(canRemoveMember("owner", "owner")).toBe(true);
    expect(canRemoveMember("admin", "staff")).toBe(true);
    expect(canRemoveMember("admin", "admin")).toBe(false);
    expect(canRemoveMember("admin", "owner")).toBe(false);
    expect(canRemoveMember("staff", "staff")).toBe(false);
  });

  it("招待は Owner・Admin。Admin は Owner を招待できない", () => {
    expect(invitableRoles("owner")).toEqual([
      "owner",
      "admin",
      "staff",
    ]);
    expect(invitableRoles("admin")).toEqual(["admin", "staff"]);
    expect(invitableRoles("staff")).toEqual([]);
    expect(canInvite("admin", "owner")).toBe(false);
  });
});

describe("describeAuditDiff", () => {
  const names = new Map([["user_a2", "鈴木 次郎"]]);

  it("ロール変更は「誰の・何から何へ」", () => {
    expect(
      describeAuditDiff(
        "member.update_role",
        { userId: "user_a2", from: "staff", to: "admin" },
        names,
      ),
    ).toBe("鈴木 次郎：Staff → Admin");
  });

  it("顧客の変更は項目名、形の分からない diff はキーを並べる", () => {
    expect(
      describeAuditDiff(
        "customer.update",
        { fields: ["email", "phone"] },
        names,
      ),
    ).toBe("項目：email, phone");
    expect(
      describeAuditDiff(
        "reservation.update",
        { startsAt: {} },
        names,
      ),
    ).toBe("startsAt");
    expect(describeAuditDiff("x", null, names)).toBe("");
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
