/**
 * Better Auth の CLI（スキーマの出力）専用の入口。アプリからは import しない。
 *   npx auth@1.7.27 generate --config src/server/auth-cli.ts
 * CLI は設定ファイルから auth という名前のエクスポートを読む。
 */
import { createAuth } from "@/server/auth";

export const auth = createAuth();
