/**
 * 料金プランとサブスクリプション（S-14、F-14、docs/billing.md）。
 * 課金の単位は組織。申し込みは Stripe Checkout、プランの変更・解約・
 * 支払い方法の変更は Stripe のカスタマーポータルで行う（Owner のみ）。
 *
 * 組織のプランは Webhook（handleStripeEvent）でだけ書き換える。
 * Checkout から戻ってきた URL（?checkout=success）は信用しない。
 */
import type Stripe from "stripe";
import { appUrl } from "@/server/app-url";
import { type Db, runInTransaction } from "@/server/db";
import {
  isStaleEvent,
  PLANS,
  planForSubscription,
  SUBSCRIPTION_STATUS_LABELS,
  toPlanId,
  type PlanId,
  type SubscriptionSnapshot,
} from "@/server/plans";
import {
  createAuditLog,
  STRIPE_ACTOR_ID,
} from "@/server/repositories/audit-logs";
import { lockOrganization } from "@/server/repositories/organizations";
import {
  attachStripeCustomer,
  claimStripeEvent,
  findSubscription,
  findSubscriptionByStripeCustomerId,
  setStripeEventResult,
  updateSubscriptionState,
} from "@/server/repositories/subscriptions";
import { findUserById } from "@/server/repositories/users";
import {
  type BillingGateway,
  getStripeGateway,
  proPriceIdsFromEnv,
} from "@/server/stripe";
import { canManageBilling } from "@/server/services/authz";
import type { OrgContext } from "@/server/services/org-context";
import {
  getPlanUsage,
  type PlanUsage,
} from "@/server/services/plan-limits";
import { fail, ok, type Result } from "@/server/services/result";

export type BillingPage = {
  usage: PlanUsage;
  status: string;
  statusLabel: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  proPriceYen: number;
  /** Pro に申し込める（Free で、Stripe の設定がある） */
  canCheckout: boolean;
  /** カスタマーポータルを開ける（Stripe の顧客がある） */
  canOpenPortal: boolean;
  /** Stripe の API キーと Price が設定されている */
  configured: boolean;
};

export async function getBillingPage(
  ctx: OrgContext,
  gateway: BillingGateway | null = getStripeGateway(),
): Promise<Result<BillingPage>> {
  if (!canManageBilling(ctx.role)) return fail("forbidden");
  const [subscription, usage] = await Promise.all([
    findSubscription(ctx.organizationId),
    getPlanUsage(ctx.organizationId),
  ]);
  const status = subscription?.status ?? "none";
  const configured = gateway !== null;
  return ok({
    usage,
    status,
    statusLabel: SUBSCRIPTION_STATUS_LABELS[status] ?? status,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    proPriceYen: PLANS.pro.priceYen,
    canCheckout: configured && usage.plan === "free",
    canOpenPortal:
      configured && Boolean(subscription?.stripeCustomerId),
    configured,
  });
}

/**
 * 組織の Stripe の顧客を用意する。なければ作り、組織に結びつける。
 * Stripe の呼び出しはトランザクションの外で行い（DB のロックを
 * 外部の API の応答待ちで持ち続けない）、同時に作られても冪等キーで
 * 顧客は 1 人になる。結びつけはロックの中で「まだないときだけ」行う
 */
async function ensureStripeCustomer(
  ctx: OrgContext,
  gateway: BillingGateway,
): Promise<string> {
  const existing = await findSubscription(ctx.organizationId);
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;
  const owner = await findUserById(ctx.userId);
  const customer = await gateway.createCustomer(
    {
      organizationId: ctx.organizationId,
      name: ctx.organizationName,
      email: owner?.email,
    },
    `flowdesk-customer:${ctx.organizationId}`,
  );
  return runInTransaction(async (tx) => {
    await lockOrganization(ctx.organizationId, tx);
    await attachStripeCustomer(ctx.organizationId, customer.id, tx);
    const row = await findSubscription(ctx.organizationId, tx);
    return row?.stripeCustomerId ?? customer.id;
  });
}

/** Pro の申し込み（Stripe Checkout の URL を返す。Owner のみ） */
export async function startProCheckout(
  ctx: OrgContext,
  gateway: BillingGateway | null = getStripeGateway(),
): Promise<Result<{ url: string }>> {
  if (!canManageBilling(ctx.role)) return fail("forbidden");
  if (!gateway) return fail("billing_unavailable");
  const subscription = await findSubscription(ctx.organizationId);
  if (toPlanId(subscription?.plan) === "pro") {
    return fail("already_subscribed");
  }
  const customerId = await ensureStripeCustomer(ctx, gateway);
  const billing = `/${ctx.slug}/billing`;
  const session = await gateway.createCheckoutSession({
    customerId,
    organizationId: ctx.organizationId,
    successUrl: appUrl(`${billing}?checkout=success`),
    cancelUrl: appUrl(`${billing}?checkout=canceled`),
  });
  return ok({ url: session.url });
}

/**
 * カスタマーポータル（プランの変更・解約・支払い方法の変更）の URL。
 * Owner のみ。ポータルで何ができるかは Stripe のダッシュボードで設定する
 */
