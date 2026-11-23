/**
 * 日時の補助関数。DB には UTC の Date を保存し、表示や日付の境界は
 * 店舗のタイムゾーン（例："Asia/Tokyo"）で扱う。
 * 「日付」は店舗のタイムゾーンでの "YYYY-MM-DD" 文字列で表す。
 */

const ymdPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(date: Date, timeZone: string) {
  const values: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    if (part.type !== "literal")
      values[part.type] = Number(part.value);
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

/** そのタイムゾーンの UTC からのずれ（ミリ秒） */
function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function isValidYmd(value: string): boolean {
  const m = ymdPattern.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

function parseYmd(ymd: string): [number, number, number] {
  if (!isValidYmd(ymd)) throw new Error(`日付の形式が不正: ${ymd}`);
  const [y, m, d] = ymd.split("-").map(Number);
  return [y ?? 0, m ?? 0, d ?? 0];
}

/** UTC の日時を、タイムゾーンでの日付（YYYY-MM-DD）にする */
export function toZonedYmd(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** タイムゾーンでの日付と時刻を、UTC の Date にする */
export function zonedToUtc(
  ymd: string,
  timeZone: string,
  hour = 0,
  minute = 0,
): Date {
  const [y, m, d] = parseYmd(ymd);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const first = guess - offsetMs(new Date(guess), timeZone);
  // 夏時間の切り替え付近では、求めた時刻でのずれが異なることがある
  const second = guess - offsetMs(new Date(first), timeZone);
  return new Date(second);
}

/** 日付（YYYY-MM-DD）に日数を足す */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = parseYmd(ymd);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** 曜日（0=日曜〜6=土曜） */
export function dayOfWeek(ymd: string): number {
  const [y, m, d] = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** その日を含む週の月曜日 */
export function startOfWeek(ymd: string): string {
  return addDays(ymd, -((dayOfWeek(ymd) + 6) % 7));
}

/** その日を含む月の 1 日 */
export function startOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

/** 翌月の 1 日 */
export function startOfNextMonth(ymd: string): string {
  const [y, m] = parseYmd(ymd);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`;
}

/** 表示用の時刻（例："09:30"） */
export function formatTime(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];

/** 表示用の日付（例："11/23(月)"） */
export function formatYmd(ymd: string): string {
  const [, m, d] = parseYmd(ymd);
  return `${m}/${d}(${weekdayLabels[dayOfWeek(ymd)]})`;
}
