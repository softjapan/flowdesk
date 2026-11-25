# マイグレーションを安全に流す（expand と contract）

確認日：2026-11-25（第17章）。デプロイの手順は `docs/ci-cd.md`、テーブルの定義は `docs/er.md` を正とする。

## 1. なぜ分けるのか

本番のデプロイは **migrate を先に流し、その後で web・worker を入れ替える**（`scripts/deploy/ecs-deploy.mts`）。そのため、次の時間はどれも「新しいスキーマ」と「古い版のコード」が同時に動く：

1. migrate が終わってから、web・worker の新しいタスクが健康になるまで（数分）
2. 新しい版が失敗して、ECS のサーキットブレーカーが**古い版に戻した**あと（スキーマは戻らない）
3. worker のジョブ（SQS）の再試行。古い版が積んだジョブを新しい版が、またはその逆が処理する

古い版が読み書きする列を消す・名前を変える・型を変えると、この間にエラーになり、データを失うこともある。そこで、**1 回のデプロイでは「古い版も新しい版も動くスキーマ」にしか変えない**。壊す変更は、追加（expand）とあとかたづけ（contract）の 2 回以上のデプロイに分ける。

## 2. 手順

例：顧客の `phone`（TEXT）を `tel` に改名する。

| デプロイ | マイグレーション | コード | 確かめること |
|----------|------------------|--------|--------------|
| ① expand | `ALTER TABLE "customer" ADD COLUMN "tel" TEXT;`（NULL を許す・既定値なし） | 書くときは `phone` と `tel` の両方に書く。読むときは `tel ?? phone` | 古い版は `tel` を知らないが、NULL を許すので INSERT が通る |
| ② 移行 | 既存の行を移す：`UPDATE "customer" SET "tel" = "phone" WHERE "tel" IS NULL;`（行が多ければ、worker のジョブで少しずつ） | 変えない | `SELECT count(*) FROM "customer" WHERE "tel" IS NULL AND "phone" IS NOT NULL` が 0 |
| ③ 切り替え | （必要なら）`tel` を NOT NULL にする前に、NULL がないことを確かめる | `tel` だけを読み書きする。`phone` を書かない | ①②の版に戻しても `phone` は残っている |
| ④ contract | `-- migration-safety: allow drop-column …` を付けて `DROP COLUMN "phone"` | 変えない | ③の版が安定してから（ロールバックの先が ③ 以降になってから）。最低 1 日あける |

ほかの変更も同じ考え方：

| やりたいこと | expand | contract |
|--------------|--------|----------|
| 列を消す | コードから読み書きをなくす版をデプロイ | 次のデプロイで `DROP COLUMN`（allow を付ける） |
| 列の型を変える（例：INTEGER → BIGINT） | 新しい型の列を足し、両方に書き、移す | 古い列を消す。`ALTER COLUMN ... TYPE` は表を書き換えて長くロックするので使わない |
| NOT NULL を付ける | まずアプリが必ず値を書くようにし、既存の NULL を埋める | `SET NOT NULL`（allow を付ける。大きな表は `CHECK (... IS NOT NULL) NOT VALID` → `VALIDATE CONSTRAINT` の後にする） |
| NOT NULL の列を足す | 既定値を付けて足す（`ADD COLUMN ... NOT NULL DEFAULT ...`。PostgreSQL 11 以降は表を書き換えない） | 既定値が要らなくなれば `DROP DEFAULT` |
| enum の値を変える | 新しい値を足す（`ALTER TYPE ... ADD VALUE`） | 古い値を使う行がなくなってから型を作り直す |
| 既存の表にインデックス | `CREATE INDEX CONCURRENTLY`（書き込みを止めない） | — |

## 3. Prisma で気をつけること

- **Prisma はフィールドの改名を「削除＋追加」にする。** `schema.prisma` で `phone` を `tel` に書き換えると、`migrate dev` は `DROP COLUMN "phone"` と `ADD COLUMN "tel"` を作り、データが消える。名前だけを変えたいなら `tel String @map("phone")` で DB の列名を残す。DB の列名も変えるなら §2 の手順にする
- `migrate dev` が作った SQL は、コミットの前に必ず読む。`npm run migrations:check` が危険な文を止める（§4）
- 型の変更（`String` → `Int` など）や enum の値の削除も、Prisma は `ALTER COLUMN ... TYPE` や型の作り直しにする
- **適用済みのマイグレーションは書き換えない**（`CLAUDE.md`）。直すときは新しいマイグレーションを足す。CI の `migrations` ジョブが、ベースのブランチとの差分で変更・削除を止める
- Prisma 7.10 の `migrate deploy` はファイルをトランザクションで包まない。そのため `CREATE INDEX CONCURRENTLY` を流せる（1 つのファイルに 2 つ書いても通ることを、2026-11-25 に一時的な DB で確かめた）。その代わり、ファイルの途中で失敗すると前半だけが適用された状態で止まる。直すときは失敗した文の後始末（`INVALID` のインデックスの `DROP INDEX CONCURRENTLY` など）をしてから `npx prisma migrate resolve --rolled-back <名前>` し、直したマイグレーションを新しい名前で足す。危険な文と安全な文を同じファイルに混ぜない

