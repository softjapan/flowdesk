/**
 * トレースの補助（第18章、docs/observability.md の 3）。@opentelemetry/api だけを
 * 使う（SDK が登録されていなければ何もしない。テストや next build でも動く）。
 *
 * 1 本のトレースでたどる流れ：
 *   GET/POST（Next.js のスパン）→ service.*（withSpan）→ prisma:*（DB）
 *     → send flowdesk-jobs（PRODUCER、traceparent を SQS のメッセージ属性に入れる）
 *     → process flowdesk-jobs（Worker、CONSUMER。属性の traceparent を親にする）
 *     → job.*（ハンドラー）→ prisma:*・SMTP
 */
import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";

export const TRACER_NAME = "flowdesk";

export function tracer() {
  return trace.getTracer(TRACER_NAME);
}

/** 例外をスパンに記録する（メッセージは logger と同じく置き換えない。スパンには ID しか載せない） */
function recordError(span: Span, error: unknown): void {
  if (error instanceof Error) {
    span.recordException({
      name: error.name,
      message: error.message,
    });
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.name,
    });
  } else {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
}

/**
 * fn をスパンで包む。属性には ID・件数・種類だけを入れる（個人情報を入れない）。
 * fn が例外を投げたらスパンを ERROR にして投げ直す
 */
export function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  options: { kind?: SpanKind; parent?: Context } = {},
): Promise<T> {
  return tracer().startActiveSpan(
    name,
    { kind: options.kind ?? SpanKind.INTERNAL, attributes },
    options.parent ?? context.active(),
    async (span) => {
      try {
        return await fn(span);
      } catch (error) {
        recordError(span, error);
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/** SQS のメッセージ属性の形（String 型だけ使う） */
export type MessageAttributes = Record<
  string,
  { DataType: "String"; StringValue: string }
>;

/** 今のトレースの文脈（traceparent・tracestate）をメッセージ属性にする */
export function injectTraceContext(
  ctx: Context = context.active(),
): MessageAttributes {
  const carrier: Record<string, string> = {};
  propagation.inject(ctx, carrier);
  return Object.fromEntries(
    Object.entries(carrier).map(([k, v]) => [
      k,
      { DataType: "String" as const, StringValue: v },
    ]),
  );
}

/** 受け取ったメッセージ属性から、送った側のトレースの文脈を取り出す */
export function extractTraceContext(
  carrier: Record<string, string>,
): Context {
  return propagation.extract(context.active(), carrier);
}

/** 今のスパンの traceId（無効なら undefined）。応答の x-request-id に使う */
export function currentTraceId(): string | undefined {
  const sc = trace.getActiveSpan()?.spanContext();
  return sc && trace.isSpanContextValid(sc) ? sc.traceId : undefined;
}

export { SpanKind };
