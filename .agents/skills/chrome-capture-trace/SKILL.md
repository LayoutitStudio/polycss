---
name: chrome-capture-trace
description: Capture and analyze Chrome/Chromium performance traces with Playwright around a concrete browser interaction. Use when Codex needs to answer where frame time is spent during an update, drag, rotation, scroll, animation, camera movement, light movement, DOM/CSS render change, or other performance-sensitive UI action; especially when the right answer requires per-frame Chrome trace evidence instead of FPS-only guesses.
---

# Chrome Capture Trace

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

## Polycss Trace Runners

Use `scripts/trace.mjs` as the front door:

```bash
pnpm bench:build
node .agents/skills/chrome-capture-trace/scripts/trace.mjs motion --page nonvoxel --mesh glb:Elephant.glb --variant baseline --dom-samples --label elephant-baseline
node .agents/skills/chrome-capture-trace/scripts/trace.mjs drag --mesh teapot --mode baked --frame-details --label teapot-drag
node .agents/skills/chrome-capture-trace/scripts/trace.mjs motion --mesh garden --report --markdown-out bench/results/garden-trace.md
node .agents/skills/chrome-capture-trace/scripts/trace.mjs compare bench/results/before.json bench/results/after.json --markdown-out bench/results/trace-compare.md
```

Use `trace.mjs motion` for steady bench motion across `perf` and `nonvoxel` pages, cadence buckets, DOM samples, render stats, and tag counts.

Use `trace.mjs drag` for real `PolyOrbitControls` pointer-drag traces on `nonvoxel-vanilla.html`. This runner knows the non-voxel readiness hooks, camera state, interaction stats, and per-frame page-work samples.

Use `trace.mjs generic` for arbitrary pages and interactions that are not covered by a polycss bench page.

When interpreting polycss traces, map the result back to the render model:

- `FunctionCall`, `EventDispatch`, `FireAnimationFrame`: JS/input work. Unexpected sustained per-frame work is suspicious outside imported skeletal animation.
- `UpdateLayoutTree`, `RecalculateStyles`: style recalculation, often CSS variable or selector invalidation cost.
- `Layout`: layout; should stay low for transform/CSS-var-driven motion.
- `PrePaint`, `Paint`, `PaintArtifactCompositor::Update`, `Layerize`: paint/compositing setup.
- `LayerTreeImpl::UpdateDrawProperties`, `draw_property_utils::ComputeDrawPropertiesOfVisibleLayers`, `LayerTreeHostImpl::PrepareToDraw`, `MainFrame.Draw`, `SubmitCompositorFrame`: compositor-side cost.
- `RasterTask`, image decode events: raster/bitmap work, usually atlas or tile work.

## Generic Capture

For arbitrary pages, use `trace.mjs generic`:

```bash
node .agents/skills/chrome-capture-trace/scripts/trace.mjs generic \
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
node .agents/skills/chrome-capture-trace/scripts/trace.mjs generic --url http://127.0.0.1:3000 --action wait --sample 3000
node .agents/skills/chrome-capture-trace/scripts/trace.mjs generic --url http://127.0.0.1:3000 --action eval --eval "window.rotateScene?.(Math.PI / 2)"
node .agents/skills/chrome-capture-trace/scripts/trace.mjs generic --url http://127.0.0.1:3000 --action scroll --scroll "0,900"
```

## Comparing Runs

Use `--report` on a runner to generate a Markdown report after capture, or use `trace.mjs report` on an existing summary JSON:

```bash
node .agents/skills/chrome-capture-trace/scripts/trace.mjs report bench/results/garden.json --markdown-out bench/results/garden.md
```

Use `trace.mjs compare` on summary JSON files from any runner:

```bash
node .agents/skills/chrome-capture-trace/scripts/trace.mjs compare before.json after.json --markdown-out trace-compare.md
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
