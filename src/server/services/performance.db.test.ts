/**
 * 第15章の性能改善のテスト（テスト用 DB を使う。npm run test:db）。
 *
 * - N+1 の回帰：前日リマインドのクエリ数は、予約の件数によらない
 * - SQL に寄せた検索・並べ替え・集計が、以前の Node での処理と同じ結果になる
 *
 * このファイルの DB はファイル専用の複製（test/db-per-file.ts）なので、
 * 作った行は消さない。作る予約はシードと時間が重ならないようにする。
 */
import { describe, expect, it } from "vitest";
import { addDays, toZonedYmd, zonedToUtc } from "@/lib/datetime";
import { getPrisma } from "@/server/db";
import { DEMO_USER_ID } from "@/server/demo-user";
import { insertJobs } from "@/server/repositories/jobs";
import { listCustomers } from "@/server/services/customers";
import {
  getDashboard,
  TREND_DAYS,
} from "@/server/services/dashboard";
import { scheduleReminders } from "@/server/services/job-handlers";
import {
  JOB_TYPES,
  reservationMailJob,
} from "@/server/services/jobs";
import {
  getOrgContext,
  type OrgContext,
} from "@/server/services/org-context";
import {
  getCalendar,
  getReservationFormOptions,
} from "@/server/services/reservations";
import { TEST_NOW } from "../../../test/db-fixture";
import { countQueries } from "../../../test/query-count";

const ORG_A = "org_a";
const TZ = "Asia/Tokyo";
const noDispatch = async () => {};

async function owner(): Promise<OrgContext> {
  const ctx = await getOrgContext("demo-salon", DEMO_USER_ID);
  if (!ctx) throw new Error("デモサロンに所属していない");
  return ctx;
}

