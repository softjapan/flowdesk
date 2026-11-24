/**
 * 店舗の作成（F-05）。Owner・Admin のみ。Free プランは店舗 1 つまで
 * （F-15）。店舗管理の画面（S-12）はまだないが、上限は画面ではなく
 * ここで守る（画面を足しても、この Service を通す）。
 */
import { runInTransaction } from "@/server/db";
import { createAuditLog } from "@/server/repositories/audit-logs";
import { createLocation as insertLocation } from "@/server/repositories/catalog";
import { lockOrganization } from "@/server/repositories/organizations";
import { canCreateCatalog } from "@/server/services/authz";
import type { OrgContext } from "@/server/services/org-context";
import { canAddLocation } from "@/server/services/plan-limits";
import { fail, ok, type Result } from "@/server/services/result";
import type { LocationInput } from "@/server/validation/location";

export async function createLocation(
  ctx: OrgContext,
  input: LocationInput,
): Promise<Result<{ id: string }>> {
  if (!canCreateCatalog(ctx.role)) return fail("forbidden");
  return runInTransaction(async (tx) => {
    // 同時に 2 つ作っても上限を超えないよう、組織をロックしてから数える
    if (!(await lockOrganization(ctx.organizationId, tx))) {
      return fail("not_found");
    }
    if (!(await canAddLocation(ctx.organizationId, tx))) {
      return fail("plan_limit");
    }
    const location = await insertLocation(
      ctx.organizationId,
      input,
      tx,
    );
    await createAuditLog(
      {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "location.create",
        targetType: "location",
        targetId: location.id,
        diff: { name: input.name, timezone: input.timezone },
      },
      tx,
    );
    return ok({ id: location.id });
  });
}
