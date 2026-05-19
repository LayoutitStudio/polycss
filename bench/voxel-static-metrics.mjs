#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  BASE_TILE,
  buildPolyVoxelFaceData,
  buildPolyVoxelSlicePlan,
  normalFacesCamera,
  parsePureColor,
  parseVox,
  POLY_VOXEL_NEXT_LAYER_STEP,
} from "../packages/core/dist/index.js";

const repoRoot = resolve(import.meta.dirname, "..");
const voxDir = process.argv[2] ?? resolve(repoRoot, "website/public/gallery/vox");
const resultDir = process.argv[3] ?? resolve(repoRoot, "bench/results");

const ROTATION = { rotX: 65, rotY: 45 };
const DIRECTIONAL_LIGHT = { direction: dirFromAzEl(50, 45), color: "#ffffff", intensity: 1 };
const AMBIENT_LIGHT = { color: "#ffffff", intensity: 0.4 };

const FACE_NORMALS = {
  t: [0, 0, 1],
  b: [0, 0, -1],
  fl: [0, 1, 0],
  br: [0, -1, 0],
  fr: [1, 0, 0],
  bl: [-1, 0, 0],
};

const FACE_BY_NORMAL = new Map([
  ["0,0,1", "t"],
  ["0,0,-1", "b"],
  ["0,1,0", "fl"],
  ["0,-1,0", "br"],
  ["1,0,0", "fr"],
  ["-1,0,0", "bl"],
]);

const FILE_PATTERNS = [
  [/^cadence-clean-(.*)-rotation-compare\.json$/, 1, "clean"],
  [/^cadence-wide-(.*)-rotation-compare\.json$/, 2, "wide"],
  [/^cadence-extended-(.*)-rotation-compare\.json$/, 3, "extended"],
  [/^cadence-validate-(.*)-rotation-compare\.json$/, 4, "validated"],
];

