/**
 * npm run test:db の前に 1 回だけ実行する。
 * 1. テスト用 DB がなければ作る
 * 2. マイグレーションを当てる（prisma migrate deploy。リセットはしない）
 * 3. 全テーブルを空にして、TEST_NOW を基準にシードを入れる
 */
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { seedDatabase } from "../prisma/seed-data";
import { createPrismaClient } from "../src/server/db";
import { TEST_NOW } from "./db-fixture";

async function ensureDatabase(url: URL): Promise<void> {
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^\w+$/.test(name)) {
    throw new Error(`テスト用 DB の名前が不正: ${name}`);
  }
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [name],
    );
    if (rowCount === 0) {
      await client.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await client.end();
  }
}

export default async function setup(): Promise<void> {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL が設定されていない");
  }
  await ensureDatabase(new URL(testDatabaseUrl));

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: "inherit",
  });

  const prisma = createPrismaClient(testDatabaseUrl);
  try {
    await seedDatabase(prisma, TEST_NOW);
  } finally {
    await prisma.$disconnect();
  }
}
