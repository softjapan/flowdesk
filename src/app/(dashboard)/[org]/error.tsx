"use client"; // エラー境界は Client Component にする

import { useEffect } from "react";

export default function OrgError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // 本番では Server Component のエラーの message は伏せられ、digest だけが届く
  const digest =
    error instanceof Error && "digest" in error
      ? String(error.digest)
      : null;

  return (
    <div role="alert" className="space-y-3">
      <h2 className="text-lg font-semibold">
        画面を表示できませんでした
      </h2>
      <p className="text-sm text-muted-foreground">
        時間をおいて再度お試しください。
        {digest && (
          <span className="ml-1 text-muted-foreground">
            （エラー ID: {digest}）
          </span>
        )}
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="rounded border border-input px-3 py-1 text-sm"
      >
        再読み込み
      </button>
    </div>
  );
}
