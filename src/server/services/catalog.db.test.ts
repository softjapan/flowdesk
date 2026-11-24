/**
 * 店舗の管理（F-05、S-12）とメニューの管理（F-06、S-11）。
 * 権限は docs/authz-matrix.md（閲覧は全ロール、作成・編集・削除は
 * Owner・Admin）、店舗の数はプランの上限（F-15、Free は 1 つまで）に従う。
 *
 * このファイル専用の DB（test/db-per-file.ts）を使う。作る予約は
 * シードの範囲外（2027 年）に置く。
 */
import { describe, expect, it } from "vitest";
import { getPrisma } from "@/server/db";
import { DEMO_USER_ID } from "@/server/demo-user";
import {
  createLocation,
  deleteLocation,
  getLocationsPage,
  updateLocation,
} from "@/server/services/locations";
import {
  createMenu,
  deleteMenu,
  getMenusPage,
  updateMenu,
} from "@/server/services/menus";
import {
  getOrgContext,
  type OrgContext,
} from "@/server/services/org-context";
import {
  createReservation,
  getReservationFormOptions,
} from "@/server/services/reservations";
import type { ReservationInput } from "@/server/validation/reservation";

const ORG_A = "org_a";

async function contextOf(
  slug: string,
  userId: string,
): Promise<OrgContext> {
  const ctx = await getOrgContext(slug, userId);
  if (!ctx)
    throw new Error(`組織に所属していない: ${slug} ${userId}`);
  return ctx;
}

// demo-salon（org_a、Free、店舗は渋谷店 loc_a1 だけ）：Owner＝デモユーザー、
// Admin＝user_a1、Staff＝user_a2。other-office（org_c）の店舗は loc_c1
const owner = () => contextOf("demo-salon", DEMO_USER_ID);
const admin = () => contextOf("demo-salon", "user_a1");
const staff = () => contextOf("demo-salon", "user_a2");

async function auditLogs(action: string, targetId: string) {
  return getPrisma().auditLog.findMany({
    where: { organizationId: ORG_A, action, targetId },
  });
}

