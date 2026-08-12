import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.mjs"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/install.mjs"],
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 90,
        lines: 85,
      },
    },
  },
});
