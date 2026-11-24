# テスト戦略

確認日：2026-11-25（第13章）。FlowDesk のテストは 3 層に分ける。下の層ほど速く、数を多くする。
認可の判断は `docs/authz-matrix.md` を正とし、テストもこの表から書く。

| 層 | コマンド | 道具 | 対象 | DB・外部サービス | 目安の時間 |
|----|----------|------|------|------------------|-----------|
| 単体 | `npm test`（`npm run check` に含む） | Vitest | 検証（Zod）・認可の表・日時と金額・純粋な関数 | 使わない | 1 秒 |
| DB を使う結合 | `npm run test:db` | Vitest | Service 層と Repository 層。テナント分離・権限・上限・監査ログ・排他制約・楽観ロック・ジョブ | PostgreSQL（テスト用 DB）。S3・SQS・Stripe・SMTP は差し替える | 5 秒 |
| E2E | `npm run test:e2e` | Playwright（Chromium） | 画面の操作と、ブラウザ・サーバー・DB・S3 のつながり。過去の不具合の回帰 | PostgreSQL（E2E 用 DB）・RustFS。SQS には送らない | ビルド 1 分＋実行 15 秒 |

## 何をどこで確かめるか

判断の基準は「その不具合はどこで起きうるか」。

| 確かめること | 単体 | DB | E2E | 例 |
|--------------|:----:|:--:|:---:|----|
| 入力の検証（必須・範囲・整数・タイムゾーン） | ○ | | △ | `validation/*.test.ts`。E2E はエラーの表示だけを見る |
| 認可の表（ロールごとの可否） | ○ | | | `services.test.ts` の「認可マトリクスの表」。表の 1 行＝1 テスト |
| 担当・相手のロールで決まる認可（△） | ○ | ○ | | Staff は自分の予約のみ、Admin は Staff⇔Admin のみ |
| 他の組織の ID を指定すると not_found | | ○ | 第14章 | 更新・削除・取得のすべてで確かめ、相手の行が変わっていないことも見る |
| DB の状態で決まる条件 | | ○ | | 最後の Owner、プランの上限、予約で使われている店舗・メニュー |
| 監査ログが変更と同じトランザクションで残る | | ○ | | 操作者・対象・変わった項目名 |
| 同時実行（排他制約・行ロック・楽観ロック） | | ○ | | 5 件同時の予約で成功は 1 件、同時の受諾で上限を超えない |
| 金額は円の整数、日時は UTC で保存 | ○ | ○ | | 予約時点の料金が残る、店舗のタイムゾーンで UTC に変換 |
| 画面の状態（エラーの後もフォームの値が残る） | | | ○ | 第9章の回帰 |
| ブラウザから S3 への直接 PUT と完了の確認 | | △ | ○ | DB のテストは S3 を差し替え、E2E は RustFS に本当に送る（第11章の回帰） |
| ログインとリダイレクト | | △ | ○ | Cookie・proxy・callbackUrl は E2E でしか確かめられない |

E2E は遅く、壊れやすい。**Service で判定できることは DB のテストで確かめ、E2E には「画面とサーバーのつなぎ目」だけを残す**。たとえば Staff が店舗を作れないことは DB のテスト（`forbidden`）で確かめ、E2E では「Staff にはフォームが出ない」ことだけを見る。

## Service 層のテストの観点

Service を足すとき・変えるときは、次を順に確かめる（第13章の見直しで足したものに †）。

1. 表の各ロールで可否が合う（`forbidden`）。拒否したとき行が変わっていない
2. 他の組織・存在しない・論理削除済みの ID は区別せず `not_found`。相手の組織の行が変わっていない
3. 参照する ID（顧客・メニュー・スタッフ・店舗）も組織で絞る
4. DB の状態で決まる条件（`last_owner`・`plan_limit`・`in_use`†・`slot_taken`・`conflict`）
5. 監査ログ：作成・変更・削除・キャンセルのそれぞれで、操作者と対象が残る（予約の作成・キャンセル†、顧客の削除†）
6. 集計は別の方法で数えた値と一致する（ダッシュボードの売上はキャンセルを除く†）
7. 画面の選択肢も認可に従う（Staff の予約フォームには自分だけ†）

## DB を使うテスト（`*.db.test.ts`）

- 接続先は `TEST_DATABASE_URL`（なければ `DATABASE_URL` の DB 名を `flowdesk_test` にしたもの）。名前が `_test` で終わらなければ止める
- `test/db-global-setup.ts` が 1 回だけ、`flowdesk_test` にマイグレーションを当ててシード（基準日 `TEST_NOW`＝2026-11-23 12:00 JST）を入れる
- `test/db-per-file.ts`（`setupFiles`）が、**テストファイルごとに `flowdesk_test` をテンプレートにした DB を複製**し（`CREATE DATABASE ... TEMPLATE`）、そのファイルの `DATABASE_URL` にする。ファイルが終わると消す（`DROP DATABASE ... WITH (FORCE)`）。途中で止まって残った複製は、次の実行の最初に消す
- そのため**ファイルは並列に実行する**（以前は `fileParallelism: false`）。ほかのファイルが作った行・消した行・数えた件数に影響されない（以前は、あるファイルの `auditLog.deleteMany({ createdAt: { gte: startedAt } })` が、同時に動くほかのファイルの監査ログまで消しうる書き方だった）
- テンプレートには接続しない。接続が残ると複製が `being accessed by other users` で失敗する
- 同じファイルの中のテストは順に実行され、DB を共有する。テストの順番に頼らないよう、作る予約はテストごとに別の日（シードの範囲外の 2027 年）にし、プランなど組織の状態を変えたら `finally` で戻す
- 外部サービスは引数で差し替える（`StorageDeps`、Stripe のクライアント、メールの送信）。SQS は `SQS_QUEUE_URL=""` で送らない

