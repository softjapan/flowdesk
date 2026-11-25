/**
 * Worker のトレース・ログの初期化（第18章）。src/worker/index.ts の最初
 * （load-env の直後、Prisma・AWS SDK より前）に読み込む。
 */
import { installConsoleBridge } from "@/server/logger";
import { startTelemetry } from "@/server/telemetry/sdk";

if (process.env.NODE_ENV === "production") installConsoleBridge();

export const telemetry = startTelemetry({
  serviceName: "flowdesk-worker",
});
