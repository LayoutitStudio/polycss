import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // Bound the worker pool: vitest defaults to one worker per CPU core,
    // which on many-core machines costs ~0.5-1 GB RSS per worker and can
    // exhaust RAM when several suites run concurrently (agents, CI matrix).
    maxWorkers: 8,
    environment: "happy-dom",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/index.ts",
        "src/**/*.d.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@layoutit/polycss-core/three": resolve(__dirname, "../core/src/three/index.ts"),
      "@layoutit/polycss-core": resolve(__dirname, "../core/src"),
    },
  },
});
