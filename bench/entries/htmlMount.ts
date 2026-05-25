import type { Polygon, PolyTextureLightingMode } from "@layoutit/polycss-core";
import type { RenderedPoly } from "@layoutit/polycss";
import { renderPolygonsWithTextureAtlas } from "@layoutit/polycss";

type MountStrategy =
  | "fragment-append"
  | "fragment-replace"
  | "detached-wrapper"
  | "append-batches"
  | "fragment-chunks-yield"
  | "contextual-fragment"
  | "insert-adjacent-html"
  | "append-html-unsafe"
  | "stream-append-html-unsafe"
  | "stream-html-unsafe"
  | "direct-inner-html"
  | "reuse-style-update";

const STRATEGIES: MountStrategy[] = [
  "fragment-append",
  "fragment-replace",
  "detached-wrapper",
  "append-batches",
  "fragment-chunks-yield",
  "contextual-fragment",
  "insert-adjacent-html",
  "append-html-unsafe",
  "stream-append-html-unsafe",
  "stream-html-unsafe",
  "direct-inner-html",
  "reuse-style-update",
];

interface HtmlMountBenchOptions {
  count?: number;
  repeats?: number;
  chunkSize?: number;
  mode?: PolyTextureLightingMode;
  strategies?: MountStrategy[];
}

interface HtmlMountBenchRow {
  strategy: MountStrategy;
  repeat: number;
  count: number;
  rendered: number;
  supported: boolean;
  mounted: boolean;
  renderMs: number;
  prepareMs: number;
  mountMs: number;
  totalMs: number;
  leafCount: number;
}

interface StrategySummary {
  supported: boolean;
  mounted: boolean;
  prepareMedianMs: number;
  mountMedianMs: number;
  totalMedianMs: number;
  leafCount: number;
}

type HtmlInsertionTarget = HTMLElement & {
  appendHTMLUnsafe?: (html: string, options?: unknown) => void;
  streamAppendHTMLUnsafe?: (options?: unknown) => WritableStream<string>;
  streamHTMLUnsafe?: (options?: unknown) => WritableStream<string>;
};

function solidGrid(count: number): Polygon[] {
  const side = Math.ceil(Math.sqrt(count));
  const polygons: Polygon[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = i % side;
    const y = Math.floor(i / side);
    const color = `#${((i * 2654435761) & 0xffffff).toString(16).padStart(6, "0")}`;
    polygons.push({
      vertices: [
        [x, y, 0],
        [x + 0.88, y, 0],
        [x + 0.88, y + 0.88, 0],
        [x, y + 0.88, 0],
      ],
      color,
    });
  }
  return polygons;
}

function resetTarget(target: HTMLElement): void {
  target.replaceChildren();
}

function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as unknown as {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  return scheduler?.yield
    ? scheduler.yield()
    : new Promise((resolve) => setTimeout(resolve, 0));
}

function mountFragment(target: HTMLElement, rendered: readonly RenderedPoly[]): void {
  const fragment = document.createDocumentFragment();
  for (const item of rendered) fragment.appendChild(item.element);
  target.appendChild(fragment);
}

function replaceWithFragment(target: HTMLElement, rendered: readonly RenderedPoly[]): void {
  const fragment = document.createDocumentFragment();
  for (const item of rendered) fragment.appendChild(item.element);
  target.replaceChildren(fragment);
}

function mountDetachedWrapper(target: HTMLElement, rendered: readonly RenderedPoly[]): void {
  const wrapper = document.createElement("div");
  wrapper.className = "polycss-mesh";
  const fragment = document.createDocumentFragment();
  for (const item of rendered) fragment.appendChild(item.element);
  wrapper.appendChild(fragment);
  target.replaceChildren(wrapper);
}

function mountAppendBatches(target: HTMLElement, rendered: readonly RenderedPoly[], chunkSize: number): void {
  for (let start = 0; start < rendered.length; start += chunkSize) {
    const nodes = rendered.slice(start, start + chunkSize).map((item) => item.element);
    target.append(...nodes);
  }
}

async function mountFragmentChunksYield(
  target: HTMLElement,
  rendered: readonly RenderedPoly[],
  chunkSize: number,
): Promise<void> {
  for (let start = 0; start < rendered.length; start += chunkSize) {
    const fragment = document.createDocumentFragment();
    const end = Math.min(rendered.length, start + chunkSize);
    for (let i = start; i < end; i += 1) fragment.appendChild(rendered[i]!.element);
    target.appendChild(fragment);
    await yieldToBrowser();
  }
}

