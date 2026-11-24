/**
 * docs/authz-matrix.md の判定。「ログイン済み」かつ「組織のメンバー」で
 * あることは OrgContext を作る時点（getOrgContext）で確かめてあるので、
 * ここではロールと担当で決まる部分だけを判定する。
 *
 * ロールごとの権限は src/server/access-control.ts の宣言（Better Auth の
 * organization プラグインに渡しているもの）から引く。宣言で表せない条件
 * （担当・相手のロール）だけをここで足す。DB が必要な条件（最後の Owner）は
 * Service がトランザクションの中で確かめる。
 *
 * 画面でボタンを隠すときもここを使うが、必ず Service でも判定する。
 */
import { type Permissions, roles } from "@/server/access-control";
import type { Role } from "@/server/domain";

/** 宣言された権限をすべて持つか */
export function can(role: Role, permissions: Permissions): boolean {
  return roles[role].authorize(permissions).success;
}

/** 顧客／作成・編集：全ロール可 */
export function canEditCustomer(role: Role): boolean {
  return can(role, { customer: ["create", "update"] });
}

/** 顧客／削除（論理削除）：Owner・Admin */
export function canDeleteCustomer(role: Role): boolean {
  return can(role, { customer: ["delete"] });
}

/** 予約をすべて操作できる（担当を問わない）か */
export function canManageAllReservations(role: Role): boolean {
  return can(role, { reservation: ["manageAll"] });
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
  if (canManageAllReservations(role)) return true;
  return (
    can(role, { reservation: ["manageOwn"] }) &&
    ownStaffProfileId !== null &&
    reservationStaffProfileId === ownStaffProfileId
  );
}

/** ダッシュボード／売上の表示：Owner・Admin（Staff には予約数のみ） */
export function canViewRevenue(role: Role): boolean {
  return can(role, { dashboard: ["revenue"] });
}

/** 監査ログ／閲覧：Owner・Admin */
export function canViewAuditLogs(role: Role): boolean {
  return can(role, { auditLog: ["read"] });
}

/**
 * 招待・ロール変更で扱える相手のロール。Owner はすべて、
 * Admin は Staff⇔Admin のみ（Owner の招待・Owner への昇格・Owner の降格は不可）
 */
const assignableRoles: Record<Role, readonly Role[]> = {
  owner: ["owner", "admin", "staff"],
  admin: ["admin", "staff"],
  staff: [],
};

/** 削除できる相手のロール。Admin は Staff のみ */
const removableRoles: Record<Role, readonly Role[]> = {
  owner: ["owner", "admin", "staff"],
  admin: ["staff"],
  staff: [],
};

/** メンバー／招待：Owner・Admin。Admin は Owner を招待できない */
export function canInvite(actor: Role, inviteRole: Role): boolean {
  return (
    can(actor, { invitation: ["create"] }) &&
    assignableRoles[actor].includes(inviteRole)
  );
}

/** 招待の取り消し：その招待を作れるロールなら取り消せる */
export function canCancelInvitation(
  actor: Role,
  inviteRole: Role,
): boolean {
  return (
    can(actor, { invitation: ["cancel"] }) &&
    assignableRoles[actor].includes(inviteRole)
  );
}

/** 招待するときに選べるロール（画面の選択肢） */
export function invitableRoles(actor: Role): Role[] {
  return assignableRoles[actor].filter((r) => canInvite(actor, r));
}

/**
 * メンバー／ロール変更：Owner は可、Admin は Staff⇔Admin のみ
 * （自分自身を Owner に昇格することもできない）。
 * 最後の Owner の降格は Service が DB の件数で拒否する
 */
export function canChangeRole(
  actor: Role,
  current: Role,
  next: Role,
): boolean {
  return (
    can(actor, { member: ["update"] }) &&
    assignableRoles[actor].includes(current) &&
    assignableRoles[actor].includes(next)
  );
}

/** ロール変更で選べるロール（現在のロールを含む。空なら変更できない） */
export function changeableRoles(actor: Role, current: Role): Role[] {
  return assignableRoles[actor].filter((r) =>
    canChangeRole(actor, current, r),
  );
}

/**
 * メンバー／削除：Owner は可、Admin は Staff のみ。
 * 最後の Owner の削除は Service が DB の件数で拒否する
 */
export function canRemoveMember(actor: Role, target: Role): boolean {
  return (
    can(actor, { member: ["delete"] }) &&
    removableRoles[actor].includes(target)
  );
}
