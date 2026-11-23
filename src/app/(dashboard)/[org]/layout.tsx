import { Suspense } from "react";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { getOrgContext } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";
import { NavMenu } from "./_components/nav-menu";

const roleLabels = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
} as const;

// params はここで await せず、Suspense の内側で読む
// （レイアウトの外枠を静的なシェルとして先に返すため）
async function OrgHeader({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  // 組織が見つからない場合は page 側で 404 にする。ここでは何も出さない
  if (!ctx) return <p className="px-2 font-semibold">FlowDesk</p>;
  return (
    <div className="px-2">
      <p className="truncate font-semibold">{ctx.organizationName}</p>
      <p className="text-xs text-muted-foreground">
        {roleLabels[ctx.role]}
      </p>
    </div>
  );
}

async function OrgNav({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const ctx = await getOrgContext(org, await getCurrentUserId());
  if (!ctx) return null;
  return <NavMenu slug={ctx.slug} role={ctx.role} />;
}

// SidebarMenuSkeleton は幅を Math.random で決めるため、
// プリレンダーとハイドレーションで値が変わる。固定幅の Skeleton を使う
function NavFallback() {
  return (
    <div className="space-y-2 px-2 py-1" aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-6 w-3/4" />
      ))}
    </div>
  );
}

export default function OrgLayout({
  children,
  params,
}: LayoutProps<"/[org]">) {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <Suspense
            fallback={<p className="px-2 font-semibold">FlowDesk</p>}
          >
            <OrgHeader params={params} />
          </Suspense>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <nav aria-label="メインメニュー">
                <Suspense fallback={<NavFallback />}>
                  <OrgNav params={params} />
                </Suspense>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger aria-label="メニューの開閉" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm text-muted-foreground">
            FlowDesk
          </span>
        </header>
        <div className="flex-1 px-6 py-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
