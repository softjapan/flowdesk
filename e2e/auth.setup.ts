/**
 * ログイン（F-01、S-01）の E2E。成功したセッションを保存し、ほかの
 * テストはログイン済みの状態から始める（storageState）。
 *
 * Better Auth は本番（next start）で /sign-in を 10 秒に 3 回までに
 * 制限する。ログインはここの 3 回だけにし、順に実行する。
 */
import { expect, test as setup } from "@playwright/test";
import { login, ORG, storageStates, users } from "./helpers";

setup.describe.configure({ mode: "serial" });

setup(
  "パスワードが違うとログインできず、エラーを表示する",
  async ({ page }) => {
    await page.goto("/login");
    await login(page, users.owner, "wrong-password-0000");
    // Next.js のルートの読み上げ（__next-route-announcer__）も alert なので、
    // フォームの中に絞る
    await expect(
      page.getByRole("form", { name: "ログイン" }).getByRole("alert"),
    ).toHaveText(
      "メールアドレスまたはパスワードが正しくありません。",
    );
    await expect(page).toHaveURL(/\/login/);
  },
);

setup(
  "未ログインで開いた画面へ、ログイン後に戻る（Owner）",
  async ({ page }) => {
    await page.goto(`/${ORG}/customers`);
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
    await login(page, users.owner);
    await expect(page).toHaveURL(`/${ORG}/customers`);
    await expect(
      page.getByRole("heading", { name: "顧客一覧" }),
    ).toBeVisible();
    // Owner にはメニュー管理・店舗管理を出す
    const nav = page.getByRole("navigation");
    await expect(
      nav.getByRole("link", { name: "メニュー管理" }),
    ).toBeVisible();
    await expect(
      nav.getByRole("link", { name: "店舗管理" }),
    ).toBeVisible();
    await page.context().storageState({ path: storageStates.owner });
  },
);

setup(
  "Staff はログインするとダッシュボードに移る",
  async ({ page }) => {
    await page.goto("/login");
    await login(page, users.staff);
    await expect(page).toHaveURL(`/${ORG}`);
    await page.context().storageState({ path: storageStates.staff });
  },
);
