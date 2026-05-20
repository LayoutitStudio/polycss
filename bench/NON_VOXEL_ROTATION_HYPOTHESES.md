# Non-Voxel Rotation Hypotheses

Actionable ledger for non-voxel rotation performance work. This tracks
bench-only experiments first; product renderer changes need visual validation
and API/cross-package review before they move out of `bench/`.

## Corpus

The first pass uses eight representative non-voxel models:

| ID | Model | Why it is in the set |
| --- | --- | --- |
| `chicken` | OBJ + MTL | Small flat-color mesh, mostly merged quads. |
| `rock1` | OBJ + MTL | Small UV-textured atlas-heavy mesh. |
| `saucer` | OBJ | Larger untextured rotation stress case. |
| `teapot` | OBJ | Smooth curved solid mesh with many quads. |
| `ducky` | GLB | Small GLB with many solid triangles. |
| `elephant` | GLB | Organic low-poly shape. |
| `policecar` | GLB | Mechanical rectilinear shape. |
| `bicycle` | GLB | Thin separated geometry with many parts. |

Run the corpus with:

```sh
node bench/nonvoxel-rotation-bench.mjs
```

Use targeted variants while iterating:

```sh
node bench/nonvoxel-rotation-bench.mjs \
  --models teapot,bicycle,elephant,policecar \
  --variants baseline,force-atlas,no-stable-tri,order-tile4,no-will-change \
  --warmup 2000 --sample 3000 \
  --run-order round-robin \
  --json bench/results/nonvoxel-rotation-a2-confirm.json
```

Use frame buckets when whole-run p95 is ambiguous:

```sh
node bench/nonvoxel-frame-buckets.mjs \
  --mesh glb:Elephant.glb \
  --variant baseline \
  --warmup 2000 \
  --sample 5000 \
  --no-trace \
  --label nonvoxel-buckets-elephant-baseline
```

Check visual parity before treating transform-topology variants as candidates:

```sh
node bench/nonvoxel-visual-compare.mjs \
  --mode baked \
  --models bicycle,elephant,policecar \
  --variants scene-split-target,scene-host-perspective,scene-transform-perspective,no-will-change,scene-matrix3d \
  --json bench/results/nonvoxel-visual-a12-baked-transform-topology.json
```

## Current Read

- Current active scope is baked rotation. Dynamic-mode probes remain in the
  history below, but they are paused while the baked path is being isolated.
- Do not generalize voxel DOM-order wins directly to non-voxel meshes. The
  corrected post-render DOM-order probes preserve tag counts, and Tile4 still
  regresses or flattens on most non-voxel meshes under interleaved repeats.
- Force-atlas is rejected as a general rotation optimization. A short-window
  Teapot win disappeared with a normal warmup; confirmed runs lose on Teapot,
  Bicycle, Elephant, and Policecar.
- Disabling stable CSS triangles is not a broad win. Short Bicycle movement
  flattened under longer confirmation; Teapot regressed and Elephant/Policecar
  were flat.
- Removing scene `will-change` is mixed/flat, matching the voxel conclusion
  that root transform flags are not the missing browser path.
- Baked transform-topology probes produced large p95 wins only when they
  changed projection. `split-target`, `host-perspective`, and
  `transform-perspective` fail static visual parity on GLBs and are invalid as
  optimization candidates in their current form.
- The visual-safe transform variants (`matrix3d`, `no-will-change`) are not
  broad wins. A full eight-model baked random run rejected them: Saucer
  regressed hard, Teapot/Bicycle/Rock/Ducky/Elephant were flat, and Policecar
  was seed/bucket sensitive.
- Fixed-size baked leaf buckets are visually safe but not broad. They regress
  Saucer, flatten Bicycle/Elephant/Policecar, and produce a repeatable Teapot
  win. Treat that as a targeted clue about dense curved solid meshes, not a
  default renderer change.
- CSS keyframe rotation remains an auto-rotate-only probe. It can change p50 in
  short windows, but p95 does not consistently improve for interactive-style
  rotation comparisons.
- Older `polygonOrder` results changed render planning as well as DOM order,
  because basis-hint selection depends on polygon array order. The runner now
  uses `domOrder` for order variants so strategy tag counts stay stable.
- The next useful work is lower-level attribution for the remaining slow
  baked buckets, not more broad strategy toggles. Whole-run p95 alone is too
  noisy near cadence thresholds.

## Measurement Notes

- Generic gallery meshes now support `glb:path`, `obj:path`, and `vox:path`.
  Numeric URL params use explicit fallback parsing; older direct generic-mesh
  runs before this fix are invalid if they omitted `zoom`, `targetSize`,
  `rotX`, or `rotY`.
- The new non-voxel scripts also use explicit numeric fallback parsing. Missing
  `--warmup` and `--sample` now resolve to the documented defaults instead of
  `0`.
- `nonvoxel-rotation-bench.mjs` supports `--run-order grouped|round-robin|random`
  and `--seed`. Use `round-robin` or `random` for any near-threshold comparison;
  grouped runs are only for quick triage.
