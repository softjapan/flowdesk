/**
 * Repository 層のテスト（テスト用 DB を使う。npm run test:db）。
 * 予約を更新するテストは、終わったら元の値に戻す。
 */
import { afterEach, describe, expect, it } from "vitest";
import { getPrisma, runInTransaction } from "@/server/db";
import { createAuditLog } from "@/server/repositories/audit-logs";
import { listCustomers } from "@/server/repositories/customers";
import { findMember } from "@/server/repositories/organizations";
import {
  findReservation,
  listReservations,
  updateReservationWithVersion,
} from "@/server/repositories/reservations";
import { DEMO_USER_ID } from "@/server/demo-user";

const ORG_A = "org_a";
const ORG_C = "org_c";
// TEST_NOW の翌月（12/7）の confirmed の予約。テストが見る今月・今週の範囲外
const RSV = "rsv_org_a_0152";

async function restoreReservation() {
  await getPrisma().reservation.updateMany({
    where: { id: RSV, organizationId: ORG_A },
    data: { status: "confirmed", version: 1 },
  });
  await getPrisma().auditLog.deleteMany({
    where: { organizationId: ORG_A, targetId: RSV },
  });
}

afterEach(restoreReservation);

describe("organizationId での絞り込み", () => {
  it("他の組織の予約 ID では見つからない", async () => {
    expect(await findReservation(ORG_A, RSV)).not.toBeNull();
    expect(await findReservation(ORG_C, RSV)).toBeNull();
  });

  it("一覧に他の組織の行が混ざらない", async () => {
    const customers = await listCustomers(ORG_A);
    expect(customers.length).toBe(32);
    expect(customers.every((c) => c.organizationId === ORG_A)).toBe(
      true,
    );

    const reservations = await listReservations(ORG_A, {
      from: new Date("2000-01-01T00:00:00Z"),
      to: new Date("2100-01-01T00:00:00Z"),
    });
    expect(
      reservations.every((r) => r.organizationId === ORG_A),
    ).toBe(true);
  });

  it("所属しない組織のメンバーは引けない", async () => {
    expect(await findMember(ORG_A, DEMO_USER_ID)).toMatchObject({
      role: "owner",
    });
    expect(await findMember(ORG_C, DEMO_USER_ID)).toBeNull();
  });

  it("他の組織の顧客を参照する予約は DB が拒否する（複合外部キー）", async () => {
    await expect(
      getPrisma().reservation.updateMany({
        where: { id: RSV, organizationId: ORG_A },
        data: { customerId: "cus_c_001" },
      }),
    ).rejects.toThrow();
  });
});

describe("updateReservationWithVersion（楽観ロック）", () => {
  it("読んだときの version なら更新し、version を 1 増やす", async () => {
    const result = await updateReservationWithVersion(ORG_A, RSV, 1, {
      status: "cancelled",
    });
    expect(result).toMatchObject({
      status: "updated",
      reservation: { status: "cancelled", version: 2 },
    });
  });

  it("古い version での更新は conflict になり、上書きしない", async () => {
    // 2 人が同じ version 1 を読み、先に 1 人目が更新した
    await updateReservationWithVersion(ORG_A, RSV, 1, {
      status: "cancelled",
    });
    const second = await updateReservationWithVersion(ORG_A, RSV, 1, {
      status: "done",
    });
    expect(second).toEqual({ status: "conflict", currentVersion: 2 });
    expect((await findReservation(ORG_A, RSV))?.status).toBe(
      "cancelled",
    );
  });

  it("同時に更新しても、成功するのは 1 件だけ", async () => {
    const results = await Promise.all(
      (["cancelled", "done", "pending"] as const).map((status) =>
        updateReservationWithVersion(ORG_A, RSV, 1, { status }),
      ),
    );
    expect(
      results.filter((r) => r.status === "updated"),
    ).toHaveLength(1);
    expect((await findReservation(ORG_A, RSV))?.version).toBe(2);
  });

  it("他の組織の予約は not_found（存在を漏らさない）", async () => {
    expect(
      await updateReservationWithVersion(ORG_C, RSV, 1, {
        status: "cancelled",
      }),
    ).toEqual({ status: "not_found" });
    expect((await findReservation(ORG_A, RSV))?.version).toBe(1);
  });
});

describe("runInTransaction", () => {
  const entry = {
    organizationId: ORG_A,
    actorUserId: DEMO_USER_ID,
    action: "reservation.cancel",
    targetType: "reservation",
    targetId: RSV,
    diff: { status: ["confirmed", "cancelled"] },
  };

  it("予約の更新と監査ログを一緒に確定する", async () => {
    await runInTransaction(async (tx) => {
      const r = await updateReservationWithVersion(
        ORG_A,
        RSV,
        1,
        { status: "cancelled" },
        tx,
      );
      if (r.status !== "updated") throw new Error(r.status);
      await createAuditLog(entry, tx);
    });
    expect((await findReservation(ORG_A, RSV))?.status).toBe(
      "cancelled",
    );
    expect(
      await getPrisma().auditLog.count({
        where: { organizationId: ORG_A, targetId: RSV },
      }),
    ).toBe(1);
  });

  it("途中で失敗したら予約の更新も取り消す", async () => {
    await expect(
      runInTransaction(async (tx) => {
        await updateReservationWithVersion(
          ORG_A,
          RSV,
          1,
          { status: "cancelled" },
          tx,
        );
        // 存在しない組織の監査ログは外部キー違反で失敗する
        await createAuditLog(
          { ...entry, organizationId: "org_missing" },
          tx,
        );
      }),
    ).rejects.toThrow();
    expect(await findReservation(ORG_A, RSV)).toMatchObject({
      status: "confirmed",
      version: 1,
    });
  });
});
