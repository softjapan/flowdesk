# 技術スタックと固定バージョン

確認日：2026-11-23（第14章の追記は 2026-11-25）。書籍のサンプルコードはすべて以下のバージョンで動作確認する。
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
| 認証 CLI | auth | 1.7.27 | 第7章。Better Auth のテーブルを Prisma スキーマに出力する（`npx auth@1.7.27 generate --config src/server/auth-cli.ts`）。依存には入れず `npx` で版を固定して使う。旧 `@better-auth/cli` は npm で非推奨（最新 1.4.21）で、1.7 系はない |
| ORM | prisma / @prisma/client / @prisma/adapter-pg | 7.10.1 | npm の `prisma@latest` は 8.0.0-rc.34（RC）。Better Auth の peer 依存が `^7` までなので 7 系に固定 |
| DB ドライバ | pg | 8.23.1 | Prisma 7 のドライバアダプター経由で使う |
| 型定義 | @types/pg | 8.23.1 | dev。テスト用 DB の作成（`test/db-global-setup.ts`）で `pg` を直接使う |
| メール | nodemailer | 10.6.1 | 第8章。SMTP でメールを送る（ローカルは Mailpit、本番は SES の SMTP）。型定義を同梱するので `@types/nodemailer` は入れない |
| 検証 | zod | 4.6.7 | |
| 決済 | stripe | 23.2.0 | 第12章。テストモードのみ使用。SDK の既定の API バージョンは `2026-11-18.endive`。Better Auth の Stripe プラグイン（`@better-auth/stripe`）は使わず、この SDK を直接使う（理由は `docs/billing.md`） |
| AWS | @aws-sdk/client-s3 / client-sqs | 3.1175.0 | 第11章。S3（添付ファイル・CSV）と SQS（ジョブのキュー） |
| AWS | @aws-sdk/s3-request-presigner | 3.1175.0 | 第11章。S3 の署名付き URL（ブラウザから直接 PUT・GET、有効期限 5 分）。client-s3 と同じ版にそろえる |
| 実行 | tsx | 4.23.15 | 第11章。Worker（`npm run worker`）とスクリプト（`npm run aws:setup`）を TypeScript のまま動かす。Node 24 の型の除去だけでは `@/` の import（tsconfig の paths）を解決できないため。本番の Worker も使うので dependencies に入れる |
| Lint | eslint / eslint-config-next | 9.39.5 / 16.4.6 | テンプレートは ESLint 9（`latest` は 10 だが合わせない） |
| 整形 | prettier | 3.10.1 | A5 判の誌面に収めるため `printWidth: 70` |
| 単体テスト | vitest | 5.1.1 | |
| E2E | @playwright/test | 1.65.1 | 第13章。dev。ブラウザは Chromium だけを使う（`npx playwright install chromium`、Chrome Headless Shell 159）。設定は `playwright.config.ts`、方針は `docs/testing.md` |

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
18. **Better Auth の設定をモジュールの読み込み時に作ると、`DATABASE_URL` のない環境でビルドが失敗する。** `prismaAdapter` は作る時点で Prisma Client を使うため、遅延させる代理のオブジェクトを渡しても回避できなかった。`createAuth()` / `getAuth()` で最初に使うときに作り、CLI 用の入口（`src/server/auth-cli.ts`）だけが読み込み時に作る。あわせて `getSession` は `headers()` を先に読む（`getAuth().api.getSession({ headers: await headers() })` では、呼び出し先の `getAuth()` が引数より先に評価され、事前描画の時点で接続を作ろうとする）（第8章）。
19. **organization プラグインに `roles` を渡しても、既定の `member` ロールは消えない。** `update-member-role` などはロール名を「既定の 3 つ（owner・admin・member）＋ `roles` のキー」で検証するため、`member` を指定すると通ってしまう。FlowDesk では `member.role` を `toRole()` で owner・admin・staff 以外なら権限なしとして扱い、組織・メンバーを変更する HTTP の入口は `disabledPaths` で閉じる（第10章）。
20. **Better Auth の `disabledPaths` は HTTP のリクエストだけを止める。** ルーターの `onRequest` でパスを比べて 404 を返すので、サーバーからの `getAuth().api.*` の呼び出しは止まらない（第10章）。
21. **organization プラグインの `update-member-role` の既定の判定は、権限の表より緩い。** Owner 以外が Owner を扱うことは拒否するが、`member: ["update"]` を持つ Admin は Admin を Staff に、`remove-member` では Admin を削除できる。また監査ログを残すフック（`afterUpdateMemberRole`）は変更と同じトランザクションにならない。FlowDesk はこれらを使わず Service 層で判定する（第10章）。
22. **AWS SDK v3（3.1175.0）は、`AWS_PROFILE` があると `AWS_ACCESS_KEY_ID`・`AWS_SECRET_ACCESS_KEY` より名前付きプロファイルを優先する。** 開発者のシェルに `AWS_PROFILE` があると、本物の AWS の鍵を RustFS・ElasticMQ に送って `InvalidAccessKeyId` になる。`src/server/aws.ts` は、エンドポイント（`S3_ENDPOINT`・`SQS_ENDPOINT`）を指定したときだけ環境変数の鍵を明示して渡す（第11章）。
23. **AWS SDK v3 は既定で PUT の署名付き URL に CRC32 のチェックサムを付け、ブラウザからの PUT が失敗する。** `requestChecksumCalculation: "WHEN_REQUIRED"` を指定する。また `Content-Length` は既定では署名の対象にならないので、`getSignedUrl` に `signableHeaders: new Set(["content-type", "content-length"])` を渡す。RustFS 1.0.6 で、署名と異なる Content-Type・サイズの PUT が 403 になること、CORS のプリフライトが通ることを確認した（第11章）。
24. **RustFS 1.0.6 は、バケット作成の `LocationConstraint` が自分のリージョン（既定 `us-east-1`）以外だと `InvalidLocationConstraint` で拒否する。** SDK はリージョンが `us-east-1` 以外のとき `ap-northeast-1` を自動で付けるので、`scripts/setup-local-aws.ts` は `us-east-1` を明示する（AWS の S3 では「指定なし」を意味する値で、型の候補にないため型を合わせる）（第11章）。
25. **`package.json` に `"type": "module"` がないので、tsx は `.ts` を CommonJS として変換し、トップレベルの `await` が使えない。** Worker とスクリプトは `main()` を呼ぶ形にする（第11章）。
26. **ElasticMQ 1.7.1 の `maxReceiveCount = 3` では、3 回受信して削除されなかったメッセージが、次に受信されるときに DLQ（`flowdesk-jobs-dlq`）へ移る。** Worker は 3 回目の失敗でメッセージを消さずに置く。SMTP に接続できない状態で、1・2 回目の失敗の後に再試行し、3 回目の後に DLQ へ移ることを確認した（第11章）。
27. **`@better-auth/stripe`（1.7.27）の Webhook は、イベント ID を記録せず、届いた順に上書きする。** 同じイベントの 2 回目でもコールバックが実行され、古い `customer.subscription.updated` が後から届くと古い状態に戻る。入口も `/api/auth/stripe/webhook` に固定される。FlowDesk は使わず、`stripe` を直接使って `stripeEvent` の一意制約と `event.created` の比較で扱う（第12章、`docs/billing.md`）
28. **stripe 23.2.0 は `Stripe.webhooks` を静的に持つので、Webhook の署名の検証に API キーは要らない。** `Stripe.webhooks.generateTestHeaderString` で、Stripe と同じ方式で署名した本文を作れるので、Stripe CLI なしで署名の検証・冪等性・順番の入れ替わりをテストできる。期間の終わり（`current_period_end`）はサブスクリプションではなく項目（`items.data[]`）にある（第12章）
29. **Playwright 1.65.1 は `webServer` を `globalSetup` より先に起動する。** 起動の確認に `/api/health`（DB に接続できなければ 503）を使うと、E2E 用 DB を作る `globalSetup` が始まる前に待ち続ける。起動の確認には DB を使わない `/login` を使い、DB は lazy に接続する（第13章）
30. **Playwright は TypeScript のテストと `globalSetup` を CommonJS として読み込むので、ESM の Prisma Client（生成物が `import.meta` を使う）を import できない（`Cannot use 'import.meta' outside a module`）。** E2E のシードは `npx prisma db seed`（`node prisma/seed.ts`）を別のプロセスで実行する。`pg` だけを使う処理（DB の作成）は import できる（第13章）
31. **Better Auth は本番モード（`NODE_ENV=production`、`next start`）で既定のレート制限を有効にし、`/sign-in`・`/sign-up` は IP ごとに 10 秒に 3 回まで。** E2E は `next start` で動かすので、ログインは setup で 3 回以内にし、ほかのテストは保存したセッション（`storageState`）を使う（第13章）
32. **Next.js 16 はルートの読み上げ用に `role="alert"` の要素（`__next-route-announcer__`）を置く。** `page.getByRole("alert")` は 2 つに一致して strict mode で失敗するので、フォームの中に絞る（第13章）
33. **PostgreSQL の `CREATE DATABASE ... TEMPLATE` は、テンプレートに接続があると失敗する。** DB を使うテストはファイルごとにテンプレート（`flowdesk_test`）を複製して並列に実行するので、テンプレートにシードを入れた接続は閉じてから複製し、テストのワーカーはテンプレートに接続しない。複製は `DROP DATABASE ... WITH (FORCE)`（PostgreSQL 13 以降）で消す（第13章）
34. **Prisma 7 のドライバアダプター経由の外部キー違反は、`meta.driverAdapterError.cause.originalCode` に `23503` が入る（排他制約の 23P01 と同じ場所）。** 予約が参照する店舗・メニューの削除は、件数を数えずに DB の外部キー（`NoAction`）に任せ、この値で `in_use` にする。違反はトランザクションを中断させるので、`runInTransaction` の外で受ける（第13章）
35. **第14章では依存を追加していない。** 秘密情報の検出（`scripts/scan-secrets.ts`）と `npm audit` の判定（`scripts/audit-check.ts`）は tsx で動く自前のスクリプトにした（gitleaks などの外部のバイナリを CI に入れない）。`npm audit` の結果と方針は `docs/security.md`（第14章）
36. **Next.js 16.4.6 で、Server Action の中の `notFound()` は HTTP 404 になる。** Action の ID は `.next/server/server-reference-manifest.json` に `filename`・`exportedName` と並んで出るので、E2E から画面を通さずに呼べる。`Origin` がホストと違うと `Invalid Server Actions request` で実行しない（第14章）
37. **Cache Components（PPR）と nonce の CSP は両立しない**（同梱のドキュメント `01-app/02-guides/content-security-policy.md`）。`script-src` に `'unsafe-inline'` を残し、CSP は外部の読み込み・送信先・埋め込みの制限に使う。S3 のオリジンが実行時の環境変数で決まるので、CSP は `next.config.ts` の `headers()`（ビルド時に固まる）ではなく proxy で付ける（第14章）
38. **Better Auth 1.7.27 は `baseURL` を渡さないと、HTTP のリクエストの URL（Host ヘッダー）から公開 URL を作る**（`dist/auth/base.mjs`）。パスワード再設定のメールのリンクが Host ヘッダーで変わるので、`src/server/app-url.ts` で必ず渡し、本番で未設定なら例外にする（第14章）
39. **Playwright の `route.fulfill` で HTML を返すときは `charset=utf-8` を付ける。** 付けないと日本語の属性が文字化けし、`iframe[title="埋め込み"]` に一致しない。また、公開のホスト名（`evil.example`）のページから `localhost` を iframe に入れると、Chrome の Local Network Access で CSP より前に止まる。他のオリジンは `127.0.0.1` で作る（第14章）
