# Trace Investigation

This is the next phase after the voxel fast-path comparison. The goal is no
longer "close the voxcss gap". Polycss is already in the same performance
class and wins on several model classes. The next breakthrough has to come
from understanding the Chrome trace: which browser subsystem burns frame
budget, what DOM/CSS shape triggers it, and which renderer changes are worth
testing because the trace predicts them.

## Current Read

Earlier trace captures that established the compositor-heavy shape, current
voxel fast path, one run each:

| Model | Leaves | FPS p95 | PAC ms/frame | Layerize ms/frame | DrawProps ms/frame | Draw ms/frame | Paint ms/frame | Raster ms/frame |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `scene_vehicles1.vox` | 752 | 112.4 | 0.48 | 0.48 | 0.38 | 0.45 | 0.00 | 0.00 |
| `MechaGolem.vox` | 1789 | 62.6 | 1.11 | 1.11 | 1.09 | 1.20 | 0.01 | 0.00 |
| `AncientCrashSite.vox` | 5233 | 40.0 | 3.84 | 3.84 | 3.77 | 4.65 | 0.02 | 0.00 |
| `Garden.vox` | 7186 | 24.0 | 4.62 | 4.62 | 5.18 | 6.42 | 0.09 | 0.00 |

`PAC` is `PaintArtifactCompositor::Update`. These trace events are nested, so
the columns are not additive. They are diagnostic landmarks.

Deeper control traces, same DOM:

| Model | Motion | FPS p95 | PAC ms/frame | DrawProps ms/frame | Script ms/frame |
| --- | --- | ---: | ---: | ---: | ---: |
| `Garden.vox` | no transform update | 111.2 | 0.00 | 0.00 | 0.08 |
| `Garden.vox` | repeated same transform value | 113.6 | 0.00 | 0.00 | 0.13 |
| `Garden.vox` | changing rotation | 20.5 | 4.65 | 5.15 | 0.37 |
| `AncientCrashSite.vox` | no transform update | 112.5 | 0.00 | 0.00 | 0.08 |
| `AncientCrashSite.vox` | repeated same transform value | 112.4 | 0.00 | 0.00 | 0.14 |
| `AncientCrashSite.vox` | changing rotation | 40.0 | 3.85 | 3.80 | 0.25 |
| `MechaGolem.vox` | no transform update | 112.4 | 0.00 | 0.00 | 0.07 |
| `MechaGolem.vox` | repeated same transform value | 111.1 | 0.00 | 0.00 | 0.13 |
| `MechaGolem.vox` | changing rotation | 62.3 | 1.10 | 1.07 | 0.16 |

This separates three things:

- Mounted DOM by itself is cheap when the composed transform does not change.
- Calling the same update path every frame is cheap when the transform value
  stays identical.
- The expensive path appears when the root camera transform changes over the
  preserve-3d subtree.

The per-leaf camera-rotation slope is also consistent enough to be useful:

| Scene | Renderer class | Leaves | PAC us/leaf | DrawProps us/leaf | Draw us/leaf |
| --- | --- | ---: | ---: | ---: | ---: |
| `scene_vehicles1.vox` | voxel brushes | 752 | 0.637 | 0.503 | 0.598 |
| `MechaGolem.vox` | voxel brushes | 1789 | 0.612 | 0.598 | 0.661 |
| `AncientCrashSite.vox` | voxel brushes | 5233 | 0.736 | 0.727 | 0.887 |
| `Garden.vox` | voxel brushes | 7186 | 0.647 | 0.717 | 0.866 |
| `ducky.glb` | normal polygon leaves | 471 | 0.722 | 0.979 | 1.520 |
| `apocalypse/car.glb` | normal polygon leaves | 3359 | 0.680 | 0.774 | 1.135 |

So the camera-motion cost is not voxel-specific. It is the general cost of
changing a 3D root transform over many preserve-3d DOM leaves. Voxel scenes
benefit because they reduce the active leaf count; non-voxel scenes still pay
the same browser-side slope per active transformed leaf.

Dynamic light rotation is a different problem. On `apocalypse/car.glb`,
`dynamic.light_rotate` spent roughly 40 ms/frame in style update and 7 ms/frame
in raster, while camera rotation spent roughly 2.3-2.5 ms/frame in PAC and
draw properties. Keep those investigations separate.

Clean matrix-vs-slice cadence runs, current browser, five runs each:

| Model | Path | FPS p95 | P99 ms | 1-vsync frames | 2-vsync frames | 3-vsync frames | 4+-vsync frames |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `MechaGolem.vox` | matrix fallback | 117.6 | 9.2 | 100.0% | 0.0% | 0.0% | 0.0% |
| `MechaGolem.vox` | voxel slices | 117.6 | 9.0 | 100.0% | 0.0% | 0.0% | 0.0% |
| `Treasure.vox` | matrix fallback | 58.0 | 25.0 | 30.6% | 64.9% | 3.5% | 0.6% |
| `Treasure.vox` | voxel slices | 30.0 | 33.4 | 6.5% | 51.6% | 33.1% | 7.3% |
| `AncientCrashSite.vox` | matrix fallback | 39.8 | 33.4 | 7.5% | 64.4% | 20.5% | 3.7% |
| `AncientCrashSite.vox` | voxel slices | 58.4 | 25.0 | 14.9% | 82.5% | 2.5% | 0.0% |
| `Garden.vox` | matrix fallback | 24.3 | 41.8 | 4.9% | 29.0% | 39.2% | 24.5% |
| `Garden.vox` | voxel slices | 24.0 | 50.1 | 0.0% | 9.6% | 26.5% | 63.8% |
| `scene_vehicles1.vox` | matrix fallback | 117.6 | 9.1 | 100.0% | 0.0% | 0.0% | 0.0% |
| `scene_vehicles1.vox` | voxel slices | 119.0 | 9.1 | 100.0% | 0.0% | 0.0% | 0.0% |

This reframes the adaptive matrix-vs-slice idea. Matrix and slice have the same
active leaf ranges and the same two visible-face transitions:

| Model | Active leaves, matrix | Active leaves, voxel slices |
| --- | ---: | ---: |
| `MechaGolem.vox` | 1199-1789 | 1199-1789 |
| `Treasure.vox` | 2582-4010 | 2582-4010 |
| `AncientCrashSite.vox` | 4158-5240 | 4158-5240 |
| `Garden.vox` | 4668-7186 | 4668-7186 |

