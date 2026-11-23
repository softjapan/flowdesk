/**
 * ブラウザから Better Auth（/api/auth/*）を呼ぶクライアント。
 * Client Component からだけ使う。サーバー側は src/server/session.ts を使う。
 * 同じオリジンで動かすので baseURL は指定しない。
 */
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

/** Better Auth のエラー（code）を画面に出す文言にする */
export function authErrorMessage(
  error: { code?: string; status: number } | null | undefined,
): string {
  if (error?.status === 429) {
    return "試行回数が多すぎます。しばらく待ってから、もう一度お試しください。";
  }
  switch (error?.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "メールアドレスまたはパスワードが正しくありません。";
    case "INVALID_EMAIL":
      return "メールアドレスの形式が正しくありません。";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "このメールアドレスは登録できません。別のアドレスを使うか、ログインしてください。";
    case "PASSWORD_TOO_SHORT":
      return "パスワードが短すぎます。";
    case "PASSWORD_TOO_LONG":
      return "パスワードが長すぎます。";
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
      return "再設定のリンクが無効か、有効期限が切れています。もう一度メールを送ってください。";
    default:
      return "処理に失敗しました。時間をおいて、もう一度お試しください。";
  }
}
