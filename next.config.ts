import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  /* config options here */
  // 本番のイメージ（Dockerfile）だけ standalone で出力する。実行に要る
  // ファイルだけを .next/standalone に集めるので、Prisma の CLI などの
  // 開発用の依存がイメージに入らない。E2E（next start）は今のまま
  output:
    process.env.NEXT_OUTPUT === "standalone"
      ? "standalone"
      : undefined,
  cacheComponents: true,
  partialPrefetching: true,
  // フレームワークの名前と版を応答に出さない
  poweredByHeader: false,
  // CSP は S3 のオリジンで変わるので proxy（src/proxy.ts）で付ける
  async headers() {
    return [
      {
        source: "/:path*",
        headers: staticSecurityHeaders(
          process.env.NODE_ENV === "production",
        ),
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
