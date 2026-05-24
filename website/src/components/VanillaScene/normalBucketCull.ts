import type { Polygon } from "@layoutit/polycss-react";

const NORMAL_BUCKET_CULL_DATA_KEY = "polycss-normal-cull-index";
const NORMAL_BUCKET_CULL_ATTR = `data-${NORMAL_BUCKET_CULL_DATA_KEY}`;
const NORMAL_BUCKET_CULL_CLASS = "polycss-normal-cull-bucket";
const DEFAULT_NORMAL_BUCKET_CULL_DECIMALS = 0;
const DEFAULT_NORMAL_BUCKET_CULL_MIN_BUCKET_SIZE = 64;
const DEFAULT_NORMAL_BUCKET_CULL_MODE: NormalBucketCullMode = "display";

type NormalBucketCullMode =
  | "unmount"
  | "display"
  | "visibility"
  | "content"
  | "clip"
  | "opacity"
  | "transform"
  | "scale"
  | "backface"
  | "leaf-backface"
  | "leaf-display"
  | "leaf-visibility"
  | "compute";

type Vec3Tuple = [number, number, number];

interface NormalBucketGroup {
  normal: Vec3Tuple;
  indexes: number[];
}

interface NormalBucketEntry {
  kind: "bucket" | "leaf";
  element: HTMLElement | null;
  marker: Comment | null;
  leaves: HTMLElement[];
  normal: Vec3Tuple;
  size: number;
  visible: boolean;
  mounted: boolean;
}

export interface NormalBucketCullStats {
  total: number;
  visible: number;
  hidden: number;
  leaves: number;
  visibleLeaves: number;
  hiddenLeaves: number;
  changed: number;
}

export interface NormalBucketCullController {
  update(rotX: number, rotY: number): NormalBucketCullStats;
  dispose(): void;
}

interface NormalBucketCullDebugSample extends NormalBucketCullStats {
  mode: NormalBucketCullMode;
  durationMs: number;
  mountedBuckets: number;
  unmountedBuckets: number;
}

interface NormalBucketCullDebugWindow extends Window {
  __polycssNormalBucketCullMode?: NormalBucketCullMode;
  __polycssNormalBucketCullDecimals?: number;
  __polycssNormalBucketCullMinBucketSize?: number;
  __polycssNormalBucketCullSamples?: NormalBucketCullDebugSample[];
}

export function withNormalBucketCullIndexes(polygons: Polygon[]): Polygon[] {
  return polygons.map((polygon, index) => ({
    ...polygon,
    data: {
      ...polygon.data,
      [NORMAL_BUCKET_CULL_DATA_KEY]: index,
    },
  }));
}

