import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Bound the worker pool: vitest defaults to one worker per CPU core,
    // which on many-core machines costs ~0.5-1 GB RSS per worker and can
    // exhaust RAM when several suites run concurrently (agents, CI matrix).
    maxWorkers: 8,
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
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
      "@layoutit/polycss-core/three": path.resolve(__dirname, "../core/src/three/index.ts"),
      "@layoutit/polycss": path.resolve(__dirname, "../polycss/src/index.ts"),
      "@layoutit/polycss/three": path.resolve(__dirname, "../polycss/src/three.ts"),
      "@layoutit/polycss-core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
