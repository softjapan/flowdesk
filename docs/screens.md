# 画面一覧

ルートは `src/app` 配下。`(auth)` と `(dashboard)` は Route Group（URL に含まれない）。
`[org]` は組織のスラッグ。テナントは URL で選び、Service 層で「ログインユーザーがその組織のメンバーか」を毎回検証する。

| ID | 画面 | パス | 主な部品 | 権限 | 章 |
|----|------|------|----------|------|----|
| S-01 | ログイン | `/login` | Client Component のフォーム | 未ログイン | 8 |
| S-02 | 新規登録 | `/signup` | 同上 | 未ログイン | 8 |
| S-03 | パスワード再設定 | `/reset-password` | 同上 | 未ログイン | 8 |
| S-04 | 組織の選択・作成 | `/orgs` | 所属組織の一覧、作成フォーム | ログイン済み | 10 |
| S-05 | 招待の受諾 | `/invitations/[id]` | | ログイン済み | 10 |
| S-06 | ダッシュボード | `/[org]` | KPI カード 3 つ、予約推移グラフ、本日の予約 | 全ロール | 6・15 |
| S-07 | 予約カレンダー | `/[org]/reservations` | 日・週表示、スタッフで絞り込み | 全ロール | 9 |
| S-08 | 予約の作成・編集 | `/[org]/reservations/new`、`/[org]/reservations/[id]` | 顧客・メニュー・スタッフ・日時 | 全ロール | 9 |
| S-09 | 顧客一覧 | `/[org]/customers` | 検索、ページング、CSV エクスポート | 全ロール | 9・11 |
| S-10 | 顧客詳細 | `/[org]/customers/[id]` | 基本情報、写真、予約履歴 | 全ロール | 9・11 |
| S-11 | メニュー管理 | `/[org]/services` | 一覧と編集 | Owner / Admin | 9 |
| S-12 | 店舗管理 | `/[org]/locations` | 一覧と編集 | Owner / Admin | 9 |
| S-13 | メンバー管理 | `/[org]/members` | 招待、ロール変更、削除 | Owner / Admin | 10 |
| S-14 | 料金プラン・請求 | `/[org]/billing` | 現在のプラン、Checkout、カスタマーポータル | Owner | 12 |
| S-15 | 監査ログ | `/[org]/audit-logs` | 期間・操作者・対象で絞り込み | Owner / Admin | 10 |
| S-16 | 組織設定 | `/[org]/settings` | 組織名、組織の削除 | Owner | 10 |

## Route Handlers（画面ではない入口）

| パス | 用途 | 章 |
|------|------|----|
| `/api/auth/[...all]` | Better Auth のハンドラー | 8 |
| `/api/webhooks/stripe` | Stripe Webhook（署名検証） | 12 |
| `/api/uploads/presign` | S3 署名付き URL の発行 | 11 |
| `/api/health` | ALB のヘルスチェック | 16 |
