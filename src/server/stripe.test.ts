/**
 * Webhook の署名の検証（docs/billing.md）。API キーは使わない。
 * 本文は generateTestHeaderString で、Stripe と同じ方式で署名する。
 */
import { describe, expect, it } from "vitest";
import {
  signedPayload,
  subscriptionEvent,
  TEST_WEBHOOK_SECRET,
} from "../../test/stripe-events";
import { verifyStripeWebhook } from "./stripe";

const event = subscriptionEvent({
  type: "customer.subscription.updated",
  created: Math.floor(Date.now() / 1000),
  customerId: "cus_test_1",
  subscriptionId: "sub_test_1",
  status: "active",
});

describe("verifyStripeWebhook", () => {
  it("正しい秘密で署名した本文はイベントとして読める", async () => {
    const { payload, signature } = signedPayload(event);
    const result = await verifyStripeWebhook(
      payload,
      signature,
      TEST_WEBHOOK_SECRET,
    );
    expect(result).toMatchObject({
      ok: true,
      event: { id: event.id, type: "customer.subscription.updated" },
    });
  });

  it("署名の後に本文を書き換えると拒否する", async () => {
    const { payload, signature } = signedPayload(event);
    const tampered = payload.replace('"active"', '"canceled"');
    expect(tampered).not.toBe(payload);
    expect(
      await verifyStripeWebhook(
        tampered,
        signature,
        TEST_WEBHOOK_SECRET,
      ),
    ).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("別の秘密で署名したものは拒否する", async () => {
    const { payload, signature } = signedPayload(event, {
      secret: "whsec_someone_else",
    });
    expect(
      await verifyStripeWebhook(
        payload,
        signature,
        TEST_WEBHOOK_SECRET,
      ),
    ).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("署名の時刻が 5 分より古いものは拒否する（再送の攻撃を防ぐ）", async () => {
    const { payload, signature } = signedPayload(event, {
      timestamp: Math.floor(Date.now() / 1000) - 10 * 60,
    });
    expect(
      await verifyStripeWebhook(
        payload,
        signature,
        TEST_WEBHOOK_SECRET,
      ),
    ).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("署名のヘッダーがない・形式が違うものは拒否する", async () => {
    const { payload } = signedPayload(event);
    for (const signature of [null, "", "t=1,v1=abc"]) {
      expect(
        await verifyStripeWebhook(
          payload,
          signature,
          TEST_WEBHOOK_SECRET,
        ),
      ).toEqual({ ok: false, reason: "invalid_signature" });
    }
  });

  it("秘密が設定されていなければ、検証せずに not_configured", async () => {
    const { payload, signature } = signedPayload(event);
    expect(await verifyStripeWebhook(payload, signature, "")).toEqual(
      {
        ok: false,
        reason: "not_configured",
      },
    );
  });
});
