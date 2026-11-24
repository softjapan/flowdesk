"use server";
/**
 * メニューの Server Action（F-06、S-11）。行うのは入力の検証・認証・Service の
 * 呼び出しだけ。権限（Owner・Admin）と、予約で使われているかは Service が判定する。
 *
 * slug と id は .bind で渡すが、利用者が書き換えて送れるので必ず検証する。
 * 他の組織のメニュー（存在しないメニューと区別しない）は notFound() で 404 にする。
 */
import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import {
  failureMessage,
  requireId,
  requireOrgContext,
} from "@/server/request-context";
import {
  createMenu,
  deleteMenu,
  updateMenu,
} from "@/server/services/menus";
import { fieldErrorsOf, formValues } from "@/server/validation/form";
import {
  MENU_FIELDS,
  menuInputSchema,
  type MenuFieldName,
} from "@/server/validation/menu";
import type { CatalogFormState } from "../_components/catalog-forms";

export type MenuFormState = CatalogFormState<MenuFieldName>;

function submittedValues(raw: Record<MenuFieldName, unknown>) {
  return Object.fromEntries(
    MENU_FIELDS.map((k) => [
      k,
      typeof raw[k] === "string" ? raw[k] : "",
    ]),
  );
}

export async function createMenuAction(
  slug: string,
  _prev: MenuFormState,
  formData: FormData,
): Promise<MenuFormState> {
  const ctx = await requireOrgContext(slug);
  const raw = formValues(formData, MENU_FIELDS);
  const parsed = menuInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      fields: fieldErrorsOf(parsed.error),
      values: submittedValues(raw),
    };
  }
  const result = await createMenu(ctx, parsed.data);
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

export async function updateMenuAction(
  slug: string,
  id: string,
  _prev: MenuFormState,
  formData: FormData,
): Promise<MenuFormState> {
  const ctx = await requireOrgContext(slug);
  const menuId = requireId(id);
  const raw = formValues(formData, MENU_FIELDS);
  const parsed = menuInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      fields: fieldErrorsOf(parsed.error),
      values: submittedValues(raw),
    };
  }
  const result = await updateMenu(ctx, menuId, parsed.data);
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

export async function deleteMenuAction(
  slug: string,
  id: string,
): Promise<MenuFormState> {
  const ctx = await requireOrgContext(slug);
  const menuId = requireId(id);
  const result = await deleteMenu(ctx, menuId);
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return { form: failureMessage(result.reason) };
  }
  refresh();
  return {};
}
