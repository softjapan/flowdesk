/**
 * URL のクエリ（searchParams）の値を読む補助。
 * TODO: zod（docs/tech-stack.md の 4.6.7）を追加したらスキーマに置き換える。
 */
export type SearchParams = Record<
  string,
  string | string[] | undefined
>;

/** 同じキーが複数あるときは最初の値を使う */
export function firstValue(
  params: SearchParams,
  key: string,
): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** 1 以上の整数。不正な値は fallback にする */
export function positiveInt(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || !/^\d{1,6}$/.test(value))
    return fallback;
  const n = Number(value);
  return n >= 1 ? n : fallback;
}