export function createNormalBucketCullController(
  root: HTMLElement,
  polygons: Polygon[],
): NormalBucketCullController | null {
  const settings = normalBucketCullSettings(root);
  const groups = buildNormalGroups(polygons, settings.decimals);
  if (groups.size === 0) return null;
  const useLeafMode =
    settings.mode === "leaf-backface" ||
    settings.mode === "leaf-display" ||
    settings.mode === "leaf-visibility";

  const leafByIndex = new Map<number, HTMLElement>();
  for (const leaf of root.querySelectorAll<HTMLElement>(`[${NORMAL_BUCKET_CULL_ATTR}]`)) {
    if (!isPolygonLeaf(leaf)) continue;
    const index = Number(leaf.getAttribute(NORMAL_BUCKET_CULL_ATTR));
    if (Number.isFinite(index)) leafByIndex.set(index, leaf);
  }
  if (leafByIndex.size === 0) return null;

  const entries: NormalBucketEntry[] = [];
  if (settings.mode === "leaf-backface") {
    const leaves = Array.from(leafByIndex.values())
      .filter((leaf) => !!leaf.parentElement)
      .sort(compareDocumentOrder);
    if (leaves.length === 0) return null;
    const entry: NormalBucketEntry = {
      kind: "leaf",
      element: null,
      marker: null,
      leaves,
      normal: [0, 0, 1],
      size: leaves.length,
      visible: true,
      mounted: true,
    };
    applyLeafVisibility(entry, true, settings.mode);
    entries.push(entry);
  } else {
    for (const group of groups.values()) {
      if (group.indexes.length < settings.minBucketSize) continue;
      const leaves = group.indexes
        .map((index) => leafByIndex.get(index))
        .filter((leaf): leaf is HTMLElement => !!leaf?.parentElement);
      if (leaves.length < settings.minBucketSize) continue;
      leaves.sort(compareDocumentOrder);

      if (useLeafMode) {
        entries.push({
          kind: "leaf",
          element: null,
          marker: null,
          leaves,
          normal: group.normal,
          size: leaves.length,
          visible: true,
          mounted: true,
        });
        continue;
      }

      const parent = leaves[0].parentElement;
      if (!parent) continue;

      const bucket = root.ownerDocument.createElement("div");
      bucket.className = NORMAL_BUCKET_CULL_CLASS;
      bucket.style.position = "absolute";
      bucket.style.transformStyle = "preserve-3d";
      bucket.dataset.cullNormal = group.normal.join(",");
      const marker = root.ownerDocument.createComment("polycss normal bucket cull");
      parent.insertBefore(marker, leaves[0]);
      parent.insertBefore(bucket, marker.nextSibling);
      for (const leaf of leaves) bucket.appendChild(leaf);

      entries.push({
        kind: "bucket",
        element: bucket,
        marker,
        leaves,
        normal: group.normal,
        size: leaves.length,
        visible: true,
        mounted: true,
      });
    }
  }

  if (entries.length === 0) return null;

  const update = (rotX: number, rotY: number): NormalBucketCullStats => {
    const started = performance.now();
    const mode = normalBucketCullSettings(root).mode;
    let visible = 0;
    let visibleLeaves = 0;
    let changed = 0;
    let leaves = 0;

    for (const entry of entries) {
      leaves += entry.size;
      const nextVisible = rotateNormal(entry.normal, rotX, rotY)[2] >= 0;
      if (nextVisible) {
        visible += 1;
        visibleLeaves += entry.size;
      }
      if (entry.visible !== nextVisible) {
        applyBucketVisibility(entry, nextVisible, mode);
        entry.visible = nextVisible;
        changed += 1;
      }
    }

    const stats = {
      total: entries.length,
      visible,
      hidden: entries.length - visible,
      leaves,
      visibleLeaves,
      hiddenLeaves: leaves - visibleLeaves,
      changed,
    };
    recordDebugSample(root, {
      ...stats,
      mode,
      durationMs: performance.now() - started,
      mountedBuckets: entries.reduce(
        (sum, entry) => sum + (entry.kind === "bucket" && entry.mounted ? 1 : 0),
        0,
      ),
      unmountedBuckets: entries.reduce(
        (sum, entry) => sum + (entry.kind === "bucket" && !entry.mounted ? 1 : 0),
        0,
      ),
    });
    return stats;
  };

  return {
    update,
    dispose() {
      for (const entry of entries) {
        resetEntryVisibility(entry);
        if (entry.kind === "leaf") continue;
        const { element, marker } = entry;
        if (!element || !marker) continue;
        const parent = marker.parentNode;
        if (!parent) {
          element.remove();
          continue;
        }
        const before = marker.nextSibling;
        while (element.firstChild) {
          parent.insertBefore(element.firstChild, before);
        }
        element.remove();
        marker.remove();
        entry.mounted = false;
      }
      for (const leaf of leafByIndex.values()) {
        leaf.style.display = "";
      }
    },
  };
}