The two paths are no longer separated by mounted leaf count. When one wins, it
wins by browser cadence: how often Chrome lands on 1/2/3/4+ vsync buckets.
Current trace samples still show the matrix path doing more per-frame PAC and
draw-property work than slices, even when matrix has better p95 on `Treasure`.
So the remaining question is a hidden scheduling/property-tree behavior, not a
simple "less compositor CPU" result.

The wider clean corpus keeps that read. Use the corpus summarizers after adding
more runs:

```sh
node bench/voxel-cadence-summary.mjs
node bench/voxel-static-metrics.mjs
node bench/voxel-browser-summary.mjs
```

Current corpus: 86 models, with validation runs preferred over exploratory
runs.

| Class | Models |
| --- | --- |
| Matrix p95 win | `desert2`, `scene_hazmat`, `scene_house`, `scene_mechanic2`, `scene_sidewalk`, `Treasure` |
| Slice p95 win | `AncientCrashSite`, `armchair`, `christmas_tree`, `ff1`, `mailbox`, `obj_house3`, `obj_house8`, `obj_trashcan4`, `pyramid`, `scene_park` |
| Mostly flat / capped | 66 of 86 models |
| P99-only split | `Garden` favors matrix p99 |
| Slice p99-only split | `dual`, `scene_fall`, `scene_house3` favor slice p99 |

No simple structural metric explains the full corpus yet. `scene_park` and
`scene_hazmat` have similar active leaves, screen fill, and broad model shape
but opposite winners. `HUT` has very high screen fill and is flat;
`AncientCrashSite` has lower screen fill and prefers slices; `Treasure`
prefers matrix. Local brush area, active leaves, visible planes, color count,
and screen fill each fail on at least one model.

The static metrics pass adds one useful partial selector: visible shaded brush
color count, computed from the same polygon plans and baked light math the
voxel renderer uses. This is not the raw `.vox` source color count. With the
current 86-model corpus, `visibleShadedColors >= 52` captures
`scene_hazmat`, `scene_house`, `scene_mechanic2`, and `Treasure`, hits no
validated strong slice winners, and leaves `desert2` and `scene_sidewalk`
unexplained. It also hits many flat/capped scenes, so it is a safe-looking
partial gate, not a full classifier. Against always-slice it gives four p95
wins and no p95 losses in the current corpus, but it does introduce one p99
loss: `scene_house3`. A stricter diagnostic gate,
`visibleShadedColors >= 52 && visiblePlanes < 200`, keeps the same four p95
wins and removes that p99 loss on the current corpus.

The follow-up structural-neighbor sweep did not find a repeatable second rule
for `desert2` or `scene_sidewalk`. `desert2` sits among low-color/high-area
neighbors where `ff1`, `pyramid`, and `christmas_tree` prefer slices and
`MechaGolem`, `mecha`, `obj_house5`, and `StarMarineTrooper` are flat.
`scene_sidewalk`'s low-plane/high-fill neighbors were mostly flat or
slice-favored (`armchair`, `mailbox`, `obj_trashcan4`), so treat
`scene_sidewalk` as a browser-ceiling case, not a classifier anchor.

Target-size sweeps do not explain the remaining stable matrix wins. On
`desert2`, slice local area moved from ~10M to ~34M px across target sizes
50-90, but slice stayed at ~30 FPS p95 while matrix stayed ~59.5 FPS p95.
On `scene_mechanic2`, slice p95 wandered between ~30 and ~39 FPS while
matrix stayed ~59 FPS p95. This rules out CSS cell size / local brush area as
the root cause for those matrix wins.

A bench-only adaptive selector, `polycss-adaptive-shaded`, now computes the
same source-plan gate before mounting:

```txt
use matrix when visibleShadedColors >= 52 && visiblePlanes < 200
```

Short two-repeat route checks:

| Model | Metrics | Matrix p95 | Slice p95 | Adaptive p95 | Adaptive route | Read |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `Treasure.vox` | 58 colors, 132 planes | 40.0 | 30.0 | 40.0 | matrix | Correctly catches a slice-slow model. |
| `AncientCrashSite.vox` | 44 colors, 191 planes | 30.0 | 40.0 | 39.8 | slice | Correctly avoids a slice-favored model. |
| `scene_vehicles1.vox` | 53 colors, 90 planes | 113.6 | 113.6 | 111.1 | matrix | Flat/capped; routing costs no material p95 but adds nodes. |
| `scene_hazmat.vox` | 84 colors, 130 planes | 114.9 | 111.1 | 114.9 | matrix | Correctly routes, though this browser run is mostly capped. |
| `scene_house3.vox` | 80 colors, 217 planes | 39.8 | 39.8 | 39.8 | slice | The plane cutoff avoids the known p99-risk model. |
| `desert2.vox` | 21 colors, 102 planes | 111.1 | 59.2 | 59.5 | slice | Major miss; the selector is incomplete. |

This is not ready as a production default. It proves the route can be computed
before mount and catches high-shaded slice-slow models, but `desert2` remains a
large matrix win outside the gate. The next useful selector work is to explain
`desert2` without adding slice-favored false positives.

Browser probes confirm that browser mode changes the apparent class:

| Model | Bundled Chromium headless | Chrome 148 headless | Canary 150 headless | Chrome 148 headed |
| --- | --- | --- | --- | --- |
| `scene_hazmat` | matrix | flat | matrix | not run |
| `scene_house` | matrix | matrix | matrix | flat |
| `scene_mechanic2` | matrix | matrix | matrix | matrix |
| `Treasure` | matrix | matrix | matrix | matrix-p99 |
| `desert2` | matrix | matrix | matrix | matrix |
| `scene_sidewalk` | matrix | flat | flat | not run |
| `AncientCrashSite` | slice | slice-p99 | slice | slice-p99 |
| `obj_house3` | slice | flat | slice | not run |
| `pyramid` | slice | flat | flat | not run |
| `scene_house3` | slice-p99 | flat | flat | not run |

