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
