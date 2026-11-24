/**
 * S3 のオブジェクトの操作（F-11・F-12）。ファイルの本体はアプリを通さず、
 * ブラウザが署名付き URL で S3 と直接やり取りする。
 * 署名付き URL の有効期限は 5 分（docs/authz-matrix.md）。
 */
import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3, s3Bucket } from "@/server/aws";

export const PRESIGNED_URL_EXPIRES_IN_SECONDS = 5 * 60;

/**
 * PUT の署名付き URL。Content-Type と Content-Length も署名に含めるので、
 * 申告と異なる形式・サイズのファイルは S3 が拒否する
 * （ブラウザは同じ Content-Type を付けて PUT する）
 */
export async function presignPut(input: {
  key: string;
  contentType: string;
  contentLength: number;
}): Promise<string> {
  return getSignedUrl(
    getS3(),
    new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    }),
    {
      expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS,
      // Content-Length を署名の対象から外させない
      signableHeaders: new Set(["content-type", "content-length"]),
    },
  );
}

/** Content-Disposition の filename（日本語のファイル名は RFC 5987 で渡す） */
function contentDisposition(
  type: "inline" | "attachment",
  fileName: string,
): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** GET の署名付き URL。inline なら画面に表示し、attachment なら保存させる */
export async function presignGet(input: {
  key: string;
  fileName: string;
  disposition: "inline" | "attachment";
}): Promise<string> {
  return getSignedUrl(
    getS3(),
    new GetObjectCommand({
      Bucket: s3Bucket(),
      Key: input.key,
      ResponseContentDisposition: contentDisposition(
        input.disposition,
        input.fileName,
      ),
    }),
    { expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS },
  );
}

export type ObjectHead = { contentType: string; sizeBytes: number };

/** オブジェクトの形式とサイズ。なければ null */
export async function headObject(
  key: string,
): Promise<ObjectHead | null> {
  try {
    const head = await getS3().send(
      new HeadObjectCommand({ Bucket: s3Bucket(), Key: key }),
    );
    return {
      contentType: head.ContentType ?? "",
      sizeBytes: head.ContentLength ?? 0,
    };
  } catch (error) {
    if (
      error instanceof NotFound ||
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404
    ) {
      return null;
    }
    throw error;
  }
}

/** サーバーで作ったファイル（CSV など）を置く。同じ鍵なら上書きする */
export async function putObject(input: {
  key: string;
  body: string | Uint8Array;
  contentType: string;
}): Promise<void> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
}
