import { describe, expect, it } from "vitest";
import { buildResetPasswordMail } from "./auth-mails";

describe("buildResetPasswordMail", () => {
  it("宛先・再設定のリンク・有効期限を含める", () => {
    const mail = buildResetPasswordMail({
      to: "user-demo@example.com",
      name: "デモ ユーザー",
      url: "http://localhost:3000/api/auth/reset-password/abc?callbackURL=%2Freset-password",
      expiresInMinutes: 60,
    });
    expect(mail.to).toBe("user-demo@example.com");
    expect(mail.subject).toContain("パスワード再設定");
    expect(mail.text).toContain("デモ ユーザー 様");
    expect(mail.text).toContain(
      "http://localhost:3000/api/auth/reset-password/abc?callbackURL=%2Freset-password",
    );
    expect(mail.text).toContain("有効期限は 60 分");
  });
});
