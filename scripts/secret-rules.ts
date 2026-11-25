/**
 * 秘密情報の検出ルール（第14章、docs/security.md）。scripts/scan-secrets.ts が
 * 使う。依存を足さず、本物の鍵の形（接頭辞＋十分な長さ）だけを止める。
 * 「sk_live_ は使わない」のような接頭辞だけの言及は止めない（第12章の教訓）。
 *
 * テストのために鍵の形の文字列が必要なら、行に secret-scan:allow を書く。
 * 本物の鍵には使わない。
 */

export type SecretRule = { id: string; pattern: RegExp };

export const SECRET_RULES: SecretRule[] = [
  // Stripe：本番・テストの秘密鍵と制限付きキー、Webhook の署名シークレット
  {
    id: "stripe-secret-key",
    pattern: /\b[sr]k_(live|test)_[0-9A-Za-z]{16,}/,
  },
  {
    id: "stripe-webhook-secret",
    pattern: /\bwhsec_[0-9A-Za-z]{24,}/,
  },
  // AWS：アクセスキー ID（長期・一時）と、シークレットキーの代入
  { id: "aws-access-key-id", pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    id: "aws-secret-access-key",
    pattern:
      /aws_?secret_?access_?key["']?\s*[:=]\s*["']?[0-9A-Za-z/+]{40}(?![0-9A-Za-z/+])/i,
  },
  {
    id: "private-key",
    pattern: /-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/,
  },
  {
    id: "github-token",
    pattern:
      /\b(gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{40,})/,
  },
  { id: "slack-token", pattern: /\bxox[abprs]-[0-9A-Za-z-]{10,}/ },
  { id: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "anthropic-api-key", pattern: /\bsk-ant-[0-9A-Za-z_-]{32,}/ },
  {
    id: "openai-api-key",
    // sk-ant-（Anthropic）は上のルールで見る
    pattern: /\bsk-(?!ant-)(proj-)?[0-9A-Za-z_-]{40,}/,
  },
  // 接続文字列のパスワード。ローカルの Docker（compose.yaml）向けは除く
  {
    id: "database-url-password",
    pattern:
      /\bpostgres(ql)?:\/\/[^\s:/@'"]+:[^\s@'"]+@(?!(localhost|127\.0\.0\.1|db|postgres)[:/])[^\s/'"]+/,
  },
];

/** コミットしてはいけないファイル（.env.example は値を持たないので許す） */
const FORBIDDEN_FILES: { id: string; pattern: RegExp }[] = [
  {
    id: "env-file",
    pattern: /(^|\/)\.env($|\.local$|\.[^/]+\.local$|\.production$)/,
  },
  {
    id: "private-key-file",
    pattern: /\.(pem|key|p12|pfx)$|(^|\/)id_(rsa|ed25519|ecdsa)$/,
  },
];

const ALLOW_MARKER = "secret-scan:allow";

export type Finding = {
  file: string;
  line: number;
  rule: string;
  /** 見つかった文字列の先頭だけ（ログに秘密を残さない） */
  preview: string;
};

/** 見つかった文字列を、ログに出してよい形にする（先頭 6 文字＋長さ） */
export function mask(value: string): string {
  return `${value.slice(0, 6)}…（${value.length} 文字）`;
}

export function scanText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  text.split("\n").forEach((content, index) => {
    if (content.includes(ALLOW_MARKER)) return;
    for (const rule of SECRET_RULES) {
      const match = rule.pattern.exec(content);
      if (match) {
        findings.push({
          file,
          line: index + 1,
          rule: rule.id,
          preview: mask(match[0]),
        });
      }
    }
  });
  return findings;
}

export function scanFileName(file: string): Finding[] {
  return FORBIDDEN_FILES.filter((r) => r.pattern.test(file)).map(
    (r) => ({
      file,
      line: 0,
      rule: r.id,
      preview: file,
    }),
  );
}
