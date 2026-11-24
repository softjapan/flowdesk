# 料金プランと課金（第12章）

F-14（料金プランとサブスクリプション）と F-15（プランによる機能制限）の設計。Stripe は**テストモードだけ**を使う（`docs/tech-stack.md` の `stripe` 23.2.0。SDK の既定の API バージョンは `2026-11-18.endive`）。

## 料金プラン

| プラン | 月額 | スタッフ | 店舗 | 申し込み |
|--------|------|----------|------|----------|
| Free | 0 円 | 2 人まで | 1 つまで | 組織を作ると Free（`subscription` の行がない） |
| Pro | 3,000 円（`priceYen: 3000`） | 上限なし | 上限なし | Stripe Checkout |

- プランの定義は `src/server/plans.ts` の `PLANS`。金額は円の整数で持つ。画面に出す金額は表示用で、請求する金額は Stripe の Price が正（Price の金額を変えたら `PLANS.pro.priceYen` も合わせる）
- 「スタッフ」は予約を担当するメンバー（`docs/requirements.md` の用語。Staff ロールに限らない）。**有効な `staffProfile`（`active = true` かつ `memberId` がある）の数**で数える。メンバーを削除して無効になったスタッフ情報（予約の履歴のために残している）は数えない
- 店舗は `location` の行数で数える

## 課金のモデル

- **課金の単位は組織**。1 組織に Stripe の顧客（Customer）が 1 人、サブスクリプションが最大 1 つ。`subscription` テーブルは組織ごとに 1 行（`organizationId` が一意）
- Stripe の顧客は、Owner が初めて「Pro に申し込む」を押したときにサーバーが作り（`metadata.organizationId` を付ける）、`subscription.stripeCustomerId` に保存する。Stripe の冪等キー（`flowdesk-customer:{organizationId}`）を付けるので、同時に 2 回押しても顧客は 1 人
- Checkout のセッションには `client_reference_id` と `subscription_data.metadata.organizationId` に組織 ID を入れる
- **組織のプラン（`subscription.plan`）は Webhook でだけ書き換える。** Checkout の戻り先（`/[org]/billing?checkout=success`）は誰でも開ける URL なので信用せず、「受け付けました」と表示するだけにする

| 列 | 意味 |
|----|------|
| `plan` | `free` / `pro`。機能制限はこの値で判定する |
| `status` | Stripe のサブスクリプションの status。申し込み前は `none` |
| `stripeCustomerId` / `stripeSubscriptionId` / `stripePriceId` | Stripe の ID |
| `currentPeriodEnd` | 期間の終わり（次回の更新日・解約日）。Stripe 2025 年以降の API ではサブスクリプションではなく項目（`items.data[].current_period_end`）にある |
| `cancelAtPeriodEnd` | 期間の終わりに解約する予約（ポータルの設定により `cancel_at_period_end` か `cancel_at` で届く。どちらかがあれば true） |
| `lastEventAt` | 反映した最後のイベントの作成日時（`event.created`）。順番の入れ替わりの判定に使う |

### status とプラン

| status | プラン | 理由 |
|--------|--------|------|
| `active` / `trialing` | Pro | |
| `past_due` | Pro | 支払いの失敗後、Stripe が再試行している間。カードの更新を待つ（再試行が尽きると `canceled` か `unpaid` になる） |
| `incomplete` | Free | Checkout の支払いがまだ確定していない |
| `canceled` / `incomplete_expired` / `unpaid` / `paused` | Free | |

`STRIPE_PRICE_PRO` に登録していない Price のサブスクリプションは、status が `active` でも Pro にしない（同じ Stripe アカウントの別の商品で Pro を使えないように）。

### Free に戻ったとき

Pro を解約して Free に戻っても、上限を超えた分のスタッフ・店舗は**消さず、そのまま使える**。新しく追加すること（招待・招待の受諾・店舗の作成）だけを止める。データを消すと予約の履歴が壊れ、再び Pro にしたときに戻せないため。

## 画面と操作（S-14 `/[org]/billing`、Owner のみ）

| 操作 | 方法 | Service |
|------|------|---------|
| 現在のプラン・上限の使用状況を見る | S-14 | `getBillingPage` |
| Pro に申し込む | Stripe Checkout（`mode: "subscription"`）へ移動 | `startProCheckout` |
| プランの変更・解約・支払い方法の変更・請求書の確認 | Stripe のカスタマーポータルへ移動 | `openCustomerPortal` |

