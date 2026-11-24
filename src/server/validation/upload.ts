/**
 * 添付ファイルのアップロード（F-12）の入力。画面（ファイルを選んだ時点の
 * 確認）と Route Handler（/api/uploads/presign）で共有するので、Zod 以外の
 * 実行時の依存を持たない。
 */
import { z } from "zod";
import { idSchema } from "@/server/validation/form";

/** 画像と PDF だけ。SVG はスクリプトを含められるので許可しない */
export const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;

export type UploadContentType = (typeof ALLOWED_UPLOAD_TYPES)[number];

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function isImageType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

export const presignRequestSchema = z.object({
  /** 組織のスラッグ */
  org: idSchema,
  customerId: idSchema,
  fileName: z
    .string()
    .trim()
    .min(1, "ファイル名がありません")
    .max(255, "ファイル名は 255 文字以内にしてください")
    // 制御文字はヘッダー（Content-Disposition）に入れられない
    .refine(
      (v) => !/[\u0000-\u001f\u007f]/.test(v),
      "ファイル名に使えない文字が含まれています",
    ),
  contentType: z.enum(ALLOWED_UPLOAD_TYPES, {
    error:
      "アップロードできるのは画像（JPEG・PNG・WebP・GIF）と PDF です",
  }),
  sizeBytes: z
    .number()
    .int()
    .min(1, "空のファイルはアップロードできません")
    .max(MAX_UPLOAD_BYTES, "ファイルは 10MB 以下にしてください"),
});

export type PresignRequest = z.infer<typeof presignRequestSchema>;
