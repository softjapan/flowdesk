/**
 * E2E テスト（Playwright）。npm run test:e2e で実行する（docs/testing.md）。
 *
 * - 本番と同じ形（next build → next start）で、別のポート（既定 3100）に起動する
 * - DB は E2E 専用（既定は DATABASE_URL の DB 名を flowdesk_e2e にしたもの）。
 *   実行のたびにマイグレーションを当ててシードを入れ直す（e2e/global-setup.ts）
 * - S3 は E2E 専用のバケット（flowdesk-e2e）。開発用のバケットの CORS を
 *   書き換えないため
 * - ジョブは SQS に送らない（開発用の Worker が E2E の DB のジョブを
 *   受け取らないように）
 */
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

/** E2E_DATABASE_URL がなければ DATABASE_URL の DB 名を flowdesk_e2e にする */
function resolveE2eDatabaseUrl(): string {
  const explicit = process.env.E2E_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!explicit && !base) {
    throw new Error(
      "E2E_DATABASE_URL か DATABASE_URL を設定する（.env.example を参照）",
    );
  }
  const url = new URL(explicit ?? base!);
  if (!explicit) url.pathname = "/flowdesk_e2e";
  // シードで全テーブルを空にするので、開発用 DB を指していたら止める
  if (!url.pathname.endsWith("_e2e")) {
    throw new Error(
      `E2E 用 DB の名前は _e2e で終える（${url.pathname.slice(1)}）`,
    );
  }
  return url.toString();
}

/** next start と e2e/global-setup.ts に渡す環境変数 */
const serverEnv: Record<string, string> = {
  DATABASE_URL: resolveE2eDatabaseUrl(),
  BETTER_AUTH_URL: baseURL,
  // E2E 専用の値（本番では使わない。next start は NODE_ENV=production
  // なので、未設定だと Better Auth が既定の鍵を拒否する）
  BETTER_AUTH_SECRET:
    process.env.E2E_BETTER_AUTH_SECRET ??
    "e2e-only-secret-do-not-use-in-production",
  S3_BUCKET: process.env.E2E_S3_BUCKET ?? "flowdesk-e2e",
  SQS_QUEUE_URL: "",
};
for (const key of [
  "S3_ENDPOINT",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "MAIL_FROM",
]) {
  const value = process.env[key];
  if (value !== undefined) serverEnv[key] = value;
}
// globalSetup（同じプロセス）に渡す
process.env.E2E_SERVER_ENV = JSON.stringify(serverEnv);

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: ci,
  // 再試行は CI だけ。テストは試行ごとに別の日付・名前を使う（e2e/helpers.ts）
  retries: ci ? 2 : 0,
  reporter: ci ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
  },
  projects: [
    // ログインの E2E を兼ねて、ロールごとのセッションを保存する
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/owner.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // E2E_SKIP_BUILD=1 なら、ビルド済みの .next をそのまま起動する
    command: process.env.E2E_SKIP_BUILD
      ? `npx next start --port ${port}`
      : `npm run build && npx next start --port ${port}`,
    // webServer は globalSetup より先に起動するので、DB を使わない
    // ページで起動を待つ（/api/health は E2E 用 DB ができるまで 503）
    url: `${baseURL}/login`,
    env: serverEnv,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
