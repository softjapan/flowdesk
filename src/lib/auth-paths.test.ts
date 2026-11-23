import { describe, expect, it } from "vitest";
import {
  loginUrlFor,
  requiresLogin,
  safeCallbackUrl,
} from "./auth-paths";

describe("requiresLogin", () => {
  it.each(["/", "/demo-salon", "/demo-salon/customers", "/loginx"])(
    "%s はログインが必要",
    (path) => {
      expect(requiresLogin(path)).toBe(true);
    },
  );

  it.each([
    "/login",
    "/signup",
    "/reset-password",
    "/api/auth/get-session",
  ])("%s は未ログインで開ける", (path) => {
    expect(requiresLogin(path)).toBe(false);
  });
});

describe("safeCallbackUrl", () => {
  it("サイト内のパスはクエリも含めてそのまま返す", () => {
    expect(safeCallbackUrl("/demo-salon/customers?q=山田")).toBe(
      "/demo-salon/customers?q=%E5%B1%B1%E7%94%B0",
    );
    expect(safeCallbackUrl("/demo-salon")).toBe("/demo-salon");
  });

  it.each([
    undefined,
    null,
    "",
    ["/a", "/b"],
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "/\t/evil.example/",
    "javascript:alert(1)",
    "demo-salon",
  ])("サイトの外や不正な値（%j）は / にする", (value) => {
    expect(safeCallbackUrl(value)).toBe("/");
  });

  it("ログイン画面に戻す指定は / にする（ループを防ぐ）", () => {
    expect(safeCallbackUrl("/login?callbackUrl=/x")).toBe("/");
  });
});

describe("loginUrlFor", () => {
  it("元のパスを callbackUrl に付ける", () => {
    expect(
      loginUrlFor("/demo-salon/reservations?date=2026-11-23"),
    ).toBe(
      "/login?callbackUrl=%2Fdemo-salon%2Freservations%3Fdate%3D2026-11-23",
    );
  });

  it("戻る先がトップなら callbackUrl を付けない", () => {
    expect(loginUrlFor("/")).toBe("/login");
  });
});
