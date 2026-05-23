# Perf Investigation Reference

This file is the durable performance reference for polycss. It is not a raw
lab notebook and should not become append-only again.

Bench command details live in `bench/notes/BENCH.md`. Local Markdown summaries
belong in `bench/notes/results/`; raw JSON and traces belong in
`bench/results/` or another gitignored path. When a new result matters, fold it
into the relevant decision, cost model, or rejection below and delete any
superseded text.

`AGENTS.md` remains the architectural source of truth. This file explains why
current perf decisions exist and how to avoid repeating invalid experiments.

## How to Use This File

- Start with **Current Baselines** before proposing a renderer change.
- Check **Rejected Directions** before rerunning an old idea.
- Use **Active Questions** for the next useful experiments.
- Add new raw tables only when the exact numbers are needed to defend a future
  decision. Otherwise summarize the conclusion and point at the result file.
- Keep camera-rotation, dynamic-lighting, voxel, non-voxel, and framework
  overhead findings separate. They have different bottlenecks.

## Measurement Rules

- Perf-facing browser runs default to the GPU lane. The old software backend is
  a stress lane only; use `--software-backend` only when that is the question.
- Record browser executable, browser args, headed/headless mode, DPR, viewport,
  warmup/sample windows, model, renderer, mode, motion, active leaves, and
  trace categories for any result that may guide product code.
- Use clean cadence runs for p50/p95/p99 decisions. Use traces for attribution,
  not as the primary FPS proof. `LayerTree.enable` and similar diagnostics can
  perturb cadence.
- Use repeated runs before promoting a result. Two-run sweeps are triage; five
  repeats or stronger targeted confirmation are required for defaults.
- Treat 100+ FPS as a capped tie unless the p99 tail improves without hurting
  uncapped models.
- Visual parity is mandatory. Use the relevant gate: `pnpm bench:visual` for
  standard renderer changes, `node bench/nonvoxel-visual-compare.mjs` for
  non-voxel variants, and fixed-angle screenshot sets for voxel prototypes.
  A perf win that changes the image is a different renderer, not an
  optimization.
- Keep `pnpm test && pnpm build` as the pre-PR gate for product changes. Bench
  wins are not ready if declarations or package builds fail.
- Dynamic-light results do not explain camera-rotation results, and vice versa.

Useful commands are documented in `bench/notes/BENCH.md`; the common ones are:

```sh
pnpm bench:perf
pnpm bench:visual
pnpm bench:trace
pnpm bench:voxel-report
node bench/nonvoxel-rotation-bench.mjs --run-order random
node .agents/skills/chrome-capture-trace/scripts/trace.mjs motion --page nonvoxel --no-trace
node bench/nonvoxel-visual-compare.mjs
```

### Promotion Bar

| Candidate type | Promote only if | Reject if |
| --- | --- | --- |
| Product renderer default | It improves an uncapped primary case or p99 tail on the GPU lane, passes visual parity, and has no material regression on the relevant counterexample set. | It only helps capped medium scenes, depends on the software backend, fails screenshots, or needs model-name routing. |
| Bench-only diagnostic | It isolates one variable and preserves enough metadata to explain the result. | It mixes DOM shape, order, culling, browser backend, and measurement changes in one run. |
| API or public option | It has product value outside the bench and lands across vanilla/custom elements/React/Vue as required. | It exists only to make a benchmark variant selectable. |
| Trace-backed claim | Clean cadence runs show the perf effect, and trace events explain the likely subsystem. | The trace run is the only source of the FPS win. |

### Reference Model Sets

| Set | Models | Use |
| --- | --- | --- |
| Standard perf | `chicken`, `rock1`, `saucer` | Cross-renderer and dynamic-light smoke. |
| Non-voxel rotation | `chicken`, `rock1`, `saucer`, `teapot`, `ducky`, `elephant`, `policecar`, `bicycle` | Broad baked camera-rotation triage. |
| Voxel GPU-hard | `AncientCrashSite`, `skyscraper`, long-window `army` | Current target class for voxel renderer work. |
| Voxel counterexamples | `obj_house3`, `scene_mechanic2`, `Treasure`, `desert2`, `Garden` | Catch order, wrapper, and backend-specific false positives. |

## Current Baselines

### Voxel Fast Path

Eligible baked `.vox` meshes render through the dedicated voxel path.