export async function openCustomerPortal(
  ctx: OrgContext,
  gateway: BillingGateway | null = getStripeGateway(),
): Promise<Result<{ url: string }>> {
  if (!canManageBilling(ctx.role)) return fail("forbidden");
  if (!gateway) return fail("billing_unavailable");
  const subscription = await findSubscription(ctx.organizationId);
  if (!subscription?.stripeCustomerId) {
    return fail("no_billing_account");
  }
  const session = await gateway.createPortalSession({
    customerId: subscription.stripeCustomerId,
    returnUrl: appUrl(`/${ctx.slug}/billing`),
  });
  return ok({ url: session.url });
}

// ---------------------------------------------------------------
// Webhook（/api/webhooks/stripe）。署名は Route Handler で検証済み
// ---------------------------------------------------------------

/** 組織のプランに関わるイベント。ほかの種類は記録だけして何もしない */
const SUBSCRIPTION_EVENTS = new Set<string>([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

export type StripeEventOutcome =
  /** 反映した */
  | "applied"
  /** より新しいイベントを反映済みなので、反映しなかった */
  | "stale"
  /** 対象外の種類・知らない顧客 */
  | "ignored"
  /** 同じイベントを処理済み（2 回目以降の配送） */
  | "duplicate";

function snapshotOf(sub: Stripe.Subscription): SubscriptionSnapshot {
  const item = sub.items.data[0];
  return {
    stripeSubscriptionId: sub.id,
    status: sub.status,
    stripePriceId: item?.price.id ?? null,
    currentPeriodEnd: item
      ? new Date(item.current_period_end * 1000)
      : null,
    // ポータルの解約は、設定により cancel_at_period_end か cancel_at になる
    cancelAtPeriodEnd:
      sub.cancel_at_period_end || sub.cancel_at !== null,
  };
}

function customerIdOf(sub: Stripe.Subscription): string {
  return typeof sub.customer === "string"
    ? sub.customer
    : sub.customer.id;
}

async function applySubscriptionEvent(
  event: Stripe.Event,
  proPriceIds: readonly string[],
  tx: Db,
): Promise<{
  result: Exclude<StripeEventOutcome, "duplicate">;
  organizationId: string | null;
}> {
  if (!SUBSCRIPTION_EVENTS.has(event.type)) {
    return { result: "ignored", organizationId: null };
  }
  const sub = event.data.object as Stripe.Subscription;
  const owner = await findSubscriptionByStripeCustomerId(
    customerIdOf(sub),
    tx,
  );
  // FlowDesk が作っていない顧客（同じ Stripe アカウントの別のアプリなど）
  if (!owner) return { result: "ignored", organizationId: null };
  const { organizationId } = owner;
  // Checkout で付けた組織 ID と食い違うものは反映しない
  const metaOrg = sub.metadata?.organizationId;
  if (metaOrg && metaOrg !== organizationId) {
    return { result: "ignored", organizationId: null };
  }

  // 同じ組織のイベントを 1 つずつ処理する（比べてから書くまでの間に、
  // 別のイベントが割り込まない）
  await lockOrganization(organizationId, tx);
  const stored = await findSubscription(organizationId, tx);
  const snapshot = snapshotOf(sub);
  const eventAt = new Date(event.created * 1000);
  if (isStaleEvent(stored, snapshot, eventAt)) {
    return { result: "stale", organizationId };
  }

  const plan: PlanId = planForSubscription(snapshot, proPriceIds);
  await updateSubscriptionState(
    organizationId,
    { ...snapshot, plan, lastEventAt: eventAt },
    tx,
  );
  const before = {
    plan: toPlanId(stored?.plan),
    status: stored?.status,
  };
  if (before.plan !== plan || before.status !== snapshot.status) {
    await createAuditLog(
      {
        organizationId,
        actorUserId: STRIPE_ACTOR_ID,
        action: "subscription.update",
        targetType: "subscription",
        targetId: snapshot.stripeSubscriptionId,
        diff: {
          from: before,
          to: { plan, status: snapshot.status },
          eventId: event.id,
          eventType: event.type,
        },
      },
      tx,
    );
  }
  return { result: "applied", organizationId };
}

/**
 * Stripe のイベントを 1 回だけ処理する。イベント ID の記録と反映を
 * 同じトランザクションで行うので、
 * - 同じイベントが 2 回届いても、2 回目は duplicate で何もしない
 * - 処理の途中で失敗したら記録も残らず、Stripe の再送で処理し直す
 */
export async function handleStripeEvent(
  event: Stripe.Event,
  proPriceIds: readonly string[] = proPriceIdsFromEnv(),
): Promise<StripeEventOutcome> {
  return runInTransaction(async (tx) => {
    const claimed = await claimStripeEvent(
      {
        id: event.id,
        type: event.type,
        createdAt: new Date(event.created * 1000),
      },
      tx,
    );
    if (!claimed) return "duplicate";
    const { result, organizationId } = await applySubscriptionEvent(
      event,
      proPriceIds,
      tx,
    );
    await setStripeEventResult(event.id, result, organizationId, tx);
    return result;
  });
}
