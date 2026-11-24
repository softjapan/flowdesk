/**
 * AWS（S3・SQS）のクライアント。ローカルでは docker compose の
 * RustFS（S3 互換）と ElasticMQ（SQS 互換）に、S3_ENDPOINT・SQS_ENDPOINT
 * で向ける。本番はエンドポイントを設定せず、AWS の既定の接続先を使う。
 *
 * 最初に使うときに作る（環境変数のない CI の next build でも import できる）。
 */
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} が設定されていない（.env.example を参照）`,
    );
  }
  return value;
}

export function s3Bucket(): string {
  return requireEnv("S3_BUCKET");
}

export function sqsQueueUrl(): string {
  return requireEnv("SQS_QUEUE_URL");
}

/** キューが設定されているか（DB のテストでは空にして送信を止める） */
export function isQueueConfigured(): boolean {
  return Boolean(process.env.SQS_QUEUE_URL);
}

/**
 * ローカル（エンドポイントを指定したとき）は .env.example の鍵を明示して使う。
 * SDK の既定の探し方は、AWS_PROFILE があるとそちらを優先するため、
 * 開発者の本物の AWS の鍵を RustFS・ElasticMQ に送ってしまう
 * （InvalidAccessKeyId になる）。本番は既定の探し方（ECS のタスクロール）に任せる
 */
function localCredentials(endpoint: string | undefined) {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  return endpoint && accessKeyId && secretAccessKey
    ? { accessKeyId, secretAccessKey }
    : undefined;
}

const globalForAws = globalThis as unknown as {
  s3?: S3Client;
  sqs?: SQSClient;
};

export function getS3(): S3Client {
  const endpoint = process.env.S3_ENDPOINT || undefined;
  globalForAws.s3 ??= new S3Client({
    region: process.env.AWS_REGION ?? "ap-northeast-1",
    endpoint,
    credentials: localCredentials(endpoint),
    // RustFS は仮想ホスト形式（bucket.localhost）を名前解決できないので、
    // エンドポイントを指定したときはパス形式にする
    forcePathStyle: Boolean(endpoint),
    // SDK の既定では PUT の署名付き URL に CRC32 のチェックサムが入り、
    // ブラウザからの PUT（本文のチェックサムを送らない）が拒否される。
    // 必要な操作のときだけ付ける
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return globalForAws.s3;
}

export function getSqs(): SQSClient {
  const endpoint = process.env.SQS_ENDPOINT || undefined;
  globalForAws.sqs ??= new SQSClient({
    region: process.env.AWS_REGION ?? "ap-northeast-1",
    endpoint,
    credentials: localCredentials(endpoint),
  });
  return globalForAws.sqs;
}
