import { describe, expect, it } from "vitest";
import {
  buildCustomerExportReadyMail,
  buildReservationConfirmedMail,
  buildReservationReminderMail,
  formatReservationDateTime,
} from "./job-mails";

const reservation = {
  to: "cus@example.com",
  customerName: "山田 花子",
  organizationName: "デモサロン",
  locationName: "本店",
  serviceName: "カット",
  staffName: "佐藤",
  // 2026-11-24 10:00 JST
  startsAt: new Date("2026-11-24T01:00:00Z"),
  timeZone: "Asia/Tokyo",
};

describe("formatReservationDateTime", () => {
  it("店舗のタイムゾーンで表示する", () => {
    expect(
      formatReservationDateTime(reservation.startsAt, "Asia/Tokyo"),
    ).toBe("2026年11月24日(火) 10:00");
  });
});

describe("予約のメール", () => {
  it("確定メールに日時・店舗・メニュー・担当を含める", () => {
    const mail = buildReservationConfirmedMail(reservation);
    expect(mail.to).toBe("cus@example.com");
    expect(mail.subject).toBe("【デモサロン】ご予約が確定しました");
    expect(mail.text).toContain("山田 花子 様");
    expect(mail.text).toContain("日時：2026年11月24日(火) 10:00");
    expect(mail.text).toContain("店舗：本店");
    expect(mail.text).toContain("メニュー：カット");
    expect(mail.text).toContain("担当：佐藤");
  });

  it("リマインドは「明日」のお知らせ", () => {
    const mail = buildReservationReminderMail(reservation);
    expect(mail.subject).toContain("明日のご予約");
    expect(mail.text).toContain("日時：2026年11月24日(火) 10:00");
  });
});

describe("buildCustomerExportReadyMail", () => {
  it("件数とダウンロードのリンクを含める", () => {
    const mail = buildCustomerExportReadyMail({
      to: "owner@example.com",
      name: "オーナー",
      organizationName: "デモサロン",
      rowCount: 32,
      url: "http://localhost:3000/api/exports/exp1?org=demo-salon",
    });
    expect(mail.to).toBe("owner@example.com");
    expect(mail.text).toContain("（32 件）");
    expect(mail.text).toContain(
      "http://localhost:3000/api/exports/exp1?org=demo-salon",
    );
  });
});
