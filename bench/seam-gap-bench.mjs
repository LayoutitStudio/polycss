#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transform } from "esbuild";
import {
  optimizeMeshPolygons,
  parseGltf,
  parseMtl,
  parseObj,
} from "../packages/core/dist/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromWebsite = createRequire(resolve(repoRoot, "website/package.json"));
const DEFAULT_AMOUNT_PX = 2;
const DEFAULT_LIMIT = 6;
const DEFAULT_RENDER_URL = "http://localhost:4322/gallery/";
const BASE_TILE = 50;

const FIXTURES = [
  {
    id: "chicken",
    label: "Chicken",
    kind: "obj",
    file: "website/public/gallery/obj/chicken.obj",
    mtl: "website/public/gallery/obj/chicken.mtl",
    options: { targetSize: 60, gridShift: 1, defaultColor: "#cccccc" },
  },
  {
    id: "bear",
    label: "Bear",
    kind: "glb",
    file: "website/public/gallery/glb/Bear.glb",
    options: { targetSize: 60, gridShift: 1, defaultColor: "#8b95a1" },
  },
  {
    id: "cheetah",
    label: "Cheetah",
    kind: "glb",
    file: "website/public/gallery/glb/Cheetah.glb",
    options: { targetSize: 60, gridShift: 1, defaultColor: "#8b95a1" },
  },
  {
    id: "apple",
    label: "Apple",
    kind: "glb",
    file: "website/public/gallery/glb/apple.glb",
    options: { targetSize: 60, gridShift: 1, defaultColor: "#8b95a1" },
  },
  {
    id: "atm",
    label: "ATM",
    kind: "glb",
    file: "website/public/gallery/glb/urban/ATM.glb",
    options: { targetSize: 60, gridShift: 1, defaultColor: "#8b95a1" },
  },
  {
    id: "dog",
    label: "Dog",
    kind: "glb",
    file: "website/public/gallery/glb/Dog.glb",
    options: { targetSize: 60, gridShift: 1, defaultColor: "#8b95a1" },
  },
  {
    id: "bags",
    label: "Bags",
    kind: "glb",
    file: "website/public/gallery/glb/medieval/Bags.glb",
    options: { targetSize: 60, gridShift: 1, defaultColor: "#8b95a1" },
  },
];

const EXPECTED = {
  chicken: { beforeTrueGaps: 2, afterTrueGaps: 0, changedPolygons: 4 },
  bear: { beforeTrueGaps: 0, afterTrueGaps: 0, changedPolygons: 0 },
  cheetah: { beforeTrueGaps: 0, afterTrueGaps: 0, changedPolygons: 0 },
};

function parseArgs(argv) {
  const args = {
    amountPx: DEFAULT_AMOUNT_PX,
    limit: DEFAULT_LIMIT,
    models: null,
    json: "",
    assert: true,
    render: false,
    renderSplit: false,
    renderUrl: DEFAULT_RENDER_URL,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--amount") args.amountPx = Number(argv[++i]);
    else if (arg.startsWith("--amount=")) args.amountPx = Number(arg.slice("--amount=".length));
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--models") args.models = splitList(argv[++i]);
    else if (arg.startsWith("--models=")) args.models = splitList(arg.slice("--models=".length));
    else if (arg === "--json") args.json = argv[++i] ?? "";
    else if (arg.startsWith("--json=")) args.json = arg.slice("--json=".length);
    else if (arg === "--render") args.render = true;
    else if (arg === "--render-split") args.renderSplit = true;
    else if (arg === "--render-url") args.renderUrl = argv[++i] ?? DEFAULT_RENDER_URL;
    else if (arg.startsWith("--render-url=")) args.renderUrl = arg.slice("--render-url=".length);
    else if (arg === "--no-assert") args.assert = false;
    else throw new Error(`Unknown option ${arg}`);
  }

  if (!Number.isFinite(args.amountPx) || args.amountPx < 0) {
    throw new Error("--amount must be a non-negative number");
  }
  args.limit = Number.isFinite(args.limit) ? Math.max(0, Math.floor(args.limit)) : DEFAULT_LIMIT;
  return args;
}

