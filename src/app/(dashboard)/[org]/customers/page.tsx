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
import { listCustomers } from "@/server/services/customers";
import { getOrgContext } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";

// S-09 顧客一覧（CSV エクスポートは第11章で追加する）
export default async function CustomersPage({
  params,
  searchParams,
}: PageProps<"/[org]/customers">) {
  const { org } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  if (!ctx) notFound();
  const list = await listCustomers(ctx, await searchParams);
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
        {/* 顧客の作成は全ロールに許可（docs/authz-matrix.md） */}
        <Button asChild>
          <Link href={`/${ctx.slug}/customers/new`}>
            <Plus aria-hidden="true" />
            新規登録
          </Link>
        </Button>
      </div>

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
                  {c.name}
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
