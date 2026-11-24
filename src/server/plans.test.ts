import { describe, expect, it } from "vitest";
import {
  isStaleEvent,
  PLANS,
  planForSubscription,
  withinLimit,
} from "./plans";

const PRO = ["price_pro_monthly", "price_pro_yearly"];

describe("PLANS（F-15）", () => {
  it("Free はスタッフ 2 人・店舗 1 つまで、Pro は上限なし", () => {
    expect(PLANS.free).toMatchObject({
      maxStaff: 2,
      maxLocations: 1,
    });
    expect(PLANS.pro).toMatchObject({
      maxStaff: null,
      maxLocations: null,
    });
    expect(Number.isInteger(PLANS.pro.priceYen)).toBe(true);
  });

  it("withinLimit：上限未満なら追加できる。null は上限なし", () => {
    expect(withinLimit(2, 1)).toBe(true);
    expect(withinLimit(2, 2)).toBe(false);
    expect(withinLimit(2, 3)).toBe(false);
    expect(withinLimit(null, 1000)).toBe(true);
  });
});

describe("planForSubscription", () => {
  it("有効・試用中・支払いの遅れ（再試行中）の Pro の Price は Pro", () => {
    for (const status of ["active", "trialing", "past_due"]) {
      expect(
        planForSubscription(
          { status, stripePriceId: "price_pro_yearly" },
          PRO,
        ),
      ).toBe("pro");
    }
  });

  it("解約・未払い・申し込み途中・一時停止は Free", () => {
    for (const status of [
      "canceled",
      "unpaid",
      "incomplete",
      "incomplete_expired",
      "paused",
    ]) {
      expect(
        planForSubscription(
          { status, stripePriceId: "price_pro_monthly" },
          PRO,
        ),
      ).toBe("free");
    }
  });

  it("Pro として登録していない Price は Pro にしない", () => {
    expect(
      planForSubscription(
        { status: "active", stripePriceId: "price_other" },
        PRO,
      ),
    ).toBe("free");
    expect(
      planForSubscription(
        { status: "active", stripePriceId: null },
        PRO,
      ),
    ).toBe("free");
  });
});

describe("isStaleEvent（順番の入れ替わり）", () => {
  const t = (s: number) => new Date(s * 1000);
  const stored = (
    status: string,
    at: number,
    stripeSubscriptionId: string | null = "sub_1",
  ) => ({ stripeSubscriptionId, status, lastEventAt: t(at) });
  const incoming = (status: string, id = "sub_1") => ({
    stripeSubscriptionId: id,
    status,
  });

  it("まだ何も反映していなければ反映する", () => {
    expect(isStaleEvent(null, incoming("incomplete"), t(100))).toBe(
      false,
    );
    expect(
      isStaleEvent(
        {
          stripeSubscriptionId: null,
          status: "none",
          lastEventAt: null,
        },
        incoming("active"),
        t(100),
      ),
    ).toBe(false);
  });

  it("反映済みのイベントより古いものは捨てる", () => {
    expect(
      isStaleEvent(
        stored("active", 200),
        incoming("incomplete"),
        t(100),
      ),
    ).toBe(true);
    expect(
      isStaleEvent(
        stored("canceled", 300),
        incoming("active"),
        t(200),
      ),
    ).toBe(true);
  });

  it("新しいものは反映する", () => {
    expect(
      isStaleEvent(
        stored("active", 200),
        incoming("canceled"),
        t(300),
      ),
    ).toBe(false);
  });

  it("同じ秒：解約済みのサブスクリプションを有効に戻さない", () => {
    expect(
      isStaleEvent(
        stored("canceled", 200),
        incoming("active"),
        t(200),
      ),
    ).toBe(true);
  });

  it("同じ秒：有効になった後に incomplete（作成時）へ戻さない", () => {
    expect(
      isStaleEvent(
        stored("active", 200),
        incoming("incomplete"),
        t(200),
      ),
    ).toBe(true);
    // 同じ秒でも、戻れる向きの変化（active → past_due など）は反映する
    expect(
      isStaleEvent(
        stored("active", 200),
        incoming("past_due"),
        t(200),
      ),
    ).toBe(false);
  });

  it("有効なサブスクリプションを、別のサブスクリプションの終了で上書きしない", () => {
    expect(
      isStaleEvent(
        stored("active", 200, "sub_new"),
        incoming("canceled", "sub_old"),
        t(300),
      ),
    ).toBe(true);
    // 解約後の新しい申し込みは反映する
    expect(
      isStaleEvent(
        stored("canceled", 200, "sub_old"),
        incoming("incomplete", "sub_new"),
        t(300),
      ),
    ).toBe(false);
  });
});
