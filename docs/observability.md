# 本番の監視：ログ・トレース・メトリクス・アラーム（第18章）

確認日：2026-11-25。本物の AWS には接続していない。**手元で確かめた**ことと、**本物の AWS では未確認**のことを分けて書く。障害対応の手順は `docs/runbooks/incident-ai.md`、バックアップと復旧は `docs/runbooks/restore.md`。

## 1. 全体

```
web（Next.js）──┐ 1 行の JSON のログ（stdout）──→ awslogs ──→ CloudWatch Logs ──→ メトリクスフィルター・EMF → アラーム → SNS（critical・warning）
worker ─────────┤
                └ OTLP/HTTP（127.0.0.1:4318）──→ ADOT Collector（タスクの中）──SigV4──→ X-Ray の OTLP エンドポイント
手元：            OTLP/HTTP（localhost:4318）──→ Jaeger 2.23.0（docker compose、http://localhost:16686）
```

追跡の ID は **トレース ID 1 つ**にそろえた。リクエストの ID（応答の `x-request-id`、`src/proxy.ts`）・ログの `traceId`・トレースの ID が同じ値で、Worker のジョブのログも、ジョブを積んだリクエストと同じ `traceId` になる。

## 2. ログ（`src/server/logger.ts`）

- **形**：本番（`NODE_ENV=production`、Terraform が `LOG_FORMAT=json` も入れる）は 1 行に 1 つの JSON。手元の `npm run dev`・`npm run worker` は 1 行の読みやすい形。
  例（Worker、手元で出力したもの）：
  ```json
  {"time":"2026-11-25T19:07:53.501Z","level":"error","msg":"ジョブが失敗","service":"flowdesk-worker","traceId":"7fc01d7d8c13f2aa5e18135b8bc09eb3","spanId":"35ef8e5d56a08b93","jobId":"cmwwhxdrv00064bvsgwkgebl3","messageId":"5e48c491-…","receiveCount":1,"jobType":"mail.send","attempts":1,"final":false,"err":{"name":"AggregateError","code":"ESOCKET","errors":[{"message":"connect ECONNREFUSED 127.0.0.1:51025","code":"ECONNREFUSED"}]}}
  ```
- **追跡の ID**：実行中のスパンの `traceId`・`spanId` を必ず付ける。Worker は 1 通ごとに `withLogContext` で `jobId`・`messageId`・`receiveCount` を付ける。
- **アクセスログ**：web は 1 リクエストに 1 行（`msg: "request"`、`method`・ルートのパターン `route`・`status`・`durationMs`）。クエリ文字列（検索語・トークン）は出さない。`/_next/`・`/api/health` は出さない。
- **個人情報・秘密を出さない**：
  1. 呼び出す側は、顧客の値ではなく ID・件数・種類を渡す（`console.error("…", body)` のように受け取った値をそのまま出していた所を直した。例：形式の違うメッセージは本文ではなく長さだけ）
  2. キーの名前で値を伏せる（`password`・`*token`・`*secret`・`cookie`・`authorization`・`email`・`phone`・`name`・`to`・`subject`・`text`・`body`・`database-url` など）
  3. 文字列（メッセージ・エラー・スタック）の中のメールアドレス → `[email]`、電話番号 → `[phone]`、URL の資格情報・`token=`・署名付き URL の署名 → `[REDACTED]`、Stripe の鍵の形 → `[REDACTED_KEY]`
  4. Next.js やライブラリが `console` に出すログも、本番では logger を通す（`installConsoleBridge`）。awslogs は 1 行を 1 件にするので、複数行のスタックが分かれない
     ただし Next.js の起動時の 5 行（`▲ Next.js 16.4.6`・`✓ Ready` など）は instrumentation より前に出るので JSON にならない（本番のイメージで確かめた。Logs Insights では `level` のない行として残るだけで、害はない）
  5. 描画・Route Handler・Server Action で捕まらなかった例外は `instrumentation.ts` の `onRequestError` で出す（ヘッダー・本文は出さず、経路と `digest`）
  6. 単体テスト：`src/server/logger.test.ts`（伏せること・ID や日時を壊さないこと）
