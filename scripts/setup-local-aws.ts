/**
 * ローカルの S3（RustFS）にバケットを作り、ブラウザから署名付き URL で
 * PUT・GET できるよう CORS を設定する。何度実行してもよい。
 *   npm run aws:setup
 * キュー（ElasticMQ）は docker/elasticmq.conf で起動時に作られる。
 * 本番のバケット・キューは Terraform で作る（第16〜17章）。
 */
import "@/server/load-env";
import {
  type BucketLocationConstraint,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { getS3, s3Bucket } from "@/server/aws";

async function main(): Promise<void> {
  const s3 = getS3();
  const Bucket = s3Bucket();
  const origin =
    process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
    console.log(`バケットは作成済み：${Bucket}`);
  } catch {
    // SDK はリージョンが us-east-1 以外だと LocationConstraint を付けるが、
    // RustFS は自分のリージョン（既定 us-east-1）以外を
    // InvalidLocationConstraint で拒否する。RustFS のリージョンを明示して作る
    // （AWS の S3 では us-east-1 は「指定なし」を意味し、型の候補にない）
    await s3.send(
      new CreateBucketCommand({
        Bucket,
        CreateBucketConfiguration: {
          LocationConstraint: "us-east-1" as BucketLocationConstraint,
        },
      }),
    );
    console.log(`バケットを作成した：${Bucket}`);
  }

  await s3.send(
    new PutBucketCorsCommand({
      Bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [origin],
            AllowedMethods: ["PUT", "GET"],
            AllowedHeaders: ["content-type"],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    }),
  );
  console.log(`CORS を設定した（${origin} から PUT・GET）`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
