// Prisma CLI の設定。Prisma 7.10 は prisma7.config.ts を最優先で探す
// （prisma.config.ts も後方互換で読まれる）。
import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Next.js と同じく .env.local → .env の順に読む。loadEnvFile は既に
// 設定済みの変数を上書きしないので、コマンドで渡した DATABASE_URL が勝つ。
// dotenv は追加せず、Node 24 の組み込み機能を使う
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON prisma/seed.ts",
  },
  datasource: {
    // prisma generate は接続しないので、未設定でも失敗させない
    url: process.env.DATABASE_URL ?? "",
  },
});
