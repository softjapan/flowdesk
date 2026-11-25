import type { ReservationStatus } from "@/server/domain";
import { statusLabels } from "./status-label";

// Badge（src/components/ui/badge.tsx）と同じ見た目のクラスのうち、
// 文字だけの状態表示に効くものだけを使う（第15章）。予約カレンダーの週表示は
// 1 画面に数百行あり、Badge のクラス（フォーカス・リンク・アイコン用を含む
// 約 800 文字）が HTML と RSC のペイロードの半分近くを占めていた
// （docs/performance.md）
const base =
  "inline-flex h-5 w-fit shrink-0 items-center justify-center rounded-4xl border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const variants = {
  pending: "border-border text-foreground",
  confirmed: "border-transparent bg-primary text-primary-foreground",
  cancelled:
    "border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20",
  done: "border-transparent bg-secondary text-secondary-foreground",
} as const satisfies Record<ReservationStatus, string>;

// 色だけに頼らず、必ず文字で状態を示す
export function StatusBadge({
  status,
}: {
  status: ReservationStatus;
}) {
  return (
    <span className={`${base} ${variants[status]}`}>
      {statusLabels[status]}
    </span>
  );
}
