# polycss perf bench

A self-contained perf harness that measures polycss across its four
rendering paths — declarative HTML custom elements, the vanilla
imperative API, React, and Vue. Runs headless via Playwright for
automated A/B/C/D comparisons; serves the same pages via a static
server for human inspection in any browser.

This directory is **not a published surface**. It exists for monorepo
contributors to verify perf claims and catch render regressions.

---

## Quick start

```sh
pnpm bench:serve            # static server on :4400 with an index page
pnpm bench:perf             # build bundles + run all 4 renderers × 5 scenarios
pnpm bench:animated-human   # build bundles + run the animated human run bench
pnpm bench:trace            # build bundles + run the trace analysis bucket profiler
pnpm bench:lossy            # compare lossless / current lossy counts
pnpm bench:lossy:corpus     # scan gallery GLB/OBJ lossy counts + crack diagnostics
pnpm bench:visual           # screenshot diff against bench/baselines/*.png
pnpm bench:visual --record  # capture new baselines (after intentional renderer changes)
pnpm bench:build            # just rebuild the bench bundles (rarely needed alone)
node bench/nonvoxel-rotation-bench.mjs  # non-voxel vanilla rotation probe
node .agents/skills/chrome-capture-trace/scripts/trace.mjs drag --label teapot-drag  # pointer-drag trace, no auto-rotate
node .agents/skills/chrome-capture-trace/scripts/trace.mjs motion --page nonvoxel --no-trace  # non-voxel rAF cadence buckets
node bench/nonvoxel-visual-compare.mjs  # non-voxel variant visual parity
```

All scripts also work directly:

```sh
node bench/perf-bench.mjs --mesh saucer --label run1
node bench/perf-bench.mjs --mesh chicken --renderer react,vue
node bench/animated-human-bench.mjs --mode baked,dynamic --label human-run
node bench/animated-human-bench.mjs --compare-stable-dom --trace
node bench/animated-human-bench.mjs --mesh poly-pizza/animated-robot.glb --clip run --animation-driver progressive-style-cache
node bench/lossy-optimizer-bench.mjs --json bench/results/lossy-optimizer.json
node bench/lossy-optimizer-bench.mjs --models ducky,shark,bicycle
node bench/lossy-corpus-bench.mjs --root /tmp/polycss-model-corpus --json /tmp/polycss-temp-corpus.json
node bench/lossy-corpus-bench.mjs --from-json bench/results/lossy-corpus.json --opportunities
node .agents/skills/chrome-capture-trace/scripts/trace.mjs motion --mesh garden --runs 3 --dom-samples --report --markdown-out bench/results/garden-trace.md
node bench/perf-visual.mjs --mesh chicken --tolerance 0.005
node bench/nonvoxel-rotation-bench.mjs --models teapot,bicycle --variants baseline,order-tile4 --run-order round-robin
node .agents/skills/chrome-capture-trace/scripts/trace.mjs drag --mesh teapot --degrees 360 --drag-ms 1500 --label teapot-drag --frame-details --no-print-json
node .agents/skills/chrome-capture-trace/scripts/trace.mjs motion --page nonvoxel --mesh glb:Elephant.glb --variant baseline --no-trace
node bench/nonvoxel-visual-compare.mjs --models bicycle,elephant,policecar --variants scene-split-target,scene-transform-perspective
```

---

## What it measures

Five scenarios per renderer, on whichever mesh you pass via `--mesh`:

| Scenario              | What it isolates                                              |
| --------------------- | ------------------------------------------------------------- |
| `dynamic.static`      | Idle-frame floor under dynamic CSS lighting (no animation).   |
| `dynamic.light_rotate`| Cost of light-direction changes per frame (cascade re-resolution). |
| `dynamic.camera_rotate`| Cost of camera transform changes per frame (compositor cost). |
| `baked.static`        | Idle-frame floor under baked lighting.                        |
| `baked.camera_rotate` | Cost of camera transform on baked, no light-side recompute.   |

`baked + light` is intentionally excluded — the atlas re-rasterizes every
frame, which is a known disaster, not a meaningful measurement.

