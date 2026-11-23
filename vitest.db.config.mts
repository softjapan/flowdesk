/**
 * DB を使うテスト（*.db.test.ts）の設定。npm run test:db で実行する。
 * 開発用 DB とは別のテスト用 DB（既定は flowdesk_test）を使い、
 * 実行のたびにマイグレーションを当ててシードを入れ直す（test/db-global-setup.ts）。
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

/** TEST_DATABASE_URL がなければ DATABASE_URL の DB 名を flowdesk_test にする */
function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!explicit && !base) {
    throw new Error(
      "TEST_DATABASE_URL か DATABASE_URL を設定する（.env.example を参照）",
    );
  }
  const url = new URL(explicit ?? base!);
  if (!explicit) url.pathname = "/flowdesk_test";
  // テストは全テーブルを空にするので、開発用 DB を指していたら止める
  if (!url.pathname.endsWith("_test")) {
    throw new Error(
      `テスト用 DB の名前は _test で終える（${url.pathname.slice(1)}）`,
    );
  }
  return url.toString();
}

const testDatabaseUrl = resolveTestDatabaseUrl();
// globalSetup（同じプロセス）に渡す
process.env.TEST_DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["**/*.db.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    globalSetup: ["./test/db-global-setup.ts"],
    // テストのワーカーでは、テスト用 DB を DATABASE_URL として使う
    env: { DATABASE_URL: testDatabaseUrl },
    // 同じ DB を更新するテストがあるので、ファイルを並列に実行しない
    fileParallelism: false,
  },
});
