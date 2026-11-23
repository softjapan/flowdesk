# 技術スタックと固定バージョン

確認日：2026-11-23。書籍のサンプルコードはすべて以下のバージョンで動作確認する。
`package.json` では本番依存を完全一致（`-E`）で固定し、更新は章タグを切り直すときにまとめて行う。

## 実行環境

| 項目 | バージョン | 備考 |
|------|-----------|------|
| Node.js | 24.13.0 | `@types/node` も `^24` に合わせる（後述） |
| Docker | 28.0.4 | Docker Compose v2 |
| PostgreSQL | 18.7 | イメージは `postgres:18.7`。排他制約（btree_gist）を実 DB で確認済み（`er.md`） |
| Terraform | 1.17.2 | 第16〜17章 |

## アプリケーション

| 分類 | パッケージ | バージョン | 選定理由・注意 |
|------|-----------|-----------|----------------|
| フレームワーク | next | 16.4.6 | `create-next-app@16.4.6` で生成。Turbopack 既定、`middleware` は `proxy` に改名 |
| UI | react / react-dom | 19.3.0 | create-next-app が固定した版 |
| 言語 | typescript | 5.9.3 | npm の `latest` は 7.0.2 だが、create-next-app のテンプレートは `^5`。Next 16 の公式テンプレートに合わせる |
| CSS | tailwindcss | 4.3.3 | v4（CSS ファースト設定。`tailwind.config.js` なし） |
| UI 部品 | shadcn (CLI) | 4.23.0 | 第6章で導入 |
| 認証 | better-auth | 1.7.27 | Auth.js はメンテナンスがセキュリティ修正のみになり、公式が新規プロジェクトに Better Auth を推奨（nextauthjs/next-auth discussion #13252）。`organization` プラグインでテナントとロールを扱う |
| ORM | prisma / @prisma/client / @prisma/adapter-pg | 7.10.1 | npm の `prisma@latest` は 8.0.0-rc.34（RC）。Better Auth の peer 依存が `^7` までなので 7 系に固定 |
| DB ドライバ | pg | 8.23.1 | Prisma 7 のドライバアダプター経由で使う |
| 検証 | zod | 4.6.7 | |
| 決済 | stripe | 23.2.0 | テストモードのみ使用 |
| AWS | @aws-sdk/client-s3 / client-sqs | 3.1175.0 | |
| Lint | eslint / eslint-config-next | 9.39.5 / 16.4.6 | テンプレートは ESLint 9（`latest` は 10 だが合わせない） |
| 整形 | prettier | 3.10.1 | A5 判の誌面に収めるため `printWidth: 70` |
| 単体テスト | vitest | 5.1.1 | |
| E2E | @playwright/test | 1.65.1 | |

