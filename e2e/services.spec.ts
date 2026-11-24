/**
 * メニュー管理（F-06、S-11）。閲覧は全ロール、作成・編集・削除は
 * Owner・Admin（docs/authz-matrix.md）。
 * 作るメニューは試行ごとに別の名前にする（並列・再試行で重ならない）。
 */
import { expect, test } from "@playwright/test";
import { ORG, storageStates, uniqueSuffix } from "./helpers";

const IN_USE =
  "予約で使われているため削除できません。名前を変えて使い続けてください。";

test("Owner はメニューを追加・編集・削除でき、追加したメニューは予約の選択肢に出る", async ({
  page,
}, testInfo) => {
  const name = `ヘッドスパ ${uniqueSuffix(testInfo)}`;
  await page.goto(`/${ORG}/services`);
  await expect(
    page.getByRole("heading", { name: "メニュー管理" }),
  ).toBeVisible();

  const add = page.getByRole("form", { name: "メニューを追加する" });
  await add.getByLabel("メニュー名").fill(name);
  await add.getByLabel("所要時間").fill("45");
  await add.getByLabel("料金（税込）").fill("5,500");
  await add.getByRole("button", { name: "追加" }).click();
  await expect(add.getByRole("status")).toHaveText(
    `${name}を追加しました。`,
  );
  // 追加できたらフォームは空に戻る
  await expect(add.getByLabel("メニュー名")).toHaveValue("");

  const edit = page.getByRole("form", { name: `${name}の編集` });
  await expect(edit.getByLabel("料金（税込）")).toHaveValue("5500");

  await page.goto(`/${ORG}/reservations/new`);
  await expect(
    page.getByLabel("メニュー", { exact: true }).getByRole("option", {
      name: `${name}（45 分）`,
    }),
  ).toHaveCount(1);

  await page.goto(`/${ORG}/services`);
  await edit.getByLabel("料金（税込）").fill("6000");
  await edit.getByRole("button", { name: "保存" }).click();
  await expect(edit.getByRole("status")).toHaveText("保存しました。");
  await page.reload();
  await expect(edit.getByLabel("料金（税込）")).toHaveValue("6000");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `${name}を削除` }).click();
  await expect(edit).toHaveCount(0);
});

test("入力の誤りと、予約で使われているメニューの削除はエラーを表示する", async ({
  page,
}, testInfo) => {
  const name = `誤入力 ${uniqueSuffix(testInfo)}`;
  await page.goto(`/${ORG}/services`);
  const add = page.getByRole("form", { name: "メニューを追加する" });
  await add.getByLabel("メニュー名").fill(name);
  await add.getByLabel("所要時間").fill("62");
  await add.getByLabel("料金（税込）").fill("12.5");
  await add.getByRole("button", { name: "追加" }).click();
  await expect(add.getByRole("alert")).toContainText(
    "所要時間は 5〜480 分の範囲で、5 分単位で入力してください。",
  );
  await expect(add.getByRole("alert")).toContainText(
    "料金は 0〜10,000,000 円の整数で入力してください。",
  );
  // 入力した値は消えない
  await expect(add.getByLabel("メニュー名")).toHaveValue(name);
  await expect(add.getByLabel("料金（税込）")).toHaveValue("12.5");
  await expect(
    page.getByRole("form", { name: `${name}の編集` }),
  ).toHaveCount(0);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "カットを削除" }).click();
  await expect(page.getByText(IN_USE)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("form", { name: "カットの編集" }),
  ).toBeVisible();
});

test.describe("Staff", () => {
  test.use({ storageState: storageStates.staff });

  test("一覧は見られるが、追加・編集・削除のフォームは出ない", async ({
    page,
  }) => {
    await page.goto(`/${ORG}/services`);
    await expect(
      page.getByRole("cell", { name: "カット" }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "￥4,400" }),
    ).toBeVisible();
    await expect(page.getByRole("form")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /を削除$/ }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("navigation")
        .getByRole("link", { name: "メニュー管理" }),
    ).toHaveCount(0);
  });
});