## E2E（`e2e/`）

- `playwright.config.ts` が `npm run build` → `next start --port 3100` で、本番と同じ形のサーバーを起動する（`E2E_SKIP_BUILD=1` でビルドを省ける）。開発サーバー（3000）と同時に動かせる
- DB は `E2E_DATABASE_URL`（なければ `flowdesk_e2e`。名前は `_e2e` で終える）。`e2e/global-setup.ts` が実行のたびにマイグレーションを当て、**今日を基準に**シードを入れる（画面は今日の日付で動くため）
- S3 は E2E 専用のバケット `flowdesk-e2e`。CORS で `http://localhost:3100` を許す（開発用のバケットの CORS を書き換えない）
- `BETTER_AUTH_SECRET` は E2E 専用の値を渡す（`next start` は本番モードなので、既定の鍵では Better Auth が動かない）
- ログインは `e2e/auth.setup.ts`（`setup` プロジェクト）で Owner と Staff の 2 回だけ行い、Cookie を `e2e/.auth/` に保存する。ほかのテストは保存した状態から始める。Better Auth は本番モードで `/sign-in` を **10 秒に 3 回まで**に制限するので、ログインのテストを増やすときは気をつける
- テストは並列に動き、DB は実行ごとに 1 回だけ入れ直す。**データを壊し合わないよう**、予約は `freeDate(testInfo, slot)` でテストごと・再試行ごとに別の日に、作るメニューは `uniqueSuffix(testInfo)` で別の名前にする。シードの行（渋谷店・カットなど）を変えるテストは書かない
- 要素はロールとラベルで探す。ラベルは部分一致するので、サイドバー（「メインメニュー」）と重なるものは `{ exact: true }` にする。Next.js のルートの読み上げ（`__next-route-announcer__`）も `role="alert"` なので、エラーはフォームの中に絞って探す

### 回帰テスト

| 章 | 不具合 | テスト | 確かめたこと |
|----|--------|--------|--------------|
| 9 | 予約のエラーの後、select が最初の選択に戻る | `e2e/reservations.spec.ts`「重なる予約はエラーになり、選んだ内容がフォームに残る」 | 修正（select の `key`）を外すと「顧客」が `""` になって失敗する |
| 11 | 名前だけ .png の SVG が登録できる | `e2e/attachments.spec.ts`「名前だけ .png の SVG は拒否する」 | 先頭のバイトの確認を外すと、エラーが出ずに失敗する |

不具合を直したら、直す前に失敗する回帰テストを足し、この表に書く。

## テストを先に書く手順（店舗・メニューの管理の例）

第13章では店舗の管理（F-05、S-12）とメニューの管理（F-06、S-11）を、次の順で作った。

1. **表から観点を書き出す**：閲覧は全ロール、作成・編集・削除は Owner・Admin（`authz-matrix.md`）。店舗は Free で 1 つまで（第12章）。予約が使っている店舗・メニューは消せない。料金を変えても予約の料金は変わらない
2. **単体のテストを書く**：入力の検証（`validation/catalog.test.ts`）、認可の表、サイドバーの項目
3. **DB のテストを書く**：`services/catalog.db.test.ts`。Service の関数名と戻り値（`Result`）をここで決める
4. **失敗を確かめる**：まず import が解決できずにファイルごと失敗する。関数の形だけの仮の実装（`throw new Error("未実装")`）を置き、**各テストが自分の理由で失敗する**ことを確かめる。このとき通ってしまったテストは、仮の実装でも通る弱いテストなので見直す（例：仮の `z.number()` はどんな文字列も拒否するので「小数を拒否する」が通った。整数に直せる値を受け付けるテストと組にして意味を持たせた）
5. **実装する**：Repository → Service → Server Action → 画面
6. **E2E を書き、画面がない状態で失敗することを確かめてから通す**

## CI で回すもの

| ジョブ | いつ | 内容 | 必要なもの |
|--------|------|------|-----------|
| check | すべての push と PR | `npm ci` → `npm run check`（型・Lint・整形・単体） | なし |
| build | すべての push と PR | `npm run build`（**`DATABASE_URL` を設定しない**。第8章の回帰） | なし |
| test-db | すべての push と PR | `npm run test:db` | PostgreSQL 18.7（サービスコンテナ。`TEST_DATABASE_URL` を渡す） |
| e2e | PR と main | `npx playwright install --with-deps chromium` → `npm run test:e2e` | PostgreSQL・RustFS（`S3_ENDPOINT` と鍵）。失敗したら `playwright-report/` と `test-results/`（trace）を成果物に残す |

- CI（`CI=1`）では E2E の再試行を 2 回にし、`test.only` を禁止する。ローカルは再試行しない（不安定なテストを隠さない）
- 再試行で通ったテスト（flaky）は放置せず、原因を直す。データの衝突なら `freeDate`・`uniqueSuffix` を使っているか確かめる
- 本番の鍵（Stripe など）は CI に渡さない。Stripe は署名を自分で作るテスト（`test/stripe-events.ts`）で確かめる
- ワークフローの定義（GitHub Actions）は、AWS へのデプロイと合わせて第16〜17章で作る

## ローカルでの実行

```sh
docker compose up -d --wait     # PostgreSQL・RustFS・ElasticMQ・Mailpit
npm run check                   # 単体（DB なし）
npm run test:db                 # DB を使うテスト
npx playwright install chromium # 初回だけ
npm run test:e2e                # E2E（ビルドしてから 3100 番で起動）
```

`.env.local` の値（`DATABASE_URL`・`S3_ENDPOINT` など）をそのまま使う。テスト用・E2E 用の DB とバケットは名前を変えて作るので、開発用のデータは消えない。
