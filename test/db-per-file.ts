/**
 * DB を使うテストファイルごとに、テンプレート（シード済みの flowdesk_test）を
 * 複製した DB を作り、そのファイルの DATABASE_URL にする（setupFiles）。
 *
 * ファイルどうしは別の DB を使うので、並列に実行しても、ほかのファイルが
 * 作った行・消した行・数えた件数に影響されない。ファイルの中のテストは
 * 順に実行されるので、同じファイルの中ではこれまでどおり後始末をする。
 *
 * 複製は CREATE DATABASE ... TEMPLATE（ファイルの複写）なので、
 * マイグレーションとシードをファイルごとにやり直すより速い。
 */
import { randomBytes } from "node:crypto";
import { afterAll } from "vitest";
import {
  databaseName,
  dropDatabase,
  withAdminClient,
  withDatabase,
} from "./db-admin";

const templateUrl = process.env.TEST_DATABASE_URL;
if (!templateUrl) {
  throw new Error("TEST_DATABASE_URL が設定されていない");
}
const template = databaseName(templateUrl);
const copy = `${template}_f${process.env.VITEST_POOL_ID ?? "0"}_${randomBytes(4).toString("hex")}`;
const copyUrl = withDatabase(templateUrl, copy);

// 複製は同時に 1 つずつしか作れないことがある（テンプレートを読んでいる
// 間は "being accessed by other users"）。少し待ってやり直す
for (let attempt = 1; ; attempt++) {
  try {
    await withAdminClient(templateUrl, (client) =>
      client.query(
        `CREATE DATABASE "${copy}" TEMPLATE "${template}"`,
      ),
    );
    break;
  } catch (error) {
    if (attempt >= 20) throw error;
    await new Promise((r) => setTimeout(r, 100 * attempt));
  }
}

// src/server/db.ts の getPrisma() は最初に使うときに DATABASE_URL を読む
process.env.DATABASE_URL = copyUrl;

afterAll(async () => {
  const holder = globalThis as unknown as {
    prisma?: { $disconnect(): Promise<void> };
  };
  await holder.prisma?.$disconnect();
  delete holder.prisma;
  await dropDatabase(copyUrl);
});