| Layer | Current shape |
| --- | --- |
| Scene | One transform/perspective scene root. |
| Mesh | One `.polycss-mesh` wrapper. |
| Voxel hosts | None. |
| Leaves | Plain hostless `<b>` direct-matrix exact voxel quads. |
| Primitive | 1px on desktop-class documents; 8px on mobile-class documents with matrix scale divided by 8. |
| Matrix | One canonical non-degenerate `matrix3d(...)` per mounted quad, including an exact `+/-1` normal column. |
| DOM order | Projected screen-space `tile4-scanline-forward`. |
| Culling | Only camera-facing face directions are mounted. |

Accepted voxel decisions:

| ID | Decision | Why it stays |
| --- | --- | --- |
| D1 | Preserve `PolyVoxelSource` and route eligible `.vox` meshes through the dedicated path. | It avoids the general polygon path for exact voxel quads and keeps public polygon handles for fallback/bounds. |
| D2 | Keep hostless direct-matrix leaves as the default voxel shape. | Removing axis hosts and folding orientation/depth/scale into the leaf matrix is the strongest visual-correct one-shape baseline. |
| D3 | Keep `tile4-scanline-forward` as the default DOM order. | It is the broadest validated one-policy order; nearby tile sizes, traversal orders, depth orders, and face orders all have hard counterexamples. |
| D4 | Use exact parsed voxel quads, not source overpaint, for default rendering. | Source variants reduced nodes in places but did not reliably win and carry visual risk. |
| D5 | Keep camera-facing culling. | Mounting all six faces costs more than it saves. |
| D6 | Keep integer CSS cell snapping during `.vox` normalization. | It preserves direct integer matrix coordinates without adding a scale wrapper. |
| D7 | Normalize visual fit before comparing voxel FPS. | Fixed zoom can crop or resize large voxel scenes enough to change the benchmark. |
| D8 | Treat GPU as the default bench lane and software as an explicit stress lane. | Software-renderer ceilings produced false bottlenecks on medium scenes. |

### Non-Voxel Polygon Path

For normal OBJ/GLB/polygon meshes, active transformed leaf count is still the
first-order camera-rotation cost. The broad product lever is reducing leaves
through parsing, merging, simplification, culling, or LOD while preserving the
3D visual contract.

Durable non-voxel findings:

- Force-atlas, disabling stable triangles, Tile4 DOM order, and removing scene
  `will-change` are not broad wins.
- Projection-changing transform-topology variants produced large FPS numbers
  but failed static screenshot parity. They are invalid until the projection
  math is equivalent.
- Visual-safe topology variants (`matrix3d`, `no-will-change`) are not broad
  wins. Full-corpus runs rejected them, with Saucer as a clear regression.
- Fixed leaf buckets are visually safe but not broad. Teapot's repeatable
  `leaf-buckets-64/128/256` win is a clue about dense curved solid meshes, not
  a default renderer policy.
- Use `domOrder` for pure post-render DOM-order probes. Older `polygonOrder`
  results changed render planning too, so they are diagnostic only.

Historical package-level wins worth remembering:

| Area | Result | Read |
| --- | --- | --- |
| Parse-time merge | Saucer fell from 6384 to 4052 polygons; React/Vue stopped bypassing vanilla's merge. | Shared mesh reduction beats framework-specific cleanup. |
| React `<Poly>` memoization | React `dynamic.light_rotate` on saucer improved about 28% in the measured run. | It removes per-frame child function-body work when only scene-root CSS vars change. |
| JS micro-opts around `setOptions` | Flat. | Camera/light hot paths are dominated by browser cascade/compositor work, not a few skipped JS writes. |

### Dynamic Lighting

Dynamic light rotation is a CSS cascade/raster problem, not the same issue as
camera rotation. Earlier traces on large non-voxel meshes showed style update
and raster work dominating light rotation, while baked camera rotation showed
compositor/property-tree work instead.

Do not use dynamic-light wins or losses to justify camera DOM topology changes.
Trace them separately and keep the acceptance metric tied to
`dynamic.light_rotate`.

## Browser Cost Model

### Camera Rotation

Changing the root transform over a `preserve-3d` subtree dirties the browser's
3D compositor/property-tree path. Static mounted DOM is cheap, and repeatedly
writing the same transform value is cheap; the expensive path appears when the
root camera transform actually changes.

Durable trace read:

- Paint and raster are usually near zero for baked camera-rotation captures.
- The recurring cost is compositor/layer lifecycle:
  `PaintArtifactCompositor::Update`, `Layerize`,
  `LayerTreeImpl::UpdateDrawProperties`, `LayerTreeHostImpl::PrepareToDraw`,
  and draw.
- Voxel and non-voxel scenes show a similar per-active-leaf slope when the
  root transform changes. Active transformed leaves remain the best first
  predictor, but model geometry and order can move cadence near thresholds.
