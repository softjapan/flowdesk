/**
 * URL のクエリ（searchParams）のスキーマ。一覧やカレンダーの表示条件は
 * 誰でも書き換えられるので、不正な値はエラーにせず既定値に倒す（.catch）。
 */
import { z } from "zod";
import { isValidYmd } from "@/lib/datetime";

export type SearchParams = Record<
  string,
  string | string[] | undefined
>;

/** 同じキーが複数あるときは最初の値を使う */
function first<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (Array.isArray(value) ? value[0] : value),
    schema,
  );
}

/** 1 以上の整数（6 桁まで） */
function positiveInt(fallback: number) {
  return first(
    z
      .string()
      .regex(/^\d{1,6}$/)
      .transform(Number)
      .pipe(z.number().int().min(1)),
  ).catch(fallback);
}

export const MAX_QUERY_LENGTH = 100;

export const customerListQuerySchema = z.object({
  // 長すぎる検索語はエラーにせず切り詰める
  q: first(
    z
      .string()
      .optional()
      .transform((v) => (v ?? "").trim().slice(0, MAX_QUERY_LENGTH)),
  ).catch(""),
  page: positiveInt(1),
});

export const calendarQuerySchema = z.object({
  view: first(z.enum(["day", "week"])).catch("week"),
  /** null は「今日」（今日は呼び出し側が店舗のタイムゾーンで決める） */
  date: first(z.string().refine(isValidYmd)).nullable().catch(null),
  staff: first(z.string().regex(/^[\w-]{1,64}$/))
    .nullable()
    .catch(null),
});

/** 監査ログ（S-15）の絞り込み。期間は店舗のタイムゾーンでの日付 */
export const auditLogQuerySchema = z.object({
  from: first(z.string().refine(isValidYmd)).nullable().catch(null),
  to: first(z.string().refine(isValidYmd)).nullable().catch(null),
  actor: first(z.string().regex(/^[\w-]{1,64}$/))
    .nullable()
    .catch(null),
  target: first(z.string().regex(/^[a-zA-Z]{1,32}$/))
    .nullable()
    .catch(null),
  page: positiveInt(1),
});
