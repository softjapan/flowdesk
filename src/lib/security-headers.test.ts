import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  cspFromEnv,
  s3Origin,
  staticSecurityHeaders,
} from "@/lib/security-headers";

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name!, values];
    }),
  );
}

describe("Content-Security-Policy", () => {
  const production = directives(
    contentSecurityPolicy({
      isDev: false,
      s3Origin: "https://uploads.s3.ap-northeast-1.amazonaws.com",
      upgradeInsecureRequests: true,
    }),
  );

  it("本番では eval を許さず、埋め込み・<base>・プラグインを止める", () => {
    expect(production.get("script-src")).not.toContain(
      "'unsafe-eval'",
    );
    expect(production.get("object-src")).toEqual(["'none'"]);
    expect(production.get("base-uri")).toEqual(["'self'"]);
    expect(production.get("frame-ancestors")).toEqual(["'none'"]);
    expect(production.has("upgrade-insecure-requests")).toBe(true);
  });

  it("S3 への PUT と画像の表示だけを外部に許す", () => {
    const s3 = "https://uploads.s3.ap-northeast-1.amazonaws.com";
    expect(production.get("connect-src")).toEqual(["'self'", s3]);
    expect(production.get("img-src")).toContain(s3);
    expect(production.get("script-src")).not.toContain(s3);
  });

  it("フォームの送信先は自分と Stripe（Checkout・ポータル）だけ", () => {
    expect(production.get("form-action")).toEqual([
      "'self'",
      "https://checkout.stripe.com",
      "https://billing.stripe.com",
    ]);
  });

  it("開発では eval を許す。http の公開 URL では https に上げない", () => {
    const dev = directives(
      cspFromEnv(
        {
          S3_ENDPOINT: "http://localhost:9000",
          BETTER_AUTH_URL: "http://localhost:3000",
        },
        true,
      ),
    );
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("connect-src")).toEqual([
      "'self'",
      "http://localhost:9000",
    ]);
    expect(dev.has("upgrade-insecure-requests")).toBe(false);
  });
});

describe("S3 のオリジン", () => {
  it("エンドポイントを指定したらそのオリジン（パス形式）", () => {
    expect(
      s3Origin({
        S3_ENDPOINT: "http://localhost:59000/",
        S3_BUCKET: "b",
      }),
    ).toBe("http://localhost:59000");
  });

  it("AWS の S3 は仮想ホスト形式", () => {
    expect(
      s3Origin({
        S3_BUCKET: "flowdesk-uploads",
        AWS_REGION: "us-west-2",
      }),
    ).toBe("https://flowdesk-uploads.s3.us-west-2.amazonaws.com");
  });

  it("バケットもエンドポイントもなければ外部を許さない", () => {
    expect(s3Origin({})).toBeNull();
    expect(
      directives(cspFromEnv({}, false)).get("connect-src"),
    ).toEqual(["'self'"]);
  });
});

describe("固定のヘッダー", () => {
  it("nosniff・Referrer-Policy・X-Frame-Options を付け、HSTS は本番だけ", () => {
    const keys = (p: boolean) =>
      staticSecurityHeaders(p).map((h) => h.key);
    expect(keys(false)).toEqual(
      expect.arrayContaining([
        "X-Content-Type-Options",
        "Referrer-Policy",
        "X-Frame-Options",
      ]),
    );
    expect(keys(false)).not.toContain("Strict-Transport-Security");
    expect(keys(true)).toContain("Strict-Transport-Security");
  });
});
