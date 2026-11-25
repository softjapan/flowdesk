# バックアップと復旧の手順（第18章）

RDS for PostgreSQL のバックアップから戻す手順と、手元の PostgreSQL での演習の記録。**本番の手順（2・3）は本物の AWS では実行していない。** AWS の CLI の書き方はドキュメントに沿って書いたもので、初回の演習で確かめる（5 の「残すこと」）。

## 1. バックアップの設定（`infra/terraform/modules/database`）

| 項目 | 値 | 確かめ方 |
|------|-----|----------|
| 自動バックアップの保持 | 7 日（`backup_retention_days`、7〜35 以外は plan で止める） | `terraform test` の `rds_is_private`・`rds_rejects_backup_without_pitr` |
| ポイントインタイムリカバリ（PITR） | 保持期間の中の任意の時刻（最新は約 5 分前まで）に、**新しいインスタンスとして**戻せる。保持が 0 でなければ有効 | 同上 |
| バックアップの時間帯 | 18:00-18:30 UTC（JST 03:00-03:30） | 同上（メンテナンスの日曜 JST 04:00 と重ねない） |
| インスタンスを消したとき | 自動バックアップを残す（`delete_automated_backups = false`）。最後のスナップショット `flowdesk-prod-final` を取る。削除保護 | 同上 |
| スナップショットのタグ | `copy_tags_to_snapshot` | 同上 |
| 暗号化 | ストレージを暗号化（スナップショット・戻したインスタンスも暗号化される） | 同上 |

**目標**：戻せる時点（RPO）は約 5 分前まで、戻すのにかかる時間（RTO）は 1 時間以内（下の 3 の手順と、RDS が新しいインスタンスを作る時間。**RDS の時間は未確認**。db.t4g.small・20GB なら数十分とされる）。

入れていないもの：別のリージョン・別のアカウントへのコピー（AWS Backup）。リージョンの障害・アカウントの乗っ取りでは戻せない。費用と運用を決めてから足す（**残す**）。

## 2. どの戻し方を使うか

| 起きたこと | 戻し方 |
|------------|--------|
| 誤った UPDATE・DELETE（一部の行・一部の組織） | PITR で**別のインスタンス**に事故の直前まで戻し、必要な行だけを本番に戻す（3）。本番は止めない |
| マイグレーションの失敗・DB 全体が壊れた | PITR で戻したインスタンスに**切り替える**（3 の 6 の B）。戻した時刻より後の書き込みは失われる |
| インスタンスを消した | 最後のスナップショット、または残した自動バックアップから戻す |

いずれも、戻す前に**書き込みを止めるか決める**（web を 0 台にする・Worker を止める）。止めないと、調べている間にも事故の後の書き込みが増える。

## 3. 本番の手順（PITR。**未確認**）

1. **事故の時刻を決める**：監査ログ（`auditLog`）・アプリのログ（`traceId` で引く、`docs/observability.md`）・RDS の `postgresql` ログから、誤った操作の時刻（UTC）を見つける。戻す時刻はその **1 秒前**
2. **戻せる範囲を確かめる**：
   ```bash
   aws rds describe-db-instances --db-instance-identifier flowdesk-prod \
     --query 'DBInstances[0].[LatestRestorableTime,BackupRetentionPeriod]'
   ```
3. **新しいインスタンスに戻す**。サブネット・セキュリティグループ・パラメーターグループ・Multi-AZ・CA を**必ず指定する**（指定しないと既定のセキュリティグループ・パラメーターグループで作られ、`rds.force_ssl` も外れる）：
   ```bash
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier flowdesk-prod \
     --target-db-instance-identifier flowdesk-prod-restore-20261125 \
     --restore-time 2026-11-25T19:03:20Z \
     --db-subnet-group-name flowdesk-prod \
     --vpc-security-group-ids <flowdesk-prod-db の SG> \
     --db-parameter-group-name flowdesk-prod-pg18 \
     --ca-certificate-identifier rds-ca-rsa2048-g1 \
     --no-publicly-accessible --no-multi-az --deletion-protection
   aws rds wait db-instance-available --db-instance-identifier flowdesk-prod-restore-20261125
   ```
   - 戻したインスタンスは Terraform の管理の外。調べ終わったら消す（消し忘れると RDS の費用が倍になる）
   - パスワードは元と同じ（Secrets Manager の `database-url` のホスト名だけを変えた接続文字列を、手元に置かずに使う）
4. **戻したインスタンスで確かめる**：件数・事故で消えた行・事故の前の最後の書き込みがあるか。接続は migrate のタスク（ECS の run-task、VPC の中）から `psql` で行う。手元の端末から RDS には届かない（公開していない）
5. **事故の範囲を決める**：本番と戻したものを、組織・テーブル・時刻で比べる（ID の一覧の差）
6. **戻す**：
   - **A. 一部の行を戻す**：戻したインスタンスから対象の行だけを `\copy (SELECT …) TO STDOUT` で出し、本番に `\copy … FROM STDIN` で入れる（4 の演習と同じ）。外部キーの順（店舗・メニュー → 予約）に入れる。戻した操作を監査ログに残す（`action` に `restore.*`）
   - **B. 切り替える**：web・worker を止め、Secrets Manager の `database-url` を戻したインスタンスに向け（`db_password_version` は変えない）、Terraform の `database` モジュールの扱い（`terraform import` か、`identifier` の入れ替え）を決めてから web・worker を起動する。**手順が長く、Terraform の state との食い違いが起きやすい。演習してから使う（残す）**
