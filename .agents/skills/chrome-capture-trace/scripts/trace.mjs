#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");
const argv = process.argv.slice(2);
const command = argv[0] ?? "help";
const rest = argv.slice(1);

const RUNNERS = new Map([
  ["polycss-motion", "polycss-trace-analysis.mjs"],
  ["motion", "polycss-trace-analysis.mjs"],
  ["polycss-buckets", "polycss-trace-analysis.mjs"],
  ["buckets", "polycss-trace-analysis.mjs"],
  ["polycss-drag", "polycss-nonvoxel-drag-trace.mjs"],
  ["drag", "polycss-nonvoxel-drag-trace.mjs"],
  ["generic", "capture-trace.mjs"],
  ["capture", "capture-trace.mjs"],
]);

function printHelp() {
  console.log(`Usage:
  node .agents/skills/chrome-capture-trace/scripts/trace.mjs <command> [options]

Commands:
  polycss-motion  Steady perf/nonvoxel bench trace buckets.
  polycss-drag    Real PolyOrbitControls pointer-drag trace.
  generic         Generic Chrome trace around a URL/action.
  report          Create a Markdown report from one summary JSON.
  compare         Compare two summary JSON files and print Markdown.

Aliases:
  motion, buckets -> polycss-motion
  drag            -> polycss-drag
  capture         -> generic

Examples:
  node .agents/skills/chrome-capture-trace/scripts/trace.mjs motion --page nonvoxel --mesh glb:Elephant.glb --dom-samples --label elephant
  node .agents/skills/chrome-capture-trace/scripts/trace.mjs drag --mesh teapot --degrees 360 --frame-details --label teapot-drag
  node .agents/skills/chrome-capture-trace/scripts/trace.mjs generic --url http://127.0.0.1:3000 --action drag --selector "#viewport"
  node .agents/skills/chrome-capture-trace/scripts/trace.mjs motion --report --markdown-out bench/results/garden.md
  node .agents/skills/chrome-capture-trace/scripts/trace.mjs report bench/results/garden.json --markdown-out bench/results/garden.md
  node .agents/skills/chrome-capture-trace/scripts/trace.mjs compare before.json after.json --markdown-out report.md
`);
}

function runScript(scriptName, args) {
  const scriptPath = resolve(scriptDir, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function stripTraceOptions(args) {
  const out = [];
  let report = false;
  let markdownOut = "";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--report") {
      report = true;
      continue;
    }
    if (arg === "--markdown-out") {
      markdownOut = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg.startsWith("--markdown-out=")) {
      markdownOut = arg.slice("--markdown-out=".length);
      continue;
    }
    out.push(arg);
  }
  return { childArgs: out, report, markdownOut };
}

function appendArg(args, name, value) {
  return [...args, `--${name}`, value];
}

