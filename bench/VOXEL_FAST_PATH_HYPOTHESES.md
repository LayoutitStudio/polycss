# Voxel Fast Path Hypotheses

Actionable ledger for the `.vox` renderer performance investigation. This file
tracks DOM shape, renderer strategy, paint/composite cost, and hidden browser
fast paths. It intentionally avoids website UI hypotheses.

## Status Legend

| Status | Meaning |
| --- | --- |
| ✅ Accepted | Keep this direction unless stronger evidence appears. |
| ❌ Rejected | Do not retest without a new reason. |
| 🧪 Test next | High-signal experiment to run soon. |
| ⚠️ Conditional | Promising only if a cheap, general gate predicts wins. |
| 🟡 Flat | Tested; no useful movement. |
| 🔬 Ceiling | Useful to understand an upper bound, not current architecture. |
| 👀 Watch | Track while testing nearby hypotheses. |

## Marking Rules

- Mark ✅ only when the result works across renderer-only voxel model classes:
  dense, sparse, tall, wide, flat, multi-color, high-plane-count, and noisy.
- Mark ❌ when a hypothesis regresses p95/p99 materially, fails visual checks,
  or contradicts trace evidence.
- Mark ⚠️ only when the win is real but needs a cheap structural predicate.
- Keep raw FPS tables and traces in result artifacts; keep this file focused on
  hypotheses and decisions.

## Current Baseline

Current accepted voxel fast path:

| Layer | Shape |
| --- | --- |
| Scene | One transform/perspective scene root. |
| Mesh | One `.polycss-mesh` wrapper. |
| Voxel hosts | None. |
| Leaves | Plain hostless `<b>` direct-matrix voxel quads. |
| Primitive | Desktop-class documents use 1px; mobile-class documents use 8px with divided matrix scale to avoid GPU filtering gaps. |
| Positioning | One canonical `matrix3d(...)` per mounted voxel quad. |
| DOM order | Projected screen-space `tile4-scanline-forward`. |
| Culling | Only camera-facing face directions are mounted. |

Current read:

- Extra 3D wrappers are expensive.
- Lower DOM count alone is not a reliable cost model.
- Direct-matrix voxel leaves still need `transform-style: preserve-3d`.
- A1 traces show the current polycss-vs-voxcss delta is compositor/layerization
  work, especially `PaintArtifactCompositor::Update`, `Layerize`, and
  `LayerTreeImpl::UpdateDrawProperties`. Raster is zero in these samples.
- `LayerTree.enable` is intrusive enough to perturb FPS; use it only as an
  opt-in layer-shape diagnostic, not as the primary FPS comparison.
- Naive scene-box variants can hit a much faster compositor path on
  `AncientCrashSite.vox`, but current versions are visually invalid: blank,
  cropped, or off-center. Origin-pinned, scene-matrix-compensated, and
  mesh-compensated versions preserve the image but lose the win, so the fast
  path appears tied to the invalid transform chain itself.
- Corpus runs must normalize visual fit before conclusions. Fixed
  `POLY_ZOOM=0.35` cropped `army.vox` badly; the apparent voxshell win there
  was mostly a different fit, not a renderer win.
- First zoom-normalized corpus pass: `AncientCrashSite`, `Treasure`, `army`,
  and `HUT` are roughly flat; `Garden`, `skyscraper`, and `MechaGolem` favor
  polycss; `scene_vehicles1` slightly favors voxcss. Brush count alone does
  not predict those outcomes.
- Mounted brush count changes can explain isolated p99 spikes, but not steady
  slow paths. `army.vox` voxcss had a 58ms frame at a brush-count transition;
  `Garden.vox` voxcss kept a constant brush count and still stayed slow.
- A12 structural metrics improved observability but did not produce a complete
  predictor yet. Brush count, local area, plane-fill ratio, and screen bounds
  each fail on at least one representative model.
- Matched-zoom `targetSize` sweeps from 50 to 90 changed local brush area by
  several multiples but were flat on `Garden`, `skyscraper`, `MechaGolem`, and
  `AncientCrashSite`.
- Equivalent `<div>` voxel brushes, leaf `will-change: auto`, a broader
  voxel-brush CSS reset, and `inert`/`aria-hidden` were flat. Host clipping was
  visually invalid.
- DPR 1 vs DPR 2 in headless Chromium was flat on `Garden`, `MechaGolem`, and
  `AncientCrashSite`; the browser-mode question is now headed/current-vs-canary
  rather than device pixel ratio.
- Headed/system/Canary browser mode changes absolute ceilings and can shrink
  apparent gaps. `MechaGolem` is a major example: bundled Playwright Chromium
  made polycss look far ahead, while installed Chrome/Canary put polycss and
  voxcss near parity. `Garden` still favored polycss across browser modes.
- Paint and style are not the current bottleneck. On high-color `army.vox`,
  traces showed single-digit milliseconds in style/paint across the whole
  sample while compositor/layer lifecycle was hundreds of milliseconds.
- Synthetic classes are useful. Dense cubes and thin slabs are flat, sparse
  separated voxels favor voxcss, and noisy/high-color scenes are mostly flat;
  this exposes thresholds that the gallery corpus alone hides.
- Pre-default matrix-vs-slice selection work is now historical evidence, not a
  routing plan. The 86-model cadence corpus found matrix p95 wins on
  `desert2`, `scene_hazmat`, `scene_house`, `scene_mechanic2`,
  `scene_sidewalk`, and `Treasure`; slice p95 wins on `AncientCrashSite`,
  `armchair`, `christmas_tree`, `ff1`, `mailbox`, `obj_house3`, `obj_house8`,
  `obj_trashcan4`, `pyramid`, and `scene_park`; 66 models are flat or capped.
  Active leaves, local area, visible planes, raw source color count, and screen
  fill each have counterexamples, so do not revive this as a gate without new
  GPU-hard proof.
- Visible shaded brush color count was a useful partial historical selector,
  and it is different from raw source color count. `visibleShadedColors >= 52`,
  computed from the current polygon brush plan and baked lighting, captures four
  validated strong matrix wins (`scene_hazmat`, `scene_house`,
  `scene_mechanic2`, `Treasure`) and no validated strong slice wins, but it
  misses `desert2` and `scene_sidewalk`, hits many flat/capped scenes, and
  creates one p99 regression on `scene_house3` if used by itself. Adding
  `visiblePlanes < 200` keeps the same p95 wins and removes that p99 loss in
  the old corpus, so it remains a diagnostic only.
- Browser probes on Chrome 148 and Canary 150 keep the refined high-shaded
  gate safe but not universally profitable: `scene_house`, `scene_mechanic2`,
  `Treasure`, and `desert2` stay matrix; `scene_hazmat` can flatten in Chrome;
  `scene_sidewalk`, `pyramid`, and `obj_house3` are browser-ceiling sensitive.
- Headed Chrome tightens that warning: `scene_house` flattens in headed mode
  even though it is a headless matrix win. Treat the old selector as diagnostic
  evidence, not a reason to add a router.
- The browser compositor backend is first-order. Bundled Playwright Chromium
  can fall onto `SoftwareRenderer::DoDrawQuad`; the perf-facing bench scripts
  now default to the GPU lane (`--use-angle=metal` on macOS plus
  `--enable-gpu-rasterization`) because that removes the software renderer and
  can move medium voxel scenes from the 60fps bucket to the 110+fps bucket
  without changing DOM.
- A bench-only adaptive route (`polycss-adaptive-shaded`) proved the
  high-shaded gate could be computed before mount and route the renderer. It
  catches `Treasure`, keeps `AncientCrashSite` and `scene_house3` on slices,
  and routes capped high-shaded models as expected. It still misses `desert2`,
  which remains a large low-color matrix win, so the selector is incomplete
  and superseded by the one-strategy direct-matrix baseline.
- Target-size sweeps on `desert2` and `scene_mechanic2` rule out CSS cell size
  and local brush area as the cause of the matrix wins. Slice area changed by
  several multiples while p95 stayed in the same cadence bucket.
- Five-repeat validation is required for selector work. Two-run sweeps created
  apparent wins on `scene_sumo`, `scene_parked`, `scene_hunt`, and
  `scene_house5` that disappeared under validation.
- Existing non-product prototypes are not valid ceiling proof. `polycss-slice-
  proto` can improve p95, but screenshots fail the visual check by flattening
  or otherwise changing the 3D render.
- Chromium source confirms a real but partial fast path for declarative
  transform animation. Active compositor transform animation can directly
  update the cc transform node and skip full `PaintArtifactCompositor::Update`;
  JS `style.transform` mutation from `scene.setOptions()` does not hit that
  gate in our traces. The direct path still marks the transform tree dirty, so
  `LayerTreeImpl::UpdateDrawProperties` and draw remain the next bottleneck.
- Follow-up probes narrow that animation fast path: running CSS keyframes and
  running WAAPI skip PAC, but paused WAAPI scrubbed with `currentTime` and a
  scroll-timeline scrubbed by JS `scrollLeft` both fall back into PAC. Treat
  declarative animation as an auto-rotate-only candidate until a browser probe
  proves otherwise.
- Software-lane synthetic depth-group probes originally suggested only a very
  strict low-wrapper gate: 17 wrappers could win, 50 already lost cadence, and
  250 collapsed. A218 supersedes the absolute threshold for the default bench
  lane: GPU keeps grouped 2D children clean to roughly 112 wrappers, then
  falls around 128+ and collapses by 136/192.
- A bench-only real-model depth-group variant still does not justify a default
  product path. The old sub-30-plane gate was too conservative for GPU, but
  the currently hard high-leaf models still exceed the clean GPU wrapper range.
  Use exact depth wrappers only if a real model is GPU-hard, visually exact,
  and at or below the validated wrapper threshold.
- A corrected hostless direct-matrix voxel prototype identifies the portable
  part of matrix wins. `polycss-polybox` showed that parsed polygons inside
  axis hosts still fall to slice cadence on `desert2`; `polycss-voxlocal-
  direct-matrix` folds the axis host into each leaf's canonical `matrix3d`
  with a normal column and transfers the `desert2` win. That shape became the
  current default after visual checks, cleanup, and tile4 order validation; the
  remaining question is no longer slice-vs-matrix routing, but why high-leaf
  GPU-hard scenes still fall below the cap.
- Exact direct matrix is now the one-leaf-shape baseline, and the hard part is
  DOM/paint order. Global projected-depth order transfers matrix wins to
  `desert2`, `house`, `scene_mechanic2`, `Treasure`, and `army`, while fixed
  face order rescues `obj_house3` and stays neutral on
  `AncientCrashSite`/`skyscraper`.
- Hybrid order attempts did not produce a universal rule. Face-depth sorting
  and depth bands with face locality regress key cases; alternate static face
  orders and face-normal order trade one model class for another. The most
  important trace result: same-node-count order flips have almost identical
  PAC/DrawProps/Draw cost per frame, but radically different vsync cadence.
  That points at Chromium's 3D compositor sorting/overlap critical path rather
  than normal style, layout, paint, or node-count costs.
- Scene-shell transform decomposition does not appear to be the missing fast
  path. Bench-only A112-A114 variants serialized the root transform to
  `matrix3d(...)`, moved target translation to an inner shell, moved
  `perspective` to the host, folded `perspective(...)` into the transform
  list, and removed the scene `will-change` pin. The only apparent win was a
  short Desert2 cadence artifact; longer default-vs-no-will-change validation
  was flat across Garden, `obj_house3`, Desert2, and `scene_house3`.
