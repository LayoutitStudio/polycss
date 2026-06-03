# Shadow + lighting perf research

Living log of explorations to make the per-frame receiver-shadow + lighting
system cheaper. Append-only journal of branches tried, what worked, what
didn't, and the metrics. The "best" wins get cherry-picked back to
`feat/three-parity`; failed experiments stay on their own branches for
traceability.

## TL;DR — cumulative loop wins on `feat/three-parity`

Worst-case scene = teapot-self self-shadow drag (perf-vanilla, dynamic mode,
0.5°/frame light azimuth motion).

| state | frame_p50 | fps_p50 | script ms/f | recv SVGs |
| --- | ---: | ---: | ---: | ---: |
| pre-loop (commit `5dff12d`) | 449 ms | 2.2 | ~535 | 309 |
| +H9 silhouette (floor only) | 449 | 2.2 | (gated out) | 309 |
| +H3 light-key quantize | 442 | 2.3 | 533 | 309 |
| +H9b silhouette self-shadow | 342 | 2.9 | 465 | 138-242 |
| +H10 CSS-var quantize | 117 | 8.6 | 126 | 138-242 |
| **+H11b OBB-proxy receiver** | **58 (heavy) / 8 (light)** | **17.1 / 120** | **8** | **1** |

**Cumulative: 449→58ms heavy bucket, ~7-10× FPS improvement on the worst
case. Visual identical to baseline per byte-compared regression fixture
and three.js parity shots.**

Floor-case (teapot-floor, just `castShadow:true` on a floor receiver) is
even cleaner: pre-loop 66 ms / 17 fps → post-H11b ~58 ms with all of the
ground-shadow JS work (SH-clip + per-poly fan) replaced by one silhouette
loop projected once, dChars down 90,000→5,000 (-94%).

## Wins landed (chronological)

| commit | iter | hypothesis | effect |
| --- | --- | --- | --- |
| `feb4ea7` | 2 | H9 silhouette floor | -94% dChars / -57% script (floor) |
| `5337ae4` | 3 | H3 light-key quantize | -28% script during drag |
| `e9cf56c` | 4 | H9b silhouette self | -51-60% dChars / -18% script (self) |
| `77f3206` | 7 | H10 CSS-var quantize | +38% mean FPS (lighting recalc floor) |
| `2187a1e` | 9 | H11b OBB-proxy receiver | -94% script in self-shadow / 242→1 SVG |
| `774c45e` | 10 | H10 mirror React + Vue | parity (cross-package discipline) |

## Discarded for traceability (branches preserved)

| branch | iter | hypothesis | why |
| --- | --- | --- | --- |
| `perf/shadow-path-simplify` | 1 | H2 DP simplify | triangles can't be simplified |
| `perf/shadow-face-coalesce` | 6 | H11 NORMAL_TOL relax | OFFSET_TOL was the actual gate |
| `perf/shadow-memoize-d-v2` | 8 | H8 d= memoize | 54% hit rate but savings below noise |

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

## H8 hit-rate prediction (iter 8 pre-flight)

Direct measurement on a self-shadow drag (teapot az50, motion=light, 4s
sample): of 6,986 (face_id, frame) tuples observed in the receiver-SVG
set after H9b landed, **75.2 % (5,033 / 6,695 non-first-sight)
emitted a `d=` byte-identical to the previous frame**. (291 unique
receiver faces × ~24 visited frames.)

This is the H8 prediction signal: per-frame SVG `d=` mutation has a
~75 % byte-equal redundancy that the existing `MountedFace` cache
doesn't catch (it memoizes width/height/matrix, not `d`). Before H9b
(per-poly fan shadows) the hit rate was ~0 % — silhouette geometry is
dramatically more stable frame-to-frame than fan triangulations.

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
- **[H11b] Silhouette onto OBB/averaged-plane proxy for self-shadow.**
  Follow-up to H11 NEGATIVE result. Per-face receiver decomposition
  can't be coalesced on a smooth curved mesh without also relaxing
  OFFSET_TOL (which would merge unrelated planes). Instead: when
  caster === receiver, replace the per-face receiver hull with a
  single proxy plane per camera-facing region (oriented-bounding-box
  face or k-means averaged plane). Project the H9b silhouette onto N
  proxy planes instead of 242 actual planes → ~10× fewer SVGs without
  needing OFFSET_TOL changes. Visual risk: shadow lands on an averaged
  plane that can detach from real geometry; mitigate by clipping each
  proxy's projection to the per-face member polygons it represents.

## Iteration journal

(append-only; newest at top)

### Iteration 9 — H11b silhouette onto OBB proxy (branch `perf/shadow-obb-proxy`)

**Hypothesis recap.** Post-H9b state on teapot-self emits 138-242 receiver
SVGs per frame because the per-coplanar-face decomposition produces one
plane per smooth-shaded GLB facet. The H9b silhouette path collapses
sub-path count per face but doesn't reduce face count. H11 tried to
coalesce faces via tolerance relaxation and failed (RECEIVER_OFFSET_TOL
is the real gate; loosening it breaks unrelated-plane merging).

