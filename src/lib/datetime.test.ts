import { describe, expect, it } from "vitest";
import {
  addDays,
  formatTime,
  formatYmd,
  isValidYmd,
  startOfNextMonth,
  startOfWeek,
  toZonedYmd,
  zonedToUtc,
} from "./datetime";

describe("datetime", () => {
  it("東京の 0 時は UTC の前日 15 時", () => {
    expect(zonedToUtc("2026-11-23", "Asia/Tokyo").toISOString()).toBe(
      "2026-11-22T15:00:00.000Z",
    );
  });

  it("UTC の日時を東京の日付と時刻で表示する", () => {
    const date = new Date("2026-11-22T15:30:00Z");
    expect(toZonedYmd(date, "Asia/Tokyo")).toBe("2026-11-23");
    expect(formatTime(date, "Asia/Tokyo")).toBe("00:30");
  });

  it("夏時間のあるタイムゾーンでも現地時刻を UTC にできる", () => {
    // 2026-03-08 に米国東部は夏時間（UTC-4）へ切り替わる
    expect(
      zonedToUtc("2026-03-09", "America/New_York", 9).toISOString(),
    ).toBe("2026-03-09T13:00:00.000Z");
  });

  it("日付の計算", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(startOfWeek("2026-11-29")).toBe("2026-11-23");
    expect(startOfNextMonth("2026-12-15")).toBe("2027-01-01");
    expect(formatYmd("2026-11-23")).toBe("11/23(月)");
  });

  it("存在しない日付を不正とみなす", () => {
    expect(isValidYmd("2026-02-29")).toBe(false);
    expect(isValidYmd("2026-2-1")).toBe(false);
    expect(isValidYmd("2028-02-29")).toBe(true);
  });
});
