import { Plus } from "lucide-react";
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
import { formatTime, toZonedYmd } from "@/lib/datetime";
import { listCustomerExports } from "@/server/services/customer-exports";
import { listCustomers } from "@/server/services/customers";
import { getOrgContext } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";
import { requestCustomerExportAction } from "./actions";
import { ExportCustomersButton } from "./_components/export-customers-button";

const EXPORT_STATUS_LABELS = {
  pending: "作成中",
  done: "完了",
  failed: "失敗",
} as const;

// S-09 顧客一覧（検索・ページング・CSV エクスポート）
export default async function CustomersPage({
  params,
  searchParams,
}: PageProps<"/[org]/customers">) {
  const { org } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  if (!ctx) notFound();
  const list = await listCustomers(ctx, await searchParams);
  // CSV エクスポートは Owner・Admin のみ（Staff には null が返る）
  const exports = await listCustomerExports(ctx);
  const { q, page } = list.query;

  const pageHref = (p: number) => {
    const search = new URLSearchParams({ page: String(p) });
    if (q) search.set("q", q);
    return `/${ctx.slug}/customers?${search}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">顧客一覧</h1>
        <div className="flex flex-wrap items-start gap-2">
          {exports && (
            <ExportCustomersButton
              action={requestCustomerExportAction.bind(
                null,
                ctx.slug,
              )}
            />
          )}
          {/* 顧客の作成は全ロールに許可（docs/authz-matrix.md） */}
          <Button asChild>
            <Link href={`/${ctx.slug}/customers/new`}>
              <Plus aria-hidden="true" />
              新規登録
            </Link>
          </Button>
        </div>
      </div>

      {exports && exports.length > 0 && (
        <section
          aria-labelledby="exports-title"
          className="space-y-2"
        >
          <h2 id="exports-title" className="text-sm font-medium">
            最近の CSV エクスポート
          </h2>
          <ul className="space-y-1 text-sm">
            {exports.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="tabular-nums">
                  {toZonedYmd(e.createdAt, ctx.timezone)}{" "}
                  {formatTime(e.createdAt, ctx.timezone)}
                </span>
                <span>
                  {EXPORT_STATUS_LABELS[e.status]}
                  {e.rowCount !== null && `（${e.rowCount} 件）`}
                </span>
                {e.downloadPath && (
                  // Route Handler がリダイレクトするので、クライアントの遷移にしない
                  <a
                    href={e.downloadPath}
                    className="underline underline-offset-4"
                  >
                    ダウンロード
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <form role="search" className="flex items-end gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="q">検索</Label>
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="氏名・フリガナ・電話・メール"
            className="w-72"
          />
        </div>
        <Button type="submit" variant="outline">
          検索
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">
        {list.total} 件{q && <>（「{q}」で検索）</>}
      </p>

      {list.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          該当する顧客はいません。
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>氏名</TableHead>
              <TableHead>フリガナ</TableHead>
              <TableHead>電話番号</TableHead>
              <TableHead>メール</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/${ctx.slug}/customers/${c.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell>{c.nameKana}</TableCell>
                <TableCell className="tabular-nums">
                  {c.phone}
                </TableCell>
                <TableCell>{c.email}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {list.pageCount > 1 && (
        <nav aria-label="ページ" className="flex items-center gap-3">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(page - 1)}>前へ</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              前へ
            </Button>
          )}
          <span className="text-sm tabular-nums">
            {page} / {list.pageCount}
          </span>
          {page < list.pageCount ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(page + 1)}>次へ</Link>
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