- **CloudWatch Logs との合わせ方**（第16章のタスク定義、`modules/ecs/tasks.tf`）：awslogs の `mode = non-blocking`・`max-buffer-size = 25m`（CloudWatch Logs が遅れても stdout の書き込みでアプリを止めない。あふれた分は捨てる）。ロググループは今までどおり `/ecs/flowdesk-prod/{web,worker,migrate}`、保持 30 日。Collector のログは同じグループの `<名前>-otel/` のストリーム。
- **Logs Insights**：JSON のキーでそのまま絞り込める。よく使うクエリは保存した（`aws_cloudwatch_query_definition`：`by-trace-id`・`errors-by-message`・`slow-routes`・`failed-jobs`）。

## 3. トレース（OpenTelemetry）

### 構成

| 場所 | ファイル | 内容 |
|------|----------|------|
| SDK の起動 | `src/server/telemetry/sdk.ts` | TracerProvider・W3C Trace Context・AsyncLocalStorage・OTLP/HTTP の送信（`OTEL_EXPORTER_OTLP_ENDPOINT` があるときだけ）・`@prisma/instrumentation` |
| Next.js | `src/instrumentation.ts`・`src/instrumentation.node.ts` | 同梱のドキュメント `01-app/02-guides/open-telemetry.md` の手動の設定（`NEXT_RUNTIME === "nodejs"` のときだけ SDK を読む）。Next.js が自分でリクエスト・描画・Route Handler のスパンを作る |
| Worker | `src/worker/telemetry.ts`・`src/worker/index.ts` | 1 通ごとに CONSUMER のスパン `process flowdesk-jobs` |
| Service | `src/server/services/traced.ts` | `service.reservations.create` などのスパン（属性は組織の ID・ロール・結果だけ） |
| SQS | `src/server/queue.ts` | 送るときに PRODUCER のスパン `send flowdesk-jobs` を作り、`traceparent` をメッセージ属性に入れる。Worker はそれを親にする |
| ジョブ・外部 | `src/server/services/jobs.ts`・`mail.ts`・`storage.ts` | `job <種類>`・`smtp send`・`s3 PutObject` |

### 手元で確かめたこと（Jaeger 2.23.0）

顧客の CSV エクスポート（Server Action）1 回が、2 つのサービスにまたがる **1 本のトレース**になった（`x-request-id` で Jaeger を引いた。Prisma の細かいスパンは省略）：

```
flowdesk-web     POST /[org]/customers  168ms
  flowdesk-web     handler /get-session → db findOne session / user
  flowdesk-web     service.customerExports.request  44ms
    flowdesk-web     prisma:client:transaction（INSERT 3 件・COMMIT）
    flowdesk-web     send flowdesk-jobs  18ms
      flowdesk-worker  process flowdesk-jobs  104ms
        flowdesk-worker  job customer.export  71ms
          flowdesk-worker  prisma（顧客 1 万件を読む）
          flowdesk-worker  s3 PutObject  32ms
          flowdesk-worker  send flowdesk-jobs  4ms
            flowdesk-worker  process flowdesk-jobs  54ms
              flowdesk-worker  job mail.send  47ms
                flowdesk-worker  smtp send  47ms
```

- DB のスパンの SQL（`db.query.text`）はパラメーターが `$1` のままで、値は載らないことを確かめた。スパンの属性にはメールアドレス・名前を入れていない
- Worker のログの `traceId` は、リクエストの `x-request-id` と同じ値だった

### 分かったこと