The useful read: the refined high-shaded gate is cross-browser safe in this
sample because it turns some wins into flats, not losses. `desert2` is the
only stable matrix win outside that gate. The low-color slice wins are often
ceiling-sensitive across installed browsers. Headed Chrome makes this stricter:
`scene_house` flattens even though headless browsers usually favor matrix, so
any production selector has to be justified as "avoid known slow slice cases",
not as "always faster".

Five-repeat validation is mandatory before promoting a two-run split. The
expanded sweep produced several mirages that flattened under validation:
`scene_sumo`, `scene_parked`, `scene_hunt`, and `scene_house5`. The later
low-plane sweep found exploratory slice wins (`armchair`, `mailbox`,
`obj_trashcan4`) that should not become anchors until validated.

Strong validated winners:

| Model | Winner | Matrix p95 | Slice p95 | Matrix p99 | Slice p99 | Leaves | Nodes M/S | Planes | Colors | Screen |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| `pyramid` | slice | 59.9 | 104.2 | 16.9 | 9.8 | 1774 | 3057/1812 | 68 | 19 | 1.247 |
| `scene_park` | slice | 59.9 | 103.1 | 16.8 | 10.0 | 1694 | 3210/1722 | 193 | 30 | 3.280 |
| `scene_hazmat` | matrix | 101.0 | 59.3 | 10.6 | 17.6 | 1586 | 2979/1624 | 130 | 59 | 3.181 |
| `ff1` | slice | 63.4 | 102.7 | 16.7 | 10.6 | 1569 | 3133/1627 | 54 | 2 | 1.925 |
| `scene_house` | matrix | 98.0 | 59.2 | 16.7 | 17.7 | 1619 | 2928/1647 | 182 | 69 | 3.215 |
| `AncientCrashSite` | slice | 23.8 | 57.8 | 63.1 | 20.7 | 5233 | 10459/5268 | 192 | 44 | 1.585 |
| `obj_house3` | slice | 29.9 | 59.2 | 41.6 | 17.4 | 1057 | 2179/1140 | 142 | 15 | 9.533 |
| `Treasure` | matrix | 57.8 | 32.5 | 25.0 | 33.4 | 4010 | 7121/4038 | 140 | 59 | 2.600 |
| `desert2` | matrix | 59.9 | 38.0 | 17.0 | 33.4 | 1984 | 4167/2012 | 102 | 21 | 4.866 |
| `scene_mechanic2` | matrix | 59.5 | 40.0 | 17.1 | 25.3 | 2216 | 4264/2244 | 166 | 89 | 2.409 |
| `obj_house8` | slice | 97.1 | 112.4 | 16.9 | 10.1 | 452 | 909/489 | 90 | 24 | 3.482 |
| `christmas_tree` | slice | 103.1 | 117.6 | 10.1 | 9.8 | 1464 | 2693/1493 | 73 | 13 | 1.332 |
| `scene_sidewalk` | matrix | 117.6 | 104.1 | 10.0 | 10.1 | 436 | 972/482 | 47 | 32 | 1.215 |

Two focused DOM-shape probes closed:

- Leaf `transform-style: flat` is not a simplification. It caused order-of-
  magnitude regressions (`Garden` slice p95 ~24 -> ~2.4, `AncientCrashSite`
  slice ~40 -> ~4.9, `MechaGolem` slice ~60 -> ~13.3). The current
  `preserve-3d` leaf style appears to be part of Chrome's valid 3D fast path.
- Keeping the three voxel hosts but turning each brush into a 1px
  `matrix3d(...)` scale/translate leaf collapsed local layout area but stayed
  in the slice cadence class. On `Treasure`, where matrix fallback wins, the
  host+brush-matrix variant stayed around 30 FPS p95 while matrix fallback
  reached ~58 FPS p95.
- Removing the three voxel hosts and emitting direct matrix leaves from the
  voxel renderer was not robust. After restoring visible backfaces it looked
  close in static screenshots, but still had measurable image diffs and
  regressed several models (`AncientCrashSite`, `Garden`, `army`, `desert2`).
  It is useful evidence that host count is not the sole issue.

The later direct-matrix revisit clarified that result. The first broken
prototype used singular-ish matrices for side planes. Adding the same kind of
normal column the real polygon matrix path uses fixed the flat/invalid
projection on `desert2` and exposed the actual transferable property:

```txt
hosted slice brush:
  axis host rotate + left/top/width/height + leaf translateZ

matrix-like brush:
  direct scene child + 1px primitive + matrix3d(rect basis, normal, translate)
```

Bench-only `polycss-voxlocal-direct-matrix` keeps the voxel source brush plan
and culling, but folds each axis host into a direct canonical matrix leaf.
Current one-run reads:

| Model | Matrix p95 | Slice p95 | Direct matrix p95 | Direct split8 p95 | Read |
| --- | ---: | ---: | ---: | ---: | --- |
| `desert2.vox` | 113.6 | 59.5 | 107-110 | 59.9 | Direct canonical matrices transfer the win; splitting destroys it. |
| `Treasure.vox` | 40.0 | 30.0 | 30-39 | 29.9 | Direct shape helps inconsistently; full polygon matrix is still steadier. |
| `AncientCrashSite.vox` | 39.7 | 39.8 | 18-24 | 24.0 | Direct source matrices are a regression. |
| `ff1.vox` | 111.1 | 112.4 | 116.6 | not run | Capped/flat; direct matrix is safe here. |
| `pyramid.vox` | 114.9 | 112.4 | 60.2 | 59.9 | Direct source matrices regress a slice-favored model. |
| `scene_park.vox` | 111.3 | 117.6 | 107.6 | not run | Slice path remains better. |

Trace on `desert2` confirms that this is no longer just a hidden cadence
artifact. Direct matrix source brushes lower compositor work:

| Path | FPS p95 | P99 ms | 1x vsync | PAC ms/frame | DrawProps ms/frame | Draw ms/frame |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Matrix fallback | 113.4 | 9.2 | 100.0% | 1.49 | 1.55 | 1.88 |
| Voxel slices | 59.5 | 17.1 | 37.1% | 1.33 | 1.27 | 1.63 |
| Voxel direct matrix | 107.5 | 16.8 | 95.6% | 0.76 | 0.77 | 0.90 |

