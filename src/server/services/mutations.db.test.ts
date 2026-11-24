/**
 * 更新系の Service のテスト（F-07・F-08・F-09、docs/authz-matrix.md の
 * 「テストで必ず確認するケース」1・2）。テスト用 DB を使う（npm run test:db）。
 *
 * このファイル専用の DB（test/db-per-file.ts）を使う。同じファイルの
 * 中のテストは順に実行されるので、作った行は消し、変えた行は戻す。
 * 作る予約はシードの範囲外（2027 年）に置く。
 */
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "@/server/db";
import { DEMO_USER_ID } from "@/server/demo-user";
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  updateCustomer,
} from "@/server/services/customers";
import { checkHealth } from "@/server/services/health";
import {
  getOrgContext,
  type OrgContext,
} from "@/server/services/org-context";
import {
  cancelReservation,
  createReservation,
  getReservation,
  updateReservation,
} from "@/server/services/reservations";
import type { CustomerInput } from "@/server/validation/customer";
import type { ReservationInput } from "@/server/validation/reservation";
import { TEST_NOW } from "../../../test/db-fixture";

const ORG_A = "org_a";
const startedAt = new Date();
const createdCustomers: string[] = [];
const createdReservations: string[] = [];

async function contextOf(
  slug: string,
  userId: string,
): Promise<OrgContext> {
  const ctx = await getOrgContext(slug, userId);
  if (!ctx)
    throw new Error(`組織に所属していない: ${slug} ${userId}`);
  return ctx;
}

// demo-salon（org_a）：Owner＝デモユーザー、Admin＝user_a1（stf_a1）、
// Staff＝user_a2（stf_a2）・user_a3（stf_a3）。other-office（org_c）の Owner＝user_c0
const owner = () => contextOf("demo-salon", DEMO_USER_ID);
const admin = () => contextOf("demo-salon", "user_a1");
const staff = () => contextOf("demo-salon", "user_a2");
const otherOrgOwner = () => contextOf("other-office", "user_c0");

afterAll(async () => {
  const prisma = getPrisma();
  await prisma.reservation.deleteMany({
    where: { id: { in: createdReservations } },
  });
  await prisma.customer.deleteMany({
    where: { id: { in: createdCustomers } },
  });
  await prisma.auditLog.deleteMany({
    where: { createdAt: { gte: startedAt } },
  });
});

const customerInput: CustomerInput = {
  name: "テスト 太郎",
  nameKana: "テスト タロウ",
  phone: "090-0000-0001",
  email: "",
  note: "",
};

async function newCustomer(): Promise<string> {
  const result = await createCustomer(await owner(), customerInput);
  if (!result.ok) throw new Error(result.reason);
  createdCustomers.push(result.value.id);
  return result.value.id;
}

