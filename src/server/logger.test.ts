import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildRecord,
  logger,
  redact,
  scrubText,
  serializeError,
  setLogSink,
  withLogContext,
} from "./logger";

describe("scrubText（文字列の中の個人情報・秘密）", () => {
  it.each([
    [
      "postgresql://flowdesk:p4ssw0rd@db.internal:5432/flowdesk", // secret-scan:allow（伏せることのテスト）
      "postgresql://[REDACTED]@db.internal:5432/flowdesk",
    ],
    [
      "宛先 hanako.yamada@example.com に送れない",
      "宛先 [email] に送れない",
    ],
    ["電話 090-1234-5678 と 0312345678", "電話 [phone] と [phone]"],
    [
      "/reset-password?token=abc.def-123&next=/",
      "/reset-password?token=[REDACTED]&next=/",
    ],
    [
      "https://s3/x.csv?X-Amz-Credential=AKIA/2026&X-Amz-Signature=deadbeef",
      "https://s3/x.csv?X-Amz-Credential=[REDACTED]&X-Amz-Signature=[REDACTED]",
    ],
    [
      "key sk_test_51AbCdEf whsec_ZZZ",
      "key [REDACTED_KEY] [REDACTED_KEY]",
    ],
    [
      "Authorization: Bearer eyJhbGciOi.x.y",
      "Authorization: Bearer [REDACTED]",
    ],
  ])("%s", (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it("ID・トレース ID・日時・ポートは変えない", () => {
    const text =
      "job cmwwh71n70001qcvs112ib2cz trace 0af7651916cd43dd8448eb211c80319c 2026-11-05T10:00:00.000Z :5432";
    expect(scrubText(text)).toBe(text);
  });
});

describe("redact（キーで伏せる）", () => {
  it("秘密・個人情報のキーは値を伏せ、ID と件数は残す", () => {
    expect(
      redact({
        jobId: "job_1",
        count: 3,
        email: "a@example.com",
        password: "x",
        BETTER_AUTH_SECRET: "y",
        sessionToken: "z",
        mail: { to: "a@example.com", subject: "件名", text: "本文" },
        headers: { cookie: "s=1", authorization: "Basic x" },
        customerName: "山田 花子",
      }),
    ).toEqual({
      jobId: "job_1",
      count: 3,
      email: "[REDACTED]",
      password: "[REDACTED]",
      BETTER_AUTH_SECRET: "[REDACTED]",
      sessionToken: "[REDACTED]",
      mail: {
        to: "[REDACTED]",
        subject: "[REDACTED]",
        text: "[REDACTED]",
      },
      headers: { cookie: "[REDACTED]", authorization: "[REDACTED]" },
      customerName: "[REDACTED]",
    });
  });

  it("循環しても止まる", () => {
    const a: Record<string, unknown> = { id: "1" };
    a.self = a;
    expect(redact(a)).toEqual({ id: "1", self: "[Circular]" });
  });
});

describe("serializeError", () => {
  it("接続の失敗（AggregateError）は中のエラーとコードも出し、資格情報は伏せる", () => {
    const inner = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:5432"),
      { code: "ECONNREFUSED" },
    );
    const error = new AggregateError([inner], "");
    const out = serializeError(error);
    expect(out.name).toBe("AggregateError");
    expect(out.errors?.[0]).toMatchObject({
      name: "Error",
      code: "ECONNREFUSED",
      message: "connect ECONNREFUSED 127.0.0.1:5432",
    });
  });

  it("メッセージの中のメールアドレスを伏せる", () => {
    expect(
      serializeError(new Error("550 rejected: a@example.com"))
        .message,
    ).toBe("550 rejected: [email]");
  });
});

describe("logger の出力", () => {
  let lines: string[];
  let restore: () => void;
  const env = { ...process.env };

  beforeEach(() => {
    lines = [];
    restore = setLogSink((_level, line) => lines.push(line));
    process.env.LOG_FORMAT = "json";
    process.env.LOG_LEVEL = "info";
  });
  afterEach(() => {
    restore();
    process.env = { ...env };
  });

  it("1 行の JSON に、文脈（jobId）と fields を入れる", () => {
    withLogContext({ jobId: "job_1" }, () => {
      logger.error("ジョブが失敗", {
        attempts: 2,
        err: new Error("boom"),
      });
    });
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "{}");
    expect(record).toMatchObject({
      level: "error",
      msg: "ジョブが失敗",
      jobId: "job_1",
      attempts: 2,
      err: { name: "Error", message: "boom" },
    });
    expect(record.err.stack).toContain("logger.test.ts");
  });

  it("LOG_LEVEL より低いレベルは出さない", () => {
    logger.debug("出ない");
    expect(lines).toHaveLength(0);
  });

  it("スパンがなければ traceId を付けない", () => {
    expect(buildRecord("info", "x")).not.toHaveProperty("traceId");
  });
});
