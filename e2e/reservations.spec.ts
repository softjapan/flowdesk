/**
 * 予約の作成（F-08）と重複のエラー（F-09）。
 * 第9章の回帰：エラーで戻ったとき、予約フォームの select が最初の選択に
 * 戻っていた（React が送信後にフォームをリセットするため。key で作り直して直した）。
 */
import { expect, test, type Page } from "@playwright/test";
import { freeDate, ORG } from "./helpers";

type Choice = {
  customerId: string;
  serviceId: string;
  staffProfileId: string;
  date: string;
  time: string;
  status: "pending" | "confirmed" | "done";
};

// サイドバーの「メインメニュー」なども部分一致するので、ラベルは完全一致で探す
async function fillReservation(page: Page, c: Choice): Promise<void> {
  await page.goto(`/${ORG}/reservations/new`);
  await page
    .getByLabel("顧客", { exact: true })
    .selectOption(c.customerId);
  await page
    .getByLabel("メニュー", { exact: true })
    .selectOption(c.serviceId);
  await page
    .getByLabel("担当スタッフ")
    .selectOption(c.staffProfileId);
  // 店舗は 1 つだけなので最初から選ばれている
  await expect(page.getByLabel("店舗", { exact: true })).toHaveValue(
    "loc_a1",
  );
  await page.getByLabel("日付", { exact: true }).fill(c.date);
  await page.getByLabel("開始時刻", { exact: true }).fill(c.time);
  await page
    .getByLabel("状態", { exact: true })
    .selectOption(c.status);
  await page.getByRole("button", { name: "予約を作成する" }).click();
}

test("予約を作成すると詳細に移り、選んだ内容で保存されている", async ({
  page,
}, testInfo) => {
  const date = freeDate(testInfo, 1);
  await fillReservation(page, {
    customerId: "cus_a_002",
    serviceId: "svc_a2", // カラー 90 分 8,800 円
    staffProfileId: "stf_a2",
    date,
    time: "13:00",
    status: "confirmed",
  });

  await expect(page).toHaveURL(
    new RegExp(`/${ORG}/reservations/[\\w-]+$`),
  );
  await expect(
    page.getByRole("heading", { name: "予約の詳細" }),
  ).toBeVisible();
  await expect(
    page.getByText("料金 ￥8,800（予約時点）"),
  ).toBeVisible();
  await expect(
    page.getByLabel("メニュー", { exact: true }),
  ).toHaveValue("svc_a2");
  await expect(page.getByLabel("日付", { exact: true })).toHaveValue(
    date,
  );
  await expect(
    page.getByLabel("開始時刻", { exact: true }),
  ).toHaveValue("13:00");
});

test("同じスタッフの時間が重なる予約はエラーになり、選んだ内容がフォームに残る", async ({
  page,
}, testInfo) => {
  const date = freeDate(testInfo, 2);
  // 高橋（stf_a3）の 10:00〜11:00 を先に埋める
  await fillReservation(page, {
    customerId: "cus_a_003",
    serviceId: "svc_a1",
    staffProfileId: "stf_a3",
    date,
    time: "10:00",
    status: "confirmed",
  });
  await expect(page).toHaveURL(
    new RegExp(`/${ORG}/reservations/[\\w-]+$`),
  );

  // 既定値（未選択・確定）とは違う値を選んでから、重なる時刻で送る
  await fillReservation(page, {
    customerId: "cus_a_005",
    serviceId: "svc_a3",
    staffProfileId: "stf_a3",
    date,
    time: "10:30",
    status: "pending",
  });

  await expect(
    page.getByRole("form", { name: "予約の作成" }).getByRole("alert"),
  ).toHaveText(
    "その時間は、担当スタッフの別の予約で埋まっています。",
  );
  await expect(page).toHaveURL(`/${ORG}/reservations/new`);
  // 第9章の回帰：select が最初の選択（「選んでください」・確定）に戻らない
  await expect(page.getByLabel("顧客", { exact: true })).toHaveValue(
    "cus_a_005",
  );
  await expect(
    page.getByLabel("メニュー", { exact: true }),
  ).toHaveValue("svc_a3");
  await expect(
    page.getByLabel("担当スタッフ", { exact: true }),
  ).toHaveValue("stf_a3");
  await expect(page.getByLabel("店舗", { exact: true })).toHaveValue(
    "loc_a1",
  );
  await expect(page.getByLabel("状態", { exact: true })).toHaveValue(
    "pending",
  );
  await expect(page.getByLabel("日付", { exact: true })).toHaveValue(
    date,
  );
  await expect(
    page.getByLabel("開始時刻", { exact: true }),
  ).toHaveValue("10:30");

  // 残った内容のまま時刻だけ直せば作れる
  await page.getByLabel("開始時刻", { exact: true }).fill("11:00");
  await page.getByRole("button", { name: "予約を作成する" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${ORG}/reservations/[\\w-]+$`),
  );
  await expect(page.getByLabel("顧客", { exact: true })).toHaveValue(
    "cus_a_005",
  );
});
