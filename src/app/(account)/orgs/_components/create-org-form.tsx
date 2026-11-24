"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OrganizationFieldName } from "@/server/validation/organization";
import type { CreateOrganizationState } from "../actions";

const fields: {
  name: OrganizationFieldName;
  label: string;
  hint: string;
}[] = [
  {
    name: "name",
    label: "組織名",
    hint: "店舗名や会社名。あとから変更できます。",
  },
  {
    name: "slug",
    label: "URL",
    hint: "半角英小文字・数字・ハイフンの 3〜48 文字（例：demo-salon）。画面の URL の先頭に使います。",
  },
];

/** 組織の作成フォーム。作った人がその組織の Owner になる */
export function CreateOrgForm({
  action,
}: {
  action: (
    prev: CreateOrganizationState,
    formData: FormData,
  ) => Promise<CreateOrganizationState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.fields ?? {};
  return (
    <form
      action={formAction}
      className="grid gap-4"
      aria-labelledby="create-org-title"
    >
      <div role="alert" className="text-sm text-destructive">
        {state.form}
      </div>
      {fields.map((f) => {
        const id = `org-${f.name}`;
        const error = errors[f.name];
        return (
          <div key={f.name} className="grid gap-1.5">
            <Label htmlFor={id}>{f.label}</Label>
            <Input
              id={id}
              name={f.name}
              required
              defaultValue={state.values?.[f.name] ?? ""}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
            />
            <p
              id={`${id}-hint`}
              className="text-xs text-muted-foreground"
            >
              {f.hint}
            </p>
            {error && (
              <p
                id={`${id}-error`}
                className="text-sm text-destructive"
              >
                {error}
              </p>
            )}
          </div>
        );
      })}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "作成しています…" : "組織を作成する"}
        </Button>
      </div>
    </form>
  );
}