- Same-node-count DOM-order flips can have nearly identical per-frame
  PAC/DrawProps/Draw summaries while landing in different vsync buckets. Treat
  those as compositor scheduling/cadence effects, not normal JS/style wins.

### Transform API Shape

Chromium source and probes agree on this:

- A running CSS keyframe or running WAAPI transform animation can skip full
  `PaintArtifactCompositor::Update`.
- JS `scene.setOptions({ rotY })` / `style.transform` mutation does not hit
  that active-animation fast path.
- Paused WAAPI scrubbed with `Animation.currentTime` and scroll-timeline
  scrubbed through JS `scrollLeft` also fall back into PAC.
- CSS custom properties used in `transform`, registered transform variables,
  and individual `rotate` property writes still dirty the subtree like normal
  JS transform mutation.

The practical consequence: declarative auto-rotate may be useful for demos, but
it is not an interactive pointer-driven camera fix unless a browser exposes a
true compositor-driven scrub path.

### 3D Descendant Cost

Synthetic topology probes isolate the lower-level shape:

| Equal-leaf topology | Read |
| --- | --- |
| `left/top` or 2D `translate(...)` leaves | Cheap draw-property path. |
| `translateZ(0)`, real `translateZ(...)`, or `matrix3d(...)` leaves | Expensive 3D transform-tree/draw-property path. |
| Fewer 3D wrappers with many 2D children | Fast only when wrapper count stays below the backend threshold and visual depth remains exact. |

ANGLE/Metal GPU reread of exact depth groups with 7000 leaves:

| Exact depth wrappers | Result |
| ---: | --- |
| Up to about 112 | Near the 112 FPS p95 bucket. |
| 128 | Falls to about the 60 FPS p95 bucket. |
| 136 | Collapses further. |
| 192 | Unusable for the hard class. |

Relevant voxel model visible-plane counts show why exact depth wrappers are not
the default path:

| Model | Visible exact planes | Read |
| --- | ---: | --- |
| `AncientCrashSite.vox` | 191 | Above threshold; still GPU-hard. |
| `skyscraper.vox` | 173 | Above threshold; still GPU-hard. |
| `army.vox` | 187 | Above threshold and window-sensitive. |
| `obj_house3.vox` | 142 | Above wrapper threshold, but now mostly a capped/tie medium case on GPU. |
| `scene_mechanic2.vox` | 163 | Above wrapper threshold, but now mostly capped/tie on GPU. |
| `Treasure.vox` | 132 | Just above threshold; medium GPU case. |
| `desert2.vox` | 102 | Under threshold, but already fast on GPU. |

Depth wrappers remain a special-case ceiling for a future high-leaf,
low-visible-plane asset. They are not a default renderer path.

### Browser Backend

The benchmark backend can change the apparent bottleneck. Bundled Playwright
Chromium without GPU flags can fall onto `SoftwareRenderer::DoDrawQuad`; the
perf scripts now default to the GPU lane (`--use-angle=metal` on macOS plus
`--enable-gpu-rasterization`).

The GPU reread moved medium scenes such as `obj_house3`, `scene_mechanic2`,
`Treasure`, and `desert2` into the 100+ FPS capped/tie class. The remaining
true target is the GPU-hard class: high active leaves plus high exact visible
plane count, especially `AncientCrashSite`, `skyscraper`, and long-window
`army`.

## Evidence Anchors

These are the few historical tables worth keeping inline because they prevent
old ideas from being re-argued.

### Voxel Order Baseline

Validation that made `tile4-scanline-forward` the one-strategy default:

| Model | Prior slice p95 | Tile4 scanline p95 | Read |
| --- | ---: | ---: | --- |
| `obj_house3.vox` | 59.9 | 113.6 | Rescues the face/locality counterexample. |
| `obj_house5.vox` | 59.9 | 113.4 | Validated win. |
| `desert2.vox` | 59.5 | 113.6 | Validated win. |
| `house.vox` | 59.9 | 114.7 | Validated win. |
| `scene_mechanic2.vox` | 40.0 | 113.5 | Validated win. |
| `Treasure.vox` | 30.5 | 58.5 | Moves into the about-60 FPS class. |
| `army.vox` | 39.8 | 42.1 | Weak; still needs better interval analysis. |
| `AncientCrashSite.vox` | 39.8 | 39.8 | Neutral; remains hard. |
| `skyscraper.vox` | 23.7 | 29.9 | Modest; still hard. |

