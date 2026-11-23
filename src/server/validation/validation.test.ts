import { describe, expect, it } from "vitest";
import { customerInputSchema } from "@/server/validation/customer";
import { fieldErrorsOf, formValues } from "@/server/validation/form";
import {
  reservationInputSchema,
  versionSchema,
} from "@/server/validation/reservation";

const validCustomer = {
  name: " 山田 花子 ",
  nameKana: "ヤマダ　ハナコ",
  phone: "090-1234-5678",
  email: "",
  note: "",
};

function customerErrors(input: Record<string, unknown>) {
  const result = customerInputSchema.safeParse(input);
  return result.success ? {} : fieldErrorsOf(result.error);
}

describe("customerInputSchema", () => {
  it("前後の空白を除いて受け付ける", () => {
    expect(customerInputSchema.parse(validCustomer)).toMatchObject({
      name: "山田 花子",
      phone: "090-1234-5678",
    });
  });

  it("氏名とフリガナは必須", () => {
    const errors = customerErrors({
      ...validCustomer,
      name: "  ",
      nameKana: "",
    });
    expect(errors.name).toBe("氏名を入力してください。");
    expect(errors.nameKana).toBe("フリガナを入力してください。");
  });

  it("フリガナは全角カタカナのみ", () => {
    for (const nameKana of ["やまだ", "ﾔﾏﾀﾞ", "Yamada"]) {
      expect(
        customerErrors({ ...validCustomer, nameKana }).nameKana,
      ).toBe("フリガナは全角カタカナで入力してください。");
    }
  });

  it("電話番号とメールはどちらか一方があればよい", () => {
    expect(
      customerInputSchema.safeParse({
        ...validCustomer,
        phone: "",
        email: "hanako@example.com",
      }).success,
    ).toBe(true);
    const errors = customerErrors({
      ...validCustomer,
      phone: "",
      email: " ",
    });
    expect(errors.phone).toMatch(/どちらか/);
    expect(errors.email).toMatch(/どちらか/);
  });

  it("他の項目にエラーがあっても「どちらか一方」を同時に出す", () => {
    const errors = customerErrors({
      ...validCustomer,
      name: "",
      phone: "",
    });
    expect(Object.keys(errors).sort()).toEqual(
      ["email", "name", "phone"].sort(),
    );
  });

  it("電話番号・メールの形式を確かめる", () => {
    expect(
      customerErrors({ ...validCustomer, phone: "abc" }).phone,
    ).toBe("電話番号の形式が正しくありません。");
    expect(
      customerErrors({ ...validCustomer, phone: "090-1" }).phone,
    ).toBe("電話番号の形式が正しくありません。");
    expect(
      customerErrors({ ...validCustomer, email: "not-an-email" })
        .email,
    ).toBe("メールアドレスの形式が正しくありません。");
  });

  it("文字列以外（ファイルなど）は受け付けない", () => {
    expect(
      customerInputSchema.safeParse({
        ...validCustomer,
        name: new Blob(["x"]),
      }).success,
    ).toBe(false);
  });
});

describe("formValues", () => {
  it("指定したキーだけを取り出し、欠けた項目は undefined", () => {
    const form = new FormData();
    form.set("name", "山田");
    form.set("organizationId", "org_c");
    expect(formValues(form, ["name", "phone"] as const)).toEqual({
      name: "山田",
      phone: undefined,
    });
  });
});

const validReservation = {
  customerId: "cus_a_001",
  serviceId: "svc_a1",
  staffProfileId: "stf_a1",
  locationId: "loc_a1",
  date: "2027-02-01",
  time: "10:30",
  status: "confirmed",
};

describe("reservationInputSchema", () => {
  it("正しい入力を受け付ける", () => {
    expect(reservationInputSchema.parse(validReservation)).toEqual(
      validReservation,
    );
  });

  it("存在しない日付・不正な時刻・ID は受け付けない", () => {
    const result = reservationInputSchema.safeParse({
      ...validReservation,
      date: "2027-02-30",
      time: "24:00",
      customerId: "x' OR 1=1",
      staffProfileId: "",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(Object.keys(fieldErrorsOf(result.error)).sort()).toEqual(
      ["customerId", "date", "staffProfileId", "time"].sort(),
    );
  });

  it("キャンセルはフォームの状態としては選べない", () => {
    expect(
      reservationInputSchema.safeParse({
        ...validReservation,
        status: "cancelled",
      }).success,
    ).toBe(false);
  });
});

describe("versionSchema", () => {
  it("1 以上の整数だけを受け付ける", () => {
    expect(versionSchema.parse("3")).toBe(3);
    for (const v of [null, "", "0", "1.5", "abc"]) {
      expect(versionSchema.safeParse(v).success).toBe(false);
    }
  });
});
