"use server";
/**
 * 料金プランの Server Action（S-14、F-14）。行うのは認証と Service の
 * 呼び出しだけ。Owner のみという判定は Service が行う。
 * 成功したら Stripe の画面（Checkout・カスタマーポータル）へ移動する。
 */
import { notFound, redirect } from "next/navigation";
import {
  failureMessage,
  requireOrgContext,
} from "@/server/request-context";
import {
  openCustomerPortal,
  startProCheckout,
} from "@/server/services/billing";

export type BillingActionState = { form?: string };

export async function startCheckoutAction(
  slug: string,
): Promise<BillingActionState> {
  const ctx = await requireOrgContext(slug);
  const result = await startProCheckout(ctx);
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return { form: failureMessage(result.reason) };
  }
  redirect(result.value.url);
}

export async function openPortalAction(
  slug: string,
): Promise<BillingActionState> {
  const ctx = await requireOrgContext(slug);
  const result = await openCustomerPortal(ctx);
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return { form: failureMessage(result.reason) };
  }
  redirect(result.value.url);
}