- Synthetic A115-A128 sharpen the compositor model. With a fixed synthetic
  scene of identical `matrix3d` leaves, DOM order can flip p95 near a cadence
  threshold, especially when projected leaf boxes overlap and adjacent DOM
  entries jump across Z planes. But the effect is threshold-only: flat-Z scenes
  are fast, 5000-leaf mixed-depth scenes are unstable across fresh browsers,
  and heavier 6000-8000-leaf scenes are governed by total dirty 3D leaf load
  regardless of spatial/depth/random order. Active CSS transform animation
  still skips PAC/layerize in traces, but no-trace heavy synthetic cadence is
  not rescued once draw-property/draw work dominates.
- Synthetic A129-A137 rule out several nearby browser API shortcuts. Leaf
  `transform-style: flat` catastrophically collapses the synthetic 3D case;
  backface hiding, leaf `will-change`, leaf containment, root
  `will-change:auto`, and transform-function spelling are flat/noisy. Larger
  root scale and primitive/screen footprint increase the share of 3x+ frames;
  rotation delta is mostly flat, confirming that dirtying the 3D subtree is the
  cost, not how far it rotates. Static root with the same 7000 leaves stays
  near the 120fps bucket; JS transform mutation falls to 30-40 p95. Updating a
  CSS var used in `transform`, registering that var, or updating the individual
  `rotate` property still hits PAC/layerize around 3.5ms/frame. Active CSS
  keyframes remain the only tested path that skips PAC.
- Synthetic A138-A146 identify the cleanest lower-level cost model so far:
  dirty transformed 3D descendant count dominates, and the fast shape is fewer
  3D wrappers with many 2D children. In the original software-lane run, the
  clean wrapper range was very small: 8-12 wrappers were all 1x frames, 16
  leaked a few 2x frames, 17-28 landed in the 60fps p95 bucket, 32-34 fell to
  30-40, and 50+ collapsed. Trace confirmed DrawProps dropped from
  ~4.8ms/frame with per-leaf 3D transforms to ~0.03-0.06ms/frame with grouped
  2D children. A218 reran the same browser shape on the GPU lane and moved the
  clean threshold to roughly 112 wrappers, so the old "low teens" number was a
  backend threshold, not a renderer law. Wrapper `transform-style: flat` is
  worse, wrapper `will-change` is flat, and valid boxed paint containment is
  flat; invalid 0x0 paint containment clips all children and only looks fast
  because it paints nothing. With wrapper count fixed at 8, 2D child count
  becomes the secondary limit: 10k children stay 120fps, 20k falls to ~60, and
  30k collapses, with PAC/layerize scaling from ~1.6ms/frame to ~2.6ms/frame
  between 10k and 20k.
- A147 checked the real-model feasibility of the software-lane grouped shape.
  A218 updates the threshold upward for GPU, but the conclusion stays: the
  hardest visible-plane models still sit beyond the clean exact-wrapper range
  (`Treasure` 132, `obj_house3` 142, `scene_mechanic2` 163,
  `scene_house` 182, AncientCrashSite and `scene_park` 191). So the grouped
  shape is real, but exact depth wrappers are not a universal renderer path
  for current gallery scenes.
- GPU-lane reread: every software-only p95 conclusion is now evidence, not a
  promotion gate. Visual-invalid rejections still stand. Medium direct-matrix
  scenes that jump to 100+ on GPU (`obj_house3`, `scene_mechanic2`, `treasure`,
  `desert2`) should be treated as capped/tie cases unless a variant improves
  p99 without hurting high-plane models. The live optimization target is the
  GPU-hard class: high visible exact-plane count and high active leaf count
  (`AncientCrashSite`, `skyscraper`, long-window `army`, plus nearby
  high-plane scenes).
- GPU-lane reread of depth wrappers: the old low-teens wrapper threshold was a
  software-backend result. On ANGLE/Metal, grouped 2D children stay fast until
  roughly 112 exact depth wrappers, then fall at 128+ and collapse by 136/192.
  This reopens wrappers only as a narrow GPU-lane special case; it still does
  not cover the hard models whose exact visible planes sit above that range.
- A31's first compositor-order metric closes the naive version of that idea.
  `bench/voxel-order-metrics.mjs` now samples visible exact-matrix voxel leaves
  over rotation and counts projected AABB overlaps, depth-order inversions,
  crossing/tie pairs, overlap components, face switches, and depth jumps. The
  simple depth-inversion metric does not predict FPS: pure depth order has zero
  inversions but is slow on `obj_house3`, `army` depth-front, and
  `scene_mechanic2`, while parsed/source order can be fast with 30-40%
  overlapping depth inversions. The next test should preserve source/spatial
  locality while applying depth only at block scale.
- Two-run A31 order sweep, `REPEATS=2`, `WARMUP_MS=1000`, `SAMPLE_MS=3000`,
  `MOTION=rotate-time`: exact parsed order is now a major candidate, not just
  global depth. It wins or stays within the fast bucket on `desert2`, `house`,
  `scene_mechanic2`, `Treasure`, `army`, `obj_house5`, and `skyscraper`, but
  still fails `obj_house3` and `AncientCrashSite`.
- A32 rejects source-block-depth ordering as a universal direct-matrix order.
  Keeping source order inside fixed-size blocks and sorting only block roots by
  projected depth is a useful middle form: it gets close on `obj_house5`,
  `desert2`, `scene_mechanic2`, `Treasure`, and `AncientCrashSite`. It still
  loses badly on `obj_house3`, misses `army` and `skyscraper`, and the winning
  front/back direction plus block size are model-specific. This is a reusable
  diagnostic primitive, not a renderer policy.
- A33 is the strongest order result so far. Projected screen-space tile groups
  with exact direct-matrix leaves beat the prior A31 best on 8 of 9 quick
  two-run models, with `skyscraper` still in its capped/noisy class. The best
  tile policy remains model-specific, but `tile4-scanline-forward` is the first
  plausible single policy: it rescues `obj_house3`, stays in the high bucket on
  `obj_house5`, `desert2`, `house`, `scene_mechanic2`, `Treasure`, and
  `AncientCrashSite`, and improves `army` over A31 exact. Later validation made
  this the D3 baseline order; remaining order work must improve GPU-hard
  intervals rather than re-prove tile4.
- A34 validated `tile4-scanline-forward` as the broad direct-matrix default
  order before it became D3, but not as the full solution. With five repeats and
  only the minimum comparator set, it produces large p95 wins on
  `obj_house3`, `obj_house5`, `desert2`, `house`, `scene_mechanic2`, and
  `Treasure`, is neutral on `AncientCrashSite`, modest on `skyscraper`, and
  unstable/near-flat on `army`. The next single-strategy validation is
  `tile4-depth-front`, because A33 suggests it may cover weak scanline cases.
- Probe A35 rejects `tile4-depth-front` as the one strategy. It helps `army`
  and ties several high-bucket models, but collapses `obj_house3` and
  `Treasure`; its hard-set average is lower than A34 `tile4-scanline-forward`.
  Do not pursue a gate here: the requirement is one strategy, so the useful
  path is testing nearby single scanline policies.
- Probe A36 rejects nearby scanline tile sizes as replacements. `tile3`,
  `tile5`, and `tile6` each have hard counterexamples and lower hard-set
  averages than validated `tile4-scanline-forward`. The next one-strategy idea
  should keep tile4 grouping and vary only tile traversal order, e.g.
  serpentine or Morton/Z-order locality.
- Probe A37 rejects tile4 serpentine and Morton traversal as replacements.
  Morton helps `desert2`/`Treasure` slightly and serpentine helps `army`, but
  both lose `obj_house3`; serpentine also loses `house`, and both have lower
  hard-set averages than row-major `tile4-scanline-forward`. The incumbent
  remains the only broad one-strategy candidate.
- Probe A38 rejects direct-matrix voxel leaf `transform-style: flat`. This was
  not just an old slice-host requirement: on the current hostless matrix shape
  it collapsed every hard-set model (`AncientCrashSite` p95 39.9 -> 5.7,
  `desert2` 107.0 -> 14.5, `MechaGolem` 112.3 -> 23.8). Preserve-3d on each
  leaf appears to be part of Chromium's valid 3D compositor path.
- Probe A39 rejects `backface-visibility: hidden` on direct voxel leaves. The
  FPS result is tempting (`Treasure` 40.0 -> 59.6, `army` 39.9 -> 57.8,
  `scene_mechanic2` 60.8 -> 109.8), but static screenshot diffs are visually
  invalid: 21-96% of pixels changed on the checked hard-set models. Hidden
  backface is a different render, not a perf win.
- Probe A40 rejects `contain: layout style` on `.polycss-voxel-mesh`. It is
  mostly flat and helps `skyscraper`, but it collapses `desert2` p95
  107.0 -> 60.1. Wrapper containment changes the same hidden compositor
  ordering class we are trying to exploit, so it is not a general renderer
  boundary.
- Probe A41 rejects the corrected version of hidden backfaces: orienting each
  direct matrix so the CSS front face matches the voxel normal restores visual
  parity (mean screenshot deltas around 0.00002-0.00007), but the perf win
  disappears and `desert2` regresses 107.0 -> 60.7 p95. A39's speedup came
  from dropping real faces, not from a safe backface compositor fast path.
- Probes A42-A46 reject changing the off-plane normal-column magnitude. Static
  screenshots stay visually equivalent because local `z=0`, but any tested
  non-unit normal scale (`0.1`, `2`, `50`, side-only, or z-only) collapses
  `desert2` from ~107 p95 into the ~60 cadence class. Some variants improve
  `scene_mechanic2`, so this is a real compositor classification lever, but
  the current exact `±1` normal column is the only broadly safe single policy.
  Paired traces did not show a proportional PAC/Layerize/DrawProps reduction
  when cadence changed (`scene_mechanic2` normal `0.1` jumped p95 while those
  buckets stayed within roughly 1%), reinforcing that the win/loss is hidden
  compositor scheduling or property-tree classification rather than measured
  style, paint, or compositor CPU.
- Probes A47-A66 reject moving visible scale out of the direct matrix as a
  default strategy. Fixed 64px canonical quads, CSS `width/height` plus an
  orient/translate matrix, fixed `BASE_TILE` quads, and one mesh-global max
  primitive all regress or flatten the split models. Per-leaf square
  normalization (`primitive = max(width,height)`, matrix columns <= 1) looked
  like the only real signal in early short-window runs, but cleanly rebuilding
  the bench bundles from source and re-running with 100+ p95 treated as a
  capped tie changes the read: exact square and `<=600px` fallback do not
  reliably move `desert2` or `scene_mechanic2`, axis-only and face-only splits
  are flat, and inverse `>600px` / `>300px` bands are flat. A narrow
  `300-600px` band briefly put `scene_mechanic2` into the 100+ bucket in a
  3s two-run sample, but an 8s confirmation returned to baseline. The
  actionable conclusion is that primitive-size normalization is a noisy
  cadence lever, not a shippable single renderer shape.
- Probe A67 adds `bench/trace-frame-buckets.mjs`, which aligns raw Chromium
  trace events with rAF frame intervals using `performance.mark`/`timeStamp`
  markers. The key read is per-cadence-bucket, not whole-run totals:
  `Garden.vox` slow buckets have PAC/layerize/draw-props/draw several times
  higher than x1 frames, while `desert2.vox` and `scene_mechanic2.vox` sit near
  a steady 8.3ms budget edge with only small compositor deltas between x1 and
  x2 frames. Optional `--dom-samples` child-count sampling shows those buckets
  are not explained by face-cull swaps: Garden stayed at 6572 mounted leaves,
  Desert2 at 1984, and scene_mechanic2 at 2216 in the checked windows.
