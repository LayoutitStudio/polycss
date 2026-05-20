#!/usr/bin/env node
/**
 * Synthetic Chromium compositor probe for polycss trace hypotheses.
 *
 * This intentionally does not render a correct model. It isolates browser
 * behavior under a rotating preserve-3d root:
 *   - topology: equal leaf count, different leaf transform topology
 *   - distribution: equal matrix3d leaves, different projected distribution
 *   - order: equal matrix3d leaves, same positions, different DOM order
 *   - depth-groups: per-leaf translateZ versus depth-plane wrappers
 *   - projection: per-leaf depth folded into 2D projected offsets
 *
 * Usage:
 *   node bench/compositor-topology-probe.mjs
 *   node bench/compositor-topology-probe.mjs --mode=topology --leaves=5000
 *   node bench/compositor-topology-probe.mjs --mode=distribution --headed
 *   node bench/compositor-topology-probe.mjs --mode=order --leaves=2500 --spacing=3
 *   node bench/compositor-topology-probe.mjs --mode=depth-groups --leaves=5000
 *   node bench/compositor-topology-probe.mjs --mode=projection --leaves=7000
 *   node bench/compositor-topology-probe.mjs --mode=depth-groups --root=js
 */
import { chromium } from "playwright";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : "true"];
  }),
);

const MODE = args.get("mode") ?? "all";
const LEAVES = Number(args.get("leaves") ?? 2500);
const SAMPLE_MS = Number(args.get("sample-ms") ?? 2500);
const WARMUP_MS = Number(args.get("warmup-ms") ?? 700);
const HEADED = args.has("headed");
const JSON_OUT = args.has("json");
const EXECUTABLE = args.get("browser");
const SOFTWARE_BACKEND = args.has("software-backend");
const EXTRA_CHROMIUM_ARGS = (args.get("chromium-args") ?? "")
  .split(/\s+/)
  .map((value) => value.trim())
  .filter(Boolean);
const ROOT = args.get("root");
const TRACE = !args.has("no-trace");
const SPACING = Number(args.get("spacing") ?? 3);
const LEAF_SIZE = Number(args.get("size") ?? 6);
const DEPTHS = Math.max(1, Number(args.get("depths") ?? 17));
const DEPTH_STEP = Number(args.get("depth-step") ?? 6);
const DEPTH_PATTERN = args.get("depth-pattern") ?? "mixed";
const LEAF_TRANSFORM_STYLE = args.get("leaf-transform-style") ?? "preserve-3d";
const LEAF_BACKFACE = args.get("leaf-backface") ?? "visible";
const LEAF_WILL_CHANGE = args.get("leaf-will-change") ?? "";
const LEAF_CONTAIN = args.get("leaf-contain") ?? "";
const SCENE_WILL_CHANGE = args.get("scene-will-change") ?? "transform";
const ORDER_TRANSFORM = args.get("order-transform") ?? "matrix3d";
const DEPTH_TRANSFORM_STYLE = args.get("depth-transform-style") ?? "preserve-3d";
const DEPTH_WILL_CHANGE = args.get("depth-will-change") ?? "";
const DEPTH_CONTAIN = args.get("depth-contain") ?? "";
const DEPTH_BOX = args.has("depth-box");
const ROOT_SCALE = Number(args.get("root-scale") ?? 0.7);
const ROOT_ROT_X = Number(args.get("root-rot-x") ?? 65);
const ROOT_ROT_STEP = Number(args.get("root-rot-step") ?? 0.5);
const PERSPECTIVE = Number(args.get("perspective") ?? 8000);
const VARIANT_FILTER = new Set(
  (args.get("variants") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const CHROMIUM_ARGS = [
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  ...chromiumArgsWithGpuDefault(EXTRA_CHROMIUM_ARGS, { softwareBackend: SOFTWARE_BACKEND }),
];

const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "blink",
  "cc",
  "gpu",
  "renderer.scheduler",
].join(",");

function percentile(sorted, p) {
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  ] ?? 0;
}

function summarizeFrameTimes(dts) {
  const sorted = dts
    .filter((value) => Number.isFinite(value) && value > 0 && value < 2000)
    .sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const p99 = percentile(sorted, 0.99);
  return {
    samples: sorted.length,
    fps_p50: +(1000 / p50).toFixed(1),
    fps_p95: +(1000 / p95).toFixed(1),
    p99_ms: +p99.toFixed(1),
    buckets: {
      x1: sorted.filter((value) => value < 10).length,
      x2: sorted.filter((value) => value >= 10 && value < 18).length,
      x3: sorted.filter((value) => value >= 18 && value < 26).length,
      x4: sorted.filter((value) => value >= 26 && value < 34).length,
      slow: sorted.filter((value) => value >= 34).length,
    },
  };
}

