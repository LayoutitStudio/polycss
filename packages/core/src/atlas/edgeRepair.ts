import type { Polygon } from "../types";
import type { Vec3 } from "../types";
import { DEFAULT_TILE, RECT_EPS } from "./constants";
import type { PolySeamBleed, SeamBleedInsets } from "./types";
import { computeSurfaceNormal, cssPoints } from "./solidTriangle";

function pointKey(point: Vec3): string {
  return `${point[0]},${point[1]},${point[2]}`;
}

function edgeKey(a: Vec3, b: Vec3): string {
  const ak = pointKey(a);
  const bk = pointKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

export function buildTextureEdgeRepairSets(polygons: Polygon[]): Array<Set<number> | undefined> {
  const edgeOwners = new Map<string, Array<{ polygon: number; edge: number }>>();
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
    const vertices = polygons[polygonIndex].vertices;
    if (!vertices || vertices.length < 3 || !polygons[polygonIndex].texture) continue;
    for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex++) {
      const key = edgeKey(vertices[edgeIndex], vertices[(edgeIndex + 1) % vertices.length]);
      const owners = edgeOwners.get(key);
      const owner = { polygon: polygonIndex, edge: edgeIndex };
      if (owners) owners.push(owner);
      else edgeOwners.set(key, [owner]);
    }
  }
  const repairEdges = polygons.map(() => new Set<number>());
  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        repairEdges[owners[i].polygon].add(owners[i].edge);
        repairEdges[owners[j].polygon].add(owners[j].edge);
      }
    }
  }
  return repairEdges.map((edges) => edges.size > 0 ? edges : undefined);
}

export function resolveSeamBleed(value: unknown, fallback: number): number {
  return value === "auto"
    ? fallback
    : typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, value)
      : fallback;
}

export function normalizedSeamBleed(value: unknown): PolySeamBleed | undefined {
  if (value === "auto") return "auto";
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export function safePlanSeamBleedAmount(
  screenPts: number[],
  edgeIndex: number,
  requested: number,
): number {
  if (requested <= 0 || screenPts.length < 6 || screenPts.length % 2 !== 0) return 0;
  const count = screenPts.length / 2;
  if (edgeIndex < 0 || edgeIndex >= count) return 0;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < screenPts.length; i += 2) {
    points.push([screenPts[i], screenPts[i + 1]]);
  }
  const [ax, ay] = points[edgeIndex];
  const [bx, by] = points[(edgeIndex + 1) % count];
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length <= RECT_EPS) return 0;

  const limits: number[] = [];
  let oppositeClearance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < count; i += 1) {
    if (i === edgeIndex || i === (edgeIndex + 1) % count) continue;
    const [px, py] = points[i];
    const distance = Math.abs((px - ax) * dy - (py - ay) * dx) / length;
    if (distance > RECT_EPS) oppositeClearance = Math.min(oppositeClearance, distance);
  }
  if (Number.isFinite(oppositeClearance)) limits.push(oppositeClearance * 0.5);

  const previous = points[(edgeIndex + count - 1) % count];
  const next = points[(edgeIndex + 2) % count];
  const previousDx = previous[0] - ax;
  const previousDy = previous[1] - ay;
  const nextDx = next[0] - bx;
  const nextDy = next[1] - by;
  const previousLength = Math.hypot(previousDx, previousDy);
  const nextLength = Math.hypot(nextDx, nextDy);
  if (previousLength > RECT_EPS) {
    const sin = Math.abs(dx * previousDy - dy * previousDx) / (length * previousLength);
    if (sin > RECT_EPS) limits.push(previousLength * sin);
  }
  if (nextLength > RECT_EPS) {
    const sin = Math.abs((-dx) * nextDy - (-dy) * nextDx) / (length * nextLength);
    if (sin > RECT_EPS) limits.push(nextLength * sin);
  }

  const finiteLimits = limits.filter((limit) => Number.isFinite(limit) && limit > 0);
  if (finiteLimits.length === 0) return Number.isFinite(requested) ? Math.max(0, requested) : 0;
  const fit = Math.min(...finiteLimits);
  return Math.max(0, Math.min(Number.isFinite(requested) ? requested : fit, fit));
}

export function computePlanSeamBleedEdgeAmounts(
  screenPts: number[],
  seamEdges: ReadonlySet<number> | undefined,
  seamBleed: PolySeamBleed | undefined,
): Map<number, number> | undefined {
  if (!seamEdges?.size || seamBleed === undefined) return undefined;
  const amounts = new Map<number, number>();
  const request = seamBleed === "auto" ? Number.POSITIVE_INFINITY : seamBleed;
  for (const edgeIndex of seamEdges) {
    const amount = safePlanSeamBleedAmount(screenPts, edgeIndex, request);
    if (amount > 0) amounts.set(edgeIndex, amount);
  }
  return amounts.size > 0 ? amounts : undefined;
}