1. **Next.js 16.4.6 は 1 つのリクエストに `BaseServer.handleRequest` のスパンを 2 つ作る。** 外側（ルートなし、proxy を含み 1〜5ms で終わる）と、内側（`next.route` あり）。内側の長さ（週表示で 175.9ms）は curl が本文を読み終えた時間（179.7ms）と合い、TTFB（15.7ms）より長い。アクセスログ・p95 は内側で数える（`src/server/telemetry/request-log.ts`）
2. **ALB の `TargetResponseTime` は p95 の監視に使えない。** 最初のバイトまでの時間で、Cache Components の画面は静的なシェルを数 ms で返すため（第15章でも TTFB はどれも数 ms〜100ms）。p95 は 1 の長さを EMF で出したメトリクス（`FlowDesk/RequestDuration`）で見る
3. **Worker を止めるときにロングポーリングを中断すると、メッセージが 60 秒届かなくなる。** トレースで、`receiveCount: 2` なのに処理のスパンが 1 つしかないジョブを見つけた。SIGTERM で受信を中断した Worker に、キュー（ElasticMQ）が中断された受信へメッセージを渡しており、可視性タイムアウトの間届かず、DLQ までの 3 回のうち 1 回を使っていた。停止の合図では受信を中断せず、受け取った分を処理してから止まるように直した（`src/worker/index.ts`）。直した後、SIGTERM の直後に送ったメッセージが `receiveCount: 1` のまま処理されてから止まることを確かめた。`kill -9`・タスクの強制停止では今でも起きる（キューが再配信するので失われはしない）
4. **Outbox の送り直し（`sweepStrandedJobs`）で送ったジョブは、新しいトレースになる。** 送った時点にリクエストのスパンがないため。DB の job に `traceparent` を持たせれば続けられるが、マイグレーションが要るので見送った（ログの `jobId` でたどれる）

### 本番（AWS に送る前提。**本物の AWS では未確認**）

- web・worker のタスクに **ADOT Collector**（`public.ecr.aws/aws-observability/aws-otel-collector:v0.51.0`、2026-10-29 の版）をサイドカーで足す（`var.tracing`、既定で有効）。アプリは `http://127.0.0.1:4318` に送り、Collector が **X-Ray の OTLP エンドポイント**（`https://xray.ap-northeast-1.amazonaws.com/v1/traces`）へ `sigv4auth`（サービス `xray`）で送る。権限はタスクロールの `xray:PutTraceSegments` だけ（AWS の文書で、OTLP の送信はこの操作で認可されると確かめた）
- **前提：CloudWatch の Transaction Search を有効にしておく**（スパンの送り先を CloudWatch Logs にする設定。無効だと OTLP エンドポイントは 400 を返すと報告されている）。Terraform には入れていない（アカウント全体の設定。初回のデプロイの前にコンソールか CLI で有効にする）
- **サンプリング：10%**（`trace_sampling_ratio`）。送らないリクエストもスパンは記録するので（`createAlwaysRecordSampler`）、アクセスログ・EMF・ログの `traceId` はすべてのリクエストで出る。障害のときに必要なトレースが 10% に入っていないことはある（そのときはログの `traceId` で 1 リクエストのログを全部引く）
- 未確認のこと：Collector が読み取り専用のルート・UID 10001 で動くか、Collector のメモリ（`memory_limiter` 100MiB、タスクのメモリから取られる。worker は 512MB）、Collector が止まったときにアプリの送信がどれだけ溜まるか（`BatchSpanProcessor` の既定の上限 2,048 個で捨てる）、X-Ray の画面で web → worker がつながって見えるか、Transaction Search の料金
- Collector は `essential = false`（止まってもアプリのタスクは止めない）

## 4. アラーム：何が起きたら誰に知らせるか（`modules/monitoring`）

| 重要度 | 知らせる先 | 対応 |
|--------|-----------|------|
| **critical** | `critical_alarm_emails`（当番。夜間・休日も、携帯に転送する） | すぐに見る。利用者がいま困っている・放っておくと止まる |
| **warning** | `warning_alarm_emails`（チーム） | 次の営業日に調べる。遅い・失敗が溜まっている |

鳴ったときと戻ったとき（OK）の両方を同じ先に送る。データがない時間（夜間にリクエストがない）は正常として扱う。