Trace on `AncientCrashSite` shows the constraint: direct matrices also lower
PAC/draw-props there, but cadence gets worse (`18.1` FPS p95, `62.8ms` p99).
So lower compositor-summary cost is necessary but not sufficient; draw
scheduling and/or the coarse source-rectangle geometry still matter.

The exact-quad revisit found a stronger version of the same idea. Instead of
using merged source rectangles, `polycss-voxlocal-direct-matrix-exact` emits
one direct child `<b>` per exact parsed voxel quad. That keeps the same active
leaf count as slices while using the matrix leaf shape:

```txt
scene root
  b matrix3d(...)
  b matrix3d(...)
  ...
```

The remaining variable is DOM order. Parsed polygon order transfers the
`desert2` and `Treasure` matrix wins, but leaves `AncientCrashSite` in the
bad 30 FPS p95 bucket. Coarse face grouping fixes `AncientCrashSite` but
breaks `desert2`/`Treasure`. Six face wrappers, whether hidden with
`display:none` or detached, also break the `desert2` win. That isolates the
candidate shape:

```txt
direct child canonical matrix leaves, no transformed axis hosts, no face
wrappers, order chosen at cull-boundary time
```

Projected-depth ordering was the first ordering rule that worked across the
initial tradeoff set. It sorts the visible exact matrix leaves by approximate
camera depth only when the visible face signature changes; no per-frame leaf
updates are added.

Validated with wall-time rotation, 5 repeats, 1280x800, bundled Chromium:

| Model | Path | FPS p50 | FPS p95 | P99 ms | Read |
| --- | --- | ---: | ---: | ---: | --- |
| `AncientCrashSite.vox` | voxcss 3d | 59.9 | 39.4 | 33.4 | Baseline ceiling class. |
| `AncientCrashSite.vox` | voxel slices | 59.9 | 40.0 | 25.2 | Current accepted path. |
| `AncientCrashSite.vox` | exact direct matrix, parsed order | 59.9 | 30.0 | 33.6 | Bad order. |
| `AncientCrashSite.vox` | exact direct matrix, depth-front | 59.9 | 39.8 | 33.3 | Recovers p95, p99 still worse. |
| `AncientCrashSite.vox` | exact direct matrix, depth-back | 59.9 | 39.8 | 26.1 | Recovers p95 and nearly slice p99. |
| `desert2.vox` | voxcss 3d | 119.0 | 59.5 | 17.4 | Voxcss stays in 60 FPS p95 bucket. |
| `desert2.vox` | voxel slices | 60.2 | 59.3 | 17.4 | Current slice path is also 60 FPS. |
| `desert2.vox` | exact direct matrix, parsed order | 120.5 | 112.4 | 9.2 | Matrix win. |
| `desert2.vox` | exact direct matrix, depth-front | 120.5 | 112.4 | 9.2 | Keeps the win. |
| `desert2.vox` | exact direct matrix, depth-back | 120.5 | 112.4 | 9.3 | Keeps the win. |
| `Treasure.vox` | voxcss 3d | 59.9 | 29.9 | 33.6 | Voxcss/slices are slow here. |
| `Treasure.vox` | voxel slices | 41.0 | 29.8 | 41.7 | Current slice path is slow. |
| `Treasure.vox` | exact direct matrix, parsed order | 60.2 | 40.2 | 25.1 | Matrix win. |
| `Treasure.vox` | exact direct matrix, depth-front | 59.9 | 40.0 | 25.2 | Keeps the win. |
| `Treasure.vox` | exact direct matrix, depth-back | 60.2 | 40.1 | 25.2 | Keeps the win. |

The trace read is supportive but not the primary proof, because tracing can
perturb the exact cadence bucket. In one trace pass, depth-back reduced script
and style time versus parsed order on `desert2`/`Treasure` and matched slice
p99 on `AncientCrashSite`; compositor totals were still large. Treat the
clean cadence validation as the decision signal and traces as explanation.

The broader corpus disproved a single fixed depth order as the default. A
157-model exploratory pass and targeted validation found:

| Model | Slice p95/p99 | Depth-front p95/p99 | Depth-back p95/p99 | Read |
| --- | ---: | ---: | ---: | --- |
| `obj_house3.vox` | 112.4/9.2 | 59.9/17.3 | 58.8/25.0 | Hard counterexample to global depth order. |
| `obj_house5.vox` | 114.9/9.1 | 113.6/9.2 | 59.9/16.8 | Direction-sensitive; front is fine, back breaks. |
| `HUT.vox` | 59.9/17.2 | 59.9/17.3 | 57.9/25.0 | Back has p99 risk; front is flat. |
| `skyscraper.vox` | 29.6/40.6 | 24.0/42.2 | 24.2/41.8 | Direct matrix order is not reliably better. |
| `army.vox` | 40.0/25.1 | 39.8/33.3 | 59.5/17.4 | Back is the win; front has p99 risk. |
| `house.vox` | 60.1/16.7 | 112.4/9.2 | 114.9/9.2 | Depth order is a large win. |
| `scene_mechanic2.vox` | 59.5/17.3 | 112.1/9.3 | 111.1/9.3 | Depth order is a large win. |
| `desert2.vox` | 59.4/17.4 | 111.1/9.2 | 112.4/9.2 | Depth order is a large win. |
| `Treasure.vox` | 30.0/33.9 | 58.0/25.0 | 58.7/25.0 | Depth order is a large win. |
| `AncientCrashSite.vox` | 40.0/25.2 | 39.8/25.9 | 40.0/25.6 | Flat and visually acceptable. |

The strongest counterexample, `obj_house3`, isolates the issue further. It is
not rejecting direct matrix leaves. Existing polygon matrix, exact direct
matrix in parsed order, and global depth order all sit around 59 FPS p95,
while direct child face order returns to the slice-class 110+ FPS p95. So the
browser fast path is order-sensitive:

```txt
same direct child <b> matrix leaf shape
different DOM order -> different cadence bucket
```

Testing face-major plus depth-within-face order did not unify the paths. It
keeps the face-order rescue on `obj_house3`, but loses the depth-order wins on
`desert2`, `house`, and `scene_mechanic2`. The current best interpretation is
that there are at least two useful compositor ordering classes:

- global projected-depth order for large wins such as `desert2`, `house`,
  `scene_mechanic2`, `Treasure`, and back-order `army`;
