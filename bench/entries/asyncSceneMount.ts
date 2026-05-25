import {
  createPolyOrthographicCamera,
  createPolyScene,
  injectPolyBaseStyles,
  renderPolygonsWithTextureAtlasAsync,
  type ParseResult,
  type Polygon,
  type PolyMeshHandle,
  type RenderedPoly,
  type PolyTextureLightingMode,
} from "@layoutit/polycss";

type AsyncSceneMountStrategy =
  | "scene-production"
  | "manual-fragment"
  | "manual-append";

const DEFAULT_STRATEGIES: AsyncSceneMountStrategy[] = [
  "scene-production",
  "manual-fragment",
  "manual-append",
];

interface ChunkedMeshHandle extends PolyMeshHandle {
  setPolygonsChunked(polygons: Polygon[], options?: {
    merge?: boolean;
    stableDom?: boolean;
    recomputeAutoCenter?: boolean;
  }): Promise<void>;
}

interface AsyncSceneMountBenchOptions {
  count?: number;
  repeats?: number;
  chunkSize?: number;
  mode?: PolyTextureLightingMode;
  shape?: "quad" | "triangle";
  replaceExisting?: boolean;
  strategies?: AsyncSceneMountStrategy[];
  disableStrategies?: Array<"b" | "i" | "u">;
}

interface AsyncSceneMountBenchRow {
  strategy: AsyncSceneMountStrategy;
  repeat: number;
  count: number;
  renderMs: number;
  mountMs: number;
  updateMs: number;
  leafCount: number;
  mounted: boolean;
}

interface AsyncSceneMountBenchSummary {
  renderMedianMs: number;
  mountMedianMs: number;
  updateMedianMs: number;
  updateP90Ms: number;
  leafCount: number;
}

function solidGrid(count: number, shape: "quad" | "triangle"): Polygon[] {
  const side = Math.ceil(Math.sqrt(count));
  const polygons: Polygon[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = i % side;
    const y = Math.floor(i / side);
    const color = `#${((i * 2654435761) & 0xffffff).toString(16).padStart(6, "0")}`;
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

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo] ?? 0;
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (pos - lo);
}

function summarizeRows(rows: readonly AsyncSceneMountBenchRow[]): AsyncSceneMountBenchSummary {
  const renders = rows.map((row) => row.renderMs).sort((a, b) => a - b);
  const mounts = rows.map((row) => row.mountMs).sort((a, b) => a - b);
  const updates = rows.map((row) => row.updateMs).sort((a, b) => a - b);
  return {
    renderMedianMs: Number(quantile(renders, 0.5).toFixed(3)),
    mountMedianMs: Number(quantile(mounts, 0.5).toFixed(3)),
    updateMedianMs: Number(quantile(updates, 0.5).toFixed(3)),
    updateP90Ms: Number(quantile(updates, 0.9).toFixed(3)),
    leafCount: rows[rows.length - 1]?.leafCount ?? 0,
  };
}

function summarize(rows: readonly AsyncSceneMountBenchRow[]): Record<AsyncSceneMountStrategy, AsyncSceneMountBenchSummary> {
  const byStrategy = new Map<AsyncSceneMountStrategy, AsyncSceneMountBenchRow[]>();
  for (const row of rows) {
    const group = byStrategy.get(row.strategy);
    if (group) group.push(row);
    else byStrategy.set(row.strategy, [row]);
  }
  const out = {} as Record<AsyncSceneMountStrategy, AsyncSceneMountBenchSummary>;
  for (const [strategy, group] of byStrategy) out[strategy] = summarizeRows(group);
  return out;
}

function mountedLeafCount(target: HTMLElement): number {
  return target.querySelectorAll(".polycss-mesh > b, .polycss-mesh > i, .polycss-mesh > s, .polycss-mesh > u").length;
}

function createWrapper(target: HTMLElement, mode: PolyTextureLightingMode): HTMLElement {
  injectPolyBaseStyles(document);
  target.replaceChildren();
  const cameraEl = document.createElement("div");
  cameraEl.className = "polycss-camera";
  cameraEl.style.perspective = "1000000px";
  const sceneEl = document.createElement("div");
  sceneEl.className = "polycss-scene";
  sceneEl.dataset.polycssLighting = mode;
  const wrapper = document.createElement("div");
  wrapper.className = "polycss-mesh";
  sceneEl.appendChild(wrapper);
  cameraEl.appendChild(sceneEl);
  target.appendChild(cameraEl);
  return wrapper;
}

async function mountFragmentChunks(
  wrapper: HTMLElement,
  rendered: readonly RenderedPoly[],
  chunkSize: number,
): Promise<void> {
  let fragment = document.createDocumentFragment();
  for (let i = 0; i < rendered.length; i += 1) {
    fragment.appendChild(rendered[i]!.element);
    if ((i + 1) % chunkSize === 0) {
      wrapper.appendChild(fragment);
      fragment = document.createDocumentFragment();
      await yieldToBrowser();
    }
  }
  if (fragment.childNodes.length > 0) wrapper.appendChild(fragment);
}

async function mountAppendBatches(
  wrapper: HTMLElement,
  rendered: readonly RenderedPoly[],
  chunkSize: number,
): Promise<void> {
  let batch: HTMLElement[] = [];
  for (let i = 0; i < rendered.length; i += 1) {
    batch.push(rendered[i]!.element);
    if ((i + 1) % chunkSize === 0) {
      wrapper.append(...batch);
      batch = [];
      await yieldToBrowser();
    }
  }
  if (batch.length > 0) wrapper.append(...batch);
}

