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
| Voxel hosts | Three axis hosts: `x`, `y`, `z`. |
| Leaves | Plain `<b>` brush rectangles. |
| Positioning | `left/top/width/height` plus one leaf `translateZ(...)`. |
| Culling | Only camera-facing face directions are mounted. |

Current read:

- Extra 3D wrappers are expensive.
- Lower DOM count alone is not a reliable cost model.
- Brush leaves need `transform-style: preserve-3d` and visible overflow.
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
- Matrix-vs-slice fallback selection is real but only partly predictable. An
  86-model cadence corpus has matrix p95 wins on `desert2`, `scene_hazmat`,
  `scene_house`, `scene_mechanic2`, `scene_sidewalk`, and `Treasure`; slice
  p95 wins on `AncientCrashSite`, `armchair`, `christmas_tree`, `ff1`,
  `mailbox`, `obj_house3`, `obj_house8`, `obj_trashcan4`, `pyramid`, and
  `scene_park`; 66 models are flat or capped. Active leaves, local area,
  visible planes, raw source color count, and screen fill each have
  counterexamples.
- Visible shaded brush color count is a useful partial selector, and it is
  different from raw source color count. `visibleShadedColors >= 52`, computed
  from the current polygon brush plan and baked lighting, captures four
  validated strong matrix wins (`scene_hazmat`, `scene_house`,
  `scene_mechanic2`, `Treasure`) and no validated strong slice wins, but it
  misses `desert2` and `scene_sidewalk`, hits many flat/capped scenes, and
  creates one p99 regression on `scene_house3` if used by itself. Adding
  `visiblePlanes < 200` keeps the same p95 wins and removes that p99 loss in
  the current corpus.
- Browser probes on Chrome 148 and Canary 150 keep the refined high-shaded
  gate safe but not universally profitable: `scene_house`, `scene_mechanic2`,
  `Treasure`, and `desert2` stay matrix; `scene_hazmat` can flatten in Chrome;
  `scene_sidewalk`, `pyramid`, and `obj_house3` are browser-ceiling sensitive.
- Headed Chrome tightens that warning: `scene_house` flattens in headed mode
  even though it is a headless matrix win. Treat the selector as a guard
  against known slice slow paths, not a guaranteed speedup.
- A bench-only adaptive route (`polycss-adaptive-shaded`) proves the
  high-shaded gate can be computed before mount and route the renderer. It
  catches `Treasure`, keeps `AncientCrashSite` and `scene_house3` on slices,
  and routes capped high-shaded models as expected. It still misses `desert2`,
  which remains a large low-color matrix win, so the selector is incomplete.
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
- Synthetic depth-group probes reopen depth wrappers only under a very strict
  gate. Moving leaf `translateZ(...)` into one wrapper per depth plane is a big
  win at 17 wrappers and 5000 leaves, but 50 wrappers already loses cadence and
  250 wrappers collapses. Most important real models sit well above the clean
  range (`AncientCrashSite` 191 visible planes, `Treasure` 132, `desert2` 102,
  `pyramid` 68, `ff1` 54, `scene_sidewalk` 47), so depth wrappers remain
  rejected as the default renderer shape.
- A bench-only real-model depth-group variant confirms there is no current
  product payoff. Available sub-30-plane models (`armchair`,
  `obj_trashcan4`, `mailbox`) are already capped/flat, `scene_sidewalk` at 47
  planes is slight regression/noise, and `ff1` at 54 planes collapses to ~30
  FPS p95.
- A corrected hostless direct-matrix voxel prototype identifies the portable
  part of matrix wins. `polycss-polybox` showed that parsed polygons inside
  axis hosts still fall to slice cadence on `desert2`; `polycss-voxlocal-
  direct-matrix` folds the axis host into each leaf's canonical `matrix3d`
  with a normal column and transfers the `desert2` win. It still regresses
  `AncientCrashSite`, `pyramid`, and `scene_park`, and splitting large source
  rectangles loses the win, so this is not a default renderer yet.
- Exact direct matrix remains the strongest one-leaf-shape candidate, but the
  hard part is DOM/paint order. Global projected-depth order transfers matrix
  wins to `desert2`, `house`, `scene_mechanic2`, `Treasure`, and `army`, while
  fixed face order rescues `obj_house3` and stays neutral on
  `AncientCrashSite`/`skyscraper`.
- Hybrid order attempts did not produce a universal rule. Face-depth sorting
  and depth bands with face locality regress key cases; alternate static face
  orders and face-normal order trade one model class for another. The most
  important trace result: same-node-count order flips have almost identical
  PAC/DrawProps/Draw cost per frame, but radically different vsync cadence.
  That points at Chromium's 3D compositor sorting/overlap critical path rather
  than normal style, layout, paint, or node-count costs.
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
  `AncientCrashSite`, and improves `army` over A31 exact. It needs validation
  before becoming a renderer direction.