For each scenario, the FPS sampler captures per-frame `dt` for 5 seconds
after a 2-second warmup, then computes p50, p95, p99 frame times.
Sampling lives in `perf-shared.mjs` so every page records identically.

## Browser backend

Headless Playwright can run the same DOM through different compositor
backends. Perf-facing bench scripts default to the GPU lane by adding
`--use-angle=metal` on macOS and `--enable-gpu-rasterization` for Chromium.
The bundled browser can otherwise fall back to `SoftwareRenderer`, which is
useful as a stress lane but can understate real Chrome GPU performance.

Default GPU-path check:

```sh
node bench/perf-bench.mjs --mesh obj-house3 --renderer vanilla --scenario baked.camera_rotate
```

Run the old software/stress lane explicitly:

```sh
node bench/perf-bench.mjs --mesh obj-house3 --renderer vanilla --scenario baked.camera_rotate --software-backend
```

---

## The four pages

Every page mounts the same scene with the same mesh and the same
animation, but goes through a **different render path**. Per-frame state
changes use each path's natural mechanism so we measure what real users
would actually pay.

| Page                  | Render path                            | Per-frame state update            |
| --------------------- | -------------------------------------- | --------------------------------- |
| `perf-html.html`      | Declarative `<poly-scene>` + `<poly-mesh>` + `<poly-controls>` custom elements | `sceneEl.setAttribute(...)` — exercises the custom-element attribute observer + reflection pipeline |
| `perf-vanilla.html`   | Imperative `createPolyCamera` + `createPolyScene` + `createPolyOrbitControls` + `loadMesh` | `camera.update({...})` for camera motion, `scene.setOptions({...})` for light changes |
| `perf-react.html`     | `<PolyCamera><PolyScene><PolyOrbitControls>` JSX (React 19) | `useState` setter — full React reconciliation each frame |
| `perf-vue.html`       | `<PolyCamera><PolyScene><PolyOrbitControls>` Vue 3 (`defineComponent` + render funcs) | `ref().value = ...` — Vue's reactivity flush each frame |

What this matrix tells us, in practice:

- **html vs vanilla** — overhead of the custom-element wrapper (attribute
  parsing, MutationObserver, upgrade lifecycle).
- **vanilla vs react** — React reconciliation cost on top of polycss.
- **vanilla vs vue** — Vue reactivity cost on top of polycss.
- **react vs vue** — head-to-head framework comparison on identical work.

Each page is a self-contained HTML file; framework-specific entry code
lives in `bench/entries/react.tsx` and `bench/entries/vue.ts` (compiled
into the bundles by `build.mjs`).

---

## URL params

The pages share a URL contract via `parseUrlParams()` in `perf-shared.mjs`:

```
/perf-{html|vanilla|react|vue}.html
  ?mesh=<id>      saucer|chicken|coliseum|castle|teapot|rock1|synth-Nk|glb:path|obj:path|vox:path
  &mode=<m>       dynamic|baked    (textureLighting)
  &motion=<m>     light|rot|none   (light direction | camera rotY | idle)
  &az=<deg>       initial light azimuth (default 50)
  &el=<deg>       initial light elevation (default 45)
```

Mesh presets live in `perf-shared.mjs`'s `PRESETS` table. To add a
preset, follow the existing shape — `url`, `mtlUrl?`, `options`,
`zoom`, `rotX`, `rotY`. Synthetic meshes (`synth-10k`, `synth-30k`,
`synth-50k`) are generated in-browser by `synth-mesh.mjs` for stress
tests above what the gallery's OBJs cover.

`nonvoxel-vanilla.html` also accepts bench-only experiment params:
`domOrder=source|initial-depth|tile4-screen|area-desc|area-asc|normal-z`,
`polygonOrder=source|initial-depth|tile4-screen|area-desc|area-asc|normal-z`,
`disableStrategies=b,i,u`, `leafBucketSize=64|128|256`,
`rotationDriver=css-keyframes`, and
`sceneTransformMode=default|matrix3d|split-target|host-perspective|transform-perspective|no-will-change`.
Use `domOrder` for pure post-render DOM-order probes; `polygonOrder` changes
the polygon array before render planning and is only for diagnostics.

