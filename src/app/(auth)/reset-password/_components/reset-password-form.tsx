"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { LOGIN_PATH } from "@/lib/auth-paths";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";
import {
  AuthField,
  FormError,
  FormNotice,
} from "../../_components/auth-field";

const RESET_PASSWORD_PATH = "/reset-password";

/**
 * パスワード再設定は 2 段階。
 * 1. メールアドレスを入れると、再設定のリンクをメールで送る
 * 2. リンク（/api/auth/reset-password/:token）を開くと Better Auth が
 *    トークンを確かめ、この画面に ?token=... を付けて戻す。
 *    無効・期限切れなら ?error=INVALID_TOKEN を付けて戻す
 */
export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  if (token) return <NewPasswordForm token={token} />;
  return (
    <RequestResetForm
      invalidToken={searchParams.get("error") === "INVALID_TOKEN"}
    />
  );
}

function RequestResetForm({
  invalidToken,
}: {
  invalidToken: boolean;
}) {
  const [error, setError] = useState<string | null>(
    invalidToken
      ? authErrorMessage({ code: "INVALID_TOKEN", status: 400 })
      : null,
  );
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({
      email: String(form.get("email")),
      redirectTo: RESET_PASSWORD_PATH,
    });
    setPending(false);
    if (error) {
      setError(authErrorMessage(error));
      return;
    }
    setSent(true);
  }

  return (
    <form
      className="grid gap-4"
      aria-labelledby="form-title"
      onSubmit={onSubmit}
    >
      {/* 登録の有無を漏らさないよう、未登録のアドレスでも同じ文言にする */}
      <FormNotice
        message={
          sent
            ? "入力したアドレスが登録されていれば、再設定のリンクを送りました。メールを確認してください。"
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
      <Button type="submit" disabled={pending}>
        {pending ? "送信しています…" : "再設定のリンクを送る"}
      </Button>
      <p className="text-center text-sm">
        <Link
          href={LOGIN_PATH}
          className="underline-offset-4 hover:underline"
        >
          ログインに戻る
        </Link>
      </p>
    </form>
  );
}

function NewPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("passwordConfirm"))) {
      setError("確認用のパスワードが一致しません。");
      return;
    }
    setPending(true);
    setError(null);
    const { error } = await authClient.resetPassword({
      newPassword,
      token,
    });
    if (error) {
      setError(authErrorMessage(error));
      setPending(false);
      return;
    }
    // 再設定するとすべてのセッションが無効になるので、ログインし直す
    router.replace(`${LOGIN_PATH}?reset=success`);
  }

  return (
    <form
      className="grid gap-4"
      aria-labelledby="form-title"
      onSubmit={onSubmit}
    >
      <FormError message={error} />
      <AuthField
        id="password"
        name="password"
        type="password"
        label="新しいパスワード"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        hint={`${PASSWORD_MIN_LENGTH} 文字以上で入力してください。`}
        required
      />
      <AuthField
        id="passwordConfirm"
        name="passwordConfirm"
        type="password"
        label="新しいパスワード（確認）"
        autoComplete="new-password"
        required
      />
      <Button type="submit" disabled={pending}>
        {pending ? "設定しています…" : "パスワードを設定する"}
      </Button>
    </form>
  );
}
