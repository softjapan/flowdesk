import {
  addDays,
  isValidYmd,
  startOfWeek,
  toZonedYmd,
  zonedToUtc,
} from "@/lib/datetime";
import { demoDb, type ReservationStatus } from "@/server/demo-data";
import type { OrgContext } from "@/server/services/org-context";
import {
  firstValue,
  type SearchParams,
} from "@/server/services/search-params";

export type CalendarView = "day" | "week";

export type CalendarQuery = {
  view: CalendarView;
  /** 表示の基準日（店舗のタイムゾーンでの YYYY-MM-DD） */
  date: string;
  /** スタッフで絞り込む。null は全員 */
  staffId: string | null;
};

/** 不正な値は既定値（今日・週表示・全員）に倒す */
export function parseCalendarQuery(
  params: SearchParams,
  todayYmd: string,
): CalendarQuery {
  const view = firstValue(params, "view") === "day" ? "day" : "week";
  const date = firstValue(params, "date");
  const staffId = firstValue(params, "staff");
  return {
    view,
    date: date && isValidYmd(date) ? date : todayYmd,
    staffId:
      staffId && /^[\w-]{1,64}$/.test(staffId) ? staffId : null,
  };
}

export type CalendarReservation = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  serviceName: string;
  staffName: string;
  status: ReservationStatus;
};

export type Calendar = {
  query: CalendarQuery;
  timezone: string;
  todayYmd: string;
  /** 前後の期間へ移動するときの基準日 */
  prevDate: string;
  nextDate: string;
  staff: { id: string; displayName: string }[];
  days: { date: string; reservations: CalendarReservation[] }[];
};

export async function getCalendar(
  ctx: OrgContext,
  params: SearchParams,
  now: Date,
): Promise<Calendar> {
  const tz = ctx.timezone;
  const todayYmd = toZonedYmd(now, tz);
  const parsed = parseCalendarQuery(params, todayYmd);

  const [staff, customers, services] = await Promise.all([
    demoDb.listStaffProfiles(ctx.organizationId),
    demoDb.listCustomers(ctx.organizationId),
    demoDb.listServices(ctx.organizationId),
  ]);
  // 他の組織や存在しないスタッフの ID は、指定なしとして扱う
  const query: CalendarQuery = {
    ...parsed,
    staffId: staff.some((s) => s.id === parsed.staffId)
      ? parsed.staffId
      : null,
  };

  const dayCount = query.view === "day" ? 1 : 7;
  const firstYmd =
    query.view === "day" ? query.date : startOfWeek(query.date);
  const reservations = await demoDb.listReservations(
    ctx.organizationId,
    {
      from: zonedToUtc(firstYmd, tz),
      to: zonedToUtc(addDays(firstYmd, dayCount), tz),
    },
    now,
  );

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const days = Array.from({ length: dayCount }, (_, i) => ({
    date: addDays(firstYmd, i),
    reservations: [] as CalendarReservation[],
  }));
  for (const r of reservations) {
    if (query.staffId && r.staffProfileId !== query.staffId) continue;
    const day = days.find(
      (d) => d.date === toZonedYmd(r.startsAt, tz),
    );
    day?.reservations.push({
      id: r.id,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      customerName:
        customerById.get(r.customerId)?.name ?? "（不明）",
      serviceName: serviceById.get(r.serviceId)?.name ?? "（不明）",
      staffName:
        staffById.get(r.staffProfileId)?.displayName ?? "（不明）",
      status: r.status,
    });
  }

  return {
    query,
    timezone: tz,
    todayYmd,
    prevDate: addDays(query.date, -dayCount),
    nextDate: addDays(query.date, dayCount),
    staff: staff.map((s) => ({
      id: s.id,
      displayName: s.displayName,
    })),
    days,
  };
}
