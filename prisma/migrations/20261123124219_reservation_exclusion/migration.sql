-- F-09 同じスタッフの予約時間の重複を防ぐ（docs/er.md）。
-- Prisma のスキーマ言語は排他制約を表せないので SQL で追加する。
-- アプリ側の事前チェックだけでは同時リクエストで二重予約が起きるため、
-- DB で最終的に拒否する。tstzrange は既定で [) の半開区間なので、
-- 終了時刻ちょうどに始まる予約は重複にならない。キャンセル済みは対象外。
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "reservation"
  ADD CONSTRAINT "reservation_no_overlap"
  EXCLUDE USING gist (
    "staffProfileId" WITH =,
    tstzrange("startsAt", "endsAt") WITH &&
  )
  WHERE (status <> 'cancelled');

-- 終了が開始より前の予約は tstzrange が作れずエラーになるが、
-- 理由が分かるよう明示的な制約にしておく
ALTER TABLE "reservation"
  ADD CONSTRAINT "reservation_ends_after_starts"
  CHECK ("endsAt" > "startsAt");