- Probes A70-A86 confirm DOM order phase is a real hidden compositor lever,
  but reject the tested forms as a default. Fixed `rotY` order lookahead
  offsets found large wins (`+30deg`: Garden ~30 -> ~39 p95, Desert2 ~60 ->
  100+, Treasure ~40 -> ~58), but `obj_house3` regressed ~60 -> ~40. Centering
  the order within the current visible-face interval kept the Garden/Desert2/
  Treasure wins and avoided the worst `obj_house3` p95 drop, but introduced an
  `obj_house3` p99 tail loss and left Skyscraper borderline. Interval
  fractions and per-item huge-rectangle fallback did not remove that
  counterexample. Boundary screen-span anchors and adaptive 3x3/5x5 tile
  density then produced the best short-window result so far, but the 8s
  confirmation rejected it as a universal rule: it won Garden/Treasure and
  helped `scene_mechanic2`, but regressed AncientCrashSite and `obj_house3`.
  Slot-churn analysis showed the phase wins are not from fewer pooled-element
  style rewrites at cull boundaries. The actionable conclusion is that order
  phase is still the most promising lever, but aggregate p95 is now too blunt:
  the next metric must bucket frames by visible-face interval and identify
  which interval/order pair causes each win or loss.
- Probe A87 adds `bench/voxel-interval-profiler.mjs` and compares baseline
  against the rejected adaptive screen-span order by visible-face interval.
  The result explains why the global rule failed: Garden's `t|br|fr` interval
  improves ~30 -> ~39.5 p95, Treasure's `t|br|fr` improves ~40 -> ~60, and
  `scene_mechanic2` improves in `t|br|fr`/`t|fr|fl`; but AncientCrashSite's
  `t|bl|br` interval drops ~39 -> ~30 and `obj_house3` drops hard in
  `t|br|fr` and `t|fr|fl`. Signature alone is not enough because the same
  signature can be a win on one geometry distribution and a loss on another.
  The next useful test is per-interval geometry correlation, not another
  whole-model aggregate order sweep.
- Probes A88-A91 add per-interval geometry/face-pair correlation and reject
  two derived order variants. Top-face anchoring was meant to protect the
  harmful top/top or top/side changed pairs, but it also removed the useful
  Garden/Scene/Treasure wins. Reversing scanline traversal inside the same
  adaptive phase rule regressed the hard set, especially `obj_house3`. The
  face-pair read is still valuable: losses are not explained by count or
  span alone, but the tested pair-level fixes are too blunt.
- Probes A92-A93 add exact interval order replay. A92 was discarded because
  it computed order at interval midpoint; A93 corrects this by computing order
  at visible-face interval entry, matching when the renderer actually patches
  DOM order. The corrected diff shows two different failure modes:
  `obj_house3` losses are dominated by huge top leaves spanning ~1.45 coarse
  tiles, while AncientCrashSite's loss comes from massive all-leaf rank motion
  among much smaller primitives and only ~11% changed overlap area. That rules
  out a signature-only or count-only order policy.
- Probes A94-A95 reject the first structural guards derived from A93. A94 kept
  product tile4 slots, phased movable leaves toward the interval center, and
  pinned very large top occluders; it regressed `obj_house3` hard and did not
  recover Garden/Treasure. A95 removed the top pinning and only enabled
  centered order when an interval had a large projected blocker; it still
  regressed `obj_house3` and stayed flat elsewhere. The lesson is that coarse
  "large blocker present" and "large top occluder" predicates are too blunt;
  the useful order signal is lower-level than per-face/per-span guards.
- Probes A96-A103 reopen plain tile granularity under a matched current
  baseline. Tile3 current-screen order improves AncientCrashSite in a short
  window but collapses `obj_house3`; tile6 current-screen order is flat/worse.
  Tile5 current-screen order is the only adjacent single-shape candidate that
  survived 8s two-run validation: `garden` improves ~30 -> ~39.5 p95, no
  checked model loses more than 8 p95, `obj_house3`/`mecha-golem` stay in their
  high buckets, and Treasure/Skyscraper p99 tails improve. It is not a broad
  breakthrough because Ancient/Army p99 tails worsen by ~3ms and most models
  are flat, but it is cleaner than phase/guard attempts and worth one more
  traversal-direction probe.
- Probes A104-A105 reject tile5 traversal-direction variants. Tile5
  serpentine loses `obj_house3`, Skyscraper, and the Garden win. Tile5 reverse
  scanline finds a large short-window Desert2 win, but also loses `obj_house3`
  and does not keep Garden. The surviving single-shape candidate remains
  tile5 scanline-forward, not a traversal change.
- Probes A106-A107 trace Garden tile4 vs tile5-forward. Tracing perturbs the
  FPS enough that the p95 win does not reproduce directly, but both runs keep
  the same 7186 mounted leaves and the same compositor-cost class. Tile5
  reduces the sampled x4+ bucket count in the trace window, which supports the
  current read: tile count is changing Chromium's cadence/scheduling threshold,
  not reducing style, paint, DOM count, or raster work.
- Probes A108-A111 reject tile5 scanline-forward as the default after a broader
  corpus pass. A108/A109 add generic `vox:filename.vox` bench IDs and run 24
  additional files. The filter finds no strong p95 wins, one strong p95 loss
  (`scene_house3` ~40 -> ~30), and p99 tail regressions on capped-looking
  models (`mailbox`, `scene_house`, `scene_house5`, `scene_army`). A110/A111
  confirm the risk set at 8s: `scene_house3` loses ~9.8 p95, `mailbox` p99
  worsens by ~7.5ms, `scene_house` p99 worsens by ~5.5ms, and `scene_army`
  p99 worsens by ~3.7ms. Tile5 remains a useful diagnostic for Garden, but it
  is not the one-shape policy.

Latest A66 long-window square-band confirmation, p95 FPS medians:

| Model | Baseline | `300-600px` square band | Read |
| --- | ---: | ---: | --- |
| `Garden.vox` | 30.0 / 57.8ms p99 | 30.0 / 60.5ms p99 | Flat, slight tail noise. |
| `desert2.vox` | 60.1 / 16.8ms p99 | 60.1 / 16.8ms p99 | Flat. |
| `scene_mechanic2.vox` | 60.1 / 16.8ms p99 | 60.1 / 16.8ms p99 | Short 100+ win did not hold. |
| `skyscraper.vox` | 29.9 / 43.2ms p99 | 29.9 / 45.9ms p99 | Flat, slight tail noise. |

Latest A74 centered-interval order validation, p95 FPS medians:

| Model | Baseline | Centered interval order | Read |
| --- | ---: | ---: | --- |
| `Garden.vox` | 30.1 / 47.8ms p99 | 39.8 / 39.4ms p99 | Win. |
| `desert2.vox` | 60.4 / 16.7ms p99 | 100+ / 9.3ms p99 | Win to capped bucket. |
| `Treasure.vox` | 40.1 / 25.4ms p99 | 57.3 / 28.4ms p99 | Win. |
| `scene_mechanic2.vox` | 61.6 / 16.7ms p99 | 59.9 / 16.9ms p99 | Flat. |
| `obj_house3.vox` | 60.1 / 16.9ms p99 | 57.5 / 28.8ms p99 | Tail loss. |
| `skyscraper.vox` | 34.5 / 41.8ms p99 | 29.4 / 44.5ms p99 | Borderline/flat. |

Latest hard-split validation, p95 FPS medians:

| Model | Slice | Face | Normal F | Depth F | Depth B | Read |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `obj_house3.vox` | 112.6 | 114.9 | 111.2 | 59.9 | 58.8 | Needs top/face locality. |
| `obj_house5.vox` | 116.3 | 113.6 | 114.9 | 114.9 | 59.9 | Front/top orders safe; depth-back bad. |
| `desert2.vox` | 59.7 | 59.9 | 59.9 | 113.6 | 114.9 | Needs projected depth. |
| `house.vox` | 59.9 | 113.6 | 59.9 | 116.3 | 116.3 | Depth is best; face is usable. |
| `scene_mechanic2.vox` | 59.5 | 59.9 | 59.9 | 114.9 | 115.1 | Needs projected depth. |
| `Treasure.vox` | 29.9 | 30.0 | 40.0 | 57.6 | 40.0 | Needs depth-front for the high bucket. |
| `army.vox` | 40.0 | 40.2 | 30.0 | 30.1 | 58.5 | Needs depth-back. |
| `AncientCrashSite.vox` | 39.8 | 40.0 | 30.0 | 39.8 | 39.9 | Face/top neutral; normal sorting bad. |
| `skyscraper.vox` | 29.8 | 29.7 | 29.9 | 24.0 | 29.9 | Mostly capped; depth-front bad. |

Latest A31 two-run order-metric sweep, p95 FPS medians:

| Model | Slice | Exact | Face | Normal F | Depth F | Depth B | Read |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `obj_house3.vox` | 59.9 | 40.0 | 109.3 | 109.9 | 39.7 | 30.0 | Needs face/normal-front locality; depth correctness is actively bad. |
| `obj_house5.vox` | 59.9 | 113.0 | 112.4 | 111.7 | 113.0 | 59.9 | Many front/local orders are fast; depth-back is bad. |
| `desert2.vox` | 59.7 | 114.3 | 58.8 | 59.7 | 112.3 | 111.1 | Parsed/depth-like order wins; face locality is bad. |
| `house.vox` | 59.8 | 112.3 | 59.9 | 59.5 | 109.0 | 59.9 | Parsed/depth-front order wins; face locality is bad. |
| `scene_mechanic2.vox` | 40.0 | 111.7 | 59.3 | 59.3 | 59.9 | 59.9 | Parsed source order wins; pure depth no longer explains it. |
| `Treasure.vox` | 39.2 | 58.6 | 39.9 | 49.4 | 58.7 | 58.1 | Parsed and depth are tied in the fast bucket. |
| `army.vox` | 39.8 | 49.3 | 39.8 | 30.0 | 30.0 | 40.0 | Parsed order is best in this quick run. |
| `AncientCrashSite.vox` | 34.7 | 29.9 | 39.9 | 30.0 | 39.0 | 39.6 | Face/top/depth are neutral; exact parsed is bad. |
| `skyscraper.vox` | 21.5 | 29.8 | 29.9 | 29.8 | 26.7 | 34.5 | Mostly capped; depth-back is best in this quick run. |

Latest A32 source-block-depth sweep, p95 FPS medians:

| Model | Best A32 | Strategy | Prior A31 best | Delta | Read |
| --- | ---: | --- | ---: | ---: | --- |
| `obj_house3.vox` | 59.6 | block128-depth-back | 109.9 | -50.3 | Source blocks do not preserve the face/normal locality this model needs. |
| `obj_house5.vox` | 111.9 | block64-depth-front | 113.6 | -1.7 | Coarse front depth plus source locality is close to the best static order. |
| `desert2.vox` | 114.3 | block128-depth-back | 114.3 | -0.1 | Source-block depth transfers the matrix win. |
| `house.vox` | 108.1 | block128-depth-front | 112.3 | -4.2 | Only one block size/direction reaches the high bucket. |
| `scene_mechanic2.vox` | 111.1 | block64-depth-front | 111.7 | -0.6 | Coarse front depth transfers most of the parsed-order win. |
| `Treasure.vox` | 58.4 | block64-depth-front | 58.7 | -0.3 | Source-block depth stays in the high bucket. |
| `army.vox` | 40.2 | block256-depth-front | 49.3 | -9.1 | Block depth cannot reproduce parsed-order benefit. |
| `AncientCrashSite.vox` | 39.8 | block64-depth-front | 39.9 | -0.1 | Neutral; does not improve the hard case. |
| `skyscraper.vox` | 30.0 | block256-depth-front | 34.5 | -4.4 | Still capped/slow relative to depth-back. |

Latest A33 projected-tile sweep, p95 FPS medians:

