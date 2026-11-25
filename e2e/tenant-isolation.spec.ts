/**
 * docs/authz-matrix.md のテストケース 1（第14章）。組織 A（デモサロン）の
 * メンバーが、他の組織の顧客 ID を URL・Server Action の引数・Route Handler
 * のパスに入れても 404 になり、データが含まれないこと。
 *
 * シードのデモユーザーは、デモサロン（org_a）の Owner、さくら整体院
 * （org_b）の Staff で、よその相談室（org_c）には所属しない。
 * - 所属する組織の URL に、別の組織の顧客 ID を入れる（cus_b_001）
 * - 所属しない組織の URL に、その組織の顧客 ID を入れる（cus_c_001）
 *
 * 画面は Cache Components によりシェルの送信後に判定するので、HTTP の
 * ステータスは 200 のまま「見つかりません」を表示する。確かめるのは
 * ステータスではなく、HTML（RSC のデータを含む）に相手のデータがないこと。
 * Server Action は画面を通さず、HTTP のリクエストを直接組み立てて呼ぶ。
 */
import { expect, test } from "@playwright/test";
import { createCustomer, ORG, uniqueSuffix } from "./helpers";
import { callServerAction, serverActionId } from "./server-actions";

const OTHER_ORG = "sakura-seitai";
const STRANGER_ORG = "other-office";
/** シードの顧客のメールアドレス（prisma/seed-data.ts の buildCustomers） */
const OTHER_CUSTOMER = {
  id: "cus_b_001",
  email: "cus_b001@example.com",
};
const STRANGER_CUSTOMER = {
  id: "cus_c_001",
  email: "cus_c001@example.com",
};
const STRANGER_ORG_NAME = "よその相談室";

const CUSTOMER_ACTIONS =
  "src/app/(dashboard)/[org]/customers/actions.ts";

test.describe("URL（画面）", () => {
  for (const { label, path, secrets } of [
    {
      label: "所属する組織の URL に、別の組織の顧客 ID",
      path: `/${ORG}/customers/${OTHER_CUSTOMER.id}`,
      secrets: [OTHER_CUSTOMER.email],
    },
    {
      label: "所属しない組織の URL に、その組織の顧客 ID",
      path: `/${STRANGER_ORG}/customers/${STRANGER_CUSTOMER.id}`,
      secrets: [STRANGER_CUSTOMER.email, STRANGER_ORG_NAME],
    },
  ]) {
    test(`${label}は「見つかりません」で、データを含まない`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: "ページが見つかりません" }),
      ).toBeVisible();
      await expect(
        page
          .locator('meta[name="robots"][content*="noindex"]')
          .first(),
      ).toBeAttached();

      // 表示された DOM だけでなく、送られてきた HTML（RSC のデータを含む）も見る
      const html = await (await page.request.get(path)).text();
      for (const secret of secrets) {
        expect(html).not.toContain(secret);
        await expect(page.getByText(secret)).toHaveCount(0);
      }
    });
  }

  test("対照：自分の組織の顧客は表示される（同じ確かめ方でデータが見える）", async ({
    page,
  }) => {
    const path = `/${OTHER_ORG}/customers/${OTHER_CUSTOMER.id}`;
    await page.goto(path);
    await expect(page.getByLabel("メール")).toHaveValue(
      OTHER_CUSTOMER.email,
    );
    expect(await (await page.request.get(path)).text()).toContain(
      OTHER_CUSTOMER.email,
    );
  });
});

test.describe("Server Action の引数", () => {
  test("別の組織の顧客 ID で削除を呼ぶと 404 で、相手の顧客は消えない", async ({
    page,
    baseURL,
  }) => {
    const actionId = serverActionId(
      CUSTOMER_ACTIONS,
      "deleteCustomerAction",
    );
    for (const args of [
      [ORG, OTHER_CUSTOMER.id],
      [STRANGER_ORG, STRANGER_CUSTOMER.id],
      // 所属しない組織のスラッグに、自分の組織の顧客 ID を入れる
      [STRANGER_ORG, "cus_a_030"],
    ]) {
      const response = await callServerAction(page.request, {
        path: `/${ORG}/customers`,
        actionId,
        args,
        baseURL: baseURL!,
      });
      expect(response.status(), args.join(" ")).toBe(404);
      const body = await response.text();
      expect(body).not.toContain(OTHER_CUSTOMER.email);
      expect(body).not.toContain(STRANGER_CUSTOMER.email);
    }

    // さくら整体院（Staff として所属）の画面で、顧客が残っていることを確かめる
    await page.goto(`/${OTHER_ORG}/customers/${OTHER_CUSTOMER.id}`);
    await expect(page.getByLabel("メール")).toHaveValue(
      OTHER_CUSTOMER.email,
    );
    await page.goto(`/${ORG}/customers/cus_a_030`);
    await expect(
      page.getByRole("heading", { name: /さんの情報$/ }),
    ).toBeVisible();
  });

  test("対照：同じ組み立て方で自分の組織の顧客は削除できる", async ({
    page,
    baseURL,
  }, testInfo) => {
    const id = await createCustomer(
      page,
      `直接削除 ${uniqueSuffix(testInfo)}`,
    );
    const response = await callServerAction(page.request, {
      path: `/${ORG}/customers/${id}`,
      actionId: serverActionId(
        CUSTOMER_ACTIONS,
        "deleteCustomerAction",
      ),
      args: [ORG, id],
      baseURL: baseURL!,
    });
    // 成功すると一覧へのリダイレクト（RSC の応答の中で指示する）
    expect(response.status()).toBeLessThan(400);
    await page.goto(`/${ORG}/customers/${id}`);
    await expect(
      page.getByRole("heading", { name: "ページが見つかりません" }),
    ).toBeVisible();
  });
});

test.describe("Route Handler のパス・本文", () => {
  const presign = (org: string, customerId: string) => ({
    org,
    customerId,
    fileName: "photo.png",
    contentType: "image/png",
    sizeBytes: 68,
  });

  test("添付ファイルの署名付き URL：他の組織の顧客は 404", async ({
    page,
  }) => {
    for (const body of [
      presign(ORG, OTHER_CUSTOMER.id),
      presign(STRANGER_ORG, STRANGER_CUSTOMER.id),
    ]) {
      const response = await page.request.post(
        "/api/uploads/presign",
        {
          data: body,
        },
      );
      expect(response.status(), JSON.stringify(body)).toBe(404);
      expect(await response.json()).toEqual({
        error: "見つかりません",
      });
    }
    // 対照：自分の組織の顧客なら発行できる
    const own = await page.request.post("/api/uploads/presign", {
      data: presign(ORG, "cus_a_030"),
    });
    expect(own.status()).toBe(200);
  });

  test("CSV のダウンロード：所属しない組織・存在しないエクスポートは 404", async ({
    page,
  }) => {
    for (const path of [
      `/api/exports/exp_unknown?org=${STRANGER_ORG}`,
      `/api/exports/exp_unknown?org=${ORG}`,
    ]) {
      const response = await page.request.get(path, {
        maxRedirects: 0,
      });
      expect(response.status(), path).toBe(404);
      expect(await response.json()).toEqual({
        error: "見つかりません",
      });
    }
  });
});
