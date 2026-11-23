import type { Metadata } from "next";
import { AuthCard } from "../_components/auth-card";
import { SignupForm } from "./_components/signup-form";

export const metadata: Metadata = { title: "新規登録 | FlowDesk" };

// S-02 新規登録
export default function SignupPage() {
  return (
    <AuthCard
      title="新規登録"
      description="FlowDesk のアカウントを作成します。"
    >
      <SignupForm />
    </AuthCard>
  );
}
