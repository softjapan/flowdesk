/**
 * 性能の計測用に、デモサロン（org_a）を N-04 の規模にする（第15章）。
 *   npm run db:seed && npm run perf:seed   … 顧客 1 万件・予約 10 万件
 *   npm run db:seed                        … 計測が終わったら元に戻す
 *
 * シードの行（cus_a_001 など）はそのまま残し、足りない分を perf_ で始まる
 * ID で足す。何度実行しても同じ件数になる（先に perf_ の行を消す）。
 * 生成は SQL の generate_series で行い、1 万件・10 万件を数秒で入れる。
 *
 * - スタッフ：シードの 3 人＋計測用 17 人＝20 人（Pro プランの規模の店舗）
 * - 予約：今日の 800 日前〜200 日後。各スタッフが 10・12・14・16・18 時の
 *   5 枠（最長のメニューが 2 時間なので重ならない）。シードの予約と重なる枠は
 *   排他制約で弾かれるので ON CONFLICT DO NOTHING で飛ばし、最後に古い順に
 *   削って合計をちょうど 10 万件にする
 * - 過去の予約は 1 割をキャンセル・残りを来店済み、今日以降は 3 分の 1 を
 *   仮予約・残りを確定にする
 * - 顧客の 1% は論理削除済み
 *
 * 本番の DB に入れないよう、接続先が localhost でなければ止める。
 */
import "@/server/load-env";
import { Client } from "pg";
import { toZonedYmd } from "@/lib/datetime";

const ORG_ID = "org_a";
const LOCATION_ID = "loc_a1";
const TIMEZONE = "Asia/Tokyo";
export const TARGET_CUSTOMERS = 10_000;
export const TARGET_RESERVATIONS = 100_000;
const EXTRA_STAFF = 17;
const DAYS_BEFORE = 800;
const DAYS_AFTER = 200;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL が設定されていない（.env.example を参照）",
    );
  }
  const { hostname } = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error(
      `計測用のデータはローカルの DB にだけ入れる（${hostname}）`,
    );
  }
  return url;
}

