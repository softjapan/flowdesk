# 本番のアーキテクチャ（AWS、東京リージョン）

確認日：2026-11-25（第16〜17章）。第16章では設計とコード（Dockerfile・Terraform）までを行い、第17章で state の置き場所・WAF・監視・RDS の証明書の検証・CI/CD（GitHub Actions と OIDC のデプロイのロール）を足した。どちらの章も**本物の AWS には一切接続しない**（`terraform plan`・`apply`・aws CLI は実行しない。AWS の認証情報はこの環境にない）。DNS・証明書の発行・SES・初回のデプロイは手順だけを書いた（`docs/ci-cd.md` の 4）。

- CI/CD とデプロイの手順は `docs/ci-cd.md`、マイグレーションの流し方は `docs/migrations.md`

- 認可・テナントの規則は `docs/authz-matrix.md`、秘密情報とヘッダーの方針は `docs/security.md`、性能の計測は `docs/performance.md` を正とする
- 版は `docs/tech-stack.md`（Terraform 1.17.2、hashicorp/aws 6.74.0、hashicorp/random 3.9.1）

## 1. 構成図

```mermaid
flowchart LR
  user([利用者のブラウザ])
  stripe([Stripe])

  subgraph edge[エッジ（グローバル）]
    cf[CloudFront<br/>画面・API はキャッシュしない<br/>/_next/static/* だけキャッシュ]
  end

  subgraph vpc[VPC 10.20.0.0/16（ap-northeast-1a・1c）]
    subgraph public[public サブネット]
      alb[ALB<br/>443・CloudFront からだけ]
      nat[NAT Gateway]
    end
    subgraph app[app サブネット（private）]
      web[ECS Fargate: web<br/>Next.js standalone<br/>2〜4 タスク]
      worker[ECS Fargate: worker<br/>tsx src/worker<br/>1 タスク]
      migrate[ECS Fargate: migrate<br/>prisma migrate deploy<br/>デプロイ時に 1 回]
    end
    subgraph db[db サブネット（外への経路なし）]
      rds[(RDS for PostgreSQL 18<br/>Multi-AZ)]
    end
    s3gw[S3 ゲートウェイ<br/>エンドポイント]
  end

  s3[(S3<br/>添付・CSV)]
  sqs[[SQS flowdesk-jobs]]
  dlq[[SQS flowdesk-jobs-dlq]]
  ses[SES（SMTP 587）]
  sm[Secrets Manager]
  cw[CloudWatch<br/>Logs・アラーム]
  ecr[ECR]

  user -- HTTPS --> cf -- "HTTPS + X-Origin-Verify" --> alb --> web
  user -- 署名付き URL で PUT・GET --> s3
  stripe -- Webhook --> cf
  web --> rds
  worker --> rds
  migrate --> rds
  web -- SendMessage --> sqs
  sqs --> worker
  sqs -- 3 回失敗 --> dlq
  web --> s3gw --> s3
  worker --> s3gw
  worker -- NAT 経由 --> ses
  web -- NAT 経由 --> stripe
  sm -. 起動時に環境変数として .-> web & worker & migrate
  web & worker & migrate -. ログ .-> cw
  ecr -. イメージ .-> web & worker & migrate
  dlq -. ApproximateNumberOfMessagesVisible > 0 .-> cw
```

## 2. 各サービスの役割

