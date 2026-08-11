import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/**/*.ts"],
  format: ["esm"],
  dts: true,
  bundle: false,
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: true,
  target: "es2022",
  tsconfig: "tsconfig.json",
});
