import type {
  PackedTextureAtlasEntry,
  Polygon,
  PolyTextureLightingMode,
  TextureAtlasPage,
} from "@layoutit/polycss-core";
import {
  applyAtlasBackground,
  createAtlasElement,
} from "../../packages/polycss/src/render/atlas/emit";

interface AtlasBackgroundBenchOptions {
  count?: number;
  repeats?: number;
  mode?: PolyTextureLightingMode;
  skipDynamicNormals?: boolean;
}

interface AtlasBackgroundBenchRow {
  repeat: number;
  count: number;
  applyMs: number;
  leafCount: number;
  inlineStyleChars: number;
}

interface AtlasBackgroundBenchSummary {
  applyMedianMs: number;
  applyP90Ms: number;
  leafCount: number;
  inlineStyleChars: number;
}

const DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8BQDwAFgwJ/l3S1WQAAAABJRU5ErkJggg==";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo] ?? 0;
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (pos - lo);
}

function summarize(rows: readonly AtlasBackgroundBenchRow[]): AtlasBackgroundBenchSummary {
  const applies = rows.map((row) => row.applyMs).sort((a, b) => a - b);
  const last = rows[rows.length - 1];
  return {
    applyMedianMs: Number(quantile(applies, 0.5).toFixed(3)),
    applyP90Ms: Number(quantile(applies, 0.9).toFixed(3)),
    leafCount: last?.leafCount ?? 0,
    inlineStyleChars: last?.inlineStyleChars ?? 0,
  };
}

function makeEntry(index: number): PackedTextureAtlasEntry {
  const side = Math.ceil(Math.sqrt(index + 1));
  const x = (index % side) * 16;
  const y = Math.floor(index / side) * 16;
  const polygon: Polygon = {
    vertices: [
      [x, y, 0],
      [x + 1, y, 0],
      [x + 1, y + 1, 0],
      [x, y + 1, 0],
    ],
    color: "#66cc88",
  };
  return {
    index,
    polygon,
    texture: null,
    x: (index % 64) * 16,
    y: Math.floor(index / 64) * 16,
    w: 16,
    h: 16,
    canvasW: 16,
    canvasH: 16,
    atlasMatrix: `1,0,0,0,0,1,0,0,0,0,1,0,${x},${y},0,1`,
    normal: [0, 0, 1],
  } as unknown as PackedTextureAtlasEntry;
}

function makePage(entries: readonly PackedTextureAtlasEntry[]): TextureAtlasPage {
  return {
    width: 1024,
    height: 1024,
    entries,
    url: DATA_URL,
  } as unknown as TextureAtlasPage;
}

function inlineStyleChars(root: ParentNode): number {
  let total = 0;
  for (const el of root.querySelectorAll("s")) {
    total += el.getAttribute("style")?.length ?? 0;
  }
  return total;
}

async function runOne(
  target: HTMLElement,
  entries: readonly PackedTextureAtlasEntry[],
  repeat: number,
  mode: PolyTextureLightingMode,
  skipDynamicNormals: boolean,
): Promise<AtlasBackgroundBenchRow> {
  target.replaceChildren();
  const wrapper = document.createElement("div");
  wrapper.className = "polycss-mesh";
  const fragment = document.createDocumentFragment();
  const elements: HTMLElement[] = [];
  for (const entry of entries) {
    const el = createAtlasElement(entry, mode, document, skipDynamicNormals);
    elements.push(el);
    fragment.appendChild(el);
  }
  wrapper.appendChild(fragment);
  target.appendChild(wrapper);
  await nextFrame();

  const page = makePage(entries);
  performance.mark("polycss-atlas-background-start");
  console.timeStamp("polycss-atlas-background-start");
  const t0 = performance.now();
  for (let i = 0; i < entries.length; i += 1) {
    applyAtlasBackground(elements[i]!, page, mode, entries[i]!, !skipDynamicNormals);
  }
  const t1 = performance.now();
  console.timeStamp("polycss-atlas-background-end");
  performance.mark("polycss-atlas-background-end");

  const row: AtlasBackgroundBenchRow = {
    repeat,
    count: entries.length,
    applyMs: Number((t1 - t0).toFixed(3)),
    leafCount: target.querySelectorAll("s").length,
    inlineStyleChars: inlineStyleChars(target),
  };
  target.replaceChildren();
  await nextFrame();
  return row;
}

export async function runPolycssAtlasBackgroundBench(input: AtlasBackgroundBenchOptions = {}): Promise<{
  options: Required<AtlasBackgroundBenchOptions>;
  rows: AtlasBackgroundBenchRow[];
  summary: AtlasBackgroundBenchSummary;
}> {
  const options = {
    count: Math.max(1, Math.floor(input.count ?? 10000)),
    repeats: Math.max(1, Math.floor(input.repeats ?? 5)),
    mode: input.mode ?? "baked",
    skipDynamicNormals: input.skipDynamicNormals ?? false,
  };
  const target = document.getElementById("bench-target") ?? document.body.appendChild(document.createElement("div"));
  target.id = "bench-target";
  const entries = Array.from({ length: options.count }, (_unused, index) => makeEntry(index));
  const rows: AtlasBackgroundBenchRow[] = [];
  for (let repeat = 0; repeat < options.repeats; repeat += 1) {
    rows.push(await runOne(target, entries, repeat, options.mode, options.skipDynamicNormals));
  }
  return {
    options,
    rows,
    summary: summarize(rows),
  };
}

(window as unknown as {
  runPolycssAtlasBackgroundBench: typeof runPolycssAtlasBackgroundBench;
}).runPolycssAtlasBackgroundBench = runPolycssAtlasBackgroundBench;
