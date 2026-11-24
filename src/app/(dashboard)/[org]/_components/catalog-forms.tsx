"use client";

/**
 * 店舗（S-12）とメニュー（S-11）の追加・編集・削除のフォーム。
 * フォームは権限のある人にだけ出すが、権限・上限・組織の確認は
 * Server Action の先の Service で判定する。
 */
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormErrors } from "@/server/validation/form";

export type CatalogFormState<K extends string> = FormErrors<K> & {
  /** 送信された値。エラーのときにフォームへ戻す */
  values?: Partial<Record<K, string>>;
  notice?: string;
};

export type CatalogField<K extends string> = {
  name: K;
  label: string;
  /** 数字の入力欄（スマートフォンで数字のキーボードを出す） */
  numeric?: boolean;
  /** 入力欄の後ろに出す単位（「分」「円」） */
  suffix?: string;
  /** 候補（datalist）。自由入力も受け付け、検証はサーバーで行う */
  suggestions?: readonly string[];
  className?: string;
};

function Messages({ state }: { state: CatalogFormState<string> }) {
  const errors = [
    state.form,
    ...Object.values(state.fields ?? {}),
  ].filter((m): m is string => Boolean(m));
  return (
    <>
      {/* live region は空のまま先に置いておくと、あとから入った内容が
          確実に読み上げられる */}
      <div role="alert" className="text-sm text-destructive">
        {errors.length > 0 && (
          <ul>
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {state.notice}
      </p>
    </>
  );
}

/**
 * 追加と編集のフォーム。idPrefix で項目の id を分ける（1 画面に
 * 行ごとの編集フォームが並ぶため）。formLabel はフォームの名前
 * （読み上げと E2E テストでフォームを見分ける）
 */
export function CatalogForm<K extends string>({
  action,
  fields,
  initialValues,
  idPrefix,
  formLabel,
  submitLabel,
}: {
  action: (
    prev: CatalogFormState<K>,
    formData: FormData,
  ) => Promise<CatalogFormState<K>>;
  fields: readonly CatalogField<K>[];
  initialValues: Partial<Record<K, string>>;
  idPrefix: string;
  formLabel: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const values = state.values ?? initialValues;
  const errors: Partial<Record<K, string>> = state.fields ?? {};
  return (
    <form
      action={formAction}
      aria-label={formLabel}
      className="space-y-2"
    >
      <div className="flex flex-wrap items-end gap-3">
        {fields.map((f) => {
          const id = `${idPrefix}-${f.name}`;
          const listId = f.suggestions ? `${id}-list` : undefined;
          return (
            <div key={f.name} className="grid gap-1.5">
              <Label htmlFor={id}>{f.label}</Label>
              <div className="flex items-center gap-1">
                <Input
                  id={id}
                  name={f.name}
                  required
                  defaultValue={values[f.name] ?? ""}
                  inputMode={f.numeric ? "numeric" : undefined}
                  list={listId}
                  aria-invalid={errors[f.name] ? true : undefined}
                  autoComplete="off"
                  className={f.className ?? "w-48"}
                />
                {f.suffix && (
                  <span className="text-sm text-muted-foreground">
                    {f.suffix}
                  </span>
                )}
              </div>
              {listId && (
                <datalist id={listId}>
                  {f.suggestions?.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              )}
            </div>
          );
        })}
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "保存しています…" : submitLabel}
        </Button>
      </div>
      <Messages state={state} />
    </form>
  );
}

export function DeleteButton({
  action,
  label,
  confirmMessage,
}: {
  action: (
    prev: CatalogFormState<string>,
  ) => Promise<CatalogFormState<string>>;
  /** 読み上げ用の名前（例：「渋谷店を削除」） */
  label: string;
  confirmMessage: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className="space-y-1"
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      <Button
        type="submit"
        size="sm"
        variant="destructive"
        disabled={pending}
        aria-label={label}
      >
        {pending ? "削除しています…" : "削除"}
      </Button>
      <Messages state={state} />
    </form>
  );
}
