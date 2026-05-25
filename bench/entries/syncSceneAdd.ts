import {
  createPolyOrthographicCamera,
  createPolyScene,
  type ParseResult,
  type Polygon,
  type PolyTextureLightingMode,
} from "@layoutit/polycss";

interface SyncSceneAddBenchOptions {
  count?: number;
  repeats?: number;
  mode?: PolyTextureLightingMode;
  palette?: "same" | "unique";
  shape?: "quad" | "triangle";
  disableStrategies?: Array<"b" | "i" | "u">;
}

interface SyncSceneAddBenchRow {
  repeat: number;
  count: number;
  addMs: number;
  leafCount: number;
  mounted: boolean;
}

interface SyncSceneAddBenchSummary {
  addMedianMs: number;
  addP90Ms: number;
  leafCount: number;
}

function solidGrid(count: number, palette: "same" | "unique", shape: "quad" | "triangle"): Polygon[] {
  const side = Math.ceil(Math.sqrt(count));
  const polygons: Polygon[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = i % side;
    const y = Math.floor(i / side);
    const color = palette === "same"
      ? "#66cc88"
      : `#${((i * 2654435761) & 0xffffff).toString(16).padStart(6, "0")}`;
    const vertices: Polygon["vertices"] = shape === "triangle"
      ? [
          [x, y, 0],
          [x + 0.88, y, 0],
          [x, y + 0.88, 0],
        ]
      : [
          [x, y, 0],
          [x + 0.88, y, 0],
          [x + 0.88, y + 0.88, 0],
          [x, y + 0.88, 0],
        ];
    polygons.push({ vertices, color });
  }
  return polygons;
}

function makeParseResult(polygons: Polygon[]): ParseResult {
  return {
    polygons,
    objectUrls: [],
    warnings: [],
    dispose: () => {},
  };
}

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

function summarize(rows: readonly SyncSceneAddBenchRow[]): SyncSceneAddBenchSummary {
  const adds = rows.map((row) => row.addMs).sort((a, b) => a - b);
  return {
    addMedianMs: Number(quantile(adds, 0.5).toFixed(3)),
    addP90Ms: Number(quantile(adds, 0.9).toFixed(3)),
    leafCount: rows[rows.length - 1]?.leafCount ?? 0,
  };
}

async function runOne(
  target: HTMLElement,
  polygons: Polygon[],
  repeat: number,
  mode: PolyTextureLightingMode,
  disableStrategies: Array<"b" | "i" | "u">,
): Promise<SyncSceneAddBenchRow> {
  target.replaceChildren();
  const scene = createPolyScene(target, {
    camera: createPolyOrthographicCamera({ rotX: 65, rotY: 45, zoom: 1 }),
    textureLighting: mode,
    strategies: { disable: disableStrategies },
  });
  await nextFrame();

  performance.mark("polycss-sync-scene-add-start");
  console.timeStamp("polycss-sync-scene-add-start");
  const t0 = performance.now();
  const handle = scene.add(makeParseResult(polygons), {
    merge: false,
    excludeFromAutoCenter: true,
  });
  const t1 = performance.now();
  console.timeStamp("polycss-sync-scene-add-end");
  performance.mark("polycss-sync-scene-add-end");

  const leafCount = target.querySelectorAll(".polycss-mesh > b, .polycss-mesh > i, .polycss-mesh > s, .polycss-mesh > u").length;
  const row: SyncSceneAddBenchRow = {
    repeat,
    count: polygons.length,
    addMs: Number((t1 - t0).toFixed(3)),
    leafCount,
    mounted: leafCount === polygons.length,
  };

  handle.dispose();
  scene.destroy();
  target.replaceChildren();
  await nextFrame();
  return row;
}

export async function runPolycssSyncSceneAddBench(input: SyncSceneAddBenchOptions = {}): Promise<{
  options: Required<SyncSceneAddBenchOptions>;
  rows: SyncSceneAddBenchRow[];
  summary: SyncSceneAddBenchSummary;
}> {
  const options = {
    count: Math.max(1, Math.floor(input.count ?? 10000)),
    repeats: Math.max(1, Math.floor(input.repeats ?? 5)),
    mode: input.mode ?? "baked",
    palette: input.palette ?? "same",
    shape: input.shape ?? "quad",
    disableStrategies: input.disableStrategies ?? ["i", "u"],
  };
  const target = document.getElementById("bench-target") ?? document.body.appendChild(document.createElement("div"));
  target.id = "bench-target";
  const polygons = solidGrid(options.count, options.palette, options.shape);
  const rows: SyncSceneAddBenchRow[] = [];

  for (let repeat = 0; repeat < options.repeats; repeat += 1) {
    rows.push(await runOne(target, polygons, repeat, options.mode, options.disableStrategies));
  }

  return {
    options,
    rows,
    summary: summarize(rows),
  };
}

(window as unknown as {
  runPolycssSyncSceneAddBench: typeof runPolycssSyncSceneAddBench;
}).runPolycssSyncSceneAddBench = runPolycssSyncSceneAddBench;
