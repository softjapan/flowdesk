"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { DeleteCustomerState } from "../actions";

/**
 * 顧客の論理削除。ボタンは Owner・Admin にだけ出すが、
 * 権限は Server Action の先の Service でも判定する。
 */
export function DeleteCustomerButton({
  action,
}: {
  action: (prev: DeleteCustomerState) => Promise<DeleteCustomerState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className="space-y-2"
      onSubmit={(event) => {
        if (!window.confirm("この顧客を削除しますか？")) {
          event.preventDefault();
        }
      }}
    >
      <div role="alert" className="text-sm text-destructive">
        {state.form}
      </div>
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? "削除しています…" : "顧客を削除する"}
      </Button>
      <p className="text-xs text-muted-foreground">
        削除した顧客は一覧と検索に出なくなります。過去の予約は残ります。
      </p>
    </form>
  );
}