function summarizeTraceEvents(events) {
  const byName = new Map();
  for (const event of events) {
    if (event?.ph !== "X" || typeof event.dur !== "number") continue;
    const entry = byName.get(event.name) ?? { count: 0, us: 0 };
    entry.count += 1;
    entry.us += event.dur;
    byName.set(event.name, entry);
  }

  const get = (name) => byName.get(name) ?? { count: 0, us: 0 };
  const frames = Math.max(1, get("FireAnimationFrame").count || 1);
  const pick = (name) => {
    const event = get(name);
    return {
      count: event.count,
      total_ms: +(event.us / 1000).toFixed(1),
      per_frame_ms: +(event.us / 1000 / frames).toFixed(3),
    };
  };

  return {
    pac: pick("PaintArtifactCompositor::Update"),
    layerize: pick("Layerize"),
    drawProps: pick("LayerTreeImpl::UpdateDrawProperties"),
    visible: pick("draw_property_utils::ComputeDrawPropertiesOfVisibleLayers"),
    draw: pick("MainFrame.Draw"),
    paint: pick("Paint"),
    style: pick("UpdateLayoutTree"),
    raf: pick("FireAnimationFrame"),
  };
}

async function startTrace(cdp) {
  const events = [];
  cdp.on("Tracing.dataCollected", (payload) => {
    if (Array.isArray(payload.value)) events.push(...payload.value);
  });
  await cdp.send("Tracing.start", {
    transferMode: "ReportEvents",
    categories: TRACE_CATEGORIES,
  });
  return events;
}

async function stopTrace(cdp, events) {
  await new Promise(async (resolve) => {
    cdp.once("Tracing.tracingComplete", resolve);
    await cdp.send("Tracing.end");
  });
  return summarizeTraceEvents(events);
}

function topologyStyle(variant, i, leaves) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(leaves)));
  const x = (i % cols) * 8 - 200;
  const y = Math.floor(i / cols) * 8 - 200;
  const z = ((i % 17) - 8) * 6;
  switch (variant) {
    case "left-top":
      return `left:${x}px;top:${y}px;width:6px;height:6px;`;
    case "translate2d":
      return `width:6px;height:6px;transform:translate(${x}px,${y}px);`;
    case "translateZ0":
      return `left:${x}px;top:${y}px;width:6px;height:6px;transform:translateZ(0);`;
    case "translateZ":
      return `left:${x}px;top:${y}px;width:6px;height:6px;transform:translateZ(${z}px);`;
    case "matrix3d":
      return `width:1px;height:1px;transform:matrix3d(6,0,0,0,0,6,0,0,0,0,1,0,${x},${y},${z},1);`;
    default:
      throw new Error(`Unknown topology variant "${variant}"`);
  }
}

function distributionStyle(variant, i) {
  const cols = 40;
  let x;
  let y;
  if (variant === "cluster") {
    x = (i % cols) * 8 - 160;
    y = Math.floor(i / cols) * 8 - 120;
  } else if (variant === "spread") {
    x = (i % cols) * 24 - 480;
    y = Math.floor(i / cols) * 24 - 360;
  } else if (variant === "overlap") {
    x = (i % cols) * 2 - 40;
    y = Math.floor(i / cols) * 2 - 30;
  } else {
    throw new Error(`Unknown distribution variant "${variant}"`);
  }
  const z = ((i % 17) - 8) * 6;
  return `width:1px;height:1px;transform:matrix3d(6,0,0,0,0,6,0,0,0,0,1,0,${x},${y},${z},1);`;
}

function hashIndex(i) {
  let value = Math.imul(i + 0x9e3779b9, 0x85ebca6b);
  value ^= value >>> 16;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

function makeOrderItems(leaves) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(leaves)));
  const rows = Math.ceil(leaves / cols);
  const items = [];
  for (let i = 0; i < leaves; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const centeredCol = col - (cols - 1) / 2;
    const centeredRow = row - (rows - 1) / 2;
    const depthIndex = orderDepthIndex({ i, col, row, cols, rows });
    const z = (depthIndex - (DEPTHS - 1) / 2) * 6;
    items.push({
      i,
      col,
      row,
      x: centeredCol * SPACING,
      y: centeredRow * SPACING,
      z,
      depthIndex,
      hash: hashIndex(i),
    });
  }
  return items;
}

function orderDepthIndex({ i, col, row, cols, rows }) {
  if (DEPTHS <= 1) return 0;
  switch (DEPTH_PATTERN) {
    case "flat":
      return 0;
    case "column":
      return Math.floor((col / Math.max(1, cols - 1)) * (DEPTHS - 1));
    case "row":
      return Math.floor((row / Math.max(1, rows - 1)) * (DEPTHS - 1));
    case "checker":
      return (col + row) % DEPTHS;
    case "random":
      return hashIndex(i) % DEPTHS;
    case "mixed":
      return (col * 7 + row * 11) % DEPTHS;
    default:
      throw new Error(`Unknown depth pattern "${DEPTH_PATTERN}"`);
  }
}

