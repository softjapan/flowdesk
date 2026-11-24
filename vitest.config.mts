import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // tsconfig.json の paths（"@/*" → "./src/*"）に合わせる
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // DB を使うテストは npm run test:db（vitest.db.config.mts）、
    // E2E（e2e/）は npm run test:e2e（Playwright）で実行する。
    // npm test と npm run check は DB なしで通るようにする
    exclude: [...configDefaults.exclude, "**/*.db.test.ts", "e2e/**"],
  },
});