| サービス | 役割 | 主な設定（Terraform のモジュール） |
|----------|------|--------------------------------------|
| CloudFront | 入口。TLS の終端、HTTP/2・3、静的ファイルのキャッシュ | 画面と API は CachingDisabled＋AllViewer（Host・Cookie・クエリ・`rsc` などのヘッダーをそのまま渡す）。`/_next/static/*` は CachingOptimized。マネージドポリシーの ID は名前で引いた ID と plan のときに照合する（precondition）。ALB への接続は HTTPS だけで、`X-Origin-Verify` ヘッダーを付ける（`modules/cdn`） |
| AWS WAF（第17章） | CloudFront の前の検査 | us-east-1。`/api/webhooks/` の本文が 64KB を超えたら止める（本文を 64KB まで見る設定）、IP の評判・既知の不正な入力のマネージドルールで止める、共通のルール（CommonRuleSet）は既定では数えるだけ、IP ごとに 5 分 2,000 回まで（`modules/waf`。`enable_waf = false` で外せる） |
| ALB | CloudFront からのリクエストを web のタスクに振り分ける | セキュリティグループは CloudFront のオリジン向けのマネージドプレフィックスリストからの 443 だけ。ヘッダーが一致しなければ 403。`drop_invalid_header_fields`。ヘルスチェックは DB を使わない `/login`（`modules/alb`） |
| ECS Fargate：web | Next.js（`output: "standalone"` の `server.js`） | 0.5 vCPU・1GB・ARM64、2〜4 タスク（CPU 60% で増減）。デプロイは新しいタスクが健康になってから古いものを止め、失敗したら自動で戻す（`modules/ecs`） |
| ECS Fargate：worker | SQS のジョブ（メール・CSV・前日リマインド）、未送信のジョブの送り直し | 0.25 vCPU・0.5GB・ARM64、1 タスク。`stopTimeout` 120 秒（SIGTERM の後、処理中のメッセージを終える） |
| ECS Fargate：migrate | `prisma migrate deploy` | サービスにせず、デプロイのたびに run-task で 1 回だけ実行する（第17章の CI/CD）。Prisma の CLI はこのイメージだけが持つ |
| RDS for PostgreSQL | 業務データ | 18 系・db.t4g.small・gp3 20GB（100GB まで自動拡張）・Multi-AZ・暗号化・削除保護・バックアップ 7 日・`rds.force_ssl=1`・500ms 以上のクエリをログへ（`modules/database`） |
| S3 | 添付ファイル・CSV（`orgs/<organizationId>/...`） | パブリックアクセスのブロック 4 つ・ACL 無効・SSE-S3・バージョニング（前の版は 30 日で消す）・TLS 以外を拒否・CORS はアプリの公開 URL だけ（`modules/storage`） |
| SQS | ジョブのキュー（Outbox から送る、第11章） | `flowdesk-jobs`（可視性タイムアウト 60 秒）と `flowdesk-jobs-dlq`。`maxReceiveCount = 3`。SSE。DLQ に 1 件でも入ればアラーム（`modules/queue`）。名前と設定は `docker/elasticmq.conf` と同じ |
| SES | メールの送信（招待・パスワード再設定・CSV の完了・前日リマインド） | Worker が SMTP（`email-smtp.ap-northeast-1.amazonaws.com:587`、STARTTLS）で送る。ドメインの検証・DKIM・サンドボックスの解除は第17章 |
| Secrets Manager | 秘密の値 | 4 つ（§4）。ECS が起動時に読み、環境変数としてコンテナに渡す（`modules/secrets`） |
| CloudWatch・SNS | ログ・メトリクス・アラーム | ロググループ `/ecs/flowdesk-prod/{web,worker,migrate}`（30 日、1 行の JSON）。RDS の `postgresql` ログ。アラームは重要度で 2 つの SNS（`flowdesk-prod-alarms-critical`・`-warning`、カスタマー管理の KMS のキーで暗号化）に送る：5xx の割合・p95（EMF）・キューの滞留・DLQ・タスクの異常停止・アプリのエラー・RDS。ダッシュボード `flowdesk-prod`（`modules/monitoring`、第17〜18章、`docs/observability.md`）。`/api/health` の外形監視は未定 |
| X-Ray（第18章） | トレース | web・worker のタスクの ADOT Collector（サイドカー）が OTLP エンドポイントへ送る（10%）。CloudWatch の Transaction Search を有効にする必要がある（**未確認**、`docs/observability.md` の 3） |
| ECR | イメージ | `flowdesk-prod/{web,worker,migrate}`。タグは上書きできない（IMMUTABLE）、push 時にスキャン、直近 30 個を残す。push は GitHub Actions（OIDC で引き受けるロール、`modules/deploy`、第17章） |

## 3. リクエストとジョブの流れ

**画面・API**：ブラウザ → CloudFront（`https://<domain_name>`）→ ALB（443、`X-Origin-Verify` を確かめる）→ web（3000）→ RDS。

- Next.js の App Router は `rsc`・`next-router-state-tree`・`next-router-prefetch` のヘッダーと `_rsc` のクエリで応答を変える。CloudFront がこれを落とすと画面遷移が壊れる（`node_modules/next/dist/docs/01-app/02-guides/cdn-caching.md`）。画面と API はキャッシュせずにすべて渡す
- **Host ヘッダーを書き換えない。** Server Actions は `Origin` とホスト（`x-forwarded-host` か `host`）を比べ、違えば実行しない（`next/dist/server/app-render/action-handler.js`、`docs/tech-stack.md` の 36）。CloudFront は `x-forwarded-host` を付けないので、Host を ALB の名前にすると全部の Server Action が失敗する。そのため AllViewer で Host も渡し、**ALB の証明書にアプリのドメインを含める**（CloudFront は ALB に Host の名前で TLS を張る）
- ストリーミング（PPR・Suspense）は CloudFront・ALB とも応答を溜めずに流す。CloudFront の `origin_read_timeout` は 60 秒
- Server Actions の暗号化の鍵はビルドごとに作られ、成果物に埋め込まれる（同梱のドキュメント `self-hosting.md`）。全タスクが同じイメージを使うので一致する。イメージを分けてビルドする運用にするなら `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` を固定する

