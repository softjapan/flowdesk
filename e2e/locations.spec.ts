/**
 * 店舗管理（F-05、S-12）。閲覧は全ロール、作成・編集・削除は
 * Owner・Admin。店舗の数は Free プランで 1 つまで（F-15、第12章）。
 * デモサロンは Free で店舗は渋谷店だけ。ほかのテストが使うので変更しない。
 */
import { expect, test } from "@playwright/test";
import { ORG, storageStates } from "./helpers";

test("Free プランでは 2 つ目の店舗を追加できず、上限のエラーを表示する", async ({
  page,
}) => {
  await page.goto(`/${ORG}/locations`);
  await expect(
    page.getByRole("heading", { name: "店舗管理" }),
  ).toBeVisible();
  await expect(
    page.getByText("Free プラン：店舗 1 / 1 件"),
  ).toBeVisible();
  await expect(
    page.getByRole("form", { name: "渋谷店の編集" }),
  ).toBeVisible();

  const add = page.getByRole("form", { name: "店舗を追加する" });
  await add.getByLabel("店舗名").fill("新宿店");
  await expect(add.getByLabel("タイムゾーン")).toHaveValue(
    "Asia/Tokyo",
  );
  await add.getByRole("button", { name: "追加" }).click();
  await expect(add.getByRole("alert")).toContainText(
    "Free プランの上限（スタッフ 2 人・店舗 1 つ）に達しています。",
  );
  await expect(add.getByLabel("店舗名")).toHaveValue("新宿店");
  await expect(
    page.getByRole("heading", { name: "店舗（1 件）" }),
  ).toBeVisible();
});

test("知らないタイムゾーンへの変更と、予約のある店舗の削除はエラーを表示する", async ({
  page,
}) => {
  await page.goto(`/${ORG}/locations`);
  const edit = page.getByRole("form", { name: "渋谷店の編集" });
  await edit.getByLabel("タイムゾーン").fill("Asia/Nowhere");
  await edit.getByRole("button", { name: "保存" }).click();
  await expect(edit.getByRole("alert")).toHaveText(
    "タイムゾーンが正しくありません。",
  );

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "渋谷店を削除" }).click();
  await expect(
    page.getByText("予約で使われているため削除できません。", {
      exact: false,
    }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page
      .getByRole("form", { name: "渋谷店の編集" })
      .getByLabel("タイムゾーン"),
  ).toHaveValue("Asia/Tokyo");
});

test.describe("Staff", () => {
  test.use({ storageState: storageStates.staff });

  test("一覧は見られるが、追加・編集・削除のフォームは出ない", async ({
    page,
  }) => {
    await page.goto(`/${ORG}/locations`);
    await expect(
      page.getByRole("cell", { name: "渋谷店" }),
    ).toBeVisible();
    await expect(page.getByRole("form")).toHaveCount(0);
    await expect(page.getByText(/プラン：店舗/)).toHaveCount(0);
    await expect(
      page
        .getByRole("navigation")
        .getByRole("link", { name: "店舗管理" }),
    ).toHaveCount(0);
  });
});