- A34 validates `tile4-scanline-forward` as a broad default candidate versus
  the current slice shape, but not as the full solution. With five repeats and
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
| D2 | ✅ Accepted | Keep the shallow three-axis-host DOM shape. | It beat every wrapper-heavy variant tested. |
| D3 | ✅ Accepted | Keep one leaf `translateZ(...)` per brush as the default renderer. | Real high-plane models regressed with depth wrappers, and synthetic probes show wrapper count becomes unstable around 50 planes. Only a strict low-plane benchmark gate is still open. |
| D4 | ✅ Accepted | Prefer exact parsed voxel quads over source overpaint for default rendering. | The exact path preserves visual correctness; lower-node source variants did not reliably win. |
| D5 | ✅ Accepted | Keep camera-facing culling. | Mounting all faces regressed hard. |
| D6 | ✅ Accepted | Keep integer CSS cell snapping for `.vox` normalization. | It avoids a scale wrapper and keeps brush coordinates on integer pixels. |
| D7 | ✅ Accepted | Normalize visual fit before comparing voxel renderer FPS. | Fixed zoom can crop or resize large voxel scenes enough to change the benchmark question. |

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
| A21 | ⚠️ Conditional | Some `.vox` models should route to the matrix fallback instead of voxel slices. | 86-model cadence corpus with `bench/voxel-cadence-summary.mjs`, static plan metrics from `bench/voxel-static-metrics.mjs`, Chrome/Canary probes from `bench/voxel-browser-summary.mjs`, and bench-only `polycss-adaptive-shaded`. | Mark accepted only if a cheap static predicate predicts validated matrix wins without hurting slice-favored models. Current partial gate: `visibleShadedColors >= 52 && visiblePlanes < 200`; `desert2` remains unexplained. | Reject if the winner remains unstable after validation or if a predicate that catches `desert2` also routes strong slice winners to matrix. |
| A22 | 🧪 Test next | Declarative camera animation can skip PAC for auto-rotate scenes, but cannot solve interactive JS rotation by itself. | Chromium source read plus `apocalypse/car.glb` probes: JS rotation hit PAC every sample frame; CSS keyframe and running WAAPI hit zero PAC; paused WAAPI `currentTime` and JS `scrollLeft` scroll-timeline probes still hit PAC. Build a bench-only WAAPI/CSS camera mode and run voxel + non-voxel traces without treating trace FPS as final. | Accept a separate auto-rotate path if validated runs show lower PAC and better cadence without visual drift or API contortions. | Reject as a general renderer fix if interactive pointer-driven controls still require JS transform mutation and draw-property cost remains dominant. |
| A23 | ✅ Accepted | Dirty 3D transform-node count is the next lower-level cost model after active DOM leaves. | `bench/compositor-topology-probe.mjs` confirmed the source read: at equal 2500 leaves, `left/top` and 2D `translate` were near-free in draw properties, while `translateZ(0)`, real `translateZ`, and `matrix3d` were ~40-60x higher. | Use this as the browser-shape benchmark for future topology ideas. | Reopen only if another Chromium version makes 3D leaves decompose cheaply. |
| A24 | ⚠️ Conditional | Projected distribution/overlap may explain model variance that leaf count misses. | One longer synthetic distribution probe at equal 1200 `matrix3d` leaves moved DrawProps/Draw by about 20%, but PAC/layerize stayed similar; a shorter rerun was noisier. | Promote if controlled screen-coverage runs and real-model pairs show the same separation. | Reject if the effect collapses under controlled repeats. |
| A25 | 🟡 Flat | Depth-plane wrappers may help only tiny visible-plane voxel scenes. | `bench/compositor-topology-probe.mjs --mode=depth-groups` kept leaf count fixed and moved Z from leaves to depth wrappers. At 5000 leaves, 17 wrappers improved p95/p99 and almost erased draw-property cost; 50 wrappers had cheap trace events but worse cadence; 250 wrappers collapsed. The bench-only `polycss-voxlocal-depth-groups` variant then found no useful real-model win: sub-30-plane models are capped/flat and `ff1` at 54 planes regresses to ~30 FPS p95. | Reopen only if a high-leaf, sub-30-visible-plane real model appears. | Current real corpus has no shippable depth-wrapper gate. |
| A26 | ⚠️ Conditional | Hostless direct canonical matrix brushes are the transferable part of matrix wins. | `polycss-polybox` uses parsed polygons but keeps axis hosts and falls to slice cadence; `polycss-voxlocal-direct-matrix` removes hosts, uses 1px leaves, folds scale/orientation/depth into `matrix3d`, and transfers the `desert2` win while lowering PAC/draw-props. | Accept only if a visual-gated direct-matrix renderer improves a validated model class without regressing slice-favored models. Candidate subtests: source-plan predicate, exact parsed polygon granularity, and visual diff against current slices. | Reject if direct matrices only win when visually different, or if the safe version is just the existing polygon matrix fallback. |
| A27 | ⚠️ Conditional | Exact direct matrix leaves can be the single voxel leaf shape, but order must be solved at the compositor/overlap level. | Same exact `<b>` matrix leaves, same active nodes, and same culling produce opposite cadence depending only on DOM order. Global depth wins `desert2`, `house`, `scene_mechanic2`, `Treasure`, and `army`; face/top-first order rescues `obj_house3` and keeps `AncientCrashSite` neutral. | Promote if a cheap geometry/order policy is neutral-or-better than slices on validated p95/p99 while keeping the same direct matrix leaf shape. | Reject if the policy must become benchmark-feedback routing or if visual checks fail. |
| A28 | ❌ Rejected | A single static or face-normal order can replace model routing. | Tested fixed side-first, side-reverse, top-reverse, face-normal-front/back, face-depth, face-block, and depth-band variants on the hard split set. `obj_house3` rejects side-first/reverse and depth; `desert2` rejects top/normal-front; `house` rejects normal-front; `AncientCrashSite` rejects normal sorting and bands; `Treasure` still needs per-leaf depth for the high bucket. | Reopen only with a new order derived from Chromium sorting behavior, not another static face permutation. | Current static/normal permutations all have hard counterexamples. |
| A29 | ❌ Rejected | Depth bands with face locality bridge face order and projected-depth order. | 4- and 8-band variants reduce mounted nodes but regress `obj_house3`, `army`, `AncientCrashSite`, and `skyscraper`; `Treasure` still stays below global depth. | Reopen only if a different banding rule is tied to measured compositor overlap/sorting, not node count. | Fewer active nodes performed worse, so this is not the missing invariant. |
| A30 | ✅ Accepted | Order-sensitive wins are cadence/scheduler threshold effects, not lower per-frame main-thread compositor work. | One-run traces on `scene_mechanic2` and `obj_house3` with same leaves/nodes show PAC, DrawProps, Draw, paint, raster, and script per inferred frame are nearly identical between fast and slow orders. The difference is the share of 1x-vsync vs 2x/3x-vsync frames. | Next work should inspect overlap/sorting/damage/GPU critical path, not style/layout/PAC totals. | Reopen only if low-intrusion traces on more models show per-frame compositor groups diverging materially. |
| A31 | ❌ Rejected | Projected overlap/order inversions predict when depth order is required. | Added `bench/voxel-order-metrics.mjs` and ran the hard split set with two repeats per strategy. Overlap count, crossing rate, and depth-inversion rate are useful diagnostics, but the naive inversion predictor fails: zero-inversion depth order can be slow, and parsed order can be fast with many inversions. | Reopen only with a more specific Chromium/BSP metric than AABB overlap and average-depth inversion. | Current metric does not correlate with validated or exploratory p95/p99 by order. |
| A32 | ❌ Rejected | Source/spatial locality plus coarse depth ordering may beat pure face and pure depth order. | Tested source-order blocks of 32, 64, 128, and 256 leaves, sorted by average projected depth front/back, on the hard split set with two repeats. | Reopen only if the block definition is derived from a new browser/compositor metric rather than fixed source chunks. | Fixed source chunks are model-specific: they transfer some wins but fail `obj_house3`, miss `army`/`skyscraper`, and do not beat the A31 Pareto frontier. |
| A33 | ⚠️ Conditional | Projected screen-space grouping may match Chromium's 3D overlap/sorting work better than source-order blocks. | Tested 4x4 and 8x8 projected screen tiles with depth-front/back and scanline-forward/reverse ordering on the hard split set with two repeats. A34 then validated `tile4-scanline-forward` against slices with five repeats; A35 rejects `tile4-depth-front` as the one strategy. | Promote only if one deterministic tile policy validates with screenshots and remains neutral-or-better than slices across the hard set. | Reject if the remaining win requires routing/gates or if visual checks fail. |
| A34 | ❌ Rejected | Tile4 spatial locality is useful, but row-major traversal may not be the best one-strategy order. | Tested single-strategy tile4 serpentine and Morton/Z-order traversals as new strategy IDs only. | Reopen only with a new traversal justified by a browser/compositor model. | Serpentine and Morton both lose `obj_house3` and remain below tile4 row-major average. |

