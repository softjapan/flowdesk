/**
 * docs/authz-matrix.md の判定。「ログイン済み」かつ「組織のメンバー」で
 * あることは OrgContext を作る時点（getOrgContext）で確かめてあるので、
 * ここではロールと担当で決まる部分だけを判定する。
 *
 * 画面でボタンを隠すときもここを使うが、必ず Service でも判定する。
 */
import type { Role } from "@/server/domain";

/** 顧客／作成・編集：全ロール可 */
export function canEditCustomer(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "staff";
}

/** 顧客／削除（論理削除）：Owner・Admin */
export function canDeleteCustomer(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/**
 * 予約／作成・変更・キャンセル：Owner・Admin は可、
 * Staff は自分が担当の予約のみ（ownStaffProfileId は操作する人自身の
 * スタッフ情報。スタッフ情報のない Staff は何も操作できない）
 */
export function canManageReservation(
  role: Role,
  reservationStaffProfileId: string,
  ownStaffProfileId: string | null,
): boolean {
  if (role === "owner" || role === "admin") return true;
  return (
    ownStaffProfileId !== null &&
    reservationStaffProfileId === ownStaffProfileId
  );
}
