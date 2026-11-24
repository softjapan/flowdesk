/**
 * DB を使うテストが、ファイルごとに別の DB で動いていること
 * （test/db-per-file.ts）。テンプレートの DB を直接使っていたら、
 * 並列に実行したファイルどうしがデータを壊し合う。
 */
import { describe, expect, it } from "vitest";
import { getPrisma } from "@/server/db";
import { databaseName } from "./db-admin";

describe("テストファイルごとの DB", () => {
  it("テンプレートを複製した、このファイル専用の DB を使う", async () => {
    const template = databaseName(process.env.TEST_DATABASE_URL!);
    const [row] = await getPrisma().$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;
    expect(row?.name).not.toBe(template);
    expect(row?.name.startsWith(`${template}_f`)).toBe(true);
    // シードは入っている
    expect(await getPrisma().organization.count()).toBe(3);
  });
});
