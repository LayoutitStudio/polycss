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

## Shadow vs lighting cost split (iter 2 diagnostic)

Same scene (teapot, dynamic mode, motion=light), one with shadows on
(cs=1 ss=1 fv=1), one with all shadows off (cs=0 ss=0 fv=0):

| group | no-shadow ms/f | with-shadow ms/f | shadow Δ |
| --- | ---: | ---: | ---: |
| style (calc-Lambert recalc) | 53.4 | 56.0 | +3 |
| script (SH-clip + DOM mut) | 4.6 | 764.3 | +760 |
| compositorMain (SVG layers) | 120.1 | 527.0 | +407 |
| frame_p50 | 59.9 | 449.9 | +390 |

**Shadow path = 95% of the with-shadows cost.** Dynamic-Lambert style
recalc (53 ms/frame for 2300 leaves) is the floor in dynamic mode and
is independent of shadows — investigate as a separate H once the shadow
script + compositorMain numbers shrink. **H9 attacks the right cost.**

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
- **[H9] Caster-mesh silhouette extraction.** Dissection of the
  teapot-floor 90 KB merged path (`_dissect-shadow-path.mjs`) revealed
  it's **2,182 sub-paths, each a triangle** (median 3 verts). The cost
  is the number of caster polygons projected, not per-polygon vertex
  count. The 2000+ triangles get unioned into a single silhouette by
  fill-rule:nonzero at paint time — meaning the browser is doing the
  silhouette work AFTER we've already paid the JS+DOM cost of emitting
  them. Instead: compute the silhouette EDGE on the CPU per caster mesh
  per frame (edges where one adjacent triangle faces the light and the
  other doesn't), project only the silhouette polygon. For a teapot,
  silhouette is ~20-50 edges → 50 vertices vs 6553 today (~130× fewer
  vertices). Trade-off: complexity. Need edge-adjacency map (already
  exists for self-shadow seam cull, see `buildSharedEdgeMap` in core).
  For concave silhouettes there are interior loops; SVG `d=` supports
  multiple subpaths with fill-rule:evenodd to make holes work. **This
  dwarfs H2 in potential impact for the merge-collapse case.**

## Iteration journal

(append-only; newest at top)

### Iteration 1 — H2 path simplify (branch `perf/shadow-path-simplify`)

**Hypothesis recap.** Douglas-Peucker simplification on each per-frame
projected polygon clip (ε = 1 CSS px) before stringifying into SVG
`d=`, expected 5-10× drop in `pathDChars` on the teapot-floor case
(~90k chars compound path).

**Implementation.** Added `simplifyPolylineDP` + `simplifyPolygonRingDP`
helpers and a `SHADOW_PATH_SIMPLIFY_EPS` const to
`packages/core/src/shadow/computeReceiverShadows.ts`; invoked on
`memberClip` immediately before the existing
`bucket.verts.push(memberClip)` site, so the simplified ring is what
gets written into the SVG path. Static `outlineUv` /
`memberPolysUv` are left untouched (they're per-mesh clip subjects,
not per-frame outputs).

**Metrics (shadow-regression fixture, 4 scenes × 3 azimuths).**

| scene         | baseline avg dChars | h2 avg dChars | Δ avg dChars | Δ % |
| ---           | ---:                | ---:          | ---:         | ---:|
| teapot-self   | 115,241             | 113,937       | -1,303       | -1.1% |
| teapot-floor  | 89,816              | 89,816        | 0            | 0.0% |
| castle-floor  | 23,178              | 23,154        | -190         | -0.8% |
| crate-floor   | 215                 | 188           | -27          | -12.7% |

Receiver SVG count Δ = 0 across all 12 captures (expected — DP changes
ring vertex counts only, not which faces emit a path).

Trace (`shadow-h2-teapot-self`, page=shadow mesh=teapot mode=dynamic
motion=light, 5s sample): frame_p50 = 325.00ms, script_ms = 533.81 in
x4_plus bucket. Baseline reference
(`bench/results/shadow-teapot-dynamic-backface.json` on parent
`feat/three-parity`): frame_p50 = 325.10ms, script_ms = 535.08.
Wall-time delta ≈ 0 (within noise).

Live trace `domSamples` cross-check: avg pathDChars dropped from
~120,034 (baseline) to ~118,252 (h2) — confirms the 1.5% reduction
on the live light-rotation path.

**Visual verdict (per scene).** Compared PNG pairs via Read + raw byte
diff:

- `teapot-self` az50/130: byte-identical. az220: 3-byte PNG-stream
  diff (compression-level noise, visually unchanged).
- `teapot-floor` az50/130/220: byte-identical.
- `castle-floor` az50/130/220: byte-identical.
- `crate-floor` az50: byte-identical.

Verdict: visually indistinguishable. DP simplification at ε=1 does not
perturb the rendered shadow at the regression fixture's render scale.

**Why the hypothesis underperformed.** Each per-frame member-clip is
the SH-clip of a single fan-triangulated caster tri against the
receiver outline + member polygon — already 3-7 vertices in the
common case. The teapot-floor "~90k chars" comes from ~6-7k MOVE/LINE
tokens emitted by hundreds of small clip polygons, not from a few
high-vertex-count clips. DP can't simplify a clip that's already
near-minimal. The 1-2% wins on dense scenes come from the small share
of clips that DID have 6-8 nearly colinear vertices.

**Recommendation: discard for the H2 default, but keep ε as a knob.**
The simplification is a no-op in the worst case (~0 saving on
teapot-floor's compound path; flat frame_p50). The real path-length
bottleneck is *number of subpaths*, not vertices per subpath; the win
lives upstream (cluster adjacent caster contributions into a single
union polygon before SH-clip, or move the bottleneck up to H3
quantize-skip / H1 drag-coarse). Recommend NOT cherry-picking onto
`feat/three-parity` as-is. Worth revisiting at a coarser ε (3-5 px)
only if combined with an upstream merge pass that produces fewer,
larger compound shapes.

### Iteration 0 — baseline lock-in (commit 5dff12d)

Captured `bench/results/shadow-regression/baseline-<scene>.{png,json}`
for the regression set (see Fixture). Recorded the cost breakdown
above. No code changes.

Baseline shadow.paths × shadow.pathDChars:

| scene | recvSVGs | sub-paths | path-d chars |
| --- | ---: | ---: | ---: |
| teapot-self az50  | 138 | 138  | 125,046 |
| teapot-self az130 |  70 |  70  | 108,627 |
| teapot-self az220 |  52 |  52  | 112,050 |
| teapot-floor az50 |   1 | 2,182 |  87,869 |
| teapot-floor az130 |  1 | 2,182 |  89,982 |
| teapot-floor az220 |  1 | 2,182 |  91,596 |
| castle-floor      |   1 | ~600 |  ~23,000 |
| crate-floor       |   1 | 12  |    ~210 |

Dissection finding (`_dissect-shadow-path.mjs`): the teapot-floor
shadow is **1 SVG path containing 2,182 sub-paths, each a
triangle/quad** (median 3 vertices). The browser unions them via
fill-rule:nonzero at paint time. That makes H2 (Douglas-Peucker
per-poly simplification) likely a no-op for this case — triangles can't
be DP'd — but it makes H9 (caster-mesh silhouette extraction) a
potential 130× DOM reduction.

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
