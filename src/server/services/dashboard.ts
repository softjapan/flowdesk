import {
  addDays,
  startOfMonth,
  startOfNextMonth,
  toZonedYmd,
  zonedToUtc,
} from "@/lib/datetime";
import type { ReservationStatus } from "@/server/domain";
import {
  countReservationsByDay,
  listReservationsWithNames,
  summarizeReservations,
} from "@/server/repositories/reservations";
import { canViewRevenue } from "@/server/services/authz";
import type { OrgContext } from "@/server/services/org-context";
import { toReservationListItem } from "@/server/services/reservations";

export const TREND_DAYS = 14;

export type TodayReservation = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  serviceName: string;
  staffName: string;
  status: ReservationStatus;
};

export type Dashboard = {
  todayYmd: string;
  timezone: string;
  month: {
    /** キャンセルを除いた今月の予約数 */
    reservationCount: number;
    /** 今月に予約がある顧客数（重複なし、キャンセルを除く） */
    customerCount: number;
    /** キャンセルを除いた今月の売上。Staff には返さない */
    revenueYen: number | null;
  };
  /** 直近 14 日（今日を含む）の日別予約数。キャンセルを除く */
  trend: { date: string; count: number }[];
  today: TodayReservation[];
};

export async function getDashboard(
  ctx: OrgContext,
  now: Date,
): Promise<Dashboard> {
  const tz = ctx.timezone;
  const todayYmd = toZonedYmd(now, tz);
  const monthFrom = zonedToUtc(startOfMonth(todayYmd), tz);
  const monthTo = zonedToUtc(startOfNextMonth(todayYmd), tz);
  const trendFromYmd = addDays(todayYmd, -(TREND_DAYS - 1));
  const trendFrom = zonedToUtc(trendFromYmd, tz);
  const todayFrom = zonedToUtc(todayYmd, tz);
  const tomorrow = zonedToUtc(addDays(todayYmd, 1), tz);

  // 件数・売上・日別の件数は DB で集計し、行を読むのは本日の予約だけにする
  const [month, counts, today] = await Promise.all([
    summarizeReservations(ctx.organizationId, {
      from: monthFrom,
      to: monthTo,
    }),
    countReservationsByDay(
      ctx.organizationId,
      { from: trendFrom, to: tomorrow },
      tz,
    ),
    listReservationsWithNames(ctx.organizationId, {
      from: todayFrom,
      to: tomorrow,
    }),
  ]);

  const trend = Array.from({ length: TREND_DAYS }, (_, i) => {
    const date = addDays(trendFromYmd, i);
    return { date, count: counts.get(date) ?? 0 };
  });

  return {
    todayYmd,
    timezone: tz,
    month: {
      reservationCount: month.reservationCount,
      customerCount: month.customerCount,
      revenueYen: canViewRevenue(ctx.role) ? month.revenueYen : null,
    },
    trend,
    today: today.map(toReservationListItem),
  };
}