function argValue(args, name) {
  const index = args.indexOf(`--${name}`);
  if (index >= 0) return args[index + 1];
  const prefixed = args.find((arg) => arg.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : "";
}

function positionalArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      out.push(arg);
      continue;
    }
    if (!arg.includes("=") && args[i + 1] && !args[i + 1].startsWith("--")) i += 1;
  }
  return out;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function safeLabel(value) {
  return String(value ?? "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "run";
}

function firstRun(summary) {
  return Array.isArray(summary.runs) ? summary.runs[0] : summary;
}

function frameMetrics(summary) {
  const run = firstRun(summary);
  const frames = run.frames ?? run;
  return {
    kind: summary.kind ?? run.kind ?? "",
    label: summary.label ?? run.label ?? summary.mesh ?? run.mesh ?? "",
    fps_p50: numberOrNull(frames.fps_p50),
    fps_p95: numberOrNull(frames.fps_p95),
    frame_time_p50_ms: numberOrNull(frames.frame_time_p50_ms),
    frame_time_p95_ms: numberOrNull(frames.frame_time_p95_ms),
    frame_time_p99_ms: numberOrNull(frames.frame_time_p99_ms),
    frame_count: numberOrNull(frames.count ?? frames.sample_count),
    poly_count: numberOrNull(run.polyCount ?? summary.polyCount),
  };
}

function numberOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function groupMsPerFrame(summary) {
  const run = firstRun(summary);
  if (Array.isArray(run.buckets)) {
    const totals = new Map();
    let frameCount = 0;
    for (const bucket of run.buckets) {
      const count = Number(bucket.frameCount) || 0;
      frameCount += count;
      for (const [group, value] of Object.entries(bucket.groups_ms_per_frame ?? {})) {
        totals.set(group, (totals.get(group) ?? 0) + (Number(value) || 0) * count);
      }
    }
    return Object.fromEntries([...totals.entries()].map(([group, total]) => [group, frameCount ? total / frameCount : 0]));
  }

  const frames = frameMetrics(summary).frame_count ?? 0;
  const groups = summary.trace?.groups ?? run.trace?.groups ?? {};
  return Object.fromEntries(Object.entries(groups).map(([group, value]) => {
    if (Number.isFinite(value?.ms_per_frame)) return [group, Number(value.ms_per_frame)];
    if (Number.isFinite(value?.duration_ms) && frames > 0) return [group, Number(value.duration_ms) / frames];
    return [group, 0];
  }));
}

function sortedGroups(summary) {
  return Object.entries(groupMsPerFrame(summary))
    .filter(([, value]) => Number.isFinite(value))
    .sort((a, b) => b[1] - a[1]);
}

function dominantGroup(summary) {
  return sortedGroups(summary).find(([, value]) => value > 0) ?? null;
}

function groupHint(group) {
  const hints = {
    script: "main-thread JavaScript/input work",
    style: "style recalculation or CSS variable invalidation",
    layout: "layout work",
    prePaint: "pre-paint lifecycle work",
    paint: "paint work",
    raster: "raster or image decode work",
    compositorMain: "main-thread compositing setup",
    compositorImpl: "compositor impl-thread work",
    gpuViz: "GPU/viz drawing pipeline",
  };
  return hints[group] ?? "trace event work";
}

function quickRead(summary) {
  const frames = frameMetrics(summary);
  const dominant = dominantGroup(summary);
  const lines = [];
  if (Number.isFinite(frames.frame_time_p95_ms)) {
    lines.push(`- p95 frame time: ${fmt(frames.frame_time_p95_ms)}ms.`);
  }
  if (dominant) {
    lines.push(`- Dominant trace group: \`${dominant[0]}\` at ${fmt(dominant[1], 4)}ms/frame, pointing at ${groupHint(dominant[0])}.`);
  } else {
    lines.push("- No non-zero trace group cost was attributed in the measured window.");
  }
  return lines;
}

function topEvents(summary, limit = 12) {
  const run = firstRun(summary);
  const raw = summary.trace?.topEvents ?? run.trace?.topEvents ?? run.eventTotals ?? [];
  return raw
    .map((event) => ({
      name: event.name ?? event.event ?? "",
      count: numberOrNull(event.count),
      duration_ms: numberOrNull(event.duration_ms),
      ms_per_frame: numberOrNull(event.ms_per_frame),
    }))
    .filter((event) => event.name)
    .slice(0, limit);
}

function summaryMetadata(summary) {
  const run = firstRun(summary);
  const action = summary.action?.kind ? `${summary.action.kind}` : "";
  return {
    kind: summary.kind ?? run.kind ?? "",
    page: summary.page ?? run.page ?? "",
    mesh: summary.mesh ?? run.mesh ?? "",
    renderer: summary.renderer ?? run.renderer ?? "",
    variant: summary.variant ?? run.variant ?? "",
    mode: summary.mode ?? run.mode ?? "",
    motion: summary.motion ?? run.motion ?? "",
    action,
    url: summary.url ?? run.url ?? "",
  };
}

function fmt(value, digits = 3) {
  return value === null || value === undefined || !Number.isFinite(value) ? "" : Number(value).toFixed(digits);
}

function fmtDelta(before, after, digits = 3) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return "";
  const delta = after - before;
  const sign = delta > 0 ? "+" : "";
  const pct = before === 0 ? "" : ` (${sign}${((delta / before) * 100).toFixed(1)}%)`;
  return `${sign}${delta.toFixed(digits)}${pct}`;
}

function metricRow(name, before, after, digits = 3) {
  return `| ${name} | ${fmt(before, digits)} | ${fmt(after, digits)} | ${fmtDelta(before, after, digits)} |`;
}