| アラーム | 重要度 | 条件 | 閾値の根拠 |
|----------|--------|------|-----------|
| `alb-5xx-ratio` | critical | (ALB の 5xx ＋ タスクの 5xx) ÷ リクエスト数 > **5%**、5 分ごとに 3 回のうち 2 回。5 分に 20 件未満は 0 として扱う | 第15章の負荷試験（同時 1・5・10 本）で 5xx は**すべての計測で 0 件**。正常では 0 なので、5% は「一部の画面・一部のタスクが壊れている」。件数の閾値（第17章は 5 分で 10 回）は、利用者が増えると鳴りやすく、少ない時間帯には鳴らないので割合にした。20 件未満を数えないのは、夜間の 1〜2 件の失敗で当番を起こさないため |
| `alb-unhealthy-targets` | critical | ヘルスチェック（`/login`）に失敗している web のタスクが 3 分続く | 第17章のまま。DB を使わない画面なので、失敗はアプリのプロセスの異常 |
| `app-p95-critical` | critical | 画面の p95（本文まで）> **2,000ms** が 10 分 | N-04（500ms）の 4 倍。第15章で最も遅い画面（週表示・予約の作成）を同時 10 本で飽和させても 561・590ms だったので、2 秒は CPU の飽和だけでは説明できない（DB・外部の待ち） |
| `jobs-queue-stalled` | critical | 本体のキューの最も古いメッセージ > **600 秒**が 10 分 | Worker が止まるとメッセージは DLQ に入らず本体に溜まる（受信されないので回数が増えない）。正常ならロングポーリング（20 秒）ですぐ受け、再試行の待ち（10・30 秒）と可視性タイムアウト（60 秒）を足しても 2 分以内。10 分はその 5 倍。パスワード再設定のメールが 10 分届かないのは利用者に見える |
| `ecs-web-task-stops`・`ecs-worker-task-stops` | critical | 異常で止まったタスク（`EssentialContainerExited`・`TaskFailedToStart`・ALB のヘルスチェックの失敗）が 15 分に **2 回**以上 | ECS は止まったタスクを入れ替える（再起動）ので、1 回は利用者に見えないことが多い（web は 2 タスク）。15 分に 2 回は入れ替えを繰り返している（起動直後に落ちる・メモリ不足）。デプロイ・台数の変更での停止は数えない（EventBridge のパターンで外す） |
| `rds-free-storage` | critical | 空き < 2GiB | 第17章のまま。埋まると書き込めなくなる（自動拡張の上限 100GB に近い） |
| `app-p95-slo` | warning | 画面の p95（本文まで）> **500ms** が 15 分 | N-04。第15章の改善後、同時 10 本で週表示・予約の作成だけが 561・590ms（他は 214ms 以下）。15 分続くのは、一時的な混雑ではなく台数・画面の作りの見直しが要る |
| `dlq-not-empty` | warning | DLQ に 1 件でも入る | 3 回失敗したジョブは自動では再実行されない（`docs/runbooks/incident-ai.md` の 6）。夜間に起きても朝に再実行すればよいものが多いので warning（Worker が止まったときは上の `jobs-queue-stalled` が critical で鳴る） |
| `app-errors` | warning | web・worker の `level=error` のログが 5 分に **10 件**を超え、2 回続く | 第15章の負荷試験ではエラーは 0 件。SMTP の障害の演習では 1 通につき 3 件出た（再試行ごと）ので、10 件は 4 通以上の失敗。DLQ より早く気づける |
| `rds-cpu` | warning | 80% が 15 分 | 第17章のまま。第15章ではどの一覧のクエリも数 ms〜24ms で、DB は飽和しなかった（遅さの原因は Node の側）。80% が続くのは想定外のクエリ |
| `rds-connections` | warning | 180 を超える | db.t4g.small の `max_connections` は約 225。web 4 タスク＋worker で、Prisma の既定のプール（CPU の数 × 2 ＋ 1）なら数十 |
| `rds-freeable-memory` | warning | 200MiB を下回る状態が 15 分 | db.t4g.small は 2GiB。キャッシュが追い出され、第15章の数 ms のクエリが遅くなり始める目安 |

