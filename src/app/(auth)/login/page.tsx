import type { Metadata } from "next";
import { AuthCard } from "../_components/auth-card";
import { LoginForm } from "./_components/login-form";

export const metadata: Metadata = { title: "ログイン | FlowDesk" };

// S-01 ログイン
export default function LoginPage() {
  return (
    <AuthCard
      title="ログイン"
      description="メールアドレスとパスワードを入力してください。"
    >
      <LoginForm />
    </AuthCard>
  );
}