function summaryMarkdown(summary, file = "") {
  const meta = summaryMetadata(summary);
  const frames = frameMetrics(summary);
  const groups = groupMsPerFrame(summary);
  const events = topEvents(summary);
  const contextRows = Object.entries(meta).filter(([, value]) => value);
  const groupRows = Object.entries(groups).sort((a, b) => b[1] - a[1]);

  const lines = [
    "# Chrome Trace Report",
    "",
    ...(file ? [`Source: \`${file}\``, ""] : []),
    "## Quick Read",
    "",
    ...quickRead(summary),
    "",
    "## Context",
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...contextRows.map(([name, value]) => `| ${name} | ${String(value).replaceAll("|", "\\|")} |`),
    "",
    "## Frame Metrics",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| fps_p50 | ${fmt(frames.fps_p50, 2)} |`,
    `| fps_p95 | ${fmt(frames.fps_p95, 2)} |`,
    `| frame_time_p50_ms | ${fmt(frames.frame_time_p50_ms)} |`,
    `| frame_time_p95_ms | ${fmt(frames.frame_time_p95_ms)} |`,
    `| frame_time_p99_ms | ${fmt(frames.frame_time_p99_ms)} |`,
    `| frame_count | ${fmt(frames.frame_count, 0)} |`,
    `| poly_count | ${fmt(frames.poly_count, 0)} |`,
    "",
    "## Trace Groups",
    "",
    "| Group | ms/frame |",
    "| --- | ---: |",
    ...groupRows.map(([group, value]) => `| ${group} | ${fmt(value, 4)} |`),
    "",
    "## Top Events",
    "",
    "| Event | Count | Duration ms | ms/frame |",
    "| --- | ---: | ---: | ---: |",
    ...events.map((event) =>
      `| ${event.name.replaceAll("|", "\\|")} | ${fmt(event.count, 0)} | ${fmt(event.duration_ms)} | ${fmt(event.ms_per_frame, 4)} |`
    ),
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function writeOrPrintMarkdown(markdown, outFile) {
  if (outFile) writeFileSync(outFile, markdown);
  process.stdout.write(markdown);
}

function reportSummary(args) {
  const positions = positionalArgs(args);
  const file = argValue(args, "summary") || positions[0];
  if (!file) throw new Error("report requires a summary JSON file.");
  writeOrPrintMarkdown(summaryMarkdown(readJson(file), file), argValue(args, "markdown-out"));
}

function compareSummaries(args) {
  const positions = positionalArgs(args);
  const beforeFile = argValue(args, "before") || positions[0];
  const afterFile = argValue(args, "after") || positions[1];
  if (!beforeFile || !afterFile) {
    throw new Error("compare requires before and after JSON files.");
  }

  const before = readJson(beforeFile);
  const after = readJson(afterFile);
  const beforeFrames = frameMetrics(before);
  const afterFrames = frameMetrics(after);
  const beforeGroups = groupMsPerFrame(before);
  const afterGroups = groupMsPerFrame(after);
  const groupNames = [...new Set([...Object.keys(beforeGroups), ...Object.keys(afterGroups)])].sort();
  const groupDeltas = groupNames
    .map((group) => ({ group, before: beforeGroups[group] ?? 0, after: afterGroups[group] ?? 0 }))
    .map((entry) => ({ ...entry, delta: entry.after - entry.before }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const dominantDelta = groupDeltas.find((entry) => Math.abs(entry.delta) > 0.00005) ?? null;
  const p95Delta = Number.isFinite(beforeFrames.frame_time_p95_ms) && Number.isFinite(afterFrames.frame_time_p95_ms)
    ? afterFrames.frame_time_p95_ms - beforeFrames.frame_time_p95_ms
    : null;

  const lines = [
    "# Chrome Trace Compare",
    "",
    `Before: \`${beforeFile}\``,
    `After: \`${afterFile}\``,
    "",
    "## Quick Read",
    "",
    ...(Number.isFinite(p95Delta)
      ? [`- p95 frame time delta: ${fmtDelta(beforeFrames.frame_time_p95_ms, afterFrames.frame_time_p95_ms)}.`]
      : []),
    ...(dominantDelta
      ? [`- Largest trace-group movement: \`${dominantDelta.group}\` ${fmtDelta(dominantDelta.before, dominantDelta.after, 4)}, pointing at ${groupHint(dominantDelta.group)}.`]
      : ["- No comparable trace-group movement was found."]),
    "",
    "## Frame Metrics",
    "",
    "| Metric | Before | After | Delta |",
    "| --- | ---: | ---: | ---: |",
    metricRow("fps_p50", beforeFrames.fps_p50, afterFrames.fps_p50, 2),
    metricRow("fps_p95", beforeFrames.fps_p95, afterFrames.fps_p95, 2),
    metricRow("frame_time_p50_ms", beforeFrames.frame_time_p50_ms, afterFrames.frame_time_p50_ms),
    metricRow("frame_time_p95_ms", beforeFrames.frame_time_p95_ms, afterFrames.frame_time_p95_ms),
    metricRow("frame_time_p99_ms", beforeFrames.frame_time_p99_ms, afterFrames.frame_time_p99_ms),
    metricRow("frame_count", beforeFrames.frame_count, afterFrames.frame_count, 0),
    metricRow("poly_count", beforeFrames.poly_count, afterFrames.poly_count, 0),
    "",
    "## Trace Groups",
    "",
    "| Group | Before ms/frame | After ms/frame | Delta |",
    "| --- | ---: | ---: | ---: |",
    ...groupNames.map((group) => metricRow(group, beforeGroups[group] ?? 0, afterGroups[group] ?? 0, 4)),
    "",
  ];

  const markdown = `${lines.join("\n")}\n`;
  const outFile = argValue(args, "markdown-out");
  if (outFile) writeFileSync(outFile, markdown);
  process.stdout.write(markdown);
}

