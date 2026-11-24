"use client";

/**
 * メンバー管理の操作。ボタンや選択肢は権限のあるものだけを出すが、
 * 権限と最後の Owner の確認は Server Action の先の Service で判定する。
 */
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS, type Role } from "@/server/domain";
import type { InviteFormState, MemberActionState } from "../actions";

const selectClass =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50";

function ActionMessage({ state }: { state: MemberActionState }) {
  return (
    <>
      <span role="alert" className="text-xs text-destructive">
        {state.form}
      </span>
      <span role="status" className="text-xs text-muted-foreground">
        {state.notice}
      </span>
    </>
  );
}

export function RoleForm({
  action,
  memberName,
  current,
  options,
}: {
  action: (
    prev: MemberActionState,
    formData: FormData,
  ) => Promise<MemberActionState>;
  memberName: string;
  current: Role;
  options: Role[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-2"
    >
      <select
        // 送信後に select が最初の選択肢に戻らないよう、ロールが変わったら作り直す
        key={current}
        name="role"
        defaultValue={current}
        aria-label={`${memberName} のロール`}
        disabled={pending}
        className={selectClass}
      >
        {options.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
      >
        {pending ? "変更しています…" : "変更"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

export function ConfirmButton({
  action,
  label,
  pendingLabel,
  confirmMessage,
}: {
  action: (prev: MemberActionState) => Promise<MemberActionState>;
  label: string;
  pendingLabel: string;
  confirmMessage: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      <Button
        type="submit"
        size="sm"
        variant="destructive"
        disabled={pending}
      >
        {pending ? pendingLabel : label}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

export function InviteForm({
  action,
  roles,
}: {
  action: (
    prev: InviteFormState,
    formData: FormData,
  ) => Promise<InviteFormState>;
  roles: Role[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.fields ?? {};
  const role = state.values?.role ?? "staff";
  return (
    <form
      action={formAction}
      className="grid gap-4"
      aria-labelledby="invite-title"
    >
      <div role="alert" className="text-sm text-destructive">
        {state.form}
      </div>
      <p role="status" className="text-sm">
        {state.notice}
      </p>
      <div className="flex flex-wrap items-start gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="invite-email">メールアドレス</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            className="w-72"
            defaultValue={state.values?.email ?? ""}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={
              errors.email ? "invite-email-error" : undefined
            }
          />
          {errors.email && (
            <p
              id="invite-email-error"
              className="text-sm text-destructive"
            >
              {errors.email}
            </p>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="invite-role">ロール</Label>
          <select
            key={role}
            id="invite-role"
            name="role"
            defaultValue={
              roles.includes(role as Role) ? role : roles[0]
            }
            className={selectClass}
            aria-invalid={errors.role ? true : undefined}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          {errors.role && (
            <p className="text-sm text-destructive">{errors.role}</p>
          )}
        </div>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "送信しています…" : "招待メールを送る"}
        </Button>
      </div>
    </form>
  );
}
