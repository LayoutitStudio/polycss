#!/usr/bin/env node
/**
 * Measure parse cost and mesh reduction for committed MagicaVoxel models.
 *
 * Usage:
 *   node bench/vox-import-bench.mjs
 *   node bench/vox-import-bench.mjs --models apple.vox,house.vox
 *   node bench/vox-import-bench.mjs --json bench/results/vox-import.json
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { parseVox } from "../packages/core/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const modelDir = resolve(repoRoot, "website/public/gallery/vox");
const argv = process.argv.slice(2);
const flag = (name) => argv.indexOf(`--${name}`);
const optStr = (name, dflt = "") => {
  const i = flag(name);
  return i >= 0 ? argv[i + 1] : dflt;
};

if (flag("help") >= 0) {
  console.log(`Usage: node bench/vox-import-bench.mjs [--models files] [--json file]

Options:
  --models <files>  Comma-separated .vox filenames from the gallery directory.
  --json <file>     Write the full result rows as JSON.
`);
  process.exit(0);
}

function availableModels() {
  return readdirSync(modelDir)
    .filter((name) => name.toLowerCase().endsWith(".vox"))
    .map((name) => ({ name, path: resolve(modelDir, name), bytes: statSync(resolve(modelDir, name)).size }))
    .sort((a, b) => a.bytes - b.bytes || a.name.localeCompare(b.name));
}

function selectedModels() {
  const available = availableModels();
  const override = optStr("models").trim();
  if (!override) {
    return [available[0], available[Math.floor(available.length / 2)], available.at(-1)];
  }
  const byName = new Map(available.map((model) => [model.name.toLowerCase(), model]));
  return override.split(",").map((value) => {
    const name = basename(value.trim()).toLowerCase();
    const model = byName.get(name);
    if (!model) throw new Error(`Model not found in ${modelDir}: ${value.trim()}`);
    return model;
  });
}

function arrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function timedParse(buffer) {
  const start = performance.now();
  const result = parseVox(buffer);
  return { result, ms: performance.now() - start };
}

function benchmark(model) {
  const bytes = readFileSync(model.path);
  const buffer = arrayBuffer(bytes);
  timedParse(buffer);
  const runs = Array.from({ length: 5 }, () => timedParse(buffer));
  const result = runs[2].result;
  const polygons = result.polygons.length;
  const cells = result.voxelSource?.cells.length ?? null;
  return {
    model: model.name,
    bytes: model.bytes,
    parseMs: median(runs.map((run) => run.ms)),
    polygons,
    cells,
    cellsPerPolygon: cells === null || polygons === 0 ? null : cells / polygons,
  };
}

function printTable(rows) {
  const headers = ["model", "bytes", "parse-ms", "polygons", "cells", "cells/poly"];
  const values = rows.map((row) => [
    row.model,
    row.bytes,
    row.parseMs.toFixed(3),
    row.polygons,
    row.cells ?? "-",
    row.cellsPerPolygon?.toFixed(2) ?? "-",
  ]);
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...values.map((row) => String(row[column]).length)));
  console.log(headers.map((header, i) => header.padStart(widths[i])).join("  "));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of values) console.log(row.map((value, i) => String(value).padStart(widths[i])).join("  "));
}

const models = selectedModels();
console.log(`Selected models: ${models.map((model) => `${model.name} (${model.bytes} bytes)`).join(", ")}\n`);
const rows = models.map(benchmark);
printTable(rows);

const jsonPath = optStr("json");
if (jsonPath) {
  const outputPath = resolve(jsonPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`\nWrote ${outputPath}`);
}
