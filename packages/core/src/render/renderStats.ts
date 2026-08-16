// Core compiles with lib: ES2020 and no DOM globals, so the DOM surface this
// module reads (querySelectorAll, getAttribute, classList, closest, inline
// style channels) is expressed structurally. Real DOM nodes satisfy these
// shapes; element-ness is discovered at runtime with a structural guard
// instead of `instanceof HTMLElement`.
export interface PolyRenderStatsRoot {
  querySelectorAll(selectors: string): ArrayLike<unknown>;
  querySelector(selectors: string): unknown;
}

export interface PolyRenderStatsElement extends PolyRenderStatsRoot {
  tagName: string;
  getAttribute(name: string): string | null;
  classList: { contains(token: string): boolean };
  closest(selectors: string): unknown;
  style: {
    opacity: string;
    perspective: string;
    transform: string;
    visibility: string;
  };
}

export interface PolyRenderSurfaceLeafCounts {
  quad: number;
  clippedSolid: number;
  atlas: number;
  stableTriangle: number;
}

export type PolyRenderLeafStrategy = keyof PolyRenderSurfaceLeafCounts;

export interface PolyTextureReadiness {
  ready: boolean;
  textureLeafCount: number;
  readyTextureLeafCount: number;
  pendingTextureLeafCount: number;
  atlasTextureLeafCount: number;
  imageTextureLeafCount: number;
}

export interface PolyTextureRenderStats {
  ready: boolean;
  leafCount: number;
  atlasCount: number;
  imageCount: number;
  pendingCount: number;
  sizingCounts: {
    canonical: number;
    local: number;
    raster: number;
    image: number;
    unknown: number;
  };
  imageRenderingCounts: {
    auto: number;
    pixelated: number;
    unknown: number;
  };
  projectionCounts: {
    affine: number;
    projective: number;
    fallback: number;
    unknown: number;
  };
  minLeafWidth: number;
  maxLeafWidth: number;
  minLeafHeight: number;
  maxLeafHeight: number;
  doubleSidedCount: number;
}

export interface PolySnapshotRenderStats {
  runtimeAtlasUrlCount: number;
  snapshotAtlasCount: number;
  snapshotBackgroundCount: number;
  selfContained: boolean;
}

export interface PolyCameraSnapshotStats {
  rootFound: boolean;
  projection: "orthographic" | "perspective" | "unknown";
  perspectiveStyle: string;
  appliedPerspectiveStyle: string;
  zoom?: number;
  distance?: number;
  rotX?: number;
  rotY?: number;
  target?: [number, number, number];
}

export interface PolyLeafInfo {
  element: PolyRenderStatsElement;
  strategy: PolyRenderLeafStrategy;
  polygonIndex?: number;
  textureBackend?: string;
  textureReady?: boolean;
  textureLeafSizing?: string;
  textureImageRendering?: string;
  textureProjection?: string;
  textureLeafWidth?: number;
  textureLeafHeight?: number;
  doubleSided?: boolean;
}

export interface PolyRenderStats {
  polygonCount: number;
  mountedPolygonLeafCount: number;
  shadowLeafCount: number;
  /**
   * Total `<path>` elements across shadow SVGs. Together with
   * `shadowPathDChars` this is the real shadow DOM cost driver — one shadow
   * SVG can hold thousands of subpaths, so the SVG element count alone
   * (`shadowLeafCount`) under-reports emit/repaint weight.
   */
  shadowSubpathCount: number;
  /** Summed `d` attribute character count across shadow SVG paths. */
  shadowPathDChars: number;
  surfaceLeafCounts: PolyRenderSurfaceLeafCounts;
  textureReadiness: PolyTextureReadiness;
  textureStats: PolyTextureRenderStats;
  snapshotStats: PolySnapshotRenderStats;
  cameraStats: PolyCameraSnapshotStats;
  bucketCount: number;
}

export interface PolyRenderStatsOptions {
  polygonCount?: number;
  /**
   * Optional subtree selector for diagnostics that only want model leaves and
   * not helpers/floors/gizmos sharing the same scene root.
   */
  scopeSelector?: string;
}

