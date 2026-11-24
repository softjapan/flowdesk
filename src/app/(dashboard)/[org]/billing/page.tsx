import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toZonedYmd } from "@/lib/datetime";
import { formatYen } from "@/lib/money";
import { getBillingPage } from "@/server/services/billing";
import { getOrgContext } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";
import { openPortalAction, startCheckoutAction } from "./actions";
import { BillingActionButton } from "./_components/billing-action-button";

function limitText(
  current: number,
  max: number | null,
  unit: string,
) {
  return max === null
    ? `${current} ${unit}（上限なし）`
    : `${current} / ${max} ${unit}`;
}

// S-14 料金プラン・請求（Owner）
export default async function BillingPage({
  params,
  searchParams,
}: PageProps<"/[org]/billing">) {
  const { org } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  if (!ctx) notFound();
  const result = await getBillingPage(ctx);
  if (!result.ok) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">料金プラン</h1>
        <p className="text-sm text-muted-foreground">
          料金プランを変更できるのは Owner です。
        </p>
      </div>
    );
  }
  const page = result.value;
  const { usage } = page;
  const { checkout } = await searchParams;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">料金プラン</h1>

      {checkout === "success" && (
        <p role="status" className="text-sm">
          お申し込みを受け付けました。Stripe
          からの通知を受け取るとプランが切り替わります（数秒かかることがあります。表示が変わらなければ読み込み直してください）。
        </p>
      )}
      {checkout === "canceled" && (
        <p role="status" className="text-sm text-muted-foreground">
          お申し込みを取り消しました。
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="flex items-center gap-2">
              現在のプラン
              <Badge>{usage.label}</Badge>
            </h2>
          </CardTitle>
          <CardDescription>
            契約の状態：{page.statusLabel}
            {page.currentPeriodEnd &&
              `（${page.cancelAtPeriodEnd ? "解約日" : "次回の更新日"}：${toZonedYmd(page.currentPeriodEnd, ctx.timezone)}）`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            スタッフ：{limitText(usage.staff, usage.maxStaff, "人")}
          </p>
          <p>
            店舗：
            {limitText(usage.locations, usage.maxLocations, "つ")}
          </p>
        </CardContent>
      </Card>

      {!page.configured && (
        <p className="text-sm text-muted-foreground">
          Stripe の API キーと Price
          が設定されていないため、申し込みとカスタマーポータルは使えません（README
          の「Stripe（テストモード）」を参照）。
        </p>
      )}

      {usage.plan === "free" && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Pro プラン</h2>
            </CardTitle>
            <CardDescription>
              月額 {formatYen(page.proPriceYen)}
              。スタッフと店舗の数に上限がありません。
            </CardDescription>
          </CardHeader>
          {page.canCheckout && (
            <CardContent>
              <BillingActionButton
                action={startCheckoutAction.bind(null, ctx.slug)}
                label="Pro に申し込む"
                pendingLabel="Stripe に移動しています…"
              />
            </CardContent>
          )}
        </Card>
      )}

      {page.canOpenPortal && (
        <section className="space-y-2" aria-labelledby="portal-title">
          <h2 id="portal-title" className="font-semibold">
            プランの変更・解約・お支払い方法
          </h2>
          <p className="text-sm text-muted-foreground">
            Stripe
            のカスタマーポータルで、プランの変更・解約、カードの変更、請求書の確認ができます。
          </p>
          <BillingActionButton
            action={openPortalAction.bind(null, ctx.slug)}
            label="カスタマーポータルを開く"
            pendingLabel="Stripe に移動しています…"
            variant="outline"
          />
        </section>
      )}
    </div>
  );
}