| Model | Best A33 | Strategy | Prior A31 best | Delta | Read |
| --- | ---: | --- | ---: | ---: | --- |
| `obj_house3.vox` | 114.9 | tile4-scanline-forward | 109.9 | +5.1 | Screen scanline order rescues the model that source/depth could not. |
| `obj_house5.vox` | 115.6 | tile4-scanline-reverse | 113.6 | +2.0 | Many tile orders are high; direction is not fragile here. |
| `desert2.vox` | 117.6 | tile4-depth-front | 114.3 | +3.3 | Tile depth-front beats parsed/depth order. |
| `house.vox` | 112.4 | tile8-depth-front | 112.3 | +0.1 | Ties the prior best; tile8 scanline variants are bad. |
| `scene_mechanic2.vox` | 117.0 | tile8-scanline-forward | 111.7 | +5.2 | Screen grouping beats parsed source order. |
| `Treasure.vox` | 59.7 | tile4-depth-back | 58.7 | +1.0 | Still around the high bucket; no major new ceiling. |
| `army.vox` | 58.8 | tile8-scanline-reverse | 49.3 | +9.6 | Screen grouping finds the missing win that source blocks missed. |
| `AncientCrashSite.vox` | 40.0 | tile4-depth-front | 39.9 | +0.1 | Neutral; this model remains at its ~40 p95 class. |
| `skyscraper.vox` | 30.0 | tile4-scanline-forward | 34.5 | -4.5 | Still capped/noisy; quick A31 depth-back needs validation before treating this as a regression. |

Latest A34 `tile4-scanline-forward` validation, p95 FPS medians:

| Model | Slice | Tile4 scanline F | Delta | Tile p50 | Tile p99 ms | Read |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `obj_house3.vox` | 59.9 | 113.6 | +53.8 | 120.5 | 9.2 | Validated win; this rescues the main face/locality counterexample. |
| `obj_house5.vox` | 59.9 | 113.4 | +53.6 | 120.5 | 9.2 | Validated win. |
| `desert2.vox` | 59.5 | 113.6 | +54.1 | 120.5 | 9.2 | Validated win, though A33 depth-front was slightly higher. |
| `house.vox` | 59.9 | 114.7 | +54.9 | 120.5 | 9.3 | Validated win. |
| `scene_mechanic2.vox` | 40.0 | 113.5 | +73.5 | 120.5 | 9.2 | Validated win. |
| `Treasure.vox` | 30.5 | 58.5 | +28.0 | 60.2 | 24.0 | Validated win into the ~60 FPS class. |
| `army.vox` | 39.8 | 42.1 | +2.2 | 60.2 | 25.1 | Not enough; runs split between ~40 and ~58 p95. |
| `AncientCrashSite.vox` | 39.8 | 39.8 | +0.0 | 59.9 | 27.9 | Neutral; this model remains in the ~40 p95 class. |
| `skyscraper.vox` | 23.7 | 29.9 | +6.2 | 40.0 | 39.8 | Modest win, still capped/slow. |

Probe A35 `tile4-depth-front` single-strategy check, p95 FPS medians:

| Model | Slice | Scanline F | Depth F | Depth - scanline | Read |
| --- | ---: | ---: | ---: | ---: | --- |
| `obj_house3.vox` | 59.9 | 113.6 | 59.9 | -53.8 | Depth-front fails the face/locality class. |
| `obj_house5.vox` | 59.9 | 113.4 | 114.7 | +1.2 | Tie. |
| `desert2.vox` | 59.5 | 113.6 | 113.6 | -0.0 | Tie. |
| `house.vox` | 59.9 | 114.7 | 111.1 | -3.6 | Scanline is better. |
| `scene_mechanic2.vox` | 40.0 | 113.5 | 114.9 | +1.4 | Tie. |
| `Treasure.vox` | 30.5 | 58.5 | 40.0 | -18.5 | Depth-front loses the high bucket. |
| `army.vox` | 39.8 | 42.1 | 48.7 | +6.7 | Depth-front helps but not enough to justify losing other models. |
| `AncientCrashSite.vox` | 39.8 | 39.8 | 39.8 | +0.0 | Tie. |
| `skyscraper.vox` | 23.7 | 29.9 | 29.9 | +0.0 | Tie. |

Probe A36 scanline tile-size sweep, p95 FPS medians:

| Model | Tile3 | Tile4 | Tile5 | Tile6 | Read |
| --- | ---: | ---: | ---: | ---: | --- |
| `obj_house3.vox` | 59.7 | 113.6 | 111.1 | 111.7 | Tile3 fails; tile4 remains best. |
| `obj_house5.vox` | 111.0 | 113.4 | 114.3 | 113.7 | Tile5 is slightly higher in a two-run probe. |
| `desert2.vox` | 113.0 | 113.6 | 84.6 | 84.6 | Tile5/6 are unstable or slow. |
| `house.vox` | 59.9 | 114.7 | 61.2 | 112.4 | Tile3/5 fail. |
| `scene_mechanic2.vox` | 114.2 | 113.5 | 108.7 | 60.2 | Tile6 fails; tile3 only marginally higher. |
| `Treasure.vox` | 58.1 | 58.5 | 58.3 | 58.3 | Flat; tile4 remains best. |
| `army.vox` | 40.0 | 42.1 | 39.9 | 40.0 | No tile-size variant fixes the weak case. |
| `AncientCrashSite.vox` | 39.8 | 39.8 | 30.1 | 39.5 | Tile5 fails; tile3/tile4 tie. |
| `skyscraper.vox` | 30.0 | 29.9 | 30.0 | 30.0 | Flat. |

Probe A37 tile4 traversal sweep, p95 FPS medians:

| Model | Row-major | Serpentine | Morton | Read |
| --- | ---: | ---: | ---: | --- |
| `obj_house3.vox` | 113.6 | 60.2 | 59.9 | Row-major is required for the main counterexample. |
| `obj_house5.vox` | 113.4 | 112.4 | 111.7 | Row-major holds. |
| `desert2.vox` | 113.6 | 112.7 | 114.9 | Morton slightly higher in a two-run probe. |
| `house.vox` | 114.7 | 59.9 | 107.7 | Serpentine fails; row-major holds. |
| `scene_mechanic2.vox` | 113.5 | 112.3 | 111.7 | Row-major holds. |
| `Treasure.vox` | 58.5 | 48.7 | 58.8 | Morton ties/slightly higher; serpentine loses. |
| `army.vox` | 42.1 | 48.9 | 44.0 | Serpentine helps, but not enough to offset losses. |
| `AncientCrashSite.vox` | 39.8 | 39.8 | 40.0 | Flat. |
| `skyscraper.vox` | 29.9 | 30.0 | 30.0 | Flat. |

## Accepted Decisions

| ID | Status | Decision | Why it stays |
| --- | --- | --- | --- |
| D1 | ✅ Accepted | Preserve raw `PolyVoxelSource` and render eligible `.vox` meshes through a dedicated fast path. | This produced the major win over polygon `matrix3d` leaves. |
| D2 | ✅ Accepted | Keep the hostless direct-matrix DOM shape as the default. | It removes voxel hosts, uses one canonical `<b>` matrix per visible quad, and is the only one-shape baseline that survives the GPU reread. |
| D3 | ✅ Accepted | Keep `tile4-scanline-forward` as the default DOM order. | Most order alternatives were either model-specific or software-lane artifacts; tile4 row-major remains the broadest single policy while medium GPU cases are now capped/ties. |
| D4 | ✅ Accepted | Prefer exact parsed voxel quads over source overpaint for default rendering. | The exact path preserves visual correctness; lower-node source variants did not reliably win. |
| D5 | ✅ Accepted | Keep camera-facing culling. | Mounting all faces regressed hard. |
| D6 | ✅ Accepted | Keep integer CSS cell snapping for `.vox` normalization. | It avoids a scale wrapper and keeps brush coordinates on integer pixels. |
| D7 | ✅ Accepted | Normalize visual fit before comparing voxel renderer FPS. | Fixed zoom can crop or resize large voxel scenes enough to change the benchmark question. |
| D8 | ✅ Accepted | Treat GPU as the default bench lane and software as an explicit stress lane. | A211-A217 show the default bundled software renderer can manufacture 60fps ceilings that disappear under normal GPU compositing. |

## Active Hypotheses

