import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  /* config options here */
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
