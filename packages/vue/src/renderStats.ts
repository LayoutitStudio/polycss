export interface PolyRenderSurfaceLeafCounts {
  quad: number;
  clippedSolid: number;
  atlas: number;
  stableTriangle: number;
}

export interface PolyRenderStats {
  polygonCount: number;
  mountedPolygonLeafCount: number;
  shadowLeafCount: number;
  surfaceLeafCounts: PolyRenderSurfaceLeafCounts;
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

const EMPTY_POLY_RENDER_STATS: PolyRenderStats = {
  polygonCount: 0,
  mountedPolygonLeafCount: 0,
  shadowLeafCount: 0,
  surfaceLeafCounts: ZERO_SURFACE_LEAF_COUNTS,
  bucketCount: 0,
};

function asOptions(optionsOrPolygonCount?: number | PolyRenderStatsOptions): PolyRenderStatsOptions {
  if (typeof optionsOrPolygonCount === "number") {
    return { polygonCount: optionsOrPolygonCount };
  }
  return optionsOrPolygonCount ?? {};
}

function queryCount(scope: ParentNode, selector: string): number {
  return scope.querySelectorAll(selector).length;
}

function matchesSelector(root: ParentNode, selector: string): boolean {
  const candidate = root as ParentNode & { matches?: (selector: string) => boolean };
  return typeof candidate.matches === "function" && candidate.matches(selector);
}

function collectScopes(root: ParentNode, selector: string | undefined): ParentNode[] {
  if (!selector) return [root];
  const scopes: ParentNode[] = [];
  if (matchesSelector(root, selector)) scopes.push(root);
  scopes.push(...Array.from(root.querySelectorAll(selector)));
  return scopes;
}

export function collectPolyRenderStats(
  root: ParentNode | null | undefined,
  optionsOrPolygonCount?: number | PolyRenderStatsOptions,
): PolyRenderStats {
  const options = asOptions(optionsOrPolygonCount);
  if (!root) {
    return {
      ...EMPTY_POLY_RENDER_STATS,
      surfaceLeafCounts: { ...ZERO_SURFACE_LEAF_COUNTS },
      polygonCount: options.polygonCount ?? 0,
    };
  }

  const scopes = collectScopes(root, options.scopeSelector);
  const surfaceLeafCounts: PolyRenderSurfaceLeafCounts = { ...ZERO_SURFACE_LEAF_COUNTS };
  let shadowLeafCount = 0;
  let bucketCount = 0;

  for (const scope of scopes) {
    surfaceLeafCounts.quad += queryCount(scope, "b");
    surfaceLeafCounts.clippedSolid += queryCount(scope, "i");
    surfaceLeafCounts.atlas += queryCount(scope, "s");
    surfaceLeafCounts.stableTriangle += queryCount(scope, "u");
    shadowLeafCount += queryCount(scope, "q");
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
    surfaceLeafCounts,
    bucketCount,
  };
}