function splitList(value = "") {
  return value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function printHelp() {
  console.log(`Usage: node bench/seam-gap-bench.mjs [--models chicken,cheetah,bear] [--json file]

Measures object-space seam gap candidates before and after the current seam
repair helper. It separates real disconnected same-material gaps from connected
facet edges and material-boundary false positives.

Options:
  --amount <px>     Repair request in CSS px. Default: ${DEFAULT_AMOUNT_PX}
  --models <list>   Comma-separated fixture ids/labels. Default: chicken,bear,cheetah
  --limit <n>       Candidate rows to print per model. Default: ${DEFAULT_LIMIT}
  --json <file>     Write full machine-readable rows.
  --render          Also measure rendered exact-edge cracks in a browser.
  --render-split    Alias for --render; the gallery now always uses the default seam path.
  --render-url <u>  Gallery URL for --render. Default: ${DEFAULT_RENDER_URL}
  --no-assert       Do not fail when fixture expectations drift.
`);
}

function readBytes(path) {
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function loadSeamHelper() {
  const sourcePath = resolve(repoRoot, "packages/core/src/merge/seamRepair.ts");
  const source = readFileSync(sourcePath, "utf8");
  const { code } = await transform(source, {
    loader: "ts",
    format: "esm",
    target: "node22",
  });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

function selectedFixtures(models) {
  if (!models?.length) return FIXTURES;
  return FIXTURES.filter((fixture) => {
    const haystack = `${fixture.id} ${fixture.label}`.toLowerCase();
    return models.some((needle) => haystack.includes(needle));
  });
}

function loadFixture(fixture) {
  const file = resolve(repoRoot, fixture.file);
  if (fixture.kind === "obj") {
    const objText = readFileSync(file, "utf8");
    const mtl = fixture.mtl
      ? parseMtl(readFileSync(resolve(repoRoot, fixture.mtl), "utf8"))
      : { colors: {}, textures: {} };
    return parseObj(objText, {
      ...fixture.options,
      materialColors: mtl.colors,
    }).polygons;
  }

  return parseGltf(readBytes(file), {
    ...fixture.options,
    baseUrl: pathToFileURL(file).href,
  }).polygons;
}

function cssPoint(vertex) {
  return [vertex[1] * BASE_TILE, vertex[0] * BASE_TILE, vertex[2] * BASE_TILE];
}

function pointKey(point) {
  return `${point[0]},${point[1]},${point[2]}`;
}

function edgeKey(a, b) {
  const ak = pointKey(a);
  const bk = pointKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function materialKey(polygon) {
  return polygon.material?.key ?? polygon.color ?? "";
}

function hasTexture(polygon) {
  return !!(polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length);
}

function exactSharedSameMaterialEdges(polygons) {
  const ownersByKey = new Map();
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex += 1) {
    const polygon = polygons[polygonIndex];
    if (hasTexture(polygon)) continue;
    const points = polygon.vertices.map(cssPoint);
    for (let edgeIndex = 0; edgeIndex < points.length; edgeIndex += 1) {
      const a = points[edgeIndex];
      const b = points[(edgeIndex + 1) % points.length];
      const key = edgeKey(a, b);
      const owners = ownersByKey.get(key);
      const owner = {
        polygon: polygonIndex,
        edge: edgeIndex,
        color: polygon.color,
        materialKey: materialKey(polygon),
        a,
        b,
      };
      if (owners) owners.push(owner);
      else ownersByKey.set(key, [owner]);
    }
  }

  const edges = [];
  for (const owners of ownersByKey.values()) {
    if (owners.length !== 2) continue;
    const [a, b] = owners;
    if (a.materialKey !== b.materialKey || a.color !== b.color) continue;
    edges.push({
      aPolygon: a.polygon,
      aEdge: a.edge,
      bPolygon: b.polygon,
      bEdge: b.edge,
      color: a.color,
      materialKey: a.materialKey,
      p0: a.a,
      p1: a.b,
    });
  }
  return edges;
}

function edgePairPlanKey(aPolygon, aEdge, bPolygon, bEdge) {
  const a = `${aPolygon}:${aEdge}`;
  const b = `${bPolygon}:${bEdge}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function splitPlanLookup(report) {
  const out = new Map();
  for (const candidate of report?.candidates ?? []) {
    out.set(
      edgePairPlanKey(candidate.aPolygon, candidate.aEdge, candidate.bPolygon, candidate.bEdge),
      candidate,
    );
  }
  return out;
}

function countChangedPolygons(before, after) {
  let changed = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] !== after[i]) changed += 1;
  }
  return changed;
}

function vertexDelta(before, after) {
  let added = 0;
  let removed = 0;
  for (let i = 0; i < before.length; i += 1) {
    const delta = (after[i]?.vertices.length ?? 0) - before[i].vertices.length;
    if (delta > 0) added += delta;
    else removed -= delta;
  }
  return { added, removed };
}

function candidatesByKind(report, kind) {
  return report.candidates.filter((candidate) => candidate.kind === kind);
}

function summarizeReport(report) {
  const trueGaps = candidatesByKind(report, "true-gap");
  const connectedFacets = candidatesByKind(report, "connected-facet");
  const materialBoundaries = candidatesByKind(report, "material-boundary");
  return {
    exactPairs: report.diagnostics.exactPairs,
    trueGapPairs: trueGaps.length,
    connectedFacetPairs: connectedFacets.length,
    materialBoundaryPairs: materialBoundaries.length,
    maxTrueGapPx: maxOf(trueGaps, "gapPx"),
    maxResidualGapPx: maxOf(trueGaps, "residualGapPx"),
    maxAppliedClosurePx: maxOf(trueGaps, "appliedClosurePx"),
    trueGapSpanPx: sumOf(trueGaps, "spanPx"),
  };
}

function maxOf(items, key) {
  return items.reduce((max, item) => Math.max(max, item[key] ?? 0), 0);
}

function sumOf(items, key) {
  return items.reduce((sum, item) => sum + (item[key] ?? 0), 0);
}

function analyzeFixture(fixture, seam, amountPx, limit) {
  const raw = loadFixture(fixture);
  const optimized = optimizeMeshPolygons(raw, { meshResolution: "lossless" });
  const baselineReport = seam.seamOverlapReport(optimized, amountPx);
  const repaired = seam.repairMeshSeams
    ? seam.repairMeshSeams(optimized)
    : seam.seamOverlapPolygons(seam.seamFacetSplitPolygons(optimized, amountPx), amountPx);
  const repairedReport = seam.seamOverlapReport(repaired, amountPx);
  const changedPolygons = countChangedPolygons(optimized, repaired);
  const vertices = vertexDelta(optimized, repaired);

  const baseline = summarizeReport(baselineReport);
  const after = summarizeReport(repairedReport);
  return {
    id: fixture.id,
    label: fixture.label,
    file: relative(repoRoot, resolve(repoRoot, fixture.file)),
    sourcePolygons: raw.length,
    polygons: optimized.length,
    changedPolygons,
    vertexDelta: vertices,
    baseline,
    after,
    topTrueGaps: topCandidates(candidatesByKind(baselineReport, "true-gap"), limit),
    topConnectedFacets: topCandidates(candidatesByKind(baselineReport, "connected-facet"), limit),
    topMaterialBoundaries: topCandidates(candidatesByKind(baselineReport, "material-boundary"), limit),
  };
}

function topCandidates(candidates, limit) {
  return [...candidates]
    .sort((a, b) => b.gapPx - a.gapPx || b.spanPx - a.spanPx)
    .slice(0, limit)
    .map((candidate) => ({
      kind: candidate.kind,
      gapPx: round(candidate.gapPx),
      spanPx: round(candidate.spanPx),
      appliedClosurePx: round(candidate.appliedClosurePx),
      residualGapPx: round(candidate.residualGapPx),
      a: `${candidate.aPolygon}:${candidate.aEdge}`,
      b: `${candidate.bPolygon}:${candidate.bEdge}`,
      colors: candidate.aColor === candidate.bColor
        ? candidate.aColor ?? ""
        : `${candidate.aColor ?? ""}/${candidate.bColor ?? ""}`,
    }));
}

function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function fmt(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.00";
}

function printReport(rows, amountPx, limit, failures) {
  console.log("# Seam Gap Bench\n");
  console.log(`Repair amount: ${fmt(amountPx, 2)} CSS px`);
  console.log("Coordinates are measured in the same CSS-space units the renderer uses for polygon plans.\n");
  console.log("| Model | Polys | Exact shared | True gaps before -> after | Max true gap px | Rejects connected/material | Changed polys | Added verts |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of rows) {
    console.log([
      `| ${row.label}`,
      row.polygons,
      row.baseline.exactPairs,
      `${row.baseline.trueGapPairs} -> ${row.after.trueGapPairs}`,
      `${fmt(row.baseline.maxTrueGapPx)} -> ${fmt(row.after.maxTrueGapPx)}`,
      `${row.baseline.connectedFacetPairs}/${row.baseline.materialBoundaryPairs}`,
      row.changedPolygons,
      `${row.vertexDelta.added} |`,
    ].join(" | "));
  }

  for (const row of rows) {
    console.log(`\n## ${row.label}`);
    printCandidateSection("True gaps", row.topTrueGaps, limit);
    printCandidateSection("Connected facet rejects", row.topConnectedFacets, limit);
    printCandidateSection("Material-boundary rejects", row.topMaterialBoundaries, limit);
  }

  if (failures.length > 0) {
    console.log("\n## Assertion Failures");
    for (const failure of failures) console.log(`- ${failure}`);
  }
}

function printCandidateSection(title, candidates, limit) {
  if (limit === 0) return;
  console.log(`\n${title}:`);
  if (candidates.length === 0) {
    console.log("- none");
    return;
  }
  for (const candidate of candidates) {
    console.log(
      `- ${candidate.a} <-> ${candidate.b} gap=${fmt(candidate.gapPx)}px span=${fmt(candidate.spanPx)}px ` +
      `applied=${fmt(candidate.appliedClosurePx)}px residual=${fmt(candidate.residualGapPx)}px color=${candidate.colors}`,
    );
  }
}

async function runRenderBench(fixtures, seam, amountPx, renderUrl, limit, mode = "bleed") {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const rows = [];
    for (const fixture of fixtures) {
      rows.push(await measureRenderedFixture(browser, fixture, seam, amountPx, renderUrl, limit, mode));
    }
    return rows;
  } finally {
    await browser.close();
  }
}

async function measureRenderedFixture(browser, fixture, seam, amountPx, renderUrl, limit, mode) {
  const raw = loadFixture(fixture);
  const optimized = optimizeMeshPolygons(raw, { meshResolution: "lossless" });
  const repaired = optimizeMeshPolygons(raw, { meshResolution: "lossy" });
  const splitPlan = seam.seamFacetSplitReport
    ? splitPlanLookup(seam.seamFacetSplitReport(optimized, amountPx))
    : undefined;
  const page = await browser.newPage({ viewport: { width: 768, height: 768 }, deviceScaleFactor: 1 });
  try {
    await openGalleryModel(page, renderUrl, fixture.label);
    const rendered = await measureRenderedState(page, repaired, limit, splitPlan);
    return {
      id: fixture.id,
      label: fixture.label,
      mode: "default",
      rendered,
    };
  } finally {
    await page.close();
  }
}

async function openGalleryModel(page, renderUrl, label) {
  await page.goto(renderUrl, { waitUntil: "load" });
  await page.waitForTimeout(1800);
  await page.getByPlaceholder("Search models").fill(label);
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.waitForTimeout(1800);
}

async function measureRenderedState(page, polygons, limit, splitPlan) {
  await page.waitForTimeout(1200);
  const edges = exactSharedSameMaterialEdges(polygons);
  const tags = await renderedLeafTags(page);
  const screenEdges = await projectEdges(page, edges, tags);
  const screenshot = await page.screenshot({ fullPage: false });
  const image = await decodeScreenshot(screenshot);
  return {
    ...measureScreenEdges(screenEdges, image, limit, splitPlan),
  };
}

async function renderedLeafTags(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".polycss-scene b,.polycss-scene i,.polycss-scene u,.polycss-scene s")]
      .map((el) => el.tagName.toLowerCase())
  );
}

