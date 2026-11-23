import Link from "next/link";

// 組織が存在しない場合とメンバーでない場合を区別せずに表示する
export default function OrgNotFound() {
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">
        ページが見つかりません
      </h1>
      <p className="text-sm text-muted-foreground">
        URL
        が正しいか、組織のメンバーとして招待されているかを確認してください。
      </p>
      <Link href="/" className="text-sm underline">
        トップへ戻る
      </Link>
    </div>
  );
}
