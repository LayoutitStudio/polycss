#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "bench/results/stl-samples/manifest.json");
const coreDistPath = resolve(root, "packages/core/dist/index.js");

if (!existsSync(manifestPath)) {
  throw new Error("Missing bench/results/stl-samples/manifest.json. Download the STL sample set first.");
}

if (!existsSync(coreDistPath)) {
  throw new Error("Missing packages/core/dist/index.js. Run `pnpm --filter @layoutit/polycss-core build` first.");
}

const { parseStl, optimizeMeshParseResult } = await import(pathToFileURL(coreDistPath).href);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function detectStlFormat(bytes) {
  if (bytes.byteLength >= 84) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const triangleCount = view.getUint32(80, true);
    if (84 + triangleCount * 50 === bytes.byteLength) return "binary";
  }
  return "ascii";
}

function disposableResult(polygons, warnings, metadata) {
  return {
    polygons,
    objectUrls: [],
    dispose() {},
    warnings,
    metadata,
  };
}

const rows = [];
for (const item of manifest) {
  const filePath = resolve(root, "bench/results/stl-samples", item.file);
  const bytes = readFileSync(filePath);
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const parsed = parseStl(input);
  const lossless = optimizeMeshParseResult(
    disposableResult(parsed.polygons, parsed.warnings, parsed.metadata),
    { meshResolution: "lossless" },
  );
  const lossy = optimizeMeshParseResult(
    disposableResult(parsed.polygons, parsed.warnings, parsed.metadata),
    { meshResolution: "lossy" },
  );

  rows.push({
    file: item.file,
    format: detectStlFormat(bytes),
    sourceFacets: item.num_facets,
    emittedPolygons: parsed.polygons.length,
    losslessLeaves: lossless.polygons.length,
    lossyLeaves: lossy.polygons.length,
    warnings: parsed.warnings,
  });
}

console.table(rows.map((row) => ({
  file: row.file,
  format: row.format,
  facets: row.sourceFacets,
  emitted: row.emittedPolygons,
  lossless: row.losslessLeaves,
  lossy: row.lossyLeaves,
  warnings: row.warnings.length,
})));

console.log(JSON.stringify(rows, null, 2));
