#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const args = process.argv.slice(2);
const files = args.filter((arg) => !arg.startsWith("--"));
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const LIMIT = Number(limitArg?.slice("--limit=".length) ?? 10);
const jsonMode = args.includes("--json");

if (files.length === 0) {
  console.error("usage: node bench/trace-summary.mjs <result.json...> [--limit=10] [--json]");
  process.exit(1);
}

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function median(values) {
  return quantile(values, 0.5);
}

function eventMap(trace) {
  const out = new Map();
  for (const [name, entry] of Object.entries(trace?.eventTotals ?? {})) {
    out.set(name, {
      count: Number(entry?.count) || 0,
      duration_ms: Number(entry?.duration_ms) || 0,
    });
  }
  for (const event of trace?.topEvents ?? []) {
    if (out.has(event.name)) continue;
    out.set(event.name, {
      count: Number(event.count) || 0,
      duration_ms: Number(event.duration_ms) || 0,
    });
  }
  return out;
}

function eventDurationMs(events, name) {
  return events.get(name)?.duration_ms ?? 0;
}

function eventCount(events, name) {
  return events.get(name)?.count ?? 0;
}

function groupDurationMs(trace, name) {
  return trace?.groups?.[name]?.duration_ms ?? 0;
}

function groupCount(trace, name) {
  return trace?.groups?.[name]?.count ?? 0;
}

function inferFrameCount(row) {
  const events = eventMap(row.trace);
  const candidates = [
    eventCount(events, "ProxyMain::BeginMainFrame"),
    eventCount(events, "WebFrameWidgetImpl::UpdateLifecycle"),
    eventCount(events, "Layerize"),
    groupCount(row.trace, "prePaint"),
    groupCount(row.trace, "style"),
    row.sample_count,
  ].filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.max(1, Math.round(median(candidates))) : 1;
}

function leafCount(run) {
  if (Number.isFinite(run?.dom?.leaves)) return run.dom.leaves;
  if (Number.isFinite(run?.dom?.brushes)) return run.dom.brushes;
  if (Number.isFinite(run?.dom?.voxelBrushes)) return run.dom.voxelBrushes;
  const tags = run?.dom?.tags ?? run?.renderStats?.dom?.tags;
  if (tags) return ["b", "i", "s", "u"].reduce((sum, tag) => sum + (Number(tags[tag]) || 0), 0);
  if (Number.isFinite(run?.renderStats?.dom?.leafCount)) return run.renderStats.dom.leafCount;
  return null;
}

function nodeCount(run) {
  return run?.performanceMetrics?.Nodes ?? null;
}

function pushBenchLeaf(rows, file, path, value) {
  if (!value?.trace) return;
  rows.push({
    id: `${basename(file)}:${path.join(".")}`,
    source: file,
    path: path.join("."),
    fps_p50: value.fps_p50,
    fps_p95: value.fps_p95,
    frame_time_p99_ms: value.frame_time_p99_ms,
    sample_count: value.sample_count,
    nodes: nodeCount(value),
    leaves: leafCount(value),
    trace: value.trace,
    cadence: value.cadence,
  });
}

function walkBenchObject(rows, file, path, value) {
  if (!value || typeof value !== "object") return;
  if (value.trace) {
    pushBenchLeaf(rows, file, path, value);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (["trace", "renderStats", "performanceMetrics"].includes(key)) continue;
    walkBenchObject(rows, file, [...path, key], child);
  }
}

function extractRows(file, data) {
  const rows = [];
  if (data?.cases && typeof data.cases === "object") {
    for (const [caseId, entry] of Object.entries(data.cases)) {
      for (const run of entry?.runs ?? []) {
        if (!run?.trace) continue;
        rows.push({
          id: `${basename(file)}:${caseId}`,
          source: file,
          path: caseId,
          repeat: run.repeat,
          fps_p50: run.fps_p50,
          fps_p95: run.fps_p95,
          frame_time_p99_ms: run.frame_time_p99_ms,
          sample_count: run.sample_count,
          nodes: nodeCount(run),
          leaves: leafCount(run),
          trace: run.trace,
          cadence: run.cadence,
        });
      }
    }
    return rows;
  }
  walkBenchObject(rows, file, [], data);
  return rows;
}

