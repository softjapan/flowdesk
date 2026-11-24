// Stripe の Webhook（F-14、docs/billing.md）。行うのは署名の検証と
// Service の呼び出しだけ。署名は加工する前の本文で確かめるので、
// request.json() ではなく request.text() で読む。
//
// 応答：署名が不正なら 400、処理済み・対象外も含めて受け取れたら 200。
// 処理に失敗したら 500 を返し、Stripe に再送させる（イベント ID の記録も
// 取り消されるので、再送で処理し直す）
import { handleStripeEvent } from "@/server/services/billing";
import { verifyStripeWebhook } from "@/server/stripe";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const verified = await verifyStripeWebhook(
    await request.text(),
    request.headers.get("stripe-signature"),
  );
  if (!verified.ok) {
    if (verified.reason === "not_configured") {
      console.error("STRIPE_WEBHOOK_SECRET が設定されていない");
      return Response.json(
        { error: "Webhook が設定されていません" },
        { status: 500, headers: noStore },
      );
    }
    return Response.json(
      { error: "署名を確認できません" },
      { status: 400, headers: noStore },
    );
  }

  try {
    const outcome = await handleStripeEvent(verified.event);
    return Response.json(
      { received: true, outcome },
      { headers: noStore },
    );
  } catch (error) {
    console.error("Stripe のイベントを処理できない", {
      eventId: verified.event.id,
      type: verified.event.type,
      error,
    });
    return Response.json(
      { error: "処理に失敗しました" },
      { status: 500, headers: noStore },
    );
  }
}
