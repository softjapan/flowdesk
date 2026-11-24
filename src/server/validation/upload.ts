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

const ascii = (bytes: Uint8Array, start: number, text: string) =>
  [...text].every((c, i) => bytes[start + i] === c.charCodeAt(0));

/**
 * ファイルの先頭のバイト（マジックナンバー）が、申告された形式と合うか。
 * Content-Type はブラウザが拡張子から決めるので、名前だけ .png にした
 * SVG や HTML も image/png として届く。中身で確かめてから登録する
 */
export function matchesMagicBytes(
  contentType: UploadContentType,
  bytes: Uint8Array,
): boolean {
  switch (contentType) {
    case "image/jpeg":
      return (
        bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      );
    case "image/png":
      return bytes[0] === 0x89 && ascii(bytes, 1, "PNG\r\n\x1a\n");
    case "image/gif":
      return ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a");
    case "image/webp":
      return ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP");
    case "application/pdf":
      return ascii(bytes, 0, "%PDF-");
  }
}
