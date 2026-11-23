import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { findHomeOrgSlug } from "@/server/services/org-context";
import { getCurrentUserId } from "@/server/session";

// ログイン後の既定の行き先。所属する組織のダッシュボードへ送る
// （組織の選択・作成の画面 /orgs は第10章で作る）
async function Home() {
  const slug = await findHomeOrgSlug(await getCurrentUserId());
  if (slug) redirect(`/${slug}`);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6">
      <h1 className="text-xl font-semibold">
        所属している組織がありません
      </h1>
      <p className="text-sm text-muted-foreground">
        組織の作成と招待の受諾は、今後の更新で利用できるようになります。
      </p>
      <div>
        <SignOutButton />
      </div>
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}