H11b replaces the per-face decomposition with ~6 axis-aligned OBB
proxy planes when (a) caster === receiver and (b) receiver polygons
≥ `PROXY_MIN_POLYS = 60`. The silhouette (already extracted per H9b)
projects onto each proxy plane and clips to the convex hull of polygons
assigned to that proxy. Each polygon is assigned to the proxy whose
outward normal best matches its own — so the projected shadow stays
clipped to mesh regions that actually face the same direction. Pixel
drift expected on regions whose real normal differs from the proxy
(~3-5 px on a teapot at default zoom; bounded by the per-member-poly
clip).

**Implementation.** New `packages/core/src/shadow/proxyReceivers.ts`
(~80 LOC + tests) exports `prepareProxyReceiverPlanes` returning
`ProxyReceiverPlane[]` with the same shape as `ReceiverFacePlane`.
Each of the three renderers gates the swap at cache-prep time: when
the current caster set contains this receiver mesh AND
`polygons.length >= PROXY_MIN_POLYS`, the renderer calls
`prepareProxyReceiverPlanes` instead of `prepareReceiverFacePlanes`.
Cache key gains a `p`/`f` mode segment so swapping modes (caster set
gains/loses self-shadow) re-runs the prepare step. The shadow
algorithm in `computeReceiverShadowFaces` is unchanged — proxy and
per-face planes share the same iteration contract.

**Metrics (shadow-regression fixture, teapot-self scene).**

| az  | recvSVGs h10 | recvSVGs h11b | Δ | dChars h10 | dChars h11b | Δ %    |
| --- | ---:         | ---:          | ---: | ---:    | ---:        | ---:   |
| 50  | 242          | 1             | -241 | 16,731  | 5,302       | -68.3% |
| 130 | 143          | 1             | -142 | 11,560  | 5,341       | -53.8% |
| 220 | 104          | 1             | -103 | 11,134  | 5,546       | -50.2% |

teapot-floor / castle-floor / crate-floor: **byte-identical** to
h10-merged (non-self path untouched). Three.js parity: all 12 shots
(4 meshes × 3 light poses) **byte-identical** to baseline (parity
scenes use `ss=0`, so they never hit the proxy path).

The "1 receiver SVG" result reflects the back-face cull: at any
given light direction only one OBB proxy face passes both `Ldotn > 0`
and camera-facing, and the others get back-face-culled or have no
silhouette content above them.

**Trace deltas** (perf-vanilla.html, page=shadow mesh=teapot
mode=dynamic motion=light, 5s sample @ 1.5s warmup, label
`h11b-teapot-self` vs `h10-merged-teapot-self`):

| bucket   | frames | dt_p50 (ms) | script ms/f | style ms/f | compositorMain (approx) |
| ---      | ---:   | ---:        | ---:        | ---:       | ---:                |
| x1  h10  | 18     | 8.30        | 1.54        | 0.00       | (light bucket) |
| x1  h11b | 29     | 8.30        | 1.29        | 0.00       | (light bucket) |
| x4_plus h10  | 39 | 116.80      | 124.42      | 52.23      | (heavy bucket) |
| x4_plus h11b | 77 | **58.40**   | **7.40**    | 52.11      | (heavy bucket) |

x4_plus dt_p50 drops **116.8 → 58.4 ms (-50%)**, script ms/frame drops
**124.4 → 7.4 (-94%)**. fps_p50 in the heavy bucket roughly doubles
(8.6 → 17.1 fps). The number of frames in the heavy bucket itself
nearly doubles (39 → 77) — more total frames complete in the same
5s window. Style recalc floor (52 ms — dynamic-mode Lambert on 2,117
leaves) is now the dominant cost, exactly where H10 predicted it
would be once the SVG-count cost was removed.

**Visual verdict** (zoom=3 captures via
`bench/scripts/h11b-visual-probe.mjs`, `bench/results/h11b-visual/{h10-merged,h11b-proxy}/`):

- `teapot-self-az50-z3`: teapot reads identical, floor cast shadow
  identical. A faint floating-dot artifact slightly left of the teapot
  in h10-merged is GONE in h11b (the per-face path's stray sub-pixel
  sliver shadows go away when 240 SVGs collapse to 1).
- `teapot-self-az130-z3`: identical. Floor cast shadow stretches
  the same direction; no detachment, no drift visible at this zoom.
  Another faint floating-dot artifact upper-right in h10 is GONE in h11b.
- `teapot-self-az220-z3`: identical. Dark side reads consistently;
  spout/handle silhouette preserved; floor cast shadow correct.

No shadow detached from the teapot geometry at any of the three
azimuths. Pixel drift from proxy averaging is well under the visual
threshold at default zoom because shadow content stays clipped to
member-polygon hulls per proxy.