## Closed Rejections

| ID | Status | Rejected hypothesis | Reason |
| --- | --- | --- | --- |
| R1 | ❌ Rejected | Naive scene/mesh/host boxes without visual-preserving transform compensation. | Some scene-box variants hit a fast compositor path, but screenshots were blank, cropped, or off-center; not acceptable as a renderer change. |
| R2 | ❌ Rejected | Matrix atom split for voxel scenes. | Did not beat the dedicated voxel slice renderer. |
| R3 | ❌ Rejected | Inner depth hosts or sibling `(axis, depth)` wrappers as a default renderer. | Extra transformed 3D hierarchy was much slower on real high-plane models. Synthetic probes reopen only a strict low-visible-plane benchmark gate. |
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

## Next Concrete Order

1. Do not rerun the whole A31/A32 table for every small idea. Run only new
   strategy IDs; rerun the full hard split set only when the DOM shape,
   culling, or measurement harness changes.
2. Screenshot-check `tile4-scanline-forward` against the current voxel slice
   renderer on the hard split set. If visuals pass, keep it as the broad
   direct-matrix prototype baseline.
3. If screenshots pass, port `tile4-scanline-forward` as the direct-matrix
   prototype order and compare it against the current voxel slice renderer in
   the gallery manually.
4. Keep declarative auto-rotate work separate from pointer-driven rotation; it
   may still be useful for demos, but it is not the interactive renderer fix.
