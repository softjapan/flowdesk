/**
 * 予約の作成・変更・キャンセルの入力（F-08）。
 * 日時は店舗のタイムゾーンでの日付と時刻で受け取り、UTC への変換は
 * 店舗が決まってから Service で行う。
 */
import { z } from "zod";
import { isValidYmd } from "@/lib/datetime";

export const RESERVATION_FIELDS = [
  "customerId",
  "serviceId",
  "staffProfileId",
  "locationId",
  "date",
  "time",
  "status",
] as const;

export type ReservationFieldName =
  (typeof RESERVATION_FIELDS)[number];

/** 選択肢の ID。空（未選択）と不正な形式は同じメッセージにする */
function ref(label: string) {
  const message = `${label}を選んでください。`;
  return z.string(message).regex(/^[\w-]{1,64}$/, message);
}

/** キャンセルは専用の操作で行うので、ここでは選べない */
export const EDITABLE_STATUSES = [
  "pending",
  "confirmed",
  "done",
] as const;

export const reservationInputSchema = z.object({
  customerId: ref("顧客"),
  serviceId: ref("メニュー"),
  staffProfileId: ref("担当スタッフ"),
  locationId: ref("店舗"),
  date: z
    .string("日付を入力してください。")
    .refine(isValidYmd, "日付を正しく入力してください。"),
  time: z
    .string("時刻を入力してください。")
    .regex(
      /^([01]\d|2[0-3]):[0-5]\d$/,
      "時刻を正しく入力してください。",
    ),
  status: z.enum(EDITABLE_STATUSES, "状態を選んでください。"),
});

export type ReservationInput = z.output<
  typeof reservationInputSchema
>;

/** 画面で読んだときの version（楽観ロック） */
export const versionSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(2 ** 31 - 1);