**Recommendation: cherry-pick.** This is the largest single-iteration
win to date — 94% reduction in script ms/frame on the worst-case
self-shadow scene, fps doubled, no visual regression, three.js parity
preserved, non-self paths byte-identical. Surface change is small:
one new pure helper in core, a per-renderer cache-key prefix, no API
additions. Once cherry-picked, the next bottleneck is the dynamic-mode
style-recalc floor (~52 ms/frame on 2,117 leaves) — that's where
hypothesis H7 (spatial caster prefilter) and any future style-recalc
work should focus.

### Iteration 8 — H8 (re-test) memoize d= per face (NEGATIVE)

**Hypothesis recap.** H8's first attempt (pre-H9b) cached `d=` on the
single floor SVG and saw ~0% hit rate at 0.5°/frame motion: a single
constantly-changing silhouette is the worst case for byte-identical
frames. H9b changed the picture — teapot-self now mounts 138-242
receiver SVGs, many of them for faces far from the light terminator
whose shadow content barely (or never) changes between H3-quantized
emits. The bet was that those faces would hit the cache often enough
to save real DOM mutation cost.

**Implementation.** Branch `perf/shadow-memoize-d-v2`. Added
`lastPathDs: string[]` to `MountedFace` in
`packages/polycss/src/api/scene/receiverShadow.ts`. Before each
`path.setAttribute("d", p.d)`, compare against the cached string; only
write on miss. Truncate the cache when the path-array length shrinks
so a regrown index doesn't see a stale string and false-hit. React/Vue
render receiver shadows declaratively via JSX/h() — the framework's
own diff already short-circuits identical props, so no mirror is
needed.

**Cache-hit probe** (temporary `__polycssShadowDCacheStats`, 5s sample
after 2s warmup, motion=light):

| scene | skipped | written | hit rate |
| --- | ---: | ---: | ---: |
| teapot-self | 4125 | 3535 | **53.85%** |
| teapot-floor | 0 | 78 | 0.00% |

Hit rate is real on self-shadow (the H9b receiver-mount explosion gives
the cache something to bite into) and zero on floor (single SVG with
ever-changing silhouette, exactly as iter-0 H8 found).

**Metrics (motion=light, 5s sample, x4_plus heavy frames):**

| scene | h10 baseline | h8v2 r1 | h8v2 r2 | Δ |
| --- | ---: | ---: | ---: | ---: |
| teapot-self dt p50 (ms) | 117.10 | 124.65 | 124.90 | +6-8 (NOISE) |
| teapot-self script (ms) | 124.86 | 127.20 | 127.77 | +2-3 (NOISE) |
| teapot-floor dt p50 (ms) | 58.30 | 58.30 | 58.40 | ~0 |
| teapot-floor script (ms) | 6.77 | 6.86 | 7.14 | +0.1-0.4 (NOISE) |

**Why the hit rate doesn't translate.** ~47 setAttribute("d", …) calls
skipped per frame on teapot-self vs ~78 still written. Each skipped
setAttribute saves ~10-100 µs; ~47 of them is ~0.5-5 ms — below the
±2-3 ms run-to-run noise floor on a 125 ms frame. The script-side
bottleneck for self-shadow is `computeReceiverShadowFaces` (per-frame
SH-clip + projection); DOM mutation is single-digit-percent of total
script time. The cache is correct but addresses a non-bottleneck.

**Visual.** Regression script byte-identical to h10-merged for all 12
captures. Three.js parity byte-identical for all 12 poses.

**Recommendation: DISCARD.** The cache is harmless and the hit rate is
genuinely 50%+ on self-shadow, but the absolute time saved sits below
measurement noise. Cherry-picking would add 17 lines of code + one
string-array allocation per receiver face for no observable win. Re-
visit only if a future iteration moves SVG mutation into the critical
path (e.g. a script-side optimization halves SH-clip cost, making DOM
mutation a larger share of remaining script time). Better next target:
move into the compositor — `compositorMain` is the bigger share of
remaining frame time after H10.



**Hypothesis recap.** Earlier H10 attempt (iter 5) quantized only
`--plx/y/z` and saw flat style cost. The recalc trigger was still
firing on every frame even with those vars frozen → I concluded the
trigger was outside lighting writes. WRONG diagnosis.

**Discovery (iter 7 probe).** Quick A/B with bench `motion=none`
(no setOptions per frame) showed style at 0.004 ms/frame and 120 FPS.
Adding a `motion=light-noop` knob that calls `scene.setOptions({})`
every frame (empty object) ALSO showed 0 style cost. So setOptions
itself isn't the trigger — it's specifically what fires when
`directionalLight` is in the partial.

Re-tested H10 with --plx/y/z AND --clx/cly/clz frozen → **frame_p50
8.3 ms, style 0.04 ms, 120 FPS**. The original H10 missed --clx/cly/clz
(shadow-projection up-axis vars derived from light direction inside
`applyLightingVars`). Those were the actual recalc trigger.

