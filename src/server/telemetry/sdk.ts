/**
 * OpenTelemetry の SDK の起動（第18章、docs/observability.md の 3）。
 * Next.js（src/instrumentation.node.ts）と Worker（src/worker/telemetry.ts）が
 * 最初に 1 回だけ呼ぶ。
 *
 * - トレースの送り先は標準の環境変数 OTEL_EXPORTER_OTLP_ENDPOINT（OTLP/HTTP）。
 *   手元は docker compose の Jaeger（http://localhost:4318）、本番は ECS の
 *   タスクの中の ADOT Collector（http://127.0.0.1:4318）が X-Ray へ送る
 * - 未設定なら送らない。それでもトレース ID は作る（ログの traceId・x-request-id）
 * - サンプリング：OTEL_TRACES_SAMPLER_ARG（0〜1、既定 1）の割合で送る。
 *   送らないスパンも記録はする（AlwaysRecord）ので、アクセスログ・EMF の
 *   メトリクス（request-log.ts）はすべてのリクエストで出る
 * - DB：@prisma/instrumentation（Prisma の操作と SQL のスパン。SQL の値は
 *   載らず、パラメーターは $1 のまま）
 */
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  createAlwaysRecordSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  TracerProvider,
  type ReadableSpan,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { logger } from "@/server/logger";

export type TelemetryOptions = {
  serviceName: string;
  /** 終わったスパンを見る（web のアクセスログ・EMF） */
  onSpanEnd?: (span: ReadableSpan) => void;
};

export type Telemetry = { shutdown: () => Promise<void> };

/** 0〜1 の割合。不正な値は 1（すべて送る） */
export function samplingRatio(value: string | undefined): number {
  const n = Number(value);
  return value !== undefined && value !== "" && n >= 0 && n <= 1
    ? n
    : 1;
}

export function startTelemetry(options: TelemetryOptions): Telemetry {
  const g = globalThis as { __flowdeskTelemetry?: Telemetry };
  if (g.__flowdeskTelemetry) return g.__flowdeskTelemetry;

  process.env.OTEL_SERVICE_NAME ??= options.serviceName;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const ratio = samplingRatio(process.env.OTEL_TRACES_SAMPLER_ARG);

  const spanProcessors: SpanProcessor[] = [];
  if (endpoint) {
    // OTEL_EXPORTER_OTLP_ENDPOINT に /v1/traces を付けて送る
    spanProcessors.push(
      new BatchSpanProcessor({ exporter: new OTLPTraceExporter() }),
    );
  }
  if (options.onSpanEnd) {
    const onEnd = options.onSpanEnd;
    spanProcessors.push({
      onStart: () => {},
      onEnd: (span) => {
        try {
          onEnd(span);
        } catch (error) {
          logger.warn("スパンの後処理に失敗", { err: error });
        }
      },
      forceFlush: async () => {},
      shutdown: async () => {},
    });
  }

  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME,
      // デプロイしたイメージのタグ（Terraform が APP_VERSION に入れる）
      [ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? "local",
      "deployment.environment.name":
        process.env.DEPLOYMENT_ENVIRONMENT ?? "local",
    }),
    sampler: createAlwaysRecordSampler(
      new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(ratio),
      }),
    ),
    spanProcessors,
  });

  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    }),
  );
  trace.setGlobalTracerProvider(provider);
  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [new PrismaInstrumentation()],
  });

  logger.info("トレースを開始した", {
    exporter: endpoint ? "otlp" : "none",
    samplingRatio: ratio,
  });

  g.__flowdeskTelemetry = {
    shutdown: () => provider.shutdown(),
  };
  return g.__flowdeskTelemetry;
}
