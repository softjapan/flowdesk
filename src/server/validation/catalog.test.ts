/** 店舗（F-05）とメニュー（F-06）の入力。フォームの値は文字列で届く */
import { describe, expect, it } from "vitest";
import { fieldErrorsOf, formValues } from "@/server/validation/form";
import {
  LOCATION_FIELDS,
  locationInputSchema,
} from "@/server/validation/location";
import {
  MENU_FIELDS,
  menuInputSchema,
} from "@/server/validation/menu";

function errorsOf(
  schema: typeof menuInputSchema | typeof locationInputSchema,
  input: Record<string, unknown>,
) {
  const result = schema.safeParse(input);
  return result.success ? {} : fieldErrorsOf(result.error);
}

describe("locationInputSchema", () => {
  it("前後の空白を除き、IANA のタイムゾーンを受け付ける", () => {
    expect(
      locationInputSchema.parse({
        name: " 新宿店 ",
        timezone: "America/New_York",
      }),
    ).toEqual({ name: "新宿店", timezone: "America/New_York" });
  });

  it("店舗名は必須で 100 文字まで、知らないタイムゾーンは拒否する", () => {
    expect(
      errorsOf(locationInputSchema, {
        name: " ",
        timezone: "Asia/Nowhere",
      }),
    ).toEqual({
      name: "店舗名を入力してください。",
      timezone: "タイムゾーンが正しくありません。",
    });
    expect(
      errorsOf(locationInputSchema, {
        name: "店".repeat(101),
        timezone: "Asia/Tokyo",
      }),
    ).toEqual({ name: "店舗名は 100 文字以内で入力してください。" });
  });

  it("フォームの項目名は name と timezone", () => {
    expect(LOCATION_FIELDS).toEqual(["name", "timezone"]);
  });
});

describe("menuInputSchema", () => {
  const valid = {
    name: " ヘッドスパ ",
    durationMinutes: "45",
    priceYen: "5,500",
  };

  it("文字列の数字を整数にする（カンマと全角数字も受け付ける）", () => {
    expect(menuInputSchema.parse(valid)).toEqual({
      name: "ヘッドスパ",
      durationMinutes: 45,
      priceYen: 5500,
    });
    expect(
      menuInputSchema.parse({
        ...valid,
        durationMinutes: "３０",
        priceYen: "０",
      }),
    ).toMatchObject({ durationMinutes: 30, priceYen: 0 });
  });

  it("金額は円の整数だけ（小数・負の数・指数表記・上限超えを拒否する）", () => {
    for (const priceYen of [
      "4400.5",
      "-100",
      "1e4",
      "",
      "10000001",
    ]) {
      expect(
        errorsOf(menuInputSchema, { ...valid, priceYen }),
      ).toHaveProperty("priceYen");
    }
  });

  it("所要時間は 5 分単位で 5〜480 分", () => {
    for (const durationMinutes of ["0", "3", "481", "62", "1.5"]) {
      expect(
        errorsOf(menuInputSchema, { ...valid, durationMinutes }),
      ).toEqual({
        durationMinutes:
          "所要時間は 5〜480 分の範囲で、5 分単位で入力してください。",
      });
    }
    expect(
      menuInputSchema.parse({ ...valid, durationMinutes: "480" })
        .durationMinutes,
    ).toBe(480);
  });

  it("メニュー名は必須で 100 文字まで", () => {
    expect(errorsOf(menuInputSchema, { ...valid, name: "" })).toEqual(
      { name: "メニュー名を入力してください。" },
    );
    expect(
      errorsOf(menuInputSchema, { ...valid, name: "あ".repeat(101) }),
    ).toEqual({
      name: "メニュー名は 100 文字以内で入力してください。",
    });
  });

  it("FormData から取り出した値をそのまま検証できる", () => {
    const form = new FormData();
    form.set("name", "カット");
    form.set("durationMinutes", "60");
    form.set("priceYen", "4400");
    expect(
      menuInputSchema.parse(formValues(form, MENU_FIELDS)),
    ).toEqual({
      name: "カット",
      durationMinutes: 60,
      priceYen: 4400,
    });
    // 項目が欠けていれば不正
    expect(
      menuInputSchema.safeParse(
        formValues(new FormData(), MENU_FIELDS),
      ).success,
    ).toBe(false);
  });
});