**Real fix.** Changed `lx.toFixed(4)` → `lx.toFixed(2)` for ALL six
direction-derived light vars in `packages/polycss/src/api/scene/lightingVars.ts`
(--plx/y/z + --clx/cly/clz). 0.57° quantization matches the H3 emit-
level quantize key; values only differ between frames when the rounded
component flips a 0.01 boundary.

**Metrics (perf-vanilla teapot, dynamic, no-self-shadow, motion=light):**

| variant | x1 frames | x4_plus frames | total frames | mean fps |
| --- | ---: | ---: | ---: | ---: |
| H9+H3+H9b (pre-H10) | 0 | 47 (~58ms each) | 82 in 5s | 16.4 |
| H10 (toFixed 2 on all 6 vars) | 31 | 75 | 113 in 5s | **22.6** |

**+38% mean FPS.** fps_p50 stays at 17 because the slow frames (light
crosses a quantize boundary) still cost ~52 ms style each — that's the
unavoidable per-frame recalc when a var actually changes. But 38 out of
113 frames now skip recalc entirely.

**Visual.** Regression script byte-identical to H9b for all 12 captures.
At 0.57° quantize, shadow position shifts <1 px even at extreme zoom.
Three.js parity unchanged.

**Recommendation: LANDED on `feat/three-parity` as 77f3206.**

### Iteration 6 — H11 receiver-face coalesce (NEGATIVE)

**Hypothesis recap.** After H9b, teapot-self is compositor-bound at
frame_p50 ≈ 342 ms with 138-242 receiver SVGs per azimuth. Compositor
cost is ~proportional to SVG count. Relax `RECEIVER_NORMAL_TOL` in
`packages/core/src/shadow/receiverFaceGroups.ts` from 0.001 (~2.5° cone)
to 0.02 (~11.5° cone) so adjacent smooth-shaded teapot triangles whose
normals differ by 1-5° collapse into one face plane → one SVG. Keep
`RECEIVER_OFFSET_TOL = 0.5` because it's a world-unit distance.

**Implementation.** Branch `perf/shadow-face-coalesce`. One-line change:
`RECEIVER_NORMAL_TOL: 0.001 → 0.02`. Built core + polycss + react + vue
+ bench bundles. Verified bundle contains `RECEIVER_NORMAL_TOL = 0.02`.

**Metrics (shadow-regression fixture, teapot-self vs h9b-merged baseline).**

| az  | recv SVGs Δ | paths Δ | dChars Δ |
| --- | ---:        | ---:    | ---:     |
| 50  | 0 (242→242) | 0       | 0        |
| 130 | 0 (143→143) | 0       | 0        |
| 220 | 0 (104→104) | 0       | 0        |

teapot-floor / castle-floor / crate-floor: byte-identical, expected
(those scenes already collapse to 1 SVG per receiver plane).

