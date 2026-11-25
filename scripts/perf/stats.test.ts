import { describe, expect, it } from "vitest";
import { percentile } from "./stats";

describe("percentile", () => {
  const values = Array.from({ length: 100 }, (_, i) => 100 - i);

  it("最近傍法で、小さい方から p% の位置の値を返す", () => {
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 100)).toBe(100);
  });

  it("件数が少なくても範囲の外を読まない", () => {
    expect(percentile([3], 95)).toBe(3);
    expect(percentile([1, 2], 0)).toBe(1);
    expect(percentile([], 50)).toBeNaN();
  });
});
