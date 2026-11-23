/**
 * Better Auth の設定とシードの組み合わせのテスト（npm run test:db）。
 * シードのデモユーザーが README の開発用パスワードでログインできることを確かめる。
 */
import { describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth";
import {
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
  DEMO_USER_PASSWORD,
} from "@/server/demo-user";

describe("メールアドレスとパスワードでのログイン", () => {
  it("シードのデモユーザーは開発用パスワードでログインでき、セッションを引ける", async () => {
    const { headers, response } = await getAuth().api.signInEmail({
      body: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
      returnHeaders: true,
    });
    expect(response.user.id).toBe(DEMO_USER_ID);

    // 発行された Cookie を付けて問い合わせると、同じユーザーのセッションになる
    const cookie = (headers.get("set-cookie") ?? "").split(";")[0]!;
    const session = await getAuth().api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session?.user.id).toBe(DEMO_USER_ID);
  });

  it("パスワードが違えばログインできない", async () => {
    await expect(
      getAuth().api.signInEmail({
        body: { email: DEMO_USER_EMAIL, password: "wrong-password" },
      }),
    ).rejects.toMatchObject({
      body: { code: "INVALID_EMAIL_OR_PASSWORD" },
    });
  });

  it("Cookie がなければセッションは null", async () => {
    expect(
      await getAuth().api.getSession({ headers: new Headers() }),
    ).toBeNull();
  });
});
