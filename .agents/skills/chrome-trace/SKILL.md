---
name: chrome-trace
description: Capture and analyze Chrome/Chromium performance traces with Playwright around a concrete browser interaction. Use when Codex needs to answer where frame time is spent during an update, drag, rotation, scroll, animation, camera movement, light movement, DOM/CSS render change, or other performance-sensitive UI action; especially when the right answer requires per-frame Chrome trace evidence instead of FPS-only guesses.
---

# Chrome Trace

## Core Workflow

Use Playwright with Chromium and the Chrome DevTools Protocol `Tracing` domain to capture the exact interaction under investigation.

1. Start from a reproducible page and action.
2. Warm up the page until app-specific readiness is true.
3. Start Chrome tracing and a `requestAnimationFrame` sampler immediately before the action.
4. Mark the action window with `performance.mark()` and `console.timeStamp()`.
5. Perform the action with real Playwright input when the user is asking about input-driven behavior.
6. Stop tracing after a short settle window.
7. Align trace event timestamps to `performance.now()` using the start/end marks.
8. Report where time went: `Scripting`, `Style`, `Layout`, `PrePaint`, `Paint`, compositor main-thread work, compositor impl-thread work, raster, GPU/viz events, and the slowest frame windows.

Do not draw conclusions from FPS alone. Use FPS/frame-time summaries only as the symptom; use trace groups and top events as the explanation.

## PolyCSS Trace Runners

Use `scripts/trace.mjs` as the front door:

```bash
pnpm bench:build
node .agents/skills/chrome-trace/scripts/trace.mjs motion --page nonvoxel --mesh glb:Elephant.glb --variant baseline --dom-samples --label elephant-baseline
node .agents/skills/chrome-trace/scripts/trace.mjs motion --page nonvoxel --mesh teapot --variant baseline --dom-samples --frame-details --layer-details --gpu-details --trace-out bench/results/teapot.trace.json --label teapot-enriched --report
node .agents/skills/chrome-trace/scripts/trace.mjs motion --page nonvoxel --mesh teapot --variant baseline --gpu-details full --trace-out bench/results/teapot-full-gpu.trace.json --label teapot-full-gpu
node .agents/skills/chrome-trace/scripts/trace.mjs drag --mesh teapot --mode baked --frame-details --label teapot-drag
node .agents/skills/chrome-trace/scripts/trace.mjs motion --mesh garden --report --markdown-out bench/results/garden-trace.md
node .agents/skills/chrome-trace/scripts/trace.mjs compare bench/results/before.json bench/results/after.json --markdown-out bench/results/trace-compare.md
```

Use `trace.mjs motion` for steady bench motion across `perf` and `nonvoxel` pages, cadence buckets, DOM samples, render stats, and tag counts.

Add `--frame-details` to motion traces when you need slowest/fastest frame attribution instead of only bucket averages. On `nonvoxel` pages this also enables page-work samples for `camera.update`, `scene.applyCamera`, and input/control callbacks when available. Add `--layer-details` when compositor/layer shape is part of the question; it records LayerTree counts, layer aggregates by DOM tag/class (`leaf:b`, `leaf:u`, `polycss-camera`, etc.), largest layers, and compositing reasons. Add `--trace-out` when the raw Chrome trace should be preserved for DevTools.

Add `--gpu-details` when render pass timing is the current question and the trace still needs to stay reasonably sized. Light mode keeps the normal GPU/viz timeline categories and adds only `disabled-by-default-viz.gpu_composite_time`; render-pass attribution still comes from base events such as `DirectRenderer::DrawFrame` and `DirectRenderer::DrawRenderPass`. It intentionally avoids per-quad, Skia command, and GPU service spam.

Use `--deep-gpu` or `--gpu-details full` only for rare forensic runs that truly need per-quad/Skia/overdraw detail. Full mode also enables `disabled-by-default-viz.quads`, `disabled-by-default-viz.triangles`, `disabled-by-default-viz.overdraw`, `disabled-by-default-gpu.debug`, and `disabled-by-default-skia.gpu`; raw traces can become hundreds of MB and timing can be heavily perturbed.