**添付ファイル**：web が署名付き URL（5 分）を作り、ブラウザが S3（`https://<bucket>.s3.ap-northeast-1.amazonaws.com`）に直接 PUT・GET する。CSP の `connect-src`・`img-src` はこのオリジンを許す（`src/lib/security-headers.ts` が `S3_BUCKET` と `AWS_REGION` から作る）。

**ジョブ**：web が DB にジョブを書き、SQS に `jobId` を送る → worker がロングポーリング（20 秒）で受けて処理する → 3 回失敗すると DLQ → アラーム。Worker は 1 分ごとに未送信のジョブを送り直し、15 分ごとに前日リマインドを積む（本番は EventBridge Scheduler に置き換えられる。第11章）。

**Stripe の Webhook**：Stripe → CloudFront → ALB → web の `/api/webhooks/stripe`（署名の検証、冪等、第12章）。ダッシュボードの Webhook の送信先は `https://<domain_name>/api/webhooks/stripe`。

## 4. シークレットと環境変数

ECS のタスク定義には、秘密でない値（`environment`）と、Secrets Manager の ARN（`secrets`）だけを書く。**秘密の値はタスク定義・Terraform のコード・state のどれにも入らない。** アプリは AWS の鍵を持たず、タスクロールを使う（`src/server/aws.ts` はエンドポイントを指定しないとき SDK の既定の探し方に任せる）。

| 変数 | 渡し方 | 値を入れるのは | web | worker | migrate |
|------|--------|----------------|:---:|:------:|:-------:|
| `DATABASE_URL` | Secrets Manager `flowdesk/prod/database-url`。`?sslmode=verify-full&sslrootcert=/etc/ssl/rds/rds-ca-rsa2048-g1.crt`（第17章） | Terraform（`ephemeral "random_password"` → RDS の `password_wo` と `secret_string_wo`。state に残らない） | ○ | ○ | ○ |
| `BETTER_AUTH_SECRET` | Secrets Manager `flowdesk/prod/better-auth-secret` | Terraform（同上、48 文字） | ○ | | |
| `STRIPE_SECRET_KEY`・`STRIPE_WEBHOOK_SECRET`・`STRIPE_PRICE_PRO` | Secrets Manager `flowdesk/prod/stripe`（JSON のキー） | 人（Stripe のダッシュボードの値） | ○ | | |
| `SMTP_USER`・`SMTP_PASSWORD` | Secrets Manager `flowdesk/prod/smtp`（JSON のキー） | 人（SES の SMTP の認証情報） | | ○ | |
| `BETTER_AUTH_URL` | 環境変数 | Terraform（`https://<domain_name>`） | ○ | ○ | |
| `NODE_ENV`（`production`）・`AWS_REGION`・`S3_BUCKET`・`SQS_QUEUE_URL`・`SMTP_HOST`・`SMTP_PORT`（587）・`MAIL_FROM` | 環境変数 | Terraform | ○ | ○ | `NODE_ENV` だけ |
| `S3_ENDPOINT`・`SQS_ENDPOINT`・`AWS_ACCESS_KEY_ID`・`AWS_SECRET_ACCESS_KEY` | **設定しない** | — | | | |

- **`BETTER_AUTH_URL`（第14章）**：Better Auth は `baseURL` がないと Host ヘッダーから公開 URL を作り、パスワード再設定のリンクを攻撃者のホストに向けられる。`src/server/app-url.ts` は本番で未設定・不正なら例外にする。Terraform は `domain_name`（スキームなしのホスト名。検証あり）から `https://` の URL を作り、web と worker（メールのリンク）に渡す。S3 の CORS の許可も同じ値から作る
- **worker は Stripe の鍵と `BETTER_AUTH_SECRET` を持たない**（使わない）。実行ロールが読めるのはこの 4 つのシークレットだけ（`secretsmanager:GetSecretValue`）
- **RDS のサーバー証明書の検証（第17章）**：第16章の `sslmode=no-verify` は暗号化するが相手を確かめない。RDS に指定した CA（`ca_cert_identifier = "rds-ca-rsa2048-g1"`）をイメージの `/etc/ssl/rds/` に入れ（`docker/rds-ca/README.md`）、`verify-full` で CA とホスト名を検証する。アプリ（`pg`）はこの URL のまま検証する。**Prisma 7.10 の CLI（migrate）は `sslrootcert` と `verify-full` を知らず、検証せずに接続する**ので、`prisma7.config.ts` が `sslmode=require&sslcert=<CA>&sslaccept=strict` に直して渡す（`prisma/cli-database-url.ts`）。CLI の `sslcert` はファイルの最初の証明書しか使わないので、CA は 1 つだけのファイルにする。手元の TLS 必須の PostgreSQL（偽の CA を 2 つ前に置いたバンドルを含む）で、migrate・worker のイメージとも、本物の CA では接続でき、別の CA・ホスト名の違い・CA なしでは失敗することを確かめた。書式を変えたので、初回より後に適用するなら `db_password_version` を上げる（`secret_string_wo` は版を上げたときだけ書き換わる）
- `stripe` と `smtp` は Terraform が器だけを作る。**値が入っていないと ECS はタスクを起動できない**ので、初回のデプロイの前に人が入れる（第17章の手順。ダッシュボード、または管理者の端末から）。中身の形：
  - `flowdesk/prod/stripe`：`{"STRIPE_SECRET_KEY":"…","STRIPE_WEBHOOK_SECRET":"…","STRIPE_PRICE_PRO":"price_…"}`（本番の鍵を使い始めるときは `docs/billing.md` を見直す）
  - `flowdesk/prod/smtp`：`{"SMTP_USER":"…","SMTP_PASSWORD":"…"}`（SES の SMTP の認証情報）
