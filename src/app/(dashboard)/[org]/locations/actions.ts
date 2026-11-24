"use server";
/**
 * 店舗の Server Action（F-05、S-12）。行うのは入力の検証・認証・Service の
 * 呼び出しだけ。権限（Owner・Admin）とプランの上限は Service が判定する。
 *
 * slug と id は .bind で渡すが、利用者が書き換えて送れるので必ず検証する。
 * 他の組織の店舗（存在しない店舗と区別しない）は notFound() で 404 にする。
 */
import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import {
  failureMessage,
  requireId,
  requireOrgContext,
} from "@/server/request-context";
import {
  createLocation,
  deleteLocation,
  updateLocation,
} from "@/server/services/locations";
import { fieldErrorsOf, formValues } from "@/server/validation/form";
import {
  LOCATION_FIELDS,
  locationInputSchema,
  type LocationFieldName,
} from "@/server/validation/location";
import type { CatalogFormState } from "../_components/catalog-forms";

export type LocationFormState = CatalogFormState<LocationFieldName>;

function submittedValues(raw: Record<LocationFieldName, unknown>) {
  return Object.fromEntries(
    LOCATION_FIELDS.map((k) => [
      k,
      typeof raw[k] === "string" ? raw[k] : "",
    ]),
  );
}

export async function createLocationAction(
  slug: string,
  _prev: LocationFormState,
  formData: FormData,
): Promise<LocationFormState> {
  const ctx = await requireOrgContext(slug);
  const raw = formValues(formData, LOCATION_FIELDS);
  const parsed = locationInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      fields: fieldErrorsOf(parsed.error),
      values: submittedValues(raw),
    };
  }
  const result = await createLocation(ctx, parsed.data);
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return {
      form: failureMessage(result.reason),
      values: submittedValues(raw),
    };
  }
  refresh();
  // 値を返さないので、フォームは空に戻る
  return { notice: `${parsed.data.name}を追加しました。` };
}

export async function updateLocationAction(
  slug: string,
  id: string,
  _prev: LocationFormState,
  formData: FormData,
): Promise<LocationFormState> {
  const ctx = await requireOrgContext(slug);
  const locationId = requireId(id);
  const raw = formValues(formData, LOCATION_FIELDS);
  const parsed = locationInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      fields: fieldErrorsOf(parsed.error),
      values: submittedValues(raw),
    };
  }
  const result = await updateLocation(ctx, locationId, parsed.data);
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

export async function deleteLocationAction(
  slug: string,
  id: string,
): Promise<LocationFormState> {
  const ctx = await requireOrgContext(slug);
  const locationId = requireId(id);
  const result = await deleteLocation(ctx, locationId);
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return { form: failureMessage(result.reason) };
  }
  refresh();
  return {};
}