- `nonvoxel-frame-buckets.mjs --no-trace` is the least perturbing cadence
  view. Trace mode is still useful for event attribution, but it changed the
  cadence enough in early Elephant runs that no-trace bucket counts should be
  checked first.
- `nonvoxel-visual-compare.mjs` compares static baked screenshots against the
  baseline with the FPS overlay hidden. Treat any performance win that fails
  this parity gate as invalid until the transform math is made equivalent.

## Experiments

| ID | Status | Hypothesis | Result | Next |
| --- | --- | --- | --- | --- |
| NV-A1 | Tested | Voxel-inspired variants may produce immediate non-voxel rotation wins. | Short 8-model pass (`700ms` warmup, `1500ms` sample) found apparent wins, but also obvious counterexamples: Tile4 order hurt Chicken/Rock, force-atlas hurt most models, and Teapot force-atlas was likely an atlas warmup artifact. Results in `bench/results/nonvoxel-rotation-a1-short.json`. | Treat only as a triage pass. Confirm any large signal with normal warmup. |
| NV-A2 | Rejected | Force-atlas, no-stable-triangle, Tile4 order, or no-will-change are broad wins. | Normal-warmup confirmation on Teapot/Bicycle/Elephant/Policecar rejected force-atlas hard (`-37%` to `-40%` on GLBs, `-10%` on Teapot). No-stable-triangle and no-will-change were flat/mixed. Tile4 was flat except a one-run Elephant p95 bump. Results in `bench/results/nonvoxel-rotation-a2-confirm.json`. | Keep strategy toggles as diagnostics, not product candidates. |
| NV-A3 | Flat | Elephant Tile4 order is a real organic-mesh ordering win. | Three repeats at `2000ms` warmup / `5000ms` sample flattened p95 (`23.9 -> 24.0 fps`) but improved median p99 tail (`58.3 -> 50.0ms`). Results in `bench/results/nonvoxel-rotation-a3-elephant-order.json`. | Reopen order only with frame-bucket evidence showing a repeatable tail reduction without p95 loss. |
| NV-A4 | Tested | Frame buckets can explain the Elephant Tile4 p99 tail. | Added `bench/nonvoxel-frame-buckets.mjs`. No-trace baked Elephant baseline had 616 leaves (`b/i/s/u/q=445/0/1/170/0`) with `x4_plus:47`, `dt p95=83.5ms`; Tile4 had the same tag mix with `x4_plus:41`, but `dt p95=100.2ms`. Results in `bench/results/nonvoxel-buckets-elephant-*-a6-notrace-fixed-defaults.json`. | Tile4 is not a clean Elephant win. Use buckets to find slow cadence classes before adding new variants. |
| NV-A5 | Rejected | Dynamic mode changes the winner set for GLB strategy/order probes. | Single-run dynamic GLBs showed large apparent wins, but three repeats rejected them: Bicycle Tile4 was flat and no-stable/no-will-change were `-19%`; Elephant and Policecar were flat within about `1%`. Results in `bench/results/nonvoxel-rotation-dynamic-a2-glb-repeats.json`. | Do not ship dynamic-specific strategy toggles from this signal. |
| NV-A6 | Inconclusive | Teapot dynamic Tile4/no-stable/no-will-change are real wins. | Three repeats showed `+17%` to `+19%` p95, but an order-sanity run produced baseline p95 values from `10.8` to `23.4` fps in the same process while identical-tag `no-will-change` was also positive. Results in `bench/results/nonvoxel-rotation-dynamic-a3-teapot-repeats.json` and `bench/results/nonvoxel-rotation-dynamic-a4-teapot-order-sanity.json`. | Add randomized/interleaved order or frame-bucket attribution before using Teapot dynamic p95 for decisions. |
| NV-A7 | Fixed | Ordering probes should test DOM order, not render-planning order. | Added dedicated `nonvoxel-vanilla.html` with `domOrder` and moved runner order variants to post-render DOM reordering, leaving the shared `perf-vanilla.html` clean. Teapot smoke confirmed Tile4 now keeps baseline tags (`3071/0/40/10/0`). Results in `bench/results/nonvoxel-rotation-smoke-dom-order.json`. | Treat earlier `polygonOrder` results as diagnostic only; use corrected `domOrder` results for decisions. |
| NV-A8 | Rejected | Corrected Teapot dynamic Tile4 is a stable win. | Round-robin corrected Tile4 showed `+11%` p95 with identical tags, but deterministic random ordering flattened Tile4 to `-0.3%`. `no-stable-tri` and `no-will-change` also failed randomized confirmation. Results in `bench/results/nonvoxel-rotation-dynamic-a7-teapot-domorder-round-robin.json` and `bench/results/nonvoxel-rotation-dynamic-a8-teapot-domorder-random.json`. | Do not move Tile4 into product from Teapot dynamic alone. |
| NV-A9 | Mostly rejected | Corrected Tile4 DOM order helps representative GLBs. | Baked/dynamic GLB pass with identical tags rejected Tile4 on Bicycle, flattened Elephant, and only showed a one-pass Policecar baked bump. Results in `bench/results/nonvoxel-rotation-a9-glb-domorder-both.json`. | Check any isolated positive with randomized repeats and buckets. |
| NV-A10 | Rejected | Policecar baked Tile4 is a stable corrected DOM-order win. | A no-trace bucket pair showed fewer very slow frames for Tile4, but randomized five-repeat rotation flattened to `+0.6%` p95 with identical tags. Results in `bench/results/nonvoxel-buckets-policecar-baked-*-a10-domorder.json` and `bench/results/nonvoxel-rotation-a11-policecar-baked-domorder-random.json`. | Leave Tile4 as a diagnostic variant, not a product rule. |
| NV-A11 | Invalid | Baked scene transform topology can improve GLB rotation without changing DOM leaves. | `split-target`, `host-perspective`, and `transform-perspective` gave large p95 wins on Bicycle/Elephant/Policecar with identical tag counts, but static visual parity failed badly (`meanDelta` about `0.04-0.09`, `24-48%` changed pixels). `matrix3d` and `no-will-change` passed visual parity. Results in `bench/results/nonvoxel-rotation-a12-baked-transform-topology.json` and `bench/results/nonvoxel-visual-a12-baked-transform-topology.json`. | Do not use projection-changing topology variants as candidates until equivalence is proven. |
| NV-A12 | Rejected | Visual-safe baked topology variants are broad wins. | Five-repeat random on Teapot/Bicycle/Elephant/Policecar showed `matrix3d` flat except one Policecar run and `no-will-change` positive on Elephant/Policecar, but three-run no-trace buckets showed Policecar was cadence-noisy. A full eight-model random pass then rejected both broadly: Chicken `-2%`, Saucer `-12%` to `-19%`, Teapot/Bicycle/Rock/Ducky/Elephant flat, Policecar `matrix3d +0.9%` and `no-will-change -22.8%`. Results in `bench/results/nonvoxel-rotation-a13-baked-visual-safe-topology-random.json`, `bench/results/nonvoxel-buckets-*-a14-visualsafe.json`, and `bench/results/nonvoxel-rotation-a16-baked-visual-safe-full-corpus-random.json`. | Leave `matrix3d` and `no-will-change` as diagnostics, not defaults. |
| NV-A13 | Tested | Trace can explain the Elephant `no-will-change` no-trace p95 bump. | No-trace buckets showed Elephant baseline at `20.0-20.2 fps` p95 with `x4_plus=61-66`, and `no-will-change` at `24.0 fps` with `x4_plus=54-58`; however trace mode flattened both variants back to about `20 fps` p95 with the same `x4_plus=69`. Results in `bench/results/nonvoxel-buckets-elephant-baked-*-a14-visualsafe.json` and `bench/results/nonvoxel-buckets-elephant-baked-*-a15-trace.json`. | Prefer no-trace cadence for decision-making; use trace only after a signal survives multiple seeds. |
| NV-A14 | Mixed | Fixed-size baked leaf buckets improve compositor subtree shape without changing pixels. | Added `leafBucketSize` and `leaf-buckets-64/128/256`. Static visual parity passed with zero pixel delta on Saucer, Teapot, Bicycle, Elephant, and Policecar. Rotation was mixed: Saucer regressed (`-13%` to `-15%`), Bicycle/Elephant/Policecar were flat, and Teapot improved about `+12%`. Results in `bench/results/nonvoxel-visual-a17-baked-leaf-buckets.json` and `bench/results/nonvoxel-rotation-a18-baked-leaf-buckets-random.json`. | Not a broad default. Confirm Teapot separately before treating it as a mesh-class clue. |
| NV-A15 | Confirmed narrow | Teapot's fixed leaf-bucket win is repeatable. | Teapot-only five-repeat random confirmed `leaf-buckets-64/128/256` at `+10.0%/+11.2%/+11.9%` p95. No-trace buckets show the same 3121 leaves and tags; `leaf-buckets-256` removes the rare `x4_plus` frame and shifts some frames from `x3` to `x2`, but does not help other representative meshes. Results in `bench/results/nonvoxel-rotation-a19-teapot-baked-leaf-buckets-random.json` and `bench/results/nonvoxel-buckets-teapot-baked-*-a20*.json`. | Investigate why dense solid curved quads react to shallow wrapper chunking; keep the variant bench-only. |

## Candidate Next Tests

1. Use `nonvoxel-frame-buckets.mjs --no-trace` on the remaining slow cases
   first, then trace only the buckets that stay reproducible.
2. Look for baked-only non-order hypotheses on the slow classes: per-normal
   grouping shape, stable triangle vs atlas only on triangle-heavy meshes,
   atlas/solid mixed scenes, and whether compositor cadence correlates with
   leaf transform magnitude or projected depth span.
3. For Teapot-like dense solid quad meshes, compare fixed leaf chunks against
   normal/area/depth-preserving chunks to find whether the benefit is wrapper
   count, local spatial coherence, or a Chrome scheduling threshold.
4. Test active CSS keyframes only as an auto-rotate feature path, separate from
   interactive camera rotation, because JS-scrubbed transform changes still
   dirty the 3D subtree in the voxel probes.
