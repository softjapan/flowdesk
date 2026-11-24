/**
 * 組織の作成（S-04）と、メンバーの招待・ロール変更（S-13）の入力（F-03・F-04）。
 */
import { z } from "zod";
import { ROLES } from "@/server/access-control";

export const ORGANIZATION_FIELDS = ["name", "slug"] as const;
export type OrganizationFieldName =
  (typeof ORGANIZATION_FIELDS)[number];

/**
 * URL の先頭（/[org]）に使うので、アプリのパスと重なる名前は使わせない。
 * 静的なルートは動的なルートより優先されるため、重なると組織を開けない
 */
export const RESERVED_SLUGS = new Set([
  "api",
  "orgs",
  "invitations",
  "login",
  "signup",
  "reset-password",
  "settings",
  "admin",
  "new",
]);

export const organizationInputSchema = z.object({
  name: z
    .string("組織名を入力してください。")
    .trim()
    .min(1, "組織名を入力してください。")
    .max(100, "組織名は 100 文字以内で入力してください。"),
  slug: z
    .string("URL を入力してください。")
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/,
      "URL は半角英小文字・数字・ハイフンの 3〜48 文字で、先頭と末尾は英数字にしてください。",
    )
    .refine(
      (v) => !RESERVED_SLUGS.has(v),
      "この URL は使えません。別の URL を指定してください。",
    ),
});

export type OrganizationInput = z.output<
  typeof organizationInputSchema
>;

export const roleSchema = z.enum(ROLES, "ロールを選んでください。");

export const INVITATION_FIELDS = ["email", "role"] as const;
export type InvitationFieldName = (typeof INVITATION_FIELDS)[number];

export const invitationInputSchema = z.object({
  // Better Auth は登録時にメールアドレスを小文字にするので、合わせる
  email: z
    .string("メールアドレスを入力してください。")
    .trim()
    .toLowerCase()
    .max(254, "メールアドレスが長すぎます。")
    .pipe(z.email("メールアドレスの形式が正しくありません。")),
  role: roleSchema,
});

export type InvitationInput = z.output<typeof invitationInputSchema>;
