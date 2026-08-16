import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Bound the worker pool: vitest defaults to one worker per CPU core,
    // which on many-core machines costs ~0.5-1 GB RSS per worker and can
    // exhaust RAM when several suites run concurrently (agents, CI matrix).
    maxWorkers: 8,
    include: ["src/**/*.test.ts"],
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/index.ts",
        "src/**/types.ts",
        "src/testing/**",
      ],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 95,
        lines: 90,
      },
    },
  },
  resolve: {
    alias: {
      "@layoutit/polycss": path.resolve(__dirname, "../polycss/src/index.ts"),
      "@layoutit/polycss-core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