| ID | Status | Hypothesis | Experiment | Mark ✅ if | Mark ❌ if |
| --- | --- | --- | --- | --- | --- |
| A1 | ✅ Accepted | Polycss and voxcss differ mainly in compositor/layerization work, not raster/layout. | Done on `AncientCrashSite.vox` and `Treasure.vox`: polycss shows higher `PaintArtifactCompositor::Update`, `Layerize`, and draw-property work; raster is zero for both engines. | Next tests can target style/transform/layer-shape causes. | Reopen only if broader traces contradict the compositor/layerization read. |
| A2 | ❌ Rejected | Computed-style differences point mainly at scene shell/transform shape, not raster/layout. | Scene-shell differences identified the invalid 120fps path, but visual-preserving compensation, perspective, tags, CSS resets, and containment did not keep the win. | Reopen only with a new visual-preserving shell form. | All current shell/style variants are flat or visually invalid. |
| A3 | ✅ Accepted | Current spot checks are hiding model classes. | Done on a starter corpus with zoom-normalized polycss/voxcss comparison. | Keep corpus sweeps as the default proof path. | Reopen only if later full-corpus data collapses to one uniform behavior. |
| A4 | 🟡 Flat | Host containment is useful for a structural class of models. | `polycss-shell-host-only` was flat/noisy on `Garden`, `MechaGolem`, `scene_vehicles1`, `AncientCrashSite`, and `army`; `polycss-baked-voxshell` changed visual fit and is not a clean containment result. | Reopen only with a narrower containment-only variant or layer-bound evidence. | Host-only containment remains flat across representative classes. |
| A5 | ❌ Rejected | A visual-preserving scene box/transform chain may keep the compositor fast path. | Tested naive `scene-size`, `scene-position`, `host-size`, `box-only`, origin-pinned boxes, scene-matrix compensation, and mesh compensation on `AncientCrashSite.vox`. | Reopen only if a different shell form preserves both visual output and the fast compositor path. | Visual-preserving variants drop back to baseline; fast variants are blank, cropped, or off-center. |
| A6 | 🟡 Flat | Perspective placement/value changes compositor behavior. | Tested current huge finite perspective against `perspective:none` and `100000px` on `AncientCrashSite`, `Garden`, `MechaGolem`, `skyscraper`, and `scene_vehicles1`. | Reopen only for a different transform-chain placement, not value alone. | Perspective value changes were visually equivalent and flat. |
| A7 | 🟡 Flat | Target size/cell size changes compositor pressure enough to matter after visual fit is normalized. | Matched-zoom sweep from target 50/60/70/80/90 on `Garden`, `skyscraper`, `MechaGolem`, and `AncientCrashSite`. | Reopen only if a different matched-fit policy changes actual screen bounds or brush count. | Local area changed by multiples while p95/p99 stayed effectively flat. |
| A8 | 🟡 Flat | A different brush tag hits a cheaper UA/style path. | Compared `<b>` against equivalent `<div>` voxel brush leaves across representative corpus. | Reopen only with another tag/style pair that is visually equivalent and moves trace/FPS. | Equivalent `<div>` brushes track `<b>` within noise. |
| A9 | 🟡 Flat | A minimal voxel-only CSS reset reduces style or paint cost. | Tested leaf `will-change: auto` and a broader voxel-only reset for box/font/background-repeat/will-change. | Reopen only with trace evidence for style-rule cost. | CSS reset variants were flat; `army` apparent wins collapsed under longer runs. |
| A10 | 🟡 Flat | Accessibility/event trees add measurable overhead for thousands of semantic leaves. | Added `aria-hidden`/`inert` to the polycss mesh subtree across representative corpus. | Reopen only outside headless rotation or with accessibility-tree-specific evidence. | FPS/task metrics stayed flat. |
| A11 | 🟡 Flat | Paint chunks are fragmented by color/style cardinality. | Traced high-color `army`, medium-color `Garden`, and low-color `MechaGolem`. Style/paint stayed tiny relative to compositor/layer lifecycle. | Reopen only if a future renderer increases paint/raster time. | Paint/style are not the current bottleneck. |
| A12 | ✅ Accepted | The planner needs a browser/compositor cost model, not a rectangle-count minimum. | Added brush area, depth-plane count, color count, local union/overdraw, plane fill, screen bounds, browser-mode checks, and synthetic classes. | Future planner work should use compositor/browser metrics and synthetic thresholds. | Reopen only if a simple DOM metric later predicts the corpus. |
| A13 | ❌ Rejected | View-dependent mounted brush count explains p95/p99 drops broadly. | Sampled mounted brushes during rotation. Counts changed on several models, but `Garden.vox` voxcss stayed slow with constant brush count. | Reopen only as a narrow mutation-spike hypothesis. | Stable mounted count can still have poor p95/p99. |
| A14 | ❌ Rejected | Cull-boundary mutation is the parity path. | Sampled transition spikes, then tested a cull-freeze diagnostic on `army` and `scene_vehicles1`. Removing swaps did not improve the path and could regress by holding the wrong visible set. | Reopen only with a concrete predictive/batched swap algorithm, not freeze/no-swap. | Cull changes can cause isolated spikes, but are not the broad parity gap. |
| A15 | ✅ Accepted | Browser mode changes the apparent fast path. | DPR 1/2 was flat; headed mode changed absolute cadence; installed Chrome/Canary changed `MechaGolem` from a large polycss win to near parity. | Benchmark reports must include browser executable, headed/headless, and DPR. | Reopen if CI/browser standardization makes this stable again. |
| A16 | 🟡 Flat | CSS rule matching remains a cost even for voxel fast path. | Minimal CSS/reset variants were flat, and traces showed style recalc is tiny compared with compositor/layer lifecycle. | Reopen only with trace evidence that style recalc dominates. | Current traces show compositor/raster lifecycle dominates instead. |
| A17 | ❌ Rejected | Host clipping/isolation can reduce paint bounds without leaf clipping. | Host containment was flat; host `overflow: clip` plus `contain: paint` was screenshot-tested on `AncientCrashSite.vox`. | Reopen only with a different boundary that passes screenshots. | Host clipping split the slice planes and dropped visible geometry. |
| A18 | ❌ Rejected | Existing non-product prototypes establish a valid ceiling. | Ran `polycss-slice-proto` and `polycss-polybox` on `AncientCrashSite`, `Garden`, and synthetic sparse grid. `slice-proto` can be faster but fails visual checks; `polybox` is not a consistent win. | Reopen only with a render-correct ceiling prototype. | Current prototypes change the visual render or do not beat the fast path. |
| A19 | ✅ Accepted | Benchmark instrumentation can perturb results. | `LayerTree.enable` changed the AncientCrashSite FPS path, especially for polycss; keep layer-tree capture opt-in and separate from FPS traces. | Use low-intrusion traces for FPS comparisons and isolated diagnostic runs for layer counts. | Reopen if a cheaper layer-shape probe is found. |
| A20 | ✅ Accepted | Synthetic model classes are needed to expose thresholds. | Generated dense cube, sparse grid, thin slab, and noisy/high-color `.vox` models. Dense/thin cases are flat; sparse separated voxels favor voxcss; noisy/high-color is mostly flat. | Keep synthetic classes in future benchmark sweeps. | Reopen only if synthetic behavior diverges from future real-model findings. |
| A21 | ❌ Rejected | Route only some `.vox` models between voxel slices and matrix fallback. | 86-model cadence corpus plus the bench-only `polycss-adaptive-shaded` route proved selectors are partial and browser-sensitive. D2/D3 supersede this direction: hostless direct matrix plus tile4 order is now the one-strategy baseline, and GPU reread makes many old medium-scene routing wins capped/tie evidence. | Reopen only if a future second renderer is visually exact and wins the GPU-hard class behind a cheap static predicate. | Do not use old slice-vs-matrix selector data to add a router. |
| A22 | 🧪 Test next | Declarative camera animation can skip PAC for auto-rotate scenes, but cannot solve interactive JS rotation by itself. | Chromium source read plus `apocalypse/car.glb` probes: JS rotation hit PAC every sample frame; CSS keyframe and running WAAPI hit zero PAC; paused WAAPI `currentTime` and JS `scrollLeft` scroll-timeline probes still hit PAC. Build a bench-only WAAPI/CSS camera mode and run voxel + non-voxel traces without treating trace FPS as final. | Accept a separate auto-rotate path if validated runs show lower PAC and better cadence without visual drift or API contortions. | Reject as a general renderer fix if interactive pointer-driven controls still require JS transform mutation and draw-property cost remains dominant. |
| A23 | ✅ Accepted | Dirty 3D transform-node count is the next lower-level cost model after active DOM leaves. | `bench/compositor-topology-probe.mjs` confirmed the source read: at equal 2500 leaves, `left/top` and 2D `translate` were near-free in draw properties, while `translateZ(0)`, real `translateZ`, and `matrix3d` were ~40-60x higher. | Use this as the browser-shape benchmark for future topology ideas. | Reopen only if another Chromium version makes 3D leaves decompose cheaply. |
| A24 | ⚠️ Conditional | Projected distribution/overlap may explain model variance that leaf count misses. | One longer synthetic distribution probe at equal 1200 `matrix3d` leaves moved DrawProps/Draw by about 20%, but PAC/layerize stayed similar; a shorter rerun was noisier. | Promote if controlled screen-coverage runs and real-model pairs show the same separation. | Reject if the effect collapses under controlled repeats. |
| A25 | ⚠️ Conditional | Exact depth-plane wrappers are backend-specific and only useful under a visible-plane gate. | Software-lane `depth-groups` made 17 wrappers fast and 50+ unstable; A218 updates the GPU-lane threshold to roughly <=112 wrappers before cadence falls. The bench-only real-model variant found no default product payoff, and current GPU-hard models exceed the clean range. | Reopen only for a high-leaf GPU-hard real model at or below the validated exact-plane threshold. | Reject as a default renderer; it cannot cover the high-plane hard class. |
| A26 | ✅ Accepted | Hostless direct canonical matrix brushes are the transferable part of matrix wins. | `polycss-polybox` uses parsed polygons but keeps axis hosts and falls to slice cadence; `polycss-voxlocal-direct-matrix` removes hosts, folds scale/orientation/depth into `matrix3d`, and transfers the `desert2` win while lowering PAC/draw-props. The baseline is 1px on desktop and 8px on mobile-class documents to avoid mobile GPU filtering gaps while preserving the same CSS-space quad. | Keep direct matrix as the baseline leaf shape while testing only changes that target GPU-hard residual cost. | Reopen only if a visual-equivalent shape beats it on high-leaf GPU-hard scenes without adding routing. |
| A27 | ✅ Accepted | Exact direct matrix leaves are the single voxel leaf shape; order is the optimization layer. | Same exact `<b>` matrix leaves, same active nodes, and same culling produced opposite cadence depending only on DOM order. Tile4 scanline-forward became the baseline because it was the broadest validated one-strategy order; later GPU reread changes which old wins matter, not the baseline DOM shape. | Keep order experiments isolated from leaf shape changes and judge them on GPU-hard intervals. | Reopen only if a different leaf shape changes GPU-hard compositor pressure without visual drift. |
| A28 | ❌ Rejected | A single static or face-normal order can replace model routing. | Tested fixed side-first, side-reverse, top-reverse, face-normal-front/back, face-depth, face-block, and depth-band variants on the hard split set. `obj_house3` rejects side-first/reverse and depth; `desert2` rejects top/normal-front; `house` rejects normal-front; `AncientCrashSite` rejects normal sorting and bands; `Treasure` still needs per-leaf depth for the high bucket. | Reopen only with a new order derived from Chromium sorting behavior, not another static face permutation. | Current static/normal permutations all have hard counterexamples. |
| A29 | ❌ Rejected | Depth bands with face locality bridge face order and projected-depth order. | 4- and 8-band variants reduce mounted nodes but regress `obj_house3`, `army`, `AncientCrashSite`, and `skyscraper`; `Treasure` still stays below global depth. | Reopen only if a different banding rule is tied to measured compositor overlap/sorting, not node count. | Fewer active nodes performed worse, so this is not the missing invariant. |
| A30 | ✅ Accepted | Order-sensitive wins are cadence/scheduler threshold effects, not lower per-frame main-thread compositor work. | One-run traces on `scene_mechanic2` and `obj_house3` with same leaves/nodes show PAC, DrawProps, Draw, paint, raster, and script per inferred frame are nearly identical between fast and slow orders. The difference is the share of 1x-vsync vs 2x/3x-vsync frames. | Next work should inspect overlap/sorting/damage/GPU critical path, not style/layout/PAC totals. | Reopen only if low-intrusion traces on more models show per-frame compositor groups diverging materially. |
| A31 | ❌ Rejected | Projected overlap/order inversions predict when depth order is required. | Added `bench/voxel-order-metrics.mjs` and ran the hard split set with two repeats per strategy. Overlap count, crossing rate, and depth-inversion rate are useful diagnostics, but the naive inversion predictor fails: zero-inversion depth order can be slow, and parsed order can be fast with many inversions. | Reopen only with a more specific Chromium/BSP metric than AABB overlap and average-depth inversion. | Current metric does not correlate with validated or exploratory p95/p99 by order. |
| A32 | ❌ Rejected | Source/spatial locality plus coarse depth ordering may beat pure face and pure depth order. | Tested source-order blocks of 32, 64, 128, and 256 leaves, sorted by average projected depth front/back, on the hard split set with two repeats. | Reopen only if the block definition is derived from a new browser/compositor metric rather than fixed source chunks. | Fixed source chunks are model-specific: they transfer some wins but fail `obj_house3`, miss `army`/`skyscraper`, and do not beat the A31 Pareto frontier. |
| A33 | ✅ Accepted | Projected screen-space grouping is the current direct-matrix order baseline. | Tested 4x4 and 8x8 projected screen tiles with depth-front/back and scanline-forward/reverse ordering on the hard split set. A34 validated `tile4-scanline-forward`, A35 rejected `tile4-depth-front`, and A96-A111 rejected nearby tile-count replacements. | Keep `tile4-scanline-forward` until a deterministic order improves GPU-hard intervals without p99 regressions. | Reopen only with a browser/compositor metric that explains a better universal order. |
| A34 | ❌ Rejected | Tile4 spatial locality is useful, but row-major traversal may not be the best one-strategy order. | Tested single-strategy tile4 serpentine and Morton/Z-order traversals as new strategy IDs only. | Reopen only with a new traversal justified by a browser/compositor model. | Serpentine and Morton both lose `obj_house3` and remain below tile4 row-major average. |
| A35 | ⚠️ Conditional | Order phase within a visible-face interval is a real lever, but the phase rule is unsolved. | A70-A95: fixed lookahead offsets, centered intervals, fractions, huge/local anchors, boundary screen-span anchors, tile-count sweeps, adaptive 3x3/5x5 tile density, interval-profiler comparison, exact interval order replay, large-blocker guards, and large-top pinning. Short windows found major wins, but validation rejected the best one-strategy candidates. A87/A93 show the same signature can win or lose depending on interval geometry, and A94/A95 show coarse per-face/per-span guards are insufficient. | Promote only if a browser/overlap-derived phase rule keeps the wins and removes the AncientCrashSite/`obj_house3` long-window losses without preset gates. | Reject if every deterministic phase rule collapses to model routing or blunt geometry guards. |
| A112-A114 | ❌ Rejected | Scene-root transform decomposition can recover a compositor fast path. | Tested root `matrix3d(...)`, inner target-translation shell, host-level perspective, transform-function perspective, and removing scene `will-change`. The decomposition variants were flat or worse; the only `no-will-change` 3s signal disappeared in 8s confirmation. | Reopen only with a Chromium-source-backed reason that changes which transform node is dirtied, not another equivalent CSS transform spelling. | Current variants keep the same dirty 3D subtree cost and do not improve validated p95/p99. |
| A115-A128 | ✅ Accepted | Synthetic order wins are threshold/cadence effects, not a stable lower-cost order primitive. | Extended `bench/compositor-topology-probe.mjs` with fixed-leaf order mode, depth patterns, per-order metrics, frame buckets, and no-trace runs. 5000 high-overlap leaves can flip between ~60 and 110+ p95 by DOM order, but repeats show the test is near an unstable scheduler threshold. At 6000/7000/8000 leaves, all orders converge to ~60/~40/~30 p95. Flat-Z controls are fast. CSS root animation still skips PAC under trace but does not solve no-trace heavy-load cadence. | Use synthetic order probes to identify thresholds and trace causes, not to justify another model router or global order rule. | Reopen only if a synthetic variant changes heavy-load p95 while preserving identical leaf count and visual-equivalent 3D topology. |
| A129-A137 | ✅ Accepted | Interactive root mutation is the dominant synthetic dirty-subtree trigger; nearby CSS APIs do not bypass it. | Added synthetic controls for leaf CSS flags, transform spelling, root scale, rotation delta, static root, CSS variables, registered variables, and individual `rotate`. Static 7000-leaf scenes remain near the 120fps bucket. JS transform, registered var, and `rotate` property updates all hit PAC/layerize; active CSS keyframes skip PAC but remain draw-bound at heavier loads. | Treat interactive rotation as dirtying the full 3D property tree unless Chromium exposes a true compositor-driven scrub path. Use root scale/screen footprint as a secondary pressure metric. | Reopen only if a new browser API updates the transform node without PAC during JS/pointer-driven scrubbing. |
| A138-A146 | ✅ Accepted | The browser fast shape is fewer dirty 3D wrappers with many 2D children, not many 3D leaves. | Extended depth-group synthetic sweeps across wrapper counts, wrapper CSS flags, boxed wrappers, JS/CSS roots, and child-count scaling. Software-lane threshold was very low (8-12 clean, 50+ collapsed); A218 shows GPU keeps the same shape clean to roughly 112 wrappers. Valid containment does not help. Child count is secondary once wrappers are low. | Use this as the target browser shape only when exact visual depth can be represented within the GPU-lane wrapper threshold. | Reject grouped renderers that require per-leaf residual Z, clipping, quantized depth, or wrapper counts above the validated backend threshold. |
| A147 | ✅ Accepted | Exact depth-wrapper fast paths are only viable below the GPU wrapper threshold, which still misses the hard high-plane class. | `bench/voxel-static-metrics.mjs` showed important models with 47-191 visible planes; A218 raises the clean GPU threshold to about 112, but `Treasure` 132, `obj_house3` 142, `scene_mechanic2` 163, `scene_house` 182, and AncientCrashSite/`scene_park` 191 still exceed it. | Use exact depth wrappers only as a special-case ceiling for GPU-hard, <=112-plane assets. | Reopen if a high-active-leaf real model appears below the GPU threshold and is not already capped on direct matrix. |
| A148-A149 | ❌ Rejected | Coarse depth wrappers plus exact residual leaf `translateZ(...)` can preserve visual depth and keep the grouped fast path. | Added synthetic `hybrid-z8-d136`, `hybrid-z16-d136`, and `hybrid-z8-d250` variants. `group-z8` stays near 111 p95 with PAC/layerize about 1.1ms/f and draw about 0.13ms/f. `hybrid-z8-d136` falls to about 24 p95 with PAC/layerize about 3.7ms/f and draw about 6.7ms/f, matching per-leaf 3D cost. | Reopen only if exact residual depth can be expressed without putting a 3D transform on each leaf. | A residual leaf Z transform poisons the grouped shape; the browser treats it like many 3D leaves again. |
| A150 | ❌ Rejected | Quantizing real-model depth into a low wrapper count is a plausible visual approximation. | Added `bench/voxel-depth-quantization-error.mjs` and wrote `bench/results/a150-depth-quantization-error.md`. With 2/4/8/12/16 bucket centers per axis, hard models still have huge projected center displacement. At 16 buckets/axis, already 48 wrappers, p95 center error remains 69.7px on `AncientCrashSite`, 64.3px on `desert2`, 85.2px on `Treasure`, 79.2px on `obj_house3`, 72.4px on `scene_mechanic2`, and 73.2px on `scene_house`. | Reopen only for a non-visual diagnostic mode or an explicitly lossy renderer. | Coarse wrapper counts are visibly wrong, and visually closer bucket counts still do not cover the high-plane GPU-hard class exactly. |
| A151 | ❌ Rejected | Replace per-leaf 3D depth with per-leaf 2D projected offsets driven by scene-level CSS variables. | Added synthetic projection variants. At 7000 leaves, static 2D leaves stay cheap, but `var-transform` and registered `var-transform` fall to about 24 p95 with about 25ms/f of `UpdateLayoutTree` and about 4ms/f of PAC/layerize. `var-left-top` is worse at about 20 p95. | Reopen only if a compositor-driven projection API avoids style recalc for dependent leaf transforms. | Inherited camera variables make every dependent leaf style dirty; this moves the bottleneck rather than removing it. |
| A152 | ❌ Rejected | Many smaller spatially bounded depth wrappers can avoid the high-wrapper collapse. | Added tiled depth-wrapper variants. With 7000 children, `group-z16` stays around 107-110 p95, while `tiled-z16-t2` creates 64 smaller wrappers and drops to about 59 p95. `group-z32` and `tiled-z32-t2` both remain slow, with tiled usually worse. Trace draw-property cost stays low, so the loss is cadence/threshold rather than a big per-frame main-thread event. | Reopen only with a tiling form that reduces transformed wrapper count, not one that multiplies it. | Bounds/overlap reduction does not compensate for multiplying dirty transformed wrappers. |
| A153 | ⚠️ Conditional | Projected overlap/footprint can dominate per-leaf 3D cadence even when DOM count and transform topology are unchanged. | Added `--depth-step` and `--perspective` to the synthetic probe. Under near-orthographic perspective, `leaf-z250` at depth-step 6 is about 17 p95 with draw about 6.6ms/f; depth-step 72 spreads projected leaves and rises to about 111 p95 with draw about 4.1ms/f. This is not a renderer trick because the visual footprint changes, but it explains why equal DOM/topology cases can land in different cadence buckets. | Use this to design overlap/footprint diagnostics and real-model interval analysis. | Reject only if normalized-screen-footprint probes show the effect disappears. |
| A154 | ✅ Accepted | The depth-step win is primarily a projected-footprint win, not magic from larger Z values. | Added compensated depth variants that offset local Y by the root tilt so large-Z leaves project back into a compact footprint. At depth-step 72, `leaf-z250` is near 110+ p95 with screen fill about 0.01; `leaf-z250-comp` drops to about 60 p95 with screen fill about 0.55 and overlap about 0.40 pairs/leaf. The fast case has the same per-leaf Z topology but much lower projected density. | Treat screen density and overlap as first-class diagnostics. | Reopen only if another large-Z same-footprint test stays in the 100+ bucket. |
| A155 | ⚠️ Conditional | Real-model interval drops are overlap/order-shape effects, not a single scalar like active leaves or fill. | Added `bench/voxel-interval-screen-metrics.mjs` and ran current renderer intervals for `ancient-crash-site`, `obj-house3`, and `scene-mechanic2`. `AncientCrashSite` is uniformly bad with about 5.2k active leaves and 6-9 overlap pairs/leaf. `obj_house3` has high-fill/high-overlap intervals that are still 100+ p95 and one similar interval at about 60 p95, so scalar density alone is insufficient. | Next tests should attribute overlap by face pair, depth direction, and tile-local source order. | Reject if a broader interval corpus shows a simple threshold cleanly predicts drops. |
| A156 | ❌ Rejected | 2D spatial wrappers around exact per-leaf 3D leaves can give Chromium smaller subtrees without changing visuals. | Added synthetic `tile2d-z250-t2/t4/t8` variants. At depth-step 6, 7000 leaves stayed in the same slow class: baseline `leaf-z250` was around 10-17 p95 and tile2d variants topped out around 17 p95. At depth-step 12 they were flat at about 30 p95. | Reopen only if a real-model implementation shows a win not visible in the high-overlap synthetic class. | Spatial 2D wrappers do not remove per-leaf 3D draw-property pressure or projected overlap cost. |
| A157-A159 | ❌ Rejected | Standalone dense-tile face ordering predicts a product win. | Added `bench/voxel-dom-order-probe.mjs` to render real voxel DOM with exact direct-matrix leaves and swap only tile-local ordering. The first standalone hard-set sweep looked promising, but A160-A161 product validation killed it: the apparent `obj_house3` win disappeared, fast intervals regressed, and the renderer patch was reverted. Under the GPU-lane reread, these medium-scene p95 moves are also capped/stress-lane evidence unless they improve p99 or a high-plane GPU-hard model. | Reopen only with a browser-source-backed tile-local metric that survives product validation on GPU-hard intervals. | The dense-tile face rule was a harness/window artifact, not a renderer direction. |
| A160-A161 | ❌ Rejected | Product renderer dense-tile face ordering is a real candidate. | A160 patched `packages/polycss/src/render/voxelRenderer.ts` so the existing tile4 scanline order remained, but dense tiles (`sum projected bbox area / tile bbox area >= 4`) sorted by `FACE_ORDER`. A one-run window looked promising (`obj_house3` p95 59.9 -> 98.3), but A161 two-repeat validation killed it: `obj_house3` landed at 59.9/59.9 p95, `scene_mechanic2` at 59.2/59.5, and `AncientCrashSite` at 28.8/29.4. The patch also dragged previously fast `obj_house3` intervals down to ~60. Product renderer was reverted. | Reopen only with an interval-stable rule that improves `obj_house3` without moving its fast intervals into the 60 bucket. | Dense tile face order was a sample-window artifact, not a robust renderer win. |
| A162 | ✅ Accepted | The residual cost is compositor-side, not DOM mutation, style, layout, or raster. | Added `bench/trace-frame-buckets.mjs` runs for current direct-matrix `obj_house3`, `scene_mechanic2`, and `AncientCrashSite`. Leaf counts stayed constant inside fast/slow buckets; style, layout, prepaint, and raster stayed tiny. The specific `SoftwareRenderer::DoDrawQuad` spike was a software-backend artifact later corrected by A211-A217, but GPU-hard traces still point at 3D property/draw-pass pressure rather than style/layout/raster. | Focus next tests on GPU-hard compositor shape: dirty 3D descendants, projected density, order, wrapper count, and per-pass visible quad work. | Reopen only if a low-intrusion GPU trace shows style/layout/raster taking over after a renderer change. |
| A163-A164 | ❌ Rejected | Direct inline `background` color is a cheaper DrawQuad state than `currentColor`. | Added `--paints` to `bench/voxel-dom-order-probe.mjs`. Standalone `inline-background-shorthand` looked promising on `obj_house3` (`current-color` ~30-34 p95, shorthand ~56 p95), but the real renderer rejected it. Temporary product patch `el.style.background = color` dropped `obj_house3` to 30.2/32.5 p95 and `scene_mechanic2` to 30.0/30.1 p95; `AncientCrashSite` stayed around 17-20 p95. Product renderer was reverted and bench bundles rebuilt. | Reopen only if a trace proves a different paint declaration changes DrawQuad type without hurting product cadence. | The standalone paint signal was harness-specific; product `currentColor` stays. |
| A165 | ❌ Rejected | Direct-matrix leaves do not need `transform-style: preserve-3d` because they have no children. | Extended `bench/voxel-dom-order-probe.mjs` with `--leaf-transform-styles`. On the current hostless direct-matrix shape, `flat` was catastrophic: `obj_house3` fell from ~40 p95 in the standalone window to ~11-12, `scene_mechanic2` to ~8-10, and `AncientCrashSite` to ~4. Product renderer was not patched. | Reopen only if a different DOM shape removes leaf 3D transforms entirely. | `preserve-3d` remains necessary for the current direct-matrix leaves. |
| A166-A167 | ❌ Rejected | `backface-visibility: hidden` can cheaply discard already camera-culled direct voxel leaves. | Extended `bench/voxel-dom-order-probe.mjs` with `--leaf-backfaces`. Standalone was split: hidden helped `AncientCrashSite` and `scene_mechanic2`, but hurt `obj_house3`. Product validation rejected it as a default: hidden put `obj_house3` at 39.8/40.0 p95, `scene_mechanic2` at 38.0/30.0, and `AncientCrashSite` at 20.2/20.0 with bad p99 tails. Product CSS was reverted. | Reopen only for a visually validated non-default diagnostic or if a new culling rule proves hidden is safe for all intervals. | `visible` remains the default voxel leaf backface state. |
| A168 | ❌ Rejected | Move brush size from `matrix3d` scale columns into the CSS box and keep the transform as a unit-orientation matrix. | Extended `bench/voxel-dom-order-probe.mjs` with `--transform-shapes=matrix-scale,css-size-unit-matrix`. The real CSS rect + unit matrix shape was flat on `obj_house3` (~40 p95 both), noisy/flat on `AncientCrashSite`, and worse on `scene_mechanic2` (baseline repeat reached 38.5 p95; unit-matrix repeats stayed ~30). Product renderer was not patched. | Reopen only if a different browser trace shows scaled local rects specifically causing DrawQuad cost. | Moving scale out of the matrix does not unlock a cheaper compositor path. |
| A169 | 🟡 Flat | Leaf containment changes paint/property-tree isolation enough to affect DrawQuad cadence. | Extended `bench/voxel-dom-order-probe.mjs` with `--leaf-contains=none,paint,strict`. On `obj_house3`, all modes stayed at ~40 p95. `AncientCrashSite` stayed around 17-18 p95. `scene_mechanic2` stayed around 39 p95 with noisy p50. Product renderer was not patched. | Reopen only if a renderer shape makes style/layout or invalidation visible in trace. | Current direct-matrix leaves are draw-bound, not containment-bound. |
| A170-A173 | ⚠️ Conditional | Reducing GPU-visible quad work may matter only for high-leaf GPU-hard models. | Added `bench/trace-event-args.mjs` and `bench/voxel-occlusion-potential.mjs`. Trace args show `NumberOfQuads` is basically mounted leaf count; Chromium is not automatically dropping occluded voxel quads. A coarse occlusion estimator found large potential hidden-leaf ratios, but the naive grid-cull p95 wins were software-lane/capped-medium evidence and A174-A210 later rejected sampled culling as a product path. | Reopen only with an exact or conservative interval-stable proof that removes material leaves on `AncientCrashSite`, `skyscraper`, or long-window `army` while preserving order and screenshots. | Do not count capped-medium wins or sampled-mask wins as evidence for this lever. |
| A174-A188 | ❌ Rejected | A simple sampled screen-coverage cull can be made visual-safe with only higher resolution or a minimum projected size. | Added `--visual-diff`, fixed the static screenshot harness, and tested grid resolutions plus `--occlusion-min-cells`. Higher resolution did not fix visual failures. `min-cells=64` passed the hard-set visual diff but culled too little and was flat/worse in perf. `min-cells=48` also passed the hard set, but was similarly flat and regressed `scene_mechanic2` cadence. | Reopen only as a debugging baseline for a better culling proof. | Sampled coverage alone has a bad visual/perf tradeoff. |
| A189-A199 | ⚠️ Conditional | Interior-neighbor guarded occlusion keeps silhouettes while preserving useful culling. | Added `--occlusion-interior-radius`. Radius 1 and 2 passed the hard-set fixed-angle visual diff and removed substantial leaves there. On the broader set, radius 1/2 still failed `treasure` and one `army` angle. Adding a sampled z-buffer and depth margin did not fix `treasure`, so the failure is not just average-depth sorting. | Continue only if a global conservative rule passes the broad visual set, or if the next implementation uses exact geometry rather than sampled masks. | Reject the current radius-only rule as a default because `treasure` fails visual checks. |
| A200-A206 | ⚠️ Conditional | Visual-safe conservative occlusion is possible, but the observed FPS win is entangled with DOM order. | `interior-radius=1` plus `min-cells=20` passed 56 fixed-angle screenshots across `obj_house3`, `scene_mechanic2`, `AncientCrashSite`, `treasure`, `army`, `skyscraper`, and `desert2`. Perf without preserving source order showed some wins (`obj_house3` ~60 -> ~109, `desert2` ~110 -> ~112, `treasure` p50 improved), but also a `scene_mechanic2` regression. After adding `--occlusion-preserve-order`, most wins vanished: `obj_house3` became flat, `scene_mechanic2` stayed flat, `AncientCrashSite` stayed flat, while `desert2` still improved. | Next isolate order and culling separately. A shippable version needs either exact culling that helps while preserving the current order, or a separately validated order rule that does not regress `scene_mechanic2`/`treasure`. | Do not port the current sampled cull to product; the best-looking win is partly a front-to-back order artifact. |
| A207 | ❌ Rejected | A single alternate tile-local DOM order can make the visual-safe sampled cull shippable. | Held the broad visual-safe cull fixed (`interior-radius=1`, `min-cells=20`, preserved source order through cull) and compared `tile4-source`, depth-front/back, face, top-first, and top-last on the hard set. Winners conflict: `obj_house3` needs depth-front/face/top-first (~108-111 p95), `scene_mechanic2` needs source/top-last (~108-110 p95), and `AncientCrashSite` stays around 30 p95 with only p99 churn. | Stop trying to rescue sampled cull by picking another universal order. If cull returns, it needs exact/conservative geometry or an order rule derived from compositor behavior and validated visually. | Reopen only if a new cull changes the candidate set rather than reordering the same sampled survivors. |
| A208-A210 | ❌ Rejected | Interval-stable sampled culling can be product-real and still profitable. | Added `--occlusion-interval-samples` so a cull keeps any leaf needed at sampled angles across the whole visible-face interval, matching the renderer's no-per-frame-remount constraint. It passed the seven-model visual set, but removed too little at p50: `obj_house3` 1057 -> 1050 leaves, `scene_mechanic2` 2216 -> 2212, Ancient effectively unchanged, `skyscraper` 5766 -> 5694. A cached/long-warmup control reduced the cull-computation p99 artifact, but did not change the core leaf-count problem. | Do not pursue sampled culling as a renderer path unless it becomes exact, interval-stable, and removes materially more leaves while preserving order. | Reopen only with a different proof that can cull across a full visible interval rather than at one angle. |
| A211-A217 | ✅ Accepted | The benchmark compositor backend changes the apparent bottleneck. | Default bundled Playwright Chromium on `obj_house3` emitted `SoftwareRenderer::DoDrawQuad` and measured about 60 p95; system Chrome and bundled Chromium with `--use-angle=metal --enable-gpu-rasterization` emitted zero `SoftwareRenderer::DoDrawQuad`, dropped `DirectRenderer::DrawRenderPass` from ~6-16ms to ~1.3ms in the fast bucket, and measured ~112-114 p95. A seven-model GPU sweep put `obj_house3`, `scene_mechanic2`, `treasure`, and `desert2` near 112 p95, while 5k+ leaf models (`AncientCrashSite`, `skyscraper`) remained around 58-59 p95 and `army` stayed window-sensitive. The bench harness now makes this GPU lane the default and exposes `--software-backend` for the old stress lane. | Report browser executable/args/backend for future runs. Treat software-renderer-only wins/losses as bench-environment findings until confirmed on the GPU path. The remaining true renderer target is still reducing dirty 3D descendant/draw-property pressure for 5k+ leaves. | Reopen only if the default bench browser starts emitting `SoftwareRenderer::DoDrawQuad` again or GPU-path traces show the same medium-scene 60fps ceiling. |
| A218 | ✅ Accepted | GPU backend raises the grouped-depth-wrapper threshold, but not enough for the hard high-plane models. | Re-ran synthetic depth groups with ANGLE/Metal. With 7000 leaves under JS root rotation, exact grouped Z wrappers stayed near 112 p95 through `group-z112`, fell to ~60 p95 at `group-z128`, collapsed at `group-z136`, and became unusable by `group-z192`; per-leaf 3D depth stayed slow. Current visible exact-plane counts for hard models are still above the clean GPU threshold: `AncientCrashSite` 191, `skyscraper` 173, `army` 187, `obj_house3` 142, `scene_mechanic2` 163, `treasure` 132; only `desert2` at 102 is under it and is already fast on GPU. | Keep grouped-depth wrappers as a GPU-lane special-case ceiling for <=112 visible planes, not as the universal voxel renderer. | Reopen if a real high-leaf model has <=112 exact visible planes and is not already capped on direct matrix. |

