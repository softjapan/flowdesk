/**
 * 構造化ログ（第18章、docs/observability.md）。1 行に 1 つの JSON を出し、
 * ECS の awslogs ドライバーがそのまま CloudWatch Logs に送る。Logs Insights は
 * JSON のキーをそのまま検索・集計に使える（`filter traceId = "..."`）。
 *
 * - 追跡の ID：実行中のスパンの traceId・spanId を必ず付ける。リクエストの ID は
 *   traceId と同じ値（応答の x-request-id、src/proxy.ts）。ジョブは jobId を
 *   withLogContext で付ける（src/worker/index.ts）
 * - 個人情報・秘密を出さない：キーの名前で値を伏せ（SENSITIVE_KEY）、文字列の
 *   中のメールアドレス・電話番号・URL の資格情報・署名付き URL の署名を置き換える。
 *   呼び出す側も、顧客の値ではなく ID を渡す（docs/observability.md の 2）
 * - 本番（NODE_ENV=production）と LOG_FORMAT=json は JSON。手元は 1 行の読みやすい形
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { format as formatArgs } from "node:util";
import { trace } from "@opentelemetry/api";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACTED = "[REDACTED]";

/** 値をまるごと伏せるキー（大文字・小文字、- と _ の違いは無視する） */
const SENSITIVE_KEY =
  /^(pass(word)?|secret|.*secret|token|.*token|authorization|cookie|set-cookie|api-?key|email|.*email|phone|tel|address|note|notes|html|text|body|subject|to|from|cc|bcc|name|display-?name|name-?kana|customer-?name|staff-?name|database-?url|connection-?string|receipt-?handle)$/i;

/** 文字列の中の個人情報・秘密を置き換える（メッセージ・エラー・スタックにも使う） */
export function scrubText(text: string): string {
  return (
    text
      // URL の資格情報（スキーム://ユーザー:パスワード@ホスト）
      .replace(
        /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
        "$1[REDACTED]@",
      )
      // 署名付き URL・パスワード再設定のリンクのトークン
      .replace(
        /([?&](?:token|code|signature|x-amz-signature|x-amz-credential|x-amz-security-token)=)[^&\s"']+/gi,
        "$1[REDACTED]",
      )
      // Stripe などの鍵の形
      .replace(
        /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g,
        "[REDACTED_KEY]",
      )
      .replace(/\bwhsec_[A-Za-z0-9]+/g, "[REDACTED_KEY]")
      .replace(
        /\bBearer\s+[A-Za-z0-9._~+/-]+=*/g,
        "Bearer [REDACTED]",
      )
      .replace(
        /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
        "[email]",
      )
      // 日本の電話番号（ハイフンあり・なし、+81）
      .replace(
        /(?:\+81[-\s]?|\b0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}\b/g,
        "[phone]",
      )
  );
}

type SerializedError = {
  name: string;
  message: string;
  code?: string;
  stack?: string;
  errors?: SerializedError[];
  cause?: SerializedError | string;
};

export function serializeError(
  error: unknown,
  depth = 0,
): SerializedError {
  if (!(error instanceof Error)) {
    return { name: "NonError", message: scrubText(String(error)) };
  }
  const code = (error as { code?: unknown }).code;
  const out: SerializedError = {
    name: error.name,
    message: scrubText(error.message),
    ...(code !== undefined ? { code: String(code) } : {}),
    ...(error.stack ? { stack: scrubText(error.stack) } : {}),
  };
  if (depth < 3) {
    if (error instanceof AggregateError && error.errors.length > 0) {
      out.errors = error.errors.map((e) =>
        serializeError(e, depth + 1),
      );
    }
    if (error.cause !== undefined) {
      out.cause = serializeError(error.cause, depth + 1);
    }
  }
  return out;
}

/** キーで伏せ、文字列を置き換え、Error を直す。循環と深すぎる入れ子は打ち切る */
export function redact(
  value: unknown,
  depth = 0,
  seen = new WeakSet(),
): unknown {
  if (value instanceof Error) return serializeError(value);
  if (typeof value === "string") return scrubText(value);
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return "[Circular]";
  if (depth >= 6) return "[Truncated]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redact(v, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] =
      SENSITIVE_KEY.test(key.replace(/_/g, "-")) && v != null
        ? REDACTED
        : redact(v, depth + 1, seen);
  }
  return out;
}

// ---- 文脈（jobId など） -----------------------------------------------------
const contextStorage = new AsyncLocalStorage<LogFields>();

