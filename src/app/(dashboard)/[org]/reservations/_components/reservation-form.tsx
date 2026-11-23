"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ReservationFormOptions } from "@/server/services/reservations";
import type { ReservationFieldName } from "@/server/validation/reservation";
import { statusLabels } from "../../_components/status-label";
import type { ReservationFormState } from "../actions";

const selectClass =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50";

type Values = Partial<Record<ReservationFieldName, string>>;

function FieldShell({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Select({
  name,
  label,
  options,
  values,
  errors,
  disabled,
}: {
  name: ReservationFieldName;
  label: string;
  options: { id: string; label: string }[];
  values: Values;
  errors: Partial<Record<ReservationFieldName, string>>;
  disabled: boolean;
}) {
  const id = `reservation-${name}`;
  const error = errors[name];
  return (
    <FieldShell id={id} label={label} error={error}>
      <select
        // 送信後、React はフォームを初期状態に戻す。input は新しい
        // defaultValue に戻るが、select は最初の選択に戻ってしまうので、
        // 値が変わったら作り直して、送った値を選ばれた状態にする
        key={values[name] ?? ""}
        id={id}
        name={name}
        required
        disabled={disabled}
        defaultValue={values[name] ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={selectClass}
      >
        <option value="" disabled>
          選んでください
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

const statusOptions = (["pending", "confirmed", "done"] as const).map(
  (s) => ({ id: s, label: statusLabels[s] }),
);

/**
 * 予約の作成・変更フォーム。action は slug（と id）を bind した
 * Server Action（../actions.ts）。変更では version を hidden で送り、
 * 読んだ後に他の人が更新していれば Service が conflict を返す。
 */
export function ReservationForm({
  action,
  options,
  initialValues,
  version,
  timezone,
  submitLabel,
  disabled = false,
}: {
  action: (
    prev: ReservationFormState,
    formData: FormData,
  ) => Promise<ReservationFormState>;
  options: ReservationFormOptions;
  initialValues: Values;
  version?: number;
  timezone: string;
  submitLabel: string;
  /** 権限がない・キャンセル済みなどで変更できない */
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.fields ?? {};
  const values = state.values ?? initialValues;
  const common = { values, errors, disabled };

  return (
    <form
      action={formAction}
      className="grid max-w-xl gap-6"
      aria-labelledby="form-title"
    >
      <div role="alert">
        {state.form && (
          <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {state.form}
          </p>
        )}
      </div>
      <p role="status" className="text-sm">
        {state.notice}
      </p>

      {version !== undefined && (
        <input type="hidden" name="version" value={version} />
      )}
      <Select
        name="customerId"
        label="顧客"
        options={options.customers}
        {...common}
      />
      <Select
        name="serviceId"
        label="メニュー"
        options={options.services}
        {...common}
      />
      <Select
        name="staffProfileId"
        label="担当スタッフ"
        options={options.staff}
        {...common}
      />
      <Select
        name="locationId"
        label="店舗"
        options={options.locations}
        {...common}
      />
      <div className="grid grid-cols-2 gap-4">
        <FieldShell
          id="reservation-date"
          label="日付"
          error={errors.date}
        >
          <Input
            id="reservation-date"
            name="date"
            type="date"
            required
            disabled={disabled}
            defaultValue={values.date ?? ""}
            aria-invalid={errors.date ? true : undefined}
          />
        </FieldShell>
        <FieldShell
          id="reservation-time"
          label="開始時刻"
          error={errors.time}
        >
          <Input
            id="reservation-time"
            name="time"
            type="time"
            step={300}
            required
            disabled={disabled}
            defaultValue={values.time ?? ""}
            aria-invalid={errors.time ? true : undefined}
          />
        </FieldShell>
      </div>
      <p className="-mt-4 text-xs text-muted-foreground">
        日時は店舗の時刻（{timezone}
        ）です。終了時刻はメニューの所要時間から決まります。
      </p>
      <Select
        name="status"
        label="状態"
        options={statusOptions}
        {...common}
      />

      {!disabled && (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "保存しています…" : submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
