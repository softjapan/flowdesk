/**
 * CSV の組み立て（F-11）。Excel で開いても文字化けしないよう UTF-8 の BOM を
 * 付け、改行は CRLF にする。
 *
 * 「=」「+」「-」「@」などで始まる値は、表計算ソフトが数式として実行する
 * （CSV インジェクション）。顧客が入力した氏名やメモに含まれうるので、
 * 先頭に「'」を付けて文字列として扱わせる（OWASP の推奨）。
 */

const BOM = "﻿";
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCell(value: string): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe)
    ? `"${safe.replace(/"/g, '""')}"`
    : safe;
}

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  return (
    BOM +
    [header, ...rows]
      .map((row) => row.map(escapeCell).join(","))
      .join("\r\n") +
    "\r\n"
  );
}