/** fn の中（非同期の続きを含む）のログに fields を付ける */
export function withLogContext<T>(fields: LogFields, fn: () => T): T {
  const parent = contextStorage.getStore() ?? {};
  return contextStorage.run({ ...parent, ...fields }, fn);
}

// ---- 出力 -------------------------------------------------------------------
type Sink = (level: LogLevel, line: string) => void;

const defaultSink: Sink = (level, line) => {
  const stream =
    level === "warn" || level === "error"
      ? process.stderr
      : process.stdout;
  stream.write(`${line}\n`);
};

const state: { sink: Sink } = { sink: defaultSink };

/** テスト用：出力先を差し替える。戻り値で元に戻す */
export function setLogSink(sink: Sink): () => void {
  const previous = state.sink;
  state.sink = sink;
  return () => {
    state.sink = previous;
  };
}

function minLevel(): number {
  const configured = process.env.LOG_LEVEL as LogLevel | undefined;
  return LEVELS[configured ?? "info"] ?? LEVELS.info;
}

function isJsonFormat(): boolean {
  const format = process.env.LOG_FORMAT;
  if (format === "json") return true;
  if (format === "pretty") return false;
  return process.env.NODE_ENV === "production";
}

/** ログの 1 行を作る（テストから直接呼ぶ） */
export function buildRecord(
  level: LogLevel,
  msg: string,
  fields: LogFields = {},
  now = new Date(),
): Record<string, unknown> {
  const spanContext = trace.getActiveSpan()?.spanContext();
  const traceIds =
    spanContext && trace.isSpanContextValid(spanContext)
      ? { traceId: spanContext.traceId, spanId: spanContext.spanId }
      : {};
  const { err, ...rest } = fields;
  return {
    time: now.toISOString(),
    level,
    msg: scrubText(msg),
    service: process.env.OTEL_SERVICE_NAME,
    ...traceIds,
    ...(redact(contextStorage.getStore() ?? {}) as LogFields),
    ...(redact(rest) as LogFields),
    ...(err !== undefined ? { err: serializeError(err) } : {}),
  };
}

function pretty(record: Record<string, unknown>): string {
  const { time, level, msg, service, err, ...rest } = record;
  void service;
  const t = String(time).slice(11, 23);
  const extra =
    Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  const e = err as SerializedError | undefined;
  const errText = e
    ? `\n  ${e.stack ?? `${e.name}: ${e.message}`}`
    : "";
  return `${t} ${String(level).toUpperCase().padEnd(5)} ${String(msg)}${extra}${errText}`;
}

function write(
  level: LogLevel,
  msg: string,
  fields?: LogFields,
): void {
  if (LEVELS[level] < minLevel()) return;
  const record = buildRecord(level, msg, fields);
  let line: string;
  try {
    line = isJsonFormat() ? JSON.stringify(record) : pretty(record);
  } catch {
    line = JSON.stringify({
      time: record.time,
      level,
      msg: record.msg,
    });
  }
  state.sink(level, line);
}

/**
 * ロガー。fields には ID と件数・時間などを渡す（顧客の名前・メールアドレス・
 * 本文を渡さない。渡しても SENSITIVE_KEY のキーは伏せる）。
 * 例外は fields.err に渡すと、名前・メッセージ・コード・スタックを出す
 */
export const logger = {
  debug: (msg: string, fields?: LogFields) =>
    write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) =>
    write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) =>
    write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) =>
    write("error", msg, fields),
  /** EMF などの、形を決めた JSON をそのまま 1 行で出す（文脈・追跡の ID は付ける） */
  raw: (record: LogFields) => {
    const line = JSON.stringify({
      ...buildRecord("info", String(record.msg ?? ""), {}),
      ...record,
    });
    state.sink("info", line);
  },
};

/**
 * console.* を logger に流す（Next.js やライブラリが console に出すログも JSON にする）。
 * awslogs は 1 行を 1 件のログにするので、複数行のスタックが分かれないようにする
 */
export function installConsoleBridge(): void {
  const g = globalThis as { __flowdeskConsoleBridge?: boolean };
  if (g.__flowdeskConsoleBridge) return;
  g.__flowdeskConsoleBridge = true;
  const bridge =
    (level: LogLevel) =>
    (...args: unknown[]) => {
      const err = args.find((a) => a instanceof Error);
      const rest = args.filter((a) => a !== err);
      write(level, formatArgs(...rest), {
        source: "console",
        ...(err ? { err } : {}),
      });
    };
  console.log = bridge("info");
  console.info = bridge("info");
  console.debug = bridge("debug");
  console.warn = bridge("warn");
  console.error = bridge("error");
}
