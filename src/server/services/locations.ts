/**
 * 店舗の管理（F-05、S-12）。閲覧は全ロール（予約のフォームでも使う）、
 * 作成・編集・削除は Owner・Admin（docs/authz-matrix.md）。
 * Free プランは店舗 1 つまで（F-15）。上限は画面ではなくここで守る。
 * Pro から Free に戻った組織は、上限を超えた店舗も変更・削除できる
 * （新しく作ることだけを止める。docs/billing.md）。
 *
 * 予約が参照している店舗は削除できない（in_use）。予約の履歴が店舗を
 * たどれなくなるため。判定は DB の外部キーに任せ、削除と同時に予約が
 * 作られても食い違わないようにする。
 */
import { runInTransaction } from "@/server/db";
import { createAuditLog } from "@/server/repositories/audit-logs";
import {
  createLocation as insertLocation,
  deleteLocation as deleteLocationRow,
  findLocation,
  isForeignKeyViolation,
  listLocations,
  updateLocation as updateLocationRow,
} from "@/server/repositories/catalog";
import { lockOrganization } from "@/server/repositories/organizations";
import { canManageCatalog } from "@/server/services/authz";
import type { OrgContext } from "@/server/services/org-context";
import {
  canAddLocation,
  getPlanUsage,
  type PlanUsage,
} from "@/server/services/plan-limits";
import { fail, ok, type Result } from "@/server/services/result";
import type { LocationInput } from "@/server/validation/location";

export type LocationsPage = {
  locations: { id: string; name: string; timezone: string }[];
  /** 画面で編集のフォームを出すか（Service でも必ず判定する） */
  canManage: boolean;
  /** 店舗数と上限。Owner・Admin だけに見せる */
  planUsage: PlanUsage | null;
};

export async function getLocationsPage(
  ctx: OrgContext,
): Promise<LocationsPage> {
  const canManage = canManageCatalog(ctx.role);
  const [rows, planUsage] = await Promise.all([
    listLocations(ctx.organizationId),
    canManage ? getPlanUsage(ctx.organizationId) : null,
  ]);
  return {
    locations: rows.map((l) => ({
      id: l.id,
      name: l.name,
      timezone: l.timezone,
    })),
    canManage,
    planUsage,
  };
}

export async function createLocation(
  ctx: OrgContext,
  input: LocationInput,
): Promise<Result<{ id: string }>> {
  if (!canManageCatalog(ctx.role)) return fail("forbidden");
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

/**
 * 名前とタイムゾーンの変更。予約は UTC で保存しているので、タイムゾーンを
 * 変えると既存の予約の表示上の時刻が変わる（画面で注意を出す）
 */
export async function updateLocation(
  ctx: OrgContext,
  id: string,
  input: LocationInput,
): Promise<Result<{ id: string }>> {
  if (!canManageCatalog(ctx.role)) return fail("forbidden");
  return runInTransaction(async (tx) => {
    const before = await findLocation(ctx.organizationId, id, tx);
    if (!before) return fail("not_found");
    const fields = (["name", "timezone"] as const).filter(
      (k) => before[k] !== input[k],
    );
    if (fields.length === 0) return ok({ id });
    if (
      !(await updateLocationRow(ctx.organizationId, id, input, tx))
    ) {
      return fail("not_found");
    }
    await createAuditLog(
      {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "location.update",
        targetType: "location",
        targetId: id,
        diff: { fields },
      },
      tx,
    );
    return ok({ id });
  });
}

export async function deleteLocation(
  ctx: OrgContext,
  id: string,
): Promise<Result<{ id: string }>> {
  if (!canManageCatalog(ctx.role)) return fail("forbidden");
  try {
    return await runInTransaction(async (tx) => {
      const before = await findLocation(ctx.organizationId, id, tx);
      if (!before) return fail("not_found");
      // 外部キーの違反はトランザクションを中断させるので、外で受ける
      if (!(await deleteLocationRow(ctx.organizationId, id, tx))) {
        return fail("not_found");
      }
      await createAuditLog(
        {
          organizationId: ctx.organizationId,
          actorUserId: ctx.userId,
          action: "location.delete",
          targetType: "location",
          targetId: id,
          diff: { name: before.name },
        },
        tx,
      );
      return ok({ id });
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) return fail("in_use");
    throw error;
  }
}
