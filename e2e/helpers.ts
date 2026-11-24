/**
 * E2E テストの共通の値と補助。
 *
 * E2E の DB はテストの実行ごとに 1 回だけシードを入れ、テストは並列に
 * 動く。データを壊し合わないよう、予約は「テストごと・試行ごとに別の日」、
 * 作るメニューは「別の名前」にする（再試行で前の試行の予約と重ならない）。
 */
import type { Page, TestInfo } from "@playwright/test";
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
