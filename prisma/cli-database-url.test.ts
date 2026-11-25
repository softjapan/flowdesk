import { describe, expect, it } from "vitest";
import { toPrismaCliUrl } from "./cli-database-url";

const CA = "/etc/ssl/rds/rds-ca-rsa2048-g1.pem";

describe("Prisma の CLI に渡す DATABASE_URL", () => {
  it("verify-full と sslrootcert を、CLI の sslcert と sslaccept=strict に直す", () => {
    const url = new URL(
      toPrismaCliUrl(
        `postgresql://flowdesk:pw@db.example:5432/flowdesk?sslmode=verify-full&sslrootcert=${CA}`, // secret-scan:allow
      ),
    );
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("sslcert")).toBe(CA);
    expect(url.searchParams.get("sslaccept")).toBe("strict");
    expect(url.searchParams.has("sslrootcert")).toBe(false);
    // 接続先・認証は変えない
    expect([
      url.username,
      url.password,
      url.host,
      url.pathname,
    ]).toEqual(["flowdesk", "pw", "db.example:5432", "/flowdesk"]);
  });

  it("CA のない verify-full は止める（検証しないまま流さない）", () => {
    expect(() =>
      toPrismaCliUrl(
        "postgresql://flowdesk@db.example/flowdesk?sslmode=verify-full",
      ),
    ).toThrow(/sslrootcert/);
  });

  it("ローカル（TLS なし）と未設定はそのまま", () => {
    const local =
      "postgresql://flowdesk:flowdesk@localhost:5432/flowdesk"; // secret-scan:allow
    expect(toPrismaCliUrl(local)).toBe(local);
    expect(toPrismaCliUrl("")).toBe("");
  });
});
