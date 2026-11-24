/**
 * ジョブのキュー（SQS、ローカルは ElasticMQ）。メッセージには job の id
 * だけを載せ、宛先や本文（パスワード再設定のリンクなど）は DB の job に置く。
 *
 * キューの設定（docker/elasticmq.conf、本番は Terraform）：
 *   可視性タイムアウト 60 秒、3 回受信して削除されなければ
 *   デッドレターキュー（flowdesk-jobs-dlq）へ移す
 */
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { z } from "zod";
import { getSqs, sqsQueueUrl } from "@/server/aws";

const jobMessageSchema = z.object({ jobId: z.string().min(1) });

export type JobMessage = z.infer<typeof jobMessageSchema>;

/** 受け取った本文を検証する。形式が違えば null（処理せず削除する） */
export function parseJobMessage(body: string | undefined) {
  try {
    const parsed = jobMessageSchema.safeParse(JSON.parse(body ?? ""));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function sendJobMessage(jobId: string): Promise<void> {
  const message: JobMessage = { jobId };
  await getSqs().send(
    new SendMessageCommand({
      QueueUrl: sqsQueueUrl(),
      MessageBody: JSON.stringify(message),
    }),
  );
}

export type ReceivedMessage = {
  body: string | undefined;
  receiptHandle: string;
  receiveCount: number;
};

/** ロングポーリングで受け取る（最大 20 秒待つ） */
export async function receiveJobMessages(
  signal?: AbortSignal,
): Promise<ReceivedMessage[]> {
  const result = await getSqs().send(
    new ReceiveMessageCommand({
      QueueUrl: sqsQueueUrl(),
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      MessageSystemAttributeNames: ["ApproximateReceiveCount"],
    }),
    { abortSignal: signal },
  );
  return (result.Messages ?? []).flatMap((m) =>
    m.ReceiptHandle
      ? [
          {
            body: m.Body,
            receiptHandle: m.ReceiptHandle,
            receiveCount: Number(
              m.Attributes?.ApproximateReceiveCount ?? 1,
            ),
          },
        ]
      : [],
  );
}

/** 処理が終わった（または処理しない）メッセージを消す */
export async function deleteJobMessage(
  receiptHandle: string,
): Promise<void> {
  await getSqs().send(
    new DeleteMessageCommand({
      QueueUrl: sqsQueueUrl(),
      ReceiptHandle: receiptHandle,
    }),
  );
}

/** 再試行までの時間を変える（失敗したメッセージを早めに、または遅らせて受け直す） */
export async function retryJobMessageAfter(
  receiptHandle: string,
  seconds: number,
): Promise<void> {
  await getSqs().send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: sqsQueueUrl(),
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: seconds,
    }),
  );
}