`.agents/skills/chrome-capture-trace/scripts/trace.mjs motion` is the
steady-motion trace lane for perf and non-voxel pages. It aligns Chrome trace
events to rAF samples and reports per-cadence-bucket compositor, style, raster,
script, DOM, and tag-count costs.

`.agents/skills/chrome-capture-trace/scripts/trace.mjs drag` is the focused
user-input lane for the same page.
It loads a non-voxel mesh (`teapot` by default), leaves OrbitControls
auto-rotate off, performs real Playwright mouse drags until the requested
camera yaw delta is reached, and writes `bench/results/<label>.trace.json`
plus `bench/results/<label>.json`. A 360 degree run uses clutched drags inside
the viewport because OrbitControls maps 4 pointer pixels to 1 degree of yaw.
Pass `--variant <id>` to reuse the non-voxel variant params from the rotation
bench, or `--trace-out <path>` / `--json <path>` for explicit outputs.
`--frame-details` aligns page-side frame work with Chrome trace events, adding
per-frame `rotationFrames` / `slowestFrames` breakdowns; use
`--frame-details-limit <n>` to keep every rotation frame and `--no-print-json`
when the full result is too large for terminal output.

`animated-human.html` is the focused animated-model page. It loads
`/gallery/glb/poly-pizza/animated-human.glb` by default, chooses the run-like
clip when available, and drives `createPolyAnimationMixer.update(dt)` into
`PolyMeshHandle.setPolygons(..., { merge:false, stableDom:true })`. The
Playwright runner accepts `--mode baked,dynamic`, `--clip <name|index|run>`,
`--target-size <n>`, `--compare-stable-dom`,
`--stable-triangle-color-steps <n>`,
`--stable-triangle-color-policy cadence|adaptive`,
`--stable-triangle-color-freeze-frames <n>`,
`--stable-triangle-color-budget <ratio|count>`,
`--stable-triangle-color-max-age <n>`,
`--stable-triangle-color-max-step <channel-delta>`,
`--animation-driver js|progressive-style-cache|js-style-cache|typed-om-style-cache|css-keyframes`,
`--compare-stable-triangle-debug`, `--require-solid-triangles`, `--trace`, and
the same GPU lane flags as the other browser benches. The default baked color
path uses 8-channel quantized colors, staggers leaf color writes over a
12-frame cadence, and caps the per-write RGB channel delta so updates drift
toward the next baked color instead of jumping directly to it. `css-keyframes`
is a bench-only prototype that samples the clip into
per-leaf CSS animations, removing per-frame JS playback from the measurement
window. The solid-triangle guard fails the run if the page leaves the baked
`<u>` path. Use `--stable-triangle-color-freeze-frames 0` to keep the initial
baked colors and skip color writes during animation. The stable-triangle debug
comparison is diagnostic: it splits normal updates, transform-only writes, and
plan-only updates to attribute animation bottlenecks.

---

## Files

