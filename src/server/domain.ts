/**
 * 画面と Service で共有する型。クライアントコンポーネントからも
 * import type されるので、Prisma など実行時の依存を持たない。
 */

/** docs/authz-matrix.md のロール */
export type Role = "owner" | "admin" | "staff";

/** prisma/schema.prisma の enum ReservationStatus と同じ値 */
export type ReservationStatus =
  "pending" | "confirmed" | "cancelled" | "done";
