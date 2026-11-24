/**
 * Stripe（テストモードのみ、docs/billing.md）。環境変数：
 * - STRIPE_SECRET_KEY：API キー（sk_test_...）。Checkout とカスタマー
 *   ポータルのセッションを作るときだけ使う
 * - STRIPE_WEBHOOK_SECRET：Webhook の署名の秘密（whsec_...）
 * - STRIPE_PRICE_PRO：Pro の Price の ID（price_...）。月額・年額など
 *   複数あるときはカンマ区切りで並べ、先頭を Checkout で使う
 *
 * Webhook の署名の検証は API キーなしでできる（Stripe.webhooks は静的）。
 * Stripe の Client は最初に使うときに作る（キーがなくてもビルドできる）。
 */
import Stripe from "stripe";

/** Service が使う Stripe の操作。テストでは差し替える */
export type BillingGateway = {
  createCustomer(
    input: {
      organizationId: string;
      name: string;
      email?: string;
    },
    idempotencyKey: string,
  ): Promise<{ id: string }>;
  createCheckoutSession(input: {
    customerId: string;
    organizationId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
};

export function proPriceIdsFromEnv(): string[] {
  return (process.env.STRIPE_PRICE_PRO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

let client: Stripe | undefined;

/**
 * API キーと Pro の Price が設定されていれば Stripe を使う操作を返し、
 * なければ null（画面に「課金の設定がない」と出す）
 */
export function getStripeGateway(): BillingGateway | null {
  const key = process.env.STRIPE_SECRET_KEY;
  const [priceId] = proPriceIdsFromEnv();
  if (!key || !priceId) return null;
  client ??= new Stripe(key);
  const stripe = client;
  return {
    async createCustomer(input, idempotencyKey) {
      const customer = await stripe.customers.create(
        {
          name: input.name,
          email: input.email,
          metadata: { organizationId: input.organizationId },
        },
        // 同時に 2 回押されても、Stripe の顧客は 1 人だけ作る
        { idempotencyKey },
      );
      return { id: customer.id };
    },
    async createCheckoutSession(input) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: input.customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: input.organizationId,
        metadata: { organizationId: input.organizationId },
        subscription_data: {
          metadata: { organizationId: input.organizationId },
        },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
      if (!session.url) {
        throw new Error("Checkout のセッションに URL がない");
      }
      return { url: session.url };
    },
    async createPortalSession(input) {
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      return { url: session.url };
    },
  };
}

export type WebhookVerification =
  | { ok: true; event: Stripe.Event }
  | { ok: false; reason: "not_configured" | "invalid_signature" };

/**
 * Webhook の本文（加工する前の文字列）と Stripe-Signature ヘッダーを
 * 検証する。署名の時刻が 5 分（Stripe の既定）より古いものも拒否する
 * （盗んだリクエストの再送を防ぐ）
 */
export async function verifyStripeWebhook(
  payload: string,
  signature: string | null,
  secret = process.env.STRIPE_WEBHOOK_SECRET,
): Promise<WebhookVerification> {
  if (!secret) return { ok: false, reason: "not_configured" };
  if (!signature) return { ok: false, reason: "invalid_signature" };
  try {
    const event = await Stripe.webhooks.constructEventAsync(
      payload,
      signature,
      secret,
    );
    return { ok: true, event };
  } catch (error) {
    if (
      error instanceof Stripe.errors.StripeSignatureVerificationError
    ) {
      return { ok: false, reason: "invalid_signature" };
    }
    throw error;
  }
}
