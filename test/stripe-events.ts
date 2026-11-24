/**
 * テスト用の Stripe のイベント。API キーを使わずに、Webhook に届く
 * 本文と同じ形の JSON を作り、stripe パッケージの
 * webhooks.generateTestHeaderString で Stripe-Signature ヘッダーを付ける
 * （Stripe と同じ HMAC-SHA256 の署名。本物の whsec_ の値は使わない）。
 */
import Stripe from "stripe";

export const TEST_WEBHOOK_SECRET = "whsec_test_flowdesk_dummy_secret";
export const TEST_PRO_PRICE_ID = "price_test_pro_monthly";

let sequence = 0;

export type SubscriptionEventInput = {
  type:
    | "customer.subscription.created"
    | "customer.subscription.updated"
    | "customer.subscription.deleted";
  /** イベントの作成日時（event.created、Unix 秒） */
  created: number;
  customerId: string;
  subscriptionId: string;
  status: string;
  priceId?: string;
  /** 期間の終わり（Unix 秒） */
  periodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  organizationId?: string;
  /** 同じイベントを送り直すときに、同じ ID を指定する */
  id?: string;
};

/** customer.subscription.* のイベント（本文の JSON） */
export function subscriptionEvent(input: SubscriptionEventInput) {
  const id = input.id ?? `evt_test_${Date.now()}_${++sequence}`;
  const periodEnd = input.periodEnd ?? input.created + 30 * 24 * 3600;
  return {
    id,
    object: "event",
    api_version: Stripe.API_VERSION,
    created: input.created,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: input.type,
    data: {
      object: {
        id: input.subscriptionId,
        object: "subscription",
        customer: input.customerId,
        status: input.status,
        cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
        cancel_at: null,
        ended_at: null,
        metadata: input.organizationId
          ? { organizationId: input.organizationId }
          : {},
        items: {
          object: "list",
          data: [
            {
              id: `si_${input.subscriptionId}`,
              object: "subscription_item",
              current_period_start: input.created,
              current_period_end: periodEnd,
              price: {
                id: input.priceId ?? TEST_PRO_PRICE_ID,
                object: "price",
                currency: "jpy",
                unit_amount: 3000,
              },
              quantity: 1,
            },
          ],
        },
      },
    },
  };
}

/** 署名付きの本文とヘッダー */
export function signedPayload(
  event: unknown,
  options: { secret?: string; timestamp?: number } = {},
) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: options.secret ?? TEST_WEBHOOK_SECRET,
    timestamp: options.timestamp,
  });
  return { payload, signature };
}

/** /api/webhooks/stripe に送るリクエスト */
export function webhookRequest(
  event: unknown,
  options: {
    secret?: string;
    timestamp?: number;
    /** 署名した後に本文を書き換える（改ざんの確認） */
    tamper?: (payload: string) => string;
  } = {},
): Request {
  const { payload, signature } = signedPayload(event, options);
  return new Request("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body: options.tamper ? options.tamper(payload) : payload,
  });
}