Rejected replacements after this result: `tile4-depth-front`, tile3/tile5/tile6
scanlines, tile4 serpentine, Morton traversal, full face order, full depth
order, dense-tile face order, and centered/lookahead interval phases.

### Old Matrix-Vs-Slice Selector

Do not revive the old `.vox` matrix-vs-slice router without new GPU-hard proof.

The 86-model cadence corpus found matrix p95 wins on `desert2`,
`scene_hazmat`, `scene_house`, `scene_mechanic2`, `scene_sidewalk`, and
`Treasure`; slice p95 wins on `AncientCrashSite`, `armchair`,
`christmas_tree`, `ff1`, `mailbox`, `obj_house3`, `obj_house8`,
`obj_trashcan4`, `pyramid`, and `scene_park`; 66 models were flat or capped.

`visibleShadedColors >= 52 && visiblePlanes < 200` was the safest partial
gate. It caught several high-shaded matrix wins and avoided known p99 risk, but
it missed `desert2`, hit many capped models, and changed with browser mode.
Hostless direct matrix plus tile4 order superseded the router direction.

### Non-Voxel Rotation

Current non-voxel evidence:

| Variant | Result | Read |
| --- | --- | --- |
| Force atlas | Rejected. | Normal warmup lost on Teapot, Bicycle, Elephant, and Policecar. |
| Disable stable triangles | Rejected as broad default. | Short Bicycle movement flattened; Teapot regressed; others were flat. |
| Tile4 DOM order | Rejected as broad default. | Corrected `domOrder` probes were flat or regressed representative meshes. |
| Transform topology changes | Invalid if projection changed. | Large FPS wins failed visual parity. |
| `matrix3d` / `no-will-change` topology | Rejected as broad default. | Full eight-model random pass regressed Saucer and flattened most others. |
| Fixed leaf buckets | Narrow clue. | Teapot repeatably improved about 10-12%; Saucer regressed and other representative meshes were flat. |

## Active Questions

### Voxel GPU-Hard Class

Primary target: high-leaf, high-visible-plane voxel scenes on the GPU lane,
especially `AncientCrashSite`, `skyscraper`, and long-window `army`.

Next useful work:

1. Attribute slow intervals, not whole runs. Segment by visible-face interval
   before testing another order phase.
2. Measure projected overlap, footprint, depth distribution, and tile density
   on the hard intervals. Treat these as explanatory variables for cadence, not
   as preset model gates.
3. Reopen exact depth wrappers only for a real high-leaf model at or below the
   GPU wrapper threshold and only if it is not already capped.
4. Keep occlusion alive only as an exact/geometric proof. Sampled masks either
   failed screenshots or became interval-stable by removing too few leaves.
5. Do not add another global order permutation without a browser/compositor
   metric that predicts the hard counterexamples.

### Non-Voxel Camera Rotation

Next useful work:

1. Use `.agents/skills/chrome-capture-trace/scripts/trace.mjs motion --page nonvoxel --no-trace`
   to identify the slow cadence buckets first; trace only after a signal
   survives repeated clean runs.
2. Investigate Teapot-like dense curved solid meshes separately from broad
   default policy. Leaf buckets are a clue, not a product feature.
3. Prefer leaf-count reduction, merge quality, simplification, or LOD over more
   transform-chain spelling experiments.

### Declarative Auto-Rotate

Running CSS/WAAPI transform animation can skip PAC in traces. A product-shaped
auto-rotate path is still open as a demo/idle feature, but it must be tested
separately from pointer-driven controls and must pass fixed-angle screenshots.

### Dynamic Light

Dynamic light remains a cascade/raster investigation. Useful work here should
measure `dynamic.light_rotate` directly and avoid importing camera-rotation
topology conclusions.

## Rejected Directions

Do not rerun these without a concrete new browser version, trace signal, or
visual-correct implementation that changes the premise.

### Architecture and API

| Direction | Why closed |
| --- | --- |
| Per-frame JS Lambert, JS filters, or JS per-polygon visual writes | Violates the CSS-driven renderer model. |
| CSS Paint Worklet face generation | Adds JS to the paint path and is not reliable enough for the core renderer. |
| Back-compat shims for perf-only API churn | This repo uses clean breaks; perf knobs need product justification. |

### Camera Transform Shortcuts