- coarse face order for `obj_house3` and similar capped house-like cases.

The strongest current explanation:

- Matrix wins are caused by direct canonical matrix leaves that avoid the
  axis-host transform chain and layout-sized brush surfaces.
- The normal column in `matrix3d` matters. Without it, side-plane matrices are
  effectively degenerate and render flat/wrong.
- Merged source rectangles are not reliable enough. Naively splitting them
  adds dirty transform nodes and loses the win.
- Exact voxel quads plus direct matrix leaves remain the current best one
  leaf-shape candidate.
- A single fixed DOM order is not proven. Global projected-depth order wins
  several heavy models but regresses `obj_house3`; face order fixes
  `obj_house3` but loses key depth-order wins.
- The remaining proof work is now an order policy or a structural renderer
  route. If the route only changes ordering while keeping the same direct
  matrix leaf shape, it is still better than switching render strategies.

The important read is stable:

- Raster is not the limiting phase in these captures.
- Paint is not the limiting phase in these captures.
- Style and layout are too small to explain the frame time.
- The recurring cost is compositor/layer lifecycle:
  `PaintArtifactCompositor::Update`, `Layerize`,
  `LayerTreeImpl::UpdateDrawProperties`, `LayerTreeHostImpl::PrepareToDraw`,
  and `MainFrame.Draw`.
- For camera rotation, active transformed leaf count is now the best first
  predictor. It is not the whole model, but the per-leaf slope is stable enough
  to guide renderer work.

## Chromium Source Read

Chromium's public RenderingNG docs match the trace shape we are seeing. Visual
changes can skip layout/pre-paint/paint when they are compositor-thread visual
effect animations, but the pipeline still has layerize, activate, aggregate,
and draw stages. Property trees are the transform/clip/effect/scroll state the
compositor uses to answer where content is on screen, and paint chunks are
layerized into cc layers by trading GPU memory against future update cost.

The relevant source path is narrower:

- `PaintArtifactCompositor::Update` is the expensive full path. It rebuilds
  pending layers, runs `Layerizer(...).Layerize()`, creates/updates compositor
  property tree nodes, and sets the layer list.
- `PaintArtifactCompositor::TryFastPathUpdate` handles repaint/raster-scroll
  cases without full layerization.
- `PaintArtifactCompositor::DirectlyUpdateTransform` can skip full PAC
  layerization only when the transform node is known composited and has active
  transform animation. The call site in `paint_property_tree_builder.cc`
  explicitly gates the downgrade from `kChangedOnlySimpleValues` to
  `kChangedOnlyCompositedValues` on `transform.HasActiveTransformAnimation()`.
- Even the successful direct transform path updates the cc transform node,
  marks the transform tree dirty, and calls `SetNeedsCommit()`. That means the
  win is "skip PAC/layerize", not "free rotation".
- `TransformTree::UpdateAllTransforms` iterates transform nodes when dirty.
  `draw_property_utils::CalculateDrawProperties` then updates property trees,
  finds visible layers, computes screen/target transforms, visible rects, and
  drawable content rects. This is the remaining per-frame cost after PAC is
  gone.

This explains why the current JS orbit path keeps showing PAC: polycss mutates
`sceneEl.style.transform` through `scene.setOptions()` every frame. The scene
root has `will-change: transform`, so it is composited, but a JS style mutation
is not the same as an active compositor transform animation for the direct
update gate.

Quick source-driven probes confirm this on `apocalypse/car.glb` through the
vanilla bench page. Same DOM, baked lighting, trace enabled, 1280x800:

| Motion | FPS p50 | FPS p95 | PAC count | PAC total ms | DrawProps total ms | Draw total ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Static | 120.5 | 114.9 | 0 | 0.0 | 35.4 | 72.8 |
| JS `scene.setOptions({ rotY })` | 13.3 | 13.2 | 40 | 91.1 | 103.9 | 151.4 |
| CSS keyframe `transform` on `.polycss-scene` | 59.9 | 13.4 | 0 | 0.0 | 186.2 | 303.6 |
| Running WAAPI `transform` animation | 59.9 | 13.4 | 0 | 0.0 | 181.5 | 298.5 |
| Paused WAAPI animation scrubbed with `currentTime` from JS | 13.3 | 12.0 | 39 | 88.9 | 101.8 | 151.3 |
| Scroll-timeline animation scrubbed by JS `scrollLeft` | 13.3 | 12.0 | 38 | 81.2 | 158.0 | 199.6 |

The exact FPS from these probes is trace-perturbed and should not be treated as
a shipping benchmark. The source-level result is the important part:
declarative running transform animation removes PAC, but draw-property and draw
costs remain large for a big preserve-3d subtree. JS scrubbing an otherwise
compositor-backed mechanism (`Animation.currentTime` or `scrollLeft`) does not
preserve the PAC win.

The first synthetic topology probe confirms the lower-level transform-node
cost. It used 2500 `<b>` leaves under the same running CSS-animated
preserve-3d root, so PAC stayed zero and the comparison isolates draw-property
and draw work:

| Leaf topology | FPS p95 | PAC ms/frame | DrawProps ms/frame | Draw ms/frame |
| --- | ---: | ---: | ---: | ---: |
| `left/top`, no leaf transform | 112.4 | 0.000 | 0.016 | 0.066 |
| 2D `translate(...)` leaf transform | 113.6 | 0.000 | 0.017 | 0.066 |
| `translateZ(0)` leaf transform | 112.4 | 0.000 | 0.639 | 1.851 |
| Real `translateZ(...)` leaf transform | 111.1 | 0.000 | 0.914 | 2.310 |
| `matrix3d(...)` leaf transform | 112.4 | 0.000 | 0.956 | 2.276 |

This is the clearest browser-level result so far: a syntactically 3D leaf
transform, even `translateZ(0)`, moves the page into the expensive transform
tree / draw-properties class. A 2D translate is decomposed or otherwise handled
like `left/top`. That directly matches `PendingLayer::DecompositeTransforms`,
which only decomposes identity/2D translations.

The depth-grouping follow-up moved leaf `translateZ(...)` into one wrapper per
axis/depth plane while keeping the same leaf count. This gives a sharper
threshold than the earlier real-renderer wrapper tests:

