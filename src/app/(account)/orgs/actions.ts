"use server";
/**
 * 組織の作成（S-04、F-03）。行うのは入力の検証・認証・Service の呼び出しだけ。
 */
import { notFound, redirect } from "next/navigation";
import { failureMessage } from "@/server/request-context";
import { createOrganization } from "@/server/services/organizations";
import { getCurrentUserId } from "@/server/session";
import {
  fieldErrorsOf,
  formValues,
  type FormErrors,
} from "@/server/validation/form";
import {
  ORGANIZATION_FIELDS,
  organizationInputSchema,
  type OrganizationFieldName,
} from "@/server/validation/organization";

export type CreateOrganizationState =
  FormErrors<OrganizationFieldName> & {
    values?: Partial<Record<OrganizationFieldName, string>>;
  };

export async function createOrganizationAction(
  _prev: CreateOrganizationState,
  formData: FormData,
): Promise<CreateOrganizationState> {
  const userId = await getCurrentUserId();
  const raw = formValues(formData, ORGANIZATION_FIELDS);
  const values = {
    name: typeof raw.name === "string" ? raw.name : "",
    slug: typeof raw.slug === "string" ? raw.slug : "",
  };
  const parsed = organizationInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { fields: fieldErrorsOf(parsed.error), values };
  }

  const result = await createOrganization(
    userId,
    parsed.data,
    new Date(),
  );
  if (!result.ok) {
    if (result.reason === "slug_taken") {
      return {
        fields: { slug: failureMessage(result.reason) },
        values,
      };
    }
    if (result.reason === "not_found") notFound();
    return { form: failureMessage(result.reason), values };
  }
  redirect(`/${result.value.slug}`);
}
