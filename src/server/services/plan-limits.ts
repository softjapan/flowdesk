/**
 * プランによる機能制限（F-15）。Free はスタッフ 2 人・店舗 1 つまで。
 * docs/authz-matrix.md のテストケース 5（Free プランで 3 人目の
 * スタッフを追加できない）。
 *
 * 「スタッフ」は予約を担当するメンバー（docs/requirements.md の用語。
 * Staff ロールに限らない）で、有効な staffProfile の数で数える。
 * 追加する側の Service は lockOrganization したトランザクションの中で
 * 呼ぶ（同時に 2 人が招待を受諾しても、上限を超えない）。
 *
 * Pro から Free に戻った組織は、上限を超えた分もそのまま使える。
 * 新しく追加することだけを止める（docs/billing.md）。
 */
import { type Db, getPrisma } from "@/server/db";
import {
  PLANS,
  toPlanId,
  withinLimit,
  type PlanId,
} from "@/server/plans";
import {
  countActiveStaffProfiles,
  countLocations,
} from "@/server/repositories/catalog";
import { findSubscription } from "@/server/repositories/subscriptions";

export async function findPlanId(
  organizationId: string,
  db: Db = getPrisma(),
): Promise<PlanId> {
  return toPlanId((await findSubscription(organizationId, db))?.plan);
}

export async function canAddStaff(
  organizationId: string,
  db: Db,
): Promise<boolean> {
  const plan = PLANS[await findPlanId(organizationId, db)];
  return withinLimit(
    plan.maxStaff,
    await countActiveStaffProfiles(organizationId, db),
  );
}

export async function canAddLocation(
  organizationId: string,
  db: Db,
): Promise<boolean> {
  const plan = PLANS[await findPlanId(organizationId, db)];
  return withinLimit(
    plan.maxLocations,
    await countLocations(organizationId, db),
  );
}

export type PlanUsage = {
  plan: PlanId;
  label: string;
  staff: number;
  maxStaff: number | null;
  locations: number;
  maxLocations: number | null;
};

export async function getPlanUsage(
  organizationId: string,
  db: Db = getPrisma(),
): Promise<PlanUsage> {
  const [planId, staff, locations] = await Promise.all([
    findPlanId(organizationId, db),
    countActiveStaffProfiles(organizationId, db),
    countLocations(organizationId, db),
  ]);
  const plan = PLANS[planId];
  return {
    plan: planId,
    label: plan.label,
    staff,
    maxStaff: plan.maxStaff,
    locations,
    maxLocations: plan.maxLocations,
  };
}
