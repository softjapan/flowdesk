const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
});

/** 円の整数を表示用の文字列にする（例：4400 → "￥4,400"） */
export function formatYen(amount: number): string {
  if (!Number.isInteger(amount)) {
    throw new Error(`金額は円の整数で扱う: ${amount}`);
  }
  return yen.format(amount);
}
