"use server";
/**
 * 顧客の Server Action（F-07）。行うのは入力の検証・認証・Service の
 * 呼び出しだけ。権限と組織の絞り込みは Service が判定する。
 *
 * slug と id は .bind で渡すが、利用者が書き換えて送れるので必ず検証する。
 * 他の組織の顧客（存在しない顧客と区別しない）は notFound() で 404 にする。
 */
import { refresh } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  failureMessage,
  requireId,
  requireOrgContext,
} from "@/server/request-context";
import {
  createCustomer,
  deleteCustomer,
  updateCustomer,
} from "@/server/services/customers";
import { completeUpload } from "@/server/services/attachments";
import { requestCustomerExport } from "@/server/services/customer-exports";
import {
  CUSTOMER_FIELDS,
  customerInputSchema,
  type CustomerFieldName,
} from "@/server/validation/customer";
import {
  fieldErrorsOf,
  formValues,
  type FormErrors,
} from "@/server/validation/form";

export type CustomerFormState = FormErrors<CustomerFieldName> & {
  /** 送信された値。エラーのときにフォームへ戻す */
  values?: Partial<Record<CustomerFieldName, string>>;
  /** 保存できたときのお知らせ */
  notice?: string;
};

function submittedValues(
  raw: Record<CustomerFieldName, unknown>,
): CustomerFormState["values"] {
  return Object.fromEntries(
    CUSTOMER_FIELDS.map((k) => [
      k,
      typeof raw[k] === "string" ? raw[k] : "",
    ]),
  );
}

export async function createCustomerAction(
  slug: string,
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const ctx = await requireOrgContext(slug);
  const raw = formValues(formData, CUSTOMER_FIELDS);
  const parsed = customerInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      fields: fieldErrorsOf(parsed.error),
      values: submittedValues(raw),
    };
  }

  const result = await createCustomer(ctx, parsed.data);
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return {
      form: failureMessage(result.reason),
      values: submittedValues(raw),
    };
  }
  redirect(`/${ctx.slug}/customers/${result.value.id}`);
}

export async function updateCustomerAction(
  slug: string,
  id: string,
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const ctx = await requireOrgContext(slug);
  const customerId = requireId(id);
  const raw = formValues(formData, CUSTOMER_FIELDS);
  const parsed = customerInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      fields: fieldErrorsOf(parsed.error),
      values: submittedValues(raw),
    };
  }

  const result = await updateCustomer(ctx, customerId, parsed.data);
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return {
      form: failureMessage(result.reason),
      values: submittedValues(raw),
    };
  }
  refresh();
  return { values: submittedValues(raw), notice: "保存しました。" };
}

export type DeleteCustomerState = { form?: string };

export async function deleteCustomerAction(
  slug: string,
  id: string,
): Promise<DeleteCustomerState> {
  const ctx = await requireOrgContext(slug);
  const customerId = requireId(id);
  const result = await deleteCustomer(ctx, customerId, new Date());
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return { form: failureMessage(result.reason) };
  }
  redirect(`/${ctx.slug}/customers`);
}

export type CustomerExportState = { form?: string; notice?: string };

/** 顧客一覧の CSV エクスポートを依頼する（F-11）。CSV は Worker が作る */
export async function requestCustomerExportAction(
  slug: string,
): Promise<CustomerExportState> {
  const ctx = await requireOrgContext(slug);
  const result = await requestCustomerExport(ctx);
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return { form: failureMessage(result.reason) };
  }
  refresh();
  return {
    notice:
      "CSV の作成を受け付けました。できあがったらメールでお知らせします。",
  };
}

export type CompleteUploadState = { form?: string };

/**
 * ブラウザが S3 への PUT を終えた後に呼ぶ（F-12）。S3 にあるファイルの
 * 形式とサイズを Service が確かめてから、添付ファイルとして登録する
 */
export async function completeUploadAction(
  slug: string,
  attachmentId: string,
): Promise<CompleteUploadState> {
  const ctx = await requireOrgContext(slug);
  const result = await completeUpload(ctx, requireId(attachmentId));
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return { form: failureMessage(result.reason) };
  }
  refresh();
  return {};
}