async function runSceneProduction(
  target: HTMLElement,
  polygons: Polygon[],
  repeat: number,
  mode: PolyTextureLightingMode,
  replaceExisting: boolean,
  disableStrategies: Array<"b" | "i" | "u">,
): Promise<AsyncSceneMountBenchRow> {
  target.replaceChildren();
  const scene = createPolyScene(target, {
    camera: createPolyOrthographicCamera({ rotX: 65, rotY: 45, zoom: 1 }),
    textureLighting: mode,
    strategies: { disable: disableStrategies },
  });
  const handle = scene.add(makeParseResult(replaceExisting ? polygons : []), {
    merge: false,
    excludeFromAutoCenter: true,
  }) as ChunkedMeshHandle;
  await nextFrame();

  performance.mark("polycss-async-scene-update-start");
  console.timeStamp("polycss-async-scene-update-start");
  const t0 = performance.now();
  await handle.setPolygonsChunked(polygons, {
    merge: false,
    stableDom: false,
    recomputeAutoCenter: false,
  });
  const t1 = performance.now();
  console.timeStamp("polycss-async-scene-update-end");
  performance.mark("polycss-async-scene-update-end");

  const leafCount = mountedLeafCount(target);
  const row: AsyncSceneMountBenchRow = {
    strategy: "scene-production",
    repeat,
    count: polygons.length,
    renderMs: 0,
    mountMs: 0,
    updateMs: Number((t1 - t0).toFixed(3)),
    leafCount,
    mounted: leafCount === polygons.length,
  };

  scene.destroy();
  target.replaceChildren();
  await nextFrame();
  return row;
}

async function runManualStrategy(
  target: HTMLElement,
  polygons: Polygon[],
  repeat: number,
  mode: PolyTextureLightingMode,
  chunkSize: number,
  strategy: "manual-fragment" | "manual-append",
  disableStrategies: Array<"b" | "i" | "u">,
): Promise<AsyncSceneMountBenchRow> {
  const wrapper = createWrapper(target, mode);
  let cancelled = false;

  performance.mark(`polycss-${strategy}-render-start`);
  console.timeStamp(`polycss-${strategy}-render-start`);
  const t0 = performance.now();
  const result = await renderPolygonsWithTextureAtlasAsync(polygons, {
    doc: document,
    textureLighting: mode,
    strategies: { disable: disableStrategies },
  }, () => cancelled);
  const t1 = performance.now();
  console.timeStamp(`polycss-${strategy}-render-end`);
  performance.mark(`polycss-${strategy}-render-end`);

  performance.mark(`polycss-${strategy}-mount-start`);
  console.timeStamp(`polycss-${strategy}-mount-start`);
  if (strategy === "manual-fragment") await mountFragmentChunks(wrapper, result.rendered, chunkSize);
  else await mountAppendBatches(wrapper, result.rendered, chunkSize);
  const t2 = performance.now();
  console.timeStamp(`polycss-${strategy}-mount-end`);
  performance.mark(`polycss-${strategy}-mount-end`);

  const leafCount = mountedLeafCount(target);
  const row: AsyncSceneMountBenchRow = {
    strategy,
    repeat,
    count: polygons.length,
    renderMs: Number((t1 - t0).toFixed(3)),
    mountMs: Number((t2 - t1).toFixed(3)),
    updateMs: Number((t2 - t0).toFixed(3)),
    leafCount,
    mounted: leafCount === polygons.length,
  };

  cancelled = true;
  result.dispose();
  target.replaceChildren();
  await nextFrame();
  return row;
}

export async function runPolycssAsyncSceneMountBench(input: AsyncSceneMountBenchOptions = {}): Promise<{
  options: Required<Omit<AsyncSceneMountBenchOptions, "strategies">> & { strategies: AsyncSceneMountStrategy[] };
  rows: AsyncSceneMountBenchRow[];
  summary: Record<AsyncSceneMountStrategy, AsyncSceneMountBenchSummary>;
}> {
  const options = {
    count: Math.max(1, Math.floor(input.count ?? 10000)),
    repeats: Math.max(1, Math.floor(input.repeats ?? 5)),
    chunkSize: Math.max(1, Math.floor(input.chunkSize ?? 750)),
    mode: input.mode ?? "baked",
    shape: input.shape ?? "quad",
    replaceExisting: input.replaceExisting ?? false,
    disableStrategies: input.disableStrategies ?? ["i", "u"],
    strategies: input.strategies?.length ? input.strategies : DEFAULT_STRATEGIES,
  };
  const target = document.getElementById("bench-target") ?? document.body.appendChild(document.createElement("div"));
  target.id = "bench-target";
  const polygons = solidGrid(options.count, options.shape);
  const rows: AsyncSceneMountBenchRow[] = [];

  for (let repeat = 0; repeat < options.repeats; repeat += 1) {
    const strategies = repeat % 2 === 0 ? options.strategies : [...options.strategies].reverse();
    for (const strategy of strategies) {
      if (strategy === "scene-production") {
        rows.push(await runSceneProduction(target, polygons, repeat, options.mode, options.replaceExisting, options.disableStrategies));
      } else {
        rows.push(await runManualStrategy(target, polygons, repeat, options.mode, options.chunkSize, strategy, options.disableStrategies));
      }
    }
  }

  return {
    options,
    rows,
    summary: summarize(rows),
  };
}

(window as unknown as {
  runPolycssAsyncSceneMountBench: typeof runPolycssAsyncSceneMountBench;
}).runPolycssAsyncSceneMountBench = runPolycssAsyncSceneMountBench;
