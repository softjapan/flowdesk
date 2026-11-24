import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AUDIT_TARGET_LABELS,
  listAuditLogs,
  type AuditLogQuery,
} from "@/server/services/audit-logs";
import { getOrgContext } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";

const selectClass =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function pageHref(slug: string, query: AuditLogQuery, page: number) {
  const search = new URLSearchParams({ page: String(page) });
  if (query.from) search.set("from", query.from);
  if (query.to) search.set("to", query.to);
  if (query.actorUserId) search.set("actor", query.actorUserId);
  if (query.targetType) search.set("target", query.targetType);
  return `/${slug}/audit-logs?${search}`;
}

// S-15 監査ログ（Owner・Admin）
export default async function AuditLogsPage({
  params,
  searchParams,
}: PageProps<"/[org]/audit-logs">) {
  const { org } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  if (!ctx) notFound();
  const result = await listAuditLogs(ctx, await searchParams);
  if (!result.ok) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">監査ログ</h1>
        <p className="text-sm text-muted-foreground">
          監査ログを閲覧できるのは Owner と Admin です。
        </p>
      </div>
    );
  }
  const list = result.value;
  const { query } = list;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">監査ログ</h1>

      <form
        role="search"
        aria-label="監査ログの絞り込み"
        className="flex flex-wrap items-end gap-3"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="from">開始日</Label>
          <Input
            id="from"
            name="from"
            type="date"
            defaultValue={query.from ?? ""}
            className="w-40"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="to">終了日</Label>
          <Input
            id="to"
            name="to"
            type="date"
            defaultValue={query.to ?? ""}
            className="w-40"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="actor">操作者</Label>
          <select
            id="actor"
            name="actor"
            defaultValue={query.actorUserId ?? ""}
            className={selectClass}
          >
            <option value="">すべて</option>
            {list.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="target">対象</Label>
          <select
            id="target"
            name="target"
            defaultValue={query.targetType ?? ""}
            className={selectClass}
          >
            <option value="">すべて</option>
            {Object.entries(AUDIT_TARGET_LABELS).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </select>
        </div>
        <Button type="submit" variant="outline">
          絞り込む
        </Button>
        <Button asChild variant="ghost">
          <Link href={`/${ctx.slug}/audit-logs`}>条件をクリア</Link>
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">
        {list.total} 件（日時は {ctx.timezone}）
      </p>

      {list.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          該当する記録はありません。
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日時</TableHead>
              <TableHead>操作者</TableHead>
              <TableHead>操作</TableHead>
              <TableHead>対象</TableHead>
              <TableHead>内容</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {item.at}
                </TableCell>
                <TableCell>{item.actorName}</TableCell>
                <TableCell>
                  {item.actionLabel}
                  <span className="block text-xs text-muted-foreground">
                    {item.action}
                  </span>
                </TableCell>
                <TableCell>
                  {item.targetLabel}
                  <span className="block font-mono text-xs text-muted-foreground">
                    {item.targetId}
                  </span>
                </TableCell>
                <TableCell className="whitespace-normal">
                  {item.summary}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {list.pageCount > 1 && (
        <nav aria-label="ページ" className="flex items-center gap-3">
          {query.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(ctx.slug, query, query.page - 1)}>
                前へ
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              前へ
            </Button>
          )}
          <span className="text-sm tabular-nums">
            {query.page} / {list.pageCount}
          </span>
          {query.page < list.pageCount ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(ctx.slug, query, query.page + 1)}>
                次へ
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              次へ
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}
