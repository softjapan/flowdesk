/**
 * 顧客の登録・編集の入力（F-07）。必須の範囲：
 * 氏名とフリガナは必須、電話番号とメールアドレスはどちらか一方が必須。
 */
import { z } from "zod";

export const CUSTOMER_FIELDS = [
  "name",
  "nameKana",
  "phone",
  "email",
  "note",
] as const;

export type CustomerFieldName = (typeof CUSTOMER_FIELDS)[number];

/** 全角カタカナ・長音・中黒と、姓名の間の空白（全角・半角） */
const KATAKANA = /^[ァ-ヶー・ 　]+$/u;
/** 数字・ハイフン・括弧・空白・先頭の + */
const PHONE = /^\+?[\d\-() ]+$/;
const EITHER_REQUIRED =
  "電話番号かメールアドレスのどちらかを入力してください。";

export const customerInputSchema = z
  .object({
    name: z
      .string("氏名を入力してください。")
      .trim()
      .min(1, "氏名を入力してください。")
      .max(100, "氏名は 100 文字以内で入力してください。"),
    nameKana: z
      .string("フリガナを入力してください。")
      .trim()
      .min(1, "フリガナを入力してください。")
      .max(100, "フリガナは 100 文字以内で入力してください。")
      .regex(KATAKANA, "フリガナは全角カタカナで入力してください。"),
    // 電話番号とメールは空を許し、「どちらか一方」は下の superRefine で見る
    phone: z
      .string("電話番号の形式が正しくありません。")
      .trim()
      .refine((v) => {
        if (v === "") return true;
        const digits = v.replace(/\D/g, "").length;
        return PHONE.test(v) && digits >= 10 && digits <= 15;
      }, "電話番号の形式が正しくありません。"),
    email: z
      .string("メールアドレスの形式が正しくありません。")
      .trim()
      .max(254, "メールアドレスが長すぎます。")
      .refine(
        (v) => v === "" || z.email().safeParse(v).success,
        "メールアドレスの形式が正しくありません。",
      ),
    note: z
      .string("メモの形式が正しくありません。")
      .max(2000, "メモは 2000 文字以内で入力してください。")
      .default(""),
  })
  .superRefine((value, ctx) => {
    if (value.phone === "" && value.email === "") {
      for (const path of ["phone", "email"] as const) {
        ctx.addIssue({
          code: "custom",
          path: [path],
          message: EITHER_REQUIRED,
        });
      }
    }
  });

export type CustomerInput = z.output<typeof customerInputSchema>;
