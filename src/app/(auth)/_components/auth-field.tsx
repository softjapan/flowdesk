import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** 認証の画面の入力欄。説明文を読み上げ対象として入力欄に結びつける */
export function AuthField({
  id,
  label,
  hint,
  ...input
}: {
  id: string;
  label: string;
  hint?: string;
} & Omit<React.ComponentProps<"input">, "id">) {
  const hintId = `${id}-hint`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-describedby={hint ? hintId : undefined}
        {...input}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * フォーム全体のエラー。live region は空のまま先に置いておくと、
 * あとから入った内容が確実に読み上げられる
 */
export function FormError({ message }: { message: string | null }) {
  return (
    <div role="alert">
      {message && (
        <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

/** 処理が終わったことの知らせ（再設定メールを送った、など） */
export function FormNotice({ message }: { message: string | null }) {
  return (
    <div role="status">
      {message && (
        <p className="rounded-lg border bg-muted p-3 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
