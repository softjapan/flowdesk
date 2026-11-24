// 添付ファイルの署名付き URL の発行（docs/screens.md の /api/uploads/presign、
// F-12）。行うのは入力の検証・認証・Service の呼び出しだけ。権限と
// 組織の絞り込みは Service（src/server/services/attachments.ts）が判定する。
// 他の組織・存在しない組織や顧客は、区別せず 404 にする（存在を漏らさない）
import { fieldErrorsOf } from "@/server/validation/form";
import { requestUpload } from "@/server/services/attachments";
import { getOrgContext } from "@/server/services/org-context";
import { getSession } from "@/server/session";
import { presignRequestSchema } from "@/server/validation/upload";

const noStore = { "Cache-Control": "no-store" };

function error(status: number, message: string, extra?: object) {
  return Response.json(
    { error: message, ...extra },
    { status, headers: noStore },
  );
}

export async function POST(request: Request) {
  // 他のサイトのフォームから送らせない（JSON 以外は CORS のプリフライトなしで
  // 送れてしまうため、application/json だけを受け付ける）
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return error(
      415,
      "Content-Type は application/json にしてください",
    );
  }
  const session = await getSession();
  if (!session) return error(401, "ログインしてください");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, "JSON の形式が不正です");
  }
  const parsed = presignRequestSchema.safeParse(body);
  if (!parsed.success) {
    return error(400, "入力が不正です", {
      fields: fieldErrorsOf(parsed.error),
    });
  }

  const { org, ...input } = parsed.data;
  const ctx = await getOrgContext(org, session.user.id);
  if (!ctx) return error(404, "見つかりません");
  const result = await requestUpload(ctx, input);
  if (!result.ok) {
    return result.reason === "forbidden"
      ? error(403, "この操作を行う権限がありません")
      : error(404, "見つかりません");
  }
  return Response.json(result.value, { headers: noStore });
}