async function projectEdges(page, edges, tags) {
  const pointIndex = new Map();
  const points = [];
  const indexFor = (point) => {
    const key = pointKey(point);
    const current = pointIndex.get(key);
    if (current !== undefined) return current;
    const next = points.length;
    pointIndex.set(key, next);
    points.push(point);
    return next;
  };
  const edgeRefs = edges.map((edge) => ({
    edge,
    p0: indexFor(edge.p0),
    p1: indexFor(edge.p1),
  }));

  const projected = await page.evaluate((pts) => {
    const host = document.querySelector(".polycss-mesh.dn-model-mesh") ??
      document.querySelector(".polycss-scene");
    if (!host) throw new Error("No rendered mesh host found");

    const markers = pts.map((point) => {
      const marker = document.createElement("em");
      marker.style.position = "absolute";
      marker.style.left = "0";
      marker.style.top = "0";
      marker.style.width = "1px";
      marker.style.height = "1px";
      marker.style.transformOrigin = "0 0";
      marker.style.transformStyle = "preserve-3d";
      marker.style.pointerEvents = "none";
      marker.style.background = "transparent";
      marker.style.transform = `translate3d(${point[0]}px,${point[1]}px,${point[2]}px)`;
      host.appendChild(marker);
      return marker;
    });

    const out = markers.map((marker) => {
      const rect = marker.getBoundingClientRect();
      marker.remove();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    });
    return out;
  }, points);

  return edgeRefs.map(({ edge, p0, p1 }) => ({
    ...edge,
    tagA: tags[edge.aPolygon] ?? "?",
    tagB: tags[edge.bPolygon] ?? "?",
    s0: projected[p0],
    s1: projected[p1],
  }));
}