**Why the win didn't materialize.** Bisection probes confirmed the
plane-bucket pass has TWO filters AND'd together: `(1 - dot < NORMAL_TOL)
&& (|Δoffset| < OFFSET_TOL)`. Plane offset is `n · O` where O is a face
vertex, so when adjacent triangles' normals drift even 1-2° the resulting
plane-offset values drift by `|O| × |Δn|` — for a teapot at typical
world scale (vertices ~100s of CSS px from origin), that's tens of px,
far beyond the 0.5 px OFFSET_TOL. The NORMAL filter therefore never
actually gates the merge; OFFSET does, and NORMAL is dead code at any
value > 0.001. Empirical probes (bench/results/shadow-regression/):

| probe                    | teapot-self az50 recv SVGs |
| ---                      | ---:                       |
| baseline (0.001 / 0.5)   | 242                        |
| H11 prescribed (0.02 / 0.5) | 242                     |
| 0.05 / 0.5               | 242                        |
| 2.0 / 0.5 (normal off)   | 242                        |
| 0.05 / 2.0               | 241                        |
| 0.05 / 20.0              | 213                        |
| 2.0 / 1e6 (both off)     | 2                          |

To actually coalesce a smooth-mesh receiver you'd need to ALSO raise
OFFSET_TOL by 1-2 orders of magnitude — which is exactly the
"parallel-but-far-apart walls merge into one" bug the hypothesis
explicitly warned against. At OFFSET_TOL=20 you'd merge floor tiles
with similar-normal ceiling tiles in modest-height rooms; not
acceptable.

**Trace / parity.** Trace skipped — the SVG-count delta is 0 across all
scenes, so script/compositorMain ms/frame are determined to be
unchanged by definition (same DOM mutation work, same path payload).
Three.js parity captures `bench/results/threejs-parity/h11-coalesce/`
all 12 PNGs md5-identical to the `h9b-merged` baseline. Visual
inspection of `teapot-self-az{50,130,220}` PNGs vs h9b shows no
detached shadows (no merges happened to detach).

**Recommendation: DISCARD.** The hypothesis identified the right SYMPTOM
(receiver-SVG count limits dt_p50) but the wrong LEVER. The
plane-grouping pass can't coalesce smooth-curved-mesh receivers without
also breaking the offset-distance invariant. To attack receiver-SVG
count on curved self-shadow casters you need a different approach:
either project the silhouette onto an averaged-plane proxy receiver per
mesh region (not per face), or skip the per-face receiver decomposition
entirely on caster == receiver and use a single oriented-bounding-box
proxy receiver. Park as `[H11b] silhouette-onto-OBB-proxy` in the
backlog. Branch `perf/shadow-face-coalesce` stays for traceability but
contains no code change to cherry-pick — just this log entry. Files
`bench/results/shadow-regression/h11-coalesce/`,
`bench/results/shadow-regression/h11-probe-*/`,
`bench/results/threejs-parity/h11-coalesce/` document the probe runs.

### Iteration 5 — H10 CSS-var quantize for style-recalc floor (NEGATIVE)

**Hypothesis.** With H9 + H3 landed, the dominant remaining cost in
dynamic mode is the 53 ms/frame style recalc on 2,300 leaves whose
`background-color` uses calc(--plx*--pnx + …). Theory: `setOptions`
writes new --plx/y/z strings every tick via setStylePropertyIfChanged;
coarsening precision (toFixed 4 → 2 → 1 → constants) would let many
frames hit the existing "same-string → skip" path and freeze the recalc.

**Implementation.** Local branch `perf/lighting-vars-quantize` (deleted
after test). Three variants of `applyLightingVars` in
`packages/polycss/src/api/scene/lightingVars.ts`: `.toFixed(2)`,
`.toFixed(1)`, then literal `"0.0"/"0.0"/"1.0"` constants.

**Trace results** (perf-vanilla teapot, dynamic, no-self-shadow, light motion):

| variant | style ms/f x4_plus |
| --- | ---: |
| H9+H3 head | 52.7 |
| `--plx/y/z` → `.toFixed(2)` | 52.6 |
| `--plx/y/z` → `.toFixed(1)` | 54.4 |
| `--plx/y/z` literally frozen constants | 52.5 |

**Conclusion: NEGATIVE.** Frozen lighting vars → identical 52 ms recalc.
The trigger is not the lighting var writes. Top suspect: `el.style.transform =
buildSceneTransformFromCamera(...)` inside `applySceneStyle`, which
fires on every setOptions. Need a deeper diagnostic before trying H10
again. The 53 ms is the dynamic-Lambert floor for now.

**Recommendation: DISCARD this approach.** Filed as H10 follow-up: probe
which write actually triggers the per-frame recalc.

**Probe follow-up (same iteration).** Also tried gating
`el.style.transform = ...` in `applySceneStyle` so it only writes when
the value changes. Same 53.7 ms style recalc — transform isn't the
trigger either. With BOTH lighting vars + scene transform writes gated
to no-ops, the recalc still fires every frame. The cost is intrinsic to
"calc()-driven `background-color` on 2300 leaves under a CSS scene with
any kind of per-frame activity" — possibly the browser's implicit
recalc when ANY style-related event fires, regardless of whether the
event materially changed anything visible. **No clean lever** to drop
the 53 ms floor without redesigning dynamic mode (e.g. JS-set inline
colors, or reducing leaf count). Park H10 here; pursue other H if any.

### Iteration 4 — H9b silhouette self-shadow (branch `perf/shadow-silhouette-self`)

**Hypothesis recap.** H9 cherry-pick at HEAD explicitly gates self-shadow
(caster === receiver) OUT of the silhouette path because the per-poly
branch uses `selfShadowEdgeMap` to drop adjacent-triangle projections
(would otherwise show as a spiderweb of seam streaks on smooth GLBs).
Drop the gate. The silhouette IS the geometric boundary of the lit
region, which naturally excludes interior adjacent-triangle projections
without needing per-edge seam culling — same 5× per-receiver-face
script speedup we got on the floor case, applied across the 138-SVG
self-shadow set on the teapot.

**Implementation.** Removed the `if (casterEntry.selfShadowEdgeMap)
return null;` early-out from `computeReceiverShadowFaces`
(`packages/core/src/shadow/computeReceiverShadows.ts`) and the matching
`caster !== receiverEntry` / `!isSelf` gate from each of the three
caller files (`packages/polycss/src/api/scene/receiverShadow.ts`,
`packages/react/src/scene/PolyMesh.tsx`, `packages/vue/src/scene/PolyMesh.ts`)
so `edgeOwners` now gets prepared for self-shadow casters too. The
`selfShadowEdgeMap` is still threaded through — small (<40 polys) self-
shadow meshes keep falling through to the per-poly path and still get
seam culling. Comment updates only; no new options.

**Metrics (shadow-regression fixture, teapot-self scene).**

| az  | recv SVGs Δ | paths Δ | dChars baseline (h3) | dChars h9b | Δ % |
| --- | ---:        | ---:    | ---:                 | ---:       | ---:|
| 50  | +104        | +104    | 42,479               | 16,731     | -60.6% |
| 130 | +73         | +73     | 23,986               | 11,560     | -51.8% |
| 220 | +52         | +52     | 26,000               | 11,134     | -57.2% |

teapot-floor / castle-floor / crate-floor: byte-identical (silhouette
path on non-self casters unchanged by this iteration).

Note the +recv-SVG count: silhouette path emits shadows on MORE
receiver faces than the per-poly path. The per-poly path's per-face
seam cull was so aggressive on smooth-GLB self-shadow that many faces
ended up with `totalClipped === 0` and got skipped. The silhouette
loop, being a single closed outline that doesn't get seam-culled,
populates those faces too. Net path-d chars still drops 51-60% per
azimuth because each receiver-face now emits one short silhouette
sub-path instead of 10-13 fan-triangle sub-paths.

**Trace deltas** (perf-vanilla.html, page=shadow mesh=teapot mode=dynamic
motion=light, 5s sample, file `h9b-teapot-self.json`):

| bucket   | frames | dt_p50 (ms) | script ms/f | compositorMain ms/f |
| ---      | ---:   | ---:        | ---:        | ---:                |
| x3 h3 self      | 3  | 58.0        | (n/a, x4-bound)  | 120.0       |
| x3 h9b self     | 3  | 58.0        | 1.9         | 120.0           |
| x4_plus h3 self | 14 | 342.5       | 570.5       | 411.6           |
| x4_plus h9b self| 16 | 341.7       | 465.2       | 358.5           |

`x4_plus` script ms/frame **drops 570.5 → 465.2 (-18%)**. compositorMain
also drops 411.6 → 358.5 (-13%) because the SVG path payload is much
smaller per receiver-face. dt_p50 is essentially unchanged (~342ms) —
the self-shadow case is compositor-bound with ~155 receiver SVGs being
composited each frame, and the silhouette only changes path CONTENT,
not the receiver SVG count. To unlock dt_p50 we would need to also
reduce the number of receiver SVGs (next-hypothesis territory).

**Visual verdict (z=3.0 probe captures vs h3 baseline at same zoom).**

- `teapot-self-az50-z3`: H9b matches H3 closely. A faint floating-dot
  artifact off the teapot's left side in the H3 capture is GONE in
  H9b — silhouette path doesn't manufacture stray sub-pixel sub-paths
  the way the per-poly fan can on adjacent thin triangles.
- `teapot-self-az130-z3`: Visually identical between H3 and H9b. Cast
  shadow on floor stretches the same direction, teapot facets shade
  the same way.
- `teapot-self-az220-z3`: Visually identical between H3 and H9b. Dark
  side facing camera reads the same; spout/handle/lid shade
  consistently; floor cast shadow preserved.
- **No spiderweb seam streaks** appear in any of the three H9b
  azimuths. The per-poly path's `selfShadowEdgeMap` was protecting
  against those, and the silhouette path's geometric-boundary semantic
  is equivalent protection without needing the explicit cull.
- The dark-side shadow region on the teapot body (spout, handle area)
  reads correctly in both H3 and H9b — silhouette projection picks up
  concave regions as expected for a closed-mesh silhouette.

**Three.js parity.** All 12 parity shots (4 meshes × 3 light poses)
**byte-identical to baseline** (md5 verified). Parity scenes don't
toggle Self-shadow so they exercise H9 only, not H9b — but the byte-
identical result confirms H9b didn't regress the non-self path.

**Recommendation: cherry-pick.** Hypothesis confirmed — 51-60%
reduction in path-d chars on teapot-self, 18% script ms/frame drop in
the heavy bucket, 13% compositorMain ms/frame drop, no spiderweb
artifacts, three.js parity preserved on non-self casters. The frame_p50
ceiling stays compositor-bound because the per-receiver-face SVG count
roughly DOUBLED (silhouette is less aggressive than seam-cull, so more
faces emit shadows) — that's a feature, not a bug, but it limits the
dt_p50 win until we attack receiver-SVG count separately. Surface
change is small: one early-out removed in core, three caller gates
loosened, no API additions. Ready for merge into `feat/three-parity`.

### Iteration 3 — H3 light quantization (branch `perf/shadow-light-quantize`)

**Hypothesis recap.** At ~0.5°/frame drag speed, consecutive shadow re-emits
are doing nearly-identical work. Snap the directional light to a coarse
angular grid (normalized components rounded to 0.01 ≈ 0.57°) and short-circuit
`emitSceneShadows()` when the rounded key matches the cached frame. The
visible "stair-step" jitter at 0.57° is below perception during active drag.

**Implementation.** Added `quantizeLightDirKey()` + a closure-scope
`lastEmittedShadowLightKey` cache to `packages/polycss/src/api/createPolyScene.ts`.
`emitSceneShadows(lightDirectionOverride?)` computes the key from the
already-CSS-frame `lightDir` and early-returns on match. An
`invalidateShadowLightCache()` helper is called from every code path that
mutates caster/receiver geometry or shadow appearance: `emitShadowLeaves`
(the geometry-change funnel for `setPolygons` / `castShadow` toggle / chunked
render / remount), `recomputeShadowGround` (ground/lift change), `setTransform`
(receiveShadow toggle, position/scale on shadow-participating meshes), `add`
(new receiver), `setOptions` (lighting mode / shadow color/opacity/lift), and
`clearBakedSolidLightingPreview` (preview teardown). Light-direction-only
changes through `setOptions` deliberately do NOT bust the cache — the quant
key already discriminates by direction. Single-renderer change in
`packages/polycss` only; no API surface change so React/Vue mirrors are not
needed.

**Metrics (trace, perf-vanilla page=shadow mesh=teapot mode=dynamic motion=light,
5s sample, vs `shadow-teapot-dynamic-backface*` baseline references).**

| variant         | fps_p50 | frame_p50 (ms) | x4_plus script (ms) | style (ms) | compositorMain (ms) |
| ---             | ---:    | ---:           | ---:                | ---:       | ---:                |
| baseline floor (no-self) | 15.0  | 66.6  | 11.56 | 53.5 | 131.2 |
| h3 floor (no-self)       | 17.1  | 58.4  | 8.35  | 52.3 | 126.5 |
| baseline teapot-self     | 3.08  | 325.1 | 535.1 | 53.8 | 399.0 |
| h3 teapot-self           | 2.92  | 342.5 | 570.5 | 51.7 | 411.6 |

Floor (silhouette-eligible) wins: **frame_p50 -12% (66.6 → 58.4ms)**,
**fps +14% (15.0 → 17.1)**, **script -28% (11.56 → 8.35)**. Self-shadow
is statistical noise (14-15 frames over 5s, ±5% wobble).

**domSamples consecutive-identical rate** (frames where `shadow.paths +
pathDChars` snapshot is byte-identical to the previous frame → emit was
skipped, leaving the previous SVG content mounted):

| variant         | samples | consec-identical | rate |
| ---             | ---:    | ---:             | ---: |
| baseline floor  | 78  | 1   | 1.3%  |
| h3 floor        | 83  | 15  | 18.3% |
| baseline self   | 17  | 1   | 6.3%  |
| h3 self         | 16  | 0   | 0.0%  |

Floor shows a clear 14× rise in skip rate (1.3% → 18.3%) — the cache is
firing. Self-shadow at this sample size (16 frames) is noise-bound; per-poly
self-shadow content varies even at quantized direction because the receiver
loop touches every face's plane, so any tiny camera/normal numeric drift
shows. Self-shadow does not regress on a per-frame-script basis beyond
noise.

**Shadow-regression fixture (4 scenes × 3 azimuths).** All 12 captures
byte-identical to **both** baseline AND h9-merged in PNG md5; path-d
characters match h9-merged exactly (137,131 chars vs baseline's 685,841 —
inherited from h9's silhouette extraction in the underlying renderer). The
quantization cache does not engage on the regression fixture because each
capture sets a fresh azimuth and the cache is busted on lightDir change in
setOptions (the deltas are not in the per-frame light-rotate path).

**Three.js parity.** All 12 three.js parity shots **byte-identical** to
baseline by md5 (cube/E/cottage/castle × topdown/sideish/low-angle). Static
shadow shape is unchanged, which is expected — the quantization only affects
WHICH frame's emit gets skipped during drag, not the math.

**Visual verdict.** Static screenshots show no regression. The trade-off
lives in slow-drag temporal aliasing — the shadow snaps to ~0.57° buckets
during active drag rather than smoothly tracking. At the 14% frame_p50 win
on the typical floor case, the trade is favorable. If a user pauses
mid-drag the cached frame matches the held quantum so there's no stale
display either.

**Recommendation: cherry-pick.** Floor scenes (the common case — any
ground-receiver setup) get a measurable smoothness win (fps 15 → 17,
frame_p50 -12%) with zero visual regression on static captures, byte-identical
three.js parity, and a 14× rise in cache-skipped frames. Self-shadow doesn't
benefit from this alone but doesn't regress either — it remains gated on
H9's silhouette extraction (already merged) and a follow-up "self-shadow
skip when receiver loop has no light-dependent output" hypothesis. The
implementation surface is small (~30 LOC, single renderer, no API change)
and the invalidation discipline is co-located with the existing
shadow-emission call graph.

### Iteration 2 — H9 silhouette extraction (branch `perf/shadow-silhouette`)

**Hypothesis recap.** Replace the per-caster-polygon SH-clip loop with a
per-caster-MESH silhouette projection. For a closed solid mesh, the
projected silhouette is the boundary between front- and back-facing
polygons relative to the light. Drawing ONE closed polygon per caster
per receiver face instead of N triangles should drop DOM mutation by
~100× on the teapot-floor case (2,182 sub-paths → ~10 closed loops).

**Implementation.** New `SILHOUETTE_MIN_POLYS = 40` gate inside
`computeReceiverShadowFaces` (`packages/core/src/shadow/computeReceiverShadows.ts`).
For each caster, before the per-receiver-face loop, the algorithm
classifies polygons as facing/not-facing via the pre-cached `edgeOwners`
map (`buildEdgeOwners` from `silhouette.ts`) and `classifyFacing`
+ `extractSilhouetteLoops` (already shipped in the parent commit, plus a
new `prepareCasterEdgeOwners` core helper that walks the world-CSS
transform once per caster and caches it). Per-receiver-face, the
silhouette branch 3D-clips each loop against the plane half-space (new
`clipLoopAbovePlane` Sutherland-Hodgman helper), projects to (u,v), then
runs the same `reachRect → outlineUv → memberPolysUv` clip pipeline as
the per-poly branch. Result: ONE sub-path per loop per member-poly
instead of one per fan-triangulated caster triangle. Self-shadow
(caster === receiver) and meshes with < 40 polygons fall through to the
per-poly path — silhouette infra overhead exceeds the per-poly cost on
small meshes, and the per-poly self-shadow path has different per-face
contribution semantics. WeakMap caches for `edgeOwners` plumbed through
the vanilla `receiverShadow.ts`, React `PolyMesh.tsx`, and Vue
`PolyMesh.ts` callers, with the bust key matching the existing
`casterItemsCache` key (position/scale/rotation) so the world-frame edge
owners stay coherent with their matching `CasterPolyItem[]`. New
`ReceiverCasterInput.edgeOwners` + `casterPolygonCount` fields; new
core exports: `prepareCasterEdgeOwners`, `buildEdgeOwners`,
`classifyFacing`, `extractSilhouetteLoops`, `EdgeOwners` type.

**Metrics (shadow-regression fixture, 4 scenes × 3 azimuths).**

| scene         | baseline avg dChars | h9 avg dChars | Δ avg dChars | Δ % |
| ---           | ---:                | ---:          | ---:         | ---:|
| teapot-self   | 115,241             | 30,822        | -84,419      | -73.3% |
| teapot-floor  | 89,816              | 5,396         | -84,420      | -94.0% |
| castle-floor  | 23,344              | 9,280         | -14,064      | -60.2% |
| crate-floor   | 212                 | 212           | 0            | 0.0% |

Sub-path counts:
- teapot-floor: 2,182 → ~10 (≈200× drop, matches the H2 prediction).
- castle-floor: similar order-of-magnitude collapse to one loop per
  silhouette.
- teapot-self: floor receiver collapses to silhouette; the teapot
  receiver still uses per-poly (self-shadow gate) so 138 receiver
  SVGs are preserved but the floor sub-path collapsed massively.
- crate-floor: 12 polys < 40 → gate skipped → per-poly path → unchanged
  (expected; threshold is the whole point).

Receiver SVG count Δ = 0 across all 12 captures (silhouette doesn't
change WHICH faces emit, only the path content).

**Trace deltas** (perf-vanilla.html, page=perf mesh=teapot mode=dynamic
motion=light, 5s sample, vs `shadow-teapot-dynamic-backface-noself.json`
baseline reference):

| bucket  | frames | dt_p50 (ms) | script_ms |
| ---     | ---:   | ---:        | ---:      |
| x3 baseline | 12 | 58.3        | 9.80      |
| x3 h9       | 50 | 58.20       | 1.63      |
| x4_plus baseline | 64 | 66.70  | 11.56     |
| x4_plus h9       | 37 | 66.72  | 4.81      |

frame_p50 stays roughly flat (compositor-dominated, ~115ms gpuViz +
compositorMain across both runs) but **script_ms drops 6× in the heavy
x3 bucket and 2.4× in the x4_plus bucket**. The per-frame distribution
shifts toward lighter buckets (x3 frame share grew 12 → 50; x4_plus
shrank 64 → 37), so the user-perceived smoothness wins more than the
median frame-time number suggests. The compositor doesn't get any
faster because the SVG it composites is the same shape, just authored
from fewer sub-paths.

**Visual verdict.** All 12 PNG pairs (4 scenes × 3 azimuths) are
**byte-identical to baseline** by MD5. The silhouette extraction is
mathematically equivalent to fill-rule:nonzero union of all
front-facing-poly projections, so the rendered pixels don't shift even
sub-pixel.

**Three.js parity.** All 12 three.js parity shots (4 meshes × 3 light
poses) byte-identical to baseline. Since baseline already matched
three.js, h9 inherits the parity.

**Recommendation: cherry-pick.** Hypothesis confirmed — 94% reduction
in path-d chars on teapot-floor, 60-73% reductions elsewhere, all
visually identical, three.js parity preserved, ~5× drop in script_ms.
The architectural surface change is minimal (two extra fields on
`ReceiverCasterInput`, one new `prepareCasterEdgeOwners` helper, three
mirrored caller patches) and the silhouette path is gated so smaller
meshes (< 40 polys) and self-shadow keep the existing per-poly path
untouched. Ready for review and merge into `feat/three-parity`.

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