function dirFromAzEl(azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return [cosEl * Math.sin(az), cosEl * Math.cos(az), Math.sin(el)];
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

function canonicalModelKey(file) {
  return basename(file, ".vox").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function resultModelKey(model) {
  return String(model ?? "").replace(/\.vox$/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function winnerFor(deltaP95, deltaP99) {
  if (Math.abs(deltaP95) >= 8) return deltaP95 > 0 ? "matrix" : "slice";
  if (Math.abs(deltaP99) >= 8) return deltaP99 > 0 ? "matrix-p99" : "slice-p99";
  return "flat";
}

function parseColor(input) {
  const parsed = parsePureColor(input);
  if (!parsed) return { r: 255, g: 255, b: 255, alpha: 1 };
  return { r: parsed.rgb[0], g: parsed.rgb[1], b: parsed.rgb[2], alpha: parsed.alpha };
}

function rgbToHex({ r, g, b }) {
  const f = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

function clampChannel(value) {
  return Math.round(Math.max(0, Math.min(255, value)));
}

function shadeBrushColor(normal, baseColor) {
  const base = parseColor(baseColor);
  const light = parseColor(DIRECTIONAL_LIGHT.color);
  const ambient = parseColor(AMBIENT_LIGHT.color);
  const lightDir = DIRECTIONAL_LIGHT.direction;
  const lightLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / lightLen;
  const ly = lightDir[1] / lightLen;
  const lz = lightDir[2] / lightLen;
  const directScale = Math.max(0, DIRECTIONAL_LIGHT.intensity) *
    Math.max(0, normal[0] * lx + normal[1] * ly + normal[2] * lz);
  const tintR = (ambient.r / 255) * AMBIENT_LIGHT.intensity + (light.r / 255) * directScale;
  const tintG = (ambient.g / 255) * AMBIENT_LIGHT.intensity + (light.g / 255) * directScale;
  const tintB = (ambient.b / 255) * AMBIENT_LIGHT.intensity + (light.b / 255) * directScale;
  const shaded = {
    r: base.r * tintR,
    g: base.g * tintG,
    b: base.b * tintB,
    alpha: base.alpha,
  };
  return shaded.alpha < 1
    ? `rgba(${clampChannel(shaded.r)}, ${clampChannel(shaded.g)}, ${clampChannel(shaded.b)}, ${shaded.alpha})`
    : rgbToHex(shaded);
}

function cssNormalForPolygon(polygon) {
  const vertices = polygon.vertices;
  if (vertices.length < 3) return null;
  const v0 = vertices[0];
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 1; i + 1 < vertices.length; i += 1) {
    const v1 = vertices[i];
    const v2 = vertices[i + 1];
    const e1x = v1[1] - v0[1];
    const e1y = v1[0] - v0[0];
    const e1z = v1[2] - v0[2];
    const e2x = v2[1] - v0[1];
    const e2y = v2[0] - v0[0];
    const e2z = v2[2] - v0[2];
    nx -= e1y * e2z - e1z * e2y;
    ny -= e1z * e2x - e1x * e2z;
    nz -= e1x * e2y - e1y * e2x;
  }
  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-9) return null;
  return [
    Math.round(nx / len),
    Math.round(ny / len),
    Math.round(nz / len),
  ];
}

function polygonBrush(polygon) {
  if (polygon.texture || polygon.material || polygon.uvs || polygon.textureTriangles) return null;
  if (polygon.vertices.length !== 4) return null;
  const normal = cssNormalForPolygon(polygon);
  const face = normal ? FACE_BY_NORMAL.get(normal.join(",")) : undefined;
  if (!face) return null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of polygon.vertices) {
    minX = Math.min(minX, v[0]);
    minY = Math.min(minY, v[1]);
    minZ = Math.min(minZ, v[2]);
    maxX = Math.max(maxX, v[0]);
    maxY = Math.max(maxY, v[1]);
    maxZ = Math.max(maxZ, v[2]);
  }

  const eps = 1e-6;
  const baseColor = polygon.color || "#cccccc";
  if (Math.abs(maxZ - minZ) <= eps) {
    return {
      axis: "z",
      face,
      left: minY * BASE_TILE,
      top: minX * BASE_TILE,
      width: Math.max(0, (maxY - minY) * BASE_TILE),
      height: Math.max(0, (maxX - minX) * BASE_TILE),
      z: minZ * BASE_TILE,
      baseColor,
    };
  }
  if (Math.abs(maxX - minX) <= eps) {
    return {
      axis: "x",
      face,
      left: minY * BASE_TILE,
      top: minZ * BASE_TILE,
      width: Math.max(0, (maxY - minY) * BASE_TILE),
      height: Math.max(0, (maxZ - minZ) * BASE_TILE),
      z: -minX * BASE_TILE,
      baseColor,
    };
  }
  if (Math.abs(maxY - minY) <= eps) {
    return {
      axis: "y",
      face,
      left: minZ * BASE_TILE,
      top: minX * BASE_TILE,
      width: Math.max(0, (maxZ - minZ) * BASE_TILE),
      height: Math.max(0, (maxX - minX) * BASE_TILE),
      z: -minY * BASE_TILE,
      baseColor,
    };
  }
  return null;
}

function buildPolygonPlans(polygons) {
  const plans = new Map();
  let accepted = 0;
  for (const polygon of polygons) {
    const brush = polygonBrush(polygon);
    if (!brush || brush.width <= 0 || brush.height <= 0) continue;
    accepted += 1;
    const key = `${brush.axis}:${brush.face}`;
    let plan = plans.get(key);
    if (!plan) {
      plan = { axis: brush.axis, face: brush.face, brushes: [] };
      plans.set(key, plan);
    }
    plan.brushes.push(brush);
  }
  return accepted === polygons.length ? Array.from(plans.values()) : [];
}

function planBrushZ(plan, cellPx) {
  const plane = plan.key.plane * cellPx;
  return plan.key.axis === "z" ? plane : -plane;
}

function buildMergedPlans(source, cellPx) {
  const faces = buildPolyVoxelFaceData(source);
  const faceIndex = new Map();
  for (const face of faces) {
    faceIndex.set(`${face.key.axis}:${face.key.plane}:${face.key.face}`, face);
  }
  return faces.map((face) => {
    const nextPlane = face.key.plane + POLY_VOXEL_NEXT_LAYER_STEP[face.key.face];
    const nextFace = faceIndex.get(`${face.key.axis}:${nextPlane}:${face.key.face}`);
    const plan = buildPolyVoxelSlicePlan(face, nextFace?.buffer ?? null);
    const z = planBrushZ(plan, cellPx);
    return {
      axis: plan.key.axis,
      face: plan.key.face,
      brushes: plan.brushes.map((brush) => ({
        left: (plan.buffer.minCol + brush.c0) * cellPx,
        top: (plan.buffer.minRow + brush.r0) * cellPx,
        width: (brush.c1 - brush.c0) * cellPx,
        height: (brush.r1 - brush.r0) * cellPx,
        z,
        baseColor: brush.baseColor,
      })),
    };
  });
}

function rectUnionArea(rects) {
  if (!rects.length) return 0;
  const xs = [...new Set(rects.flatMap((rect) => [rect.left, rect.right]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i += 1) {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    if (x1 <= x0) continue;
    const intervals = [];
    for (const rect of rects) {
      if (rect.left < x1 && rect.right > x0) intervals.push([rect.top, rect.bottom]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let start = -Infinity;
    let end = -Infinity;
    for (const interval of intervals) {
      if (interval[0] > end) {
        if (Number.isFinite(end)) covered += end - start;
        start = interval[0];
        end = interval[1];
      } else {
        end = Math.max(end, interval[1]);
      }
    }
    if (Number.isFinite(end)) covered += end - start;
    area += (x1 - x0) * covered;
  }
  return area;
}

function brushMetrics(plans) {
  const visibleFaces = new Set(
    Object.entries(FACE_NORMALS)
      .filter(([, normal]) => normalFacesCamera(normal, ROTATION))
      .map(([face]) => face)
  );
  const activeRects = [];
  const allRects = [];
  const visibleBaseColors = new Set();
  const visibleShadedColors = new Set();
  const allBaseColors = new Set();
  const visiblePlanes = new Set();
  const allPlanes = new Set();
  const faceCounts = {};
  for (const plan of plans) {
    const normal = FACE_NORMALS[plan.face];
    const visible = visibleFaces.has(plan.face);
    for (const brush of plan.brushes) {
      const rect = {
        axis: plan.axis,
        plane: Number(brush.z.toFixed(3)),
        left: brush.left,
        top: brush.top,
        right: brush.left + brush.width,
        bottom: brush.top + brush.height,
        width: brush.width,
        height: brush.height,
        area: brush.width * brush.height,
      };
      allRects.push(rect);
      allBaseColors.add(brush.baseColor);
      allPlanes.add(`${plan.axis}:${rect.plane}`);
      faceCounts[plan.face] = (faceCounts[plan.face] ?? 0) + 1;
      if (!visible) continue;
      activeRects.push(rect);
      visibleBaseColors.add(brush.baseColor);
      visibleShadedColors.add(shadeBrushColor(normal, brush.baseColor));
      visiblePlanes.add(`${plan.axis}:${rect.plane}`);
    }
  }

  const activeArea = activeRects.reduce((sum, rect) => sum + rect.area, 0);
  const byPlane = new Map();
  for (const rect of activeRects) {
    const key = `${rect.axis}:${rect.plane}`;
    const list = byPlane.get(key) ?? [];
    list.push(rect);
    byPlane.set(key, list);
  }
  let unionArea = 0;
  let planeBoundsArea = 0;
  for (const list of byPlane.values()) {
    unionArea += rectUnionArea(list);
    const minX = Math.min(...list.map((rect) => rect.left));
    const minY = Math.min(...list.map((rect) => rect.top));
    const maxX = Math.max(...list.map((rect) => rect.right));
    const maxY = Math.max(...list.map((rect) => rect.bottom));
    planeBoundsArea += Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
  }

  return {
    totalBrushes: allRects.length,
    activeBrushes: activeRects.length,
    allBaseColors: allBaseColors.size,
    visibleBaseColors: visibleBaseColors.size,
    visibleShadedColors: visibleShadedColors.size,
    allPlanes: allPlanes.size,
    visiblePlanes: visiblePlanes.size,
    activeArea,
    activeAreaK: Math.round(activeArea / 1000),
    activeUnionArea: Math.round(unionArea),
    activePlaneFillRatio: planeBoundsArea ? +(activeArea / planeBoundsArea).toFixed(3) : null,
    faceCounts,
  };
}

async function loadCadenceRows() {
  const selected = new Map();
  for (const file of await readdir(resultDir)) {
    let matchInfo = null;
    for (const [pattern, priority, label] of FILE_PATTERNS) {
      const match = pattern.exec(file);
      if (match) {
        matchInfo = { key: match[1], priority, label };
        break;
      }
    }
    if (!matchInfo) continue;
    const path = join(resultDir, file);
    const mtime = (await stat(path)).mtimeMs;
    const current = selected.get(matchInfo.key);
    if (!current || matchInfo.priority > current.priority || (matchInfo.priority === current.priority && mtime > current.mtime)) {
      selected.set(matchInfo.key, { ...matchInfo, path, mtime });
    }
  }

  const rows = new Map();
  for (const entry of selected.values()) {
    const data = JSON.parse(await readFile(entry.path, "utf8"));
    const matrixRuns = data.cases?.["polycss-matrix"]?.runs ?? [];
    const sliceRuns = data.cases?.["polycss-baked-voxzoom"]?.runs ?? [];
    if (matrixRuns.length === 0 || sliceRuns.length === 0) continue;
    const matrixP95 = median(matrixRuns.map((run) => run.fps_p95));
    const sliceP95 = median(sliceRuns.map((run) => run.fps_p95));
    const matrixP99 = median(matrixRuns.map((run) => run.frame_time_p99_ms));
    const sliceP99 = median(sliceRuns.map((run) => run.frame_time_p99_ms));
    const deltaP95 = matrixP95 - sliceP95;
    const deltaP99 = sliceP99 - matrixP99;
    const model = resultModelKey(data.model ?? entry.key);
    rows.set(model, {
      source: entry.label,
      runs: Math.min(matrixRuns.length, sliceRuns.length),
      winner: winnerFor(deltaP95, deltaP99),
      matrixP95,
      sliceP95,
      matrixP99,
      sliceP99,
      deltaP95,
      deltaP99,
    });
  }
  return rows;
}

async function analyzeVoxFile(path) {
  const bytes = await readFile(path);
  const parsed = parseVox(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { targetSize: 70, gridShift: 0 },
  );
  const source = parsed.voxelSource;
  const sourceColors = new Set((source?.cells ?? []).map((cell) => cell.color));
  const cellPx = source ? Math.max(1, Math.round(source.scale * BASE_TILE)) : BASE_TILE;
  const polygonPlans = buildPolygonPlans(parsed.polygons);
  const plans = polygonPlans.length > 0 ? polygonPlans : (source ? buildMergedPlans(source, cellPx) : []);
  const metrics = brushMetrics(plans);
  return {
    file: basename(path),
    key: canonicalModelKey(path),
    rows: source?.rows ?? null,
    cols: source?.cols ?? null,
    depth: source?.depth ?? null,
    maxDim: source ? Math.max(source.rows, source.cols, source.depth) : null,
    cellPx,
    sourceBytes: source?.sourceBytes ?? bytes.byteLength,
    voxels: source?.cells.length ?? parsed.metadata?.voxelCount ?? null,
    polygons: parsed.polygons.length,
    sourceColors: sourceColors.size,
    planner: polygonPlans.length > 0 ? "polygons" : "source",
    ...metrics,
  };
}

const cadenceRows = await loadCadenceRows();
const files = (await readdir(voxDir))
  .filter((file) => file.toLowerCase().endsWith(".vox"))
  .sort((a, b) => a.localeCompare(b));

const staticRows = [];
for (const file of files) {
  staticRows.push(await analyzeVoxFile(join(voxDir, file)));
}

const joined = staticRows.map((row) => ({ ...row, cadence: cadenceRows.get(row.key) ?? null }));
const tested = joined.filter((row) => row.cadence);
const strong = tested.filter((row) => ["matrix", "slice"].includes(row.cadence.winner));
const untested = joined.filter((row) => !row.cadence);

console.log("# Voxel Static Metrics\n");
console.log(`Models scanned: ${joined.length}`);
console.log(`Models with cadence: ${tested.length}`);
console.log(`Strong cadence winners: ${strong.length}\n`);

console.log("## Strong Winners Joined To Static Metrics\n");
console.log("| Model | Winner | Runs | Matrix p95 | Slice p95 | Active | Total | Source colors | Visible base | Visible shaded | Planes | AreaK | Fill | Dims |");
console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
for (const row of strong.sort((a, b) => Math.abs(b.cadence.deltaP95) - Math.abs(a.cadence.deltaP95))) {
  console.log([
    `| ${basename(row.file, ".vox")}`,
    row.cadence.winner,
    row.cadence.runs,
    fmt(row.cadence.matrixP95),
    fmt(row.cadence.sliceP95),
    row.activeBrushes,
    row.totalBrushes,
    row.sourceColors,
    row.visibleBaseColors,
    row.visibleShadedColors,
    row.visiblePlanes,
    row.activeAreaK,
    fmt(row.activePlaneFillRatio, 3),
    `${row.rows}x${row.cols}x${row.depth} |`,
  ].join(" | "));
}

const highShadedCutoff = 52;
const highShaded = tested.filter((row) => row.visibleShadedColors >= highShadedCutoff);
console.log(`\n## Diagnostic Rule: visibleShadedColors >= ${highShadedCutoff}\n`);
const highShadedGroups = new Map();
for (const row of highShaded) {
  const key = row.cadence.winner;
  highShadedGroups.set(key, (highShadedGroups.get(key) ?? 0) + 1);
}
const strongMatrixRows = tested.filter((row) => row.cadence.winner === "matrix");
const strongSliceRows = tested.filter((row) => row.cadence.winner === "slice");
const capturedMatrixRows = strongMatrixRows.filter((row) => row.visibleShadedColors >= highShadedCutoff);
const hitSliceRows = strongSliceRows.filter((row) => row.visibleShadedColors >= highShadedCutoff);
const adaptiveRows = tested.map((row) => {
  const useMatrix = row.visibleShadedColors >= highShadedCutoff;
  return {
    row,
    useMatrix,
    p95DeltaVsSlice: useMatrix ? row.cadence.matrixP95 - row.cadence.sliceP95 : 0,
    p99DeltaVsSlice: useMatrix ? row.cadence.sliceP99 - row.cadence.matrixP99 : 0,
  };
});
const p95Gains = adaptiveRows.filter((item) => item.p95DeltaVsSlice >= 8);
const p95Losses = adaptiveRows.filter((item) => item.p95DeltaVsSlice <= -8);
const p99Gains = adaptiveRows.filter((item) => item.p99DeltaVsSlice >= 5);
const p99Losses = adaptiveRows.filter((item) => item.p99DeltaVsSlice <= -5);
function scoreRule(predicate) {
  const rows = tested.map((row) => {
    const useMatrix = predicate(row);
    return {
      row,
      useMatrix,
      p95DeltaVsSlice: useMatrix ? row.cadence.matrixP95 - row.cadence.sliceP95 : 0,
      p99DeltaVsSlice: useMatrix ? row.cadence.sliceP99 - row.cadence.matrixP99 : 0,
    };
  });
  return {
    hits: rows.filter((item) => item.useMatrix),
    p95Gains: rows.filter((item) => item.p95DeltaVsSlice >= 8),
    p95Losses: rows.filter((item) => item.p95DeltaVsSlice <= -8),
    p99Gains: rows.filter((item) => item.p99DeltaVsSlice >= 5),
    p99Losses: rows.filter((item) => item.p99DeltaVsSlice <= -5),
  };
}
const refinedScore = scoreRule((row) =>
  row.visibleShadedColors >= highShadedCutoff && row.visiblePlanes < 200
);
console.log(`- Hits ${highShaded.length} tested models: ${
  [...highShadedGroups.entries()].map(([key, count]) => `${key}=${count}`).join(", ")
}`);
console.log(`- Captures ${capturedMatrixRows.length}/${strongMatrixRows.length} strong matrix wins: ${
  capturedMatrixRows.map((row) => basename(row.file, ".vox")).join(", ") || "none"
}`);
console.log(`- Hits ${hitSliceRows.length}/${strongSliceRows.length} strong slice wins: ${
  hitSliceRows.map((row) => basename(row.file, ".vox")).join(", ") || "none"
}`);
console.log(`- Adaptive p95 gains/losses vs always-slice: +${p95Gains.length}/-${p95Losses.length}`);
console.log(`- Adaptive p99 gains/losses vs always-slice: +${p99Gains.length}/-${p99Losses.length}${
  p99Losses.length ? ` (${p99Losses.map((item) => basename(item.row.file, ".vox")).join(", ")})` : ""
}`);
console.log(`- Refined visibleShadedColors >= ${highShadedCutoff} && visiblePlanes < 200: ` +
  `hits=${refinedScore.hits.length}, p95 +${refinedScore.p95Gains.length}/-${refinedScore.p95Losses.length}, ` +
  `p99 +${refinedScore.p99Gains.length}/-${refinedScore.p99Losses.length}\n`);
console.log("| Model | Winner | Runs | Visible shaded | Delta p95 | Matrix p95 | Slice p95 |");
console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: |");
for (const row of highShaded.sort((a, b) => b.visibleShadedColors - a.visibleShadedColors)) {
  console.log([
    `| ${basename(row.file, ".vox")}`,
    row.cadence.winner,
    row.cadence.runs,
    row.visibleShadedColors,
    fmt(row.cadence.deltaP95),
    fmt(row.cadence.matrixP95),
    fmt(row.cadence.sliceP95),
    "|",
  ].join(" | "));
}

const suggested = [
  ...untested
    .filter((row) => row.visibleShadedColors >= highShadedCutoff)
    .sort((a, b) => b.visibleShadedColors - a.visibleShadedColors || b.activeBrushes - a.activeBrushes)
    .slice(0, 8),
  ...untested
    .filter((row) => row.visibleShadedColors < highShadedCutoff)
    .sort((a, b) => b.activeBrushes - a.activeBrushes)
    .slice(0, 8),
  ...untested
    .filter((row) => row.visibleShadedColors < highShadedCutoff)
    .sort((a, b) => b.activePlaneFillRatio - a.activePlaneFillRatio)
    .slice(0, 8),
];
const dedupedSuggested = Array.from(new Map(suggested.map((row) => [row.key, row])).values());

console.log("\n## Suggested Bench Additions\n");
console.log("| Model | Reason | Active | Total | Source colors | Visible shaded | Planes | AreaK | Fill | Dims |");
console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
for (const row of dedupedSuggested.slice(0, 20)) {
  const reason = row.visibleShadedColors >= highShadedCutoff
    ? "high shaded colors"
    : row.activePlaneFillRatio >= 0.18
      ? "high plane fill"
      : "high active brushes";
  console.log([
    `| ${basename(row.file, ".vox")}`,
    reason,
    row.activeBrushes,
    row.totalBrushes,
    row.sourceColors,
    row.visibleShadedColors,
    row.visiblePlanes,
    row.activeAreaK,
    fmt(row.activePlaneFillRatio, 3),
    `${row.rows}x${row.cols}x${row.depth} |`,
  ].join(" | "));
}
