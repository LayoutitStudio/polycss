#!/usr/bin/env node
/**
 * Measure pure shadow coverage and receiver-merge compute costs.
 *
 * Usage:
 *   node bench/shadow-timing-bench.mjs
 *   node bench/shadow-timing-bench.mjs --json bench/results/shadow-timing.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  buildParametricCasterOverride,
  computeMergedReceiverShadows,
  prepareCasterPolyItems,
  prepareReceiverFacePlanes,
  torusPolygons,
  worldDirectionToCss,
} from "../packages/core/dist/index.js";

const argv = process.argv.slice(2);
const flag = (name) => argv.indexOf(`--${name}`);
const optStr = (name, dflt = "") => {
  const i = flag(name);
  return i >= 0 ? argv[i + 1] : dflt;
};

if (flag("help") >= 0) {
  console.log(`Usage: node bench/shadow-timing-bench.mjs [--json file]

Options:
  --json <file>  Write the full result rows as JSON.
`);
  process.exit(0);
}

const casterPolys = torusPolygons({});
const receiverPolys = [{
  vertices: [[-10, -10, 0], [10, -10, 0], [10, 10, 0], [-10, 10, 0]],
  color: "#cccccc",
}];
const lightDir = worldDirectionToCss([0.4, -0.7, 0.59]);
// Core torus helper emits ~±65-unit (pixel-scale) vertices; scale 0.04 puts the caster at ~±2.6 world units so its shadow actually lands on the ±10-unit receiver (scale 1 emitted zero faces for exact/pixel configs).
const items = prepareCasterPolyItems(casterPolys, [0, 0, 2], 0.04, () => true);
const planes = prepareReceiverFacePlanes(receiverPolys, [0, 0, 0], 1, new Set(), 0.001);
const definitions = [8, 16, 24, 35, 48, 96];
const styles = ["vector", "pixel"];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function runConfig(config) {
  let overrideSilhouette;
  let overridePointSilhouettes;
  let coverageMs = 0;
  if (config.style !== "exact") {
    const start = performance.now();
    ({ overrideSilhouette, overridePointSilhouettes } = buildParametricCasterOverride({
      polysWorldVerts: items.map((item) => item.wv),
      lightDir,
      definition: config.definition,
      isSelf: false,
      style: config.style,
      pointLights: [],
    }));
    coverageMs = performance.now() - start;
  }

  const mergeStart = performance.now();
  const faces = computeMergedReceiverShadows({
    receiverPlanes: planes,
    receiverPolygons: receiverPolys,
    receiverHasTexture: false,
    casters: [{ id: "caster", items, overrideSilhouette, overridePointSilhouettes }],
    lightDir,
    runDirectional: true,
    pointPasses: [],
    allPointLights: [],
    cameraRot: { rotX: 65, rotY: 45 },
    ambientLight: { color: "#ffffff", intensity: 0.4 },
    directionalLight: { direction: [0.4, -0.7, 0.59], color: "#ffffff", intensity: 1 },
    shadow: { color: "#000000", opacity: 0.25, maxExtend: 2000 },
  });
  const mergeMs = performance.now() - mergeStart;
  const pathChars = faces.reduce((sum, face) =>
    sum + (face.baseD?.length ?? 0) + face.layers.reduce((n, layer) => n + layer.d.length, 0), 0);
  return { coverageMs, mergeMs, totalMs: coverageMs + mergeMs, faces: faces.length, pathChars };
}

function benchmark(config) {
  for (let i = 0; i < 2; i++) runConfig(config);
  const runs = Array.from({ length: 7 }, () => runConfig(config));
  const representative = runs[3];
  return {
    style: config.style,
    definition: config.definition ?? null,
    coverageMs: median(runs.map((run) => run.coverageMs)),
    mergeMs: median(runs.map((run) => run.mergeMs)),
    totalMs: median(runs.map((run) => run.totalMs)),
    faces: representative.faces,
    pathChars: representative.pathChars,
  };
}

function printTable(rows) {
  const headers = ["style", "definition", "coverage-ms", "merge-ms", "total-ms", "faces", "path-chars"];
  const values = rows.map((row) => [
    row.style,
    row.definition ?? "-",
    row.coverageMs.toFixed(3),
    row.mergeMs.toFixed(3),
    row.totalMs.toFixed(3),
    row.faces,
    row.pathChars,
  ]);
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...values.map((row) => String(row[column]).length)));
  console.log(headers.map((header, i) => header.padStart(widths[i])).join("  "));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of values) console.log(row.map((value, i) => String(value).padStart(widths[i])).join("  "));
}

const configs = [
  { style: "exact" },
  ...styles.flatMap((style) => definitions.map((definition) => ({ style, definition }))),
];
const rows = configs.map(benchmark).sort((a, b) => a.totalMs - b.totalMs);
printTable(rows);

const jsonPath = optStr("json");
if (jsonPath) {
  const outputPath = resolve(jsonPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`\nWrote ${outputPath}`);
}
