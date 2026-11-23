/**
 * フォーム（FormData）と ID の検証の補助。Server Action から使う。
 * Zod 以外の実行時の依存を持たない。
 */
import { z } from "zod";

/** フォームの結果。画面のエラー表示にそのまま渡す */
export type FormErrors<Field extends string> = {
  /** フォーム全体のエラー（権限がない・他の人が先に更新したなど） */
  form?: string;
  fields?: Partial<Record<Field, string>>;
};

/**
 * FormData から指定したキーの値を取り出す。ファイルや欠けた項目は
 * 空文字にせず undefined のまま渡し、スキーマに不正として扱わせる
 */
export function formValues<K extends string>(
  formData: FormData,
  keys: readonly K[],
): Record<K, unknown> {
  return Object.fromEntries(
    keys.map((k) => [k, formData.get(k) ?? undefined]),
  ) as Record<K, unknown>;
}

/** 項目ごとに最初のメッセージだけを返す */
export function fieldErrorsOf<Field extends string>(
  error: z.ZodError,
): Partial<Record<Field, string>> {
  const { fieldErrors } = z.flattenError(error);
  const result: Partial<Record<string, string>> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const [message] = messages as string[];
    if (message) result[key] = message;
  }
  return result as Partial<Record<Field, string>>;
}

/**
 * URL や Server Action の引数で受け取る ID・スラッグ。
 * 形式が不正なものは「存在しない」と同じに扱う（呼び出し側で 404）
 */
export const idSchema = z.string().regex(/^[\w-]{1,64}$/);
