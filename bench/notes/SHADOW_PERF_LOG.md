# Shadow + lighting perf research

Living log of explorations to make the per-frame receiver-shadow + lighting
system cheaper. Append-only journal of branches tried, what worked, what
didn't, and the metrics. The "best" wins get cherry-picked back to
`feat/three-parity`; failed experiments stay on their own branches for
traceability.

## Setup

- **Source of truth**: this file, plus `bench/results/shadow-regression/`
  for screenshots + summary JSON per branch.
- **Cadence**: triggered by the `/loop 30m` user prompt — each iteration
  picks one hypothesis, branches it, measures, journals, then re-evaluates.
- **Tooling**: `node .claude/skills/chrome-capture-trace/scripts/trace.mjs
  motion --page shadow --mesh <id> --mode dynamic --dom-samples --label
  …` for trace runs; playwright probe under
  `bench/scripts/shadow-regression.mjs` (created in iteration 1) for the
  visual fixture.
- **Reference frame for "did we break something"**: three.js parity is
  measured via the existing bench/three-parity.html. We compare PolyCSS
  vs three.js shadow shape + opacity at fixed light positions. No
  perf-only optimization is allowed to regress that.
- **Baseline to beat**: the current `feat/three-parity` HEAD at the start
  of the loop (commit `5dff12d`). All deltas are reported vs that ref.

## Diagnosed cost breakdown (recap of pre-loop bench)

From `bench/results/shadow-teapot-dynamic.json` (light rotating
0.5°/frame, dynamic mode, teapot self-shadow ON):

| stage | ms/frame |
| --- | ---: |
| script (computeReceiverShadowFaces + DOM mutation) | ~535 |
| style recalc (CSS calc() on 2281 leaves for dynamic Lambert) | ~54 |
| layout + prePaint + paint | ~5 combined |
| compositorMain | ~400 |
| compositorImpl | ~14 |
| **frame_p50** | **~325 ms** (after light-backface cull) |

**Frame-time bottlenecks**, ranked:

1. **Per-frame SH-clip + projection in core**
   (`computeReceiverShadowFaces`) — ~300+ ms with self-shadow on smooth
   GLBs. Dominates everything.
2. **SVG path mutation** — 147 receiver SVGs × ~800 char `d=` strings
   re-emitted every frame. Browser repaints the entire shadow layer.
3. **CSS style recalc for dynamic Lambert** — `calc(--plx*--pnx + …)`
   on every leaf invalidates when scene-root vars change. ~54 ms/frame
   for ~2300 leaves.
4. **compositorMain** — Big number (~400ms) but mostly downstream of (1)
   and (2). Investigate after (1) and (2) shrink.

## Hypothesis backlog

In rough priority order. Each entry gets its own branch and journal
section below when explored.

- **[H1] Dynamic-during-drag, full-quality on release.** Detect "user is
  dragging the light" (rapid setOptions calls), switch to a coarser
  shadow path (e.g. skip seam-cull, skip member-clip, use convex hull
  silhouette), then run the full algorithm once when drag stops. Pure
  perceived-FPS win; geometry-correct freeze frame.
- **[H2] Path simplification on emitted SVG `d=`.** Douglas-Peucker on
  the projected polygon vertices before `toFixed(1)` rounding. Reduces
  DOM mutation cost + SVG repaint cost. Tunable threshold.
- **[H3] Mounted-path memoization keyed by quantized light direction.**
  Round the light direction to e.g. 1° steps; if the rounded value
  matches the cached frame, skip recompute entirely. Trades 1° "jitter"
  on slow drag for free skip.
- **[H4] CSS `filter: drop-shadow` per casting mesh as an alternative
  rendering primitive.** Browser-native shadow — no per-frame DOM. Won't
  match per-face SVG semantically (single direction-blurred drop, no
  receiver-plane projection) but might be acceptable for a "fast" mode.
- **[H5] Canvas-rasterised shadow buffer.** Render shadow geometry to a
  single 2D canvas per receiver face, set it as `background-image`. One
  bitmap mutation per frame instead of ~300 SVG path mutations.
- **[H6] Worker-thread SH-clip.** Move
  `computeReceiverShadowFaces` to a `Worker`. Main thread only mutates
  DOM. Doesn't reduce total work; removes it from main-thread budget.
- **[H7] Cull at the caster-cluster level.** Spatial hash receiver
  planes by (u,v) bbox; per caster, only test receivers in its swept
  shadow volume. Already-partially-done by per-poly bbox prefilter;
  worth checking whether broader caster-AABB → receiver-cluster
  prefilter gets more than the per-poly one.
- **[H8] Skip per-frame receiver-face SVG re-emission when nothing
  changed.** Even on light drag, MANY shadow paths are byte-identical
  frame-over-frame in the projected (u,v) frame. We already memoize
  width/height/matrix; extending to `d=` was tried as "memoize-d=" and
  came out flat (~0% hit rate at 0.5°/frame). Combined with (H3)
  quantization, the hit rate should jump.

## Iteration journal

(append-only; newest at top)

### Iteration 0 — baseline lock-in (commit 5dff12d)

Captured `bench/results/shadow-regression/baseline-<scene>.{png,json}`
for the regression set (see Fixture). Recorded the cost breakdown
above. No code changes.

## Fixture

`bench/scripts/shadow-regression.mjs` captures the following scene ×
light-pose matrix from a deterministic perf-vanilla.html URL. Each
capture stores: (a) screenshot PNG, (b) JSON with shadow.paths /
shadow.pathDChars / receiver SVG count / frame_p50 / fps_p50.

| scene | mesh | castShadow | self-shadow | floor | meaning |
| --- | --- | :-: | :-: | :-: | --- |
| `teapot-self` | teapot | ✓ | ✓ | ✓ | the worst self-shadow stress case |
| `teapot-floor` | teapot | ✓ | ✗ | ✓ | typical "cast on ground" path |
| `castle-floor` | castle | ✓ | ✗ | ✓ | complex outline + many casters |
| `cube-floor` | synth-cube | ✓ | ✗ | ✓ | trivial silhouette baseline |

Each captured at three light azimuths (50°, 130°, 220°) × one elevation
(45°), so we see how shadows behave across the rotation range without
combinatorial blowup.

A run is "good" iff:
- pixel-diff vs baseline screenshot under ~1% of pixels OR shape is
  visually equivalent (judged by the loop).
- frame_p50 is strictly lower OR shadow.pathDChars is strictly lower
  with no other regression.

## Open questions / things to verify later

- For (H4) drop-shadow: does it interact correctly with receiver-mesh
  geometry, or does it always project onto the page plane? Almost
  certainly the latter — would only be acceptable as a "ground only"
  fast path, not for receiver-mesh shadows.
- For (H5) canvas raster: how big is the per-frame canvas budget at our
  receiver SVG sizes (3406×3394 for the apple gallery scene)? Need to
  estimate before prototyping.
- For (H6) worker: serialization cost of the per-frame inputs (caster
  items, receiver planes) might dominate compute savings for small
  scenes. Mostly a win for heavy GLB scenes.