export function seamBleedAmountArray(
  vertexCount: number,
  edgeAmounts: ReadonlyMap<number, number> | undefined,
): number[] | null {
  if (vertexCount < 3 || !edgeAmounts?.size) return null;
  return Array.from({ length: vertexCount }, (_, edgeIndex) =>
    Math.max(0, edgeAmounts.get(edgeIndex) ?? 0)
  );
}

export function computeSeamBleedInsets(
  screenPts: number[],
  edgeAmounts: ReadonlyMap<number, number> | undefined,
): SeamBleedInsets | undefined {
  if (!edgeAmounts?.size || screenPts.length < 6 || screenPts.length % 2 !== 0) {
    return undefined;
  }

  const count = screenPts.length / 2;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < screenPts.length; i += 2) {
    const x = screenPts[i];
    const y = screenPts[i + 1];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX + minY + maxX + maxY)) return undefined;

  const tol = Math.max(RECT_EPS * 8, 0.25);
  const insets: SeamBleedInsets = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const [edgeIndex, edgeBleed] of edgeAmounts) {
    const bleed = Math.max(0, edgeBleed);
    if (bleed <= 0) continue;
    if (edgeIndex < 0 || edgeIndex >= count) continue;
    const aOffset = edgeIndex * 2;
    const bOffset = ((edgeIndex + 1) % count) * 2;
    const ax = screenPts[aOffset];
    const ay = screenPts[aOffset + 1];
    const bx = screenPts[bOffset];
    const by = screenPts[bOffset + 1];
    if (Math.abs(ax - bx) <= tol) {
      if (Math.abs(ax - minX) <= tol && Math.abs(bx - minX) <= tol) {
        insets.left = Math.max(insets.left, bleed);
      } else if (Math.abs(ax - maxX) <= tol && Math.abs(bx - maxX) <= tol) {
        insets.right = Math.max(insets.right, bleed);
      }
    } else if (Math.abs(ay - by) <= tol) {
      if (Math.abs(ay - minY) <= tol && Math.abs(by - minY) <= tol) {
        insets.top = Math.max(insets.top, bleed);
      } else if (Math.abs(ay - maxY) <= tol && Math.abs(by - maxY) <= tol) {
        insets.bottom = Math.max(insets.bottom, bleed);
      }
    }
  }

  return insets.left || insets.right || insets.top || insets.bottom
    ? insets
    : undefined;
}

interface SeamBleedSurfaceInfo {
  normal: Vec3;
  planeD: number;
}

interface SeamBleedDetectionOptions {
  tileSize?: number;
  layerElevation?: number;
  directionalLight?: unknown;
  ambientLight?: unknown;
}

function dotVec(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function seamBleedSurfaceInfo(
  polygon: Polygon,
  tile: number,
  elev: number,
): SeamBleedSurfaceInfo | null {
  if (!polygon.vertices || polygon.vertices.length < 3) return null;
  const pts = cssPoints(polygon.vertices, tile, elev);
  const normal = computeSurfaceNormal(pts);
  if (!normal) return null;
  return { normal, planeD: dotVec(normal, pts[0]) };
}

function compatibleSeamBleedMaterials(a: Polygon, b: Polygon): boolean {
  return (a.material?.key ?? a.color ?? "") === (b.material?.key ?? b.color ?? "") &&
    a.color === b.color;
}

export function buildSeamBleedPolygonSet(
  polygons: Polygon[],
  options: SeamBleedDetectionOptions = {},
): Set<number> {
  return new Set(buildSeamBleedPolygonEdges(polygons, options).keys());
}

export function buildSeamBleedPolygonEdges(
  polygons: Polygon[],
  options: SeamBleedDetectionOptions = {},
): Map<number, Set<number>> {
  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? tile;
  const infos = polygons.map((polygon) => seamBleedSurfaceInfo(polygon, tile, elev));
  const edgeOwners = new Map<string, Array<{ polygon: number; edge: number }>>();
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
    const vertices = polygons[polygonIndex].vertices;
    if (!vertices || vertices.length < 3) continue;
    for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex++) {
      const key = edgeKey(vertices[edgeIndex], vertices[(edgeIndex + 1) % vertices.length]);
      const owners = edgeOwners.get(key);
      const owner = { polygon: polygonIndex, edge: edgeIndex };
      if (owners) owners.push(owner);
      else edgeOwners.set(key, [owner]);
    }
  }

  const seamEdges = new Map<number, Set<number>>();
  const addSeamEdge = (polygonIndex: number, edgeIndex: number): void => {
    const edges = seamEdges.get(polygonIndex);
    if (edges) edges.add(edgeIndex);
    else seamEdges.set(polygonIndex, new Set([edgeIndex]));
  };
  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const aOwner = owners[i];
        const bOwner = owners[j];
        const a = aOwner.polygon;
        const b = bOwner.polygon;
        if (!infos[a] || !infos[b]) continue;
        if (!compatibleSeamBleedMaterials(polygons[a], polygons[b])) continue;
        addSeamEdge(a, aOwner.edge);
        addSeamEdge(b, bOwner.edge);
      }
    }
  }
  return seamEdges;
}
