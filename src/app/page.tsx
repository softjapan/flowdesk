import { redirect } from "next/navigation";
import { Suspense } from "react";
import { findHomeOrgSlug } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";

// ログイン後の既定の行き先。所属する組織のダッシュボードへ送り、
// どの組織にも所属していなければ組織の選択・作成（S-04）へ送る
async function Home(): Promise<never> {
  const slug = await findHomeOrgSlug(await getCurrentUserId());
  redirect(slug ? `/${slug}` : "/orgs");
}

export default function HomePage() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}
