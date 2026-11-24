/**
 * 顧客の写真・添付ファイル（F-12）。ブラウザが署名付き URL で S3（ローカルは
 * RustFS）に直接 PUT し、完了を Server Action で知らせる。
 * 第11章の回帰：名前だけ .png にした SVG（ブラウザは image/png として送る）が
 * 登録できていた。完了時に S3 のファイルの先頭のバイトで形式を確かめて直した。
 */
import { expect, test } from "@playwright/test";
import { ORG, uniqueSuffix } from "./helpers";

// 1×1 の透明な PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

test("画像をアップロードすると一覧に出る。名前だけ .png の SVG は拒否する", async ({
  page,
}, testInfo) => {
  const suffix = uniqueSuffix(testInfo);
  // 他のテストと重ならない顧客を使う
  await page.goto(`/${ORG}/customers/cus_a_020`);
  const section = page.getByRole("region", {
    name: "写真・添付ファイル",
  });
  const file = page.getByLabel("ファイルを追加");
  const upload = page.getByRole("button", { name: "アップロード" });

  const photo = `photo-${suffix}.png`;
  await file.setInputFiles({
    name: photo,
    mimeType: "image/png",
    buffer: PNG,
  });
  await upload.click();
  await expect(
    section.getByRole("img", { name: photo }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: /\S/ }),
  ).toHaveCount(0);

  const fake = `fake-${suffix}.png`;
  await file.setInputFiles({
    name: fake,
    mimeType: "image/png",
    buffer: SVG,
  });
  await upload.click();
  await expect(
    page.getByText(
      "ファイルのアップロードを確認できませんでした。もう一度アップロードしてください。",
    ),
  ).toBeVisible();
  await page.reload();
  await expect(section.getByText(fake)).toHaveCount(0);
  await expect(
    section.getByRole("img", { name: photo }),
  ).toBeVisible();
});

test("SVG は選んだ時点で拒否する（アップロードを始めない）", async ({
  page,
}) => {
  await page.goto(`/${ORG}/customers/cus_a_021`);
  let presigned = false;
  page.on("request", (r) => {
    if (r.url().includes("/api/uploads/presign")) presigned = true;
  });
  await page.getByLabel("ファイルを追加").setInputFiles({
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: SVG,
  });
  await page.getByRole("button", { name: "アップロード" }).click();
  await expect(
    page.getByText(
      "アップロードできるのは画像（JPEG・PNG・WebP・GIF）と PDF です。",
    ),
  ).toBeVisible();
  expect(presigned).toBe(false);
});
