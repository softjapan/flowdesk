/**
 * 組織の選択・作成（S-04、F-03）。組織を作った人が Owner になる。
 * 組織に属する前の操作なので OrgContext ではなくユーザー ID を受け取る。
 */
import { runInTransaction } from "@/server/db";
import type { Role } from "@/server/domain";
import { createAuditLog } from "@/server/repositories/audit-logs";
import {
  createOrganizationWithOwner,
  isSlugTaken,
  listOrganizationsForUser,
} from "@/server/repositories/organizations";
import { fail, ok, type Result } from "@/server/services/result";
import type { OrganizationInput } from "@/server/validation/organization";

export type MyOrganization = {
  name: string;
  slug: string;
  role: Role;
};

export async function listMyOrganizations(
  userId: string,
): Promise<MyOrganization[]> {
  const rows = await listOrganizationsForUser(userId);
  return rows.map(({ name, slug, role }) => ({ name, slug, role }));
}

/** 一意制約の違反（同時に同じスラッグで作られた） */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export async function createOrganization(
  userId: string,
  input: OrganizationInput,
  now: Date,
): Promise<Result<{ slug: string }>> {
  if (await isSlugTaken(input.slug)) return fail("slug_taken");
  try {
    return await runInTransaction(async (tx) => {
      const { organization, member } =
        await createOrganizationWithOwner(
          { ...input, ownerUserId: userId },
          now,
          tx,
        );
      await createAuditLog(
        {
          organizationId: organization.id,
          actorUserId: userId,
          action: "organization.create",
          targetType: "organization",
          targetId: organization.id,
          diff: {
            name: organization.name,
            slug: organization.slug,
            ownerMemberId: member.id,
          },
        },
        tx,
      );
      return ok({ slug: organization.slug });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("slug_taken");
    throw error;
  }
}