## Closed Rejections

| ID | Status | Rejected hypothesis | Reason |
| --- | --- | --- | --- |
| R1 | ❌ Rejected | Naive scene/mesh/host boxes without visual-preserving transform compensation. | Some scene-box variants hit a fast compositor path, but screenshots were blank, cropped, or off-center; not acceptable as a renderer change. |
| R2 | ❌ Rejected | Matrix atom split for voxel scenes. | Did not beat the dedicated voxel slice renderer. |
| R3 | ❌ Rejected | Inner depth hosts or sibling `(axis, depth)` wrappers as a default renderer. | Extra transformed 3D hierarchy was much slower on real high-plane models. Synthetic probes reopen only a narrow GPU-lane exact-plane special case, not a default renderer. |
| R4 | ❌ Rejected | Nested cartesian coordinate wrappers. | Incompatible with merged rectangles and expected wrapper explosion. |
| R5 | ❌ Rejected | `matrix3d` inside brush leaves while keeping the three voxel hosts. | Host+brush matrix did not beat `left/top/width/height + translateZ`; the promising version removes the axis hosts entirely and uses a non-degenerate normal column. |
| R6 | ❌ Rejected | Mount all six face directions. | Extra active DOM dominated any mutation savings. |
| R7 | ❌ Rejected | Hide pooled leaves instead of removing unused leaves. | Neutral to worse. |
| R8 | ❌ Rejected | Sort brushes by axis/depth/area/color as a default. | Regressed in spot checks. |
| R9 | ❌ Rejected | Split large brushes into smaller rectangles. | More leaves and worse p95. |
| R10 | ❌ Rejected | Source overpaint or no-overlap source planner as default. | Fewer leaves did not reliably win and overpaint risks visuals. |
| R11 | ❌ Rejected | Brush `transform-style: flat`. | Catastrophic regression. |
| R12 | ❌ Rejected | Brush `overflow: hidden`. | Catastrophic regression. |
| R13 | ❌ Rejected | Brush `backface-visibility: hidden`. | Neutral to worse and visually risky. |
| R14 | ❌ Rejected | Host `will-change: transform`. | Neutral to worse. |
| R15 | ❌ Rejected | Remove scene-root `will-change`. | Neutral to worse. |
| R16 | ❌ Rejected | Inline `background-color` instead of `currentColor`. | Neutral to slightly worse. |
| R17 | ❌ Rejected | `translate3d(0,0,z)` or individual `translate` instead of `translateZ`. | Neutral to worse overall. |
| R18 | 🟡 Flat | Leaf containment. | No meaningful win. |
| R19 | ❌ Rejected | Opacity culling for hidden faces. | Keeps paint/composite work alive; contradicts all-faces result. |
| R20 | ❌ Rejected | CSS paint worklet face generation. | Violates no-JS/render-loop direction and is unlikely to be reliable. |
| R21 | ❌ Rejected | JS-scrubbed compositor animation as an interactive camera fix. | Paused WAAPI `currentTime` and JS-driven scroll-timeline `scrollLeft` probes both hit PAC once per frame, matching the normal JS transform mutation path. |
| R22 | ❌ Rejected | Per-leaf square primitive normalization as the default voxel direct-matrix shape. | Clean-rebuild A63-A66 runs show exact square, capped square, axis/face splits, and size bands are flat or short-window cadence artifacts; the 8s confirmation kept `scene_mechanic2` at baseline. |
| R23 | ❌ Rejected | Constant order lookahead or centered-interval order as the default. | A70-A76 found real wins, but every tested phase rule kept hard counterexamples: fixed `+30deg` regressed `obj_house3`, centered/fractional interval order left `obj_house3` p99 tails, and per-item huge-rectangle fallback did not fix it. |
| R24 | ❌ Rejected | Boundary screen-span anchors or adaptive 3x3/5x5 tile density as the default order rule. | A80-A86 found strong 3s wins, including `scene_mechanic2` near the cap and Garden/Treasure improvements. The 8s validation rejected the rule: AncientCrashSite fell ~38 -> ~30 p95 and `obj_house3` fell ~98 -> ~60 p95. |
| R25 | ❌ Rejected | Protecting top faces or reversing scanline traversal fixes the interval-order losses. | A88-A91 showed why the adaptive phase rule failed, then tested two derived fixes. Top-face anchoring killed Garden/Scene/Treasure wins; reverse scanline traversal was broadly worse and collapsed `obj_house3`. |
| R26 | ❌ Rejected | Large-blocker guards or large-top pinning make centered interval order safe. | A94 pinned large top occluders while filling product tile4 slots from centered order; A95 used centered order only when a projected leaf spanned more than one coarse tile. A94 regressed `obj_house3` ~60 -> ~40 p95 and A95 kept the same `obj_house3` loss while providing no broad win. |
| R27 | ❌ Rejected | Plain tile3 or tile6 current-screen order replaces tile4. | A97 tile3-current improves AncientCrashSite in a short window but regresses `obj_house3` ~60 -> ~40 p95. A101 tile6-current is flat/worse than tile5 in the matched 8s hard set. |
| R28 | ❌ Rejected | Tile5 serpentine or reverse scanline traversal improves on tile5 forward. | A104 tile5-serpentine collapses `obj_house3` and Skyscraper and loses the Garden win. A105 tile5-reverse gives Desert2 a large short-window win but also collapses `obj_house3`; traversal direction is not the clean win. |
| R29 | ❌ Rejected | Tile5 scanline-forward is a safer default than tile4. | A99/A102 looked clean on the hard set, but A108-A111 broad corpus validation found no broad win, a confirmed `scene_house3` p95 loss, and p99 tail regressions on `mailbox`, `scene_house`, and `scene_army`. |
| R30 | ❌ Rejected | Re-spelling or splitting the scene transform chain fixes direct-matrix rotation cadence. | A112-A114 show root `matrix3d(...)`, inner target shell, host perspective, transform-function perspective, and scene `will-change: auto` are flat or worse after longer validation. |
| R31 | ❌ Rejected | Depth-sort only projected high-overlap real-model tiles. | A119 translated the synthetic overlap/depth result into the real voxel renderer as a bench-only mode. It avoided `obj_house3` collapse but produced no useful win and regressed `scene_house3` by ~10 p95; `Garden`, `Treasure`, and `army` picked up p99 tail losses. |
| R32 | ❌ Rejected | CSS custom properties, registered properties, or individual `rotate` avoid interactive root-transform PAC. | A135-A137 show all three still hit PAC/layerize like normal JS transform mutation. Unregistered transform vars also add large style cost in trace. |
| R33 | ❌ Rejected | Paint containment on 0x0 depth wrappers is a valid speedup. | A142 looked fast with `contain: paint`/`strict`, but hit-testing showed children were clipped out. A143 boxed the wrappers so containment was visually valid and the win disappeared. |
| R34 | ❌ Rejected | Exact residual per-leaf `translateZ(...)` under coarse wrappers. | A148-A149 show this collapses back to per-leaf 3D transform cost. Coarse grouping only wins when children stay 2D. |
| R35 | ❌ Rejected | Depth quantization to force hard real models under the clean wrapper threshold. | A150 shows the visual error is far too large. Even 48 wrappers per view is still visibly displaced, and approximation is not acceptable for the default renderer. |
| R36 | ❌ Rejected | CSS-variable 2D projection as the interactive renderer shape. | A151 shows dependent leaf transforms cause whole-subtree style recalc, around 25ms/f at 7000 leaves. |
| R37 | ❌ Rejected | Spatially tiled depth wrappers as a way around the wrapper-count ceiling. | A152 shows more bounded wrappers are slower than fewer broad wrappers at the same child count. |
| R38 | ❌ Rejected | Exact per-leaf 3D leaves inside 2D spatial wrappers. | A156 shows 2D tile wrappers are flat or only marginal in synthetic high-overlap cases; they do not change the core browser cost shape. |
| R39 | ❌ Rejected | Full face order or full depth order as the replacement for tile4 source order. | A157-A161 show full face order rescues `obj_house3` but collapses `scene_mechanic2`; full depth variants are also model/interval-specific, and dense-tile face order did not survive product validation. |
| R40 | ❌ Rejected | Dense-tile face order as the product default. | A160-A161 show the apparent win disappears under two-repeat interval validation and can regress fast intervals. |
| R41 | ❌ Rejected | Inline `background`/`background-color` instead of `currentColor` for direct voxel leaves. | A163-A164 show a standalone paint-state win did not transfer to the product renderer and caused major p95 regressions on `obj_house3` and `scene_mechanic2`. |
| R42 | ❌ Rejected | Leaf `transform-style: flat` on hostless direct-matrix voxel leaves. | A165 shows this is catastrophically slower even though leaves have no children. |
| R43 | ❌ Rejected | `backface-visibility: hidden` for direct voxel leaves. | A166-A167 show a split standalone result and product regressions on `obj_house3` and `scene_mechanic2`; it is not a single default strategy. |
| R44 | ❌ Rejected | CSS width/height plus unit-orientation matrix instead of scaled 1px matrix leaves. | A168 shows the visual-equivalent transform shape is flat or worse in the standalone real-model harness. |
| R45 | 🟡 Flat | Leaf `contain: paint` or `contain: strict` on direct voxel leaves. | A169 shows containment does not move the hard set meaningfully. |
| R46 | ❌ Rejected | Naive sampled screen-coverage occlusion as a default. | A174-A188 show the raw grid cull either fails screenshots or becomes too conservative to help. |
| R47 | ❌ Rejected | Interior-neighbor sampled occlusion alone explains the win. | A200-A206 show the visual-safe cull mostly goes flat when source order is preserved; the large wins are mixed with front-to-back DOM order. |
| R48 | ❌ Rejected | Pairing visual-safe sampled occlusion with one alternate tile-local order. | A207 shows the same cull needs opposite order phases for `obj_house3` and `scene_mechanic2`; no single tested order is safe across the hard set. |
| R49 | ❌ Rejected | Product-real interval-stable sampled occlusion. | A208-A210 pass screenshots but remove almost no p50 DOM once the mounted set must be valid across the whole face interval; caching boundary computation does not change that. |