- 権限は `docs/authz-matrix.md` の「料金プラン」。変更・解約（Checkout・ポータル）は Owner のみで、Service（`authz.canManageBilling`）で判定する。S-14 の画面も Owner のみ（`docs/screens.md`）
- 「料金プラン／閲覧」は Admin も可なので、Admin にはメンバー管理（S-13）に「Free プラン：スタッフ 2 / 2 人」と上限の使用状況を出す（`getMembersPage` の `planUsage`、`authz.canViewBilling`）
- ポータルでできること（プランの切り替え先、解約の方法＝即時か期間の終わりか、支払い方法の変更）は、Stripe のダッシュボードのポータルの設定で決める（README の手順）。アプリはポータルのセッションを作るだけ
- `STRIPE_SECRET_KEY` か `STRIPE_PRICE_PRO` がないと、ボタンを出さず「設定されていない」と表示する（Service は `billing_unavailable`）

## Webhook（`/api/webhooks/stripe`）

処理の流れ（`src/app/api/webhooks/stripe/route.ts` → `src/server/services/billing.ts` の `handleStripeEvent`）：

1. **署名の検証**（Route Handler）。`request.text()` で加工する前の本文を読み、`Stripe-Signature` ヘッダーと `STRIPE_WEBHOOK_SECRET` で `Stripe.webhooks.constructEventAsync` を呼ぶ。署名が合わない・ヘッダーがない・署名の時刻が 5 分（Stripe の既定の許容幅）より古いものは **400**。API キーは要らない（`Stripe.webhooks` は静的に使える）
2. **冪等性**。1 つのトランザクションで、まず `stripeEvent` にイベント ID を INSERT する（`ON CONFLICT DO NOTHING`）。行ができなければ処理済みなので何もせず **200**（`duplicate`）。同じイベントが同時に届いた場合も、後の INSERT は先のトランザクションの終わりを待ってから一意制約で何もしない
3. **組織を引く**。`customer.subscription.*` のイベントの `customer` から `subscription.stripeCustomerId` で組織を引く。知らない顧客・`metadata.organizationId` が食い違うものは反映しない（`ignored`）
4. **順番の入れ替わり**。組織の行をロックしてから、保存してある `lastEventAt` と比べる（下記）。古いものは反映しない（`stale`）
5. **反映**。`plan`・`status` などを更新し、プランか status が変わったら監査ログ（`subscription.update`、操作者は `system:stripe`）を同じトランザクションで残す
6. イベントの記録に結果（`applied` / `stale` / `ignored`）と組織 ID を書いて、**200** を返す

途中で例外が起きたらトランザクションごと取り消され（イベント ID の記録も残らない）、**500** を返す。Stripe は 2xx 以外を間隔を空けて再送する（本番モードは最大 3 日間、テストモードは数時間）ので、再送で処理し直す。

処理するイベント：`customer.subscription.created` / `updated` / `deleted` / `paused` / `resumed`。ほかの種類は記録だけして 200（`ignored`）。Stripe のダッシュボード（または `stripe listen --events`）で送るイベントを絞る。

### 順番が前後して届く場合

Stripe はイベントの配送の順番を保証しない（再送もあるので、古いイベントが新しいイベントの後に届く）。イベントの中のサブスクリプションは**そのイベントを作った時点のもの**なので、届いた順に上書きすると古い状態に戻ってしまう。

`src/server/plans.ts` の `isStaleEvent` で、次のものを反映しない：

1. 反映済みのイベントより `event.created` が古いもの
2. `event.created` は秒単位で、同じ秒のイベントは前後が分からない。同じサブスクリプションについて、戻れない向きの変化を捨てる：
   - 終了した（`canceled` / `incomplete_expired`）サブスクリプションを、終了していない status に戻すもの（Stripe でも終了したサブスクリプションは再開できない）
   - 有効になった後に `incomplete`（作成直後だけの status）に戻すもの
3. 有効なサブスクリプションがあるときの、**別の**サブスクリプションの終了（二重に申し込んだ古い方の解約などで Free にしない）

別の方法として、イベントを受け取るたびに Stripe の API でサブスクリプションの最新の状態を取り直す方法もある（順番を気にしなくてよい）。FlowDesk は、API キーなしでテストでき、Webhook の処理が Stripe の API の障害に左右されないよう、イベントの中身と作成日時で判定する。

### なぜ 200 を返すか

対象外のイベント・知らない顧客・古いイベントも 200 を返す。4xx・5xx を返すと Stripe が再送を続け、ダッシュボードで失敗として扱われる（失敗が続くとエンドポイントを無効にされる）。再送で結果が変わるもの（DB の一時的な障害など）だけ 500 にする。

## Better Auth の Stripe プラグインとの比較