- パスワードを変えるときは `db_password_version` を 1 つ上げて apply する（RDS と `DATABASE_URL` が同じ実行の同じ値で書き換わる）。`BETTER_AUTH_SECRET` は `better_auth_secret_version`（全員のセッションが切れる）
- CloudFront → ALB の `X-Origin-Verify` の値は CloudFront の設定に平文で入るため、書き込み専用にできず state に残る。state のバケット（`infra/terraform/bootstrap`、第17章）は暗号化・バージョニング・TLS 必須で、バケットのポリシーで `state_admin_principal_arns` 以外の読み書きを拒否する。デプロイのロールは state を読めない

## 5. ネットワークとセキュリティグループ

| サブネット | CIDR（1a / 1c） | 経路 | 置くもの |
|------------|-----------------|------|----------|
| public | 10.20.0.0/24・10.20.1.0/24 | インターネットゲートウェイ | ALB・NAT Gateway |
| app | 10.20.10.0/24・10.20.11.0/24 | NAT Gateway（既定は 1 つ）、S3 はゲートウェイ型エンドポイント | ECS のタスク（パブリック IP なし） |
| db | 10.20.20.0/24・10.20.21.0/24 | なし（VPC の中だけ） | RDS |

| セキュリティグループ | 受ける | 出す |
|----------------------|--------|------|
| ALB | 443：CloudFront のプレフィックスリストから | 3000：VPC の中へ |
| web | 3000：ALB から | 443（AWS の API・ECR・Stripe）、5432（VPC の中） |
| worker | なし | 443、5432（VPC の中）、587（SES の SMTP） |
| migrate | なし | 443（ECR・ログ・シークレット）、5432（VPC の中） |
| RDS | 5432：web・worker・migrate のセキュリティグループから | — |
| 既定 | なし（使わない） | なし |

- NAT Gateway は既定で 1 つ（`single_nat_gateway = true`）。その AZ が落ちると外向きの通信（Stripe・SES・ECR）が止まる。`false` で AZ ごとに置ける（1 つあたり月 45.26 USD、§7）
- インターフェイス型の VPC エンドポイント（ECR・Logs・Secrets Manager・SQS）は置かず NAT を通す。1 つあたり 0.014 USD/時・AZ（2 AZ で月 20.44 USD）で、4 つでは NAT の時間料金を超えるため。データ量が増えたら見直す

## 6. Docker イメージ（`Dockerfile`）

1 つの Dockerfile のマルチステージから 3 つのイメージを作る。どれも `node:24.13.0-bookworm-slim` から作り、**非 root（`node`、UID 1000）**で動く。

| target | 中身 | 開発用の依存 | 大きさ（手元、arm64） |
|--------|------|--------------|------------------------|
| `web` | `.next/standalone`（`server.js` と、ビルドが追跡した実行に要るファイルだけ）＋ `.next/static`・`public` | なし（`prisma`・`effect`・TypeScript・ESLint・Vitest・Playwright・npm を含まないことを確かめた） | 326MB |
| `worker` | `npm ci --omit=dev` の `node_modules` から `devOptional` を消したもの＋ `src/{worker,server,lib,generated}`。tsx で動かす | なし（同上） | 972MB |
| `migrate` | 開発用を含む依存（Prisma の CLI）＋ `prisma/`。OpenSSL とエンジンをビルド時に入れる | あり（常駐しない） | 1.75GB |