## Next Concrete Order

1. Do not rerun the whole A31/A32 table for every small idea. Run only new
   strategy IDs; rerun the full hard split set only when the DOM shape,
   culling, or measurement harness changes.
2. Keep the committed hostless direct-matrix renderer as the baseline shape:
   1px desktop / 8px mobile canonical leaves, exact `±1` normal column, and
   tile4 scanline order.
3. Treat 100+ FPS as a capped tie. Promote a variant only when it moves an
   uncapped model in longer samples without introducing a p99 tail loss.
4. For order-phase work, segment frames by visible-face interval before
   testing another global rule. The same strategy can win one interval and
   lose another, which short aggregate windows hide.
5. Do not add another coarse per-face/per-span guard without a new trace-backed
   reason. A93-A95 already reject signature-only routing, top-face protection,
   large-blocker presence, and large-top pinning as sufficient predictors.
6. Treat scene-shell transform changes as closed unless the new variant changes
   dirty transform-node topology rather than CSS spelling.
7. Use the synthetic harness for threshold finding with frame buckets, but do
   not promote a synthetic order result unless it survives heavier-load
   validation, not just a near-threshold 5000-leaf flip.
8. For interactive rotation, stop testing transform spelling/API aliases unless
   they can be proven to update the compositor transform node without PAC.
