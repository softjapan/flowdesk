import Link from "next/link";
import { Suspense } from "react";
import { getOrgContext } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";

const roleLabels = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
} as const;

// params はここで await せず、Suspense の内側で読む
// （レイアウトの外枠を静的なシェルとして先に返すため）
async function OrgNav({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  // 組織が見つからない場合は page 側で 404 にする。ここでは何も出さない
  if (!ctx) return null;
  const base = `/${ctx.slug}`;
  return (
    <>
      <p className="font-semibold">
        {ctx.organizationName}
        <span className="ml-2 text-sm font-normal text-zinc-500">
          {roleLabels[ctx.role]}
        </span>
      </p>
      <ul className="flex gap-4 text-sm">
        <li>
          <Link href={base} className="underline">
            ダッシュボード
          </Link>
        </li>
        <li>
          <Link href={`${base}/reservations`} className="underline">
            予約カレンダー
          </Link>
        </li>
        <li>
          <Link href={`${base}/customers`} className="underline">
            顧客一覧
          </Link>
        </li>
      </ul>
    </>
  );
}

export default function OrgLayout({
  children,
  params,
}: LayoutProps<"/[org]">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 px-6 py-3">
        <nav className="flex flex-wrap items-center justify-between gap-2">
          <Suspense
            fallback={<p className="text-zinc-400">FlowDesk</p>}
          >
            <OrgNav params={params} />
          </Suspense>
        </nav>
      </header>
      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
