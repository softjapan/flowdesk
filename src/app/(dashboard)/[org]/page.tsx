import { notFound } from "next/navigation";
import { formatTime, formatYmd } from "@/lib/datetime";
import { formatYen } from "@/lib/money";
import { getDashboard } from "@/server/services/dashboard";
import { getOrgContext } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";
import { statusLabels } from "./_components/status-label";

// S-06 ダッシュボード
export default async function DashboardPage({
  params,
}: PageProps<"/[org]">) {
  const { org } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  if (!ctx) notFound();
  const dashboard = await getDashboard(ctx, new Date());
  const { month, trend, today, timezone } = dashboard;
  const maxCount = Math.max(1, ...trend.map((d) => d.count));

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">ダッシュボード</h1>

      <section aria-labelledby="kpi" className="space-y-2">
        <h2 id="kpi" className="font-semibold">
          今月の実績
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded border border-zinc-200 p-4">
            <dt className="text-sm text-zinc-500">予約数</dt>
            <dd className="text-2xl">{month.reservationCount} 件</dd>
          </div>
          <div className="rounded border border-zinc-200 p-4">
            <dt className="text-sm text-zinc-500">顧客数</dt>
            <dd className="text-2xl">{month.customerCount} 人</dd>
          </div>
          {month.revenueYen !== null && (
            <div className="rounded border border-zinc-200 p-4">
              <dt className="text-sm text-zinc-500">売上</dt>
              <dd className="text-2xl">
                {formatYen(month.revenueYen)}
              </dd>
            </div>
          )}
        </dl>
        <p className="text-xs text-zinc-500">
          キャンセルを除く。顧客数は今月に予約がある顧客の人数。
        </p>
      </section>

      <section aria-labelledby="trend" className="space-y-2">
        <h2 id="trend" className="font-semibold">
          予約推移（直近 {trend.length} 日）
        </h2>
        <table className="text-sm">
          <tbody>
            {trend.map((d) => (
              <tr key={d.date}>
                <th
                  scope="row"
                  className="pr-3 text-left font-normal text-zinc-600"
                >
                  {formatYmd(d.date)}
                </th>
                <td className="w-64">
                  <div
                    className="h-3 bg-zinc-400"
                    style={{
                      width: `${(d.count / maxCount) * 100}%`,
                    }}
                  />
                </td>
                <td className="pl-3 text-right">{d.count} 件</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="today" className="space-y-2">
        <h2 id="today" className="font-semibold">
          本日の予約（{formatYmd(dashboard.todayYmd)}）
        </h2>
        {today.length === 0 ? (
          <p className="text-sm text-zinc-500">
            本日の予約はありません。
          </p>
        ) : (
          <table className="text-sm">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="pr-4 font-normal">時間</th>
                <th className="pr-4 font-normal">顧客</th>
                <th className="pr-4 font-normal">メニュー</th>
                <th className="pr-4 font-normal">担当</th>
                <th className="font-normal">状態</th>
              </tr>
            </thead>
            <tbody>
              {today.map((r) => (
                <tr key={r.id}>
                  <td className="pr-4">
                    {formatTime(r.startsAt, timezone)}〜
                    {formatTime(r.endsAt, timezone)}
                  </td>
                  <td className="pr-4">{r.customerName}</td>
                  <td className="pr-4">{r.serviceName}</td>
                  <td className="pr-4">{r.staffName}</td>
                  <td>{statusLabels[r.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