| Leaves | Root motion | Variant | FPS p95 | P99 ms | PAC ms/frame | DrawProps ms/frame | Draw ms/frame |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 2500 | JS transform mutation | leaf-z17 | 113.6 | 9.3 | 1.131 | 1.427 | 2.007 |
| 2500 | JS transform mutation | group-z17 | 113.6 | 9.2 | 0.419 | 0.033 | 0.083 |
| 2500 | JS transform mutation | leaf-z50 | 116.3 | 9.2 | 1.130 | 1.468 | 2.036 |
| 2500 | JS transform mutation | group-z50 | 117.6 | 9.1 | 0.445 | 0.062 | 0.163 |
| 2500 | JS transform mutation | leaf-z250 | 40.0 | 25.1 | 1.151 | 1.449 | 2.049 |
| 2500 | JS transform mutation | group-z250 | 113.6 | 16.6 | 0.522 | 0.249 | 0.494 |
| 5000 | JS transform mutation | leaf-z17 | 59.5 | 17.3 | 2.508 | 3.162 | 4.139 |
| 5000 | JS transform mutation | group-z17 | 114.9 | 9.2 | 0.807 | 0.035 | 0.155 |
| 5000 | JS transform mutation | leaf-z50 | 40.0 | 25.7 | 2.537 | 3.236 | 4.197 |
| 5000 | JS transform mutation | group-z50 | 29.9 | 41.6 | 0.825 | 0.060 | 0.294 |
| 5000 | JS transform mutation | leaf-z250 | 29.7 | 33.9 | 2.585 | 3.417 | 4.623 |
| 5000 | JS transform mutation | group-z250 | 13.3 | 75.0 | 26.844 | 1.312 | 2.540 |
| 5000 | CSS transform animation | leaf-z17 | 59.5 | 16.9 | 0.000 | 1.773 | 4.072 |
| 5000 | CSS transform animation | group-z17 | 116.3 | 9.2 | 0.000 | 0.025 | 0.154 |
| 5000 | CSS transform animation | leaf-z50 | 58.8 | 24.9 | 0.000 | 1.912 | 4.213 |
| 5000 | CSS transform animation | group-z50 | 29.3 | 41.7 | 0.000 | 0.046 | 0.306 |
| 5000 | CSS transform animation | leaf-z250 | 20.0 | 50.6 | 0.000 | 1.896 | 4.130 |
| 5000 | CSS transform animation | group-z250 | 8.0 | 133.2 | 0.000 | 0.678 | 2.233 |

This is not a green light for depth wrappers as the default renderer. It
explains why the earlier real-renderer wrapper attempts lost: many real `.vox`
models have too many visible depth planes. Strong current winners sit at
47-191 visible planes (`scene_sidewalk` 47, `ff1` 54, `pyramid` 68,
`desert2` 102, `Treasure` 132, `AncientCrashSite` 191). The synthetic result
only looks clean at very low wrapper count. Around 50 wrappers, trace events
look cheap but cadence can get worse; by 250 wrappers the wrapper hierarchy is
catastrophic. The actionable hypothesis is therefore a strict low-plane gate,
not a replacement for leaf `translateZ(...)`.

A bench-only real-model variant, `polycss-voxlocal-depth-groups`, then tested
that gate against actual voxel plans:

| Model | Visible planes | Current voxlocal p95 | Depth groups p95 | Read |
| --- | ---: | ---: | ---: | --- |
| `armchair.vox` | 22 | 109.9-112.4 | 108.7-109.9 | Capped/flat; extra nodes do not buy anything. |
| `obj_trashcan4.vox` | 16 | 109.9-111.1 | 111.0-112.3 | Capped/flat within noise. |
| `mailbox.vox` | 28 | 109.9 | 112.4-113.6 | Capped/flat within noise. |
| `scene_sidewalk.vox` | 47 | 113.6-116.3 | 111.1-112.4 | Near the unstable zone; slight regression. |
| `ff1.vox` | 54 | 114.9 | 29.9 | Confirms the 50-wrapper synthetic warning. |

So the low-plane gate has no current product payoff. Available low-plane real
models are already near the browser cadence ceiling, and the first meaningful
near-threshold model regresses hard. Reopen only if we find a high-leaf,
sub-30-visible-plane real scene.

An early synthetic distribution probe used 1200 `matrix3d` leaves and JS root
rotation, varying only projected distribution:

| Distribution | FPS p95 | PAC ms/frame | DrawProps ms/frame | Draw ms/frame |
| --- | ---: | ---: | ---: | ---: |
| Clustered | 112.4 | 0.609 | 0.629 | 0.785 |
| Spread | 116.3 | 0.592 | 0.757 | 0.942 |
| Overlap-heavy | 111.1 | 0.594 | 0.758 | 0.919 |

This does not prove a layerization-sparsity win yet: PAC/layerize were almost
the same, and a shorter rerun was noisier. Treat this as a conditional
secondary hypothesis: projected distribution may move draw-properties and draw
at equal leaf count, but it needs controlled repeats before it can guide
renderer work.

Actionable consequences:

- Test a product-shaped declarative camera animation path separately from
  interactive drag. If it wins cleanly, auto-rotate demos can use CSS/WAAPI
  compositor animations while pointer-driven controls stay imperative.
- Do not expect `will-change` alone to solve JS camera rotation. It can force
  compositing, but the direct-update source gate still wants active transform
  animation.
- Do not chase more nested coordinate wrappers as a PAC fix. More transform
  nodes increase property-tree and draw-property work, which is exactly the
  remaining source path.
- The next non-voxel optimization target is still active transformed leaf
  count, render-surface count, and transform-node count. For voxel scenes the
  accepted fast path attacks active leaves; for non-voxel scenes the equivalent
  lever is mesh reduction / merging / LOD, not transform-chain cleverness.

## Next Actionable Hypotheses

