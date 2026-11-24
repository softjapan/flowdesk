/**
 * 非同期ジョブの Worker（F-11・F-13）。Next.js とは別のプロセスで動かす：
 *   npm run worker
 * 本番は ECS の別サービスとして、アプリと同じイメージから起動する（第16章）。
 *
 * - SQS（ローカルは ElasticMQ）をロングポーリングで受け、ジョブを処理する
 * - 1 分ごとに、キューに届いていないジョブを送り直す（Outbox の掃除）
 * - 15 分ごとに、前日リマインドのジョブを積む（本番は EventBridge Scheduler に
 *   置き換えられる。何度実行しても同じ予約・日時には 1 通だけ）
 * - SIGINT・SIGTERM で、処理中のメッセージを終えてから止まる
 */
import "@/server/load-env";
import { getPrisma } from "@/server/db";
import {
  deleteJobMessage,
  receiveJobMessages,
  retryJobMessageAfter,
  type ReceivedMessage,
} from "@/server/queue";
import {
  createJobHandlers,
  scheduleReminders,
} from "@/server/services/job-handlers";
import { sweepStrandedJobs } from "@/server/services/jobs";
import { processMessage } from "./process-message";

const SWEEP_INTERVAL_MS = 60_000;
const REMINDER_INTERVAL_MS = Number(
  process.env.WORKER_REMINDER_INTERVAL_MS ?? 15 * 60_000,
);

const handlers = createJobHandlers();
const stopping = new AbortController();

async function handle(message: ReceivedMessage): Promise<void> {
  try {
    const action = await processMessage(message.body, handlers);
    if (action.type === "delete") {
      await deleteJobMessage(message.receiptHandle);
    } else if (action.type === "retry") {
      await retryJobMessageAfter(
        message.receiptHandle,
        action.afterSeconds,
      );
    }
  } catch (error) {
    // DB に接続できないなど。消さずに置き、可視性タイムアウトの後に受け直す
    console.error("メッセージを処理できなかった", error);
  }
}

function every(
  name: string,
  intervalMs: number,
  task: () => Promise<number>,
): NodeJS.Timeout {
  const run = () =>
    task()
      .then((count) => {
        if (count > 0) console.log(`${name}：${count} 件`);
      })
      .catch((error: unknown) => {
        console.error(`${name}に失敗`, error);
      });
  void run();
  return setInterval(run, intervalMs);
}

async function main(): Promise<void> {
  console.log("Worker を起動した", {
    queue: process.env.SQS_QUEUE_URL,
  });
  const timers = [
    every("未送信のジョブの送り直し", SWEEP_INTERVAL_MS, () =>
      sweepStrandedJobs(new Date()),
    ),
    every("前日リマインドの登録", REMINDER_INTERVAL_MS, () =>
      scheduleReminders(new Date()),
    ),
  ];

  while (!stopping.signal.aborted) {
    let messages: ReceivedMessage[];
    try {
      messages = await receiveJobMessages(stopping.signal);
    } catch (error) {
      if (stopping.signal.aborted) break;
      console.error("キューから受け取れなかった", error);
      await new Promise((r) => setTimeout(r, 5_000));
      continue;
    }
    // 1 通ずつ処理する（同時に処理する数は Worker の台数で調整する）
    for (const message of messages) await handle(message);
  }

  for (const timer of timers) clearInterval(timer);
  await getPrisma().$disconnect();
  console.log("Worker を止めた");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(
      `${signal} を受けた。処理中のメッセージを終えてから止まる`,
    );
    stopping.abort();
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
