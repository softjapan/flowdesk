import type { ReservationStatus } from "@/server/domain";

export const statusLabels: Record<ReservationStatus, string> = {
  pending: "仮予約",
  confirmed: "確定",
  cancelled: "キャンセル",
  done: "来店済み",
};