const ZERO_SURFACE_LEAF_COUNTS: PolyRenderSurfaceLeafCounts = {
  quad: 0,
  clippedSolid: 0,
  atlas: 0,
  stableTriangle: 0,
};

const READY_TEXTURE_READINESS: PolyTextureReadiness = {
  ready: true,
  textureLeafCount: 0,
  readyTextureLeafCount: 0,
  pendingTextureLeafCount: 0,
  atlasTextureLeafCount: 0,
  imageTextureLeafCount: 0,
};

function emptyTextureStats(): PolyTextureRenderStats {
  return {
    ready: true,
    leafCount: 0,
    atlasCount: 0,
    imageCount: 0,
    pendingCount: 0,
    sizingCounts: { canonical: 0, local: 0, raster: 0, image: 0, unknown: 0 },
    imageRenderingCounts: { auto: 0, pixelated: 0, unknown: 0 },
    projectionCounts: { affine: 0, projective: 0, fallback: 0, unknown: 0 },
    minLeafWidth: 0,
    maxLeafWidth: 0,
    minLeafHeight: 0,
    maxLeafHeight: 0,
    doubleSidedCount: 0,
  };
}

function emptySnapshotStats(): PolySnapshotRenderStats {
  return {
    runtimeAtlasUrlCount: 0,
    snapshotAtlasCount: 0,
    snapshotBackgroundCount: 0,
    selfContained: true,
  };
}

function emptyCameraStats(): PolyCameraSnapshotStats {
  return {
    rootFound: false,
    projection: "unknown",
    perspectiveStyle: "",
    appliedPerspectiveStyle: "",
  };
}

const EMPTY_POLY_RENDER_STATS: PolyRenderStats = {
  polygonCount: 0,
  mountedPolygonLeafCount: 0,
  shadowLeafCount: 0,
  shadowSubpathCount: 0,
  shadowPathDChars: 0,
  surfaceLeafCounts: ZERO_SURFACE_LEAF_COUNTS,
  textureReadiness: READY_TEXTURE_READINESS,
  textureStats: emptyTextureStats(),
  snapshotStats: emptySnapshotStats(),
  cameraStats: emptyCameraStats(),
  bucketCount: 0,
};

function asOptions(
  optionsOrPolygonCount?: number | PolyRenderStatsOptions,
): PolyRenderStatsOptions {
  if (typeof optionsOrPolygonCount === "number") {
    return { polygonCount: optionsOrPolygonCount };
  }
  return optionsOrPolygonCount ?? {};
}

function isStatsElement(value: unknown): value is PolyRenderStatsElement {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as {
    getAttribute?: unknown;
    querySelectorAll?: unknown;
    style?: unknown;
  };
  return (
    typeof candidate.getAttribute === "function"
    && typeof candidate.querySelectorAll === "function"
    && typeof candidate.style === "object"
    && candidate.style !== null
  );
}

function queryCount(scope: PolyRenderStatsRoot, selector: string): number {
  return scope.querySelectorAll(selector).length;
}

function matchingElementCount(scope: PolyRenderStatsRoot, selector: string): number {
  return (matchesSelector(scope, selector) ? 1 : 0) + queryCount(scope, selector);
}

function styleHasRuntimeUrl(styleText: string | null): boolean {
  if (!styleText) return false;
  const urlPattern = /url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(styleText))) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (raw && !raw.startsWith("data:")) return true;
  }
  return false;
}

function runtimeUrlElementCount(scope: PolyRenderStatsRoot): number {
  let count = 0;
  const root = isStatsElement(scope) ? scope : null;
  if (root && styleHasRuntimeUrl(root.getAttribute("style"))) count++;
  for (const el of Array.from(scope.querySelectorAll("[style]"))) {
    if (isStatsElement(el) && styleHasRuntimeUrl(el.getAttribute("style"))) count++;
  }
  return count;
}

