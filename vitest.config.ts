import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // tsconfig.json の paths（"@/*" → "./src/*"）に合わせる
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