Use `trace.mjs drag` for real `PolyOrbitControls` pointer-drag traces on `nonvoxel-vanilla.html`. This runner knows the non-voxel readiness hooks, camera state, interaction stats, and per-frame page-work samples.

Use `trace.mjs generic` for arbitrary pages and interactions that are not covered by a polycss bench page.

When interpreting PolyCSS traces, map the result back to the render model:

- `FunctionCall`, `EventDispatch`, `FireAnimationFrame`: JS/input work. Unexpected sustained per-frame work is suspicious outside imported skeletal animation.
- `UpdateLayoutTree`, `RecalculateStyles`: style recalculation, often CSS variable or selector invalidation cost.
- `Layout`: layout; should stay low for transform/CSS-var-driven motion.
- `PrePaint`, `Paint`, `PaintArtifactCompositor::Update`, `Layerize`: paint/compositing setup.
- `LayerTreeImpl::UpdateDrawProperties`, `draw_property_utils::ComputeDrawPropertiesOfVisibleLayers`, `LayerTreeHostImpl::PrepareToDraw`, `MainFrame.Draw`, `SubmitCompositorFrame`: compositor-side cost.
- `Graphics.Pipeline`, `DisplayScheduler::DrawAndSwap`, `DirectRenderer::DrawFrame`, `DirectRenderer::DrawRenderPass`: GPU/viz drawing pipeline. Treat these as browser output work, and compare them against layer details before changing app JS.
- `gpuVizRenderPass`, `gpuVizTiles`, `gpuVizGpuService`: opt-in `--gpu-details` attribution buckets for render pass, coarse tile/raster playback, and GPU service events.
- `gpuVizQuads` and `gpuVizSkia`: usually require `--gpu-details full` / `--deep-gpu`; treat them as high-overhead forensic signals.
- `RasterTask`, image decode events: raster/bitmap work, usually atlas or tile work.

Trace event durations are inclusive and often nested, especially GPU/viz and scheduler events. Use group `ms/frame` as attribution evidence and for before/after deltas, not as exclusive slices that must add up to frame time.

## Generic Capture

For arbitrary pages, use `trace.mjs generic`:

```bash
node .agents/skills/chrome-trace/scripts/trace.mjs generic \
  --url http://127.0.0.1:3000 \
  --ready-js "window.appReady === true" \
  --action drag \
  --selector "#viewport" \
  --drag "480,0" \
  --duration 1200 \
  --steps 90 \
  --summary-out trace-summary.json \
  --trace-out trace.json
```

Useful alternatives:

```bash
node .agents/skills/chrome-trace/scripts/trace.mjs generic --url http://127.0.0.1:3000 --action wait --sample 3000
node .agents/skills/chrome-trace/scripts/trace.mjs generic --url http://127.0.0.1:3000 --action eval --eval "window.rotateScene?.(Math.PI / 2)"
node .agents/skills/chrome-trace/scripts/trace.mjs generic --url http://127.0.0.1:3000 --action scroll --scroll "0,900"
```

## Comparing Runs

Use `--report` on a runner to generate a Markdown report after capture, or use `trace.mjs report` on an existing summary JSON:

```bash
node .agents/skills/chrome-trace/scripts/trace.mjs report bench/results/garden.json --markdown-out bench/results/garden.md
```

Use `trace.mjs compare` on summary JSON files from any runner:

```bash
node .agents/skills/chrome-trace/scripts/trace.mjs compare before.json after.json --markdown-out trace-compare.md
```

Read positive deltas in `frame_time_*_ms` and trace group `ms/frame` as more expensive after the change. Read positive FPS deltas as better.
Reports include a `Quick Read` section that calls out p95 frame time and the dominant trace group.

## Reporting

Keep the report evidence-led and compact:

- State the exact command, page, viewport, action, warmup, and sample/settle windows.
- Include frame-time p50/p95/p99 and slowest-frame count.
- Identify the dominant trace groups in the action window.
- Name the top Chrome events, not only broad categories.
- For polycss, explicitly say whether the trace supports or violates the "no JS in the render loop" expectation.
- Mention artifacts written, especially the raw trace JSON that can be opened in Chrome DevTools Performance.

If trace markers are missing, say that alignment is weaker and rerun with marks before making a firm claim.
