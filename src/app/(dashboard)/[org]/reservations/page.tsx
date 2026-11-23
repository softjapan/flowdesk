import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTime, formatYmd } from "@/lib/datetime";
import { getOrgContext } from "@/server/services/org-context";
import {
  getCalendar,
  type CalendarQuery,
} from "@/server/services/reservations";
import { getCurrentUserId } from "@/server/session";
import { StatusBadge } from "../_components/status-badge";

function calendarHref(
  slug: string,
  query: CalendarQuery,
  change: Partial<CalendarQuery>,
): string {
  const next = { ...query, ...change };
  const search = new URLSearchParams({
    view: next.view,
    date: next.date,
  });
  if (next.staffId) search.set("staff", next.staffId);
  return `/${slug}/reservations?${search}`;
}

// S-07 予約カレンダー
export default async function ReservationsPage({
  params,
  searchParams,
}: PageProps<"/[org]/reservations">) {
  const { org } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  if (!ctx) notFound();
  const calendar = await getCalendar(
    ctx,
    await searchParams,
    new Date(),
  );
  const { query, timezone } = calendar;
  const href = (change: Partial<CalendarQuery>) =>
    calendarHref(ctx.slug, query, change);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">予約カレンダー</h1>

      <div className="flex flex-wrap items-end gap-4">
        <nav aria-label="表示の切り替え" className="flex gap-1">
          {(["day", "week"] as const).map((view) => (
            <Button
              key={view}
              asChild
              size="sm"
              variant={query.view === view ? "default" : "outline"}
            >
              <Link
                href={href({ view })}
                aria-current={
                  query.view === view ? "page" : undefined
                }
              >
                {view === "day" ? "日" : "週"}
              </Link>
            </Button>
          ))}
        </nav>
        <nav aria-label="期間の移動" className="flex gap-1">
          <Button asChild size="sm" variant="outline">
            <Link href={href({ date: calendar.prevDate })}>前へ</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={href({ date: calendar.todayYmd })}>今日</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={href({ date: calendar.nextDate })}>次へ</Link>
          </Button>
        </nav>
        <form className="flex items-end gap-2">
          <input type="hidden" name="view" value={query.view} />
          <input type="hidden" name="date" value={query.date} />
          <div className="grid gap-1.5">
            <Label htmlFor="staff">スタッフ</Label>
            <select
              id="staff"
              name="staff"
              defaultValue={query.staffId ?? ""}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="">全員</option>
              {calendar.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" size="sm" variant="outline">
            絞り込む
          </Button>
        </form>
      </div>

      <div className="space-y-6">
        {calendar.days.map((day) => (
          <section
            key={day.date}
            aria-labelledby={`day-${day.date}`}
            className="space-y-1"
          >
            <h2
              id={`day-${day.date}`}
              className="flex items-center gap-2 font-semibold"
            >
              {formatYmd(day.date)}
              {day.date === calendar.todayYmd && (
                <Badge variant="secondary">今日</Badge>
              )}
            </h2>
            {day.reservations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                予約なし
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">時間</TableHead>
                    <TableHead>顧客</TableHead>
                    <TableHead>メニュー</TableHead>
                    <TableHead>担当</TableHead>
                    <TableHead>状態</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {day.reservations.map((r) => (
                    <TableRow
                      key={r.id}
                      className={
                        r.status === "cancelled"
                          ? "text-muted-foreground line-through"
                          : undefined
                      }
                    >
                      <TableCell className="tabular-nums">
                        {formatTime(r.startsAt, timezone)}〜
                        {formatTime(r.endsAt, timezone)}
                      </TableCell>
                      <TableCell>{r.customerName}</TableCell>
                      <TableCell>{r.serviceName}</TableCell>
                      <TableCell>{r.staffName}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
