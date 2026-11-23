import { describe, expect, it } from "vitest";
import { DEMO_USER_ID } from "@/server/demo-data";
import {
  CUSTOMER_PAGE_SIZE,
  listCustomers,
} from "@/server/services/customers";
import {
  getDashboard,
  TREND_DAYS,
} from "@/server/services/dashboard";
import {
  getOrgContext,
  type OrgContext,
} from "@/server/services/org-context";
import {
  getCalendar,
  parseCalendarQuery,
} from "@/server/services/reservations";

// 2026-11-23(月) 12:00 JST
const now = new Date("2026-11-23T03:00:00Z");

async function contextOf(slug: string): Promise<OrgContext> {
  const ctx = await getOrgContext(slug, DEMO_USER_ID);
  if (!ctx) throw new Error(`組織に所属していない: ${slug}`);
  return ctx;
}

describe("getOrgContext", () => {
  it("所属する組織はロール付きで返す", async () => {
    expect((await contextOf("demo-salon")).role).toBe("owner");
    expect((await contextOf("sakura-seitai")).role).toBe("staff");
  });

  it("所属しない組織と存在しない組織は区別せず null", async () => {
    expect(
      await getOrgContext("other-office", DEMO_USER_ID),
    ).toBeNull();
    expect(
      await getOrgContext("no-such-org", DEMO_USER_ID),
    ).toBeNull();
  });
});

describe("getDashboard", () => {
  it("Owner には売上を返す", async () => {
    const d = await getDashboard(await contextOf("demo-salon"), now);
    expect(d.todayYmd).toBe("2026-11-23");
    expect(d.month.reservationCount).toBeGreaterThan(0);
    expect(Number.isInteger(d.month.revenueYen)).toBe(true);
    expect(d.trend).toHaveLength(TREND_DAYS);
    expect(d.today.length).toBeGreaterThan(0);
  });

  it("Staff には売上を返さない", async () => {
    const d = await getDashboard(
      await contextOf("sakura-seitai"),
      now,
    );
    expect(d.month.revenueYen).toBeNull();
    expect(d.month.reservationCount).toBeGreaterThan(0);
  });

  it("デモデータの予約は複数の顧客に分かれる", async () => {
    for (const slug of ["demo-salon", "sakura-seitai"]) {
      const d = await getDashboard(await contextOf(slug), now);
      expect(d.month.customerCount).toBeGreaterThan(1);
    }
  });
});

describe("getCalendar", () => {
  it("不正なクエリは既定値に倒す", () => {
    expect(
      parseCalendarQuery(
        { view: "month", date: "2026-02-30", staff: "x' OR 1=1" },
        "2026-11-23",
      ),
    ).toEqual({ view: "week", date: "2026-11-23", staffId: null });
  });

  it("週表示は月曜から 7 日分", async () => {
    const c = await getCalendar(
      await contextOf("demo-salon"),
      { date: "2026-11-26" },
      now,
    );
    expect(c.days.map((d) => d.date)).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
  });

  it("スタッフで絞り込む", async () => {
    const c = await getCalendar(
      await contextOf("demo-salon"),
      { view: "week", staff: "stf_a2" },
      now,
    );
    const names = c.days.flatMap((d) =>
      d.reservations.map((r) => r.staffName),
    );
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names)).toEqual(new Set(["鈴木"]));
  });

  it("他の組織のスタッフ ID は絞り込みに使わない", async () => {
    const c = await getCalendar(
      await contextOf("demo-salon"),
      { staff: "stf_c0" },
      now,
    );
    expect(c.query.staffId).toBeNull();
    const names = c.days.flatMap((d) =>
      d.reservations.map((r) => r.staffName),
    );
    expect(names).not.toContain("伊藤");
  });
});

describe("listCustomers", () => {
  it("論理削除を除き、ページングする", async () => {
    const ctx = await contextOf("demo-salon");
    const first = await listCustomers(ctx, {});
    expect(first.total).toBe(32);
    expect(first.items).toHaveLength(CUSTOMER_PAGE_SIZE);
    expect(first.pageCount).toBe(4);

    const last = await listCustomers(ctx, { page: "99" });
    expect(last.query.page).toBe(4);
    expect(last.items).toHaveLength(2);
  });

  it("フリガナ・電話番号（ハイフンなし）で検索する", async () => {
    const ctx = await contextOf("demo-salon");
    const byKana = await listCustomers(ctx, { q: "ヤマダ" });
    expect(byKana.total).toBeGreaterThan(0);
    expect(
      byKana.items.every((c) => c.nameKana.startsWith("ヤマダ")),
    ).toBe(true);

    const target = byKana.items[0]!;
    const byPhone = await listCustomers(ctx, {
      q: target.phone.replace(/-/g, ""),
    });
    expect(byPhone.items.map((c) => c.id)).toContain(target.id);
  });

  it("他の組織の顧客は検索に出ない", async () => {
    const result = await listCustomers(
      await contextOf("demo-salon"),
      {
        q: "cus_c",
      },
    );
    expect(result.total).toBe(0);
  });
});
