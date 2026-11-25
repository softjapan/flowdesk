import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRecord } from "@/server/logger";
import { buildRequestLog, isRootRequestSpan } from "./request-log";
import { samplingRatio } from "./sdk";
import {
  currentTraceId,
  extractTraceContext,
  injectTraceContext,
  SpanKind,
  withSpan,
} from "./tracing";

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(
    new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    }),
  );
});

afterAll(() => {
  trace.disable();
  context.disable();
  propagation.disable();
});

describe("SQS のメッセージ属性でトレースをつなぐ", () => {
  it("送る側の文脈を属性に入れ、受ける側のスパンが同じトレースの子になる", async () => {
    exporter.reset();
    let attributes: ReturnType<typeof injectTraceContext> = {};
    let sendTraceId: string | undefined;
    await withSpan(
      "send flowdesk-jobs",
      {},
      async () => {
        sendTraceId = currentTraceId();
        attributes = injectTraceContext();
      },
      { kind: SpanKind.PRODUCER },
    );
    expect(attributes.traceparent?.DataType).toBe("String");

    // Worker：属性（StringValue）から文脈を取り出して親にする
    const carrier = Object.fromEntries(
      Object.entries(attributes).map(([k, v]) => [k, v.StringValue]),
    );
    let consumeTraceId: string | undefined;
    let logTraceId: unknown;
    await withSpan(
      "process flowdesk-jobs",
      {},
      async () => {
        consumeTraceId = currentTraceId();
        logTraceId = buildRecord("info", "x").traceId;
      },
      {
        kind: SpanKind.CONSUMER,
        parent: extractTraceContext(carrier),
      },
    );

    expect(consumeTraceId).toBe(sendTraceId);
    expect(logTraceId).toBe(sendTraceId);
    const [send, consume] = exporter.getFinishedSpans();
    expect(consume?.parentSpanContext?.spanId).toBe(
      send?.spanContext().spanId,
    );
  });

  it("属性がない（Outbox の送り直し）ときは新しいトレースになる", async () => {
    const id = await withSpan(
      "process flowdesk-jobs",
      {},
      async () => currentTraceId(),
      { parent: extractTraceContext({}) },
    );
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("例外はスパンを ERROR にして投げ直す", async () => {
    exporter.reset();
    await expect(
      withSpan("job mail.send", {}, async () => {
        throw new Error("ECONNREFUSED");
      }),
    ).rejects.toThrow("ECONNREFUSED");
    expect(exporter.getFinishedSpans()[0]?.status.code).toBe(2);
  });
});

describe("アクセスログと EMF", () => {
  const span = {
    name: "GET /[org]/reservations",
    durationMs: 175.94,
    attributes: {
      "next.span_type": "BaseServer.handleRequest",
      "next.route": "/[org]/reservations",
      "http.method": "GET",
      "http.status_code": 503,
      "http.target": "/demo-salon/reservations?q=山田",
    },
  };

  it("内側の handleRequest（next.route あり）だけを数える", () => {
    expect(isRootRequestSpan(span)).toBe(true);
    expect(
      isRootRequestSpan({
        ...span,
        attributes: { "next.span_type": "BaseServer.handleRequest" },
      }),
    ).toBe(false);
  });

  it("ルートのパターンを出し、クエリ（検索語）を出さない", () => {
    const record = buildRequestLog(span, undefined, "flowdesk-web");
    expect(record).toEqual({
      msg: "request",
      method: "GET",
      route: "/[org]/reservations",
      status: 503,
      durationMs: 175.9,
      rsc: false,
    });
  });

  it("namespace があれば EMF（Service の次元で RequestDuration・Request5xx）を付ける", () => {
    const record = buildRequestLog(
      span,
      "FlowDesk",
      "flowdesk-web",
      1,
    );
    expect(record).toMatchObject({
      Service: "flowdesk-web",
      RequestDuration: 175.9,
      Request5xx: 1,
      _aws: {
        Timestamp: 1,
        CloudWatchMetrics: [
          {
            Namespace: "FlowDesk",
            Dimensions: [["Service"]],
            Metrics: [
              { Name: "RequestDuration", Unit: "Milliseconds" },
              { Name: "Request5xx", Unit: "Count" },
            ],
          },
        ],
      },
    });
  });

  it("ヘルスチェックと静的ファイルは数えない", () => {
    for (const route of [
      "/api/health",
      "/_next/static/chunks/a.js",
    ]) {
      expect(
        buildRequestLog(
          {
            ...span,
            attributes: { ...span.attributes, "next.route": route },
          },
          "FlowDesk",
          "flowdesk-web",
        ),
      ).toBeNull();
    }
  });
});

describe("samplingRatio", () => {
  it.each([
    [undefined, 1],
    ["", 1],
    ["0.1", 0.1],
    ["0", 0],
    ["2", 1],
    ["abc", 1],
  ])("%s → %s", (input, expected) => {
    expect(samplingRatio(input)).toBe(expected);
  });
});
