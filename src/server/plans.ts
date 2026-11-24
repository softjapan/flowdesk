/**
 * 料金プラン（F-14・F-15、docs/billing.md）と、Stripe のサブスクリプション
 * から組織のプランを決める規則。DB にも Stripe の API にも依存しない
 * （単体テストで確かめる。画面からも import type できる）。
 */

export type PlanId = "free" | "pro";

export type Plan = {
  label: string;
  /** 月額（税込・円）。表示用で、請求額は Stripe の Price が正 */
  priceYen: number;
  /** スタッフ（予約を担当するメンバー）の上限。null は上限なし */
  maxStaff: number | null;
  /** 店舗の上限。null は上限なし */
  maxLocations: number | null;
};

export const PLANS: Record<PlanId, Plan> = {
  free: { label: "Free", priceYen: 0, maxStaff: 2, maxLocations: 1 },
  pro: {
    label: "Pro",
    priceYen: 3000,
    maxStaff: null,
    maxLocations: null,
  },
};

export function toPlanId(value: string | null | undefined): PlanId {
  return value === "pro" ? "pro" : "free";
}

/** 上限に達していなければ true */
export function withinLimit(
  limit: number | null,
  current: number,
): boolean {
  return limit === null || current < limit;
}

/**
 * Pro の機能を使える status。past_due（支払いの失敗後、Stripe が再試行
 * している間）は、カードの更新を待つあいだ Pro のままにする。
 * 再試行が尽きると Stripe が canceled か unpaid にする（設定による）
 */
const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

/** 同じサブスクリプションがこの status から別の status に戻ることはない */
const TERMINAL_STATUSES = new Set(["canceled", "incomplete_expired"]);

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  none: "未契約",
  incomplete: "支払いの確認待ち",
  incomplete_expired: "申し込みの期限切れ",
  trialing: "試用中",
  active: "有効",
  past_due: "支払いの遅れ（カードを更新してください）",
  unpaid: "未払い",
  canceled: "解約済み",
  paused: "一時停止中",
};

/** Webhook で受け取ったサブスクリプションのうち、組織のプランに関わる部分 */
export type SubscriptionSnapshot = {
  stripeSubscriptionId: string;
  status: string;
  stripePriceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

/**
 * サブスクリプションの状態からプランを決める。Pro の Price
 * （STRIPE_PRICE_PRO）以外の Price は Pro として扱わない
 */
export function planForSubscription(
  snapshot: Pick<SubscriptionSnapshot, "status" | "stripePriceId">,
  proPriceIds: readonly string[],
): PlanId {
  return ENTITLED_STATUSES.has(snapshot.status) &&
    snapshot.stripePriceId !== null &&
    proPriceIds.includes(snapshot.stripePriceId)
    ? "pro"
    : "free";
}

/** DB に保存してある、最後に反映したイベントの結果 */
export type StoredSubscription = {
  stripeSubscriptionId: string | null;
  status: string;
  lastEventAt: Date | null;
};

/**
 * 届いたイベントを反映せずに捨てるか（順番の入れ替わり対策）。
 * Stripe はイベントの順番を保証しないので、イベントの作成日時
 * （event.created、秒単位）で比べ、古いものは反映しない。
 * 同じ秒に作られたイベントは日時で順番が決まらないので、
 * サブスクリプションの status が戻れない向きの変化を捨てる。
 */
export function isStaleEvent(
  stored: StoredSubscription | null,
  incoming: Pick<
    SubscriptionSnapshot,
    "stripeSubscriptionId" | "status"
  >,
  eventAt: Date,
): boolean {
  if (!stored?.lastEventAt) return false;
  if (eventAt < stored.lastEventAt) return true;

  const same =
    stored.stripeSubscriptionId === incoming.stripeSubscriptionId;
  if (same) {
    // 終了したサブスクリプションは再開しない（Stripe でも再開できない）
    if (
      TERMINAL_STATUSES.has(stored.status) &&
      !TERMINAL_STATUSES.has(incoming.status)
    ) {
      return true;
    }
    // incomplete は作成直後だけの status。有効になった後に戻らない
    return (
      incoming.status === "incomplete" &&
      stored.status !== "incomplete"
    );
  }
  // 別のサブスクリプションの終了（二重に申し込んだ古い方の解約など）で、
  // 有効なサブスクリプションを上書きしない
  return (
    stored.stripeSubscriptionId !== null &&
    ENTITLED_STATUSES.has(stored.status) &&
    !ENTITLED_STATUSES.has(incoming.status)
  );
}
