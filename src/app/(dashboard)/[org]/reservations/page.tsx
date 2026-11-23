import Link from "next/link";
import { notFound } from "next/navigation";
import { formatTime, formatYmd } from "@/lib/datetime";
import { getOrgContext } from "@/server/services/org-context";
import {
  getCalendar,
  type CalendarQuery,
} from "@/server/services/reservations";
import { getCurrentUserId } from "@/server/session";
import { statusLabels } from "../_components/status-label";

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

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <nav aria-label="表示の切り替え" className="flex gap-2">
          {(["day", "week"] as const).map((view) => (
            <Link
              key={view}
              href={href({ view })}
              aria-current={query.view === view ? "page" : undefined}
              className={
                query.view === view ? "font-semibold" : "underline"
              }
            >
              {view === "day" ? "日" : "週"}
            </Link>
          ))}
        </nav>
        <nav aria-label="期間の移動" className="flex gap-2">
          <Link
            href={href({ date: calendar.prevDate })}
            className="underline"
          >
            前へ
          </Link>
          <Link
            href={href({ date: calendar.todayYmd })}
            className="underline"
          >
            今日
          </Link>
          <Link
            href={href({ date: calendar.nextDate })}
            className="underline"
          >
            次へ
          </Link>
        </nav>
        <form className="flex items-center gap-2">
          <input type="hidden" name="view" value={query.view} />
          <input type="hidden" name="date" value={query.date} />
          <label htmlFor="staff">スタッフ</label>
          <select
            id="staff"
            name="staff"
            defaultValue={query.staffId ?? ""}
            className="rounded border border-zinc-300 px-2 py-1"
          >
            <option value="">全員</option>
            {calendar.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded border border-zinc-300 px-3 py-1"
          >
            絞り込む
          </button>
        </form>
      </div>

      <div className="space-y-4">
        {calendar.days.map((day) => (
          <section key={day.date} aria-labelledby={`day-${day.date}`}>
            <h2
              id={`day-${day.date}`}
              className="border-b border-zinc-200 font-semibold"
            >
              {formatYmd(day.date)}
              {day.date === calendar.todayYmd && (
                <span className="ml-2 text-sm text-zinc-500">
                  今日
                </span>
              )}
            </h2>
            {day.reservations.length === 0 ? (
              <p className="py-1 text-sm text-zinc-500">予約なし</p>
            ) : (
              <ul className="py-1 text-sm">
                {day.reservations.map((r) => (
                  <li
                    key={r.id}
                    className={
                      r.status === "cancelled"
                        ? "text-zinc-400 line-through"
                        : undefined
                    }
                  >
                    {formatTime(r.startsAt, timezone)}〜
                    {formatTime(r.endsAt, timezone)} {r.customerName}
                    （{r.serviceName}／{r.staffName}）
                    {statusLabels[r.status]}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