async function decodeScreenshot(buffer) {
  const sharp = requireFromWebsite("sharp");
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function measureScreenEdges(edges, image, limit, splitPlan) {
  const measured = [];
  const selectedClean = [];
  let visibleEdges = 0;
  let crackedEdges = 0;
  let crackSamples = 0;
  let visibleSamples = 0;
  let maxRunPx = 0;
  let selectedVisibleEdges = 0;
  let selectedCrackedEdges = 0;
  let selectedCleanEdges = 0;
  let selectedCrackSamples = 0;
  let selectedVisibleSamples = 0;
  const crackedTagPairs = new Map();

  for (const edge of edges) {
    const result = measureScreenEdge(edge, image);
    if (result.visibleSamples === 0) continue;
    const plan = splitPlan?.get(edgePairPlanKey(edge.aPolygon, edge.aEdge, edge.bPolygon, edge.bEdge));
    visibleEdges += 1;
    visibleSamples += result.visibleSamples;
    crackSamples += result.crackSamples;
    maxRunPx = Math.max(maxRunPx, result.maxRunPx);
    if (plan?.selected) {
      selectedVisibleEdges += 1;
      selectedVisibleSamples += result.visibleSamples;
      selectedCrackSamples += result.crackSamples;
      if (result.crackSamples > 0) selectedCrackedEdges += 1;
      else {
        selectedCleanEdges += 1;
        selectedClean.push({ ...edge, ...result, splitPlan: plan });
      }
    }
    if (result.crackSamples > 0) {
      crackedEdges += 1;
      const tagPair = [edge.tagA, edge.tagB].sort().join("/");
      const group = crackedTagPairs.get(tagPair) ?? { edges: 0, crackSamples: 0 };
      group.edges += 1;
      group.crackSamples += result.crackSamples;
      crackedTagPairs.set(tagPair, group);
      measured.push({ ...edge, ...result, splitPlan: plan });
    }
  }

  measured.sort((a, b) => b.crackSamples - a.crackSamples || b.maxRunPx - a.maxRunPx);
  selectedClean.sort((a, b) => (b.splitPlan?.score ?? 0) - (a.splitPlan?.score ?? 0));
  return {
    exactSameMaterialEdges: edges.length,
    visibleEdges,
    crackedEdges,
    crackSamples,
    visibleSamples,
    crackRatio: visibleSamples > 0 ? crackSamples / visibleSamples : 0,
    maxRunPx,
    crackedTagPairs: [...crackedTagPairs.entries()]
      .map(([tagPair, group]) => ({ tagPair, ...group }))
      .sort((a, b) => b.crackSamples - a.crackSamples || b.edges - a.edges),
    selectedPlan: {
      visibleEdges: selectedVisibleEdges,
      crackedEdges: selectedCrackedEdges,
      cleanEdges: selectedCleanEdges,
      crackSamples: selectedCrackSamples,
      visibleSamples: selectedVisibleSamples,
      crackRatio: round(selectedVisibleSamples > 0 ? selectedCrackSamples / selectedVisibleSamples : 0, 4),
    },
    topCracks: measured.slice(0, limit).map((edge) => ({
      a: `${edge.aPolygon}:${edge.aEdge}`,
      b: `${edge.bPolygon}:${edge.bEdge}`,
      tags: [edge.tagA, edge.tagB].join("/"),
      color: edge.color ?? "",
      lengthPx: round(edge.lengthPx),
      crackSamples: edge.crackSamples,
      visibleSamples: edge.visibleSamples,
      crackRatio: round(edge.visibleSamples > 0 ? edge.crackSamples / edge.visibleSamples : 0, 4),
      maxRunPx: edge.maxRunPx,
      splitPlan: edge.splitPlan
        ? {
            selected: edge.splitPlan.selected,
            reason: edge.splitPlan.reason,
            component: edge.splitPlan.component,
            cost: edge.splitPlan.marginalCost,
            score: round(edge.splitPlan.score),
          }
        : undefined,
    })),
    topSelectedClean: selectedClean.slice(0, limit).map((edge) => ({
      a: `${edge.aPolygon}:${edge.aEdge}`,
      b: `${edge.bPolygon}:${edge.bEdge}`,
      tags: [edge.tagA, edge.tagB].join("/"),
      color: edge.color ?? "",
      lengthPx: round(edge.lengthPx),
      visibleSamples: edge.visibleSamples,
      splitPlan: edge.splitPlan
        ? {
            reason: edge.splitPlan.reason,
            component: edge.splitPlan.component,
            cost: edge.splitPlan.marginalCost,
            score: round(edge.splitPlan.score),
          }
        : undefined,
    })),
  };
}

function measureScreenEdge(edge, image) {
  const dx = edge.s1.x - edge.s0.x;
  const dy = edge.s1.y - edge.s0.y;
  const lengthPx = Math.hypot(dx, dy);
  if (lengthPx < 6) {
    return { lengthPx, visibleSamples: 0, crackSamples: 0, maxRunPx: 0 };
  }

  const nx = -dy / lengthPx;
  const ny = dx / lengthPx;
  let visibleSamples = 0;
  let crackSamples = 0;
  let currentRun = 0;
  let maxRunPx = 0;
  const start = 2;
  const end = Math.max(start, lengthPx - 2);

  for (let distance = start; distance <= end; distance += 1) {
    const x = edge.s0.x + (dx * distance) / lengthPx;
    const y = edge.s0.y + (dy * distance) / lengthPx;
    const samples = [-3, -2, -1, 0, 1, 2, 3].map((offset) =>
      samplePixel(image, x + nx * offset, y + ny * offset)
    );
    if (samples.some((sample) => sample === null)) {
      currentRun = 0;
      continue;
    }

    const sideA = isFilled(samples[0]) || isFilled(samples[1]);
    const sideB = isFilled(samples[5]) || isFilled(samples[6]);
    if (!sideA || !sideB) {
      currentRun = 0;
      continue;
    }

    visibleSamples += 1;
    const darkCenter = isBlack(samples[2]) || isBlack(samples[3]) || isBlack(samples[4]);
    if (darkCenter) {
      crackSamples += 1;
      currentRun += 1;
      maxRunPx = Math.max(maxRunPx, currentRun);
    } else {
      currentRun = 0;
    }
  }

  return { lengthPx, visibleSamples, crackSamples, maxRunPx };
}

function samplePixel(image, x, y) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return null;
  const i = (py * image.width + px) * image.channels;
  return {
    r: image.data[i],
    g: image.data[i + 1],
    b: image.data[i + 2],
    a: image.data[i + 3],
  };
}

