/**
 * 店舗の入力（F-05）。タイムゾーンは IANA の名前（Asia/Tokyo など）で、
 * 実行環境の Intl が知っているものだけを受け付ける。
 */
import { z } from "zod";

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const locationInputSchema = z.object({
  name: z
    .string("店舗名を入力してください。")
    .trim()
    .min(1, "店舗名を入力してください。")
    .max(100, "店舗名は 100 文字以内で入力してください。"),
  timezone: z
    .string()
    .trim()
    .default("Asia/Tokyo")
    .refine(isTimeZone, "タイムゾーンが正しくありません。"),
});

export type LocationInput = z.infer<typeof locationInputSchema>;