| Direction | Why closed |
| --- | --- |
| `will-change` alone | It can force compositing but does not make JS transform mutation hit the active animation fast path. |
| Root transform spelling changes (`matrix3d`, perspective placement, inner target shell, transform-function perspective) | Longer validation was flat or worse. |
| CSS variables, registered variables, or individual `rotate` for interactive camera motion | They still hit PAC/layerize like normal JS transform mutation. |
| JS-scrubbed WAAPI or scroll-timeline camera controls | Scrubbing from JS still hit PAC once per frame. |
| Leaf `transform-style: flat` | Catastrophic regressions, including hostless direct-matrix voxel leaves. |
| Leaf or host `backface-visibility: hidden` | Fast-looking variants either failed visual checks or lost the win once oriented correctly. |

### Voxel DOM Shape

| Direction | Why closed |
| --- | --- |
| Axis hosts, host+brush matrix, or voxel slice hosts as the main shape | Hostless direct canonical matrix leaves are the transferable win. |
| Mount all six face directions | Extra active DOM dominates mutation savings. |
| Hide pooled leaves instead of removing unused faces | Flat to worse. |
| Split large brushes or source-overpaint planners | More leaves or visual risk without reliable p95/p99 wins. |
| Per-leaf square primitive normalization, fixed 64px quads, size bands, or CSS width/height plus unit matrix | Flat, noisy, or short-window cadence artifacts. |
| Leaf containment, `overflow`, `will-change`, CSS resets, semantic `inert`/`aria-hidden` | Flat, visually invalid, or regressive in representative runs. |
| Direct matrix normal-column scaling away from exact `+/-1` | Visual-equivalent but cadence-regressive on key models. |

### Voxel Ordering

| Direction | Why closed |
| --- | --- |
| Full depth order or full face order as the default | Each has hard model counterexamples. |
| Static face-normal permutations | Model-specific and rejected by `obj_house3`, `desert2`, `house`, `AncientCrashSite`, or `Treasure` depending on the order. |
| Source-block depth order | Transfers some wins but fails `obj_house3`, misses `army`/`skyscraper`, and does not beat the Pareto frontier. |
| Tile3, tile5, tile6 scanline replacements | Hard counterexamples and p99 regressions; tile5's broader pass found no safe default win. |
| Tile4 serpentine or Morton traversal | Lost `obj_house3` and stayed below row-major average. |
| Centered interval order, lookahead offsets, boundary screen-span anchors, adaptive 3x3/5x5 density | Real short-window wins, but validation left `obj_house3`, `AncientCrashSite`, or p99 tail losses. |
| Dense-tile face order | Product patch looked promising in one window and failed two-repeat interval validation. |

### Voxel Wrappers and Culling

| Direction | Why closed |
| --- | --- |
| Exact depth wrappers as the default | GPU threshold is about 112 wrappers; current hard models exceed it. |
| Residual per-leaf Z inside coarse wrappers | Falls back to per-leaf 3D transform cost. |
| Depth quantization | Visual error is too large. |
| Spatially tiled depth wrappers | More bounded wrappers were slower than fewer broad wrappers. |
| Sampled screen-coverage occlusion | Either failed visual checks or became too conservative to help. |
| Interior-neighbor sampled culling plus alternate order | Wins were entangled with order; no single order handled the hard set. |
| Interval-stable sampled culling | Passed screenshots but removed almost no p50 DOM once it had to cover the whole visible interval. |

### Non-Voxel Variants

| Direction | Why closed |
| --- | --- |
| Force atlas for rotation | Rejected by normal-warmup confirmation. |
| Disable stable triangles broadly | Not a broad win. |
| Voxel Tile4 order copied to non-voxel meshes | Corrected DOM-order probes did not hold broadly. |
| Projection-changing scene split/host perspective/transform perspective variants | Failed static visual parity. |
| `matrix3d` scene transform or `no-will-change` as defaults | Full-corpus run rejected broad use. |
| Fixed leaf buckets as a broad default | Teapot-only signal; Saucer regressed and other representative meshes were flat. |

### Measurement Traps

| Trap | Rule |
| --- | --- |
| Optimizing `RunTask` totals | Use nested event attribution and per-frame medians; `RunTask` is just a wrapper. |
| Summing top trace events as exclusive time | Many important trace events are nested. |
| Treating trace FPS as final proof | Trace capture can move cadence buckets. |
| Comparing software-backend wins to GPU-lane defaults | Software-only wins are stress-lane findings unless they also help the GPU-hard class. |
| Drawing conclusions from fixed zoom | Normalize visual fit first. |

## Update Protocol

When a future investigation changes the read:

1. Add or update one short decision, active question, or rejection.
2. Keep the smallest table that proves the point.
3. Name the result artifact if the raw data matters.
4. Delete contradicted older text in the same edit.
5. Update `AGENTS.md` too if the result changes a render strategy, lighting
   mode, naming convention, public API contract, or JS-in-render-loop rule.
