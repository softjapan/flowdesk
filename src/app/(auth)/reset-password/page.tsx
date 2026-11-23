import type { Metadata } from "next";
import { AuthCard } from "../_components/auth-card";
import { ResetPasswordForm } from "./_components/reset-password-form";

export const metadata: Metadata = {
  title: "パスワード再設定 | FlowDesk",
  // URL にトークンが付くので、リンク先へ Referer で送らない
  referrer: "no-referrer",
};

// S-03 パスワード再設定
export default function ResetPasswordPage() {
  return (
    <AuthCard
      title="パスワード再設定"
      description="登録したメールアドレスに、再設定のリンクを送ります。"
    >
      <ResetPasswordForm />
    </AuthCard>
  );
}
