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
| UI 部品 | shadcn (CLI) | 4.23.0 | 第6章で導入。`init -b radix -p nova`。`globals.css` が `shadcn/tailwind.css` を読むので dependencies に入る |
| UI 部品 | radix-ui | 1.8.1 | shadcn/ui の部品の土台（Sidebar・Sheet・Label など） |
| UI 部品 | class-variance-authority | 0.7.1 | shadcn/ui のバリアント定義 |
| UI 部品 | cn | 0.5.2 | shadcn/ui の `cn()`。shadcn 4.23.0 は `clsx` + `tailwind-merge` の代わりにこれを入れる（後述） |
| UI 部品 | tw-animate-css | 1.4.0 | shadcn/ui のアニメーション（Tailwind v4 用） |
| アイコン | lucide-react | 1.78.0 | shadcn/ui の既定のアイコン |
| グラフ | recharts | 3.8.0 | shadcn/ui の `chart` 部品が使う。ダッシュボードの予約推移 |
| 認証 | better-auth | 1.7.27 | Auth.js はメンテナンスがセキュリティ修正のみになり、公式が新規プロジェクトに Better Auth を推奨（nextauthjs/next-auth discussion #13252）。`organization` プラグインでテナントとロールを扱う |
| 認証 CLI | auth | 1.7.27 | 第7章。Better Auth のテーブルを Prisma スキーマに出力する（`npx auth@1.7.27 generate --config src/server/auth.ts`）。依存には入れず `npx` で版を固定して使う。旧 `@better-auth/cli` は npm で非推奨（最新 1.4.21）で、1.7 系はない |
| ORM | prisma / @prisma/client / @prisma/adapter-pg | 7.10.1 | npm の `prisma@latest` は 8.0.0-rc.34（RC）。Better Auth の peer 依存が `^7` までなので 7 系に固定 |
| DB ドライバ | pg | 8.23.1 | Prisma 7 のドライバアダプター経由で使う |
| 型定義 | @types/pg | 8.23.1 | dev。テスト用 DB の作成（`test/db-global-setup.ts`）で `pg` を直接使う |
| メール | nodemailer | 10.6.1 | 第8章。SMTP でメールを送る（ローカルは Mailpit、本番は SES の SMTP）。型定義を同梱するので `@types/nodemailer` は入れない |
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
7. **shadcn 4.23.0 の `init` は `clsx` と `tailwind-merge` を入れず、`cn` パッケージ（`shadcn-ui/cn`）を入れる。** `src/lib/utils.ts` は `export { cn } from "cn"` だけになり、部品も `"cn"` から直接 import する。CLI のコードに `clsx`・`tailwind-merge` から `cn` へ書き換える処理があることを確認した（第6章）。
8. **shadcn 4.23.0 の `init` は `globals.css` に `--font-sans: var(--font-sans)` と自己参照で書く。** フォントが効かないので `var(--font-geist-sans)` に直す（第6章）。
9. **`SidebarMenuSkeleton` は幅を `Math.random()` で決める。** Cache Components ではプリレンダーとハイドレーションで値がずれるので、Suspense の fallback には固定幅の `Skeleton` を使う（第6章）。
10. **Better Auth の CLI は `auth` パッケージに移った。** `npx @better-auth/cli generate` は非推奨の 1.4 系を取ってくる。better-auth と同じ版の `npx auth@1.7.27 generate` を使う。出力には `docs/er.md` の 6 テーブルに加えて `verification` が含まれる。業務テーブルと、手で足した逆リレーションは再実行しても消えない（第7章）。
11. **Prisma 7.10 の `prisma init` は設定ファイルを `prisma7.config.ts` という名前で作る。** `prisma.config.ts` も後方互換で読まれるが、`prisma7.config.ts` が優先される。生成されるファイルは `import "dotenv/config"` を前提にしているが、dotenv は追加せず Node 24 の `process.loadEnvFile()` で `.env.local` を読む（第7章）。
12. **Prisma 7 では `migrate dev` と `migrate reset` がシードを実行しない（`--skip-seed` もない）。** `npm run db:reset` は reset の後に `prisma db seed` を続けて実行する。`migrate dev` は Client も生成しないので、`postinstall` と `db:generate` で `prisma generate` を実行する（第7章）。
13. **シードを `node prisma/seed.ts` で直接実行するため、generator に `importFileExtension = "ts"` を指定する。** 生成された Client の import に `.ts` が付き、Node 24 の型の除去でそのまま読める。`tsconfig.json` には `allowImportingTsExtensions` を足す（第7章）。
14. **`npm audit` で、`prisma`（dev）が依存する `effect` に high（ReDoS、Schema.TemplateLiteral）が出る（2026-11-23 時点）。** CLI だけが使い、本番の実行時には入らない。修正版の Prisma 7 が出たら更新する（第7章）。
15. **Better Auth のパスワード再設定のリンクは `/api/auth/reset-password/:token?callbackURL=...` になる。** Better Auth がトークンを確かめてから `callbackURL`（`/reset-password`）に `?token=` を付けてリダイレクトし、無効・期限切れなら `?error=INVALID_TOKEN` を付ける。クライアントのメソッドは `requestPasswordReset`（旧 `forgetPassword`）（第8章）。
16. **Better Auth の `secret` が未設定だと、開発では既定の値で動き、`NODE_ENV=production` では初期化が `BetterAuthError`（default secret）で失敗する。** `next build` は失敗せずに終わるがログにこのエラーが出て、起動後の認証の API はすべて失敗する。`.env.local` と本番の環境変数に `BETTER_AUTH_SECRET` と `BETTER_AUTH_URL` を入れる（第8章）。
17. **シードのパスワードは `better-auth/crypto` の `hashPassword`（scrypt）でハッシュ化し、`account` に `providerId: "credential"` で入れる。** Better Auth のメールアドレスとパスワードのログインはこの行を見る（第8章）。