function normalBucketCullSettings(root: HTMLElement): {
  mode: NormalBucketCullMode;
  decimals: number;
  minBucketSize: number;
} {
  const win = root.ownerDocument.defaultView as NormalBucketCullDebugWindow | null;
  const mode = win?.__polycssNormalBucketCullMode;
  const decimals = win?.__polycssNormalBucketCullDecimals;
  const minBucketSize = win?.__polycssNormalBucketCullMinBucketSize;
  return {
    mode: isNormalBucketCullMode(mode)
      ? mode
      : DEFAULT_NORMAL_BUCKET_CULL_MODE,
    decimals: Number.isFinite(decimals)
      ? Math.max(0, Math.min(4, Math.floor(decimals!)))
      : DEFAULT_NORMAL_BUCKET_CULL_DECIMALS,
    minBucketSize: Number.isFinite(minBucketSize)
      ? Math.max(2, Math.floor(minBucketSize!))
      : DEFAULT_NORMAL_BUCKET_CULL_MIN_BUCKET_SIZE,
  };
}

function isNormalBucketCullMode(mode: unknown): mode is NormalBucketCullMode {
  return (
    mode === "unmount" ||
    mode === "display" ||
    mode === "visibility" ||
    mode === "content" ||
    mode === "clip" ||
    mode === "opacity" ||
    mode === "transform" ||
    mode === "scale" ||
    mode === "backface" ||
    mode === "leaf-backface" ||
    mode === "leaf-display" ||
    mode === "leaf-visibility" ||
    mode === "compute"
  );
}

function recordDebugSample(root: HTMLElement, sample: NormalBucketCullDebugSample): void {
  const win = root.ownerDocument.defaultView as NormalBucketCullDebugWindow | null;
  if (!win?.__polycssNormalBucketCullSamples) return;
  win.__polycssNormalBucketCullSamples.push(sample);
}

function applyBucketVisibility(
  entry: NormalBucketEntry,
  visible: boolean,
  mode: NormalBucketCullMode,
): void {
  if (mode === "compute") return;
  if (entry.kind === "leaf") {
    applyLeafVisibility(entry, visible, mode);
    return;
  }
  const element = entry.element;
  if (!element) return;
  if (mode === "display") {
    if (!entry.mounted) mountBucket(entry);
    resetBucketVisibility(element);
    element.style.display = visible ? "" : "none";
    return;
  }
  if (mode === "visibility") {
    if (!entry.mounted) mountBucket(entry);
    resetBucketVisibility(element);
    element.style.visibility = visible ? "" : "hidden";
    return;
  }
  if (mode === "content") {
    if (!entry.mounted) mountBucket(entry);
    resetBucketVisibility(element);
    element.style.contentVisibility = visible ? "" : "hidden";
    return;
  }
  if (mode === "clip") {
    if (!entry.mounted) mountBucket(entry);
    resetBucketVisibility(element);
    if (!visible) {
      element.style.overflow = "hidden";
      element.style.width = "0px";
      element.style.height = "0px";
    }
    return;
  }
  if (mode === "opacity") {
    if (!entry.mounted) mountBucket(entry);
    resetBucketVisibility(element);
    element.style.opacity = visible ? "" : "0";
    return;
  }
  if (mode === "transform") {
    if (!entry.mounted) mountBucket(entry);
    resetBucketVisibility(element);
    element.style.transform = visible ? "" : "translate3d(-100000px, -100000px, 0)";
    return;
  }
  if (mode === "scale") {
    if (!entry.mounted) mountBucket(entry);
    resetBucketVisibility(element);
    element.style.transform = visible ? "" : "scale3d(0, 0, 0)";
    return;
  }
  if (mode === "backface") {
    if (!entry.mounted) mountBucket(entry);
    resetBucketVisibility(element);
    if (!visible) {
      element.style.backfaceVisibility = "hidden";
      element.style.setProperty("-webkit-backface-visibility", "hidden");
      element.style.transform = "rotateY(180deg)";
    }
    return;
  }
  resetBucketVisibility(element);
  if (visible) {
    mountBucket(entry);
  } else {
    unmountBucket(entry);
  }
}

