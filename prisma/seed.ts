/**
 * 開発用 DB にデモデータを入れる。
 *   npm run db:seed   … 中身だけ入れ直す（全テーブルを空にしてから投入）
 *   npm run db:reset  … DB を作り直してマイグレーションを当て、シードする
 * 予約は実行した日を基準に作る。
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { seedDatabase } from "./seed-data.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL が設定されていない（.env.example を参照）",
  );
}
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
try {
  await seedDatabase(prisma, new Date());
  console.log("シードを投入した");
} finally {
  await prisma.$disconnect();
}