```
bench/
  notes/
    BENCH.md            ← you are here
    PERF_INVESTIGATION.md
    results/            (gitignored) local Markdown run summaries

  perf-shared.mjs        PRESETS, dirFromAzEl, parseUrlParams,
                         createPerfRecorder() (FPS counter + window.__perf__)
  perf-html.html         declarative <poly-scene> + <poly-controls>
  perf-vanilla.html      imperative createPolyScene + createPolyOrbitControls
  nonvoxel-vanilla.html  dedicated vanilla page for non-voxel experiments
                         with strategy/order/transform diagnostics
  nonvoxel-variants.mjs  shared non-voxel bench variant table used by
                         rotation, skill drag, trace, and visual runners
  perf-react.html        loads .generated/polycss-react.js (JSX entry)
  perf-vue.html          loads .generated/polycss-vue.js (Vue entry)
  animated-human.html    vanilla animated GLB page for the human run sequence
  entries/
    react.tsx            React 19 entry: useState-driven per-frame updates
    vue.ts               Vue 3 entry: ref() + render funcs (no SFC compiler)
  synth-mesh.mjs         UV-sphere generator (synth-10k/30k/50k presets)

  build.mjs              esbuild driver: emits ignored bundles under
                         bench/.generated/ (vanilla, elements,
                         render-stats, react, vue). React/ReactDOM
                         aliased to workspace-root copies so esbuild
                         de-dupes a single instance.
  perf-bench.mjs         Playwright runner. Fresh chromium per scenario,
                         ephemeral port, structured JSON output.
  animated-human-bench.mjs
                         GPU-default Playwright runner for the animated
                         human run sequence. Reports FPS, mixer/update cost,
                         setPolygons cost, render stats, and optional trace.
  lossy-optimizer-bench.mjs
                         Polygon-count strategy bench for lossless and
                         current library-default lossy.
  perf-serve.mjs         Static :4400 server with an index page that
                         links the four perf-*.html with example params.
  perf-visual.mjs        Screenshot diff guardrail (chicken + rock1 ×
                         3 light azimuths, vanilla path only).
  nonvoxel-rotation-bench.mjs
                         Vanilla-only non-voxel rotation corpus runner.
                         See bench/notes/PERF_INVESTIGATION.md.
  nonvoxel-visual-compare.mjs
                         Static screenshot parity check for non-voxel bench
                         variants against the baked baseline.

  baselines/             chicken-* / rock1-* PNGs the visual diff compares against.
  results/               (gitignored) per-run JSON output from bench scripts.

  .generated/            (gitignored) browser ESM bundles output by build.mjs:
                         polycss.js, polycss-elements.js,
                         polycss-render-stats.js, polycss-react.js,
                         polycss-vue.js.
```

## Lossy Optimizer Bench

`lossy-optimizer-bench.mjs` is a count-and-timing benchmark for mesh
optimization, separate from browser FPS. It compares lossless output against
the current library-default lossy path.
When `sharp` is available through the website workspace, GLB/OBJ texture
swatches are first baked with the same `solidTextureSamples` prepass used by
`loadMesh`, so texture-atlas color models like `ducky.glb` match the gallery
path instead of the raw parser-only path.
The table also reports render-cost delta, total vertices, max polygon
vertex count, gap diagnostics, and optimization time for the default path.
JSON output also includes triangle count, textured polygon count, and
solid-color count per stage. Use `--models <ids>` for targeted iteration.

The default corpus starts with the previous hand-checked models
(`Elephant.glb`, `Dog.glb`, `ducky.glb`) and now runs 28 models. `Duck.glb`,
`FishAnimated.glb`, `AnimatedMushnub.glb`, the Quaternius fox, and
`Shark.glb` cover known regression/safety cases; `poly-pizza/cactus-a.glb` and
`poly-pizza/glass.glb` are small grouped-plane wins; `Electricguitar.glb`,
`Dump truck.glb`, `Policecar.glb`, and `Violin.glb` cover
mostly-rectangulated and mechanical runtime cases; `AnimatedSnake.glb`,
`AnimatedWizard.glb`, `Zebra.glb`, `Bear.glb`, `Horse.glb`, `Cheetah.glb`,
`Dinosaur.glb`, `Gorilla.glb`, `Hippo.glb`, `Dragon.glb`, `Lobster.glb`,
`Octopus.glb`, and `Rat.glb` keep pressure on larger pair-heavy organic meshes.

`lossy-corpus-bench.mjs` is the heavier gallery-wide version. It scans every
GLB/GLTF/OBJ under `website/public/gallery`, excludes VOX because `loadMesh`
bypasses the generic optimizer for voxel sources, and emits per-model
lossless/current lossy rows. JSON rows include per-model optimizer timings and
current-vs-lossless crack diagnostics, so optimizer changes can be compared
without hiding load-time cost.
Use `--from-json <file> --opportunities` to mine an existing run without
rescanning, `--compare <baseline>` to compare two corpus JSON files, and
Use `--root <dir>` to scan a temporary external GLB/GLTF/OBJ corpus without
copying it into `website/public/gallery`; labels are relative to that root and
the absolute root path is stored in JSON output.

---

## How a bench run works (`perf-bench.mjs`)

1. **Build bundles** (`bench:build`). esbuild emits browser ESM bundles in
   `bench/.generated/`. Each consumes the polycss workspace packages aliased to
   their **source** (`packages/*/src/index.ts`), so editing source
   lands in the next `pnpm bench:build` without a tsup pass.

