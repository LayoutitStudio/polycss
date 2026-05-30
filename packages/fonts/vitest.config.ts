import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@layoutit/polycss-core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
