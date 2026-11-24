/**
 * メニューの管理（F-06、S-11）。DB の service テーブル。閲覧は全ロール、
 * 作成・編集・削除は Owner・Admin（docs/authz-matrix.md）。
 *
 * 予約は作成時の料金を priceYen に、終了時刻を endsAt に保存しているので、
 * メニューの料金・所要時間を変えても作成済みの予約は変わらない
 * （過去の売上が変わらない）。予約が参照しているメニューは削除できない
 * （in_use。判定は DB の外部キーに任せる）。
 */
import { runInTransaction } from "@/server/db";
import { createAuditLog } from "@/server/repositories/audit-logs";
import {
  createService,
  deleteService,
  findService,
  isForeignKeyViolation,
  listServices,
  updateService,
} from "@/server/repositories/catalog";
import { canManageCatalog } from "@/server/services/authz";
import type { OrgContext } from "@/server/services/org-context";
import { fail, ok, type Result } from "@/server/services/result";
import {
  MENU_FIELDS,
  type MenuInput,
} from "@/server/validation/menu";

export type Menu = {
  id: string;
  name: string;
  durationMinutes: number;
  priceYen: number;
};

export type MenusPage = {
  menus: Menu[];
  /** 画面で編集のフォームを出すか（Service でも必ず判定する） */
  canManage: boolean;
};

export async function getMenusPage(
  ctx: OrgContext,
): Promise<MenusPage> {
  const rows = await listServices(ctx.organizationId);
  return {
    menus: rows.map((s) => ({
      id: s.id,
      name: s.name,
      durationMinutes: s.durationMinutes,
      priceYen: s.priceYen,
    })),
    canManage: canManageCatalog(ctx.role),
  };
}

export async function createMenu(
  ctx: OrgContext,
  input: MenuInput,
): Promise<Result<{ id: string }>> {
  if (!canManageCatalog(ctx.role)) return fail("forbidden");
  return runInTransaction(async (tx) => {
    const row = await createService(ctx.organizationId, input, tx);
    await createAuditLog(
      {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "service.create",
        targetType: "service",
        targetId: row.id,
        diff: {
          name: input.name,
          durationMinutes: input.durationMinutes,
          priceYen: input.priceYen,
        },
      },
      tx,
    );
    return ok({ id: row.id });
  });
}

export async function updateMenu(
  ctx: OrgContext,
  id: string,
  input: MenuInput,
): Promise<Result<{ id: string }>> {
  if (!canManageCatalog(ctx.role)) return fail("forbidden");
  return runInTransaction(async (tx) => {
    const before = await findService(ctx.organizationId, id, tx);
    if (!before) return fail("not_found");
    const fields = MENU_FIELDS.filter((k) => before[k] !== input[k]);
    if (fields.length === 0) return ok({ id });
    if (!(await updateService(ctx.organizationId, id, input, tx))) {
      return fail("not_found");
    }
    await createAuditLog(
      {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "service.update",
        targetType: "service",
        targetId: id,
        diff: { fields },
      },
      tx,
    );
    return ok({ id });
  });
}

export async function deleteMenu(
  ctx: OrgContext,
  id: string,
): Promise<Result<{ id: string }>> {
  if (!canManageCatalog(ctx.role)) return fail("forbidden");
  try {
    return await runInTransaction(async (tx) => {
      const before = await findService(ctx.organizationId, id, tx);
      if (!before) return fail("not_found");
      // 外部キーの違反はトランザクションを中断させるので、外で受ける
      if (!(await deleteService(ctx.organizationId, id, tx))) {
        return fail("not_found");
      }
      await createAuditLog(
        {
          organizationId: ctx.organizationId,
          actorUserId: ctx.userId,
          action: "service.delete",
          targetType: "service",
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