function isBlack(pixel) {
  return pixel.a > 240 && pixel.r < 34 && pixel.g < 34 && pixel.b < 34;
}

function isFilled(pixel) {
  return pixel.a > 240 && Math.max(pixel.r, pixel.g, pixel.b) > 55 && !isBlack(pixel);
}

function printRenderReport(rows) {
  console.log("\n# Rendered Seam Pixel Bench (Default Seam Path)\n");
  console.log("This samples exact shared same-material edges after browser projection; a crack sample is a black center pixel with filled pixels on both sides.\n");
  console.log("| Model | Exact edges | Visible edges | Cracked edges | Crack samples | Max run |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const row of rows) {
    const rendered = row.rendered;
    console.log([
      `| ${row.label}`,
      rendered.exactSameMaterialEdges,
      rendered.visibleEdges,
      rendered.crackedEdges,
      rendered.crackSamples,
      `${rendered.maxRunPx} |`,
    ].join(" | "));
  }

  for (const row of rows) {
    const rendered = row.rendered;
    console.log(`\n## ${row.label} Rendered Cracks`);
    printTagPairSection("Strategy pairs", rendered.crackedTagPairs);
    printSelectedPlanSection("Selected split plan", rendered.selectedPlan);
    printRenderedCrackSection("Cracks", rendered.topCracks);
    printSelectedCleanSection("Selected clean", rendered.topSelectedClean);
  }
}