/** 以前の Service と同じ並び（フリガナを localeCompare("ja")、同じなら ID） */
function byKanaThenId(
  a: { nameKana: string; id: string },
  b: { nameKana: string; id: string },
): number {
  return (
    a.nameKana.localeCompare(b.nameKana, "ja") ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

describe("前日リマインド（N+1 の回帰）", () => {
  it("明日の予約が増えても、クエリの数は変わらない", async () => {
    const before = await countQueries(() =>
      scheduleReminders(TEST_NOW, noDispatch),
    );
    const countBefore = await scheduleReminders(TEST_NOW, noDispatch);

    // 明日（2026-11-24 JST）の 19 時・20 時に、3 人のスタッフで 6 件足す
    // （シードの予約は 10〜18 時なので重ならない）
    const tomorrow = addDays(toZonedYmd(TEST_NOW, TZ), 1);
    await getPrisma().reservation.createMany({
      data: ["stf_a1", "stf_a2", "stf_a3"].flatMap((staff, i) =>
        [19, 20].map((hour) => ({
          id: `rsv_n1_${i}_${hour}`,
          organizationId: ORG_A,
          locationId: "loc_a1",
          staffProfileId: staff,
          customerId: "cus_a_001",
          serviceId: "svc_a1",
          startsAt: zonedToUtc(tomorrow, TZ, hour, 0),
          endsAt: zonedToUtc(tomorrow, TZ, hour + 1, 0),
          status: "confirmed" as const,
          priceYen: 4400,
        })),
      ),
    });

    const after = await countQueries(() =>
      scheduleReminders(TEST_NOW, noDispatch),
    );
    expect(await scheduleReminders(TEST_NOW, noDispatch)).toBe(
      countBefore + 6,
    );
    // 以前は予約 1 件ごとに 2 クエリ（作成と ID の取得）増えていた
    expect(after).toBe(before);
  });

  it("まとめて作ったジョブの ID は、渡した順で、既存のジョブはその ID を返す", async () => {
    const jobs = ["rsv_org_a_0001", "rsv_org_a_0002"].map((id) =>
      reservationMailJob(
        JOB_TYPES.reservationReminder,
        ORG_A,
        id,
        new Date("2027-01-01T00:00:00Z"),
      ),
    );
    const first = await insertJobs(jobs);
    const second = await insertJobs([...jobs].reverse());
    expect(second).toEqual([...first].reverse());
    expect(new Set(first).size).toBe(2);
    expect(await insertJobs([])).toEqual([]);
  });
});

describe("顧客一覧（SQL での検索・並べ替え・ページング）", () => {
  it("並びは以前の Node の並べ替え（localeCompare の ja）と同じ", async () => {
    // 濁点・半濁点で順が変わる組を足す（コードポイント順ではハ < バ < パ）
    await getPrisma().customer.createMany({
      data: ["ハナ", "バア", "パイ", "ヒロ", "タロウ", "ダイ"].map(
        (kana, i) => ({
          id: `cus_order_${i}`,
          organizationId: ORG_A,
          name: `並び ${kana}`,
          nameKana: kana,
          email: `order${i}@example.com`,
          phone: "090-0000-0000",
        }),
      ),
    });
    const ctx = await owner();
    const expected = (
      await getPrisma().customer.findMany({
        where: { organizationId: ORG_A, deletedAt: null },
        select: { id: true, nameKana: true },
      })
    )
      .sort(byKanaThenId)
      .map((c) => c.id);

    const actual: string[] = [];
    const first = await listCustomers(ctx, {});
    for (let page = 1; page <= first.pageCount; page++) {
      const list = await listCustomers(ctx, { page: String(page) });
      actual.push(...list.items.map((c) => c.id));
    }
    expect(actual).toEqual(expected);

    // 予約フォームの選択肢も同じ順
    const options = await getReservationFormOptions(ctx);
    expect(options.customers.map((c) => c.id)).toEqual(expected);
  });

  it("空白・大文字小文字・電話番号のハイフンを無視し、% と _ は文字として扱う", async () => {
    await getPrisma().customer.create({
      data: {
        id: "cus_search_1",
        organizationId: ORG_A,
        name: "大和 花子",
        nameKana: "ヤマト ハナコ",
        email: "Hana.Yamato@Example.COM",
        phone: "03-1234-5678",
      },
    });
    const ctx = await owner();
    const ids = async (q: string) =>
      (await listCustomers(ctx, { q })).items.map((c) => c.id);

    expect(await ids("ヤマトハナコ")).toContain("cus_search_1");
    expect(await ids("大和　花子")).toContain("cus_search_1");
    expect(await ids("hana.yamato@example.com")).toContain(
      "cus_search_1",
    );
    expect(await ids("0312345678")).toContain("cus_search_1");
    expect(await ids("03-1234")).toContain("cus_search_1");
    // LIKE のワイルドカードとして扱うと、% は全件に、_ は任意の 1 文字に
    // 一致してしまう（シードのメールには _ そのものが含まれる）
    expect((await listCustomers(ctx, { q: "%" })).total).toBe(0);
    expect(await ids("ヤ_ト")).not.toContain("cus_search_1");
  });

  it("範囲外のページは最後のページにし、件数も返す", async () => {
    const ctx = await owner();
    const first = await listCustomers(ctx, {});
    const last = await listCustomers(ctx, { page: "9999" });
    expect(last.query.page).toBe(first.pageCount);
    expect(last.total).toBe(first.total);
    expect(last.items.length).toBeGreaterThan(0);

    const none = await listCustomers(ctx, {
      q: "該当なし",
      page: "3",
    });
    expect(none).toMatchObject({
      total: 0,
      pageCount: 1,
      items: [],
      query: { page: 1 },
    });
  });
});

describe("ダッシュボード（DB での集計）", () => {
  it("今月の顧客数と日別の件数は、予約を読んで数えた値と一致する", async () => {
    const d = await getDashboard(await owner(), TEST_NOW);
    const prisma = getPrisma();

    const month = await prisma.reservation.findMany({
      where: {
        organizationId: ORG_A,
        status: { not: "cancelled" },
        startsAt: {
          gte: new Date("2026-10-31T15:00:00Z"),
          lt: new Date("2026-11-30T15:00:00Z"),
        },
      },
      select: { customerId: true },
    });
    expect(d.month.customerCount).toBe(
      new Set(month.map((r) => r.customerId)).size,
    );

    const trendFrom = addDays("2026-11-23", -(TREND_DAYS - 1));
    const recent = await prisma.reservation.findMany({
      where: {
        organizationId: ORG_A,
        status: { not: "cancelled" },
        startsAt: {
          gte: zonedToUtc(trendFrom, TZ),
          lt: zonedToUtc("2026-11-24", TZ),
        },
      },
      select: { startsAt: true },
    });
    const counts = new Map<string, number>();
    for (const r of recent) {
      const ymd = toZonedYmd(r.startsAt, TZ);
      counts.set(ymd, (counts.get(ymd) ?? 0) + 1);
    }
    expect(d.trend).toEqual(
      Array.from({ length: TREND_DAYS }, (_, i) => {
        const date = addDays(trendFrom, i);
        return { date, count: counts.get(date) ?? 0 };
      }),
    );
    expect(d.trend.some((t) => t.count > 0)).toBe(true);
  });

  it("論理削除した顧客の予約は、以前と同じく（不明）と表示する", async () => {
    const ctx = await owner();
    const [target] = (await getDashboard(ctx, TEST_NOW)).today;
    if (!target) throw new Error("シードに本日の予約がない");
    const reservation =
      await getPrisma().reservation.findFirstOrThrow({
        where: { id: target.id, organizationId: ORG_A },
      });
    await getPrisma().customer.updateMany({
      where: { id: reservation.customerId, organizationId: ORG_A },
      data: { deletedAt: TEST_NOW },
    });

    const today = (await getDashboard(ctx, TEST_NOW)).today;
    expect(today.find((r) => r.id === target.id)?.customerName).toBe(
      "（不明）",
    );
    const calendar = await getCalendar(
      ctx,
      { view: "day" },
      TEST_NOW,
    );
    expect(
      calendar.days[0]?.reservations.find((r) => r.id === target.id)
        ?.customerName,
    ).toBe("（不明）");
  });
});