- `next.config.ts` は `NEXT_OUTPUT=standalone` のときだけ standalone で出力する（Dockerfile が設定する）。E2E（`next start`）は今のまま
- **`npm ci --omit=dev` でも Prisma の CLI が入る。** `prisma` は devDependencies だが、`better-auth` の Prisma アダプターと `@prisma/client` の「任意の peer 依存」でもあるため、lockfile で `devOptional` になり、`--omit=dev` でも `--omit=peer` でも入る（第14章の `npm audit` の `effect` はこの経路）。`--omit=optional` を足すと消えるが、tsx が使う esbuild のネイティブのバイナリも消える。そこで `docker/prune-dev-optional.mjs` が lockfile の `devOptional` のパッケージ（108 個）だけを消し、`prisma`・`effect` が残っていたらビルドを失敗させる
- 実行用のイメージ（web・worker）からは npm・yarn・corepack を消す（実行時に使わず、脆弱性の検査の対象を減らす）
- アプリのファイルは root の持ち物のままで、実行ユーザーは書き換えられない。ECS ではルートを読み取り専用にし、`/tmp`（tsx の変換の結果）と `/app/.next/cache`（web）だけボリュームにする
- `.dockerignore` で `.env*`・`.git`・`docs`・`infra`・テストを除く。秘密はイメージに入らない
- worker が大きいのは、本番の依存の `next`・`@next/swc-*`（ビルド用のコンパイラ）・`lucide-react` などが入るため。Worker を 1 つのファイルにまとめる（バンドルする）と小さくできるが、依存（esbuild を直接使う）の追加になるので第17章で判断する

### 手元での起動（`compose.prod.yaml`）

```sh
docker compose -f compose.yaml -f compose.prod.yaml up -d --build --wait
# 確認用の DB（flowdesk_prodlocal）にシードを入れ、バケットを作る（ホストの開発用の道具で）
DATABASE_URL=postgresql://flowdesk:flowdesk@localhost:5432/flowdesk_prodlocal npx prisma db seed
S3_ENDPOINT=http://localhost:9000 BETTER_AUTH_URL=http://localhost:3300 npm run aws:setup
open http://localhost:3300
```

migrate → web・worker の順に起動する。ECS と同じく、ルートを読み取り専用にし、capability をすべて外す。2026-11-25 に確かめたこと（ポートは実験用の `compose.override.yaml` に合わせた）：

- migrate：5 つのマイグレーションを適用して終わる（2 回目は `No pending migrations to apply.`）。読み取り専用のルート・`/tmp` と `/home/node` だけ書き込める状態でも動く
- web：ヘルスチェックが healthy。`/api/health` が `{"status":"ok","database":"ok"}`、`/login` が 200、HSTS・CSP などのヘッダーが付く。デモユーザーでログインでき（`/api/auth/sign-in/email` が 200）、ダッシュボード（`/demo-salon`）が 200。`/app` には書き込めず（`Read-only file system`）、`/app/.next/cache` には書ける
- worker：パスワード再設定の依頼（web）→ SQS → worker → Mailpit にメールが届き、リンクは `BETTER_AUTH_URL`（`http://localhost:3300`）を向く。worker のコンテナから S3（RustFS）に PUT・GET できる
- この構成では S3_ENDPOINT がコンテナの中の名前（`s3:9000`）なので、ブラウザからの署名付き URL の PUT・GET は届かない（`npm run dev` の構成で確かめる）

## 7. 月額費用の目安（東京リージョン）

### 前提

- 料金は **AWS の公開の Price List**（認証の要らない静的な JSON。AWS の API の呼び出しではない）の東京リージョン（`ap-northeast-1`）のオンデマンドの単価。料金ページ（例：https://aws.amazon.com/fargate/pricing/ ）は単価を JavaScript で表示するため、東京の値をページの文面から読めなかった。**確認日 2026-11-25**
- USD、税抜き、1 か月 = 730 時間。無料利用枠（アカウントの作成から 12 か月のもの）は使わない前提。リザーブド・Savings Plans なし
- 規模の想定：数十の組織、月にメール 1 万通、添付 10GB、CloudFront からの転送 50GB・100 万リクエスト、ログ 5GB
- 為替は書かない（円にするときは請求の時点のレートで換算する）

### 単価（確かめた値）

