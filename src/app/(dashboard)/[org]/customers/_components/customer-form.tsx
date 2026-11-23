import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** docs/er.md の customer に合わせた入力項目 */
export type CustomerFieldName =
  "name" | "nameKana" | "phone" | "email" | "note";

export type CustomerFormErrors = {
  /** フォーム全体のエラー（保存に失敗したなど） */
  form?: string;
  fields?: Partial<Record<CustomerFieldName, string>>;
};

type FieldDef = {
  name: CustomerFieldName;
  label: string;
  required: boolean;
  type?: "text" | "tel" | "email";
  hint?: string;
  multiline?: boolean;
};

// 必須の範囲は仮。第9章で Zod のスキーマを作るときに合わせる
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
    hint: "ハイフンはあってもなくてもかまいません。",
  },
  { name: "email", label: "メール", required: false, type: "email" },
  { name: "note", label: "メモ", required: false, multiline: true },
];

function Field({
  field,
  error,
}: {
  field: FieldDef;
  error: string | undefined;
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
 * 顧客の登録フォーム（画面のみ）。送信処理は第9章で Server Action をつなぐ。
 * errors は Server Action の戻り値をそのまま渡せる形にしておく。
 */
export function CustomerForm({
  errors = {},
}: {
  errors?: CustomerFormErrors;
}) {
  const fieldErrors = errors.fields ?? {};
  const messages = [
    errors.form,
    ...fields.map((f) => fieldErrors[f.name]),
  ].filter((m): m is string => Boolean(m));

  return (
    <form
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

      <p className="text-sm text-muted-foreground">
        「必須」の項目は入力が必要です。
      </p>

      {fields.map((field) => (
        <Field
          key={field.name}
          field={field}
          error={fieldErrors[field.name]}
        />
      ))}

      <div className="flex items-center gap-3">
        {/* 送信先がまだないので押せないようにしておく（第9章でつなぐ） */}
        <Button type="submit" disabled aria-describedby="submit-note">
          登録する
        </Button>
        <p id="submit-note" className="text-xs text-muted-foreground">
          登録処理は準備中です。
        </p>
      </div>
    </form>
  );
}
