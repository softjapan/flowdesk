/**
 * Better Auth の設定（第7章では最小限）。
 * テーブル（user・session・account・organization・member・invitation）を
 * CLI で Prisma スキーマに出力するために置いている：
 *   npx auth@1.7.27 generate --config src/server/auth.ts
 * ログイン方法・Route Handler・セッションの取得は第8章、
 * staff ロールの定義（createAccessControl）は第10章で追加する。
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins/organization";
import { getPrisma } from "@/server/db";

export const auth = betterAuth({
  database: prismaAdapter(getPrisma(), { provider: "postgresql" }),
  plugins: [organization()],
});