function printTagPairSection(title, pairs) {
  console.log(`\n${title}:`);
  if (pairs.length === 0) {
    console.log("- none");
    return;
  }
  for (const pair of pairs.slice(0, 8)) {
    console.log(`- ${pair.tagPair}: edges=${pair.edges} samples=${pair.crackSamples}`);
  }
}

function printRenderedCrackSection(title, cracks) {
  console.log(`\n${title}:`);
  if (cracks.length === 0) {
    console.log("- none");
    return;
  }
  for (const crack of cracks) {
    const plan = crack.splitPlan
      ? ` plan=${crack.splitPlan.selected ? "selected" : "skipped"}/${crack.splitPlan.reason}` +
        ` c=${crack.splitPlan.component} cost=${crack.splitPlan.cost} score=${fmt(crack.splitPlan.score)}`
      : "";
    console.log(
      `- ${crack.a} <-> ${crack.b} crack=${crack.crackSamples}/${crack.visibleSamples} ` +
      `run=${crack.maxRunPx}px len=${fmt(crack.lengthPx)}px tags=${crack.tags} color=${crack.color}${plan}`,
    );
  }
}

function printSelectedPlanSection(title, plan) {
  if (!plan || plan.visibleEdges === 0) return;
  console.log(`\n${title}:`);
  console.log(
    `- visible=${plan.visibleEdges} cracked=${plan.crackedEdges} clean=${plan.cleanEdges} ` +
    `samples=${plan.crackSamples}/${plan.visibleSamples} ratio=${fmt(plan.crackRatio)}`,
  );
}

