import { describe, expect, it } from "vitest";
import {
  checkMigration,
  invalidAllowComments,
  splitStatements,
} from "./migration-rules";

const rulesOf = (sql: string) =>
  checkMigration(sql).findings.map((f) => f.rule);

describe("マイグレーションの危険な操作", () => {
  it("データを失う操作を見つける", () => {
    expect(rulesOf(`DROP TABLE "customer";`)).toEqual(["drop-table"]);
    expect(
      rulesOf(`ALTER TABLE "customer" DROP COLUMN "phone";`),
    ).toEqual(["drop-column"]);
    expect(
      rulesOf(`ALTER TABLE customer DROP IF EXISTS phone;`),
    ).toEqual(["drop-column"]);
    expect(rulesOf(`TRUNCATE "auditLog";`)).toEqual(["truncate"]);
  });

  it("古い版を壊す操作を見つける", () => {
    expect(
      rulesOf(
        `ALTER TABLE "customer" RENAME COLUMN "phone" TO "tel";`,
      ),
    ).toEqual(["rename-column"]);
    expect(
      rulesOf(`ALTER TABLE "customer" RENAME TO "client";`),
    ).toEqual(["rename-table"]);
    expect(
      rulesOf(
        `ALTER TYPE "JobStatus" RENAME VALUE 'queued' TO 'waiting';`,
      ),
    ).toEqual(["rename-enum"]);
    expect(
      rulesOf(
        `ALTER TABLE "service" ALTER COLUMN "priceYen" SET DATA TYPE BIGINT;`,
      ),
    ).toEqual(["alter-column-type"]);
    expect(
      rulesOf(`ALTER TABLE "service" ALTER "priceYen" TYPE TEXT;`),
    ).toEqual(["alter-column-type"]);
    expect(
      rulesOf(
        `ALTER TABLE "customer" ALTER COLUMN "email" SET NOT NULL;`,
      ),
    ).toEqual(["set-not-null"]);
    expect(
      rulesOf(
        `ALTER TABLE "customer" ADD COLUMN "rank" TEXT NOT NULL;`,
      ),
    ).toEqual(["add-not-null-column"]);
    expect(
      rulesOf(
        `CREATE INDEX "customer_phone_idx" ON "customer"("phone");`,
      ),
    ).toEqual(["create-index-blocking"]);
  });

  it("Prisma が 1 つの ALTER TABLE にまとめた操作を、それぞれ調べる", () => {
    expect(
      rulesOf(`ALTER TABLE "customer" DROP COLUMN "phone",
ADD COLUMN "rank" TEXT NOT NULL,
ALTER COLUMN "name" SET DATA TYPE VARCHAR(50);`).sort(),
    ).toEqual([
      "add-not-null-column",
      "alter-column-type",
      "drop-column",
    ]);
  });

  it("安全な操作は止めない", () => {
    expect(
      rulesOf(`
ALTER TABLE "customer" ADD COLUMN "rank" TEXT;
ALTER TABLE "customer" ADD COLUMN "vip" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "staffProfile" ALTER COLUMN "memberId" DROP NOT NULL;
ALTER TABLE "staffProfile" DROP CONSTRAINT "staffProfile_memberId_fkey";
ALTER TABLE "customer" ALTER COLUMN "rank" SET DEFAULT 'a';
ALTER TABLE "customer" ALTER COLUMN "rank" DROP DEFAULT;
ALTER TABLE "customer" RENAME CONSTRAINT "a" TO "b";
ALTER TABLE "reservation" ADD CONSTRAINT "x" CHECK ("endsAt" > "startsAt");
CREATE INDEX CONCURRENTLY "customer_phone_idx" ON "customer"("phone");
UPDATE "customer" SET "rank" = 'a' WHERE "rank" IS NULL;
`),
    ).toEqual([]);
  });

  it("同じマイグレーションで作ったテーブルへの追加は止めない", () => {
    expect(
      rulesOf(`
CREATE TABLE "stripeEvent" ("id" TEXT NOT NULL, CONSTRAINT "p" PRIMARY KEY ("id"));
ALTER TABLE "stripeEvent" ADD COLUMN "type" TEXT NOT NULL;
CREATE INDEX "stripeEvent_type_idx" ON "stripeEvent"("type");
`),
    ).toEqual([]);
  });

  it("文字列・コメント・ドル引用の中の言葉や ; では止めない", () => {
    expect(
      rulesOf(`
-- DROP TABLE "customer";
/* ALTER TABLE "customer" DROP COLUMN "phone"; */
INSERT INTO "note" ("body") VALUES ('DROP TABLE x; TRUNCATE y');
DO $$ BEGIN RAISE NOTICE 'DROP COLUMN; x'; END $$;
`),
    ).toEqual([]);
  });

  it("文の直前の allow（理由つき）で、その文のそのルールだけを許す", () => {
    const sql = `
-- contract：phone は 2026-12-01 の版から読まない
-- migration-safety: allow drop-column 旧列。tel への移行を確認済み（docs/migrations.md）
ALTER TABLE "customer" DROP COLUMN "phone";
ALTER TABLE "customer" DROP COLUMN "fax";
`;
    const result = checkMigration(sql);
    expect(
      result.allowedFindings.map((f) => [f.rule, f.line]),
    ).toEqual([["drop-column", 4]]);
    expect(result.findings.map((f) => [f.rule, f.line])).toEqual([
      ["drop-column", 5],
    ]);
  });

  it("allow は別のルールを許さない", () => {
    expect(
      rulesOf(`-- migration-safety: allow drop-column 理由
ALTER TABLE "customer" ALTER COLUMN "email" SET NOT NULL;`),
    ).toEqual(["set-not-null"]);
  });

  it("理由のない allow・知らないルール名は誤りにする", () => {
    expect(
      invalidAllowComments(`-- migration-safety: allow drop-column
-- migration-safety: allow drop-everything 理由
-- migration-safety: allow drop-column 理由がある
SELECT 1;`),
    ).toEqual([1, 2]);
    // 理由のない allow では許さない
    expect(
      rulesOf(`-- migration-safety: allow drop-column
ALTER TABLE "customer" DROP COLUMN "phone";`),
    ).toEqual(["drop-column"]);
  });

  it("文の始まりの行を数える", () => {
    expect(
      splitStatements(`-- a
CREATE TABLE "a" (
  "id" TEXT
);

/* b
*/
DROP TABLE "a";`).map((s) => s.line),
    ).toEqual([2, 8]);
  });
});