function inferSummaryPath(cmd, args) {
  const summaryOut = argValue(args, "summary-out");
  if (summaryOut) return resolve(summaryOut);

  if (cmd === "generic" || cmd === "capture") {
    return resolve(argValue(args, "summary-out") || "chrome-trace-summary.json");
  }

  if (cmd === "polycss-motion" || cmd === "motion" || cmd === "polycss-buckets" || cmd === "buckets") {
    const label = argValue(args, "label");
    if (!label) {
      throw new Error("motion --report requires --label so the runner writes bench/results/<label>.json.");
    }
    return resolve(repoRoot, "bench/results", `${label}.json`);
  }

  if (cmd === "polycss-drag" || cmd === "drag") {
    const explicit = argValue(args, "json");
    if (explicit) return resolve(explicit);
    const mesh = argValue(args, "mesh") || "teapot";
    const mode = argValue(args, "mode") || "baked";
    const variant = argValue(args, "variant") || "baseline";
    const label = argValue(args, "label") || `nonvoxel-drag-${safeLabel(mesh)}-${mode}-${safeLabel(variant)}`;
    return resolve(repoRoot, "bench/results", `${label}.json`);
  }

  return "";
}

function ensureReportSummaryPath(cmd, args) {
  if (argValue(args, "summary-out")) return { childArgs: args, summaryPath: inferSummaryPath(cmd, args) };

  if (cmd === "polycss-motion" || cmd === "motion" || cmd === "polycss-buckets" || cmd === "buckets") {
    const label = argValue(args, "label");
    if (label) return { childArgs: args, summaryPath: inferSummaryPath(cmd, args) };
    const file = resolve(tmpdir(), `chrome-capture-trace-${Date.now()}.json`);
    return { childArgs: appendArg(args, "summary-out", file), summaryPath: file };
  }

  return { childArgs: args, summaryPath: inferSummaryPath(cmd, args) };
}

try {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "report") {
    reportSummary(rest);
  } else if (command === "compare") {
    compareSummaries(rest);
  } else if (RUNNERS.has(command)) {
    const { childArgs, report, markdownOut } = stripTraceOptions(rest);
    const prepared = report ? ensureReportSummaryPath(command, childArgs) : { childArgs, summaryPath: "" };
    const status = runScript(RUNNERS.get(command), prepared.childArgs);
    if (status !== 0) process.exit(status);
    if (report) writeOrPrintMarkdown(summaryMarkdown(readJson(prepared.summaryPath), prepared.summaryPath), markdownOut);
  } else {
    printHelp();
    throw new Error(`Unknown trace command: ${command}`);
  }
} catch (error) {
  console.error(error?.message ?? error);
  process.exit(1);
}
