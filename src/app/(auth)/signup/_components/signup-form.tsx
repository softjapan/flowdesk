"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { LOGIN_PATH, safeCallbackUrl } from "@/lib/auth-paths";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";
import { AuthField, FormError } from "../../_components/auth-field";

export function SignupForm() {
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
    // 登録するとそのままログインした状態になる（Better Auth の autoSignIn）
    const { error } = await authClient.signUp.email({
      name: String(form.get("name")).trim(),
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) {
      setError(authErrorMessage(error));
      setPending(false);
      return;
    }
    router.replace(callbackUrl);
    router.refresh();
  }

  const loginHref =
    callbackUrl === "/"
      ? LOGIN_PATH
      : `${LOGIN_PATH}?${new URLSearchParams({ callbackUrl })}`;

  return (
    <form
      className="grid gap-4"
      aria-labelledby="form-title"
      onSubmit={onSubmit}
    >
      <FormError message={error} />
      <AuthField
        id="name"
        name="name"
        label="氏名"
        autoComplete="name"
        maxLength={100}
        required
      />
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
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        hint={`${PASSWORD_MIN_LENGTH} 文字以上で入力してください。`}
        required
      />
      <Button type="submit" disabled={pending}>
        {pending ? "登録しています…" : "登録する"}
      </Button>
      <p className="text-center text-sm">
        アカウントをお持ちの場合は{" "}
        <Link
          href={loginHref}
          className="underline underline-offset-4"
        >
          ログイン
        </Link>
      </p>
    </form>
  );
}