| サービス | 単価（USD） | Price List のファイル（`https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<コード>/current/ap-northeast-1/index.json`）と公開日 |
|----------|-------------|------|
| Fargate Linux/ARM | vCPU 0.04045/時、メモリ 0.00442/GB・時（x86 は 0.05056・0.00553） | `AmazonECS`、2026-11-11 |
| ALB | 0.0243/時、0.008/LCU・時 | `AWSELB`、2026-11-19 |
| RDS PostgreSQL db.t4g.small | Single-AZ 0.05/時、Multi-AZ 0.101/時（db.t4g.micro は 0.025・0.05） | `AmazonRDS`、2026-11-24 |
| RDS gp3 | Single-AZ 0.138/GB・月、Multi-AZ 0.276/GB・月。バックアップは DB のストレージの大きさを超えた分が 0.095/GB・月 | 同上 |
| NAT Gateway | 0.062/時、0.062/GB（処理したデータ） | `AmazonEC2`、2026-11-24 |
| パブリック IPv4 | 0.005/時・個（使用中・未使用とも） | `AmazonVPC`、2026-11-25 |
| VPC インターフェイスエンドポイント | 0.014/時、0.01/GB | 同上 |
| S3 Standard | 0.025/GB・月（最初の 50TB）、PUT 等 0.0047/1,000、GET 等 0.0037/10,000 | `AmazonS3`、2026-11-21 |
| SQS 標準 | 月 100 万リクエストまで無料、その後 0.40/100 万 | `AWSQueueService`、2026-11-11 |
| SES | 0.0001/通（受信者 1 人あたり、1,000 通で 0.10） | `AmazonSES`、2026-11-04 |
| Secrets Manager | 0.40/シークレット・月、0.05/1 万 API コール | `AWSSecretsManager`、2026-11-11 |
| CloudWatch | Logs の取り込み 0.76/GB（Standard）、保存 0.033/GB・月、アラーム 0.10/個・月 | `AmazonCloudWatch`、2026-11-24 |
| CloudFront（日本） | 転送 0.114/GB（最初の 10TB）、HTTPS 0.012/1 万リクエスト。毎月 1TB と 1,000 万リクエストまで無料（Price List の「CloudFront free tier」） | `AmazonCloudFront`（グローバルのファイル `…/AmazonCloudFront/current/index.json`）、2026-10-19 |
| ECR | 0.10/GB・月 | `AmazonECR`、2026-11-13 |
| AWS WAF（第17章） | Web ACL 5.00/月、ルール 1.00/月、0.60/100 万リクエスト | `awswaf`、2026-11-23 |

### 計算

| 項目 | 前提 | 月額（USD） |
|------|------|------:|
| Fargate web | 0.5 vCPU・1GB × 2 タスク × 730 時間 | 35.98 |
| Fargate worker | 0.25 vCPU・0.5GB × 1 タスク × 730 時間 | 9.00 |
| Fargate migrate | 0.25 vCPU・0.5GB、月 30 回 × 5 分 | 0.03 |
| ALB | 730 時間 ＋ 平均 1 LCU | 23.58 |
| NAT Gateway | 1 つ × 730 時間 ＋ 10GB | 45.88 |
| パブリック IPv4 | ALB の 2 つ＋ NAT の 1 つ | 10.95 |
| RDS | db.t4g.small Multi-AZ ＋ gp3 20GB（バックアップは 20GB 以内） | 79.25 |
| S3 | 10GB ＋ PUT 1 万 ＋ GET 10 万 | 0.34 |
| SQS | Worker のロングポーリング（20 秒）は 1 台で月約 13 万回、ジョブを足しても 100 万以内 | 0.00 |
| SES | 1 万通 | 1.00 |
| Secrets Manager | 4 つ ＋ 1 万コール | 1.65 |
| CloudWatch | Logs 5GB の取り込みと保存 ＋ アラーム 5 個 | 4.47 |
| CloudFront | 50GB・100 万リクエスト（無料の範囲。超えると 50GB で 5.70、100 万リクエストで 1.20） | 0.00 |
| ECR | 10GB（3 つのリポジトリ、直近 30 個まで） | 1.00 |
| **合計** | | **約 213** |

- RDS を Single-AZ にすると 79.25 → 39.26 で、合計は**約 173**。NAT Gateway を AZ ごと（2 つ）にすると ＋45.26（IPv4 も 1 つ増えて ＋3.65）
- 大きいのは RDS（37%）、NAT Gateway（22%）、Fargate（21%）、ALB（11%）。台数・サイズが固定の費用がほとんどで、利用者の数ではあまり変わらない
- 第18章で足したもの：KMS のキー 1.00、アラーム・カスタムメトリクス・アクセスログで約 3.30、合計 ＋4〜5 と X-Ray（Transaction Search）の費用（**要確認**、`docs/observability.md` の 5）
- 第17章で足したもの：WAF（Web ACL 5.00 ＋ ルール 5 つ〈Webhook の本文・マネージド 3 つ・回数の上限〉5.00 ＋ 100 万リクエスト 0.60）で ＋10.60、アラームは DLQ と合わせて 7 個（上の計算は 5 個）で ＋0.20、SNS（メール）はほぼ 0。合計は**約 224**。WAF が本文を 16KB より多く（64KB まで）見る分の追加の料金は Price List で確かめていない（**要確認**）