2. **Spin up a static server** on an ephemeral OS-assigned port. Serves
   `bench/*` and `/gallery/*` (mesh assets from `website/public/gallery/`).

3. **For each (renderer, mode, motion) cell**:
   - Launch a **fresh chromium instance**. (Reusing one browser across
     scenarios accumulates GPU/render-pipeline state and can produce
     false-zero sample counts on later scenarios — chase that down to
     iter-11 H32 in the polycss optimization-loop history.)
   - Open the renderer's perf-*.html with the right URL params.
   - Wait for `window.__perf__.ready === true`.
   - Sleep `WARMUP_MS` (default 2000), then sample
     `window.__perf__.samples` for `SAMPLE_MS` (default 5000).
   - Filter sample frame-times to drop only ≥2000 ms outliers (real
     tab pauses), keeping all slow-but-valid frames.
   - Compute p50, p95, p99 frame times → fps inverted from p50 / p95.
   - Close the browser.

4. **Output JSON** nested as `results[renderer][groupKey][leaf]`. Per-
   scenario stdout shows the running tally with a `⚠ BIMODAL` note
   when p99 ≥ 5× p50 (catches "fast median, periodic stall" patterns
   that hide regressions behind a healthy-looking p50).

### Output JSON shape

```json
{
  "mesh": "chicken",
  "polyCount": 648,
  "chromiumArgs": [],
  "warmup_ms": 2000,
  "sample_ms": 5000,
  "html": {
    "dynamic": {
      "static":         { "fps_p50": 120.5, "fps_p95": 30.0, ..., "is_bimodal": true, "renderStats": { ... } },
      "light_rotate":   { ... },
      "camera_rotate":  { ... }
    },
    "baked": { ... }
  },
  "vanilla": { ... },
  "react":   { ... },
  "vue":     { ... }
}
```

### Useful flags

```sh
node bench/perf-bench.mjs \
  --mesh chicken              # PRESETS key, default: saucer
  --renderer vanilla,react    # comma-separated subset, default: all 4
  --warmup 3000               # ms before sampling, default: 2000
  --sample 8000               # ms of sampling, default: 5000
  --label run-after-fix       # JSON written to bench/results/<label>.json
  --headed                    # show the browser (debugging)
  --chromium-arg "--enable-blink-features=CSSBorderShape"
```

`nonvoxel-rotation-bench.mjs --json <path>` writes structured output without
also dumping the full JSON to stdout. Add `--print-json` when you need both.
Use `--run-order round-robin` or `--run-order random --seed <label>` for
near-threshold comparisons so one variant does not own a warm/cold browser
state band.

---

## How the visual guardrail works (`perf-visual.mjs`)

Pixel-level regression detection. Renders **chicken** (flat-color MTL)
and **rock1** (UV-textured MTL) at three fixed light azimuths
(0°, 120°, 240°), screenshots each, and compares against
`bench/baselines/<mesh>-dynamic-<frame>.png` using mean per-channel RGB
delta normalized to [0, 1].

```sh
pnpm bench:visual              # diff against baselines, exit 1 on fail
pnpm bench:visual --record     # capture new baselines instead
pnpm bench:visual --tolerance 0.005   # tighter cutoff (default 0.01)
pnpm bench:visual --mesh chicken      # check just one mesh
```

The two test meshes were chosen because each exercises a different
render path:

- **chicken** — flat-color materials (`Kd` only, no `map_Kd`) → CSS
  cascade-driven polygon path.
- **rock1** — UV-mapped texture (`map_Kd rock1-surface.jpg`) → atlas-
  blob-clipped `<i>` background path.

A regression in either path shows up here. Add a new mesh to the
`MESHES` constant (and `--record`) if you need to cover more ground.

### Atlas-ready wait

The harness polls until at least one `.polycss-scene i` has a
non-empty `style.backgroundImage` before screenshotting. This catches
the asynchronous atlas-blob handoff — `scene.add()` returns sync but
the polygons stay invisible (`opacity:0`) until the atlas canvas
finishes building and its blob URL gets assigned. A blind 800 ms wait
used to race this and produce empty baselines.