| ID | Hypothesis | Why it is plausible | Test | Accept if | Reject if |
| --- | --- | --- | --- | --- | --- |
| C1 | A dedicated declarative auto-rotate path can skip PAC for demos. | Chromium gates direct transform updates on active transform animation; CSS keyframes and running WAAPI both showed zero PAC. | Add a bench-only `motion=css-rot` or `motion=waapi-rot` page mode, run clean FPS and traces on `AncientCrashSite`, `Garden`, `Treasure`, `apoc-car`, and `ducky`, then screenshot-check at fixed angles. | PAC stays zero and clean p95/p99 improve without visual drift. | Clean cadence does not improve, or screenshots/interaction semantics become messy. |
| C2 | JS-scrubbed compositor animations are not a viable interactive camera fix. | Paused WAAPI `currentTime` and JS `scrollLeft` scroll-timeline probes both hit PAC once per frame. | Repeat once in headed Chrome/Canary to rule out a headless artifact, then close. | A current browser shows zero PAC while scrubbed from JS. | PAC count tracks frame count again. |
| C3 | The remaining slope is proportional to dirty 3D transform nodes, not just DOM leaves. | `TransformTree::UpdateAllTransforms` iterates transform nodes when dirty; `PendingLayer::DecompositeTransforms` only removes identity/2D-translation transforms. The synthetic topology probe shows `translateZ(0)`, real `translateZ`, and `matrix3d` are far more expensive than `left/top` or 2D translate. | Keep `bench/compositor-topology-probe.mjs` in the loop and repeat in headed/current browsers; use it as the benchmark for any future DOM topology idea. | Already accepted as a browser cost model. | Reopen only if another browser version makes 3D leaves decompose cheaply. |
| C4 | Projected distribution/overlap may be a secondary cost model after leaf count and 3D transform-node count. | One longer synthetic distribution run moved DrawProps/Draw by about 20% at equal `matrix3d` leaf count, though PAC/layerize stayed similar; a shorter rerun was noisier. | Extend the synthetic probe with controlled screen coverage and optional intrusive layer counts; then compare real models with similar leaves but different bounds. | Distribution explains stable model-to-model variance that leaf count misses. | Repeated controlled runs collapse to noise. |
| C5 | Splitting one preserve-3d scene into multiple independently animated islands is only useful if it reduces active leaves per dirty transform tree enough to offset extra roots. | Source says more transform nodes are costly, but smaller dirty subtrees may reduce draw-property work if only one island moves. | Synthetic scene with N leaves split into 1/2/4 mesh roots; animate one root vs all roots; compare draw-property slope and visual correctness. | Animating one island is cheaper in proportion to its leaves and all-roots is not much worse than one root. | Extra roots/render surfaces dominate. |
| C6 | Depth-plane wrappers may be viable only for tiny visible-plane-count voxel scenes. | Synthetic depth grouping is excellent at 17 wrappers and 5000 leaves, but 50 wrappers already loses cadence and 250 wrappers collapses. | Done in `polycss-voxlocal-depth-groups` on available low-plane real models plus nearby counterexamples. | Reopen only if a high-leaf, sub-30-visible-plane real scene appears. | Current corpus has no useful payoff: sub-30-plane scenes are capped/flat, and `ff1` at 54 planes regresses to ~30 FPS p95. |
| C7 | The adaptive matrix-vs-slice gate needs a second structural predicate for low-color matrix wins. | `visibleShadedColors >= 52 && visiblePlanes < 200` catches `Treasure`/high-shaded wins and avoids `AncientCrashSite`/`scene_house3`, but misses `desert2`, which is still a large matrix win. | Search source-plan metrics for a predicate that captures `desert2` without hitting validated strong slice winners; then rerun `polycss-adaptive-shaded` or a new adaptive case. | Captures `desert2` and keeps p95/p99 neutral on `ff1`, `pyramid`, `christmas_tree`, `AncientCrashSite`, and `scene_park`. | Any predicate that catches `desert2` also routes strong slice winners to matrix. |
| C8 | Hostless direct canonical matrix brushes are the portable part of the matrix win. | `polycss-polybox` proved parsed polygons in axis hosts still fall to slice cadence; `polycss-voxlocal-direct-matrix` proved hostless canonical matrices transfer the win on `desert2`. | Turn the bench prototype into a cleaner renderer experiment with visual diff gates. Test unsplit source brushes, exact parsed brushes, and a cheap predicate for source plans that stay browser-friendly. | Direct matrix source brushes pass visual checks and improve validated p95/p99 on a class broader than `desert2` without hurting slice-favored models. | The source-plan predicate collapses, or visual-correct direct matrices only reproduce the existing polygon fallback. |
| C9 | Exact direct matrix leaves can be the single voxel leaf shape, but DOM order needs a compositor-aware policy. | Depth order keeps the `desert2`/`Treasure`/`house`/`scene_mechanic2`/`army` wins, but `obj_house3` needs face/top-first order and `AncientCrashSite` rejects normal/depth-band variants. Static face permutations, face-normal order, face-depth, face-block, and depth-band hybrids all have hard counterexamples. | Stop adding face-order permutations. Build a metric for projected overlap and depth-order inversions at cull-boundary angles, then validate it on the hard split set. | One leaf shape plus a geometry-derived order policy is neutral-or-better than slices on validated p95/p99 and passes screenshots. | Any policy still leaves strong slice-favored regressions, requires benchmark feedback, or fails visual checks. |
| C10 | The order win is a cadence threshold, not lower measured main-thread work per frame. | Same-node-count traces on `scene_mechanic2` and `obj_house3` show PAC, DrawProps, Draw, paint, raster, and script are nearly identical per inferred frame between fast and slow orders; the difference is 1x-vsync share. Chromium docs also put preserve-3d quad sorting/intersection in the compositor frame path. | Add overlap/inversion metrics and, if needed, an intrusive layer/quad diagnostic only after clean FPS runs. | The metric predicts 1x-vsync vs 2x/3x-vsync cadence without relying on model names. | Per-frame trace groups start diverging materially under cleaner instrumentation. |

## Trace Rules

- Do not optimize against `RunTask` by itself. It is a wrapper around nested
  work and mostly tells us the frame was expensive.
- Do not sum top trace events as if they were exclusive. Many are nested.
- Compare per-frame event medians, not only total trace milliseconds.
- Keep `LayerTree.enable` out of primary FPS runs. It perturbs the path.
- Keep trace and raw-sample diagnostics separate from clean cadence sweeps.
  Mid-sized models can jump back to a perfect 120Hz cadence under diagnostic
  capture, even when five clean repeats show a stable split.
