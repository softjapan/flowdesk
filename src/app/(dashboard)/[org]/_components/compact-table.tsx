import { TableBody } from "@/components/ui/table";

/**
 * 数百行になる表（予約カレンダーの週表示・ダッシュボードの本日の予約）の
 * 本体。行は素の <tr>・<td> で書き、TableRow・TableCell と同じ見た目の
 * クラスを tbody から子孫セレクタで当てる（第15章）。
 *
 * 1 行ごとに TableCell のクラス（約 90 文字 × 5 セル）を繰り返すと、週表示の
 * 700 行で HTML と RSC のペイロードが数百 KB 増え、同時 10 本の負荷で p95 が
 * 500ms を超えた（docs/performance.md）
 */
export function CompactTableBody({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TableBody className="[&>tr]:border-b [&>tr]:transition-colors [&>tr:hover]:bg-muted/50 [&>tr>td]:p-2 [&>tr>td]:align-middle [&>tr>td]:whitespace-nowrap">
      {children}
    </TableBody>
  );
}