### 含めていないもの（要確認）

| 項目 | 理由 |
|------|------|
| データ転送（NAT からインターネットへの送信、AZ をまたぐ通信、ALB → CloudFront） | Price List の `AmazonEC2`（445MB）の該当の行を確かめていない。**要確認** |
| Route 53（ホストゾーン・クエリ）、ドメインの登録 | `AmazonRoute53` のファイルに東京の行がなかった（グローバルのファイルを見ていない）。**要確認**。DNS を他社で持つなら不要 |
| CloudFront の定額のプラン（flat-rate） | Price List にない。**要確認** |
| Container Insights・RDS Performance Insights・カスタムメトリクス | 既定で無効。有効にするなら**要確認** |
| ACM の証明書 | ALB・CloudFront の公開の証明書は無料とされるが、Price List で確かめていない。**要確認** |
| 税・サポートプラン | 対象外 |

## 8. Terraform（`infra/terraform/`）

```
infra/terraform/
├── bootstrap/            # state 用の S3 バケット（第17章。state は手元）＋ tests/bootstrap.tftest.hcl
├── envs/prod/            # 本番の構成（モジュールをつなぐ）。terraform はここで実行する
│   ├── main.tf           # provider・ephemeral の秘密・モジュール
│   ├── variables.tf      # domain_name・証明書・image_tag など（検証つき）
│   ├── outputs.tf
│   ├── versions.tf       # Terraform 1.17.2・aws 6.74.0・random 3.9.1、backend "s3" {}
│   ├── .terraform.lock.hcl
│   ├── terraform.tfvars.example / backend.hcl.example
│   └── tests/prod.tftest.hcl   # mock_provider "aws" のテスト
└── modules/
    ├── network/   # VPC・サブネット 3 種・NAT・S3 のゲートウェイエンドポイント
    ├── database/  # RDS・サブネットグループ・パラメータグループ・SG
    ├── storage/   # S3
    ├── queue/     # SQS・DLQ・DLQ のアラーム
    ├── secrets/   # Secrets Manager
    ├── alb/       # ALB・ターゲットグループ・リスナー・SG
    ├── cdn/       # CloudFront
    ├── ecs/       # ECR・クラスター・ロググループ・IAM・タスク定義・サービス・オートスケーリング・SG
    ├── waf/       # AWS WAF（CloudFront 用、us-east-1。第17章）
    ├── monitoring/ # SNS とアラーム（第17章）
    └── deploy/    # GitHub OIDC のプロバイダーとデプロイのロール（第17章）
```

手元での確認（AWS に接続しない。`terraform init` はプロバイダーを Terraform Registry から取得する）：

```sh
cd infra/terraform
terraform fmt -check -recursive
cd envs/prod
terraform init -backend=false
terraform validate
terraform test     # 23 の run。aws はモック（us-east-1 の別名も）、random は手元で値を作るだけ
cd ../../bootstrap && terraform init && terraform test   # 2 の run
```

`terraform test` が確かめること：RDS が公開されていない（`publicly_accessible = false`、db サブネットだけ、db のルートテーブルに外への経路がない、SG の 5432 は ECS の SG からだけ）、暗号化・削除保護・Multi-AZ・`rds.force_ssl`、パスワードが state にない／S3 のパブリックアクセスのブロック 4 つ・ACL 無効・CORS・TLS 必須／SQS の `maxReceiveCount = 3` と DLQ・アラーム／タスクが非 root（`1000:1000`）・読み取り専用のルート・capability なし・ARM64・パブリック IP なし／秘密が環境変数にない（名前と、接続文字列の値）・web・worker・migrate に渡すシークレットの組・`BETTER_AUTH_URL` が `https://<domain_name>`・`S3_ENDPOINT` などがない／実行ロールとタスクロールに `*` がない／ALB は CloudFront のプレフィックスリストからだけ・ヘッダーがなければ 403／CloudFront は HTTPS・キャッシュの方針・Host の転送／入力の検証（スキーム付きのドメイン、us-east-1 以外の CloudFront の証明書、`latest` のタグ、`http://` の CORS、environment に秘密）。

テストが空振りしていないことは、設定を一時的に壊して確かめた（RDS を公開・`maxReceiveCount = 5`・`restrict_public_buckets = false`・`user = "0:0"`・環境変数に `STRIPE_SECRET_KEY`・`BETTER_AUTH_URL` を `http://localhost:3000`。どれも該当の run が失敗した）。