async function count(client: Client, table: string): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM "${table}" WHERE "organizationId" = $1`,
    [ORG_ID],
  );
  return Number(rows[0]!.n);
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: connectionString() });
  await client.connect();
  const startedAt = performance.now();
  try {
    await client.query("BEGIN");
    // 前回の計測用データを消す（予約 → 顧客・スタッフの順）
    await client.query(
      `DELETE FROM reservation WHERE id LIKE 'rsv_perf_%'`,
    );
    await client.query(
      `DELETE FROM customer WHERE id LIKE 'cus_perf_%'`,
    );
    await client.query(
      `DELETE FROM "staffProfile" WHERE id LIKE 'stf_perf_%'`,
    );
    await client.query(
      `DELETE FROM member WHERE id LIKE 'mem_perf_%'`,
    );
    await client.query(
      `DELETE FROM "user" WHERE id LIKE 'user_perf_%'`,
    );

    // 20 人のスタッフがいる店舗は Free の上限（2 人）を超えるので Pro にする
    await client.query(
      `INSERT INTO subscription (id, "organizationId", plan, status)
       VALUES ('sub_perf_a', $1, 'pro', 'active')
       ON CONFLICT ("organizationId")
       DO UPDATE SET plan = 'pro', status = 'active'`,
      [ORG_ID],
    );

    // スタッフ（ユーザー・メンバー・スタッフ情報）
    await client.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       SELECT 'user_perf_' || lpad(i::text, 2, '0'),
              '計測スタッフ ' || i,
              'user-perf-' || i || '@example.com',
              true, now(), now()
       FROM generate_series(1, $1::int) AS i`,
      [EXTRA_STAFF],
    );
    await client.query(
      `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
       SELECT 'mem_perf_' || lpad(i::text, 2, '0'), $1,
              'user_perf_' || lpad(i::text, 2, '0'), 'staff', now()
       FROM generate_series(1, $2::int) AS i`,
      [ORG_ID, EXTRA_STAFF],
    );
    await client.query(
      `INSERT INTO "staffProfile" (id, "organizationId", "memberId", "displayName", active)
       SELECT 'stf_perf_' || lpad(i::text, 2, '0'), $1,
              'mem_perf_' || lpad(i::text, 2, '0'), '計測スタッフ ' || i, true
       FROM generate_series(1, $2::int) AS i`,
      [ORG_ID, EXTRA_STAFF],
    );

    // 顧客。氏名とフリガナはシードと同じ姓・名の組み合わせに番号を付ける
    const extraCustomers =
      TARGET_CUSTOMERS - (await count(client, "customer"));
    await client.query(
      `WITH family(name, kana) AS (
         SELECT * FROM unnest(
           ARRAY['山田','中村','小林','加藤','吉田','山本','松本','井上','木村','林','清水','森','佐々木','山口','斎藤','池田','橋本','阿部','石川','前田'],
           ARRAY['ヤマダ','ナカムラ','コバヤシ','カトウ','ヨシダ','ヤマモト','マツモト','イノウエ','キムラ','ハヤシ','シミズ','モリ','ササキ','ヤマグチ','サイトウ','イケダ','ハシモト','アベ','イシカワ','マエダ'])
       ),
       given(name, kana) AS (
         SELECT * FROM unnest(
           ARRAY['花子','太郎','美咲','健','陽菜','翔','結衣','大輔','葵','蓮','さくら','悠真'],
           ARRAY['ハナコ','タロウ','ミサキ','ケン','ヒナ','ショウ','ユイ','ダイスケ','アオイ','レン','サクラ','ユウマ'])
       ),
       f AS (SELECT row_number() OVER () - 1 AS k, * FROM family),
       g AS (SELECT row_number() OVER () - 1 AS k, * FROM given)
       INSERT INTO customer (id, "organizationId", name, "nameKana", email, phone, note, "deletedAt")
       SELECT 'cus_perf_' || lpad(i::text, 5, '0'), $1,
              f.name || ' ' || g.name || i,
              f.kana || ' ' || g.kana,
              'perf' || i || '@example.com',
              '080-' || lpad((i % 10000)::text, 4, '0') || '-' || lpad(((i * 7919) % 10000)::text, 4, '0'),
              '',
              CASE WHEN i % 100 = 0 THEN now() - interval '30 days' END
       FROM generate_series(1, $2::int) AS i
       JOIN f ON f.k = i % 20
       JOIN g ON g.k = (i / 20) % 12`,
      [ORG_ID, extraCustomers],
    );

    // 予約。n は (日, スタッフ, 枠) の通し番号
    const todayYmd = toZonedYmd(new Date(), TIMEZONE);
    await client.query(
      `WITH staff AS (
         SELECT row_number() OVER (ORDER BY id) - 1 AS k, id
         FROM "staffProfile" WHERE "organizationId" = $1
       ),
       svc AS (
         SELECT row_number() OVER (ORDER BY id) - 1 AS k, id,
                "durationMinutes", "priceYen"
         FROM service WHERE "organizationId" = $1
       ),
       slots AS (
         SELECT d, s.k AS staff_k, s.id AS staff_id, slot,
                row_number() OVER (ORDER BY d, s.k, slot) AS n
         FROM generate_series(-$4::int, $5::int) AS d,
              staff s,
              generate_series(0, 4) AS slot
       )
       INSERT INTO reservation (id, "organizationId", "locationId", "staffProfileId",
                                "customerId", "serviceId", "startsAt", "endsAt",
                                status, "priceYen", version)
       SELECT 'rsv_perf_' || lpad(n::text, 6, '0'), $1, $2, staff_id,
              'cus_perf_' || lpad((((n * 7919) % $6::int) + 1)::text, 5, '0'),
              svc.id, starts,
              starts + svc."durationMinutes" * interval '1 minute',
              (CASE
                 WHEN d < 0 AND n % 10 = 0 THEN 'cancelled'
                 WHEN d < 0 THEN 'done'
                 WHEN n % 3 = 0 THEN 'pending'
                 ELSE 'confirmed'
               END)::"ReservationStatus",
              svc."priceYen", 1
       FROM (
         SELECT *, ((($3::date + d)::timestamp
                     + interval '10 hours' + slot * interval '2 hours')
                    AT TIME ZONE '${TIMEZONE}') AS starts
         FROM slots
       ) t
       JOIN svc ON svc.k = t.n % 3
       ON CONFLICT DO NOTHING`,
      [
        ORG_ID,
        LOCATION_ID,
        todayYmd,
        DAYS_BEFORE,
        DAYS_AFTER,
        extraCustomers,
      ],
    );
    // 多すぎる分を古い順に消して、ちょうど 10 万件にする
    const excess =
      (await count(client, "reservation")) - TARGET_RESERVATIONS;
    if (excess < 0) {
      throw new Error(`予約が ${-excess} 件足りない（期間を広げる）`);
    }
    await client.query(
      `DELETE FROM reservation WHERE id IN (
         SELECT id FROM reservation WHERE id LIKE 'rsv_perf_%'
         ORDER BY "startsAt", id LIMIT $1)`,
      [excess],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  // 統計情報を更新しないと、実行計画が少ない件数のときのまま選ばれる
  await client.query("VACUUM ANALYZE");

  const customers = await count(client, "customer");
  const reservations = await count(client, "reservation");
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM reservation`,
  );
  await client.end();
  console.log(
    `デモサロン：顧客 ${customers} 件・予約 ${reservations} 件` +
      `（全組織の予約 ${rows[0]!.n} 件、` +
      `${Math.round(performance.now() - startedAt)} ms）`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
