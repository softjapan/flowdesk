/**
 * npm run test:db の前に 1 回だけ実行する。テンプレートの DB を作る：
 * 1. テスト用 DB（TEST_DATABASE_URL、既定は flowdesk_test）がなければ作る
 * 2. マイグレーションを当てる（prisma migrate deploy。リセットはしない）
 * 3. 全テーブルを空にして、TEST_NOW を基準にシードを入れる
 *
 * テストはこの DB を直接使わない。テストファイルごとに、この DB を
 * テンプレートにした DB を作って使う（test/db-per-file.ts）。
 * 前回の実行が途中で止まって残った複製は、ここで消す。
 */
import { execFileSync } from "node:child_process";
import { seedDatabase } from "../prisma/seed-data";
import { createPrismaClient } from "../src/server/db";
import {
  databaseName,
  dropDatabase,
  ensureDatabase,
  withAdminClient,
  withDatabase,
} from "./db-admin";
import { TEST_NOW } from "./db-fixture";

async function dropLeftoverCopies(
  templateUrl: string,
): Promise<void> {
  const prefix = `${databaseName(templateUrl)}_f`;
  const { rows } = await withAdminClient(templateUrl, (client) =>
    client.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE starts_with(datname, $1)",
      [prefix],
    ),
  );
  for (const { datname } of rows) {
    await dropDatabase(withDatabase(templateUrl, datname));
  }
}

export default async function setup(): Promise<void> {
  const templateUrl = process.env.TEST_DATABASE_URL;
  if (!templateUrl) {
    throw new Error("TEST_DATABASE_URL が設定されていない");
  }
  await ensureDatabase(templateUrl);
  await dropLeftoverCopies(templateUrl);

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: templateUrl },
    stdio: "inherit",
  });

  const prisma = createPrismaClient(templateUrl);
  try {
    await seedDatabase(prisma, TEST_NOW);
  } finally {
    // テンプレートに接続が残っていると、複製（CREATE DATABASE ...
    // TEMPLATE）が "being accessed by other users" で失敗する
    await prisma.$disconnect();
  }
}
