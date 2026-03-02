import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@voxcss-core": resolve(__dirname, "packages/core/src"),
    },
  },
  test: {
    environment: "happy-dom",
    include: [
      "packages/core/src/**/*.test.ts",
      "packages/html/src/**/*.test.ts",
      "packages/html/tests/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**/*.ts", "packages/html/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
    },
  },
});
