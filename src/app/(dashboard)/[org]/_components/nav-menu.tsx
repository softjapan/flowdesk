"use client"; // 現在地の判定に usePathname を使う

import {
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  type LucideIcon,
  MapPin,
  ScrollText,
  Settings,
  Sparkles,
  UserCog,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Role } from "@/server/domain";
import { isActive, navHref, navItemsFor } from "./nav-items";

// アイコン（関数）は Server Component から渡せないので、ここで対応づける
const icons: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  reservations: CalendarDays,
  customers: Users,
  services: Sparkles,
  locations: MapPin,
  members: UserCog,
  billing: CreditCard,
  "audit-logs": ScrollText,
  settings: Settings,
};

export function NavMenu({
  slug,
  role,
}: {
  slug: string;
  role: Role;
}) {
  const pathname = usePathname();
  // モバイルではシートで開くので、移動したら閉じる
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      {navItemsFor(role).map((item) => {
        const Icon = icons[item.key];
        const active = isActive(pathname, slug, item);
        return (
          <SidebarMenuItem key={item.key}>
            <SidebarMenuButton asChild isActive={active}>
              <Link
                href={navHref(slug, item)}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpenMobile(false)}
              >
                {Icon && <Icon aria-hidden="true" />}
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