- Always record browser executable, headless/headed mode, DPR, warmup, sample
  window, viewport, model, leaves, and trace categories.

## Tooling

Use the trace summarizer for any result JSON containing trace summaries:

```sh
node bench/trace-summary.mjs bench/results/<file>.json
```

Use the synthetic compositor probe for browser-shape hypotheses:

```sh
node bench/compositor-topology-probe.mjs
node bench/compositor-topology-probe.mjs --mode=topology --leaves=5000
node bench/compositor-topology-probe.mjs --mode=distribution --headed
node bench/compositor-topology-probe.mjs --mode=depth-groups --root=js --leaves=5000
```

Useful current voxel command pattern:

```sh
TRACE=1 REPEATS=1 WARMUP_MS=1000 SAMPLE_MS=2500 PRINT_JSON=0 \
  CASES=polycss-baked-voxzoom MODEL_FILE=Garden.vox POLY_ZOOM=voxcss \
  node bench/results/ancient-rotation-compare.mjs
```

Then summarize:

```sh
node bench/trace-summary.mjs bench/results/garden-vox-rotation-compare.json
```

## Trace-Backed Hypotheses

| ID | Status | Hypothesis | What would prove it |
| --- | --- | --- | --- |
| T1 | Accepted | The real camera-motion cost is 3D property-tree/compositor maintenance, not paint. | Current traces show PAC/layerize/draw-props dominate while paint/raster stay near zero. |
| T2 | Accepted | Chrome rebuilds compositor state when the root transform changes over the preserve-3d subtree. | Static and repeated-same-value traces drop PAC/layerize/draw-props to zero; changing rotation restores them. |
| T3 | Watch | Bounds complexity may modulate the per-leaf slope. | Models with similar leaf counts but different projected bounds should separate in `DrawProperties`/`PrepareToDraw` per frame. |
| T4 | Accepted | A cheap first-order predictor is active transformed leaves times a browser slope. | Voxel and non-voxel camera traces cluster around ~0.6-0.75 us/leaf for PAC and draw-props, with draw slightly higher. |
| T5 | Test next | The next valid ceiling prototype must lower PAC/draw-props while preserving the exact 3D visual contract. | A prototype beats current polycss on `PAC ms/frame` and screenshots, not just p95 FPS. |
| T6 | Test next | Dynamic-light perf is a separate cascade/raster problem, not the camera compositor problem. | Dynamic light traces should be tracked with style/raster columns and not mixed with camera-motion conclusions. |
| T7 | Flat | Moving voxel `translateZ` to depth-plane wrappers reduces per-leaf transform cost only at very low wrapper count. | Synthetic probes show a clean 17-wrapper ceiling case, but real sub-30-plane models are already capped and `ff1` at 54 planes regresses hard. No current production path. |
| T8 | Rejected | Canonical 1x1 voxel brushes with `translate3d(... ) scale(...)` reduce layout/GPU bounds enough to improve FPS. | Screenshot smoke was clean, and local layout area collapsed, but FPS was flat across `MechaGolem`, `Treasure`, `stairs`, `desert2`, `army`, `Garden`, `AncientCrashSite`, `HUT`, and `scene_vehicles1`. |
| T9 | Rejected | `backface-visibility:hidden` is the missing voxel fast path. | Plain hidden backfaces improves several models but fails visual checks badly. Face-flipped hidden backfaces passes screenshot smoke, but FPS is flat. |
| T10 | Watch | Some voxel models should use the matrix renderer instead of slice brushes. | Current 86-model corpus: matrix wins `desert2`, `scene_hazmat`, `scene_house`, `scene_mechanic2`, `scene_sidewalk`, `Treasure`; slice wins `AncientCrashSite`, `armchair`, `christmas_tree`, `ff1`, `mailbox`, `obj_house3`, `obj_house8`, `obj_trashcan4`, `pyramid`, `scene_park`; 66 models are flat/capped. `visibleShadedColors >= 52 && visiblePlanes < 200` is the only safe-looking partial matrix gate; it misses stable `desert2` and browser-sensitive `scene_sidewalk`. |
| T11 | Rejected | Leaf `transform-style: flat` reduces property-tree work. | It catastrophically regressed matrix and slice paths across all tested voxel models. Leaves have no transformed children, but Chrome still needs them in the preserve-3d path for this renderer. |
| T12 | Rejected | Keep voxel hosts but encode brush rectangles as 1px `matrix3d(...)` leaves. | Local layout area collapsed from tens of millions of px to thousands, but FPS stayed flat or regressed. It did not inherit the plain matrix fallback's cadence on `Treasure`. |
| T13 | Conditional | Remove voxel hosts and emit direct canonical matrix leaves from the voxel renderer. | The corrected normal-column prototype transfers the `desert2` matrix win and lowers PAC/draw-props, but still regresses `AncientCrashSite`, `pyramid`, and `scene_park`; splitting large source rectangles makes it worse. This is a candidate renderer shape only behind a strong source-plan predicate or with exact polygon granularity. |

## Next Work

1. Treat camera rotation as a per-active-leaf compositor budget. Renderer
   changes are interesting only if they reduce active transformed leaf count or
   the per-leaf PAC/draw-props slope while preserving visuals.
2. Treat adaptive matrix-vs-slice as a cadence-classifier problem. Prototype
   the `visibleShadedColors >= 52 && visiblePlanes < 200` gate as a
   benchmark-only adaptive case before changing defaults; it should prove
   net-neutral-or-better on p95 and p99, not just p95, and keep validation
   repeats as the source of truth.
3. Capture raw trace events for a short run when needed. The current summary is
   enough for direction, but raw events are needed to inspect property-tree and
   compositor internals more deeply.
4. Keep dynamic-light traces separate. That path is style/raster-heavy and
   should not drive camera-renderer decisions.
5. Do not pursue depth wrappers, split direct matrices, or voxel
   backface-hidden variants without a new trace signal. Hostless direct
   canonical matrices remain open because they transferred the `desert2` win,
   but only as a visual-gated renderer experiment.
6. The two useful optimization paths left are:
   - adaptive matrix-vs-slice selection for `.vox` models, once cadence can be
     predicted safely;
   - actual active-leaf reduction through better exact voxel planning or
     better non-voxel mesh merging.
