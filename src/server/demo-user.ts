/**
 * シードのデモユーザー。シード（prisma/seed-data.ts）がこのユーザーを作り、
 * デモサロンの Owner・さくら整体院の Staff にする。
 * 開発用 DB とテスト用 DB だけに入る（シードは本番では実行しない）。
 */
export const DEMO_USER_ID = "user_demo";
export const DEMO_USER_EMAIL = "user-demo@example.com";
/** 開発用のパスワード（README に記載）。本番の DB には存在しない */
export const DEMO_USER_PASSWORD = "flowdesk-demo-2026";
