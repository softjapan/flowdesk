/**
 * Service 層のテスト（テスト用 DB を使う。npm run test:db）。
 * データは prisma/seed-data.ts を TEST_NOW 基準で入れたもの。
 */
import { describe, expect, it } from "vitest";
import { getPrisma } from "@/server/db";
import { DEMO_USER_ID } from "@/server/demo-user";
import {
  CUSTOMER_PAGE_SIZE,
  listCustomers,
} from "@/server/services/customers";
import {
  getDashboard,
  TREND_DAYS,
} from "@/server/services/dashboard";
import {
  findHomeOrgSlug,
  getOrgContext,
  type OrgContext,
} from "@/server/services/org-context";
import {
  getCalendar,
  getReservationFormOptions,
} from "@/server/services/reservations";
import { TEST_NOW } from "../../../test/db-fixture";

const now = TEST_NOW;

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

describe("findHomeOrgSlug", () => {
  it("最初に所属した組織のスラッグを返す", async () => {
    expect(await findHomeOrgSlug(DEMO_USER_ID)).toBe("demo-salon");
  });

  it("どの組織にも所属していなければ null", async () => {
    expect(await findHomeOrgSlug("no-such-user")).toBeNull();
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

  it("今月の予約数と売上は、キャンセルを除いた予約の件数と料金の合計", async () => {
    const d = await getDashboard(await contextOf("demo-salon"), now);
    // 2026 年 11 月（JST）を UTC で表した範囲。Service とは別に DB で数える
    const where = {
      organizationId: "org_a",
      startsAt: {
        gte: new Date("2026-10-31T15:00:00Z"),
        lt: new Date("2026-11-30T15:00:00Z"),
      },
    };
    const prisma = getPrisma();
    const [active, cancelled] = await Promise.all([
      prisma.reservation.aggregate({
        where: { ...where, status: { not: "cancelled" } },
        _count: true,
        _sum: { priceYen: true },
      }),
      prisma.reservation.count({
        where: { ...where, status: "cancelled" },
      }),
    ]);
    // シードには今月のキャンセルが含まれる（除外を確かめられる）
    expect(cancelled).toBeGreaterThan(0);
    expect(d.month.reservationCount).toBe(active._count);
    expect(d.month.revenueYen).toBe(active._sum.priceYen);
  });

  it("シードの予約は複数の顧客に分かれる", async () => {
    for (const slug of ["demo-salon", "sakura-seitai"]) {
      const d = await getDashboard(await contextOf(slug), now);
      expect(d.month.customerCount).toBeGreaterThan(1);
    }
  });
});

describe("getCalendar", () => {
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

describe("getReservationFormOptions", () => {
  it("Owner には全スタッフ、Staff には自分だけを選択肢に出す", async () => {
    const forOwner = await getReservationFormOptions(
      await contextOf("demo-salon"),
    );
    expect(forOwner.staff.map((s) => s.id)).toEqual([
      "stf_a1",
      "stf_a2",
      "stf_a3",
    ]);
    // さくら整体院ではデモユーザーは Staff（stf_b1 の田中）
    const forStaff = await getReservationFormOptions(
      await contextOf("sakura-seitai"),
    );
    expect(forStaff.staff).toEqual([{ id: "stf_b1", label: "田中" }]);
  });

  it("顧客は論理削除を除き、他の組織の顧客・メニュー・店舗は出さない", async () => {
    const options = await getReservationFormOptions(
      await contextOf("demo-salon"),
    );
    const ids = [
      ...options.customers,
      ...options.services,
      ...options.locations,
    ].map((o) => o.id);
    expect(options.customers).toHaveLength(32);
    expect(ids).not.toContain("cus_a_033");
    expect(ids.filter((id) => /_[bc](_|\d)/.test(id))).toEqual([]);
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

  it("Staff も検索できる（閲覧・検索は全ロール）", async () => {
    const result = await listCustomers(
      await contextOf("sakura-seitai"),
      {},
    );
    expect(result.total).toBe(7);
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