function sortOrderItems(items, variant) {
  const sorted = [...items];
  const tileCols = 4;
  const maxCol = Math.max(1, ...items.map((item) => item.col));
  const maxRow = Math.max(1, ...items.map((item) => item.row));
  const tileIndex = (item) => {
    const tx = Math.min(tileCols - 1, Math.floor((item.col / (maxCol + 1)) * tileCols));
    const ty = Math.min(tileCols - 1, Math.floor((item.row / (maxRow + 1)) * tileCols));
    return ty * tileCols + tx;
  };
  switch (variant) {
    case "spatial":
      return sorted.sort((a, b) => a.i - b.i);
    case "depth-front":
      return sorted.sort((a, b) => b.z - a.z || a.i - b.i);
    case "depth-back":
      return sorted.sort((a, b) => a.z - b.z || a.i - b.i);
    case "random":
      return sorted.sort((a, b) => a.hash - b.hash);
    case "tile4-spatial":
      return sorted.sort((a, b) => tileIndex(a) - tileIndex(b) || a.row - b.row || a.col - b.col);
    case "tile4-depth":
      return sorted.sort((a, b) => tileIndex(a) - tileIndex(b) || b.z - a.z || a.i - b.i);
    case "tile4-depth-back":
      return sorted.sort((a, b) => tileIndex(a) - tileIndex(b) || a.z - b.z || a.i - b.i);
    case "block64-depth":
      return sorted.sort((a, b) => {
        const blockA = Math.floor(a.i / 64);
        const blockB = Math.floor(b.i / 64);
        return blockA - blockB || b.z - a.z || a.i - b.i;
      });
    default:
      throw new Error(`Unknown order variant "${variant}"`);
  }
}

function orderStyle(item) {
  switch (ORDER_TRANSFORM) {
    case "matrix3d":
      return `width:1px;height:1px;transform:matrix3d(${LEAF_SIZE},0,0,0,0,${LEAF_SIZE},0,0,0,0,1,0,${item.x},${item.y},${item.z},1);`;
    case "translate3d-scale":
      return `width:1px;height:1px;transform:translate3d(${item.x}px,${item.y}px,${item.z}px) scale(${LEAF_SIZE});`;
    case "translate3d-scale3d":
      return `width:1px;height:1px;transform:translate3d(${item.x}px,${item.y}px,${item.z}px) scale3d(${LEAF_SIZE},${LEAF_SIZE},1);`;
    case "translate3d-size":
      return `width:${LEAF_SIZE}px;height:${LEAF_SIZE}px;transform:translate3d(${item.x}px,${item.y}px,${item.z}px);`;
    case "left-top-translateZ":
      return `left:${item.x}px;top:${item.y}px;width:${LEAF_SIZE}px;height:${LEAF_SIZE}px;transform:translateZ(${item.z}px);`;
    default:
      throw new Error(`Unknown order transform "${ORDER_TRANSFORM}"`);
  }
}