第17章で足したテスト：デプロイのロールの信頼ポリシー（このリポジトリの production の environment だけ、`StringEquals`、`aud`）と権限（`*` はリソースを指定できない操作だけ、PassRole は ECS のタスクにだけ、RunTask は migrate だけ）、`*` を含むリポジトリ・environment の拒否、既存の OIDC プロバイダーの再利用／WAF の Webhook の本文の上限・共通のルールは数えるだけ・上限の検証／アラームが SNS に通知する／`DATABASE_URL` が `verify-full` でイメージの CA を使う・イメージにない CA の拒否／state のバケットの暗号化・バージョニング・公開の禁止・管理者以外の拒否。信頼ポリシーのテストは、4 通りに緩めて失敗することを確かめた（`docs/ci-cd.md` の 2）。

**CloudFront のマネージドポリシーの ID**：モックでは `aws_cloudfront_cache_policy` などのデータソースの `id` が常に `null` になり（入力にもなる属性なので、`mock_data` の既定値も `override_data` も効かない。最小の構成で確かめた）、名前で引いた ID をテストで確かめられない。ID は AWS の公開の値を書き、名前で引いた ID と違えば plan で止まる precondition にした（モックの `null` のときは飛ばす）。

**モックのテストで分からないこと**：AWS の API が受け付けるか（名前の長さ・組み合わせの制約、RDS で使える PostgreSQL のマイナーバージョン、マネージドポリシーの ID）、IAM の権限で実際に動くか、証明書と DNS。これらは第17章の `terraform plan` と初回のデプロイで確かめる。

## 9. 要確認・第17章に残したこと

第17章での扱い（**済**＝手元で確かめた、**手順**＝`docs/ci-cd.md` に手順を書いた、**残す**＝本物の AWS か判断が要る）：

| 項目 | 内容 |
|------|------|
| RDS の証明書の検証 | **済**。`verify-full`・イメージに CA・Prisma の CLI 用の変換（§4）。以下は第16章の記述 | `DATABASE_URL` は `sslmode=no-verify`（TLS で暗号化するが、サーバー証明書を検証しない）。RDS の CA（公開の CA ではない）をイメージに入れ、`sslmode=verify-full&sslrootcert=…` にする（`pg-connection-string` は `sslrootcert` のファイルを読む） |
| RDS のマイナーバージョン | **残す**（初回の `plan`）。`engine_version = "18"`（RDS の既定のマイナー）。ローカルの 18.7 と同じものが RDS にあるかは要確認 |
| Fargate のボリュームの持ち主 | **残す**（初回のデプロイ）。Fargate の空のボリュームは root の持ち物になる可能性があり、UID 1000 で `/tmp`・`/app/.next/cache` に書けるかを実環境で確かめる（手元の Docker では確かめた） |
| CloudFront のマネージドポリシーの ID | **済**（plan で照合する precondition。§8）。CachingDisabled・CachingOptimized・AllViewer の ID を、適用前にコンソールか `data "aws_cloudfront_cache_policy"` で照合する（モックのテストでは確かめられない） |
| state | **済**。`infra/terraform/bootstrap`（暗号化・バージョニング・TLS 必須・管理者以外の拒否）と `backend.hcl.example`（`use_lockfile`） |
| DNS・証明書 | **手順**。ACM（ap-northeast-1 と us-east-1）の発行と DNS の検証、`domain_name` を CloudFront に向ける |
| SES | **手順**。ドメインの検証・DKIM・サンドボックスの解除・SMTP の認証情報の作成と `flowdesk/prod/smtp` への登録 |
| Webhook の本文の上限（`docs/security.md` の 1 の 9） | **済**（`modules/waf`、64KB）。Stripe の Webhook の本文の大きさの実際の分布は**残す**（本番のログで確かめ、上限を見直す） |
| 監視 | **済**（`modules/monitoring`。第18章で重要度・閾値の根拠・SNS の暗号化のキーを見直した、`docs/observability.md`）。`/api/health` の外形監視は**残す**（Route 53 のヘルスチェックか Synthetics か、費用を見て決める） |
| CI/CD | **済**（`docs/ci-cd.md`。ワークフローは作っただけで GitHub では未実行）。`linux/arm64` のビルド → ECR に push（Git のコミットをタグに）→ migrate を run-task → web・worker のタスク定義を更新 |
| Worker のイメージの大きさ | **残す**。972MB。バンドルするには esbuild を直接の依存にする必要があり、`CLAUDE.md` の「表にない依存は先に提案して確認」に当たるので、第17章では入れていない（提案：esbuild で `src/worker/index.ts` を 1 ファイルにまとめ、`pg`・`nodemailer`・AWS SDK・Prisma の生成物だけを残す） |
