#!/usr/bin/env bash
# バックアップからの復旧の演習（第18章、docs/runbooks/restore.md の 4）。
# 手元の docker compose の PostgreSQL だけを使う。AWS には接続しない。
#
#   npm run drill:restore              # DRILL_DB（既定 flowdesk_drill）で演習する
#
# 前もって演習用の DB を作っておく（本番に近い量。第15章のデータ）：
#   docker compose exec db createdb -U flowdesk flowdesk_drill
#   DATABASE_URL=.../flowdesk_drill npx prisma migrate deploy
#   DATABASE_URL=.../flowdesk_drill npx prisma db seed
#   DATABASE_URL=.../flowdesk_drill npm run perf:seed
#
# A. 論理バックアップ：pg_dump -Fc → 別の DB（<DRILL_DB>_restored）に pg_restore
# B. ポイントインタイムリカバリ（RDS の PITR と同じ考え方）：
#    ベースバックアップ＋WAL の連続取得 → 事故（予約の削除）→ 事故の直前の
#    時刻まで、別のインスタンス（同じコンテナの 5433 番）に戻す → 消えた行を
#    元の DB に戻す
# どちらも件数と内容の指紋（verify）を事故の前と比べる。DRILL_DB の予約を消すので、
# 開発用の DB（flowdesk）を指定しない。
set -euo pipefail

DRILL_DB="${DRILL_DB:-flowdesk_drill}"
if [[ "${DRILL_DB}" == "flowdesk" || "${DRILL_DB}" == "flowdesk_test" ]]; then
  echo "DRILL_DB に開発用・テスト用の DB を指定しない" >&2
  exit 1
fi
DIR=/var/lib/postgresql/drill # コンテナの中（db のボリューム）
OUT="${DRILL_OUT:-$(mktemp -d)}"
dc() { docker compose exec -T "$@"; }
pg() { dc -u postgres db "$@"; }
q() { dc db psql -U flowdesk -d "${DRILL_DB}" -v ON_ERROR_STOP=1 -At "$@"; }
now() { python3 -c 'import time;print(time.time())'; }
lap() { python3 -c "print(f'{$2-$1:.1f}')"; }

VERIFY=$(cat <<'SQL'
select 'customer', count(*), md5(string_agg(id || coalesce("phone", ''), ',' order by id)) from customer
union all select 'reservation', count(*), md5(string_agg(id || "startsAt"::text || status::text || "priceYen"::text, ',' order by id)) from reservation
union all select 'user', count(*), md5(string_agg(id, ',' order by id)) from "user"
order by 1;
SQL
)

cleanup() {
  pg sh -c "pg_ctl -D ${DIR}/pitr -m fast stop >/dev/null 2>&1 || true; pkill pg_receivewal || true"
  dc db psql -U flowdesk -d flowdesk -Atc \
    "select pg_drop_replication_slot('drill') from pg_replication_slots where slot_name = 'drill'" >/dev/null || true
  pg rm -rf "${DIR}"
}
trap cleanup EXIT

echo "== 事故の前の件数と指紋（${DRILL_DB}）"
q -c "$VERIFY" | tee "${OUT}/before.txt"

echo "== A. 論理バックアップ"
t0=$(now)
dc db pg_dump -U flowdesk -d "${DRILL_DB}" -Fc > "${OUT}/drill.dump"
t1=$(now)
dc db dropdb -U flowdesk --if-exists "${DRILL_DB}_restored"
dc db createdb -U flowdesk "${DRILL_DB}_restored"
dc db pg_restore -U flowdesk -d "${DRILL_DB}_restored" --no-owner --exit-on-error < "${OUT}/drill.dump"
t2=$(now)
dc db psql -U flowdesk -d "${DRILL_DB}_restored" -At -c "$VERIFY" > "${OUT}/after-logical.txt"
diff "${OUT}/before.txt" "${OUT}/after-logical.txt"
echo "dump $(lap "$t0" "$t1")s（$(wc -c < "${OUT}/drill.dump") bytes）、restore $(lap "$t1" "$t2")s、指紋は一致"

echo "== B. ポイントインタイムリカバリ"
pg sh -c "rm -rf ${DIR} && mkdir -p ${DIR}/wal"
pg pg_receivewal -U flowdesk -h /var/run/postgresql --create-slot --slot=drill
docker compose exec -d -u postgres db sh -c \
  "pg_receivewal -U flowdesk -h /var/run/postgresql -D ${DIR}/wal --slot=drill --synchronous > ${DIR}/receivewal.log 2>&1"
t0=$(now)
pg pg_basebackup -U flowdesk -h /var/run/postgresql -D "${DIR}/base" -X stream -c fast
t1=$(now)
echo "ベースバックアップ $(lap "$t0" "$t1")s"

q -c "update customer set note = 'PITR-drill: before accident' where id = (select id from customer order by id limit 1)" >/dev/null
sleep 2
TGOOD=$(q -c "select to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')")
sleep 2
# 事故：過去の予約を消してしまう（消した条件の時刻 TCUT を、戻すときにも使う）
TCUT=$(q -c "select to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')")
DELETED=$(q -c "with d as (delete from reservation where \"startsAt\" < '${TCUT}+00' returning 1) select count(*) from d")
echo "事故の直前 ${TGOOD}（UTC）、事故 ${TCUT}（UTC）、消えた予約 ${DELETED} 件"
# 最後の WAL のセグメントを閉じる（開いたままの .partial は restore_command で読めない）
q -c "select pg_switch_wal()" >/dev/null
sleep 2

t0=$(now)
pg sh -c "
set -e
cp -a ${DIR}/base ${DIR}/pitr && chmod 700 ${DIR}/pitr
cat >> ${DIR}/pitr/postgresql.auto.conf <<CONF
port = 5433
restore_command = 'cp ${DIR}/wal/%f %p'
recovery_target_time = '${TGOOD}+00'
recovery_target_action = 'promote'
CONF
touch ${DIR}/pitr/recovery.signal
pg_ctl -D ${DIR}/pitr -l ${DIR}/pitr.log -w -t 300 start >/dev/null
"
t1=$(now)
pg grep -E "recovery stopping|starting point-in-time" "${DIR}/pitr.log"
pg psql -h /var/run/postgresql -p 5433 -U flowdesk -d "${DRILL_DB}" -At -c "$VERIFY" > "${OUT}/after-pitr.txt"
diff "${OUT}/before.txt" "${OUT}/after-pitr.txt"
echo "PITR（コピー＋WAL の適用＋起動）$(lap "$t0" "$t1")s、指紋は事故の前と一致"

t0=$(now)
pg sh -c "psql -h /var/run/postgresql -p 5433 -U flowdesk -d ${DRILL_DB} -v ON_ERROR_STOP=1 -c \"\\copy (select * from reservation where \\\"startsAt\\\" < '${TCUT}+00') to stdout\" \
  | psql -h /var/run/postgresql -U flowdesk -d ${DRILL_DB} -v ON_ERROR_STOP=1 -c '\\copy reservation from stdin'"
t1=$(now)
q -c "$VERIFY" > "${OUT}/after-copyback.txt"
diff "${OUT}/before.txt" "${OUT}/after-copyback.txt"
echo "消えた行を元の DB に戻した $(lap "$t0" "$t1")s、指紋は事故の前と一致"
echo "記録：${OUT}"
