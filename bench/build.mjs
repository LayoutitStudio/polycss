/**
 * Bundle bench renderer paths and helper entries into self-contained browser ESM
 * files that the perf-*.html pages can `import` directly:
 *
 *   bench/.generated/polycss.js
 *                              ← imperative API (createPolyScene + controls
 *                                + loadMesh) used by vanilla bench pages
 *   bench/.generated/polycss-elements.js
 *                              ← side-effect bundle that registers the
 *                                custom elements; used by perf-html.html
 *   bench/.generated/polycss-render-stats.js
 *                              ← shared render stats helper used by perf-shared.mjs
 *   bench/.generated/polycss-react.js
 *                              ← React entry (bench/entries/react.tsx)
 *                                bundled with React + ReactDOM + @layoutit/polycss-react
 *   bench/.generated/polycss-vue.js
 *                              ← Vue entry (bench/entries/vue.ts) bundled
 *                                with Vue 3 + @layoutit/polycss-vue
 *   bench/.generated/polycss-html-mount.js
 *                              ← leaf HTML chunk mount benchmark entry
 *   bench/.generated/polycss-async-scene-mount.js
 *                              ← internal async scene chunk mount benchmark entry
 *   bench/.generated/polycss-sync-scene-add.js
 *                              ← synchronous scene.add renderer benchmark entry
 *   bench/.generated/polycss-atlas-background.js
 *                              ← atlas page background reveal benchmark entry
 *
 * Why not reuse the published dists? The packages keep workspace-peer
 * imports as bare specifiers (e.g. `@layoutit/polycss-core`), which the browser
 * can't resolve. esbuild here re-bundles with `bundle: true` and aliases
 * the workspace packages to their SOURCE — so editing source lands in
 * the bundle without a tsup build pass.
 *
 * Run: `node bench/build.mjs`  (or `pnpm bench:build`).
 */
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const bundleDir = resolve(__dirname, ".generated");

const ALIASES = {
  "@layoutit/polycss-core":     resolve(repoRoot, "packages/core/src/index.ts"),
  "@layoutit/polycss-core/three": resolve(repoRoot, "packages/core/src/three/index.ts"),
  "@layoutit/polycss":           resolve(repoRoot, "packages/polycss/src/index.ts"),
  "@layoutit/polycss/elements":  resolve(repoRoot, "packages/polycss/src/elements/index.ts"),
  "@layoutit/polycss/three":     resolve(repoRoot, "packages/polycss/src/three.ts"),
  "@layoutit/polycss-react":    resolve(repoRoot, "packages/react/src/index.ts"),
  "@layoutit/polycss-vue":      resolve(repoRoot, "packages/vue/src/index.ts"),
  "three":                      resolve(repoRoot, "node_modules/three/build/three.module.js"),
  // Pin React + ReactDOM to the workspace-root copies so the alias-resolved
  // @layoutit/polycss-react source AND the bench entry import the SAME instance.
  // Without this, esbuild treats two `react` imports starting from different
  // tree positions as separate modules → "Cannot read properties of null
  // (reading 'useRef')" because each copy keeps its own internal dispatcher.
  "react":             resolve(repoRoot, "node_modules/react/index.js"),
  "react/jsx-runtime": resolve(repoRoot, "node_modules/react/jsx-runtime.js"),
  "react-dom":         resolve(repoRoot, "node_modules/react-dom/index.js"),
  "react-dom/client":  resolve(repoRoot, "node_modules/react-dom/client.js"),
};

const COMMON = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: false,        // keep readable for debugging
  sourcemap: false,
  alias: ALIASES,
  loader: { ".tsx": "tsx", ".ts": "ts" },
  jsx: "automatic",     // React 17+ classic-vs-automatic; React entry uses automatic
  define: {
    "process.env.NODE_ENV": "\"production\"",
  },
};

const targets = [
  {
    label: "vanilla (createPolyScene + controls + loadMesh)",
    entry: resolve(repoRoot, "packages/polycss/src/index.ts"),
    out: resolve(bundleDir, "polycss.js"),
  },
  {
    label: "elements (side-effect register)",
    entry: resolve(repoRoot, "packages/polycss/src/elements/index.ts"),
    out: resolve(bundleDir, "polycss-elements.js"),
  },
  {
    label: "render stats helper",
    entry: resolve(__dirname, "entries/renderStats.ts"),
    out: resolve(bundleDir, "polycss-render-stats.js"),
  },
  {
    label: "react entry",
    entry: resolve(__dirname, "entries/react.tsx"),
    out: resolve(bundleDir, "polycss-react.js"),
  },
  {
    label: "vue entry",
    entry: resolve(__dirname, "entries/vue.ts"),
    out: resolve(bundleDir, "polycss-vue.js"),
  },
  {
    label: "shadow-parity shared meshes",
    entry: resolve(__dirname, "entries/parityMeshes.ts"),
    out: resolve(bundleDir, "parity-meshes.js"),
  },
  {
    label: "shadow-parity react mount",
    entry: resolve(__dirname, "entries/shadowParityReact.tsx"),
    out: resolve(bundleDir, "shadow-parity-react.js"),
  },
  {
    label: "shadow-parity vue mount",
    entry: resolve(__dirname, "entries/shadowParityVue.ts"),
    out: resolve(bundleDir, "shadow-parity-vue.js"),
  },
  {
    label: "HTML chunk mount bench entry",
    entry: resolve(__dirname, "entries/htmlMount.ts"),
    out: resolve(bundleDir, "polycss-html-mount.js"),
  },
  {
    label: "async scene mount bench entry",
    entry: resolve(__dirname, "entries/asyncSceneMount.ts"),
    out: resolve(bundleDir, "polycss-async-scene-mount.js"),
  },
  {
    label: "sync scene.add bench entry",
    entry: resolve(__dirname, "entries/syncSceneAdd.ts"),
    out: resolve(bundleDir, "polycss-sync-scene-add.js"),
  },
  {
    label: "atlas background bench entry",
    entry: resolve(__dirname, "entries/atlasBackground.ts"),
    out: resolve(bundleDir, "polycss-atlas-background.js"),
  },
  {
    label: "three parity dashboard",
    entry: resolve(__dirname, "entries/threeParityDashboard.ts"),
    out: resolve(bundleDir, "polycss-three-parity-dashboard.js"),
  },
];

const t0 = performance.now();
await mkdir(bundleDir, { recursive: true });
for (const t of targets) {
  process.stdout.write(`[bench/build] bundling ${t.label} … `);
  const start = performance.now();
  await build({ ...COMMON, entryPoints: [t.entry], outfile: t.out });
  console.log(`${(performance.now() - start).toFixed(0)}ms`);
}
console.log(`[bench/build] all bundles ready in ${(performance.now() - t0).toFixed(0)}ms`);