function applyLeafVisibility(
  entry: NormalBucketEntry,
  visible: boolean,
  mode: NormalBucketCullMode,
): void {
  for (const leaf of entry.leaves) {
    leaf.style.display = "";
    leaf.style.visibility = "";
    leaf.style.backfaceVisibility = "";
    leaf.style.removeProperty("-webkit-backface-visibility");
    if (mode === "leaf-backface") {
      leaf.style.backfaceVisibility = "hidden";
      leaf.style.setProperty("-webkit-backface-visibility", "hidden");
    } else if (mode === "leaf-display") {
      leaf.style.display = visible ? "" : "none";
    } else {
      leaf.style.visibility = visible ? "" : "hidden";
    }
  }
}

function resetEntryVisibility(entry: NormalBucketEntry): void {
  if (entry.element) resetBucketVisibility(entry.element);
  for (const leaf of entry.leaves) {
    leaf.style.display = "";
    leaf.style.visibility = "";
    leaf.style.backfaceVisibility = "";
    leaf.style.removeProperty("-webkit-backface-visibility");
  }
}

function resetBucketVisibility(element: HTMLElement): void {
  element.style.display = "";
  element.style.visibility = "";
  element.style.contentVisibility = "";
  element.style.overflow = "";
  element.style.width = "";
  element.style.height = "";
  element.style.opacity = "";
  element.style.transform = "";
  element.style.backfaceVisibility = "";
  element.style.removeProperty("-webkit-backface-visibility");
}

function mountBucket(entry: NormalBucketEntry): void {
  if (entry.mounted) return;
  const parent = entry.marker?.parentNode;
  if (!parent) return;
  const element = entry.element;
  if (!element) return;
  resetBucketVisibility(element);
  parent.insertBefore(element, entry.marker?.nextSibling ?? null);
  entry.mounted = true;
}

function unmountBucket(entry: NormalBucketEntry): void {
  if (!entry.mounted) return;
  entry.element?.remove();
  entry.mounted = false;
}

function buildNormalGroups(polygons: Polygon[], decimals: number): Map<string, NormalBucketGroup> {
  const groups = new Map<string, NormalBucketGroup>();
  polygons.forEach((polygon, index) => {
    const normal = polygonNormal(polygon);
    const key = normalBucketKey(normal, decimals);
    let group = groups.get(key);
    if (!group) {
      group = { normal: [0, 0, 0], indexes: [] };
      groups.set(key, group);
    }
    group.normal[0] += normal[0];
    group.normal[1] += normal[1];
    group.normal[2] += normal[2];
    group.indexes.push(index);
  });

  for (const group of groups.values()) {
    const len = Math.hypot(group.normal[0], group.normal[1], group.normal[2]) || 1;
    group.normal = [
      group.normal[0] / len,
      group.normal[1] / len,
      group.normal[2] / len,
    ];
  }

  return groups;
}

function polygonNormal(polygon: Polygon): Vec3Tuple {
  const vertices = polygon.vertices;
  if (vertices.length < 3) return [0, 0, 0];
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
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function normalBucketKey(normal: Vec3Tuple, decimals: number): string {
  return normal.map((value) => value.toFixed(decimals)).join(",");
}

function rotateNormal(normal: Vec3Tuple, rotXDeg: number, rotYDeg: number): Vec3Tuple {
  let [x, y, z] = normal;
  const rz = (rotYDeg * Math.PI) / 180;
  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);
  const zx = x * cosZ - y * sinZ;
  const zy = x * sinZ + y * cosZ;
  x = zx;
  y = zy;
  const rx = (rotXDeg * Math.PI) / 180;
  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  return [x, y * cosX - z * sinX, y * sinX + z * cosX];
}

function compareDocumentOrder(a: HTMLElement, b: HTMLElement): number {
  const position = a.compareDocumentPosition(b);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function isPolygonLeaf(element: HTMLElement): boolean {
  return (
    element.tagName === "B" ||
    element.tagName === "I" ||
    element.tagName === "S" ||
    element.tagName === "U"
  );
}
