import Link from "next/link";
import { notFound } from "next/navigation";
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
      <h1 className="text-xl font-semibold">顧客一覧</h1>

      <form role="search" className="flex items-center gap-2 text-sm">
        <label htmlFor="q">検索</label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="氏名・フリガナ・電話・メール"
          className="w-72 rounded border border-zinc-300 px-2 py-1"
        />
        <button
          type="submit"
          className="rounded border border-zinc-300 px-3 py-1"
        >
          検索
        </button>
      </form>

      <p className="text-sm text-zinc-600">
        {list.total} 件{q && <>（「{q}」で検索）</>}
      </p>

      {list.items.length === 0 ? (
        <p className="text-sm text-zinc-500">
          該当する顧客はいません。
        </p>
      ) : (
        <table className="text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="pr-6 font-normal">氏名</th>
              <th className="pr-6 font-normal">フリガナ</th>
              <th className="pr-6 font-normal">電話番号</th>
              <th className="font-normal">メール</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((c) => (
              <tr key={c.id}>
                <td className="pr-6">{c.name}</td>
                <td className="pr-6">{c.nameKana}</td>
                <td className="pr-6">{c.phone}</td>
                <td>{c.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {list.pageCount > 1 && (
        <nav
          aria-label="ページ"
          className="flex items-center gap-3 text-sm"
        >
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="underline">
              前へ
            </Link>
          ) : (
            <span className="text-zinc-400">前へ</span>
          )}
          <span>
            {page} / {list.pageCount}
          </span>
          {page < list.pageCount ? (
            <Link href={pageHref(page + 1)} className="underline">
              次へ
            </Link>
          ) : (
            <span className="text-zinc-400">次へ</span>
          )}
        </nav>
      )}
    </div>
  );
}