function orderMetrics(items) {
  const bounds = items.reduce((acc, item) => ({
    minX: Math.min(acc.minX, item.x),
    minY: Math.min(acc.minY, item.y),
    maxX: Math.max(acc.maxX, item.x + LEAF_SIZE),
    maxY: Math.max(acc.maxY, item.y + LEAF_SIZE),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const boundsArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
  const localArea = items.length * LEAF_SIZE * LEAF_SIZE;
  const estimatedPairOverlap = SPACING >= LEAF_SIZE
    ? 0
    : Math.max(0, LEAF_SIZE - SPACING) * LEAF_SIZE * 2 * items.length;
  return {
    spacing: SPACING,
    leafSize: LEAF_SIZE,
    depths: DEPTHS,
    depthPattern: DEPTH_PATTERN,
    orderTransform: ORDER_TRANSFORM,
    localArea,
    boundsArea: +boundsArea.toFixed(1),
    fillRatio: boundsArea ? +(localArea / boundsArea).toFixed(3) : 0,
    estimatedPairOverlap: +estimatedPairOverlap.toFixed(1),
  };
}

function orderedMetrics(ordered) {
  let sourceJump = 0;
  let depthJump = 0;
  let directionChanges = 0;
  let depthRunCount = ordered.length ? 1 : 0;
  let lastDepthDirection = 0;
  const depthCounts = new Map();
  for (const item of ordered) {
    depthCounts.set(item.depthIndex, (depthCounts.get(item.depthIndex) ?? 0) + 1);
  }
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const next = ordered[i];
    sourceJump += Math.abs(prev.i - next.i);
    const dz = next.z - prev.z;
    depthJump += Math.abs(dz);
    if (Math.abs(dz) > 1e-9) depthRunCount += 1;
    const depthDirection = Math.sign(dz);
    if (depthDirection !== 0) {
      if (lastDepthDirection !== 0 && depthDirection !== lastDepthDirection) directionChanges += 1;
      lastDepthDirection = depthDirection;
    }
  }
  const denom = Math.max(1, ordered.length - 1);
  return {
    sourceJumpMean: +(sourceJump / denom).toFixed(2),
    depthJumpMean: +(depthJump / denom).toFixed(2),
    depthDirectionChanges: directionChanges,
    depthRunCount,
    depthBucketCount: depthCounts.size,
  };
}

function makeOrderCells(variant, leaves) {
  const items = makeOrderItems(leaves);
  const ordered = sortOrderItems(items, variant);
  return {
    metrics: { ...orderMetrics(items), ...orderedMetrics(ordered) },
    cells: ordered.map((item) => `<b style="${orderStyle(item)}"></b>`).join(""),
  };
}

function parseDepthVariant(variant) {
  const match = /^(leaf|group)-z(\d+)(-comp)?$/.exec(variant);
  if (match) {
    return {
      kind: match[1],
      depthCount: Math.max(1, Number(match[2])),
      actualDepthCount: Math.max(1, Number(match[2])),
      compensateDepth: Boolean(match[3]),
    };
  }
  const hybridMatch = /^hybrid-z(\d+)-d(\d+)$/.exec(variant);
  if (hybridMatch) {
    return {
      kind: "hybrid",
      depthCount: Math.max(1, Number(hybridMatch[1])),
      actualDepthCount: Math.max(1, Number(hybridMatch[2])),
    };
  }
  const tiledMatch = /^tiled-z(\d+)-t(\d+)$/.exec(variant);
  if (tiledMatch) {
    return {
      kind: "tiled",
      depthCount: Math.max(1, Number(tiledMatch[1])),
      actualDepthCount: Math.max(1, Number(tiledMatch[1])),
      tileCount: Math.max(1, Number(tiledMatch[2])),
    };
  }
  const tile2dMatch = /^tile2d-z(\d+)-t(\d+)$/.exec(variant);
  if (tile2dMatch) {
    return {
      kind: "tile2d",
      depthCount: Math.max(1, Number(tile2dMatch[1])),
      actualDepthCount: Math.max(1, Number(tile2dMatch[1])),
      tileCount: Math.max(1, Number(tile2dMatch[2])),
    };
  }
  if (!match) throw new Error(`Unknown depth-groups variant "${variant}"`);
  return {
    kind: "group",
    depthCount: 1,
    actualDepthCount: 1,
  };
}

function depthPosition(i, leaves) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(leaves)));
  const rows = Math.max(1, Math.ceil(leaves / cols));
  const col = i % cols;
  const row = Math.floor(i / cols);
  return {
    col,
    row,
    cols,
    rows,
    x: col * 8 - 200,
    y: row * 8 - 200,
  };
}

function depthValue(depthIndex, depthCount) {
  return (depthIndex - (depthCount - 1) / 2) * DEPTH_STEP;
}

function compensateDepthPosition(position, z) {
  return {
    ...position,
    y: position.y + z * Math.tan((ROOT_ROT_X * Math.PI) / 180),
  };
}

