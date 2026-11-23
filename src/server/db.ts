/**
 * Prisma Client（ドライバアダプター @prisma/adapter-pg 経由で pg を使う）。
 * Repository 層（src/server/repositories/）からだけ import する。
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

export function createPrismaClient(
  connectionString = process.env.DATABASE_URL,
): PrismaClient {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL が設定されていない（.env.example を参照）",
    );
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

// 開発サーバーのホットリロードで接続プールが増え続けないよう、
// globalThis に 1 つだけ保持する
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/** 最初に使うときに接続を作る（DATABASE_URL がなくても import はできる） */
export function getPrisma(): PrismaClient {
  globalForPrisma.prisma ??= createPrismaClient();
  return globalForPrisma.prisma;
}

/**
 * トランザクションの中でも外でも使える Client の型。
 * Repository の関数は最後の引数で受け取り、省略時は getPrisma() を使う。
 */
export type Db = Prisma.TransactionClient;

/**
 * コールバックの中の処理を 1 つのトランザクションで実行する。
 * コールバックが例外を投げるとすべて取り消される。
 * Repository の関数には受け取った tx を db 引数として渡す。
 */
export function runInTransaction<T>(
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return getPrisma().$transaction(fn);
}
