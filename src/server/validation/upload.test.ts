import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  matchesMagicBytes,
  presignRequestSchema,
} from "./upload";

const valid = {
  org: "demo-salon",
  customerId: "cus_a_001",
  fileName: "カルテ.pdf",
  contentType: "application/pdf",
  sizeBytes: 1024,
};

describe("presignRequestSchema", () => {
  it("画像と PDF、10MB までを受け付ける", () => {
    expect(presignRequestSchema.safeParse(valid).success).toBe(true);
    for (const contentType of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ]) {
      expect(
        presignRequestSchema.safeParse({ ...valid, contentType })
          .success,
      ).toBe(true);
    }
    expect(
      presignRequestSchema.safeParse({
        ...valid,
        sizeBytes: MAX_UPLOAD_BYTES,
      }).success,
    ).toBe(true);
  });

  it("それ以外の形式は受け付けない（SVG・HTML を含む）", () => {
    for (const contentType of [
      "image/svg+xml",
      "text/html",
      "application/octet-stream",
      "",
    ]) {
      expect(
        presignRequestSchema.safeParse({ ...valid, contentType })
          .success,
      ).toBe(false);
    }
  });

  it("10MB を超える・空・小数のサイズは受け付けない", () => {
    for (const sizeBytes of [MAX_UPLOAD_BYTES + 1, 0, 1.5, "1024"]) {
      expect(
        presignRequestSchema.safeParse({ ...valid, sizeBytes })
          .success,
      ).toBe(false);
    }
  });

  it("不正な ID・ファイル名は受け付けない", () => {
    expect(
      presignRequestSchema.safeParse({ ...valid, customerId: "../x" })
        .success,
    ).toBe(false);
    expect(
      presignRequestSchema.safeParse({ ...valid, fileName: "  " })
        .success,
    ).toBe(false);
    expect(
      presignRequestSchema.safeParse({
        ...valid,
        fileName: "a\r\nb.pdf",
      }).success,
    ).toBe(false);
  });
});

describe("matchesMagicBytes", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  const text = (value: string) => new TextEncoder().encode(value);

  it("中身が申告どおりの形式なら true", () => {
    expect(
      matchesMagicBytes(
        "image/png",
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      ),
    ).toBe(true);
    expect(
      matchesMagicBytes("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)),
    ).toBe(true);
    expect(matchesMagicBytes("image/gif", text("GIF89a"))).toBe(true);
    expect(
      matchesMagicBytes("image/webp", text("RIFF\0\0\0\0WEBPVP8 ")),
    ).toBe(true);
    expect(
      matchesMagicBytes("application/pdf", text("%PDF-1.7")),
    ).toBe(true);
  });

  it("名前だけ変えた SVG・HTML や、別の形式は false", () => {
    expect(matchesMagicBytes("image/png", text("<svg xmlns="))).toBe(
      false,
    );
    expect(matchesMagicBytes("application/pdf", text("<html>"))).toBe(
      false,
    );
    expect(
      matchesMagicBytes("image/jpeg", bytes(0x89, 0x50, 0x4e, 0x47)),
    ).toBe(false);
    expect(matchesMagicBytes("image/png", bytes())).toBe(false);
  });
});
