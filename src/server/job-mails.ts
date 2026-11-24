/** Worker が送る業務のメールの文面（F-11・F-13）。送信は src/server/mail.ts */
import { dayOfWeek, formatTime, toZonedYmd } from "@/lib/datetime";
import type { Mail } from "@/server/mail";

const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];

/** 店舗のタイムゾーンでの日時（例："2026年11月24日(火) 10:00"） */
export function formatReservationDateTime(
  date: Date,
  timeZone: string,
): string {
  const ymd = toZonedYmd(date, timeZone);
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}年${m}月${d}日(${weekdayLabels[dayOfWeek(ymd)]}) ${formatTime(date, timeZone)}`;
}

export type ReservationMailInput = {
  to: string;
  customerName: string;
  organizationName: string;
  locationName: string;
  serviceName: string;
  staffName: string;
  startsAt: Date;
  timeZone: string;
};

function reservationLines(input: ReservationMailInput): string[] {
  return [
    `日時：${formatReservationDateTime(input.startsAt, input.timeZone)}`,
    `店舗：${input.locationName}`,
    `メニュー：${input.serviceName}`,
    `担当：${input.staffName}`,
  ];
}

export function buildReservationConfirmedMail(
  input: ReservationMailInput,
): Mail {
  return {
    to: input.to,
    subject: `【${input.organizationName}】ご予約が確定しました`,
    text: [
      `${input.customerName} 様`,
      "",
      `${input.organizationName} のご予約が確定しました。`,
      "",
      ...reservationLines(input),
      "",
      "ご変更・キャンセルは店舗までご連絡ください。",
      "",
      input.organizationName,
    ].join("\n"),
  };
}

export function buildReservationReminderMail(
  input: ReservationMailInput,
): Mail {
  return {
    to: input.to,
    subject: `【${input.organizationName}】明日のご予約のお知らせ`,
    text: [
      `${input.customerName} 様`,
      "",
      `明日、${input.organizationName} のご予約があります。`,
      "",
      ...reservationLines(input),
      "",
      "ご来店をお待ちしております。",
      "",
      input.organizationName,
    ].join("\n"),
  };
}

export function buildCustomerExportReadyMail(input: {
  to: string;
  name: string;
  organizationName: string;
  rowCount: number;
  url: string;
}): Mail {
  return {
    to: input.to,
    subject: `【FlowDesk】顧客一覧の CSV ができました（${input.organizationName}）`,
    text: [
      `${input.name} 様`,
      "",
      `「${input.organizationName}」の顧客一覧の CSV（${input.rowCount} 件）ができました。`,
      "次のリンクを開き、ログインしてダウンロードしてください。",
      "",
      input.url,
      "",
      "CSV には顧客の個人情報が含まれます。取り扱いにご注意ください。",
      "",
      "FlowDesk",
    ].join("\n"),
  };
}
