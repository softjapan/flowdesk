/**
 * 組織の契約（subscription）と、受け取った Stripe のイベント（stripeEvent）。
 * 組織の画面からは organizationId で引く。
 *
 * 例外：Webhook は組織の文脈を持たずに届くので、Stripe の顧客 ID で引く
 * （findSubscriptionByStripeCustomerId）。顧客はサーバーが組織ごとに作り、
 * ID に一意制約があるので、顧客 ID が組織を決める。stripeEvent は
 * イベント ID の重複を見るための表で、イベント ID で引く。
 */
import { type Db, getPrisma } from "@/server/db";
import type { PlanId, SubscriptionSnapshot } from "@/server/plans";

const subscriptionSelect = {
  organizationId: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  plan: true,
  status: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  lastEventAt: true,
} as const;

/** 行がなければ null（その組織は Free） */
export async function findSubscription(
  organizationId: string,
  db: Db = getPrisma(),
) {
  return db.subscription.findUnique({
    where: { organizationId },
    select: subscriptionSelect,
  });
}

/** Webhook 用（上の例外を参照） */
export async function findSubscriptionByStripeCustomerId(
  stripeCustomerId: string,
  db: Db = getPrisma(),
) {
  return db.subscription.findUnique({
    where: { stripeCustomerId },
    select: { organizationId: true },
  });
}

/**
 * Stripe の顧客を組織に結びつける（Checkout の前）。行がなければ
 * 申し込み前（status: none）の行を作る。すでに顧客があれば変えない
 * （lockOrganization したトランザクションで呼ぶ）
 */
export async function attachStripeCustomer(
  organizationId: string,
  stripeCustomerId: string,
  db: Db,
): Promise<void> {
  await db.subscription.upsert({
    where: { organizationId },
    create: { organizationId, stripeCustomerId, status: "none" },
    update: {},
  });
  await db.subscription.updateMany({
    where: { organizationId, stripeCustomerId: null },
    data: { stripeCustomerId },
  });
}

/** Webhook で受け取ったサブスクリプションの状態を反映する */
export async function updateSubscriptionState(
  organizationId: string,
  state: SubscriptionSnapshot & { plan: PlanId; lastEventAt: Date },
  db: Db,
): Promise<boolean> {
  const { count } = await db.subscription.updateMany({
    where: { organizationId },
    data: state,
  });
  return count === 1;
}

/**
 * イベントを受け取ったことを記録する。すでに記録があれば false
 * （同じイベントの 2 回目）。同時に 2 回届いたときは、後の INSERT が
 * 先のトランザクションの終わりを待ってから一意制約で何もしない
 */
export async function claimStripeEvent(
  event: { id: string; type: string; createdAt: Date },
  db: Db,
): Promise<boolean> {
  const { count } = await db.stripeEvent.createMany({
    data: [
      {
        id: event.id,
        type: event.type,
        createdAt: event.createdAt,
        result: "processing",
      },
    ],
    skipDuplicates: true,
  });
  return count === 1;
}

export async function setStripeEventResult(
  id: string,
  result: "applied" | "stale" | "ignored",
  organizationId: string | null,
  db: Db,
): Promise<void> {
  await db.stripeEvent.update({
    where: { id },
    data: { result, organizationId },
  });
}