function htmlFromRendered(rendered: readonly RenderedPoly[], chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < rendered.length; start += chunkSize) {
    let html = "";
    const end = Math.min(rendered.length, start + chunkSize);
    for (let i = start; i < end; i += 1) html += rendered[i]!.element.outerHTML;
    chunks.push(html);
  }
  return chunks;
}

function directHtmlForGrid(count: number, chunkSize: number): string[] {
  const side = Math.ceil(Math.sqrt(count));
  const chunks: string[] = [];
  let html = "";
  for (let i = 0; i < count; i += 1) {
    const x = i % side;
    const y = Math.floor(i / side);
    const color = `#${((i * 2654435761) & 0xffffff).toString(16).padStart(6, "0")}`;
    const tx = Number((y * 50).toFixed(3));
    const ty = Number((x * 50).toFixed(3));
    html += `<b style="transform:matrix3d(44,0,0,0,0,44,0,0,0,0,1,0,${tx},${ty},0,1);color:${color}"></b>`;
    if ((i + 1) % chunkSize === 0) {
      chunks.push(html);
      html = "";
    }
  }
  if (html) chunks.push(html);
  return chunks;
}

function mountContextualFragment(target: HTMLElement, htmlChunks: readonly string[]): void {
  const range = document.createRange();
  range.selectNode(target);
  for (const html of htmlChunks) {
    target.appendChild(range.createContextualFragment(html));
  }
  range.detach();
}

function mountInsertAdjacentHtml(target: HTMLElement, htmlChunks: readonly string[]): void {
  for (const html of htmlChunks) target.insertAdjacentHTML("beforeend", html);
}

function mountAppendHtmlUnsafe(target: HtmlInsertionTarget, htmlChunks: readonly string[]): boolean {
  if (typeof target.appendHTMLUnsafe !== "function") return false;
  for (const html of htmlChunks) target.appendHTMLUnsafe(html);
  return true;
}

async function mountHtmlStream(
  target: HtmlInsertionTarget,
  htmlChunks: readonly string[],
  method: "streamAppendHTMLUnsafe" | "streamHTMLUnsafe",
): Promise<boolean> {
  const stream = target[method]?.();
  if (!stream) return false;
  const writer = stream.getWriter();
  try {
    for (const html of htmlChunks) await writer.write(html);
    await writer.close();
    return true;
  } catch {
    try { await writer.abort(); } catch { /* ignore */ }
    return false;
  }
}

function mutateMountedTransforms(rendered: readonly RenderedPoly[]): void {
  for (let i = 0; i < rendered.length; i += 1) {
    const element = rendered[i]!.element;
    element.style.transform = `${element.style.transform} translateZ(0px)`;
  }
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo] ?? 0;
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (pos - lo);
}

function summarize(rows: HtmlMountBenchRow[]): Record<MountStrategy, StrategySummary> {
  const byStrategy = new Map<MountStrategy, HtmlMountBenchRow[]>();
  for (const row of rows) {
    const group = byStrategy.get(row.strategy);
    if (group) group.push(row);
    else byStrategy.set(row.strategy, [row]);
  }
  const out = {} as Record<MountStrategy, StrategySummary>;
  for (const [strategy, group] of byStrategy) {
    const prepare = group.map((row) => row.prepareMs).sort((a, b) => a - b);
    const mount = group.map((row) => row.mountMs).sort((a, b) => a - b);
    const total = group.map((row) => row.totalMs).sort((a, b) => a - b);
    out[strategy] = {
      supported: group.some((row) => row.supported),
      mounted: group.every((row) => row.mounted),
      prepareMedianMs: Number(quantile(prepare, 0.5).toFixed(3)),
      mountMedianMs: Number(quantile(mount, 0.5).toFixed(3)),
      totalMedianMs: Number(quantile(total, 0.5).toFixed(3)),
      leafCount: group[group.length - 1]?.leafCount ?? 0,
    };
  }
  return out;
}

function strategySupported(target: HtmlInsertionTarget, strategy: MountStrategy): boolean {
  if (strategy === "append-html-unsafe") return typeof target.appendHTMLUnsafe === "function";
  if (strategy === "stream-append-html-unsafe") return typeof target.streamAppendHTMLUnsafe === "function";
  if (strategy === "stream-html-unsafe") return typeof target.streamHTMLUnsafe === "function";
  return true;
}

