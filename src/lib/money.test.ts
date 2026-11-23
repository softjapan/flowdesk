import { describe, expect, it } from "vitest";
import { formatYen } from "./money";

describe("formatYen", () => {
  it("3 桁区切りの円表記にする", () => {
    expect(formatYen(4400)).toBe("￥4,400");
  });

  it("小数を渡されたら例外にする", () => {
    expect(() => formatYen(4400.5)).toThrow();
  });
});
