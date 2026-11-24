# FlowDesk

美容室・整体院・スクールなど、予約で動く小規模事業者向けの予約・顧客管理 SaaS。
書籍『AI駆動フルスタック開発 完全実践』のサンプルアプリケーション。

## 主な機能

- 組織（テナント）ごとの店舗・スタッフ・メニュー管理
- 顧客管理（検索・メモ・添付ファイル・CSV エクスポート）
- 予約管理（カレンダー表示、スタッフごとの重複防止）
- Owner / Admin / Staff の権限と監査ログ
- Stripe によるサブスクリプション課金（テストモード）

## 章タグ

各章の完成状態にタグを付けている。途中から始めるときは、前の章のタグをチェックアウトする。

```bash
git checkout ch04
```

| タグ | 内容 |
|------|------|
| `ch01` | このリポジトリと README |
| `ch02` | Claude Code の設定（CLAUDE.md・権限・Hooks・Skills・Subagents） |
| `ch03` | 設計資料（`docs/`） |
| `ch04` | Next.js の土台、Docker Compose、品質ゲート |

## セットアップ

Node.js 24.13.0 と Docker が必要。

```bash
npm install                 # Git フックの有効化と Prisma Client の生成
cp .env.example .env.local
docker compose up -d --wait # PostgreSQL・S3 互換・SQS 互換・メール
npm run db:migrate          # マイグレーションを適用する
npm run db:seed             # デモデータを入れる
npm run aws:setup           # S3 のバケットと CORS を作る（初回だけ）
npm run dev                 # http://localhost:3000
npm run worker              # 別のターミナルで。メール送信・CSV エクスポートを処理する
```

| コマンド | 内容 |
|----------|------|
| `npm run db:migrate` | `prisma migrate dev`。スキーマの変更から新しいマイグレーションを作って適用する |
| `npm run db:seed` | 全テーブルを空にしてデモデータを入れ直す。予約は実行した日を基準に作る |
| `npm run db:reset` | 開発用 DB を作り直し、マイグレーションとシードをやり直す（データはすべて消える） |
| `npm run worker` | 非同期ジョブの Worker（SQS を受けてメールの送信・CSV の作成・前日リマインドを行う）。メールは http://localhost:8025 で確認する |
| `npm run aws:setup` | ローカルの S3（RustFS）にバケットを作り、CORS を設定する。何度実行してもよい |
| `npm run test:db` | DB を使うテスト。テスト用 DB（`flowdesk_test`）を自動で作り、毎回シードし直す |

`npm run check` は DB なしで通る（`*.db.test.ts` は含まない）。

`.env.local` の `BETTER_AUTH_SECRET` は、`openssl rand -base64 32` で作ったランダムな値に置き換える。

### 開発用のログイン

`npm run db:seed` のあと、http://localhost:3000/login で次のユーザーでログインできる。
パスワードは開発用 DB とテスト用 DB だけに入る（シードは本番では実行しない）。

| メールアドレス | パスワード | 所属とロール |
|----------------|------------|--------------|
| `user-demo@example.com` | `flowdesk-demo-2026` | デモサロンの Owner、さくら整体院の Staff |

他のシードのユーザー（`user-a1@example.com`（デモサロンの Admin）、`user-a2@example.com`（デモサロンの Staff）など）も同じパスワードでログインできる。

パスワード再設定のメールは Mailpit（http://localhost:8025）に届く。

| サービス | URL |
|----------|-----|
| アプリ | http://localhost:3000 |
| メール（Mailpit） | http://localhost:8025 |

## Stripe（テストモード）

料金プラン（Free / Pro）の設計は [`docs/billing.md`](docs/billing.md)。**テストモードの API キーだけを使う**（`sk_test_`。本番の `sk_live_` は使わない）。

キーがなくても、Webhook の署名の検証・同じイベントの 2 回目・順番の入れ替わり・プランによる機能制限は、テストで確かめられる（`stripe` パッケージの `generateTestHeaderString` で署名したイベントを使う）：

