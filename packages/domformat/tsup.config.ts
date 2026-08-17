import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    browser: "src/browser.ts",
    cli: "src/cli.ts",
    index: "src/index.ts",
    "internal-conformance": "src/internal-conformance.ts",
  },
  format: ["esm"],
  dts: false,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  minify: "terser",
  target: "es2022",
  platform: "neutral",
  external: [/^node:/u],
  tsconfig: "tsconfig.json",
});
