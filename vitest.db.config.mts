/**
 * DB を使うテスト（*.db.test.ts）の設定。npm run test:db で実行する。
 * 開発用 DB とは別のテスト用 DB（既定は flowdesk_test）に、実行のたびに
 * マイグレーションを当ててシードを入れ直し（test/db-global-setup.ts）、
 * それをテンプレートにしてテストファイルごとに DB を複製する
 * （test/db-per-file.ts）。ファイルどうしは DB を共有しないので並列に実行する。
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
    // DATABASE_URL はファイルごとの複製に差し替える（テンプレートには
    // 接続しない。接続が残ると複製できない）
    setupFiles: ["./test/db-per-file.ts"],
    // ジョブは SQS に送らない（開発用の Worker がテスト用 DB のジョブを
    // 受け取らないように。送る処理はテストで差し替えて確かめる）
    env: { TEST_DATABASE_URL: testDatabaseUrl, SQS_QUEUE_URL: "" },
  },
});
