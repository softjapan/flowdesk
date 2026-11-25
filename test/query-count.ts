/**
 * DB を使うテストで、処理が実行したクエリの数を数える（第15章、N+1 の回帰）。
 * Repository が使う getPrisma() の Client（globalThis.prisma）を、クエリの
 * イベントを数える Client に一時的に差し替える。
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const holder = globalThis as unknown as { prisma?: PrismaClient };

export async function countQueries(
  fn: () => Promise<unknown>,
): Promise<number> {
  const counting = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    }),
    log: [{ emit: "event", level: "query" }],
  });
  let count = 0;
  counting.$on("query", () => {
    count++;
  });
  const original = holder.prisma;
  holder.prisma = counting;
  try {
    await fn();
    return count;
  } finally {
    holder.prisma = original;
    await counting.$disconnect();
  }
}