### Visual diff is vanilla-only

All four renderers ultimately go through the same polycss core, so a
renderer-side bug in the atlas / cascade / mesh pipeline shows up in
the vanilla screenshot too. Per-renderer baselines would 4× the
baseline image count and add little signal. Keep it lean.

---

## How the bundling works (`build.mjs`)

esbuild pulls every workspace polycss package directly from source via
`alias`:

```js
alias: {
  "@layoutit/polycss-core":    "packages/core/src/index.ts",
  "@layoutit/polycss":          "packages/polycss/src/index.ts",
  "@layoutit/polycss/elements": "packages/polycss/src/elements/index.ts",
  "@layoutit/polycss-react":   "packages/react/src/index.ts",
  "@layoutit/polycss-vue":     "packages/vue/src/index.ts",
}
```

That means an edit to `packages/polycss/src/api/createPolyScene.ts`
lands in the next `bench:build` — no tsup pass required, no fragile
re-export of `dist/`.

**React + ReactDOM are also explicitly aliased** to the workspace-root
`node_modules/react/index.js` and friends. Without the alias, esbuild
can resolve `react` twice (once from the entry, once from the
alias-resolved `@layoutit/polycss-react` source's nearest node_modules), which
causes `Cannot read properties of null (reading 'useRef')` because each
copy keeps its own internal hook dispatcher.

Five bundles produced, all gitignored:

| File                   | Size hint   | What's in it                         |
| ---------------------- | ----------- | ------------------------------------ |
| `.generated/polycss.js`           | ~30 KB      | Vanilla createPolyScene + controls + loadMesh + parsers |
| `.generated/polycss-elements.js`  | ~36 KB      | Custom-element auto-register side effect |
| `.generated/polycss-render-stats.js` | ~1 KB    | Render stats helper re-export for browser pages |
| `.generated/polycss-react.js`     | ~290 KB     | + React 19 + ReactDOM + @layoutit/polycss-react + entry |
| `.generated/polycss-vue.js`       | ~150 KB     | + Vue 3 runtime + @layoutit/polycss-vue + entry |

---

## Tips & troubleshooting

**TypeScript editor diagnostics in `entries/react.tsx` / `entries/vue.ts`.**
There's no `tsconfig.json` in `bench/` because esbuild handles the
TS/TSX compile directly and the entries reference workspace packages
that resolve via its alias config (which IDEs don't see). The "Cannot
find module" warnings are IDE-only — `pnpm bench:build` succeeds.

**`Cannot read properties of null (reading 'useRef')` after editing the bundling.**
React got de-duplicated wrong. Check that `react`, `react-dom`,
`react-dom/client`, and `react/jsx-runtime` are all aliased to the
workspace-root copies in `build.mjs`'s `ALIASES`.

**The `⚠ BIMODAL` warning fires on something that "passes".**
The scenario produced a fast median (p50 < 25 ms) but a long tail
(p99 ≥ 5× p50). That pattern shows up when there's a periodic stall —
a long task on the main thread, a GC pause that always lands during a
specific paint, etc. It's worth checking the actual frame-time trace
even if p50 looks healthy.

**`sample_count` is suspiciously low (e.g. 1, 2, 3).**
The scenario was running so slow that fewer than expected frames
landed in the sample window, OR most frames were filtered as
`dt > 2000ms` (real tab pauses). Check `sample_count_filtered` —
if non-zero, those were dropped outliers. If zero and count is tiny,
the scenario genuinely runs at < 1 fps.

**Browser hangs or screenshots come up empty.**
The atlas-ready poll has a 5 s timeout. If it expires you'll get a
`TimeoutError`. That usually means a polygon never got
`backgroundImage` set — could be a renderer regression. Open the page
in `--headed` mode and check the console.

**Recording a baseline that ends up empty / wrong.**
The atlas-ready poll requires *at least one* `<i>` with a non-empty
`backgroundImage`. If that loosened condition isn't enough for a
specific mesh (e.g. all polys are culled at the chosen camera angle),
either pick a non-degenerate angle or tighten the wait condition for
that mesh.