```bash
npm test          # src/server/stripe.test.ts（署名）、src/server/plans.test.ts（プランと順番の規則）
npm run test:db   # src/server/services/billing.db.test.ts（Webhook・冪等性・順番・機能制限・Owner のみ）
```

以下は API キーが必要な確認の手順。

### 1. Stripe の準備（ダッシュボードのテストモード）

1. [Stripe のダッシュボード](https://dashboard.stripe.com/test/dashboard)を**テストモード**にする
2. 商品カタログで商品「FlowDesk Pro」を作り、価格を「継続、月次、3,000 円（JPY）」にする。価格の ID（`price_...`）を控える（`PLANS.pro.priceYen` と金額を合わせる）
3. 設定 → Billing → [カスタマーポータル](https://dashboard.stripe.com/test/settings/billing/portal)で次を有効にして保存する
   - 支払い方法の更新
   - サブスクリプションのキャンセル（「請求期間の終了時」を推奨。画面に解約日を表示する）
   - サブスクリプションの切り替え（年額などの価格を足したら、その価格を選べるようにする。足した価格の ID は `STRIPE_PRICE_PRO` にカンマ区切りで追加する）
4. 開発者 → API キーで、シークレットキー（`sk_test_...`）を控える

### 2. 環境変数（`.env.local`）

```bash
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_PRICE_PRO="price_..."
STRIPE_WEBHOOK_SECRET="whsec_..."   # 次の stripe listen が表示する値
```

### 3. Webhook をローカルに転送する（Stripe CLI）

```bash
stripe login   # 初回だけ。ブラウザでテストモードのアカウントを許可する
stripe listen \
  --events customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.paused,customer.subscription.resumed \
  --forward-to localhost:3000/api/webhooks/stripe
```

表示された `whsec_...` を `.env.local` の `STRIPE_WEBHOOK_SECRET` に入れ、`npm run dev` を起動し直す。`stripe listen` を止めると転送も止まる（次に起動したときも同じ `whsec_` が表示される）。

### 4. 確認する

| 確認すること | 手順 | 期待する結果 |
|--------------|------|--------------|
| Owner のみ | Admin（`user-a1@example.com`）でログインし `/demo-salon/billing` を開く | 「料金プランを変更できるのは Owner です」。サイドバーに「料金プラン」がない |
| 申し込み | Owner（`user-demo@example.com`）で `/demo-salon/billing` →「Pro に申し込む」→ カード `4242 4242 4242 4242`、有効期限は未来の日付、CVC は任意の 3 桁 | Checkout から戻り「受け付けました」。`stripe listen` に `customer.subscription.created`・`updated` が `[200]` で出て、読み込み直すと「Pro」 |
| 3D セキュア | カード `4000 0025 0000 3155` で申し込む | 認証の画面が出る。認証すると Pro、失敗すると Free のまま |
| 支払いの拒否 | カード `4000 0000 0000 9995`（残高不足で拒否される）で申し込む | Checkout にエラーが出て申し込めない。Free のまま |
| カードの変更 | 「カスタマーポータルを開く」→ 支払い方法を追加・変更 | 変更でき、ポータルの戻るリンクで S-14 に戻る |
| 解約 | ポータルで「プランをキャンセル」 | 期間の終わりに解約する設定なら「解約日」が表示され、期間が終わるまで Pro のまま |
| 即時の解約 | ダッシュボードでサブスクリプションを「今すぐキャンセル」 | `customer.subscription.deleted` が届き Free に戻る。スタッフ・店舗は消えず、追加だけできなくなる |
| 同じイベントの再送 | ダッシュボード → 開発者 → イベントで、届いたイベントを「再送」（または `stripe events resend evt_...`） | 200 が返り、監査ログ（`/demo-salon/audit-logs`）に同じ変更が 2 回残らない |
| 署名の検証 | `curl -X POST localhost:3000/api/webhooks/stripe -d '{}'` | 400 |

デモサロンはシードでスタッフが 3 人いる（Free の上限を超えている。Pro から Free に戻った状態と同じ）ので、Free のままではスタッフを招待できない。上限ちょうどの例は、さくら整体院（スタッフ 2 人）。
