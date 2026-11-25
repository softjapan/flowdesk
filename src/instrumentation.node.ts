/**
 * Next.js（web）のトレース・ログの初期化。src/instrumentation.ts から
 * Node.js のときだけ読み込む。
 */
import { installConsoleBridge, logger } from "@/server/logger";
import {
  buildRequestLog,
  isRootRequestSpan,
} from "@/server/telemetry/request-log";
import { startTelemetry } from "@/server/telemetry/sdk";

const SERVICE_NAME = "flowdesk-web";

// Next.js が console に出すログ（起動・例外）も 1 行の JSON にする
if (process.env.NODE_ENV === "production") installConsoleBridge();

startTelemetry({
  serviceName: SERVICE_NAME,
  onSpanEnd: (span) => {
    const info = {
      name: span.name,
      attributes: span.attributes,
      durationMs: span.duration[0] * 1e3 + span.duration[1] / 1e6,
    };
    if (!isRootRequestSpan(info)) return;
    const record = buildRequestLog(
      info,
      process.env.LOG_EMF_NAMESPACE,
      SERVICE_NAME,
    );
    if (!record) return;
    // スパンは終わっているので、追跡の ID はスパンから付ける
    const sc = span.spanContext();
    logger.raw({ ...record, traceId: sc.traceId, spanId: sc.spanId });
  },
});
