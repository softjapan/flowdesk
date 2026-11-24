/**
 * メニューの入力（F-06、S-11）。DB の service テーブル。
 * フォームの値は文字列で届くので、整数に変える。金額は円の整数（priceYen）で、
 * 小数・指数表記（1e4）・負の数は受け付けない。全角数字とカンマは許す。
 */
import { z } from "zod";

export const MENU_FIELDS = [
  "name",
  "durationMinutes",
  "priceYen",
] as const;

export type MenuFieldName = (typeof MENU_FIELDS)[number];

export const MAX_DURATION_MINUTES = 8 * 60;
export const MAX_PRICE_YEN = 10_000_000;

/** 0 以上の整数の文字列だけを数値にし、範囲を確かめる */
function wholeNumber(message: string, valid: (n: number) => boolean) {
  return z
    .string(message)
    .transform((v) => v.normalize("NFKC").trim().replace(/,/g, ""))
    .refine((v) => /^\d{1,9}$/.test(v), message)
    .transform(Number)
    .refine(valid, message);
}

export const menuInputSchema = z.object({
  name: z
    .string("メニュー名を入力してください。")
    .trim()
    .min(1, "メニュー名を入力してください。")
    .max(100, "メニュー名は 100 文字以内で入力してください。"),
  // 予約の時刻は 5 分刻み（予約フォームの step）なので、所要時間も合わせる
  durationMinutes: wholeNumber(
    "所要時間は 5〜480 分の範囲で、5 分単位で入力してください。",
    (n) => n >= 5 && n <= MAX_DURATION_MINUTES && n % 5 === 0,
  ),
  priceYen: wholeNumber(
    "料金は 0〜10,000,000 円の整数で入力してください。",
    (n) => n <= MAX_PRICE_YEN,
  ),
});

export type MenuInput = z.output<typeof menuInputSchema>;