function makeDepthGroupCells(variant, leaves) {
  const { kind, depthCount, actualDepthCount, tileCount = 1, compensateDepth = false } = parseDepthVariant(variant);
  if (kind === "leaf") {
    const cells = [];
    for (let i = 0; i < leaves; i++) {
      const depthIndex = i % depthCount;
      const z = depthValue(depthIndex, depthCount);
      const { x, y } = compensateDepth
        ? compensateDepthPosition(depthPosition(i, leaves), z)
        : depthPosition(i, leaves);
      cells.push(
        `<b style="left:${x}px;top:${y}px;width:6px;height:6px;transform:translateZ(${z}px);"></b>`,
      );
    }
    return cells.join("");
  }

  const buckets = Array.from({ length: depthCount }, () => []);
  const tiledBuckets = new Map();
  const tile2dBuckets = new Map();
  for (let i = 0; i < leaves; i++) {
    const actualDepthIndex = i % actualDepthCount;
    const depthIndex = kind === "hybrid"
      ? Math.min(depthCount - 1, Math.floor((actualDepthIndex / actualDepthCount) * depthCount))
      : i % depthCount;
    const actualZ = depthValue(actualDepthIndex, actualDepthCount);
    const position = compensateDepth
      ? compensateDepthPosition(depthPosition(i, leaves), actualZ)
      : depthPosition(i, leaves);
    const { x, y, col, row, cols, rows } = position;
    if (kind === "tiled") {
      const tx = Math.min(tileCount - 1, Math.floor((col / cols) * tileCount));
      const ty = Math.min(tileCount - 1, Math.floor((row / rows) * tileCount));
      const key = `${depthIndex}:${tx}:${ty}`;
      const bucket = tiledBuckets.get(key) ?? { depthIndex, children: [] };
      bucket.children.push({ x, y, actualZ });
      tiledBuckets.set(key, bucket);
      continue;
    }
    if (kind === "tile2d") {
      const tx = Math.min(tileCount - 1, Math.floor((col / cols) * tileCount));
      const ty = Math.min(tileCount - 1, Math.floor((row / rows) * tileCount));
      const key = `${tx}:${ty}`;
      const bucket = tile2dBuckets.get(key) ?? { children: [] };
      bucket.children.push({ x, y, actualZ });
      tile2dBuckets.set(key, bucket);
      continue;
    }
    buckets[depthIndex].push({ x, y, actualZ });
  }

  const renderBoxedDepth = (children, z, renderChild) => {
    const minX = Math.min(...children.map(({ x }) => x));
    const minY = Math.min(...children.map(({ y }) => y));
    const maxX = Math.max(...children.map(({ x }) => x + 6));
    const maxY = Math.max(...children.map(({ y }) => y + 6));
    const width = Math.max(0, maxX - minX);
    const height = Math.max(0, maxY - minY);
    const childHtml = children
      .map((child) => renderChild(child, minX, minY))
      .join("");
    return `<div class="depth" style="left:${minX}px;top:${minY}px;width:${width}px;height:${height}px;transform:translateZ(${z}px)">${childHtml}</div>`;
  };

  if (kind === "tiled") {
    return [...tiledBuckets.values()]
      .map(({ depthIndex, children }) =>
        renderBoxedDepth(
          children,
          depthValue(depthIndex, depthCount),
          ({ x, y }, offsetX, offsetY) => `<b style="left:${x - offsetX}px;top:${y - offsetY}px;width:6px;height:6px;"></b>`,
        )
      )
      .join("");
  }

  if (kind === "tile2d") {
    return [...tile2dBuckets.values()]
      .map(({ children }) => {
        const minX = Math.min(...children.map(({ x }) => x));
        const minY = Math.min(...children.map(({ y }) => y));
        const maxX = Math.max(...children.map(({ x }) => x + 6));
        const maxY = Math.max(...children.map(({ y }) => y + 6));
        const width = Math.max(0, maxX - minX);
        const height = Math.max(0, maxY - minY);
        const childHtml = children
          .map(({ x, y, actualZ }) =>
            `<b style="left:${x - minX}px;top:${y - minY}px;width:6px;height:6px;transform:translateZ(${actualZ}px);"></b>`)
          .join("");
        return `<div class="tile2d" style="left:${minX}px;top:${minY}px;width:${width}px;height:${height}px;">${childHtml}</div>`;
      })
      .join("");
  }

  return buckets
    .map((children, depthIndex) => {
      const z = kind === "hybrid"
        ? depthValue(depthIndex + 0.5, depthCount)
        : depthValue(depthIndex, depthCount);
      const childStyle = ({ x, y, actualZ }, offsetX = 0, offsetY = 0) => {
        const residual = kind === "hybrid" ? actualZ - z : 0;
        const transform = Math.abs(residual) > 1e-9 ? `transform:translateZ(${residual}px);` : "";
        return `<b style="left:${x - offsetX}px;top:${y - offsetY}px;width:6px;height:6px;${transform}"></b>`;
      };
      if (!DEPTH_BOX) {
        return `<div class="depth" style="transform:translateZ(${z}px)">${
          children.map((child) => childStyle(child)).join("")
        }</div>`;
      }
      return renderBoxedDepth(children, z, childStyle);
    })
    .join("");
}

function makeProjectionCells(variant, leaves) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(leaves)));
  const cells = [];
  for (let i = 0; i < leaves; i++) {
    const x = (i % cols) * 8 - 200;
    const y = Math.floor(i / cols) * 8 - 200;
    const z = ((i % 136) - 67.5) * 6;
    const vars = `--x:${x}px;--y:${y}px;--z:${z}px;`;
    switch (variant) {
      case "static-left-top":
        cells.push(`<b style="left:${x}px;top:${y}px;width:6px;height:6px;"></b>`);
        break;
      case "static-transform":
        cells.push(`<b style="width:6px;height:6px;transform:translate(${x}px,${y}px);"></b>`);
        break;
      case "var-transform":
      case "registered-var-transform":
        cells.push(`<b style="${vars}width:6px;height:6px;transform:translate(calc(var(--x) + var(--z) * var(--kx)),calc(var(--y) + var(--z) * var(--ky)));"></b>`);
        break;
      case "var-left-top":
      case "registered-var-left-top":
        cells.push(`<b style="${vars}left:calc(var(--x) + var(--z) * var(--kx));top:calc(var(--y) + var(--z) * var(--ky));width:6px;height:6px;"></b>`);
        break;
      case "translate3d-reference":
        cells.push(`<b style="width:6px;height:6px;transform:translate3d(${x}px,${y}px,${z}px);"></b>`);
        break;
      default:
        throw new Error(`Unknown projection variant "${variant}"`);
    }
  }
  return cells.join("");
}

