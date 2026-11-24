/**
 * 画面と Service で共有する型。クライアントコンポーネントからも
 * import type されるので、Prisma など実行時の依存を持たない。
 */

/**
 * docs/authz-matrix.md のロール。権限の宣言は
 * src/server/access-control.ts（Better Auth の createAccessControl）
 */
export type Role = "owner" | "admin" | "staff";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
};

/** prisma/schema.prisma の enum ReservationStatus と同じ値 */
export type ReservationStatus =
  "pending" | "confirmed" | "cancelled" | "done";
