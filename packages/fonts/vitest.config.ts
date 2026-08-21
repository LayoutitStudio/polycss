import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Bound the worker pool: vitest defaults to one worker per CPU core,
    // which on many-core machines costs ~0.5-1 GB RSS per worker and can
    // exhaust RAM when several suites run concurrently (agents, CI matrix).
    maxWorkers: 8,
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@layoutit/polycss-core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
