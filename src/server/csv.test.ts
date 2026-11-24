import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("BOM を付け、CRLF で区切る", () => {
    expect(
      toCsv(["氏名", "メール"], [["山田 花子", "a@example.com"]]),
    ).toBe("﻿氏名,メール\r\n山田 花子,a@example.com\r\n");
  });

  it("カンマ・引用符・改行を含む値は引用符で囲む", () => {
    expect(toCsv(["メモ"], [['a,b "c"\n2 行目']])).toBe(
      '﻿メモ\r\n"a,b ""c""\n2 行目"\r\n',
    );
  });

  it("数式として実行されうる値は先頭に ' を付ける（CSV インジェクション）", () => {
    const csv = toCsv(
      ["値"],
      [['=HYPERLINK("x")'], ["+1"], ["-1"], ["@SUM(A1)"], ["\tx"]],
    );
    expect(csv.split("\r\n").slice(1, -1)).toEqual([
      '"\'=HYPERLINK(""x"")"',
      "'+1",
      "'-1",
      "'@SUM(A1)",
      "'\tx",
    ]);
  });
});