function makeHtml({ mode, variant, leaves, root }) {
  let cells = "";
  let caseMetrics = null;
  if (mode === "depth-groups") {
    cells = makeDepthGroupCells(variant, leaves);
  } else if (mode === "projection") {
    cells = makeProjectionCells(variant, leaves);
  } else if (mode === "order") {
    const result = makeOrderCells(variant, leaves);
    cells = result.cells;
    caseMetrics = result.metrics;
  } else {
    const leafHtml = [];
    for (let i = 0; i < leaves; i++) {
      const style =
        mode === "topology"
          ? topologyStyle(variant, i, leaves)
          : distributionStyle(variant, i);
      leafHtml.push(`<b style="${style}"></b>`);
    }
    cells = leafHtml.join("");
  }

  const projectionMode = mode === "projection";
  const rootMotion =
    projectionMode
      ? `--kx:0;--ky:0;transform:scale(${ROOT_SCALE});`
      : root === "css"
      ? "animation:spin 10s linear infinite;"
      : root === "var" || root === "var-registered"
        ? `--rot:0deg;transform:scale(${ROOT_SCALE}) rotateX(${ROOT_ROT_X}deg) rotate(var(--rot));`
      : root === "rotate-prop"
        ? `rotate:0deg;transform:scale(${ROOT_SCALE}) rotateX(${ROOT_ROT_X}deg);`
      : `transform:scale(${ROOT_SCALE}) rotateX(${ROOT_ROT_X}deg) rotate(0deg);`;
  const sceneWillChange = SCENE_WILL_CHANGE === "auto" ? "auto" : SCENE_WILL_CHANGE;
  const leafExtra = [
    `transform-style:${LEAF_TRANSFORM_STYLE}`,
    `backface-visibility:${LEAF_BACKFACE}`,
    LEAF_WILL_CHANGE ? `will-change:${LEAF_WILL_CHANGE}` : "",
    LEAF_CONTAIN ? `contain:${LEAF_CONTAIN}` : "",
  ].filter(Boolean).join(";");
  const depthExtra = [
    `transform-style:${DEPTH_TRANSFORM_STYLE}`,
    DEPTH_WILL_CHANGE ? `will-change:${DEPTH_WILL_CHANGE}` : "",
    DEPTH_CONTAIN ? `contain:${DEPTH_CONTAIN}` : "",
  ].filter(Boolean).join(";");
  const script =
    projectionMode
      ? `const root=document.querySelector('.scene');const samples=[];let last=performance.now(),frame=0;function tick(now){samples.push(now-last);last=now;frame++;const a=frame*0.03;root.style.setProperty('--kx',(Math.sin(a)*0.9).toFixed(6));root.style.setProperty('--ky',(Math.cos(a)*0.6).toFixed(6));requestAnimationFrame(tick)}requestAnimationFrame(tick);window.__probe={samples};`
      : root === "css"
      ? "const samples=[];let last=performance.now();function tick(now){samples.push(now-last);last=now;requestAnimationFrame(tick)}requestAnimationFrame(tick);window.__probe={samples};"
      : root === "static"
        ? "const samples=[];let last=performance.now();function tick(now){samples.push(now-last);last=now;requestAnimationFrame(tick)}requestAnimationFrame(tick);window.__probe={samples};"
        : root === "var" || root === "var-registered"
          ? `const root=document.querySelector('.scene');const samples=[];let last=performance.now(),frame=0;function tick(now){samples.push(now-last);last=now;frame++;root.style.setProperty('--rot',((frame*${ROOT_ROT_STEP})%360)+'deg');requestAnimationFrame(tick)}requestAnimationFrame(tick);window.__probe={samples};`
        : root === "rotate-prop"
          ? `const root=document.querySelector('.scene');const samples=[];let last=performance.now(),frame=0;function tick(now){samples.push(now-last);last=now;frame++;root.style.rotate=((frame*${ROOT_ROT_STEP})%360)+'deg';requestAnimationFrame(tick)}requestAnimationFrame(tick);window.__probe={samples};`
        : `const root=document.querySelector('.scene');const samples=[];let last=performance.now(),frame=0;function tick(now){samples.push(now-last);last=now;frame++;root.style.transform='scale(${ROOT_SCALE}) rotateX(${ROOT_ROT_X}deg) rotate('+((frame*${ROOT_ROT_STEP})%360)+'deg)';requestAnimationFrame(tick)}requestAnimationFrame(tick);window.__probe={samples};`;
  const registeredProperty = root === "var-registered"
    ? "@property --rot { syntax: '<angle>'; inherits: false; initial-value: 0deg; }"
    : variant.startsWith("registered-var-")
      ? "@property --kx { syntax: '<number>'; inherits: true; initial-value: 0; } @property --ky { syntax: '<number>'; inherits: true; initial-value: 0; }"
    : "";

  return `<!doctype html><meta charset="utf-8"><style>
${registeredProperty}
body{margin:0;background:#111;overflow:hidden}
#host{position:relative;width:1280px;height:800px;perspective:${PERSPECTIVE}px;transform-style:preserve-3d}
.scene{position:absolute;left:50%;top:50%;width:0;height:0;transform-style:preserve-3d;will-change:${sceneWillChange};${rootMotion}}
.depth{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;${depthExtra}}
.tile2d{position:absolute;left:0;top:0;transform-origin:0 0;transform-style:preserve-3d}
b{position:absolute;display:block;background:#5eead4;transform-origin:0 0;${leafExtra};margin:0;padding:0}
@keyframes spin{from{transform:scale(${ROOT_SCALE}) rotateX(${ROOT_ROT_X}deg) rotate(0deg)}to{transform:scale(${ROOT_SCALE}) rotateX(${ROOT_ROT_X}deg) rotate(360deg)}}
</style><div id="host"><div class="scene">${cells}</div></div><script>window.__caseMetrics=${JSON.stringify(caseMetrics)};${script}</script>`;
}

