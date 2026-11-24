/**
 * ロールと権限の宣言（docs/authz-matrix.md）。Better Auth の organization
 * プラグインに ac・roles として渡し（src/server/auth.ts）、Service 層の
 * 判定（src/server/services/authz.ts）もこの宣言から引く。
 *
 * 既定の "member" ロールは使わず、owner・admin・staff の 3 つだけを定義する。
 * 「Staff は自分が担当の予約のみ」「Admin は Staff⇔Admin のみ」のように
 * 相手や担当で決まる条件は、宣言では表せないので authz.ts で判定する。
 *
 * 実行時の依存は better-auth のアクセス制御だけ（DB を使わない）。
 */
import { createAccessControl } from "better-auth/plugins/access";
import type { Role } from "@/server/domain";

/**
 * リソースと操作。organization・member・invitation は Better Auth の
 * 既定と同じ名前にする（プラグインの API が権限を確かめるときに使う）
 */
export const statement = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  /** 店舗・メニュー */
  catalog: ["read", "create", "update", "delete"],
  customer: ["read", "create", "update", "delete", "export"],
  attachment: ["read", "upload"],
  /** manageOwn＝自分が担当の予約、manageAll＝すべての予約の作成・変更・キャンセル */
  reservation: ["read", "manageOwn", "manageAll"],
  billing: ["read", "update"],
  auditLog: ["read"],
  dashboard: ["revenue"],
} as const;

export const ac = createAccessControl(statement);

export const owner = ac.newRole({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  catalog: ["read", "create", "update", "delete"],
  customer: ["read", "create", "update", "delete", "export"],
  attachment: ["read", "upload"],
  reservation: ["read", "manageOwn", "manageAll"],
  billing: ["read", "update"],
  auditLog: ["read"],
  dashboard: ["revenue"],
});

export const admin = ac.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  catalog: ["read", "create", "update", "delete"],
  customer: ["read", "create", "update", "delete", "export"],
  attachment: ["read", "upload"],
  reservation: ["read", "manageOwn", "manageAll"],
  billing: ["read"],
  auditLog: ["read"],
  dashboard: ["revenue"],
});

export const staff = ac.newRole({
  catalog: ["read"],
  customer: ["read", "create", "update"],
  attachment: ["read", "upload"],
  reservation: ["read", "manageOwn"],
});

export const roles = { owner, admin, staff } satisfies Record<
  Role,
  unknown
>;

export const ROLES = Object.keys(roles) as Role[];

/** 確かめたい権限（例：{ customer: ["delete"] }） */
export type Permissions = {
  [R in keyof typeof statement]?: (typeof statement)[R][number][];
};

/**
 * Better Auth の member.role は文字列（複数ロールはカンマ区切り）。
 * ここで定義したロール 1 つだけのときに Role を返し、それ以外
 * （既定の "member" など）は null にして権限を与えない
 */
export function toRole(
  value: string | null | undefined,
): Role | null {
  return (ROLES as string[]).includes(value ?? "")
    ? (value as Role)
    : null;
}
