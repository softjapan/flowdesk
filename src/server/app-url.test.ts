import { describe, expect, it } from "vitest";
import { appBaseUrl, appUrl } from "@/server/app-url";

describe("公開 URL（BETTER_AUTH_URL）", () => {
  it("設定した URL のオリジンを使う", () => {
    const env = { BETTER_AUTH_URL: "https://app.example.com/" };
    expect(appBaseUrl(env)).toBe("https://app.example.com");
    expect(appUrl("/invitations/abc", env)).toBe(
      "https://app.example.com/invitations/abc",
    );
  });

  it("本番で未設定なら例外にする（Host ヘッダーから推定させない）", () => {
    expect(() => appBaseUrl({ NODE_ENV: "production" })).toThrow(
      "BETTER_AUTH_URL",
    );
  });

  it("開発・テストで未設定なら localhost:3000", () => {
    expect(appBaseUrl({ NODE_ENV: "development" })).toBe(
      "http://localhost:3000",
    );
    expect(appBaseUrl({})).toBe("http://localhost:3000");
  });

  it("http(s) の URL でなければ例外にする", () => {
    expect(() =>
      appBaseUrl({ BETTER_AUTH_URL: "app.example.com" }),
    ).toThrow();
    expect(() =>
      appBaseUrl({ BETTER_AUTH_URL: "javascript:alert(1)" }),
    ).toThrow();
  });
});
