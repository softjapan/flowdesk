import { describe, expect, it } from "vitest";
import { mask, scanFileName, scanText } from "./secret-rules";

// 鍵の形の文字列は実行時に組み立てる（このファイル自体を検出させない）
const fake = (prefix: string, length: number, char = "a") =>
  prefix + char.repeat(length);

const rulesOf = (text: string) =>
  scanText("x.ts", text).map((f) => f.rule);

describe("秘密情報の検出", () => {
  it("本物の鍵の形を見つける", () => {
    expect(
      rulesOf(`STRIPE_SECRET_KEY=${fake("sk_live_", 24)}`),
    ).toEqual(["stripe-secret-key"]);
    expect(rulesOf(`key: "${fake("sk_test_", 24)}"`)).toEqual([
      "stripe-secret-key",
    ]);
    expect(rulesOf(fake("whsec_", 32))).toEqual([
      "stripe-webhook-secret",
    ]);
    expect(rulesOf(`id=${fake("AKIA", 16, "A")}`)).toEqual([
      "aws-access-key-id",
    ]);
    expect(
      rulesOf(`aws_secret_access_key = ${fake("", 40, "Z")}`),
    ).toEqual(["aws-secret-access-key"]);
    expect(rulesOf(`-----BEGIN ${"RSA PRIVATE"} KEY-----`)).toEqual([
      "private-key",
    ]);
    expect(rulesOf(fake("ghp_", 36))).toEqual(["github-token"]);
    expect(rulesOf(fake("sk-ant-", 40))).toEqual([
      "anthropic-api-key",
    ]);
    expect(
      rulesOf(
        "postgresql://app:" + "s3cret@prod-db.example.com:5432/app",
      ),
    ).toEqual(["database-url-password"]);
  });

  it("接頭辞だけの言及・プレースホルダー・ローカルの接続先は止めない", () => {
    for (const text of [
      "sk_live_ は使わない（テストモードだけ）",
      'STRIPE_SECRET_KEY="sk_test_..."',
      'STRIPE_WEBHOOK_SECRET="whsec_..."',
      'AWS_SECRET_ACCESS_KEY="flowdesk-secret"',
      'DATABASE_URL="postgresql://flowdesk:flowdesk@localhost:5432/flowdesk"',
      "postgresql://flowdesk:flowdesk@db:5432/flowdesk",
      "process.env.STRIPE_SECRET_KEY",
    ]) {
      expect(rulesOf(text), text).toEqual([]);
    }
  });

  it("secret-scan:allow を書いた行は止めない", () => {
    expect(
      rulesOf(`${fake("sk_test_", 24)} // secret-scan:allow`),
    ).toEqual([]);
  });

  it("行番号を返し、秘密そのものは出さない", () => {
    const key = fake("sk_live_", 24);
    const [finding] = scanText("a.ts", `first\n${key}`);
    expect(finding).toMatchObject({ file: "a.ts", line: 2 });
    expect(finding?.preview).toBe(mask(key));
    expect(finding?.preview).not.toContain(key);
  });

  it(".env・秘密鍵のファイルはコミットさせない（.env.example は許す）", () => {
    for (const file of [
      ".env",
      ".env.local",
      "apps/web/.env.production",
      ".env.development.local",
      "certs/server.pem",
      "id_rsa",
    ]) {
      expect(scanFileName(file), file).not.toEqual([]);
    }
    expect(scanFileName(".env.example")).toEqual([]);
    expect(scanFileName("src/server/env.ts")).toEqual([]);
  });
});
