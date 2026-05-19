#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const resultDir = process.argv[2] ?? "bench/results";
const prefixes = process.argv.slice(3);
const selectedPrefixes = prefixes.length
  ? prefixes
  : ["browser-chrome", "browser-canary", "browser-chrome-headed"];

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

function winnerFor(deltaP95, deltaP99) {
  if (Math.abs(deltaP95) >= 8) return deltaP95 > 0 ? "matrix" : "slice";
  if (Math.abs(deltaP99) >= 8) return deltaP99 > 0 ? "matrix-p99" : "slice-p99";
  return "flat";
}

const files = await readdir(resultDir);

function matchesPrefix(file, prefix) {
  if (!file.startsWith(`${prefix}-`) || !file.endsWith("-rotation-compare.json")) return false;
  return !selectedPrefixes.some((other) =>
    other !== prefix &&
    other.startsWith(`${prefix}-`) &&
    file.startsWith(`${other}-`)
  );
}

for (const prefix of selectedPrefixes) {
  const rows = [];
  for (const file of files) {
    if (!matchesPrefix(file, prefix)) continue;
    const data = JSON.parse(await readFile(join(resultDir, file), "utf8"));
    const matrixRuns = data.cases?.["polycss-matrix"]?.runs ?? [];
    const sliceRuns = data.cases?.["polycss-baked-voxzoom"]?.runs ?? [];
    if (matrixRuns.length === 0 || sliceRuns.length === 0) continue;
    const matrixP95 = median(matrixRuns.map((run) => run.fps_p95));
    const sliceP95 = median(sliceRuns.map((run) => run.fps_p95));
    const matrixP99 = median(matrixRuns.map((run) => run.frame_time_p99_ms));
    const sliceP99 = median(sliceRuns.map((run) => run.frame_time_p99_ms));
    rows.push({
      model: String(data.model ?? file).replace(/\.vox$/, ""),
      runs: Math.min(matrixRuns.length, sliceRuns.length),
      winner: winnerFor(matrixP95 - sliceP95, sliceP99 - matrixP99),
      matrixP95,
      sliceP95,
      matrixP99,
      sliceP99,
      browser: matrixRuns[0]?.browserVersion ?? "",
    });
  }

  rows.sort((a, b) => a.model.localeCompare(b.model));
  console.log(`\n## ${prefix}${rows[0]?.browser ? ` (${rows[0].browser})` : ""}\n`);
  console.log("| Model | Winner | Runs | Matrix p95 | Slice p95 | Matrix p99 | Slice p99 |");
  console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: |");
  for (const row of rows) {
    console.log([
      `| ${row.model}`,
      row.winner,
      row.runs,
      fmt(row.matrixP95),
      fmt(row.sliceP95),
      fmt(row.matrixP99),
      `${fmt(row.sliceP99)} |`,
    ].join(" | "));
  }
}
