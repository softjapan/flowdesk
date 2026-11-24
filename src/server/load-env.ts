/**
 * Next.js の外で動くプロセス（Worker・スクリプト）の環境変数。
 * Next.js・Prisma の設定（prisma7.config.ts）と同じく、ローカル用の
 * ファイル（.env.example を写したもの）を読む。設定済みの変数は上書き
 * しないので、コマンドで渡した値と本番の環境変数が勝つ。
 * dotenv は追加せず、Node 24 の process.loadEnvFile を使う。
 */
import { existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
