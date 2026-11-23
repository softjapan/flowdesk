# 技術スタックと固定バージョン

確認日：2026-11-23。書籍のサンプルコードはすべて以下のバージョンで動作確認する。
`package.json` では本番依存を完全一致（`-E`）で固定し、更新は章タグを切り直すときにまとめて行う。

## 実行環境

| 項目 | バージョン | 備考 |
|------|-----------|------|
| Node.js | 24.13.0 | `@types/node` も `^24` に合わせる（後述） |
| Docker | 28.0.4 | Docker Compose v2 |
| PostgreSQL | 18.7 | イメージは `postgres:18.7`。排他制約（btree_gist）を実 DB で確認済み（`er.md`） |
| RustFS（S3 互換） | 1.0.6 | ローカル開発用。MinIO は Docker Hub からイメージが消えたため使わない（後述） |
| ElasticMQ（SQS 互換） | 1.7.1 | ローカル開発用。`softwaremill/elasticmq-native` |
| Mailpit | 1.34.0 | ローカル開発用。SMTP を受けて Web 画面（8025）に表示 |
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

## 動作確認で分かったこと（本文で扱う）

1. **create-next-app は `CLAUDE.md`・`.mcp.json`・`README.md` があると生成を拒否する。** 一時的に別のディレクトリへ移してから生成し、戻す（第4章）。
2. **create-next-app は既存の `.gitignore` を警告なしで置き換える。** 生成後の `.env*` は `.env.example` まで無視するので `!.env.example` を足す。自分で足した行（`.claude/settings.local.json` など）も消えるので戻す（第4章）。
3. **`@types/node@^20` と Vitest 5 が衝突する。** create-next-app のテンプレートは `@types/node@^20` だが、Vitest 5.1.1 の peer 依存は `^22.0.0 || >=24.0.0`。`npm i -D vitest` が `ERESOLVE` で失敗する。実行環境の Node 24 に合わせて `@types/node@24.19.2` にすると解決する（第4章）。
4. **`minio/minio` のイメージは Docker Hub から取得できない（2026-11-23 時点、`pull access denied`）。** S3 互換のローカル環境には RustFS を使う。署名付き URL での PUT と CORS のプリフライトが通ることを確認した（第4・11章）。
5. **`npx prisma` はローカルに入れる前だと 8.0.0-rc を取ってくる。** `prisma` を devDependencies に固定してから使う（第7章）。
6. **Next 16 は `AGENTS.md` を生成し、`node_modules/next/dist/docs/` に版に対応したドキュメントを同梱する。** `CLAUDE.md` から `@AGENTS.md` で読み込ませる（第2・4章）。
