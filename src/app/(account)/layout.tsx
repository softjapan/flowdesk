import { SignOutButton } from "@/components/sign-out-button";

// ログイン済みで、組織の外で開く画面（S-04 組織の選択・作成、S-05 招待の受諾）
export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-12 items-center border-b px-4">
        <span className="text-sm font-semibold">FlowDesk</span>
        <div className="ml-auto">
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        {children}
      </main>
    </div>
  );
}
