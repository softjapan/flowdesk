/**
 * リクエストのアクセスログと、CloudWatch のメトリクス（EMF）（第18章）。
 *
 * Next.js のリクエストの最上位のスパン（BaseServer.handleRequest）が終わったときに
 * 1 行出す。LOG_EMF_NAMESPACE（本番は Terraform が FlowDesk を入れる）があれば、
 * 同じ行に Embedded Metric Format の `_aws` を付け、CloudWatch Logs が
 * RequestDuration（ミリ秒）と Request5xx をメトリクスにする（エージェント不要）。
 *
 * ALB の TargetResponseTime は「最初のバイトまで」の時間で、Cache Components の
 * 画面は静的なシェルを数 ms で返すため、描画の遅さが出ない（docs/performance.md の
 * 計測の方法）。p95 のアラームはこちらのメトリクスを使う。
 * 次元は Service だけ（ルートを次元にするとメトリクスの数＝費用が増える）。
 * ルートは同じ行のプロパティに入るので、Logs Insights でルートごとに集計できる。
 */
import type { Attributes } from "@opentelemetry/api";

/** 静的ファイルとヘルスチェックは数えない（p95 を薄めるため） */
const IGNORED_ROUTE = /^\/(_next\/|api\/health|favicon)/;

export type RequestSpanInfo = {
  name: string;
  attributes: Attributes;
  durationMs: number;
};

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value
    : undefined;
}

/**
 * 数えるスパン。Next.js 16.4.6 は 1 つのリクエストに BaseServer.handleRequest を
 * 2 つ作る：外側（ルートなし。proxy を含み数 ms で終わる）と、内側（next.route
 * あり。本文を流し終えたときに終わる）。手元で、内側の長さが curl の
 * 本文を読み終えた時間と合い、外側は TTFB より短いことを確かめた
 * （docs/observability.md の 3）。内側だけを数える
 */
export function isRootRequestSpan(info: RequestSpanInfo): boolean {
  return (
    info.attributes["next.span_type"] ===
      "BaseServer.handleRequest" &&
    str(info.attributes["next.route"]) !== undefined
  );
}

/** アクセスログの 1 行（EMF を付けるかは namespace で決める）。数えないなら null */
export function buildRequestLog(
  info: RequestSpanInfo,
  namespace: string | undefined,
  service: string,
  now = Date.now(),
): Record<string, unknown> | null {
  const a = info.attributes;
  const route =
    str(a["next.route"]) ?? str(a["http.route"]) ?? "(unknown)";
  const target = str(a["http.target"]) ?? "";
  if (IGNORED_ROUTE.test(route) || IGNORED_ROUTE.test(target))
    return null;
  const status = Number(
    a["http.status_code"] ?? a["http.response.status_code"] ?? 0,
  );
  const method =
    str(a["http.method"]) ?? str(a["http.request.method"]);
  const durationMs = Math.round(info.durationMs * 10) / 10;
  const record: Record<string, unknown> = {
    msg: "request",
    method,
    route,
    status,
    durationMs,
    // RSC のリクエスト（プリフェッチ・画面の切り替え）か
    rsc: a["next.rsc"] === true,
  };
  if (!namespace) return record;
  return {
    ...record,
    Service: service,
    RequestDuration: durationMs,
    Request5xx: status >= 500 ? 1 : 0,
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [
        {
          Namespace: namespace,
          Dimensions: [["Service"]],
          Metrics: [
            { Name: "RequestDuration", Unit: "Milliseconds" },
            { Name: "Request5xx", Unit: "Count" },
          ],
        },
      ],
    },
  };
}
