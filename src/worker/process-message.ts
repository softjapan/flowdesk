/**
 * 受け取った 1 通のメッセージの扱い（Worker の本体から切り出してテストする）。
 * メッセージを消す・消さないの判断はここだけで行う。
 */
import { parseJobMessage } from "@/server/queue";
import {
  runJob,
  type Dispatch,
  type JobHandlers,
} from "@/server/services/jobs";

/** 再試行までの秒数（1 回目の失敗の後、2 回目の失敗の後） */
const RETRY_DELAY_SECONDS = [10, 30] as const;
const LAST_RETRY_DELAY_SECONDS = 30;

export type MessageAction =
  /** 処理が終わった・処理しない。メッセージを消す */
  | { type: "delete" }
  /** 消さずに置き、指定した秒数の後に再配信させる */
  | { type: "retry"; afterSeconds: number }
  /** 消さずに置く（可視性タイムアウトのまま。DLQ 行きもこれ） */
  | { type: "keep" };

export async function processMessage(
  body: string | undefined,
  handlers: JobHandlers,
  options: { now?: Date; dispatch?: Dispatch } = {},
): Promise<MessageAction> {
  const message = parseJobMessage(body);
  if (!message) {
    // 形式の違うメッセージは何度受けても処理できない
    console.error("形式の違うメッセージを捨てる", body);
    return { type: "delete" };
  }
  const outcome = await runJob(message.jobId, handlers, options);
  switch (outcome.status) {
    case "done":
      return { type: "delete" };
    case "busy":
      // 他の Worker が処理中。終われば次の配信で done になる
      return { type: "keep" };
    case "retry":
      return {
        type: "retry",
        afterSeconds:
          RETRY_DELAY_SECONDS[outcome.attempts - 1] ??
          LAST_RETRY_DELAY_SECONDS,
      };
    case "dead":
      // 消さずに置くと、次に受信されるときに SQS が DLQ へ移す
      return { type: "keep" };
  }
}
