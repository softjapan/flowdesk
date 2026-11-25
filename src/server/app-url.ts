/**
 * アプリの公開 URL（BETTER_AUTH_URL）。メールのリンク（招待・パスワード
 * 再設定・CSV の完了）、Stripe の戻り先、Better Auth のオリジンの確認に使う。
 *
 * 未設定のとき、Better Auth はリクエストの URL（Host ヘッダー）から
 * 公開 URL を推定する（better-auth/dist/auth/base.mjs）。すると
 * パスワード再設定のメールのリンクを、リクエストを送った人が選んだ
 * ホストに向けられる。本番（NODE_ENV=production）では未設定・不正な値を
 * 例外にし、開発とテストだけ localhost:3000 にする（第14章のレビュー）。
 *
 * 使うときに読む（DATABASE_URL などのない CI の next build でも import できる）。
 */

const DEV_DEFAULT = "http://localhost:3000";

type Env = Partial<Record<"BETTER_AUTH_URL" | "NODE_ENV", string>>;

/** 公開 URL のオリジン（末尾の / なし） */
export function appBaseUrl(env: Env = process.env): string {
  const value = env.BETTER_AUTH_URL;
  if (!value) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "BETTER_AUTH_URL が設定されていない（.env.example を参照）",
      );
    }
    return DEV_DEFAULT;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`BETTER_AUTH_URL が URL ではない：${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `BETTER_AUTH_URL は http(s) の URL にする：${value}`,
    );
  }
  return url.origin;
}

/** 公開 URL からの絶対 URL（メールのリンク・Stripe の戻り先） */
export function appUrl(path: string, env?: Env): string {
  return new URL(path, appBaseUrl(env)).toString();
}