## 4. CI で止める仕組み（`npm run migrations:check`）

`scripts/check-migrations.ts`（ルールは `scripts/migration-rules.ts`、テストは `scripts/migration-rules.test.ts`）が `prisma/migrations/*/migration.sql` を文に分けて調べる。`npm run check` に含むので、コミットの前（`.githooks/pre-commit`）と CI の `check` ジョブで動く。CI の `migrations` ジョブは `--base <ベース>` を付け、**適用済みのマイグレーションの変更・削除**も止める。

| ルール | 止める文 | 理由 |
|--------|----------|------|
| `drop-table` | `DROP TABLE` | データと、それを読む古い版が壊れる |
| `drop-column` | `ALTER TABLE ... DROP [COLUMN]`（`DROP CONSTRAINT`・`DROP NOT NULL`・`DROP DEFAULT` は止めない） | 同上 |
| `rename-table`・`rename-column` | `RENAME TO`・`RENAME [COLUMN]` | 古い版が古い名前で読み書きできない |
| `rename-enum` | `ALTER TYPE ... RENAME` | 古い版の値が書けない |
| `alter-column-type` | `ALTER COLUMN ... [SET DATA] TYPE` | 表の書き換え（長いロック）、変換の失敗・切り捨て |
| `set-not-null` | `ALTER COLUMN ... SET NOT NULL` | 古い版が NULL を書くと失敗、既存の NULL で適用が失敗 |
| `add-not-null-column` | 既定値のない `ADD COLUMN ... NOT NULL` | 行があると失敗し、古い版の INSERT も失敗する |
| `truncate` | `TRUNCATE` | 全行を消す |
| `create-index-blocking` | 既存の表への `CREATE INDEX`（`CONCURRENTLY` なし） | 作り終わるまで書き込みを止める |

- 同じマイグレーションで作ったテーブル（まだ誰も使っていない）への列の追加・インデックスは止めない
- 文字列・識別子・ドル引用（`$$`）・コメントの中の語や `;` では止めない
- 意図した操作（contract）は、**文の直前**に理由つきで書く：`-- migration-safety: allow drop-column 旧列 phone は 2026-12-01 の版から使っていない`。そのルールのその文だけが通る。理由のない allow、知らないルール名は誤りにする。レビューでは allow の行を必ず読む
- 適用済みで書き換えられないマイグレーションの指摘は `prisma/migration-safety-baseline.json` に理由とともに記録する。今は第11章の `20261124150000_uploads_exports_jobs` の 2 件（`attachment` への既定値のない NOT NULL の列と、インデックス）。本番には未適用で、初回の migrate では `attachment` が空なので問題にならない。新しいマイグレーションはここに足さない
- 検出は SQL の字面による。データを消す `DELETE`・`UPDATE` や、関数・トリガーの中身までは見ない。レビューで確かめる

### 確かめたこと（2026-11-25）

- 危険な文を 7 つ（列の削除・改名・型の変更・NOT NULL・既定値のない NOT NULL の列・テーブルの削除・インデックス）書いたマイグレーションを一時的に `prisma/migrations/` に置くと、`npm run migrations:check` は 7 件を挙げて終了コード 1、`npm run check` も終了コード 1 で止まった
- 同じ場所に、理由つきの allow の `DROP COLUMN` と理由のない allow の `DROP COLUMN` を置くと、前者だけが通り、後者は「allow の書き方が誤り」と「drop-column」で止まった
- 一時的な clone で、適用済みのマイグレーション（`20261124174511_billing`）の書き換え・削除をコミットすると、`--base <前のコミット>` で `M`・`D` として止まった。安全な列の追加だけのコミットは通った
- 置いたマイグレーションを消すと、元の 5 個は通る（記録済み 2）
