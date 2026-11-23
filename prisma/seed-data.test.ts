/** シードの中身（DB を使わない）。投入前に壊れていないことを確かめる */
import { describe, expect, it } from "vitest";
import {
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
} from "../src/server/demo-user";
import { buildSeedData } from "./seed-data";

const data = buildSeedData(new Date("2026-11-23T03:00:00Z"));

describe("buildSeedData", () => {
  it("予約が参照する店舗・スタッフ・顧客・メニューは同じ組織のもの", () => {
    const orgOf = new Map(
      [
        ...data.locations,
        ...data.staffProfiles,
        ...data.customers,
        ...data.services,
      ].map((row) => [row.id, row.organizationId]),
    );
    for (const r of data.reservations) {
      for (const id of [
        r.locationId,
        r.staffProfileId,
        r.customerId,
        r.serviceId,
      ]) {
        expect(orgOf.get(id)).toBe(r.organizationId);
      }
    }
  });

  it("同じスタッフのキャンセル以外の予約は時間が重ならない（第9章の排他制約を入れても投入できる）", () => {
    const active = data.reservations.filter(
      (r) => r.status !== "cancelled",
    );
    for (const a of active) {
      const overlapping = active.filter(
        (b) =>
          b.id !== a.id &&
          b.staffProfileId === a.staffProfileId &&
          b.startsAt < a.endsAt &&
          a.startsAt < b.endsAt,
      );
      expect(overlapping).toEqual([]);
    }
  });

  it("予約は論理削除済みの顧客に割り当てない", () => {
    const deleted = new Set(
      data.customers.filter((c) => c.deletedAt).map((c) => c.id),
    );
    expect(
      data.reservations.filter((r) => deleted.has(r.customerId)),
    ).toEqual([]);
  });

  it("メンバーのユーザーはすべて作る", () => {
    const users = new Set(data.users.map((u) => u.id));
    for (const m of data.members)
      expect(users.has(m.userId)).toBe(true);
  });

  it("デモユーザーのメールアドレスは README・定数と一致する", () => {
    expect(data.users.find((u) => u.id === DEMO_USER_ID)?.email).toBe(
      DEMO_USER_EMAIL,
    );
  });
});
