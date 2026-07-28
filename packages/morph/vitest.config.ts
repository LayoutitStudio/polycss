import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "happy-dom",
  },
  resolve: {
    alias: {
      "@layoutit/polycss": path.resolve(__dirname, "../polycss/src/index.ts"),
      "@layoutit/polycss-core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
