/** 認証まわりのメールの文面（送信は src/server/mail.ts） */
import type { Mail } from "@/server/mail";

export function buildResetPasswordMail(input: {
  to: string;
  name: string;
  url: string;
  expiresInMinutes: number;
}): Mail {
  return {
    to: input.to,
    subject: "【FlowDesk】パスワード再設定のご案内",
    text: [
      `${input.name} 様`,
      "",
      "パスワード再設定のリクエストを受け付けました。",
      "次のリンクを開き、新しいパスワードを設定してください。",
      "",
      input.url,
      "",
      `リンクの有効期限は ${input.expiresInMinutes} 分です。`,
      "お心当たりがない場合は、このメールを破棄してください。パスワードは変更されません。",
      "",
      "FlowDesk",
    ].join("\n"),
  };
}
