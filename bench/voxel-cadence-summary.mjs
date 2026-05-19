#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

const resultDir = process.argv[2] ?? "bench/results";

const FILE_PATTERNS = [
  [/^cadence-clean-(.*)-rotation-compare\.json$/, 1, "clean"],
  [/^cadence-wide-(.*)-rotation-compare\.json$/, 2, "wide"],
  [/^cadence-extended-(.*)-rotation-compare\.json$/, 3, "extended"],
  [/^cadence-validate-(.*)-rotation-compare\.json$/, 4, "validated"],
];

function matchFile(file) {
  for (const [pattern, priority, label] of FILE_PATTERNS) {
    const match = pattern.exec(file);
    if (match) return { key: match[1], priority, label };
  }
  return null;
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

function fmt(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "";
}

function cadence4Plus(run) {
  const pct = run.cadence?.vsync_pct;
  if (!pct) return null;
  return (pct.x4 ?? 0) + (pct.x5 ?? 0) + (pct.x6_plus ?? 0);
}

function winnerFor(deltaP95, deltaP99) {
  if (Math.abs(deltaP95) >= 8) return deltaP95 > 0 ? "matrix" : "slice";
  if (Math.abs(deltaP99) >= 8) return deltaP99 > 0 ? "matrix-p99" : "slice-p99";
  return "flat";
}

async function loadRows() {
  const selected = new Map();
  for (const file of await readdir(resultDir)) {
    const match = matchFile(file);
    if (!match) continue;
    const path = join(resultDir, file);
    const mtime = (await stat(path)).mtimeMs;
    const current = selected.get(match.key);
    if (
      !current ||
      match.priority > current.priority ||
      (match.priority === current.priority && mtime > current.mtime)
    ) {
      selected.set(match.key, { ...match, path, mtime });
    }
  }

  const rows = [];
  for (const entry of selected.values()) {
    const data = JSON.parse(await readFile(entry.path, "utf8"));
    const matrixRuns = data.cases?.["polycss-matrix"]?.runs ?? [];
    const sliceRuns = data.cases?.["polycss-baked-voxzoom"]?.runs ?? [];
    if (matrixRuns.length === 0 || sliceRuns.length === 0) continue;

    const slice = sliceRuns[0];
    const meta = slice.metadata ?? {};
    const brush = slice.brushMetrics ?? {};
    const matrixP95 = median(matrixRuns.map((run) => run.fps_p95));
    const sliceP95 = median(sliceRuns.map((run) => run.fps_p95));
    const matrixP50 = median(matrixRuns.map((run) => run.fps_p50));
    const sliceP50 = median(sliceRuns.map((run) => run.fps_p50));
    const matrixP99 = median(matrixRuns.map((run) => run.frame_time_p99_ms));
    const sliceP99 = median(sliceRuns.map((run) => run.frame_time_p99_ms));
    const deltaP95 = matrixP95 - sliceP95;
    const deltaP99 = sliceP99 - matrixP99;

    rows.push({
      model: String(data.model ?? basename(entry.path)).replace(/\.vox$/, ""),
      source: entry.label,
      runs: Math.min(matrixRuns.length, sliceRuns.length),
      winner: winnerFor(deltaP95, deltaP99),
      matrixP50,
      sliceP50,
      matrixP95,
      sliceP95,
      matrixP99,
      sliceP99,
      deltaP95,
      deltaP99,
      matrix4Plus: median(matrixRuns.map(cadence4Plus)),
      slice4Plus: median(sliceRuns.map(cadence4Plus)),
      activeLeaves: slice.dom?.leaves ?? null,
      matrixNodes: median(matrixRuns.map((run) => run.performanceMetrics?.Nodes)),
      sliceNodes: median(sliceRuns.map((run) => run.performanceMetrics?.Nodes)),
      planes: brush.depthPlaneCount ?? null,
      colors: brush.colorCount ?? null,
      areaK: Number.isFinite(brush.localAreaTotal) ? Math.round(brush.localAreaTotal / 1000) : null,
      fill: brush.localPlaneFillRatio ?? null,
      screenFill: brush.screenFillRatio ?? null,
      dimensions: [meta.rows, meta.cols, meta.depth].every(Number.isFinite)
        ? `${meta.rows}x${meta.cols}x${meta.depth}`
        : "",
    });
  }
  return rows.sort((a, b) => a.model.localeCompare(b.model));
}

const rows = await loadRows();
const groups = new Map();
for (const row of rows) {
  const list = groups.get(row.winner) ?? [];
  list.push(row);
  groups.set(row.winner, list);
}

console.log(`# Voxel Cadence Corpus\n`);
console.log(`Models: ${rows.length}\n`);
for (const key of ["matrix", "slice", "matrix-p99", "slice-p99", "flat"]) {
  const list = groups.get(key) ?? [];
  console.log(`- ${key}: ${list.length}${list.length ? ` (${list.map((row) => row.model).join(", ")})` : ""}`);
}

console.log("\n## Strong Winners\n");
console.log("| Model | Winner | Source | Runs | Matrix p95 | Slice p95 | Matrix p99 | Slice p99 | Matrix 4x+ | Slice 4x+ | Leaves | Nodes M/S | Planes | Colors | AreaK | Fill | Screen | Dims |");
console.log("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |");
for (const row of rows
  .filter((candidate) => candidate.winner === "matrix" || candidate.winner === "slice")
  .sort((a, b) => Math.abs(b.deltaP95) - Math.abs(a.deltaP95))) {
  console.log([
    `| ${row.model}`,
    row.winner,
    row.source,
    row.runs,
    fmt(row.matrixP95),
    fmt(row.sliceP95),
    fmt(row.matrixP99),
    fmt(row.sliceP99),
    fmt(row.matrix4Plus),
    fmt(row.slice4Plus),
    row.activeLeaves ?? "",
    `${fmt(row.matrixNodes, 0)}/${fmt(row.sliceNodes, 0)}`,
    row.planes ?? "",
    row.colors ?? "",
    row.areaK ?? "",
    fmt(row.fill, 3),
    fmt(row.screenFill, 3),
    `${row.dimensions} |`,
  ].join(" | "));
}

console.log("\n## P50/P99 Splits Within Flat p95\n");
console.log("| Model | Source | Runs | Matrix p50 | Slice p50 | Matrix p95 | Slice p95 | Matrix p99 | Slice p99 | Leaves | Screen |");
console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const row of rows
  .filter((candidate) =>
    candidate.winner === "flat" &&
    (Math.abs(candidate.matrixP50 - candidate.sliceP50) >= 20 || Math.abs(candidate.deltaP99) >= 5)
  )
  .sort((a, b) => Math.abs(b.deltaP99) - Math.abs(a.deltaP99))) {
  console.log([
    `| ${row.model}`,
    row.source,
    row.runs,
    fmt(row.matrixP50),
    fmt(row.sliceP50),
    fmt(row.matrixP95),
    fmt(row.sliceP95),
    fmt(row.matrixP99),
    fmt(row.sliceP99),
    row.activeLeaves ?? "",
    `${fmt(row.screenFill, 3)} |`,
  ].join(" | "));
}