async function runCase(browser, config) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(makeHtml(config), { waitUntil: "load" });
  const screenMetrics = await page.evaluate(() => {
    const rects = [...document.querySelectorAll("b")].map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    }).filter((rect) => rect.width > 0 && rect.height > 0);
    if (!rects.length) return null;
    const bounds = rects.reduce((acc, rect) => ({
      left: Math.min(acc.left, rect.left),
      top: Math.min(acc.top, rect.top),
      right: Math.max(acc.right, rect.right),
      bottom: Math.max(acc.bottom, rect.bottom),
    }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
    const screenArea = Math.max(1, (bounds.right - bounds.left) * (bounds.bottom - bounds.top));
    const sumArea = rects.reduce((sum, rect) => sum + rect.width * rect.height, 0);
    const sampleLimit = 8000;
    const stride = Math.max(1, Math.floor(rects.length / sampleLimit));
    const sampled = rects.filter((_, index) => index % stride === 0).slice(0, sampleLimit);
    const sorted = sampled.map((rect, index) => ({ ...rect, index })).sort((a, b) => a.left - b.left);
    const active = [];
    let overlapPairs = 0;
    let overlapArea = 0;
    for (const current of sorted) {
      for (let i = active.length - 1; i >= 0; i -= 1) {
        if (active[i].right <= current.left) active.splice(i, 1);
      }
      for (const other of active) {
        if (other.bottom <= current.top || other.top >= current.bottom) continue;
        const x0 = Math.max(current.left, other.left);
        const x1 = Math.min(current.right, other.right);
        const y0 = Math.max(current.top, other.top);
        const y1 = Math.min(current.bottom, other.bottom);
        if (x1 <= x0 || y1 <= y0) continue;
        overlapPairs += 1;
        overlapArea += (x1 - x0) * (y1 - y0);
      }
      active.push(current);
    }
    return {
      leaves: rects.length,
      boundsWidth: +(bounds.right - bounds.left).toFixed(1),
      boundsHeight: +(bounds.bottom - bounds.top).toFixed(1),
      boundsArea: +screenArea.toFixed(1),
      sumArea: +sumArea.toFixed(1),
      fillRatio: +(sumArea / screenArea).toFixed(3),
      sampled: sampled.length,
      overlapPairs,
      overlapPairsPerLeaf: +(overlapPairs / Math.max(1, sampled.length)).toFixed(3),
      overlapArea: +overlapArea.toFixed(1),
      overlapAreaPerLeaf: +(overlapArea / Math.max(1, sampled.length)).toFixed(3),
    };
  });
  await page.waitForTimeout(WARMUP_MS);
  const cdp = TRACE ? await page.context().newCDPSession(page) : null;
  const events = cdp ? await startTrace(cdp) : null;
  const start = await page.evaluate(() => window.__probe.samples.length);
  await page.waitForTimeout(SAMPLE_MS);
  const dts = await page.evaluate(
    (from) => window.__probe.samples.slice(from),
    start,
  );
  const caseMetrics = await page.evaluate(() => window.__caseMetrics ?? null);
  const trace = cdp ? await stopTrace(cdp, events) : null;
  await page.close();
  return {
    ...config,
    chromiumArgs: CHROMIUM_ARGS,
    softwareBackend: SOFTWARE_BACKEND,
    caseMetrics: { ...(caseMetrics ?? {}), screen: screenMetrics },
    ...summarizeFrameTimes(dts),
    trace,
  };
}

