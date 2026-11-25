/**
 * E2E テストの共通の値と補助。
 *
 * E2E の DB はテストの実行ごとに 1 回だけシードを入れ、テストは並列に
 * 動く。データを壊し合わないよう、予約は「テストごと・試行ごとに別の日」、
 * 作るメニューは「別の名前」にする（再試行で前の試行の予約と重ならない）。
 */
import { expect, type Page, type TestInfo } from "@playwright/test";
import { addDays, toZonedYmd } from "../src/lib/datetime";
import {
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
} from "../src/server/demo-user";

export const ORG = "demo-salon";

/** シードのユーザー（prisma/seed-data.ts）。パスワードは全員同じ */
export const users = {
  owner: DEMO_USER_EMAIL,
  /** demo-salon の Staff（鈴木、stf_a2） */
  staff: "user-a2@example.com",
} as const;
export const PASSWORD = DEMO_USER_PASSWORD;

export const storageStates = {
  owner: "e2e/.auth/owner.json",
  staff: "e2e/.auth/staff.json",
} as const;

export async function login(
  page: Page,
  email: string,
  password = PASSWORD,
): Promise<void> {
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
}

/**
 * シードの予約（今日の前後 45 日）と重ならない、テストごとの日付
 * （店舗の時刻 Asia/Tokyo の YYYY-MM-DD）。slot はテストごとに変える
 */
export function freeDate(testInfo: TestInfo, slot: number): string {
  const today = toZonedYmd(new Date(), "Asia/Tokyo");
  return addDays(today, 60 + slot + testInfo.retry * 20);
}

/** 試行ごとに変わる短い名前の接尾辞 */
export function uniqueSuffix(testInfo: TestInfo): string {
  return `${testInfo.testId.slice(0, 6)}-${testInfo.retry}-${Date.now().toString(36)}`;
}

/**
 * デモサロンに顧客を画面から登録し、ID を返す。シードの顧客を変えずに
 * 済むよう、削除や表示を試すテストはこれで作った顧客を使う
 */
export async function createCustomer(
  page: Page,
  name: string,
  extra: { note?: string } = {},
): Promise<string> {
  await page.goto(`/${ORG}/customers/new`);
  const form = page.getByRole("form", { name: "顧客の新規登録" });
  await form.getByLabel("氏名").fill(name);
  await form.getByLabel("フリガナ").fill("テスト タロウ");
  await form.getByLabel("メール").fill("e2e-customer@example.com");
  if (extra.note) await form.getByLabel("メモ").fill(extra.note);
  await form.getByRole("button", { name: "登録する" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${ORG}/customers/(?!new)[\\w-]+$`),
  );
  return page.url().split("/").at(-1)!;
}