function matchesSelector(root: PolyRenderStatsRoot, selector: string): boolean {
  const candidate = root as PolyRenderStatsRoot & { matches?: (selector: string) => boolean };
  return typeof candidate.matches === "function" && candidate.matches(selector);
}

function collectScopes(root: PolyRenderStatsRoot, selector: string | undefined): PolyRenderStatsRoot[] {
  if (!selector) return [root];
  const scopes: PolyRenderStatsRoot[] = [];
  if (matchesSelector(root, selector)) scopes.push(root);
  scopes.push(...(Array.from(root.querySelectorAll(selector)) as PolyRenderStatsRoot[]));
  return scopes;
}

function leafStrategyForTag(tagName: string): PolyRenderLeafStrategy | null {
  switch (tagName.toLowerCase()) {
    case "b":
      return "quad";
    case "i":
      return "clippedSolid";
    case "s":
      return "atlas";
    case "u":
      return "stableTriangle";
    default:
      return null;
  }
}

function parseOptionalInteger(value: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalVec3(value: string | null): [number, number, number] | undefined {
  if (value == null || value === "") return undefined;
  const parts = value.split(",").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return parts as [number, number, number];
}

function parseCameraProjection(value: string | null): PolyCameraSnapshotStats["projection"] {
  return value === "orthographic" || value === "perspective" ? value : "unknown";
}

function textureReadyForElement(
  el: PolyRenderStatsElement,
  textureBackend: string | undefined,
): boolean | undefined {
  if (!textureBackend) return undefined;
  const attr = el.getAttribute("data-polycss-texture-ready");
  if (attr === "true") return true;
  if (attr === "false") return false;
  return el.style.opacity !== "0";
}

export function queryPolyLeaves(
  root: PolyRenderStatsRoot | null | undefined,
  optionsOrPolygonCount?: number | PolyRenderStatsOptions,
): PolyLeafInfo[] {
  if (!root) return [];
  const options = asOptions(optionsOrPolygonCount);
  const out: PolyLeafInfo[] = [];
  for (const scope of collectScopes(root, options.scopeSelector)) {
    for (const el of Array.from(scope.querySelectorAll("b,i,s,u"))) {
      const leafEl = el as PolyRenderStatsElement;
      const strategy = leafStrategyForTag(leafEl.tagName);
      if (!strategy) continue;
      const textureBackend = leafEl.getAttribute("data-polycss-texture-backend")
        ?? (strategy === "atlas" ? "atlas" : undefined);
      const textureReady = textureReadyForElement(leafEl, textureBackend);
      out.push({
        element: leafEl,
        strategy,
        polygonIndex: parseOptionalInteger(leafEl.getAttribute("data-poly-index")),
        textureBackend,
        textureReady,
        textureLeafSizing: leafEl.getAttribute("data-polycss-texture-leaf-sizing") ?? undefined,
        textureImageRendering: leafEl.getAttribute("data-polycss-texture-image-rendering") ?? undefined,
        textureProjection: leafEl.getAttribute("data-polycss-texture-projection") ?? undefined,
        textureLeafWidth: parseOptionalNumber(leafEl.getAttribute("data-polycss-texture-leaf-width")),
        textureLeafHeight: parseOptionalNumber(leafEl.getAttribute("data-polycss-texture-leaf-height")),
        doubleSided: leafEl.getAttribute("data-polycss-double-sided") === "true",
      });
    }
  }
  return out;
}

export function collectPolyTextureReadiness(
  root: PolyRenderStatsRoot | null | undefined,
  optionsOrPolygonCount?: number | PolyRenderStatsOptions,
): PolyTextureReadiness {
  const readiness: PolyTextureReadiness = { ...READY_TEXTURE_READINESS };
  for (const leaf of queryPolyLeaves(root, optionsOrPolygonCount)) {
    if (!leaf.textureBackend) continue;
    readiness.textureLeafCount++;
    if (leaf.textureBackend === "image") readiness.imageTextureLeafCount++;
    else readiness.atlasTextureLeafCount++;
    if (leaf.textureReady === false) readiness.pendingTextureLeafCount++;
    else readiness.readyTextureLeafCount++;
  }
  readiness.ready = readiness.pendingTextureLeafCount === 0;
  return readiness;
}

function collectPolyTextureStats(
  root: PolyRenderStatsRoot | null | undefined,
  optionsOrPolygonCount?: number | PolyRenderStatsOptions,
): PolyTextureRenderStats {
  const stats = emptyTextureStats();
  let hasWidth = false;
  let hasHeight = false;
  for (const leaf of queryPolyLeaves(root, optionsOrPolygonCount)) {
    if (!leaf.textureBackend) continue;
    stats.leafCount++;
    if (leaf.textureBackend === "image") stats.imageCount++;
    else stats.atlasCount++;
    if (leaf.textureReady === false) stats.pendingCount++;
    switch (leaf.textureLeafSizing) {
      case "canonical":
      case "local":
      case "raster":
      case "image":
        stats.sizingCounts[leaf.textureLeafSizing]++;
        break;
      default:
        stats.sizingCounts.unknown++;
        break;
    }
    switch (leaf.textureImageRendering) {
      case "auto":
      case "pixelated":
        stats.imageRenderingCounts[leaf.textureImageRendering]++;
        break;
      default:
        stats.imageRenderingCounts.unknown++;
        break;
    }
    switch (leaf.textureProjection) {
      case "affine":
      case "projective":
      case "fallback":
        stats.projectionCounts[leaf.textureProjection]++;
        break;
      default:
        stats.projectionCounts.unknown++;
        break;
    }
    if (typeof leaf.textureLeafWidth === "number") {
      stats.minLeafWidth = hasWidth ? Math.min(stats.minLeafWidth, leaf.textureLeafWidth) : leaf.textureLeafWidth;
      stats.maxLeafWidth = hasWidth ? Math.max(stats.maxLeafWidth, leaf.textureLeafWidth) : leaf.textureLeafWidth;
      hasWidth = true;
    }
    if (typeof leaf.textureLeafHeight === "number") {
      stats.minLeafHeight = hasHeight ? Math.min(stats.minLeafHeight, leaf.textureLeafHeight) : leaf.textureLeafHeight;
      stats.maxLeafHeight = hasHeight ? Math.max(stats.maxLeafHeight, leaf.textureLeafHeight) : leaf.textureLeafHeight;
      hasHeight = true;
    }
    if (leaf.doubleSided) stats.doubleSidedCount++;
  }
  stats.pendingCount = Math.min(stats.pendingCount, stats.leafCount);
  stats.ready = stats.pendingCount === 0;
  return stats;
}

function collectPolySnapshotStats(
  root: PolyRenderStatsRoot | null | undefined,
  optionsOrPolygonCount?: number | PolyRenderStatsOptions,
): PolySnapshotRenderStats {
  const stats = emptySnapshotStats();
  if (!root) return stats;
  const options = asOptions(optionsOrPolygonCount);
  for (const scope of collectScopes(root, options.scopeSelector)) {
    stats.runtimeAtlasUrlCount += runtimeUrlElementCount(scope);
    stats.snapshotAtlasCount += matchingElementCount(scope, "[data-polycss-snapshot-atlas]");
    stats.snapshotBackgroundCount += matchingElementCount(scope, "[data-polycss-snapshot-bg]");
  }
  stats.selfContained = stats.runtimeAtlasUrlCount === 0;
  return stats;
}

function findCameraRoot(scope: PolyRenderStatsRoot): PolyRenderStatsElement | null {
  if (isStatsElement(scope)) {
    if (scope.classList.contains("polycss-camera")) return scope;
    const closest = scope.closest(".polycss-camera");
    if (isStatsElement(closest)) return closest;
  }
  const found = scope.querySelector(".polycss-camera");
  return isStatsElement(found) ? found : null;
}

function collectPolyCameraStats(
  root: PolyRenderStatsRoot | null | undefined,
  optionsOrPolygonCount?: number | PolyRenderStatsOptions,
): PolyCameraSnapshotStats {
  if (!root) return emptyCameraStats();
  const options = asOptions(optionsOrPolygonCount);
  let cameraRoot: PolyRenderStatsElement | null = null;
  for (const scope of collectScopes(root, options.scopeSelector)) {
    cameraRoot = findCameraRoot(scope);
    if (cameraRoot) break;
  }
  if (!cameraRoot) return emptyCameraStats();
  return {
    rootFound: true,
    projection: parseCameraProjection(cameraRoot.getAttribute("data-polycss-camera-projection")),
    perspectiveStyle: cameraRoot.getAttribute("data-polycss-camera-perspective") ?? "",
    appliedPerspectiveStyle: cameraRoot.getAttribute("data-polycss-camera-applied-perspective")
      ?? cameraRoot.style.perspective
      ?? "",
    zoom: parseOptionalNumber(cameraRoot.getAttribute("data-polycss-camera-zoom")),
    distance: parseOptionalNumber(cameraRoot.getAttribute("data-polycss-camera-distance")),
    rotX: parseOptionalNumber(cameraRoot.getAttribute("data-polycss-camera-rot-x")),
    rotY: parseOptionalNumber(cameraRoot.getAttribute("data-polycss-camera-rot-y")),
    target: parseOptionalVec3(cameraRoot.getAttribute("data-polycss-camera-target")),
  };
}

export function collectPolyRenderStats(
  root: PolyRenderStatsRoot | null | undefined,
  optionsOrPolygonCount?: number | PolyRenderStatsOptions,
): PolyRenderStats {
  const options = asOptions(optionsOrPolygonCount);
  if (!root) {
    return {
      ...EMPTY_POLY_RENDER_STATS,
      surfaceLeafCounts: { ...ZERO_SURFACE_LEAF_COUNTS },
      textureReadiness: { ...READY_TEXTURE_READINESS },
      textureStats: emptyTextureStats(),
      snapshotStats: emptySnapshotStats(),
      cameraStats: emptyCameraStats(),
      polygonCount: options.polygonCount ?? 0,
    };
  }

  const scopes = collectScopes(root, options.scopeSelector);
  const surfaceLeafCounts: PolyRenderSurfaceLeafCounts = { ...ZERO_SURFACE_LEAF_COUNTS };
  let shadowLeafCount = 0;
  let shadowSubpathCount = 0;
  let shadowPathDChars = 0;
  let bucketCount = 0;

  for (const scope of scopes) {
    surfaceLeafCounts.quad += queryCount(scope, "b");
    surfaceLeafCounts.clippedSolid += queryCount(scope, "i");
    surfaceLeafCounts.atlas += queryCount(scope, "s");
    surfaceLeafCounts.stableTriangle += queryCount(scope, "u");
    const shadowSvgs = scope.querySelectorAll("q, .polycss-shadow-svg");
    shadowLeafCount += shadowSvgs.length;
    for (let i = 0; i < shadowSvgs.length; i += 1) {
      const svg = shadowSvgs[i];
      if (!isStatsElement(svg)) continue;
      const paths = svg.querySelectorAll("path");
      shadowSubpathCount += paths.length;
      for (let j = 0; j < paths.length; j += 1) {
        const path = paths[j];
        if (isStatsElement(path)) {
          shadowPathDChars += path.getAttribute("d")?.length ?? 0;
        }
      }
    }
    bucketCount += queryCount(scope, ".polycss-bucket");
  }

  const mountedPolygonLeafCount =
    surfaceLeafCounts.quad
    + surfaceLeafCounts.clippedSolid
    + surfaceLeafCounts.atlas
    + surfaceLeafCounts.stableTriangle;
  return {
    polygonCount: options.polygonCount ?? mountedPolygonLeafCount,
    mountedPolygonLeafCount,
    shadowLeafCount,
    shadowSubpathCount,
    shadowPathDChars,
    surfaceLeafCounts,
    textureReadiness: collectPolyTextureReadiness(root, options),
    textureStats: collectPolyTextureStats(root, options),
    snapshotStats: collectPolySnapshotStats(root, options),
    cameraStats: collectPolyCameraStats(root, options),
    bucketCount,
  };
}