async function setPlan(plan: "free" | "pro") {
  const prisma = getPrisma();
  if (plan === "free") {
    await prisma.subscription.deleteMany({
      where: { organizationId: ORG_A },
    });
    return;
  }
  await prisma.subscription.upsert({
    where: { organizationId: ORG_A },
    create: { organizationId: ORG_A, plan: "pro", status: "active" },
    update: { plan: "pro", status: "active" },
  });
}

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; reason: string },
): T {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

const reservation: ReservationInput = {
  customerId: "cus_a_001",
  serviceId: "svc_a1",
  staffProfileId: "stf_a1",
  locationId: "loc_a1",
  date: "2027-07-01",
  time: "10:00",
  status: "confirmed",
};

describe("店舗の管理（F-05、S-12）", () => {
  it("全ロールが一覧を見られるが、編集できるのは Owner・Admin だけ", async () => {
    const forStaff = await getLocationsPage(await staff());
    expect(forStaff.locations).toEqual([
      { id: "loc_a1", name: "渋谷店", timezone: "Asia/Tokyo" },
    ]);
    expect(forStaff.canManage).toBe(false);
    // プランの使用状況は Owner・Admin だけに見せる（料金プランの閲覧と同じ）
    expect(forStaff.planUsage).toBeNull();

    const forAdmin = await getLocationsPage(await admin());
    expect(forAdmin.canManage).toBe(true);
    expect(forAdmin.planUsage).toMatchObject({
      plan: "free",
      locations: 1,
      maxLocations: 1,
    });
  });

  it("Admin は名前を変更でき、変わった項目名だけを監査ログに残す", async () => {
    const result = await updateLocation(await admin(), "loc_a1", {
      name: "渋谷本店",
      timezone: "Asia/Tokyo",
    });
    expect(result).toEqual({ ok: true, value: { id: "loc_a1" } });
    expect(
      await getPrisma().location.findFirst({
        where: { id: "loc_a1", organizationId: ORG_A },
      }),
    ).toMatchObject({ name: "渋谷本店" });
    const [log] = await auditLogs("location.update", "loc_a1");
    expect(log?.diff).toEqual({ fields: ["name"] });
  });

  it("Staff は作成・変更・削除できない（forbidden）。行は変わらない", async () => {
    const ctx = await staff();
    const before = await getPrisma().location.findMany({
      where: { organizationId: ORG_A },
    });
    expect(
      await createLocation(ctx, {
        name: "新宿店",
        timezone: "Asia/Tokyo",
      }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(
      await updateLocation(ctx, "loc_a1", {
        name: "勝手に変更",
        timezone: "Asia/Tokyo",
      }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(await deleteLocation(ctx, "loc_a1")).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(
      await getPrisma().location.findMany({
        where: { organizationId: ORG_A },
      }),
    ).toEqual(before);
  });

  it("他の組織の店舗 ID は変更・削除とも not_found（存在を漏らさない）", async () => {
    const ctx = await owner();
    expect(
      await updateLocation(ctx, "loc_c1", {
        name: "乗っ取り",
        timezone: "Asia/Tokyo",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await deleteLocation(ctx, "loc_c1")).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(
      await updateLocation(ctx, "no-such", {
        name: "x",
        timezone: "Asia/Tokyo",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await getPrisma().location.findFirst({
        where: { id: "loc_c1", organizationId: "org_c" },
      }),
    ).toMatchObject({ name: "本所" });
    // 他の組織の店舗は一覧にも出ない
    const page = await getLocationsPage(ctx);
    expect(page.locations.map((l) => l.id)).not.toContain("loc_c1");
  });

  it("予約のある店舗は削除できない（in_use）", async () => {
    expect(await deleteLocation(await owner(), "loc_a1")).toEqual({
      ok: false,
      reason: "in_use",
    });
    expect(
      await getPrisma().location.count({
        where: { id: "loc_a1", organizationId: ORG_A },
      }),
    ).toBe(1);
  });

  it("予約は店舗のタイムゾーンの時刻で受け付ける（店舗を足したときも）", async () => {
    await setPlan("pro");
    try {
      const ctx = await owner();
      const { id } = unwrap(
        await createLocation(ctx, {
          name: "ニューヨーク店",
          timezone: "America/New_York",
        }),
      );
      const created = unwrap(
        await createReservation(ctx, {
          ...reservation,
          locationId: id,
        }),
      );
      // 2027-07-01 は夏時間（UTC-4）
      expect(
        await getPrisma().reservation.findFirst({
          where: { id: created.id, organizationId: ORG_A },
        }),
      ).toMatchObject({
        startsAt: new Date("2027-07-01T14:00:00Z"),
      });
      // 予約ができたので、この店舗も削除できない
      expect(await deleteLocation(ctx, id)).toEqual({
        ok: false,
        reason: "in_use",
      });
    } finally {
      await setPlan("free");
    }
  });

  it("Free に戻っても、上限を超えた店舗は変更・削除できる。追加だけできない", async () => {
    await setPlan("pro");
    const ctx = await admin();
    const { id } = unwrap(
      await createLocation(ctx, {
        name: "新宿店",
        timezone: "Asia/Tokyo",
      }),
    );
    await setPlan("free");

    expect(
      await createLocation(ctx, {
        name: "池袋店",
        timezone: "Asia/Tokyo",
      }),
    ).toEqual({ ok: false, reason: "plan_limit" });
    expect(
      (
        await updateLocation(ctx, id, {
          name: "新宿南口店",
          timezone: "Asia/Tokyo",
        })
      ).ok,
    ).toBe(true);
    expect(await deleteLocation(ctx, id)).toEqual({
      ok: true,
      value: { id },
    });
    expect(
      await getPrisma().location.count({
        where: { id, organizationId: ORG_A },
      }),
    ).toBe(0);
    const [log] = await auditLogs("location.delete", id);
    expect(log).toMatchObject({ actorUserId: "user_a1" });
    expect(log?.diff).toEqual({ name: "新宿南口店" });
  });
});

describe("メニューの管理（F-06、S-11）", () => {
  const menu = {
    name: "ヘッドスパ",
    durationMinutes: 45,
    priceYen: 5500,
  };
  let day = 1;
  const nextDate = () => `2027-08-${String(day++).padStart(2, "0")}`;

  it("全ロールが一覧を見られるが、編集できるのは Owner・Admin だけ", async () => {
    const forStaff = await getMenusPage(await staff());
    expect(forStaff.menus.slice(0, 3)).toEqual([
      {
        id: "svc_a1",
        name: "カット",
        durationMinutes: 60,
        priceYen: 4400,
      },
      {
        id: "svc_a2",
        name: "カラー",
        durationMinutes: 90,
        priceYen: 8800,
      },
      {
        id: "svc_a3",
        name: "パーマ",
        durationMinutes: 120,
        priceYen: 11000,
      },
    ]);
    expect(forStaff.canManage).toBe(false);
    expect((await getMenusPage(await admin())).canManage).toBe(true);
    // 他の組織のメニューは出ない
    expect(
      forStaff.menus.every((m) => m.id.startsWith("svc_a")),
    ).toBe(true);
  });

  it("Admin が作ったメニューは予約の選択肢に出て、監査ログに残る", async () => {
    const ctx = await admin();
    const { id } = unwrap(await createMenu(ctx, menu));
    const options = await getReservationFormOptions(ctx);
    expect(options.services).toContainEqual({
      id,
      label: "ヘッドスパ（45 分）",
    });
    const [log] = await auditLogs("service.create", id);
    expect(log?.diff).toEqual(menu);
  });

  it("Staff は作成・変更・削除できない（forbidden）。行は変わらない", async () => {
    const ctx = await staff();
    expect(await createMenu(ctx, menu)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(
      await updateMenu(ctx, "svc_a1", { ...menu, priceYen: 1 }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(await deleteMenu(ctx, "svc_a1")).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(
      await getPrisma().service.findFirst({
        where: { id: "svc_a1", organizationId: ORG_A },
      }),
    ).toMatchObject({ priceYen: 4400 });
  });

  it("料金・所要時間を変えても、作成済みの予約は変わらない。新しい予約は新しい値", async () => {
    const ctx = await owner();
    const { id } = unwrap(
      await createMenu(ctx, {
        name: "眉カット",
        durationMinutes: 30,
        priceYen: 3000,
      }),
    );
    const date = nextDate();
    const before = unwrap(
      await createReservation(ctx, {
        ...reservation,
        serviceId: id,
        date,
        time: "10:00",
      }),
    );
    expect(
      await updateMenu(ctx, id, {
        name: "眉カット",
        durationMinutes: 45,
        priceYen: 3500,
      }),
    ).toEqual({ ok: true, value: { id } });
    const after = unwrap(
      await createReservation(ctx, {
        ...reservation,
        serviceId: id,
        date,
        time: "11:00",
      }),
    );

    const rows = await getPrisma().reservation.findMany({
      where: {
        organizationId: ORG_A,
        id: { in: [before.id, after.id] },
      },
      orderBy: { startsAt: "asc" },
    });
    expect(rows.map((r) => r.priceYen)).toEqual([3000, 3500]);
    expect(rows[0]?.endsAt).toEqual(new Date(`${date}T01:30:00Z`));
    expect(rows[1]?.endsAt).toEqual(new Date(`${date}T02:45:00Z`));
    const [log] = await auditLogs("service.update", id);
    expect(log?.diff).toEqual({
      fields: ["durationMinutes", "priceYen"],
    });
  });

  it("予約で使われているメニューは削除できない（in_use）", async () => {
    expect(await deleteMenu(await owner(), "svc_a1")).toEqual({
      ok: false,
      reason: "in_use",
    });
  });

  it("使われていないメニューは削除でき、予約の選択肢から消える", async () => {
    const ctx = await owner();
    const { id } = unwrap(
      await createMenu(ctx, { ...menu, name: "期間限定" }),
    );
    expect(await deleteMenu(ctx, id)).toEqual({
      ok: true,
      value: { id },
    });
    const options = await getReservationFormOptions(ctx);
    expect(options.services.map((s) => s.id)).not.toContain(id);
    expect(await auditLogs("service.delete", id)).toHaveLength(1);
    // 消したメニューでは予約できない
    expect(
      await createReservation(ctx, {
        ...reservation,
        serviceId: id,
        date: nextDate(),
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("他の組織のメニュー ID は変更・削除とも not_found（存在を漏らさない）", async () => {
    const ctx = await owner();
    expect(await updateMenu(ctx, "svc_c1", menu)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await deleteMenu(ctx, "svc_c1")).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(
      await getPrisma().service.findFirst({
        where: { id: "svc_c1", organizationId: "org_c" },
      }),
    ).toMatchObject({ name: "相談 50 分", priceYen: 5500 });
  });
});
