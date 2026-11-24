"use client";

import { Download } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { CustomerExportState } from "../actions";

/**
 * 顧客一覧の CSV エクスポート（F-11）。ボタンは Owner・Admin にだけ出すが、
 * 権限は Server Action の先の Service でも判定する。
 */
export function ExportCustomersButton({
  action,
}: {
  action: (prev: CustomerExportState) => Promise<CustomerExportState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-1">
      <Button type="submit" variant="outline" disabled={pending}>
        <Download aria-hidden="true" />
        {pending ? "受け付けています…" : "CSV エクスポート"}
      </Button>
      <div role="status" className="text-sm text-muted-foreground">
        {state.notice}
      </div>
      <div role="alert" className="text-sm text-destructive">
        {state.form}
      </div>
    </form>
  );
}