describe("顧客（F-07）", () => {
  it("Staff も登録でき、監査ログが同じトランザクションで残る", async () => {
    const result = await createCustomer(await staff(), customerInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdCustomers.push(result.value.id);

    const row = await getPrisma().customer.findFirst({
      where: { id: result.value.id, organizationId: ORG_A },
    });
    expect(row).toMatchObject({ name: "テスト 太郎", email: "" });
    expect(
      await getPrisma().auditLog.count({
        where: {
          organizationId: ORG_A,
          action: "customer.create",
          targetId: result.value.id,
        },
      }),
    ).toBe(1);
  });

  it("編集できる。監査ログには変わった項目名だけを残す", async () => {
    const id = await newCustomer();
    const result = await updateCustomer(await staff(), id, {
      ...customerInput,
      email: "taro@example.com",
    });
    expect(result.ok).toBe(true);
    const log = await getPrisma().auditLog.findFirst({
      where: {
        organizationId: ORG_A,
        action: "customer.update",
        targetId: id,
      },
    });
    expect(log?.diff).toEqual({ fields: ["email"] });
  });

  it("他の組織の顧客 ID は編集・削除・取得とも not_found（存在を漏らさない）", async () => {
    const ctx = await owner();
    expect(
      await updateCustomer(ctx, "cus_c_001", customerInput),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await deleteCustomer(ctx, "cus_c_001", TEST_NOW)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await getCustomer(ctx, "cus_c_001")).toBeNull();
    // 他の組織の顧客は書き換わっていない
    const row = await getPrisma().customer.findFirst({
      where: { id: "cus_c_001", organizationId: "org_c" },
    });
    expect(row?.name).not.toBe(customerInput.name);
    expect(row?.deletedAt).toBeNull();
  });

  it("Staff は削除できない（forbidden）", async () => {
    const id = await newCustomer();
    expect(await deleteCustomer(await staff(), id, TEST_NOW)).toEqual(
      { ok: false, reason: "forbidden" },
    );
    expect(await getCustomer(await owner(), id)).not.toBeNull();
  });

  it("Admin は論理削除でき、削除後は見つからない", async () => {
    const id = await newCustomer();
    expect(
      (await deleteCustomer(await admin(), id, TEST_NOW)).ok,
    ).toBe(true);
    const ctx = await owner();
    expect(await getCustomer(ctx, id)).toBeNull();
    expect(await updateCustomer(ctx, id, customerInput)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await deleteCustomer(ctx, id, TEST_NOW)).toEqual({
      ok: false,
      reason: "not_found",
    });
    // 行は残る（論理削除）
    const row = await getPrisma().customer.findFirst({
      where: { id, organizationId: ORG_A },
    });
    expect(row?.deletedAt).toEqual(TEST_NOW);
    // 削除した人が監査ログに残る
    expect(
      await getPrisma().auditLog.findMany({
        where: {
          organizationId: ORG_A,
          action: "customer.delete",
          targetId: id,
        },
        select: { actorUserId: true },
      }),
    ).toEqual([{ actorUserId: "user_a1" }]);
  });
});

// ---------------------------------------------------------------

const base: ReservationInput = {
  customerId: "cus_a_001",
  serviceId: "svc_a1", // カット 60 分 4,400 円
  staffProfileId: "stf_a1",
  locationId: "loc_a1",
  date: "2027-02-01",
  time: "10:00",
  status: "confirmed",
};

async function reserve(
  ctx: OrgContext,
  input: Partial<ReservationInput> = {},
) {
  const result = await createReservation(ctx, { ...base, ...input });
  if (result.ok) createdReservations.push(result.value.id);
  return result;
}

async function reserveOk(
  ctx: OrgContext,
  input: Partial<ReservationInput> = {},
): Promise<string> {
  const result = await reserve(ctx, input);
  if (!result.ok) throw new Error(result.reason);
  return result.value.id;
}

async function findRow(id: string) {
  return getPrisma().reservation.findFirst({
    where: { id, organizationId: ORG_A },
  });
}

describe("予約の作成（F-08）", () => {
  // テストごとに別の日を使い、重複の判定が他のテストに影響しないようにする
  let day = 1;
  const nextDate = () => `2027-03-${String(day++).padStart(2, "0")}`;

  it("店舗の時刻を UTC で保存し、終了時刻と料金をメニューから決める", async () => {
    const date = nextDate();
    const id = await reserveOk(await owner(), {
      date,
      time: "10:30",
    });
    expect(await findRow(id)).toMatchObject({
      startsAt: new Date(`${date}T01:30:00Z`), // JST 10:30
      endsAt: new Date(`${date}T02:30:00Z`),
      priceYen: 4400,
      status: "confirmed",
      version: 1,
    });
  });

  it("作成とキャンセルは、操作した人と一緒に監査ログに残る", async () => {
    const date = nextDate();
    const ctx = await staff();
    const id = await reserveOk(ctx, {
      date,
      staffProfileId: "stf_a2",
    });
    expect((await cancelReservation(ctx, id, 1)).ok).toBe(true);
    const logs = await getPrisma().auditLog.findMany({
      where: { organizationId: ORG_A, targetId: id },
      orderBy: { createdAt: "asc" },
      select: { action: true, actorUserId: true },
    });
    expect(logs).toEqual([
      { action: "reservation.create", actorUserId: "user_a2" },
      { action: "reservation.cancel", actorUserId: "user_a2" },
    ]);
  });

  it("他の組織の顧客・メニュー・スタッフ・店舗は not_found", async () => {
    const ctx = await owner();
    const date = nextDate();
    for (const input of [
      { customerId: "cus_c_001" },
      { serviceId: "svc_c1" },
      { staffProfileId: "stf_c0" },
      { locationId: "loc_c1" },
    ]) {
      expect(await reserve(ctx, { ...input, date })).toEqual({
        ok: false,
        reason: "not_found",
      });
    }
  });

  it("論理削除された顧客では作れない", async () => {
    expect(
      await reserve(await owner(), {
        customerId: "cus_a_033",
        date: nextDate(),
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("Staff は自分が担当の予約だけを作れる", async () => {
    const ctx = await staff();
    const date = nextDate();
    expect(
      await reserve(ctx, { staffProfileId: "stf_a3", date }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(
      (await reserve(ctx, { staffProfileId: "stf_a2", date })).ok,
    ).toBe(true);
  });
});

describe("予約の重複（F-09）", () => {
  let day = 1;
  const nextDate = () => `2027-04-${String(day++).padStart(2, "0")}`;

  it("同じスタッフで時間が重なると slot_taken", async () => {
    const ctx = await owner();
    const date = nextDate();
    await reserveOk(ctx, { date, time: "10:00" });
    expect(await reserve(ctx, { date, time: "10:30" })).toEqual({
      ok: false,
      reason: "slot_taken",
    });
  });

  it("終了時刻ちょうどに始まる予約と、別スタッフの同時刻は作れる", async () => {
    const ctx = await owner();
    const date = nextDate();
    await reserveOk(ctx, { date, time: "10:00" });
    expect((await reserve(ctx, { date, time: "11:00" })).ok).toBe(
      true,
    );
    expect(
      (
        await reserve(ctx, {
          date,
          time: "10:00",
          staffProfileId: "stf_a2",
        })
      ).ok,
    ).toBe(true);
  });

  it("同時に同じ枠を予約しても、成功するのは 1 件だけ", async () => {
    const ctx = await owner();
    const date = nextDate();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        reserve(ctx, {
          date,
          time: "13:00",
          customerId: `cus_a_00${i + 1}`,
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      results.filter((r) => !r.ok && r.reason === "slot_taken"),
    ).toHaveLength(4);
  });

  it("キャンセルした予約の枠には新しく予約できる", async () => {
    const ctx = await owner();
    const date = nextDate();
    const id = await reserveOk(ctx, { date });
    expect((await cancelReservation(ctx, id, 1)).ok).toBe(true);
    expect((await reserve(ctx, { date })).ok).toBe(true);
  });

  it("変更で他の予約と重なっても slot_taken になり、元の予約は変わらない", async () => {
    const ctx = await owner();
    const date = nextDate();
    await reserveOk(ctx, { date, time: "10:00" });
    const id = await reserveOk(ctx, { date, time: "12:00" });
    expect(
      await updateReservation(ctx, id, 1, {
        ...base,
        date,
        time: "10:30",
      }),
    ).toEqual({ ok: false, reason: "slot_taken" });
    expect(await findRow(id)).toMatchObject({
      startsAt: new Date(`${date}T03:00:00Z`),
      version: 1,
    });
  });
});

describe("予約の変更・キャンセル（F-08、楽観ロック）", () => {
  let day = 1;
  const nextDate = () => `2027-05-${String(day++).padStart(2, "0")}`;

  it("変更すると version が増え、変わった項目を監査ログに残す", async () => {
    const ctx = await owner();
    const date = nextDate();
    const id = await reserveOk(ctx, { date });
    const result = await updateReservation(ctx, id, 1, {
      ...base,
      date,
      time: "15:00",
      serviceId: "svc_a2", // カラー 90 分 8,800 円
    });
    expect(result).toEqual({ ok: true, value: { id, version: 2 } });
    expect(await findRow(id)).toMatchObject({
      startsAt: new Date(`${date}T06:00:00Z`),
      endsAt: new Date(`${date}T07:30:00Z`),
      priceYen: 8800,
    });
    const log = await getPrisma().auditLog.findFirst({
      where: {
        organizationId: ORG_A,
        action: "reservation.update",
        targetId: id,
      },
    });
    expect(Object.keys(log?.diff ?? {}).sort()).toEqual(
      ["endsAt", "priceYen", "serviceId", "startsAt"].sort(),
    );
  });

  it("古い version での変更・キャンセルは conflict", async () => {
    const ctx = await owner();
    const date = nextDate();
    const id = await reserveOk(ctx, { date });
    await updateReservation(ctx, id, 1, {
      ...base,
      date,
      time: "11:00",
    });
    expect(
      await updateReservation(ctx, id, 1, {
        ...base,
        date,
        time: "12:00",
      }),
    ).toEqual({ ok: false, reason: "conflict" });
    expect(await cancelReservation(ctx, id, 1)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect((await findRow(id))?.status).toBe("confirmed");
  });

  it("Staff は他のスタッフ担当の予約を変更・キャンセルできない", async () => {
    const date = nextDate();
    // stf_a1（Admin の佐藤）担当の予約
    const id = await reserveOk(await owner(), { date });
    const ctx = await staff();
    expect(
      await updateReservation(ctx, id, 1, {
        ...base,
        date,
        time: "16:00",
      }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(await cancelReservation(ctx, id, 1)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await findRow(id)).toMatchObject({
      status: "confirmed",
      version: 1,
    });
    // 画面でも変更できないと分かる
    expect((await getReservation(ctx, id))?.canManage).toBe(false);
  });

  it("Staff は自分の予約を変更できるが、担当の付け替えはできない", async () => {
    const date = nextDate();
    const ctx = await staff();
    const id = await reserveOk(ctx, {
      date,
      staffProfileId: "stf_a2",
    });
    expect(
      await updateReservation(ctx, id, 1, {
        ...base,
        date,
        staffProfileId: "stf_a3",
      }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(
      (
        await updateReservation(ctx, id, 1, {
          ...base,
          date,
          staffProfileId: "stf_a2",
          time: "17:00",
        })
      ).ok,
    ).toBe(true);
    expect((await findRow(id))?.staffProfileId).toBe("stf_a2");
  });

  it("Admin は担当を付け替えられる", async () => {
    const date = nextDate();
    const ctx = await admin();
    const id = await reserveOk(ctx, { date });
    expect(
      (
        await updateReservation(ctx, id, 1, {
          ...base,
          date,
          staffProfileId: "stf_a3",
        })
      ).ok,
    ).toBe(true);
    expect((await findRow(id))?.staffProfileId).toBe("stf_a3");
  });

  it("キャンセル済み・来店済みの予約は変更もキャンセルもできない", async () => {
    const ctx = await owner();
    const date = nextDate();
    const cancelled = await reserveOk(ctx, { date, time: "10:00" });
    await cancelReservation(ctx, cancelled, 1);
    expect(
      await updateReservation(ctx, cancelled, 2, { ...base, date }),
    ).toEqual({ ok: false, reason: "not_editable" });
    expect(await cancelReservation(ctx, cancelled, 2)).toEqual({
      ok: false,
      reason: "not_editable",
    });

    const done = await reserveOk(ctx, { date, time: "14:00" });
    await updateReservation(ctx, done, 1, {
      ...base,
      date,
      time: "14:00",
      status: "done",
    });
    expect(
      await updateReservation(ctx, done, 2, {
        ...base,
        date,
        time: "15:00",
      }),
    ).toEqual({ ok: false, reason: "not_editable" });
  });

  it("他の組織の予約 ID は変更・キャンセル・取得とも not_found", async () => {
    const date = nextDate();
    const id = await reserveOk(await owner(), { date });
    const ctx = await otherOrgOwner();
    expect(
      await updateReservation(ctx, id, 1, {
        ...base,
        customerId: "cus_c_001",
        serviceId: "svc_c1",
        staffProfileId: "stf_c0",
        locationId: "loc_c1",
        date,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await cancelReservation(ctx, id, 1)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await getReservation(ctx, id)).toBeNull();
    expect(await findRow(id)).toMatchObject({
      status: "confirmed",
      version: 1,
    });
  });

  it("自分の組織の予約でも、他の組織の顧客には変えられない", async () => {
    const ctx = await owner();
    const date = nextDate();
    const id = await reserveOk(ctx, { date });
    expect(
      await updateReservation(ctx, id, 1, {
        ...base,
        date,
        customerId: "cus_c_001",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("checkHealth", () => {
  it("DB に接続できれば ok", async () => {
    expect(await checkHealth()).toEqual({ database: "ok" });
  });
});