async function runOne(
  target: HTMLElement,
  polygons: Polygon[],
  strategy: MountStrategy,
  repeat: number,
  options: Required<Omit<HtmlMountBenchOptions, "strategies">> & { strategies: MountStrategy[] },
): Promise<HtmlMountBenchRow> {
  resetTarget(target);
  const insertionTarget = target as HtmlInsertionTarget;
  const supported = strategySupported(insertionTarget, strategy);
  const t0 = performance.now();
  const result = strategy === "direct-inner-html"
    ? { rendered: [] as RenderedPoly[], dispose: () => {} }
    : renderPolygonsWithTextureAtlas(polygons, {
        doc: document,
        textureLighting: options.mode,
        strategies: { disable: ["i", "u"] },
      });
  const t1 = performance.now();

  let htmlChunks: string[] = [];
  if (
    strategy === "contextual-fragment" ||
    strategy === "insert-adjacent-html" ||
    strategy === "append-html-unsafe" ||
    strategy === "stream-append-html-unsafe" ||
    strategy === "stream-html-unsafe"
  ) {
    htmlChunks = htmlFromRendered(result.rendered, options.chunkSize);
  } else if (strategy === "direct-inner-html") {
    htmlChunks = directHtmlForGrid(options.count, options.chunkSize);
  } else if (strategy === "reuse-style-update") {
    mountFragment(target, result.rendered);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  }
  const t2 = performance.now();

  let mounted = supported;
  if (supported) {
    if (strategy === "fragment-append") mountFragment(target, result.rendered);
    else if (strategy === "fragment-replace") replaceWithFragment(target, result.rendered);
    else if (strategy === "detached-wrapper") mountDetachedWrapper(target, result.rendered);
    else if (strategy === "append-batches") mountAppendBatches(target, result.rendered, options.chunkSize);
    else if (strategy === "fragment-chunks-yield") await mountFragmentChunksYield(target, result.rendered, options.chunkSize);
    else if (strategy === "contextual-fragment") mountContextualFragment(target, htmlChunks);
    else if (strategy === "insert-adjacent-html") mountInsertAdjacentHtml(target, htmlChunks);
    else if (strategy === "append-html-unsafe") mounted = mountAppendHtmlUnsafe(insertionTarget, htmlChunks);
    else if (strategy === "stream-append-html-unsafe") mounted = await mountHtmlStream(insertionTarget, htmlChunks, "streamAppendHTMLUnsafe");
    else if (strategy === "stream-html-unsafe") mounted = await mountHtmlStream(insertionTarget, htmlChunks, "streamHTMLUnsafe");
    else if (strategy === "direct-inner-html") {
      target.innerHTML = htmlChunks.join("");
    } else if (strategy === "reuse-style-update") {
      mutateMountedTransforms(result.rendered);
    }
  }
  const t3 = performance.now();

  const row: HtmlMountBenchRow = {
    strategy,
    repeat,
    count: polygons.length,
    rendered: strategy === "direct-inner-html" ? polygons.length : result.rendered.length,
    supported,
    mounted,
    renderMs: Number((t1 - t0).toFixed(3)),
    prepareMs: Number((t2 - t1).toFixed(3)),
    mountMs: Number((t3 - t2).toFixed(3)),
    totalMs: Number((t3 - t0).toFixed(3)),
    leafCount: target.querySelectorAll("b,i,s,u").length,
  };
  result.dispose();
  resetTarget(target);
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  return row;
}

export async function runPolycssHtmlMountBench(input: HtmlMountBenchOptions = {}): Promise<{
  supported: boolean;
  options: Required<Omit<HtmlMountBenchOptions, "strategies">> & { strategies: MountStrategy[] };
  rows: HtmlMountBenchRow[];
  summary: Record<MountStrategy, StrategySummary>;
}> {
  const options = {
    count: Math.max(1, Math.floor(input.count ?? 10000)),
    repeats: Math.max(1, Math.floor(input.repeats ?? 5)),
    chunkSize: Math.max(1, Math.floor(input.chunkSize ?? 750)),
    mode: input.mode ?? "baked",
    strategies: input.strategies?.length ? input.strategies : STRATEGIES,
  };
  const target = document.getElementById("bench-target") ?? document.body.appendChild(document.createElement("div"));
  target.id = "bench-target";
  const polygons = solidGrid(options.count);
  const rows: HtmlMountBenchRow[] = [];
  const htmlTarget = target as HtmlInsertionTarget;
  const supported = typeof htmlTarget.appendHTMLUnsafe === "function" ||
    typeof htmlTarget.streamAppendHTMLUnsafe === "function" ||
    typeof htmlTarget.streamHTMLUnsafe === "function";

  for (let repeat = 0; repeat < options.repeats; repeat += 1) {
    for (const strategy of options.strategies) {
      rows.push(await runOne(target, polygons, strategy, repeat, options));
    }
  }

  return {
    supported,
    options,
    rows,
    summary: summarize(rows),
  };
}

(window as unknown as {
  runPolycssHtmlMountBench: typeof runPolycssHtmlMountBench;
}).runPolycssHtmlMountBench = runPolycssHtmlMountBench;