9. Prioritize renderer ideas that reduce exact transformed 3D descendants on
   the GPU-hard class. The old low-teens wrapper ceiling was software-lane; on
   GPU, exact wrappers stay clean to about 112, but hard models still exceed
   that range. Do not pursue residual per-leaf Z or depth quantization.
10. Keep declarative auto-rotate work separate from pointer-driven rotation; it
   may still be useful for demos, but it is not the interactive renderer fix.
11. Treat projected overlap/footprint as a GPU-hard explanatory variable, not
    a reason to chase capped medium scenes. The next useful tests should
    measure or normalize projected overlap on `AncientCrashSite`, `skyscraper`,
    and long-window `army`, not add more transform spellings.
12. For real models, inspect interval-level overlap attribution before another
    ordering change, but focus it on uncapped GPU-hard intervals. Earlier
    `obj_house3`/`scene_mechanic2` order results are now mostly capped/tie
    evidence unless they reveal p99 regressions.
13. Do not promote a candidate from one partial rotation window. A160 looked
    like a breakthrough and A161 showed it was phase/window-sensitive. Future
    order candidates need at least two repeats across a full interval mix.
14. Treat software `DoDrawQuad` cost as a stress-lane bottleneck, not the
    default optimization target. On GPU, the hard cases still show dirty 3D
    descendant, draw-property, and draw-pass pressure; new ideas should explain
    how they reduce that pressure without depending on software renderer
    behavior.
15. Keep occlusion on the table only as an exact/geometric proof. A207 rejects
    rescuing the sampled mask with one alternate tile-local order, and
    A208-A210 show interval-stable sampled culling removes too little to pay
    for itself under the renderer's no-per-frame-remount constraint.
16. Future perf runs default to the GPU lane. Use `--software-backend` only
    when intentionally stress-testing the old SoftwareRenderer path.
17. Do not reopen exact depth wrappers as the default just because the GPU
    threshold is higher. The unresolved models still exceed the clean wrapper
    range; use wrappers only as a validated GPU-lane special case.
18. Rerun old candidates only when they target the GPU-hard class. Software-
    only wins on `obj_house3`, `scene_mechanic2`, `treasure`, or `desert2`
    should not drive new renderer work unless they also improve GPU p99 or a
    high-plane model.
