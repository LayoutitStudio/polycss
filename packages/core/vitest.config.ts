import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Bound the worker pool: vitest defaults to one worker per CPU core,
    // which on many-core machines costs ~0.5-1 GB RSS per worker and can
    // exhaust RAM when several suites run concurrently (agents, CI matrix).
    maxWorkers: 8,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test-d.ts",
        "src/**/index.ts",
        "src/**/*.d.ts",
      ],
      thresholds: {
        // Uniform floor across @layoutit/polycss, -core, -react, -vue.
        // Reflects reality today (core is comfortably above 90 on three
        // metrics; this is the shared minimum). Ratchet up over time.
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
});
