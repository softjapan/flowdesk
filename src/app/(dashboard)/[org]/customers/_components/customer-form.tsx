"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CustomerFieldName } from "@/server/validation/customer";
import type { CustomerFormState } from "../actions";

type FieldDef = {
  name: CustomerFieldName;
  label: string;
  required: boolean;
  type?: "text" | "tel" | "email";
  hint?: string;
  multiline?: boolean;
};

const EITHER_HINT =
  "電話番号とメールアドレスは、どちらか一方の入力が必要です。";

// 必須の範囲は src/server/validation/customer.ts のスキーマに合わせる
const fields: FieldDef[] = [
  { name: "name", label: "氏名", required: true },
  {
    name: "nameKana",
    label: "フリガナ",
    required: true,
    hint: "全角カタカナで入力してください。",
  },
  {
    name: "phone",
    label: "電話番号",
    required: false,
    type: "tel",
    hint: `ハイフンはあってもなくてもかまいません。${EITHER_HINT}`,
  },
  {
    name: "email",
    label: "メール",
    required: false,
    type: "email",
    hint: EITHER_HINT,
  },
  { name: "note", label: "メモ", required: false, multiline: true },
];

function Field({
  field,
  error,
  defaultValue,
}: {
  field: FieldDef;
  error: string | undefined;
  defaultValue: string;
}) {
  const id = `customer-${field.name}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  // ヒントとエラーを読み上げ対象として入力欄に結びつける
  const describedBy =
    [field.hint && hintId, error && errorId]
      .filter(Boolean)
      .join(" ") || undefined;
  const common = {
    id,
    name: field.name,
    defaultValue,
    required: field.required,
    "aria-required": field.required || undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    // 入力するのはスタッフ自身ではなく顧客の情報なので、自動入力を止める
    autoComplete: "off",
  } as const;

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {field.label}
        {/* 読み上げでは required 属性が「必須」を伝えるので、見た目だけ */}
        {field.required && (
          <Badge variant="outline" aria-hidden="true">
            必須
          </Badge>
        )}
      </Label>
      {field.multiline ? (
        <Textarea {...common} rows={4} />
      ) : (
        <Input {...common} type={field.type ?? "text"} />
      )}
      {field.hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {field.hint}
        </p>
      )}
      {/* エラーは項目の直下に出す */}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * 顧客の登録・編集フォーム。action は slug（と id）を bind した
 * Server Action（../actions.ts）を受け取る。
 */
export function CustomerForm({
  action,
  initialValues = {},
  submitLabel,
}: {
  action: (
    prev: CustomerFormState,
    formData: FormData,
  ) => Promise<CustomerFormState>;
  initialValues?: Partial<Record<CustomerFieldName, string>>;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fieldErrors = state.fields ?? {};
  const values = state.values ?? initialValues;
  // 同じメッセージ（「どちらか一方」など）はまとめに 1 回だけ出す
  const messages = [
    ...new Set(
      [state.form, ...fields.map((f) => fieldErrors[f.name])].filter(
        (m): m is string => Boolean(m),
      ),
    ),
  ];

  return (
    <form
      action={formAction}
      className="grid max-w-xl gap-6"
      aria-labelledby="form-title"
    >
      {/* まとめのエラー。live region は空のまま先に置いておくと、
          あとから入った内容が確実に読み上げられる */}
      <div role="alert">
        {messages.length > 0 && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <p className="font-medium">
              入力内容を確認してください。
            </p>
            <ul className="mt-1 list-disc pl-5">
              {messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <p role="status" className="text-sm">
        {state.notice}
      </p>

      <p className="text-sm text-muted-foreground">
        「必須」の項目は入力が必要です。
      </p>

      {fields.map((field) => (
        <Field
          key={field.name}
          field={field}
          error={fieldErrors[field.name]}
          defaultValue={values[field.name] ?? ""}
        />
      ))}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "保存しています…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
