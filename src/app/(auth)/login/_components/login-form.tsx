"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { safeCallbackUrl } from "@/lib/auth-paths";
import {
  AuthField,
  FormError,
  FormNotice,
} from "../../_components/auth-field";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackUrl(
    searchParams.get("callbackUrl"),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) {
      setError(authErrorMessage(error));
      setPending(false);
      return;
    }
    // ログイン前に開こうとしていたページへ戻る
    router.replace(callbackUrl);
    router.refresh();
  }

  const signupHref =
    callbackUrl === "/"
      ? "/signup"
      : `/signup?${new URLSearchParams({ callbackUrl })}`;

  return (
    <form
      className="grid gap-4"
      aria-labelledby="form-title"
      onSubmit={onSubmit}
    >
      <FormNotice
        message={
          searchParams.get("reset") === "success"
            ? "パスワードを再設定しました。新しいパスワードでログインしてください。"
            : null
        }
      />
      <FormError message={error} />
      <AuthField
        id="email"
        name="email"
        type="email"
        label="メールアドレス"
        autoComplete="email"
        required
      />
      <AuthField
        id="password"
        name="password"
        type="password"
        label="パスワード"
        autoComplete="current-password"
        required
      />
      <Button type="submit" disabled={pending}>
        {pending ? "ログインしています…" : "ログイン"}
      </Button>
      <div className="grid gap-1 text-center text-sm">
        <Link
          href="/reset-password"
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          パスワードを忘れた場合
        </Link>
        <Link
          href={signupHref}
          className="underline-offset-4 hover:underline"
        >
          アカウントを作成する
        </Link>
      </div>
    </form>
  );
}
