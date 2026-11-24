// 顧客一覧の CSV のダウンロード（F-11）。完了メールのリンクと顧客一覧から
// 開く。権限を確かめ直し、5 分間有効な署名付き URL へリダイレクトする。
// 他の組織・存在しない・未完了のエクスポートは、区別せず 404 にする
import { redirect } from "next/navigation";
import { getCustomerExportUrl } from "@/server/services/customer-exports";
import { getOrgContext } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";
import { idSchema } from "@/server/validation/form";

const noStore = { "Cache-Control": "no-store" };

function notFound() {
  return Response.json(
    { error: "見つかりません" },
    { status: 404, headers: noStore },
  );
}

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/exports/[id]">,
) {
  const { id } = await params;
  const org = new URL(request.url).searchParams.get("org");
  // 未ログインならログイン画面へ送り、ログイン後にこの URL へ戻す
  // （proxy は /api を対象外にしているので、ここで確かめる）
  const userId = await getCurrentUserId();
  const parsedId = idSchema.safeParse(id);
  const parsedOrg = idSchema.safeParse(org);
  if (!parsedId.success || !parsedOrg.success) return notFound();

  const ctx = await getOrgContext(parsedOrg.data, userId);
  if (!ctx) return notFound();
  const result = await getCustomerExportUrl(ctx, parsedId.data);
  if (!result.ok) {
    return result.reason === "forbidden"
      ? Response.json(
          { error: "この操作を行う権限がありません" },
          { status: 403, headers: noStore },
        )
      : notFound();
  }
  redirect(result.value.url);
}
