import { notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTime, formatYmd } from "@/lib/datetime";
import { formatYen } from "@/lib/money";
import { getDashboard } from "@/server/services/dashboard";
import { getOrgContext } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";
import { StatusBadge } from "./_components/status-badge";
import { TrendChart } from "./_components/trend-chart";

function KpiCard({ label, value }: { label: string; value: string }) {
  // dl の中で dt と dd をまとめる div として Card を使う
  return (
    <Card>
      <CardContent className="space-y-1">
        <dt className="text-sm text-muted-foreground">{label}</dt>
        <dd className="text-3xl font-semibold tabular-nums">
          {value}
        </dd>
      </CardContent>
    </Card>
  );
}

// S-06 ダッシュボード
export default async function DashboardPage({
  params,
}: PageProps<"/[org]">) {
  const { org } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  if (!ctx) notFound();
  const dashboard = await getDashboard(ctx, new Date());
  const { month, trend, today, timezone } = dashboard;
  const trendData = trend.map((d) => ({
    ...d,
    label: formatYmd(d.date),
  }));

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">ダッシュボード</h1>

      <section aria-labelledby="kpi" className="space-y-2">
        <h2 id="kpi" className="font-semibold">
          今月の実績
        </h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard
            label="予約数"
            value={`${month.reservationCount} 件`}
          />
          <KpiCard
            label="顧客数"
            value={`${month.customerCount} 人`}
          />
          {/* Staff には Service が売上を返さない（null） */}
          {month.revenueYen !== null && (
            <KpiCard
              label="売上"
              value={formatYen(month.revenueYen)}
            />
          )}
        </dl>
        <p className="text-xs text-muted-foreground">
          キャンセルを除く。顧客数は今月に予約がある顧客の人数。
        </p>
      </section>

      <Card aria-labelledby="trend" role="region">
        <CardHeader>
          <CardTitle>
            <h2 id="trend">予約推移</h2>
          </CardTitle>
          <CardDescription>
            直近 {trend.length} 日の日別予約数（キャンセルを除く）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TrendChart data={trendData} />
          <table className="sr-only">
            <caption>日別の予約数</caption>
            <thead>
              <tr>
                <th scope="col">日付</th>
                <th scope="col">予約数</th>
              </tr>
            </thead>
            <tbody>
              {trendData.map((d) => (
                <tr key={d.date}>
                  <th scope="row">{d.label}</th>
                  <td>{d.count} 件</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <section aria-labelledby="today" className="space-y-2">
        <h2 id="today" className="font-semibold">
          本日の予約（{formatYmd(dashboard.todayYmd)}）
        </h2>
        {today.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            本日の予約はありません。
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>時間</TableHead>
                <TableHead>顧客</TableHead>
                <TableHead>メニュー</TableHead>
                <TableHead>担当</TableHead>
                <TableHead>状態</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {today.map((r) => (
                <TableRow key={r.id}>
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
    </div>
  );
}
