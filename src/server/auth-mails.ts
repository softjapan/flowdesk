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

export function buildInvitationMail(input: {
  to: string;
  organizationName: string;
  inviterName: string;
  roleLabel: string;
  url: string;
  expiresInHours: number;
}): Mail {
  return {
    to: input.to,
    subject: `【FlowDesk】${input.organizationName} への招待`,
    text: [
      `${input.inviterName} さんから、FlowDesk の「${input.organizationName}」に ${input.roleLabel} として招待されました。`,
      "",
      "次のリンクを開き、このメールアドレスのアカウントでログイン（またはアカウントを作成）して、招待を受けてください。",
      "",
      input.url,
      "",
      `リンクの有効期限は ${input.expiresInHours} 時間です。`,
      "お心当たりがない場合は、このメールを破棄してください。",
      "",
      "FlowDesk",
    ].join("\n"),
  };
}
