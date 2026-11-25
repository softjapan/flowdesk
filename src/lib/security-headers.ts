/**
 * セキュリティヘッダー（第14章、docs/security.md）。
 *
 * - CSP は S3 のオリジン（実行時の環境変数）で変わるので、proxy
 *   （src/proxy.ts）がリクエストのたびに付ける
 * - それ以外の固定のヘッダーは next.config.ts の headers() で、静的ファイルも
 *   含めたすべての応答に付ける
 *
 * script-src に 'unsafe-inline' を残す。Cache Components（PPR）では、
 * 事前に描画したシェルにリクエストごとの nonce を入れられない
 * （node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md）。
 * XSS は React のエスケープと dangerouslySetInnerHTML を使わないことで防ぎ、
 * CSP では外部のスクリプト・送信先・埋め込み・<base> の書き換えを止める。
 */

export type CspOptions = {
  /** next dev（React がデバッグ情報に eval を使う） */
  isDev: boolean;
  /** ブラウザが署名付き URL で PUT・GET する S3 のオリジン */
  s3Origin: string | null;
  /** 公開 URL が https なら、http の読み込みを https に上げる */
  upgradeInsecureRequests: boolean;
};

/** Checkout・カスタマーポータル（JavaScript なしのフォーム送信の後の移動先） */
const STRIPE_ORIGINS = [
  "https://checkout.stripe.com",
  "https://billing.stripe.com",
];

export function contentSecurityPolicy(options: CspOptions): string {
  const s3 = options.s3Origin ? [options.s3Origin] : [];
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    [
      "script-src",
      "'self'",
      "'unsafe-inline'",
      ...(options.isDev ? ["'unsafe-eval'"] : []),
    ],
    // shadcn/ui のグラフ（<style>）と Radix の style 属性
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "blob:", "data:", ...s3],
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...s3],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'", ...STRIPE_ORIGINS],
    ["frame-ancestors", "'none'"],
  ];
  if (options.upgradeInsecureRequests) {
    directives.push(["upgrade-insecure-requests"]);
  }
  return directives.map((d) => d.join(" ")).join("; ");
}

/** process.env か、テスト用の値（S3_ENDPOINT・S3_BUCKET・AWS_REGION・BETTER_AUTH_URL） */
type Env = Readonly<Record<string, string | undefined>>;

/**
 * 署名付き URL のオリジン。ローカル（S3_ENDPOINT あり）はパス形式なので
 * エンドポイントのオリジン、AWS の S3 は仮想ホスト形式
 * （<bucket>.s3.<region>.amazonaws.com。src/server/aws.ts）
 */
export function s3Origin(env: Env): string | null {
  if (env.S3_ENDPOINT) {
    try {
      return new URL(env.S3_ENDPOINT).origin;
    } catch {
      return null;
    }
  }
  if (!env.S3_BUCKET) return null;
  const region = env.AWS_REGION ?? "ap-northeast-1";
  return `https://${env.S3_BUCKET}.s3.${region}.amazonaws.com`;
}

export function cspFromEnv(env: Env, isDev: boolean): string {
  return contentSecurityPolicy({
    isDev,
    s3Origin: s3Origin(env),
    upgradeInsecureRequests:
      env.BETTER_AUTH_URL?.startsWith("https://") ?? false,
  });
}

/** すべての応答に付ける固定のヘッダー（next.config.ts） */
export function staticSecurityHeaders(
  isProduction: boolean,
): { key: string; value: string }[] {
  return [
    // 宣言された Content-Type 以外として解釈させない
    { key: "X-Content-Type-Options", value: "nosniff" },
    // 他のサイトへはオリジンだけを送る（招待の ID などをパスから漏らさない）
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    // CSP の frame-ancestors に対応していない古いブラウザ向け
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    // http の応答では無視されるので、本番だけに付ける
    ...(isProduction
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ]
      : []),
  ];
}
