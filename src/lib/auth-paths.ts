/**
 * 認証まわりのパスの決まり。proxy（src/proxy.ts）とサーバー側の
 * セッション確認（src/server/session.ts）、ログイン画面で共通に使う。
 *
 * ログイン後に戻る先（?callbackUrl=）は誰でも書き換えられるので、
 * サイト内のパスだけを許す（他のサイトへ飛ばすオープンリダイレクトを防ぐ）。
 */

export const LOGIN_PATH = "/login";

/** 戻る先が指定されていない・不正なときの行き先 */
export const DEFAULT_AFTER_LOGIN = "/";

/**
 * proxy がリクエストに付ける、元のパス（クエリを含む）のヘッダー。
 * サーバー側で未ログインと分かったときに、戻る先として使う
 */
export const REQUEST_PATH_HEADER = "x-flowdesk-path";

/** 未ログインで開ける画面 */
const PUBLIC_PATHS = [LOGIN_PATH, "/signup", "/reset-password"];

/**
 * ログインが必要なパスか。/api はそれぞれの Route Handler が
 * 自分で認証する（Better Auth・Stripe の Webhook など）ので対象外
 */
export function requiresLogin(pathname: string): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return false;
  }
  return !PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

const BASE = "http://flowdesk.invalid";

/**
 * "/" で始まるサイト内のパスならそのまま返し、それ以外は既定の行き先にする。
 * "//evil.example" や "/\evil.example" はブラウザが別のホストとして
 * 解釈するので、URL として解決してホストが変わらないことを確かめる。
 */
export function safeCallbackUrl(
  value: string | string[] | null | undefined,
): string {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return DEFAULT_AFTER_LOGIN;
  }
  // 制御文字（タブ・改行）はブラウザが取り除くため、判定をすり抜ける
  if (/[\u0000-\u001f\u007f\\]/.test(value)) {
    return DEFAULT_AFTER_LOGIN;
  }
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
  if (url.origin !== BASE) return DEFAULT_AFTER_LOGIN;
  // 戻った先がまたログイン画面だと、ログインしても先に進めない
  if (url.pathname === LOGIN_PATH) return DEFAULT_AFTER_LOGIN;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** 未ログインのときに送る先。元のパスを callbackUrl に付ける */
export function loginUrlFor(pathWithSearch: string): string {
  const callbackUrl = safeCallbackUrl(pathWithSearch);
  if (callbackUrl === DEFAULT_AFTER_LOGIN) return LOGIN_PATH;
  return `${LOGIN_PATH}?${new URLSearchParams({ callbackUrl })}`;
}