7. **後片付け**：戻したインスタンスを消す（`--skip-final-snapshot`）。振り返りに時刻・件数・かかった時間を残す

## 4. 手元での演習（2026-11-25）

`npm run drill:restore`（`scripts/drill/restore-drill.sh`）。docker compose の PostgreSQL 18.7 だけを使う。データは第15章の量（顧客 10,013 件・予約 100,100 件）を演習用の DB `flowdesk_drill` に入れた。

| 方式 | 本番の対応 | やったこと |
|------|-----------|-----------|
| A. 論理バックアップ | スナップショットからの復元に近い（その時点の全体） | `pg_dump -Fc` → 別の DB（`flowdesk_drill_restored`）に `pg_restore` |
| B. PITR | RDS の PITR（新しいインスタンス） | ベースバックアップ（`pg_basebackup`）＋ WAL の連続取得（`pg_receivewal`、レプリケーションスロット）→ 事故（過去の予約の DELETE）→ 事故の直前まで、**別のインスタンス**（同じコンテナの 5433 番、別のデータディレクトリ）に戻す → 消えた行だけを元の DB に戻す |

確かめ方：件数と内容の指紋（ID 順に並べた値の md5。顧客・予約・ユーザー）を、事故の前と、戻したものとで比べる。

### 結果

| 手順 | 1 回目（手で実行） | 2 回目（スクリプト） |
|------|------:|------:|
| A. `pg_dump`（1.1MB） | 0.5 秒 | 0.4 秒 |
| A. `pg_restore`（別の DB） | 10.0 秒 | 9.9 秒 |
| A. 指紋の比較 | 一致 | 一致 |
| B. ベースバックアップ（115MB、クラスター全体） | 4.6 秒 | 1.6 秒 |
| B. 事故で消えた予約 | 79,896 件（デモサロンの過去の予約） | 79,959 件（全組織の過去の予約） |
| B. 戻す（コピー・WAL の適用・起動） | 2.6 秒 | 1.3 秒 |
| B. 戻した時点 | `recovery stopping before commit of transaction 1342`（DELETE の直前で止まった） | 同じく DELETE の直前 |
| B. 戻したインスタンスの指紋 | 事故の前と一致。事故の 2 秒前の更新（顧客のメモ）も戻っている | 一致 |
| B. 消えた行を元の DB に戻す（`\copy`） | 7.7 秒 | 8.6 秒 |
| B. 元の DB の指紋 | 事故の前と一致 | 一致 |
| 戻した DB でアプリが動くか | `prisma migrate status` は「up to date」、排他制約 `reservation_no_overlap`・`btree_gist` も戻った | — |

手元の量では、どれも数秒〜10 秒だった。**本番の時間は RDS が新しいインスタンスを作る時間（数十分とされる、未確認）が大半**で、手元の値は「戻した後に確かめて行を戻す」部分の目安にしかならない。

### 手順の誤り・気づいたこと

1. **最初の演習は、シードのデータ（52KB）で行い、時間が測れなかった**（どれも 0.5 秒未満）。本番に近い量（第15章の `perf:seed`）の DB を作ってやり直した。演習の前に、データの量を本番の見込みに合わせる
2. **1 回目（手で実行）は、事故の削除と戻す行の条件に別々の時刻を使っていた。** 削除は `"startsAt" < now()`、戻すのは「事故の後に取った時刻」より前。その 2 秒ほどの間に始まる予約がなかったので結果は一致したが、あれば重複して戻して主キーの違反で止まる。スクリプトにするときに気づき、削除の条件の時刻（`TCUT`）を先に決めて、戻すときも同じ値を使うようにした。**本番でも、戻す行は「事故の SQL の条件」と同じ条件で選ぶ**（「その時刻より前」で選ばない）
3. **bash の `"$DRILL_DB（"` が「変数が未定義」で止まった。** 全角の文字が変数名の続きとして読まれた（ロケールによる）。`${DRILL_DB}` と書く
4. 戻す時刻は UTC で扱った（`now() at time zone 'UTC'` に `+00` を付けて `recovery_target_time` に渡す）。タイムゾーンを付けないと、サーバーのタイムゾーンで解釈される。**RDS の `--restore-time` も UTC（末尾 `Z`）で渡す**
5. PITR はインスタンス（クラスター）単位で戻る。演習でも `flowdesk`・`flowdesk_test` を含む全 DB が事故の直前に戻った。本番でも、戻したインスタンスを切り替えると、事故と関係ない組織の事故の後の書き込みも失われる（だから 3 の 6 の A を先に考える）
6. 最後の WAL のセグメントは閉じないと（`pg_switch_wal()`）、`.partial` のままで `restore_command` から読めない。RDS では AWS が扱うので不要だが、手元の演習では必要
7. レプリケーションスロットを消し忘れると、WAL が消されずにディスクを埋める。スクリプトは終了時（`trap`）に必ず消す

## 5. 残すこと

- 本物の AWS での PITR の演習（3 の手順の確認、RDS の作成にかかる時間、戻したインスタンスへの接続の方法）。四半期に 1 回を目安にする
- 3 の 6 の B（切り替え）の Terraform の扱い
- 別のリージョンへのバックアップのコピー（AWS Backup）の要否