function aggregateRows(rows) {
  const byId = new Map();
  for (const row of rows) {
    const bucket = byId.get(row.id) ?? [];
    bucket.push(row);
    byId.set(row.id, bucket);
  }

  return [...byId.entries()].map(([id, runs]) => {
    const frameCounts = runs.map(inferFrameCount);
    const frames = median(frameCounts) ?? 1;
    const valuesForEvent = (name) =>
      runs.map((row) => eventDurationMs(eventMap(row.trace), name) / inferFrameCount(row));
    const valuesForGroup = (name) =>
      runs.map((row) => groupDurationMs(row.trace, name) / inferFrameCount(row));
    const topEvents = new Map();
    for (const row of runs) {
      const framesForRun = inferFrameCount(row);
      for (const event of row.trace?.topEvents ?? []) {
        const list = topEvents.get(event.name) ?? [];
        list.push((Number(event.duration_ms) || 0) / framesForRun);
        topEvents.set(event.name, list);
      }
    }
    const top = [...topEvents.entries()]
      .map(([name, values]) => ({ name, ms_per_frame: median(values) ?? 0 }))
      .sort((a, b) => b.ms_per_frame - a.ms_per_frame)
      .slice(0, LIMIT);

    return {
      id,
      runs: runs.length,
      fps_p50: median(runs.map((run) => run.fps_p50)),
      fps_p95: median(runs.map((run) => run.fps_p95)),
      p99_ms: median(runs.map((run) => run.frame_time_p99_ms)),
      frames,
      nodes: median(runs.map((run) => run.nodes)),
      leaves: median(runs.map((run) => run.leaves)),
      ms_per_frame: {
        style: median(valuesForGroup("style")),
        layout: median(valuesForGroup("layout")),
        prePaint: median(valuesForGroup("prePaint")),
        paint: median(valuesForGroup("paint")),
        raster: median(valuesForGroup("raster")),
        script: median(valuesForGroup("script")),
        beginMainFrame: median(valuesForEvent("ProxyMain::BeginMainFrame")),
        updateLifecycle: median(valuesForEvent("WebFrameWidgetImpl::UpdateLifecycle")),
        paintArtifactCompositor: median(valuesForEvent("PaintArtifactCompositor::Update")),
        layerize: median(valuesForEvent("Layerize")),
        readyToCommit: median(valuesForEvent("ProxyImpl::ReadyToCommit")),
        drawProperties: median(valuesForEvent("LayerTreeImpl::UpdateDrawProperties")),
        calculateDrawProperties: median(valuesForEvent("LayerTreeImpl::UpdateDrawProperties::CalculateDrawProperties")),
        prepareToDraw: median(valuesForEvent("LayerTreeHostImpl::PrepareToDraw")),
        mainFrameDraw: median(valuesForEvent("MainFrame.Draw")),
        commit: median(valuesForEvent("Commit")),
      },
      cadence_pct: {
        x1: median(runs.map((run) => run.cadence?.vsync_pct?.x1)),
        x2: median(runs.map((run) => run.cadence?.vsync_pct?.x2)),
        x3: median(runs.map((run) => run.cadence?.vsync_pct?.x3)),
        x4_plus: median(runs.map((run) => run.cadence
          ? (run.cadence?.vsync_pct?.x4 ?? 0) +
            (run.cadence?.vsync_pct?.x5 ?? 0) +
            (run.cadence?.vsync_pct?.x6_plus ?? 0)
          : undefined,
        )),
      },
      topEvents: top,
    };
  });
}

function fmt(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "";
}

function usPerLeaf(row, key) {
  const leaves = Number(row.leaves);
  const ms = Number(row.ms_per_frame[key]);
  if (!Number.isFinite(leaves) || leaves <= 0 || !Number.isFinite(ms)) return null;
  return (ms * 1000) / leaves;
}

const allRows = [];
for (const file of files) {
  const data = JSON.parse(await readFile(file, "utf8"));
  allRows.push(...extractRows(file, data));
}

const summary = aggregateRows(allRows).sort((a, b) => a.id.localeCompare(b.id));

if (jsonMode) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log("| Case | Runs | FPS p95 | P99 ms | 1x vsync | 2x vsync | 3x vsync | 4x+ vsync | Frames | Nodes | Leaves | PAC ms/f | PAC us/leaf | DrawProps ms/f | DrawProps us/leaf | Draw ms/f | Draw us/leaf | Paint ms/f | Raster ms/f | Script ms/f |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of summary) {
    console.log([
      `| ${row.id}`,
      row.runs,
      fmt(row.fps_p95, 1),
      fmt(row.p99_ms, 2),
      fmt(row.cadence_pct.x1, 1),
      fmt(row.cadence_pct.x2, 1),
      fmt(row.cadence_pct.x3, 1),
      fmt(row.cadence_pct.x4_plus, 1),
      fmt(row.frames, 0),
      fmt(row.nodes, 0),
      fmt(row.leaves, 0),
      fmt(row.ms_per_frame.paintArtifactCompositor),
      fmt(usPerLeaf(row, "paintArtifactCompositor"), 3),
      fmt(row.ms_per_frame.drawProperties),
      fmt(usPerLeaf(row, "drawProperties"), 3),
      fmt(row.ms_per_frame.mainFrameDraw),
      fmt(usPerLeaf(row, "mainFrameDraw"), 3),
      fmt(row.ms_per_frame.paint),
      fmt(row.ms_per_frame.raster),
      `${fmt(row.ms_per_frame.script)} |`,
    ].join(" | "));
  }

  console.log("\nTop event medians are per inferred frame. Trace events are nested, so columns are diagnostic, not additive.");
  for (const row of summary) {
    console.log(`\n${row.id}`);
    for (const event of row.topEvents) {
      console.log(`- ${event.name}: ${fmt(event.ms_per_frame)} ms/f`);
    }
  }
}