Better Auth には Stripe プラグイン（`@better-auth/stripe` 1.7.27。peer 依存は `stripe ^18〜^23`・`better-auth ^1.7.27`）があり、organization プラグインと組み合わせて組織単位のサブスクリプションを扱える（`customerType: "organization"`、`referenceId` に組織 ID）。パッケージの中身（`dist/index.mjs`）を読んで比べた。

| 観点 | `@better-auth/stripe` | 自前（`stripe` パッケージを直接使う） |
|------|----------------------|----------------------------------------|
| Webhook の入口 | `/api/auth/stripe/webhook`（Better Auth のハンドラーの中） | `/api/webhooks/stripe`（`docs/screens.md` のとおり） |
| 署名の検証 | あり（`constructEventAsync`） | あり（同じ関数） |
| 同じイベントの 2 回目 | イベント ID を記録しない。`created` は「行があれば作らない」、`updated` は毎回上書き。監査ログなどの副作用（`onSubscriptionUpdate` などのコールバック）は配送のたびに実行される | イベント ID の一意制約で 1 回だけ処理する |
| 順番の入れ替わり | 考慮しない（届いた順に上書きする）。古い `updated` が後から届くと古い状態に戻る | `event.created` と status の向きで古いものを捨てる |
| 処理に失敗したとき | 例外をまとめて 400 を返す（Stripe は再送するが、原因の区別がない） | 500 を返し、イベントの記録も取り消して再送で処理し直す |
| テーブル | プラグインの `subscription`（`referenceId`・`periodStart`・`periodEnd`・`seats` など）を作り、`user`・`organization` に `stripeCustomerId` の列を足す | 第7章から `docs/er.md` にある `subscription`（`organizationId` が一意）を使う |
| 認可 | `authorizeReference` のコールバックで判定する。申し込み・解約の HTTP の入口（`/subscription/upgrade`・`/subscription/cancel` など）が増える | Service 層（`authz.canManageBilling`）で判定する。HTTP の入口は Server Action だけ |
| 監査ログ | 変更と同じトランザクションにできない（コールバックは更新の後） | 変更と同じトランザクションで残す |
| 機能制限（F-15） | プランに `limits` を書けるが、強制はアプリが行う | 同じ（Service 層で強制する） |
| 書く量 | 少ない（Checkout・ポータル・Webhook が揃う） | 多い（このファイルの Service と Webhook、テスト） |

**自前で作ることにした。** 理由：

1. **冪等性と順番の入れ替わりが要件（第12章の 3）なのに、プラグインはどちらも扱わない。** プラグインの上で足そうとしても、Webhook の処理はプラグインの中にあり、イベント ID の記録と更新を同じトランザクションにできない
2. **FlowDesk の方針と合わない。** 組織・メンバーの変更は Better Auth の HTTP の入口を `disabledPaths` で閉じて Service 層を通している（`docs/authz-matrix.md`、`docs/tech-stack.md` の 19〜21）。プラグインは申し込み・解約の HTTP の入口を増やし、認可をコールバックで判定し、監査ログを同じトランザクションにできない。第10章で organization プラグインの判定を使わなかったのと同じ理由
3. **テーブルの形が `docs/er.md` と違う。** プラグインは自分の `subscription` の形と `organization.stripeCustomerId` を前提にし、Webhook の入口も `docs/screens.md` と違う
4. Stripe のうち使うのは Customer・Checkout・カスタマーポータル・Webhook の 4 つだけで、自前で書く量が多くない。依存も増えない（`stripe` は `docs/tech-stack.md` にある）

プラグインが向いているのは、個人課金（`customerType: "user"`）で、Webhook の処理がプラグインの既定どおりでよく、HTTP の入口と認可を Better Auth に任せている構成。

## 検証

| 確認すること | 方法 | API キー |
|--------------|------|----------|
| 署名の検証（正しい署名・改ざん・別の秘密・古い時刻・ヘッダーなし） | `src/server/stripe.test.ts`（`npm test`） | 不要 |
| status とプラン、順番の判定の規則 | `src/server/plans.test.ts`（`npm test`） | 不要 |
| Webhook の 400・200・500、同じイベントの 2 回目・同時の配送、順番の入れ替わり、監査ログ | `src/server/services/billing.db.test.ts`（`npm run test:db`）。`generateTestHeaderString` で署名したイベントを Route Handler に渡す | 不要 |
| 機能制限（テストケース 5、同時の受諾、店舗、Free に戻ったとき） | 同上 | 不要 |
| Checkout・ポータルの権限（Owner のみ）、顧客を 1 人だけ作る | 同上（Stripe を呼ぶ部分 `BillingGateway` を差し替える） | 不要 |
| Checkout で申し込める、ポータルで解約・カードの変更ができる、`stripe listen` で Webhook が届く | README の「Stripe（テストモード）」の手順 | 必要 |
