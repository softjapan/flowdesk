"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { BillingActionState } from "../actions";

/**
 * Stripe の画面へ移動するボタン（Checkout・カスタマーポータル）。
 * ボタンは Owner にだけ出すが、権限は Server Action の先の Service でも判定する。
 */
export function BillingActionButton({
  action,
  label,
  pendingLabel,
  variant = "default",
}: {
  action: (prev: BillingActionState) => Promise<BillingActionState>;
  label: string;
  pendingLabel: string;
  variant?: "default" | "outline";
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-1">
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? pendingLabel : label}
      </Button>
      <div role="alert" className="text-sm text-destructive">
        {state.form}
      </div>
    </form>
  );
}
