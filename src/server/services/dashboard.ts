import {
  addDays,
  startOfMonth,
  startOfNextMonth,
  toZonedYmd,
  zonedToUtc,
} from "@/lib/datetime";
import type { ReservationStatus } from "@/server/domain";
import {
  listServices,
  listStaffProfiles,
} from "@/server/repositories/catalog";
import { listCustomers } from "@/server/repositories/customers";
import { listReservations } from "@/server/repositories/reservations";
import type { OrgContext } from "@/server/services/org-context";

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

/** docs/authz-matrix.md「ダッシュボード／売上の表示」 */
export function canViewRevenue(role: OrgContext["role"]): boolean {
  return role === "owner" || role === "admin";
}

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
  const tomorrow = zonedToUtc(addDays(todayYmd, 1), tz);

  const [monthly, recent, customers, services, staff] =
    await Promise.all([
      listReservations(ctx.organizationId, {
        from: monthFrom,
        to: monthTo,
      }),
      listReservations(ctx.organizationId, {
        from: trendFrom,
        to: tomorrow,
      }),
      listCustomers(ctx.organizationId),
      listServices(ctx.organizationId),
      listStaffProfiles(ctx.organizationId),
    ]);

  const active = monthly.filter((r) => r.status !== "cancelled");
  const revenueYen = canViewRevenue(ctx.role)
    ? active.reduce((sum, r) => sum + r.priceYen, 0)
    : null;

  const counts = new Map<string, number>();
  for (const r of recent) {
    if (r.status === "cancelled") continue;
    const ymd = toZonedYmd(r.startsAt, tz);
    counts.set(ymd, (counts.get(ymd) ?? 0) + 1);
  }
  const trend = Array.from({ length: TREND_DAYS }, (_, i) => {
    const date = addDays(trendFromYmd, i);
    return { date, count: counts.get(date) ?? 0 };
  });

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const todayFrom = zonedToUtc(todayYmd, tz);
  const today = recent
    .filter((r) => r.startsAt.getTime() >= todayFrom.getTime())
    .map((r) => ({
      id: r.id,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      customerName:
        customerById.get(r.customerId)?.name ?? "（不明）",
      serviceName: serviceById.get(r.serviceId)?.name ?? "（不明）",
      staffName:
        staffById.get(r.staffProfileId)?.displayName ?? "（不明）",
      status: r.status,
    }));

  return {
    todayYmd,
    timezone: tz,
    month: {
      reservationCount: active.length,
      customerCount: new Set(active.map((r) => r.customerId)).size,
      revenueYen,
    },
    trend,
    today,
  };
}
