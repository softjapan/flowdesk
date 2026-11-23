"use server";
/**
 * 予約の Server Action（F-08・F-09）。行うのは入力の検証・認証・Service の
 * 呼び出しだけ。Staff の担当の判定、重複の検出、楽観ロックは Service が行う。
 *
 * slug・id は .bind で、version は hidden の項目で受け取る。どれも利用者が
 * 書き換えられるので検証する。他の組織の予約・顧客・スタッフなどを
 * 指定された場合（存在しない場合と区別しない）は notFound() で 404 にする。
 */
import { refresh } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  failureMessage,
  requireId,
  requireOrgContext,
} from "@/server/request-context";
import {
  cancelReservation,
  createReservation,
  updateReservation,
} from "@/server/services/reservations";
import {
  fieldErrorsOf,
  formValues,
  type FormErrors,
} from "@/server/validation/form";
import {
  RESERVATION_FIELDS,
  reservationInputSchema,
  versionSchema,
  type ReservationFieldName,
} from "@/server/validation/reservation";

export type ReservationFormState =
  FormErrors<ReservationFieldName> & {
    /** 送信された値。エラーのときにフォームへ戻す */
    values?: Partial<Record<ReservationFieldName, string>>;
    notice?: string;
  };

function submittedValues(
  raw: Record<ReservationFieldName, unknown>,
): ReservationFormState["values"] {
  return Object.fromEntries(
    RESERVATION_FIELDS.map((k) => [
      k,
      typeof raw[k] === "string" ? raw[k] : "",
    ]),
  );
}

const STALE_FORM =
  "画面の情報が古くなっています。読み込み直してから、もう一度操作してください。";

export async function createReservationAction(
  slug: string,
  _prev: ReservationFormState,
  formData: FormData,
): Promise<ReservationFormState> {
  const ctx = await requireOrgContext(slug);
  const raw = formValues(formData, RESERVATION_FIELDS);
  const parsed = reservationInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      fields: fieldErrorsOf(parsed.error),
      values: submittedValues(raw),
    };
  }

  const result = await createReservation(ctx, parsed.data);
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return {
      form: failureMessage(result.reason),
      values: submittedValues(raw),
    };
  }
  redirect(`/${ctx.slug}/reservations/${result.value.id}`);
}

export async function updateReservationAction(
  slug: string,
  id: string,
  _prev: ReservationFormState,
  formData: FormData,
): Promise<ReservationFormState> {
  const ctx = await requireOrgContext(slug);
  const reservationId = requireId(id);
  const raw = formValues(formData, RESERVATION_FIELDS);
  const version = versionSchema.safeParse(formData.get("version"));
  if (!version.success) {
    return { form: STALE_FORM, values: submittedValues(raw) };
  }
  const parsed = reservationInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      fields: fieldErrorsOf(parsed.error),
      values: submittedValues(raw),
    };
  }

  const result = await updateReservation(
    ctx,
    reservationId,
    version.data,
    parsed.data,
  );
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return {
      form: failureMessage(result.reason),
      values: submittedValues(raw),
    };
  }
  // 新しい version を画面に読み込み直す
  refresh();
  return { values: submittedValues(raw), notice: "保存しました。" };
}

export type CancelReservationState = { form?: string };

export async function cancelReservationAction(
  slug: string,
  id: string,
  _prev: CancelReservationState,
  formData: FormData,
): Promise<CancelReservationState> {
  const ctx = await requireOrgContext(slug);
  const reservationId = requireId(id);
  const version = versionSchema.safeParse(formData.get("version"));
  if (!version.success) return { form: STALE_FORM };

  const result = await cancelReservation(
    ctx,
    reservationId,
    version.data,
  );
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return { form: failureMessage(result.reason) };
  }
  refresh();
  return {};
}
