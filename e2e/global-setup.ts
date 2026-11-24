/**
 * npm run test:e2e の前に 1 回だけ実行する（webServer の起動の後）。
 * 1. E2E 用 DB がなければ作り、マイグレーションを当てる
 * 2. 全テーブルを空にして、今日を基準にシードを入れる（画面は今日の日付で動く）
 * 3. E2E 用のバケットを作り、E2E のオリジンからの PUT・GET を CORS で許す
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { ensureDatabase } from "../test/db-admin";

export default async function setup(): Promise<void> {
  const env = JSON.parse(
    process.env.E2E_SERVER_ENV ?? "{}",
  ) as Record<string, string>;
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl)
    throw new Error("E2E_SERVER_ENV が設定されていない");
  const childEnv = { ...process.env, ...env };

  await ensureDatabase(databaseUrl);
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: childEnv,
    stdio: "inherit",
  });
  // Playwright は TypeScript を CommonJS として読み込むので、ESM の
  // Prisma Client（import.meta を使う）を import できない。
  // npm run db:seed と同じく別のプロセスで入れる（prisma/seed.ts）
  execFileSync("npx", ["prisma", "db", "seed"], {
    env: childEnv,
    stdio: "inherit",
  });

  execFileSync("npx", ["tsx", "scripts/setup-local-aws.ts"], {
    env: childEnv,
    stdio: "inherit",
  });
  mkdirSync("e2e/.auth", { recursive: true });
}
