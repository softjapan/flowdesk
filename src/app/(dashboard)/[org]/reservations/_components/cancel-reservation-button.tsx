"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { CancelReservationState } from "../actions";

/** 予約のキャンセル。version を送り、読んだ後の更新は conflict にする */
export function CancelReservationButton({
  action,
  version,
}: {
  action: (
    prev: CancelReservationState,
    formData: FormData,
  ) => Promise<CancelReservationState>;
  version: number;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className="space-y-2"
      onSubmit={(event) => {
        if (!window.confirm("この予約をキャンセルしますか？")) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="version" value={version} />
      <div role="alert" className="text-sm text-destructive">
        {state.form}
      </div>
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? "キャンセルしています…" : "予約をキャンセルする"}
      </Button>
    </form>
  );
}