- 閾値は `var.thresholds` で変えられる。warning の p95 を critical より大きくすると plan で止める（validation）
- 第17章からの直し：**SNS を AWS 管理のキー（`alias/aws/sns`）で暗号化していたため、CloudWatch のアラームの通知が届かない構成だった。** このキーのポリシーは変えられず、CloudWatch に使わせられない（AWS re:Post の説明。本物の AWS では確かめていない）。カスタマー管理の KMS のキー（月 1 USD）を作り、キーのポリシーで `cloudwatch.amazonaws.com` に `kms:Decrypt`・`kms:GenerateDataKey*` を許した
- DLQ のアラームは `modules/queue` から `modules/monitoring` に移した（誰に知らせるかを 1 か所で決める。`moved` ブロック付き）
- 外形監視（`/api/health`）は引き続き入れていない（`docs/architecture.md` の 9）

### ダッシュボード（`flowdesk-prod`）

リクエスト数と 5xx・画面の時間（本文までの p95・p50 と ALB の TTFB）・ECS の CPU とメモリ・タスクの異常停止とアプリのエラー・ジョブのキュー（件数・最も古いメッセージ・DLQ）・RDS・最近のエラー（Logs Insights の表）。

### 確かめ方（`terraform test`、モックのプロバイダー）

`infra/terraform/envs/prod/tests/prod.tftest.hcl` の `alarms_notify_by_severity` ほか：

- どのアラームも決めた重要度のトピックだけに送る（トピックの ARN を変えて確かめる）。critical は当番、warning はチームに届く
- SNS はカスタマー管理のキーで暗号化し、キーのポリシーでこのアカウントの CloudWatch に許す（`alias/aws/sns` に戻すとテストが失敗することを確かめた）
- 閾値：p95 は `FlowDesk/RequestDuration` の `p95`（ALB の値ではない）・500ms・15 分、critical は 2,000ms。5xx は割合の式。キューの滞留は最も古いメッセージの年齢・600 秒。タスクの停止はデプロイを数えないパターン
- タスク定義：web・worker に Collector があり migrate にない、OTEL の変数・EMF の名前空間・`LOG_FORMAT=json`・awslogs の non-blocking
- 本番の構成全体で、critical・warning の分け方（`production_wiring`）

## 5. 費用の追加（月額の目安、USD。**要確認**）

| 項目 | 前提 | 目安 |
|------|------|-----:|
| KMS のキー | 1 つ | 1.00 |
| アラーム | 12 個（標準）＋ 5xx の割合（式の中のメトリクス 3 つ） | 1.50 |
| カスタムメトリクス | `RequestDuration`・`Request5xx`・`AppErrors`・`EcsTaskStops` × 2 | 1.50 |
| ログ | アクセスログ 1 行（約 400 バイト）× 月 100 万リクエスト ＝ 0.4GB | 0.30 |
| ダッシュボード | 1 つ（3 つまで無料） | 0 |
| トレース | Transaction Search（スパンを CloudWatch Logs に取り込む）。10% × 月 100 万リクエスト × 約 80 スパン | **要確認**（Price List で確かめていない） |
| Collector のサイドカー | タスクのメモリの中で動く（予約 64MiB）。タスクの大きさは変えていない | 0 |

単価は第16章の CloudWatch の値（アラーム 0.10・メトリクス 0.30・Logs の取り込み 0.76/GB）から計算した。合計で**約 4〜5 USD ＋トレース**。

## 6. 依存（`docs/tech-stack.md`）

`@opentelemetry/api` 1.10.0、`@opentelemetry/sdk-trace`・`context-async-hooks`・`core`・`resources` 3.1.1、`@opentelemetry/exporter-trace-otlp-http`・`instrumentation` 0.301.2、`@opentelemetry/semantic-conventions` 1.45.0、`@prisma/instrumentation` 7.10.1。手元の受け口は Jaeger 2.23.0（`compose.yaml`）。
