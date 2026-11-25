/**
 * 非同期ジョブの Worker（F-11・F-13）。Next.js とは別のプロセスで動かす：
 *   npm run worker
 * 本番は ECS の別サービスとして、アプリと同じイメージから起動する（第16章）。
 *
 * - SQS（ローカルは ElasticMQ）をロングポーリングで受け、ジョブを処理する
 * - 1 分ごとに、キューに届いていないジョブを送り直す（Outbox の掃除）
 * - 15 分ごとに、前日リマインドのジョブを積む（本番は EventBridge Scheduler に
 *   置き換えられる。何度実行しても同じ予約・日時には 1 通だけ）
 * - SIGINT・SIGTERM で、処理中のメッセージを終えてから止まる。受信の待ち
 *   （ロングポーリング、最大 20 秒）は中断せず、受け取った分を処理してから止まる。
 *   中断すると、キューが中断された受信にメッセージを渡してしまい、可視性
 *   タイムアウト（60 秒）の間届かず、受信の回数（DLQ までの 3 回）も 1 つ減る
 *   （第18章で、receiveCount が 2 なのに処理のスパンが 1 つのトレースから見つけた）
 * - 1 通ごとに CONSUMER のスパンを作る。親は送った側（web の
 *   リクエスト）のスパンなので、リクエストからジョブまでが 1 本のトレースになる。
 *   ログには jobId・messageId・receiveCount を付ける（第18章）
 */
import "@/server/load-env";
import { telemetry } from "./telemetry";
import { getPrisma } from "@/server/db";
import { logger, withLogContext } from "@/server/logger";
import {
  deleteJobMessage,
  parseJobMessage,
  receiveJobMessages,
  retryJobMessageAfter,
  type ReceivedMessage,
} from "@/server/queue";
import {
  createJobHandlers,
  scheduleReminders,
} from "@/server/services/job-handlers";
import { sweepStrandedJobs } from "@/server/services/jobs";
import {
  extractTraceContext,
  SpanKind,
  withSpan,
} from "@/server/telemetry/tracing";
import { processMessage } from "./process-message";

const SWEEP_INTERVAL_MS = 60_000;
const REMINDER_INTERVAL_MS = Number(
  process.env.WORKER_REMINDER_INTERVAL_MS ?? 15 * 60_000,
);

const handlers = createJobHandlers();
const stopping = new AbortController();

async function handle(message: ReceivedMessage): Promise<void> {
  const jobId = parseJobMessage(message.body)?.jobId;
  await withLogContext(
    {
      jobId,
      messageId: message.messageId,
      receiveCount: message.receiveCount,
    },
    () =>
      withSpan(
        "process flowdesk-jobs",
        {
          "messaging.system": "aws_sqs",
          "messaging.operation.type": "process",
          "messaging.destination.name": "flowdesk-jobs",
          "messaging.message.id": message.messageId ?? "",
          "messaging.aws.sqs.receive_count": message.receiveCount,
          "flowdesk.job.id": jobId ?? "",
        },
        async (span) => {
          const started = performance.now();
          try {
            const action = await processMessage(
              message.body,
              handlers,
            );
            span.setAttribute("flowdesk.message.action", action.type);
            if (action.type === "delete") {
              await deleteJobMessage(message.receiptHandle);
            } else if (action.type === "retry") {
              await retryJobMessageAfter(
                message.receiptHandle,
                action.afterSeconds,
              );
            }
            logger.info("メッセージを処理した", {
              action: action.type,
              durationMs: Math.round(performance.now() - started),
            });
          } catch (error) {
            // DB に接続できないなど。消さずに置き、可視性タイムアウトの後に受け直す
            span.setAttribute("flowdesk.message.action", "error");
            logger.error("メッセージを処理できなかった", {
              err: error,
              durationMs: Math.round(performance.now() - started),
            });
          }
        },
        {
          kind: SpanKind.CONSUMER,
          parent: extractTraceContext(message.traceCarrier),
        },
      ),
  );
}

function every(
  task: string,
  intervalMs: number,
  run: () => Promise<number>,
): NodeJS.Timeout {
  const tick = () =>
    withSpan(`worker.${task}`, {}, run)
      .then((count) => {
        if (count > 0) logger.info("定期処理", { task, count });
      })
      .catch((error: unknown) => {
        logger.error("定期処理に失敗", { task, err: error });
      });
  void tick();
  return setInterval(tick, intervalMs);
}

async function main(): Promise<void> {
  logger.info("Worker を起動した");
  const timers = [
    every("sweep-stranded-jobs", SWEEP_INTERVAL_MS, () =>
      sweepStrandedJobs(new Date()),
    ),
    every("schedule-reminders", REMINDER_INTERVAL_MS, () =>
      scheduleReminders(new Date()),
    ),
  ];

  let consecutiveReceiveErrors = 0;
  while (!stopping.signal.aborted) {
    let messages: ReceivedMessage[];
    try {
      messages = await receiveJobMessages();
      consecutiveReceiveErrors = 0;
    } catch (error) {
      consecutiveReceiveErrors += 1;
      logger.error("キューから受け取れなかった", {
        err: error,
        consecutiveErrors: consecutiveReceiveErrors,
      });
      if (!stopping.signal.aborted) {
        await new Promise((r) => setTimeout(r, 5_000));
      }
      continue;
    }
    // 1 通ずつ処理する（同時に処理する数は Worker の台数で調整する）
    for (const message of messages) await handle(message);
  }

  for (const timer of timers) clearInterval(timer);
  await getPrisma().$disconnect();
  // 送り切っていないスパンを送る
  await telemetry.shutdown().catch(() => {});
  logger.info("Worker を止めた");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    logger.info(
      "停止の合図を受けた。受信の待ちと処理中のメッセージを終えてから止まる",
      {
        signal,
      },
    );
    stopping.abort();
  });
}

main().catch((error: unknown) => {
  logger.error("Worker が異常終了した", { err: error });
  process.exitCode = 1;
});