function printSelectedCleanSection(title, cracks) {
  if (!cracks?.length) return;
  console.log(`\n${title}:`);
  for (const crack of cracks) {
    const plan = crack.splitPlan
      ? ` plan=${crack.splitPlan.reason} c=${crack.splitPlan.component} cost=${crack.splitPlan.cost} score=${fmt(crack.splitPlan.score)}`
      : "";
    console.log(
      `- ${crack.a} <-> ${crack.b} visible=${crack.visibleSamples} ` +
      `len=${fmt(crack.lengthPx)}px tags=${crack.tags} color=${crack.color}${plan}`,
    );
  }
}

function assertionFailures(rows) {
  const failures = [];
  for (const row of rows) {
    const expected = EXPECTED[row.id];
    if (!expected) continue;
    if (row.baseline.trueGapPairs !== expected.beforeTrueGaps) {
      failures.push(`${row.label}: expected ${expected.beforeTrueGaps} baseline true gaps, got ${row.baseline.trueGapPairs}`);
    }
    if (row.after.trueGapPairs !== expected.afterTrueGaps) {
      failures.push(`${row.label}: expected ${expected.afterTrueGaps} post-repair true gaps, got ${row.after.trueGapPairs}`);
    }
    if (row.changedPolygons !== expected.changedPolygons) {
      failures.push(`${row.label}: expected ${expected.changedPolygons} changed polygons, got ${row.changedPolygons}`);
    }
  }
  return failures;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const fixtures = selectedFixtures(args.models);
if (fixtures.length === 0) {
  throw new Error("No seam fixtures matched --models");
}

const seam = await loadSeamHelper();
const rows = fixtures.map((fixture) => analyzeFixture(fixture, seam, args.amountPx, args.limit));
const failures = args.assert ? assertionFailures(rows) : [];
printReport(rows, args.amountPx, args.limit, failures);
const renderRows = args.render
  ? await runRenderBench(fixtures, seam, args.amountPx, args.renderUrl, args.limit, "bleed")
  : args.renderSplit
    ? await runRenderBench(fixtures, seam, args.amountPx, args.renderUrl, args.limit, "split")
  : [];
if (args.render || args.renderSplit) printRenderReport(renderRows);

if (args.json) {
  const path = resolve(repoRoot, args.json);
  writeFileSync(path, `${JSON.stringify({ amountPx: args.amountPx, rows, renderRows }, null, 2)}\n`);
  console.log(`\nWrote ${relative(repoRoot, path)}`);
}

if (failures.length > 0) process.exitCode = 1;
