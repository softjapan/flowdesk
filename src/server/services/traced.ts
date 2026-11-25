/**
 * Service の関数をスパンで包む（第18章）。トレースで「リクエスト → Service → DB」
 * の段を見えるようにする。属性は組織の ID・ロールと結果（ok・失敗の理由）だけ
 * （入力の値は載せない）。
 */
import { withSpan } from "@/server/telemetry/tracing";
import type { OrgContext } from "./org-context";

type ServiceFn<A extends unknown[], R> = (
  ctx: OrgContext,
  ...args: A
) => Promise<R>;

export function traceService<A extends unknown[], R>(
  name: string,
  fn: ServiceFn<A, R>,
): ServiceFn<A, R> {
  return (ctx, ...args) =>
    withSpan(
      `service.${name}`,
      {
        "flowdesk.organization.id": ctx.organizationId,
        "flowdesk.role": ctx.role,
      },
      async (span) => {
        const result = await fn(ctx, ...args);
        if (result && typeof result === "object" && "ok" in result) {
          const r = result as { ok: boolean; reason?: string };
          span.setAttribute(
            "flowdesk.result",
            r.ok ? "ok" : (r.reason ?? "fail"),
          );
        }
        return result;
      },
    );
}
