import { Badge } from "@/components/ui/badge";
import type { ReservationStatus } from "@/server/demo-data";
import { statusLabels } from "./status-label";

const variants = {
  pending: "outline",
  confirmed: "default",
  cancelled: "destructive",
  done: "secondary",
} as const satisfies Record<ReservationStatus, string>;

// 色だけに頼らず、必ず文字で状態を示す
export function StatusBadge({
  status,
}: {
  status: ReservationStatus;
}) {
  return (
    <Badge variant={variants[status]}>{statusLabels[status]}</Badge>
  );
}