function printRows(rows) {
  const header = [
    "mode",
    "root",
    "variant",
    "fps_p50",
    "fps_p95",
    "p99",
    "PAC/frame",
    "DrawProps/frame",
    "Draw/frame",
    "case",
  ];
  console.log(header.join("\t"));
  for (const row of rows) {
    console.log([
      row.mode,
      row.root,
      row.variant,
      row.fps_p50.toFixed(1),
      row.fps_p95.toFixed(1),
      row.p99_ms.toFixed(1),
      row.trace ? row.trace.pac.per_frame_ms.toFixed(3) : "",
      row.trace ? row.trace.drawProps.per_frame_ms.toFixed(3) : "",
      row.trace ? row.trace.draw.per_frame_ms.toFixed(3) : "",
      row.caseMetrics
        ? [
            Number.isFinite(row.caseMetrics.fillRatio) ? `fill=${row.caseMetrics.fillRatio}` : "",
            Number.isFinite(row.caseMetrics.estimatedPairOverlap) ? `overlap=${row.caseMetrics.estimatedPairOverlap}` : "",
            row.caseMetrics.screen ? `screenFill=${row.caseMetrics.screen.fillRatio}` : "",
            row.caseMetrics.screen ? `screenOverlap=${row.caseMetrics.screen.overlapPairsPerLeaf}` : "",
            row.caseMetrics.screen ? `screen=${row.caseMetrics.screen.boundsWidth}x${row.caseMetrics.screen.boundsHeight}` : "",
          ].filter(Boolean).join(" ")
        : "",
    ].join("\t"));
  }
}

const configs = [];
if (MODE === "all" || MODE === "topology") {
  for (const variant of ["left-top", "translate2d", "translateZ0", "translateZ", "matrix3d"]) {
    configs.push({ mode: "topology", root: ROOT ?? "css", variant, leaves: LEAVES });
  }
}
if (MODE === "all" || MODE === "distribution") {
  const leaves = MODE === "all" ? Math.min(LEAVES, 1200) : LEAVES;
  for (const variant of ["cluster", "spread", "overlap"]) {
    configs.push({ mode: "distribution", root: ROOT ?? "js", variant, leaves });
  }
}
if (MODE === "all" || MODE === "order") {
  const leaves = MODE === "all" ? Math.min(LEAVES, 2500) : LEAVES;
  for (const variant of ["spatial", "tile4-spatial", "tile4-depth", "tile4-depth-back", "block64-depth", "depth-front", "depth-back", "random"]) {
    if (VARIANT_FILTER.size > 0 && !VARIANT_FILTER.has(variant)) continue;
    configs.push({ mode: "order", root: ROOT ?? "js", variant, leaves });
  }
}
if (MODE === "all" || MODE === "depth-groups") {
  const depthVariants = [
    "leaf-z17",
    "leaf-z50",
    "leaf-z250",
    "leaf-z250-comp",
    "group-z1",
    "group-z2",
    "group-z4",
    "group-z8",
    "group-z12",
    "group-z16",
    "group-z16-comp",
    "group-z17",
    "group-z20",
    "group-z24",
    "group-z28",
    "group-z32",
    "group-z32-comp",
    "group-z34",
    "group-z50",
    "group-z68",
    "group-z80",
    "group-z96",
    "group-z112",
    "group-z128",
    "group-z136",
    "group-z160",
    "group-z192",
    "group-z250",
    "hybrid-z8-d136",
    "hybrid-z16-d136",
    "hybrid-z8-d250",
    "tiled-z16-t2",
    "tiled-z32-t2",
    "tiled-z50-t2",
    "tiled-z68-t2",
    "tiled-z32-t4",
    "tiled-z50-t4",
    "tiled-z68-t4",
    "tiled-z136-t4",
    "tile2d-z250-t2",
    "tile2d-z250-t4",
    "tile2d-z250-t8",
  ];
  for (const variant of depthVariants) {
    if (VARIANT_FILTER.size > 0 && !VARIANT_FILTER.has(variant)) continue;
    configs.push({ mode: "depth-groups", root: ROOT ?? "css", variant, leaves: LEAVES });
  }
}
if (MODE === "all" || MODE === "projection") {
  for (const variant of [
    "static-left-top",
    "static-transform",
    "var-transform",
    "registered-var-transform",
    "var-left-top",
    "registered-var-left-top",
    "translate3d-reference",
  ]) {
    if (VARIANT_FILTER.size > 0 && !VARIANT_FILTER.has(variant)) continue;
    configs.push({ mode: "projection", root: ROOT ?? "vars", variant, leaves: LEAVES });
  }
}
if (configs.length === 0) {
  throw new Error(`Unknown --mode=${MODE}; use all, topology, distribution, order, depth-groups, or projection`);
}

const launchOptions = { headless: !HEADED, args: CHROMIUM_ARGS };
if (EXECUTABLE) launchOptions.executablePath = EXECUTABLE;
const browser = await chromium.launch(launchOptions);
try {
  const rows = [];
  for (const config of configs) {
    rows.push(await runCase(browser, config));
  }
  if (JSON_OUT) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    printRows(rows);
  }
} finally {
  await browser.close();
}
