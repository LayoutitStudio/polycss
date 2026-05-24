import type { Polygon, Vec3 } from "../types";
import type { SeamFacetSplitCandidateReason as SplitReason, SeamFacetSplitOptions as SplitOptions, SeamFacetSplitReport as SplitReport, SeamOverlapCandidate as OverlapCandidate, SeamOverlapCandidateKind as OverlapKind, SeamOverlapDiagnostics as OverlapDiagnostics, SeamOverlapOptions as OverlapOptions } from "./seamRepairTypes";
export type * from "./seamRepairTypes";

type Vec2=[number,number];

type Basis={origin:Vec3;normal:Vec3;xAxis:Vec3;yAxis:Vec3;local:Vec2[];area:number};

type Meta={basis:Basis|null;cssPoints:Vec3[];capacities:number[];patchable:boolean};

type Edge={index:number;polygon:number;edge:number;key:string;a:Vec3;b:Vec3;minX:number;minY:number;minZ:number;maxX:number;maxY:number;maxZ:number;length:number;dir:Vec3;normal:Vec3;outward:Vec3;capacity:number;materialKey:string;color?:string};

type Near={gap:number;facingA:number;facingB:number;aStart:number;aEnd:number;bStart:number;bEnd:number};

type Repair={start:number;end:number;amount:number};

type Split={rotX:number;rotY:number;viewAware:boolean;passes:number;budget:number};

type Overlap={overlapPx:number;maxGapPx:number;capacityScale:number};

const DEFAULT_TILE = 50;
const MAX_NEAR_SEAM_GAP_PX = 14;
const MIN_RESIDUAL_PATCH_GAP_PX = 0.25;
const SEAM_SPLIT_INTERNAL_OVERLAP_PX = 1.25;
const SEAM_SPLIT_EDGE_OVERLAP_PX = 0.75;
const DEFAULT_SEAM_SPLIT_BUDGET = 40;
const MIN_PARALLEL_DOT = 0.985;
const MIN_FACING_DOT = 0.5;
const TRUE_GAP_OVERLAP_AMOUNT_RATIO = 0.175;
const DEFAULT_TRUE_GAP_OVERLAP_PX = 1.25;
const NEAR_SEAM_SWEEP_RECORD_LIMIT = 10000;
const NEAR_SEAM_SWEEP_PAIR_LIMIT = 2_000_000;
const NEAR_SEAM_EXTENDED_SWEEP_PAIR_LIMIT = 25_000_000;
const NEAR_SEAM_GRID_AVG_CELLS_PER_RECORD_LIMIT = 256;
const NEAR_SEAM_GRID_MAX_CELLS_PER_RECORD_LIMIT = 8192;
const EPS = 1e-6;
const TOPOLOGY_EPS = 1e-4;

export const DEFAULT_SEAM_OVERLAP_OPTIONS = {
  overlapPx: DEFAULT_TRUE_GAP_OVERLAP_PX,
  maxGapPx: MAX_NEAR_SEAM_GAP_PX,
  capacityScale: 1,
} as const satisfies OverlapOptions;

export const DEFAULT_SEAM_FACET_SPLIT_OPTIONS = {
  budget: DEFAULT_SEAM_SPLIT_BUDGET,
} as const satisfies SplitOptions;

function finiteOr(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function resolveSeamOverlapOptions(
  options?: number | OverlapOptions,
) {
  if (typeof options === "number") {
    return {
      overlapPx: Math.max(0, options) * TRUE_GAP_OVERLAP_AMOUNT_RATIO,
      maxGapPx: MAX_NEAR_SEAM_GAP_PX,
      capacityScale: 1,
    };
  }

  return {
    overlapPx: Math.max(0, finiteOr(options?.overlapPx, DEFAULT_TRUE_GAP_OVERLAP_PX)),
    maxGapPx: Math.max(0, finiteOr(options?.maxGapPx, MAX_NEAR_SEAM_GAP_PX)),
    capacityScale: Math.max(0, finiteOr(options?.capacityScale, 1)),
  };
}

function seamOverlapEnabled(
  options: Overlap,
  rawOptions?: number | OverlapOptions,
) {
  return !(typeof rawOptions === "number" && rawOptions <= 0) && options.maxGapPx > EPS && options.capacityScale > EPS;
}

function resolveSeamFacetSplitOptions(options?: SplitOptions) {
  return {
    rotX: finiteOr(options?.rotX, 65),
    rotY: finiteOr(options?.rotY, 45),
    viewAware: options?.viewAware !== false,
    passes: Math.max(1, Math.min(3, Math.round(finiteOr(options?.passes, 2)))),
    budget: Math.max(0, Math.min(256, Math.round(finiteOr(options?.budget, DEFAULT_SEAM_SPLIT_BUDGET)))),
  };
}

function cssPoints(vertices: Vec3[]): Vec3[] {
  return vertices.map((v): Vec3 => [v[1] * DEFAULT_TILE, v[0] * DEFAULT_TILE, v[2] * DEFAULT_TILE]);
}

function fromCssPoint(point: Vec3): Vec3 {
  return [point[1] / DEFAULT_TILE, point[0] / DEFAULT_TILE, point[2] / DEFAULT_TILE];
}

function pointKey(point: Vec3) {
  return `${point[0]},${point[1]},${point[2]}`;
}

function edgeKey(a: Vec3, b: Vec3) {
  const ak = pointKey(a);
  const bk = pointKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(a: Vec3) {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: Vec3): Vec3 | null {
  const len = length(a);
  return len > EPS ? [a[0] / len, a[1] / len, a[2] / len] : null;
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function rotateCssVec3(v: Vec3, rxDeg: number, ryDeg: number, rzDeg: number): Vec3 {
  const dx = (rxDeg * Math.PI) / 180;
  const dy = (ryDeg * Math.PI) / 180;
  const dz = (rzDeg * Math.PI) / 180;
  let [x, y, z] = v;
  if (dz !== 0) {
    const c = Math.cos(dz), s = Math.sin(dz);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  if (dy !== 0) {
    const c = Math.cos(dy), s = Math.sin(dy);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  if (dx !== 0) {
    const c = Math.cos(dx), s = Math.sin(dx);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  return [x, y, z];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function surfaceNormal(points: Vec3[]): Vec3 | null {
  if (points.length < 3) return null;
  const origin = points[0];
  const normal: Vec3 = [0, 0, 0];
  for (let i = 1; i + 1 < points.length; i += 1) {
    const a = sub(points[i], origin);
    const b = sub(points[i + 1], origin);
    const n = cross(a, b);
    normal[0] -= n[0];
    normal[1] -= n[1];
    normal[2] -= n[2];
  }
  return normalize(normal);
}

function localBasis(points: Vec3[]): Basis | null {
  const origin = points[0];
  const normal = surfaceNormal(points);
  if (!normal) return null;

  let rawXAxis: Vec3 | null = null;
  for (let i = 0; i < points.length; i += 1) {
    const edge = sub(points[(i + 1) % points.length], points[i]);
    if (length(edge) > EPS) {
      rawXAxis = edge;
      break;
    }
  }
  if (!rawXAxis) return null;

  const projected = dot(rawXAxis, normal);
  const xRaw: Vec3 = [
    rawXAxis[0] - projected * normal[0],
    rawXAxis[1] - projected * normal[1],
    rawXAxis[2] - projected * normal[2],
  ];
  const xAxis = normalize(xRaw);
  if (!xAxis) return null;
  const yAxis = normalize(cross(normal, xAxis));
  if (!yAxis) return null;

  const local = points.map((point): Vec2 => {
    const d = sub(point, origin);
    return [dot(d, xAxis), dot(d, yAxis)];
  });
  const area = signedArea(local);
  return Math.abs(area) > EPS ? { origin, normal, xAxis, yAxis, local, area } : null;
}

function signedArea(points: Vec2[]) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - a[1] * b[0];
  }
  return area / 2;
}

function isWeaklyConvex(points: Vec2[]) {
  if (points.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    const crossValue = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(crossValue) <= EPS) continue;
    const nextSign = Math.sign(crossValue);
    if (sign === 0) sign = nextSign;
    else if (nextSign !== sign) return false;
  }
  return true;
}

function edgeOutward2D(points: Vec2[], area: number, edgeIndex: number): Vec2 | null {
  const a = points[edgeIndex];
  const b = points[(edgeIndex + 1) % points.length];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const edgeLength = Math.hypot(dx, dy);
  if (edgeLength <= EPS) return null;
  const outwardSign = area > 0 ? 1 : -1;
  return [
    outwardSign * (dy / edgeLength),
    outwardSign * (-dx / edgeLength),
  ];
}

function edgeOutward3D(basis: Basis, edgeIndex: number): Vec3 | null {
  const outward = edgeOutward2D(basis.local, basis.area, edgeIndex);
  if (!outward) return null;
  return normalize([
    basis.xAxis[0] * outward[0] + basis.yAxis[0] * outward[1],
    basis.xAxis[1] * outward[0] + basis.yAxis[1] * outward[1],
    basis.xAxis[2] * outward[0] + basis.yAxis[2] * outward[1],
  ]);
}

function edgeSafeCapacity(points: Vec2[], edgeIndex: number) {
  const count = points.length;
  const a = points[edgeIndex];
  const b = points[(edgeIndex + 1) % count];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const edgeLength = Math.hypot(dx, dy);
  if (edgeLength <= EPS) return 0;

  const limits = [edgeLength * 0.24];
  let oppositeClearance = Infinity;
  for (let i = 0; i < count; i += 1) {
    if (i === edgeIndex || i === (edgeIndex + 1) % count) continue;
    const p = points[i];
    const distance = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / edgeLength;
    if (distance > EPS) oppositeClearance = Math.min(oppositeClearance, distance);
  }
  if (Number.isFinite(oppositeClearance)) limits.push(oppositeClearance * 0.32);

  const adjacentChecks: Array<{ origin: Vec2; point: Vec2 }> = [
    { origin: a, point: points[(edgeIndex + count - 1) % count] },
    { origin: b, point: points[(edgeIndex + 2) % count] },
  ];
  for (const adjacent of adjacentChecks) {
    const adx = adjacent.point[0] - adjacent.origin[0];
    const ady = adjacent.point[1] - adjacent.origin[1];
    const adjacentLength = Math.hypot(adx, ady);
    if (adjacentLength <= EPS) continue;
    const sin = Math.abs(dx * ady - dy * adx) / (edgeLength * adjacentLength);
    if (sin > EPS) limits.push(adjacentLength * sin * 0.32);
  }

  return Math.min(...limits);
}

function buildPolygonMetas(polygons: Polygon[]) {
  return polygons.map((polygon): Meta => {
    const css = cssPoints(polygon.vertices);
    const basis = localBasis(css);
    const patchable = !hasTexture(polygon) && !!basis && isWeaklyConvex(basis.local);
    const capacities = patchable
      ? basis!.local.map((_, edgeIndex) => edgeSafeCapacity(basis!.local, edgeIndex))
      : [];
    return {
      basis,
      cssPoints: css,
      capacities,
      patchable,
    };
  });
}

function hasTexture(polygon: Polygon) {
  return !!(polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length);
}

function materialKey(polygon: Polygon) {
  return polygon.material?.key ?? polygon.color ?? "";
}

function buildEdgeRecords(
  polygons: Polygon[],
  metas: Meta[],
  capacityScale: number,
) {
  const records: Edge[] = [];
  for (let polygonIndex = 0; polygonIndex < metas.length; polygonIndex += 1) {
    const meta = metas[polygonIndex];
    if (!meta.patchable || !meta.basis) continue;
    for (let edgeIndex = 0; edgeIndex < meta.cssPoints.length; edgeIndex += 1) {
      const a = meta.cssPoints[edgeIndex];
      const b = meta.cssPoints[(edgeIndex + 1) % meta.cssPoints.length];
      const edge = sub(b, a);
      const edgeLength = length(edge);
      const dir = normalize(edge);
      const outward = edgeOutward3D(meta.basis, edgeIndex);
      const capacity = (meta.capacities[edgeIndex] ?? 0) * capacityScale;
      if (!dir || !outward || capacity <= EPS || edgeLength <= EPS) continue;
      records.push({
        index: records.length,
        polygon: polygonIndex,
        edge: edgeIndex,
        key: edgeKey(a, b),
        a,
        b,
        minX: Math.min(a[0], b[0]),
        minY: Math.min(a[1], b[1]),
        minZ: Math.min(a[2], b[2]),
        maxX: Math.max(a[0], b[0]),
        maxY: Math.max(a[1], b[1]),
        maxZ: Math.max(a[2], b[2]),
        length: edgeLength,
        dir,
        normal: meta.basis.normal,
        outward,
        capacity,
        materialKey: materialKey(polygons[polygonIndex]),
        color: polygons[polygonIndex].color,
      });
    }
  }
  return records;
}

function compatibleRepairMaterials(a: Edge, b: Edge) {
  return a.materialKey === b.materialKey && a.color === b.color;
}

function sameTopologyPoint(a: Vec3, b: Vec3) {
  return length(sub(a, b)) <= TOPOLOGY_EPS;
}

function edgeRecordsTouch(a: Edge, b: Edge) {
  return sameTopologyPoint(a.a, b.a) ||
    sameTopologyPoint(a.a, b.b) ||
    sameTopologyPoint(a.b, b.a) ||
    sameTopologyPoint(a.b, b.b);
}

function classifyCandidate(a: Edge, b: Edge) {
  return compatibleRepairMaterials(a, b)
    ? edgeRecordsTouch(a, b) ? "connected-facet" : "true-gap"
    : "material-boundary";
}

function seamOverlapCandidate(
  kind: OverlapKind,
  a: Edge,
  b: Edge,
  info: Near,
  targetClosurePx: number,
  appliedClosurePx: number,
) {
  return {
    kind,
    aPolygon: a.polygon,
    aEdge: a.edge,
    bPolygon: b.polygon,
    bEdge: b.edge,
    aColor: a.color,
    bColor: b.color,
    aMaterialKey: a.materialKey,
    bMaterialKey: b.materialKey,
    gapPx: info.gap,
    spanPx: info.aEnd - info.aStart,
    aStartPx: info.aStart,
    aEndPx: info.aEnd,
    bStartPx: info.bStart,
    bEndPx: info.bEnd,
    targetClosurePx,
    appliedClosurePx,
    residualGapPx: Math.max(0, info.gap - appliedClosurePx),
    residualTargetPx: Math.max(0, targetClosurePx - appliedClosurePx),
  };
}

function addEdgeRepair(
  repairs: Array<Map<number, Repair[]>>,
  record: Edge,
  start: number,
  end: number,
  amount: number,
) {
  const clippedStart = Math.max(0, Math.min(record.length, Math.min(start, end)));
  const clippedEnd = Math.max(0, Math.min(record.length, Math.max(start, end)));
  if (amount <= EPS || clippedEnd - clippedStart <= EPS) return;
  const current = repairs[record.polygon].get(record.edge);
  const segment = { start: clippedStart, end: clippedEnd, amount };
  if (current) current.push(segment);
  else repairs[record.polygon].set(record.edge, [segment]);
}

function emptyDiagnostics() {
  return {
    exactPairs: 0,
    nearPairs: 0,
    patchedPolygons: 0,
    patchedEdges: 0,
    maxMeasuredGapPx: 0,
    maxAppliedAmountPx: 0,
    unclosedPairs: 0,
    maxResidualGapPx: 0,
  };
}

function finishDiagnostics(
  repairs: Array<Map<number, Repair[]>>,
  diagnostics: OverlapDiagnostics,
) {
  let maxAppliedAmountPx = 0;
  let patchedEdges = 0;
  let patchedPolygons = 0;
  for (const polygonRepairs of repairs) {
    if (polygonRepairs.size > 0) patchedPolygons += 1;
    patchedEdges += polygonRepairs.size;
    for (const segments of polygonRepairs.values()) {
      for (const segment of segments) {
        maxAppliedAmountPx = Math.max(maxAppliedAmountPx, segment.amount);
      }
    }
  }
  return {
    ...diagnostics,
    patchedPolygons,
    patchedEdges,
    maxAppliedAmountPx,
  };
}

function buildSeamEdgeAmounts(
  polygons: Polygon[],
  options: Overlap,
  collectCandidates = false,
) {
  const metas = buildPolygonMetas(polygons);
  const records = buildEdgeRecords(polygons, metas, options.capacityScale);
  const repairs = polygons.map(() => new Map<number, Repair[]>());
  const diagnostics = emptyDiagnostics();
  const candidates = collectCandidates ? [] as OverlapCandidate[] : undefined;
  if (records.length === 0) {
    return { edgeRepairs: repairs, diagnostics, candidates };
  }

  const edgeOwners = new Map<string, Edge[]>();
  for (const record of records) {
    const owners = edgeOwners.get(record.key);
    if (owners) owners.push(record);
    else edgeOwners.set(record.key, [record]);
  }

  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;
    diagnostics.exactPairs += owners.length === 2 ? 1 : owners.length;
  }

  buildNearSeamEdgeAmounts(records, edgeOwners, repairs, diagnostics, options, candidates);
  return {
    edgeRepairs: repairs,
    diagnostics: finishDiagnostics(repairs, diagnostics),
    candidates,
  };
}

function buildNearSeamEdgeAmounts(
  records: Edge[],
  edgeOwners: ReadonlyMap<string, Edge[]>,
  repairs: Array<Map<number, Repair[]>>,
  diagnostics: OverlapDiagnostics,
  options: Overlap,
  candidates: OverlapCandidate[] | undefined,
) {
  const maxGap = options.maxGapPx;
  const exactSharedKeys = new Set<string>();
  for (const [key, owners] of edgeOwners) {
    if (owners.length > 1) exactSharedKeys.add(key);
  }

  const measurePair = (first: Edge, second: Edge) => {
    const record = first.index < second.index ? first : second;
    const candidate = first.index < second.index ? second : first;
    if (candidate.polygon === record.polygon) return;
    if (record.key === candidate.key && exactSharedKeys.has(record.key)) return;
    if (!candidates && !compatibleRepairMaterials(record, candidate)) return;
    if (!edgeBoundsCouldOverlap(record, candidate, maxGap)) return;
    if (Math.abs(dot(record.dir, candidate.dir)) < MIN_PARALLEL_DOT) return;

    const info = nearSeamInfo(record, candidate, maxGap);
    if (!info) return;
    const kind = classifyCandidate(record, candidate);
    const targetClosure = info.gap + options.overlapPx;
    if (kind === "material-boundary") {
      candidates?.push(seamOverlapCandidate(kind, record, candidate, info, targetClosure, 0));
      return;
    }

    let remainingClosure = targetClosure;
    if (remainingClosure <= MIN_RESIDUAL_PATCH_GAP_PX) {
      candidates?.push(seamOverlapCandidate(kind, record, candidate, info, targetClosure, 0));
      return;
    }

    const maxClosureA = record.capacity * info.facingA;
    const maxClosureB = candidate.capacity * info.facingB;
    let closureA = Math.min(maxClosureA, remainingClosure / 2);
    let closureB = Math.min(maxClosureB, remainingClosure / 2);
    remainingClosure -= closureA + closureB;
    if (remainingClosure > EPS) {
      const extraA = Math.min(maxClosureA - closureA, remainingClosure);
      closureA += extraA;
      remainingClosure -= extraA;
    }
    if (remainingClosure > EPS) {
      const extraB = Math.min(maxClosureB - closureB, remainingClosure);
      closureB += extraB;
      remainingClosure -= extraB;
    }

    candidates?.push(seamOverlapCandidate(kind, record, candidate, info, targetClosure, closureA + closureB));
    if (closureA > EPS) addEdgeRepair(repairs, record, info.aStart, info.aEnd, closureA / info.facingA);
    if (closureB > EPS) addEdgeRepair(repairs, candidate, info.bStart, info.bEnd, closureB / info.facingB);
    diagnostics.nearPairs += 1;
    diagnostics.maxMeasuredGapPx = Math.max(diagnostics.maxMeasuredGapPx, info.gap);
    if (remainingClosure > MIN_RESIDUAL_PATCH_GAP_PX) {
      diagnostics.unclosedPairs += 1;
      diagnostics.maxResidualGapPx = Math.max(diagnostics.maxResidualGapPx, remainingClosure);
    }
  };

  const cellSize = Math.max(MAX_NEAR_SEAM_GAP_PX * 2, maxGap * 2);

  if (records.length <= NEAR_SEAM_SWEEP_RECORD_LIMIT) {
    const sorted = [...records].sort((a, b) => a.minX - b.minX);
    const sweepEnds = new Int32Array(sorted.length);
    let sweepPairCount = 0;
    for (let i = 0; i + 1 < sorted.length; i += 1) {
      const record = sorted[i];
      const maxX = record.maxX + maxGap;
      let end = i + 1;
      while (end < sorted.length && sorted[end].minX <= maxX) end += 1;
      sweepEnds[i] = end;
      sweepPairCount += end - i - 1;
      if (sweepPairCount > NEAR_SEAM_EXTENDED_SWEEP_PAIR_LIMIT) break;
    }
    if (
      sweepPairCount <= NEAR_SEAM_SWEEP_PAIR_LIMIT ||
      (
        sweepPairCount <= NEAR_SEAM_EXTENDED_SWEEP_PAIR_LIMIT &&
        shouldUseExtendedSweep(records, cellSize, maxGap)
      )
    ) {
      for (let i = 0; i + 1 < sorted.length; i += 1) {
        for (let j = i + 1; j < sweepEnds[i]; j += 1) {
          measurePair(sorted[i], sorted[j]);
        }
      }
      return;
    }
  }

  const cells = new Map<string, Edge[]>();
  for (const record of records) {
    addRecordToSegmentCells(cells, record, cellSize, maxGap);
  }

  const seenPairs = new Set<number>();
  const recordCount = records.length;
  for (const bucket of cells.values()) {
    for (let i = 0; i + 1 < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const first = bucket[i];
        const second = bucket[j];
        const record = first.index < second.index ? first : second;
        const candidate = first.index < second.index ? second : first;
        const pairKey = record.index * recordCount + candidate.index;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        measurePair(record, candidate);
      }
    }
  }
}

function edgeBoundsCouldOverlap(a: Edge, b: Edge, maxGap: number) {
  return a.minX <= b.maxX + maxGap &&
    b.minX <= a.maxX + maxGap &&
    a.minY <= b.maxY + maxGap &&
    b.minY <= a.maxY + maxGap &&
    a.minZ <= b.maxZ + maxGap &&
    b.minZ <= a.maxZ + maxGap;
}

function cellCoords(point: Vec3, cellSize: number): [number, number, number] {
  return [
    Math.floor(point[0] / cellSize),
    Math.floor(point[1] / cellSize),
    Math.floor(point[2] / cellSize),
  ];
}

function addRecordToSegmentCells(
  cells: Map<string, Edge[]>,
  record: Edge,
  cellSize: number,
  padding: number,
) {
  const [minCx, minCy, minCz, maxCx, maxCy, maxCz] = recordSegmentCellBounds(record, cellSize, padding);
  for (let x = minCx; x <= maxCx; x += 1) {
    for (let y = minCy; y <= maxCy; y += 1) {
      for (let z = minCz; z <= maxCz; z += 1) {
        const key = `${x},${y},${z}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push(record);
        else cells.set(key, [record]);
      }
    }
  }
}

function recordSegmentCellBounds(record: Edge, cellSize: number, padding: number): [number, number, number, number, number, number] {
  const [minCx, minCy, minCz] = cellCoords([record.minX - padding, record.minY - padding, record.minZ - padding], cellSize);
  const [maxCx, maxCy, maxCz] = cellCoords([record.maxX + padding, record.maxY + padding, record.maxZ + padding], cellSize);
  return [minCx, minCy, minCz, maxCx, maxCy, maxCz];
}

function recordSegmentCellCount(record: Edge, cellSize: number, padding: number) {
  const [minCx, minCy, minCz, maxCx, maxCy, maxCz] = recordSegmentCellBounds(record, cellSize, padding);
  return (maxCx - minCx + 1) * (maxCy - minCy + 1) * (maxCz - minCz + 1);
}

function shouldUseExtendedSweep(
  records: Edge[],
  cellSize: number,
  padding: number,
) {
  let totalCells = 0;
  let maxCells = 0;
  for (const record of records) {
    const cells = recordSegmentCellCount(record, cellSize, padding);
    totalCells += cells;
    if (cells > maxCells) maxCells = cells;
    if (maxCells > NEAR_SEAM_GRID_MAX_CELLS_PER_RECORD_LIMIT) return true;
  }
  return totalCells / Math.max(1, records.length) > NEAR_SEAM_GRID_AVG_CELLS_PER_RECORD_LIMIT;
}

function dotFromPointToEdge(point: Vec3, edgeOrigin: Vec3, edgeDir: Vec3) {
  return (
    (point[0] - edgeOrigin[0]) * edgeDir[0] +
    (point[1] - edgeOrigin[1]) * edgeDir[1] +
    (point[2] - edgeOrigin[2]) * edgeDir[2]
  );
}

function dotEdgePointToEdge(source: Edge, distance: number, target: Edge) {
  return (
    (source.a[0] + source.dir[0] * distance - target.a[0]) * target.dir[0] +
    (source.a[1] + source.dir[1] * distance - target.a[1]) * target.dir[1] +
    (source.a[2] + source.dir[2] * distance - target.a[2]) * target.dir[2]
  );
}

function nearSeamInfo(a: Edge, b: Edge, maxGap: number) {
  const bStart = dotFromPointToEdge(b.a, a.a, a.dir);
  const bEnd = dotFromPointToEdge(b.b, a.a, a.dir);
  const overlapStart = Math.max(0, Math.min(bStart, bEnd));
  const overlapEnd = Math.min(a.length, Math.max(bStart, bEnd));
  const overlap = overlapEnd - overlapStart;
  const minLength = Math.min(a.length, b.length);
  if (overlap < Math.max(0.75, minLength * 0.12)) return null;

  const aMidT = (overlapStart + overlapEnd) / 2;
  const aMidX = a.a[0] + a.dir[0] * aMidT;
  const aMidY = a.a[1] + a.dir[1] * aMidT;
  const aMidZ = a.a[2] + a.dir[2] * aMidT;
  const bT = Math.max(0, Math.min(
    b.length,
    (aMidX - b.a[0]) * b.dir[0] +
      (aMidY - b.a[1]) * b.dir[1] +
      (aMidZ - b.a[2]) * b.dir[2],
  ));
  const gapX = b.a[0] + b.dir[0] * bT - aMidX;
  const gapY = b.a[1] + b.dir[1] * bT - aMidY;
  const gapZ = b.a[2] + b.dir[2] * bT - aMidZ;
  const gap = Math.hypot(gapX, gapY, gapZ);
  if (gap <= EPS) return null;
  if (gap > maxGap) return null;
  if (gap > Math.min(maxGap, Math.max(4, minLength * 0.28))) return null;

  const invGap = 1 / gap;
  const gapDirX = gapX * invGap;
  const gapDirY = gapY * invGap;
  const gapDirZ = gapZ * invGap;
  const facingA = a.outward[0] * gapDirX + a.outward[1] * gapDirY + a.outward[2] * gapDirZ;
  const facingB = -(b.outward[0] * gapDirX + b.outward[1] * gapDirY + b.outward[2] * gapDirZ);
  if (facingA < MIN_FACING_DOT || facingB < MIN_FACING_DOT) return null;
  const b0T = Math.max(0, Math.min(b.length, dotEdgePointToEdge(a, overlapStart, b)));
  const b1T = Math.max(0, Math.min(b.length, dotEdgePointToEdge(a, overlapEnd, b)));
  return {
    gap,
    facingA,
    facingB,
    aStart: overlapStart,
    aEnd: overlapEnd,
    bStart: Math.min(b0T, b1T),
    bEnd: Math.max(b0T, b1T),
  };
}

function repairPoint(a: Vec2, b: Vec2, edgeLength: number, distance: number): Vec2 {
  const t = edgeLength <= EPS ? 0 : Math.max(0, Math.min(1, distance / edgeLength));
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
}

function pushUniquePoint(points: Vec2[], point: Vec2) {
  const last = points[points.length - 1];
  if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) <= EPS) return;
  points.push(point);
}

function normalizeRepairSegments(
  segments: Repair[] | undefined,
  edgeLength: number,
  capacity: number,
) {
  if (!segments?.length || edgeLength <= EPS || capacity <= EPS) return [];
  const stops = new Set<number>([0, edgeLength]);
  for (const segment of segments) {
    const start = Math.max(0, Math.min(edgeLength, segment.start));
    const end = Math.max(0, Math.min(edgeLength, segment.end));
    if (end - start <= EPS || segment.amount <= EPS) continue;
    stops.add(start);
    stops.add(end);
  }

  const sortedStops = Array.from(stops).sort((a, b) => a - b);
  const normalized: Repair[] = [];
  for (let i = 0; i + 1 < sortedStops.length; i += 1) {
    const start = sortedStops[i];
    const end = sortedStops[i + 1];
    if (end - start <= EPS) continue;
    const mid = (start + end) / 2;
    let amount = 0;
    for (const segment of segments) {
      if (mid + EPS < segment.start || mid - EPS > segment.end) continue;
      amount = Math.max(amount, segment.amount);
    }
    const safeAmount = Math.min(capacity, amount);
    if (safeAmount > EPS) normalized.push({ start, end, amount: safeAmount });
  }
  return normalized;
}

function isValidRepairedPolygon(source: Vec2[], repaired: Vec2[]) {
  if (repaired.length < 3 || !isWeaklyConvex(repaired)) return false;
  const sourceArea = signedArea(source);
  const repairedArea = signedArea(repaired);
  return Math.sign(repairedArea) === Math.sign(sourceArea) && Math.abs(repairedArea) >= Math.abs(sourceArea) - EPS;
}

function patchPolygon(
  polygon: Polygon,
  edgeRepairs: ReadonlyMap<number, Repair[]>,
  capacityScale: number,
) {
  if (edgeRepairs.size === 0 || polygon.vertices.length < 3 || hasTexture(polygon)) return polygon;

  const points = cssPoints(polygon.vertices);
  const basis = localBasis(points);
  if (!basis || !isWeaklyConvex(basis.local)) return polygon;

  const repaired: Vec2[] = [];
  for (let edgeIndex = 0; edgeIndex < basis.local.length; edgeIndex += 1) {
    const a = basis.local[edgeIndex];
    const b = basis.local[(edgeIndex + 1) % basis.local.length];
    const edgeLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const outward = edgeOutward2D(basis.local, basis.area, edgeIndex);
    if (!outward || edgeLength <= EPS) return polygon;
    const segments = normalizeRepairSegments(
      edgeRepairs.get(edgeIndex),
      edgeLength,
      edgeSafeCapacity(basis.local, edgeIndex) * capacityScale,
    );

    pushUniquePoint(repaired, a);
    let cursor = 0;
    for (const segment of segments) {
      if (segment.start > cursor + EPS) {
        pushUniquePoint(repaired, repairPoint(a, b, edgeLength, segment.start));
      }

      const start = repairPoint(a, b, edgeLength, segment.start);
      const end = repairPoint(a, b, edgeLength, segment.end);
      pushUniquePoint(repaired, [
        start[0] + outward[0] * segment.amount,
        start[1] + outward[1] * segment.amount,
      ]);
      pushUniquePoint(repaired, [
        end[0] + outward[0] * segment.amount,
        end[1] + outward[1] * segment.amount,
      ]);
      if (segment.end < edgeLength - EPS) pushUniquePoint(repaired, end);
      cursor = segment.end;
    }
  }

  const first = repaired[0];
  const last = repaired[repaired.length - 1];
  if (first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) <= EPS) repaired.pop();
  if (!isValidRepairedPolygon(basis.local, repaired)) return polygon;

  const vertices = repaired.map(([x, y]) => fromCssPoint([
    basis.origin[0] + x * basis.xAxis[0] + y * basis.yAxis[0],
    basis.origin[1] + x * basis.xAxis[1] + y * basis.yAxis[1],
    basis.origin[2] + x * basis.xAxis[2] + y * basis.yAxis[2],
  ]));
  return { ...polygon, vertices };
}

function isRefinableSeamQuad(polygon: Polygon) {
  return polygon.vertices.length === 4 && !hasTexture(polygon);
}

function quadShapeRisk(meta: Meta) {
  const local = meta.basis?.local;
  if (!local || local.length !== 4) return 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of local) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const bboxArea = Math.max(EPS, (maxX - minX) * (maxY - minY));
  const fillRatio = Math.max(0, Math.min(1, Math.abs(meta.basis!.area) / bboxArea));
  return 0.75 + (1 - fillRatio) * 2.5;
}

function cssDistance(a: Vec3, b: Vec3) {
  return length(sub(cssPoints([a])[0], cssPoints([b])[0]));
}

function triangleQuality(a: Vec3, b: Vec3, c: Vec3) {
  const ab = cssDistance(a, b);
  const bc = cssDistance(b, c);
  const ca = cssDistance(c, a);
  const longest = Math.max(ab, bc, ca);
  if (longest <= EPS) return 0;
  const area = length(cross(sub(cssPoints([b])[0], cssPoints([a])[0]), sub(cssPoints([c])[0], cssPoints([a])[0]))) * 0.5;
  return area / (longest * longest);
}

function intersectLocalLines(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): Vec2 | null {
  const rx = a1[0] - a0[0];
  const ry = a1[1] - a0[1];
  const sx = b1[0] - b0[0];
  const sy = b1[1] - b0[1];
  const det = rx * sy - ry * sx;
  if (Math.abs(det) <= EPS) return null;
  const qpx = b0[0] - a0[0];
  const qpy = b0[1] - a0[1];
  const t = (qpx * sy - qpy * sx) / det;
  return [a0[0] + t * rx, a0[1] + t * ry];
}

function offsetLocalConvexPointsByEdgeAmounts(points: Vec2[], amounts: number[]) {
  if (points.length < 3 || points.length !== amounts.length) return null;
  const maxAmount = Math.max(0, ...amounts);
  if (maxAmount <= EPS) return points;
  const area = signedArea(points);
  if (Math.abs(area) <= EPS) return null;
  const outwardSign = area > 0 ? 1 : -1;
  const offsetLines: Array<{ a: Vec2; b: Vec2 }> = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const edgeLength = Math.hypot(dx, dy);
    if (edgeLength <= EPS) return null;
    const amount = Math.max(0, amounts[i]);
    const ox = outwardSign * (dy / edgeLength) * amount;
    const oy = outwardSign * (-dx / edgeLength) * amount;
    offsetLines.push({
      a: [a[0] + ox, a[1] + oy],
      b: [b[0] + ox, b[1] + oy],
    });
  }

  const expanded: Vec2[] = [];
  const maxMiter = Math.max(2, maxAmount * 4);
  for (let i = 0; i < points.length; i += 1) {
    const prev = offsetLines[(i + points.length - 1) % points.length];
    const next = offsetLines[i];
    const intersection = intersectLocalLines(prev.a, prev.b, next.a, next.b);
    if (!intersection) return null;
    const original = points[i];
    const dx = intersection[0] - original[0];
    const dy = intersection[1] - original[1];
    const miter = Math.hypot(dx, dy);
    expanded.push(
      miter > maxMiter
        ? [original[0] + (dx / miter) * maxMiter, original[1] + (dy / miter) * maxMiter]
        : intersection,
    );
  }
  return expanded;
}

function cssPointFromLocal(basis: Basis, point: Vec2): Vec3 {
  return [
    basis.origin[0] + basis.xAxis[0] * point[0] + basis.yAxis[0] * point[1],
    basis.origin[1] + basis.xAxis[1] * point[0] + basis.yAxis[1] * point[1],
    basis.origin[2] + basis.xAxis[2] * point[0] + basis.yAxis[2] * point[1],
  ];
}

function offsetTriangleVertices(vertices: Vec3[], amounts: [number, number, number]) {
  const basis = localBasis(cssPoints(vertices));
  if (!basis) return vertices;
  const expanded = offsetLocalConvexPointsByEdgeAmounts(basis.local, amounts);
  return expanded
    ? expanded.map((point) => fromCssPoint(cssPointFromLocal(basis, point)))
    : vertices;
}

function splitQuadIntoTriangles(polygon: Polygon, edges: ReadonlySet<number>) {
  const solid: Polygon = { ...polygon, uvs: undefined, textureTriangles: undefined };
  const [a, b, c, d] = polygon.vertices;
  const acQuality = Math.min(triangleQuality(a, b, c), triangleQuality(a, c, d));
  const bdQuality = Math.min(triangleQuality(a, b, d), triangleQuality(b, c, d));
  const seamAmount = (edge: number) => edges.has(edge) ? SEAM_SPLIT_EDGE_OVERLAP_PX : 0;
  return acQuality >= bdQuality
    ? [
        { ...solid, vertices: offsetTriangleVertices([a, b, c], [seamAmount(0), seamAmount(1), SEAM_SPLIT_INTERNAL_OVERLAP_PX]) },
        { ...solid, vertices: offsetTriangleVertices([a, c, d], [SEAM_SPLIT_INTERNAL_OVERLAP_PX, seamAmount(2), seamAmount(3)]) },
      ]
    : [
        { ...solid, vertices: offsetTriangleVertices([a, b, d], [seamAmount(0), SEAM_SPLIT_INTERNAL_OVERLAP_PX, seamAmount(3)]) },
        { ...solid, vertices: offsetTriangleVertices([b, c, d], [seamAmount(1), seamAmount(2), SEAM_SPLIT_INTERNAL_OVERLAP_PX]) },
      ];
}

type Cand={key:string;e:[string,string];o:Edge[];r:Edge[];len:number;rank:number;proj:number;s:number;nr:number;sr:number;vr:number;comp:number;sel:boolean;why:SplitReason;cost:number};

type FollowUp={endpoints:ReadonlySet<string>};

type SplitMode="primary"|"follow-up";

type Dist={q1:number;median:number;q3:number;p70:number;p80:number;p88:number;p95:number;p97:number;max:number};

function numericDistribution(values: number[]) {
  if (values.length === 0) {
    return {
      q1: Infinity,
      median: Infinity,
      q3: Infinity,
      p70: Infinity,
      p80: Infinity,
      p88: Infinity,
      p95: Infinity,
      p97: Infinity,
      max: Infinity,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const at = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? 0;
  return {
    q1: at(0.25),
    median: at(0.5),
    q3: at(0.75),
    p70: at(0.7),
    p80: at(0.8),
    p88: at(0.88),
    p95: at(0.95),
    p97: at(0.97),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function unionFindRoot(parents: number[], index: number): number {
  const parent = parents[index];
  if (parent === index) return index;
  const root = unionFindRoot(parents, parent);
  parents[index] = root;
  return root;
}

function splitPlanFollowUpContext(candidates: Cand[]) {
  const endpoints = new Set<string>();
  const components = new Set<number>();
  for (const candidate of candidates) {
    if (!candidate.sel) continue;
    components.add(candidate.comp);
  }
  for (const candidate of candidates) {
    if (!components.has(candidate.comp)) continue;
    for (const endpoint of candidate.e) endpoints.add(endpoint);
  }
  return { endpoints };
}

function splitCandidateTouchesFollowUp(
  candidate: Cand,
  context: FollowUp | undefined,
) {
  if (!context) return true;
  return candidate.e.some((endpoint) => context.endpoints.has(endpoint));
}

function buildSeamFacetSplitCandidates(
  polygons: Polygon[],
  metas: Meta[],
  edgeOwners: ReadonlyMap<string, Edge[]>,
  splitOptions: Split,
) {
  const candidates: Cand[] = [];
  for (const [key, owners] of edgeOwners) {
    if (owners.length !== 2) continue;
    const [a, b] = owners;
    if (!compatibleRepairMaterials(a, b)) continue;
    const refinable = owners.filter((record) => isRefinableSeamQuad(polygons[record.polygon]));
    if (refinable.length === 0) continue;
    const firstRefinable = refinable[0];

    const normalRisk = 1 - Math.min(1, Math.abs(dot(a.normal, b.normal)));
    const seamLength = Math.max(a.length, b.length);
    if (normalRisk < 0.01 && seamLength < 64) continue;

    const shapeRisk = Math.max(...refinable.map((record) => quadShapeRisk(metas[record.polygon])));
    const bothSidesRefinable = refinable.length === 2 ? 1.18 : 1;
    const seamRisk = Math.max(0.08, normalRisk);
    const projected = splitOptions.viewAware
      ? splitCandidateViewMetrics(a, b, splitOptions.rotX, splitOptions.rotY)
      : { proj: seamLength, vr: 1 };
    const rankLength = splitOptions.viewAware ? Math.max(projected.proj, seamLength * 0.12) : seamLength;
    const viewWeight = splitOptions.viewAware ? 0.18 + projected.vr * 1.82 : 1;
    candidates.push({
      key,
      e: [pointKey(firstRefinable.a), pointKey(firstRefinable.b)],
      o: owners,
      r: refinable,
      len: seamLength,
      rank: rankLength,
      proj: projected.proj,
      s: rankLength * (0.58 + seamRisk * 2.8) * shapeRisk * bothSidesRefinable * viewWeight,
      nr: normalRisk,
      sr: shapeRisk,
      vr: projected.vr,
      comp: -1,
      sel: false,
      why: "below-threshold",
      cost: refinable.length,
    });
  }

  const parents = Array.from({ length: candidates.length }, (_, index) => index);
  const byEndpoint = new Map<string, number>();
  for (let index = 0; index < candidates.length; index += 1) {
    for (const endpoint of candidates[index].e) {
      const previous = byEndpoint.get(endpoint);
      if (previous === undefined) {
        byEndpoint.set(endpoint, index);
      } else {
        const rootA = unionFindRoot(parents, previous);
        const rootB = unionFindRoot(parents, index);
        if (rootA !== rootB) parents[rootB] = rootA;
      }
    }
  }

  const componentIds = new Map<number, number>();
  for (let index = 0; index < candidates.length; index += 1) {
    const root = unionFindRoot(parents, index);
    let component = componentIds.get(root);
    if (component === undefined) {
      component = componentIds.size;
      componentIds.set(root, component);
    }
    candidates[index].comp = component;
  }

  return candidates;
}

function splitCandidateViewMetrics(
  a: Edge,
  b: Edge,
  rotX: number,
  rotY: number,
) {
  const p0 = rotateCssVec3(a.a, rotX, 0, rotY);
  const p1 = rotateCssVec3(a.b, rotX, 0, rotY);
  const projectedLength = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const depthA = rotateCssVec3(a.normal, rotX, 0, rotY)[2];
  const depthB = rotateCssVec3(b.normal, rotX, 0, rotY)[2];
  const frontness = Math.max(0, depthA, depthB);
  const silhouette = Math.min(1, Math.abs(depthA - depthB));
  return {
    proj: projectedLength,
    vr: Math.max(0.04, Math.min(1, frontness * 0.85 + silhouette * 0.45)),
  };
}

function strongestCandidatesByComponent(
  candidates: Cand[],
) {
  const strongest = new Map<number, Cand>();
  for (const candidate of candidates) {
    const current = strongest.get(candidate.comp);
    if (!current || candidate.s > current.s || (candidate.s === current.s && candidate.len > current.len)) {
      strongest.set(candidate.comp, candidate);
    }
  }
  return new Set(strongest.values());
}

function splitCandidateBudgetPriority(candidate: Cand) {
  const coplanar = Math.max(0, 1 - Math.min(1, candidate.nr));
  const coplanarWeight = 0.35 + coplanar * coplanar * coplanar * 3.65;
  const oneSidedWeight = candidate.r.length === 1 ? 1.08 : 1;
  return (candidate.rank * coplanarWeight * oneSidedWeight) / Math.sqrt(Math.max(1, candidate.r.length));
}

function splitCandidateLikelyCrackPriority(candidate: Cand) {
  const coplanar = Math.max(0, 1 - Math.min(1, candidate.nr));
  const visibleWeight = 0.35 + Math.min(1, candidate.vr) * 1.65;
  const shapeWeight = 0.7 + Math.min(2.6, candidate.sr) * 0.3;
  const oneSidedWeight = candidate.r.length === 1 ? 1.1 : 1;
  const visiblePriority = (
    candidate.rank *
    (0.6 + coplanar * coplanar * 1.4) *
    visibleWeight *
    shapeWeight *
    oneSidedWeight
  ) / Math.sqrt(Math.max(1, candidate.r.length));
  return Math.max(visiblePriority, splitCandidateBudgetPriority(candidate) * 0.75);
}

function uniqueSplitPolygonCost(candidates: Cand[]) {
  const polygons = new Set<number>();
  for (const candidate of candidates) {
    for (const record of candidate.r) polygons.add(record.polygon);
  }
  return polygons.size;
}

function splitCandidateLikelyCrack(candidate: Cand, lengthStats: Dist) {
  return candidate.nr <= 0.25 &&
    candidate.rank >= lengthStats.median * 1.08 &&
    candidate.proj >= 24;
}

function splitCandidateGlobalSeed(
  candidate: Cand,
  strongScore: number,
  strongLength: number,
) {
  return candidate.s >= strongScore || candidate.rank >= strongLength;
}

function seamFacetSplitBudgetPlan(
  candidates: Cand[],
  mode: SplitMode,
  maxBudget: number,
  scoreStats: Dist,
  lengthStats: Dist,
  strongScore: number,
  strongLength: number,
) {
  const budgetLimit = Math.max(0, Math.floor(maxBudget));
  if (budgetLimit <= 0 || candidates.length === 0 || mode === "follow-up") {
    return { budgetLimit, componentBudgets: null };
  }

  const byComponent = new Map<number, Cand[]>();
  for (const candidate of candidates) {
    const group = byComponent.get(candidate.comp);
    if (group) group.push(candidate);
    else byComponent.set(candidate.comp, [candidate]);
  }

  const componentBudgets = new Map<number, number>();
  const scoreSpread = Math.max(EPS, scoreStats.q3 - scoreStats.q1);
  const fallbackSeedScore = Math.min(scoreStats.max, Math.max(scoreStats.p95, scoreStats.q3 + scoreSpread));
  let total = 0;
  for (const [component, group] of byComponent) {
    const primary = group.filter((candidate) =>
      splitCandidateGlobalSeed(candidate, strongScore, strongLength) ||
      candidate.s >= fallbackSeedScore
    );
    if (primary.length === 0) continue;

    const likely = group.filter((candidate) => splitCandidateLikelyCrack(candidate, lengthStats));
    const primaryCost = uniqueSplitPolygonCost(primary);
    const likelyCost = uniqueSplitPolygonCost(likely);
    const followUpAllowance = Math.ceil(Math.sqrt(Math.max(0, likelyCost - primaryCost)) * 3);
    const componentBudget = Math.min(
      uniqueSplitPolygonCost(group),
      primaryCost + followUpAllowance,
    );
    if (componentBudget <= 0) continue;
    componentBudgets.set(component, componentBudget);
    total += componentBudget;
  }

  if (componentBudgets.size === 0) return { budgetLimit: 0, componentBudgets };
  return {
    budgetLimit: Math.min(budgetLimit, total),
    componentBudgets,
  };
}

function selectSeamFacetSplitCandidates(
  candidates: Cand[],
  mode: SplitMode,
  budget: number,
) {
  const selected = new Map<number, Set<number>>();
  if (candidates.length === 0 || budget <= 0) return { selected, budgetLimit: 0 };

  const scoreStats = numericDistribution(candidates.map((candidate) => candidate.s));
  const lengthStats = numericDistribution(candidates.map((candidate) => candidate.rank));
  const scoreSpread = Math.max(EPS, scoreStats.q3 - scoreStats.q1);
  const strongScore = Math.min(scoreStats.max, Math.max(scoreStats.p95, scoreStats.q3 + scoreSpread * 0.85));
  const anchorScore = Math.min(scoreStats.max, Math.max(scoreStats.p80, scoreStats.q3 + scoreSpread * 0.15));
  const sharedPolygonScore = Math.min(scoreStats.max, Math.max(scoreStats.p70, scoreStats.q3));
  const strongLength = Math.max(lengthStats.p97, lengthStats.median * 1.8);
  const anchorLength = Math.max(lengthStats.p88, lengthStats.median * 1.35);
  const budgetPlan = seamFacetSplitBudgetPlan(
    candidates,
    mode,
    budget,
    scoreStats,
    lengthStats,
    strongScore,
    strongLength,
  );
  let remainingBudget = budgetPlan.budgetLimit;
  if (remainingBudget <= 0) return { selected, budgetLimit: 0 };

  const anchors = strongestCandidatesByComponent(candidates);
  const alreadySplit = new Set<number>();
  const selectedEndpoints = new Set<string>();
  const selectedComponents = new Set<number>();
  const componentSpend = new Map<number, number>();
  const localReserve = mode === "primary"
    ? Math.min(Math.max(0, budgetPlan.budgetLimit - 1), Math.max(2, Math.floor(budgetPlan.budgetLimit * 0.28)))
    : 0;

  const sorted = [...candidates].sort((a, b) =>
    splitCandidateBudgetPriority(b) - splitCandidateBudgetPriority(a) ||
    (b.s / Math.max(1, b.r.length)) - (a.s / Math.max(1, a.r.length)) ||
    b.len - a.len
  );
  const likelyCrackSorted = [...candidates].sort((a, b) =>
    splitCandidateLikelyCrackPriority(b) - splitCandidateLikelyCrackPriority(a) ||
    splitCandidateBudgetPriority(b) - splitCandidateBudgetPriority(a) ||
    b.len - a.len
  );

  const selectCandidate = (candidate: Cand, reason: SplitReason) => {
    candidate.sel = true;
    candidate.why = reason;
    selectedComponents.add(candidate.comp);
    for (const endpoint of candidate.e) selectedEndpoints.add(endpoint);
    for (const record of candidate.r) {
      alreadySplit.add(record.polygon);
      const edges = selected.get(record.polygon);
      if (edges) edges.add(record.edge);
      else selected.set(record.polygon, new Set([record.edge]));
    }
  };

  const withinComponentBudget = (candidate: Cand, marginalCost: number) => {
    const componentBudgets = budgetPlan.componentBudgets;
    if (marginalCost <= 0 || !componentBudgets) return true;
    const componentBudget = componentBudgets.get(candidate.comp) ?? 0;
    return (componentSpend.get(candidate.comp) ?? 0) + marginalCost <= componentBudget;
  };

  const recordComponentSpend = (candidate: Cand, marginalCost: number) => {
    if (marginalCost <= 0 || !budgetPlan.componentBudgets) return;
    componentSpend.set(candidate.comp, (componentSpend.get(candidate.comp) ?? 0) + marginalCost);
  };

  for (const candidate of likelyCrackSorted) {
    const marginalCost = candidate.r.reduce(
      (total, record) => total + (alreadySplit.has(record.polygon) ? 0 : 1),
      0,
    );
    candidate.cost = marginalCost;
    if (marginalCost > remainingBudget) continue;
    if (!withinComponentBudget(candidate, marginalCost)) continue;
    if (marginalCost > 0 && remainingBudget - marginalCost < localReserve) continue;
    const isLikelyCrack = splitCandidateLikelyCrack(candidate, lengthStats);
    if (!isLikelyCrack) continue;
    selectCandidate(candidate, "global-outlier");
    recordComponentSpend(candidate, marginalCost);
    remainingBudget -= marginalCost;
    if (remainingBudget <= 0) return { selected, budgetLimit: budgetPlan.budgetLimit };
  }

  for (const candidate of sorted) {
    if (candidate.sel) continue;
    const marginalCost = candidate.r.reduce(
      (total, record) => total + (alreadySplit.has(record.polygon) ? 0 : 1),
      0,
    );
    candidate.cost = marginalCost;
    if (marginalCost > remainingBudget) continue;
    if (!withinComponentBudget(candidate, marginalCost)) continue;
    if (marginalCost > 0 && remainingBudget - marginalCost < localReserve) continue;

    const twoSided = candidate.r.length === 2;
    const isAnchor = anchors.has(candidate) && (
      mode === "primary" ||
      (mode === "follow-up" && candidate.s >= anchorScore * 1.08 && candidate.rank >= anchorLength)
    ) && (
      twoSided
        ? candidate.s >= anchorScore || candidate.rank >= anchorLength
        : candidate.s >= anchorScore * 1.18 || candidate.rank >= anchorLength * 1.12
    );
    const isGlobalOutlier = twoSided
      ? candidate.s >= strongScore || candidate.rank >= strongLength
      : candidate.s >= strongScore * 1.35 || candidate.rank >= strongLength * 1.2;
    const isSharedPolygonFollowUp = marginalCost === 0 && (
      twoSided
        ? candidate.s >= sharedPolygonScore || candidate.rank >= anchorLength
        : candidate.s >= sharedPolygonScore * 1.25 || candidate.rank >= anchorLength * 1.12
    );
    if (!isAnchor && !isGlobalOutlier && !isSharedPolygonFollowUp) continue;

    selectCandidate(candidate, isAnchor
      ? "component-anchor"
      : isGlobalOutlier
        ? "global-outlier"
        : "shared-polygon");
    recordComponentSpend(candidate, marginalCost);
    remainingBudget -= marginalCost;
    if (remainingBudget <= 0) return { selected, budgetLimit: budgetPlan.budgetLimit };
  }

  for (const candidate of sorted) {
    if (candidate.sel) continue;
    const marginalCost = candidate.r.reduce(
      (total, record) => total + (alreadySplit.has(record.polygon) ? 0 : 1),
      0,
    );
    candidate.cost = marginalCost;
    if (marginalCost > 1 || marginalCost > remainingBudget) continue;
    if (!withinComponentBudget(candidate, marginalCost)) continue;
    const touchesSelectedPolygon = candidate.r.some((record) => alreadySplit.has(record.polygon));
    const touchesSelectedEndpoint = candidate.e.some((endpoint) => selectedEndpoints.has(endpoint));
    const isOneSidedTail = mode === "primary" &&
      candidate.r.length === 1 &&
      marginalCost === 1 &&
      (selectedComponents.has(candidate.comp) || touchesSelectedEndpoint || touchesSelectedPolygon) &&
      candidate.rank >= anchorLength * 1.05 &&
      candidate.nr >= 0.16 &&
      candidate.vr <= 0.32;
    if (isOneSidedTail) {
      selectCandidate(candidate, "local-follow-up");
      recordComponentSpend(candidate, marginalCost);
      remainingBudget -= marginalCost;
      if (remainingBudget <= 0) return { selected, budgetLimit: budgetPlan.budgetLimit };
      continue;
    }
    if (candidate.r.length !== 2) continue;
    const isProjectedNeighbor = touchesSelectedPolygon &&
      marginalCost === 1 &&
      candidate.proj >= anchorLength * 1.45 &&
      candidate.vr <= 0.18;
    if (!touchesSelectedEndpoint && !isProjectedNeighbor) continue;
    const isLocalFollowUp = (
      candidate.s >= sharedPolygonScore * 0.42 ||
      candidate.rank >= anchorLength * 0.62
    ) && candidate.s <= sharedPolygonScore * 1.1 && candidate.proj >= 24;
    if (isLocalFollowUp) {
      selectCandidate(candidate, "local-follow-up");
      recordComponentSpend(candidate, marginalCost);
      remainingBudget -= marginalCost;
      if (remainingBudget <= 0) return { selected, budgetLimit: budgetPlan.budgetLimit };
    }
  }

  return { selected, budgetLimit: budgetPlan.budgetLimit };
}

function seamFacetSplitPlan(
  polygons: Polygon[],
  seamOptions: Overlap,
  splitOptions: Split,
  budget: number,
  followUpContext?: FollowUp,
) {
  const metas = buildPolygonMetas(polygons);
  const records = buildEdgeRecords(polygons, metas, seamOptions.capacityScale);
  const edgeOwners = new Map<string, Edge[]>();
  for (const record of records) {
    const owners = edgeOwners.get(record.key);
    if (owners) owners.push(record);
    else edgeOwners.set(record.key, [record]);
  }

  const candidates = buildSeamFacetSplitCandidates(polygons, metas, edgeOwners, splitOptions)
    .filter((candidate) => splitCandidateTouchesFollowUp(candidate, followUpContext));
  const selection = selectSeamFacetSplitCandidates(candidates, followUpContext ? "follow-up" : "primary", budget);
  return { selected: selection.selected, candidates, budgetLimit: selection.budgetLimit };
}

function applySeamFacetSplitSelection(
  polygons: Polygon[],
  selected: ReadonlyMap<number, ReadonlySet<number>>,
) {
  const out: Polygon[] = [];
  for (let i = 0; i < polygons.length; i += 1) {
    const polygon = polygons[i];
    const edges = selected.get(i);
    if (edges && isRefinableSeamQuad(polygon)) out.push(...splitQuadIntoTriangles(polygon, edges));
    else out.push(polygon);
  }
  return out;
}

function seamFacetSplitPublicCandidate(candidate: Cand) {
  const [a, b] = candidate.o;
  const first = a ?? b;
  const second = b ?? a;
  return {
    key: candidate.key,
    aPolygon: first?.polygon ?? -1,
    aEdge: first?.edge ?? -1,
    bPolygon: second?.polygon ?? -1,
    bEdge: second?.edge ?? -1,
    color: first?.color ?? second?.color,
    materialKey: first?.materialKey ?? second?.materialKey ?? "",
    lengthPx: candidate.len,
    projectedLengthPx: candidate.proj,
    score: candidate.s,
    normalRisk: candidate.nr,
    shapeRisk: candidate.sr,
    viewRisk: candidate.vr,
    component: candidate.comp,
    marginalCost: candidate.cost,
    selected: candidate.sel,
    reason: candidate.why,
  };
}

export function seamFacetSplitPolygons(
  polygons: Polygon[],
  seamOptions?: number | OverlapOptions,
  splitOptions?: SplitOptions,
) {
  const resolved = resolveSeamOverlapOptions(seamOptions);
  const split = resolveSeamFacetSplitOptions(splitOptions);
  if (!seamOverlapEnabled(resolved, seamOptions) || polygons.length === 0) return polygons;
  let current = polygons;
  let followUpContext: FollowUp | undefined;
  let remainingBudget = split.budget;
  for (let pass = 0; pass < split.passes; pass += 1) {
    const plan = seamFacetSplitPlan(current, resolved, split, remainingBudget, followUpContext);
    if (pass === 0) remainingBudget = Math.min(remainingBudget, plan.budgetLimit);
    if (plan.selected.size === 0) break;
    const next = applySeamFacetSplitSelection(current, plan.selected);
    if (next.length === current.length) break;
    remainingBudget -= plan.selected.size;
    if (remainingBudget <= 0) {
      current = next;
      break;
    }
    followUpContext = splitPlanFollowUpContext(plan.candidates);
    current = next;
  }
  return current;
}

export function seamFacetSplitReport(
  polygons: Polygon[],
  seamOptions?: number | OverlapOptions,
  splitOptions?: SplitOptions,
): SplitReport {
  const resolved = resolveSeamOverlapOptions(seamOptions);
  const split = resolveSeamFacetSplitOptions(splitOptions);
  if (!seamOverlapEnabled(resolved, seamOptions) || polygons.length === 0) {
    return { candidates: [], selectedPolygons: 0, selectedEdges: 0, addedPolygons: 0 };
  }

  const plan = seamFacetSplitPlan(polygons, resolved, split, split.budget);
  let selectedEdges = 0;
  for (const edges of plan.selected.values()) selectedEdges += edges.size;
  return {
    candidates: plan.candidates.map(seamFacetSplitPublicCandidate),
    selectedPolygons: plan.selected.size,
    selectedEdges,
    addedPolygons: plan.selected.size,
  };
}

export function seamOverlapPolygons(
  polygons: Polygon[],
  options?: number | OverlapOptions,
) {
  const resolved = resolveSeamOverlapOptions(options);
  if (!seamOverlapEnabled(resolved, options) || polygons.length === 0) return polygons;
  const { edgeRepairs } = buildSeamEdgeAmounts(polygons, resolved);
  if (!edgeRepairs.some((edges) => edges.size > 0)) return polygons;
  return polygons.map((polygon, index) => patchPolygon(polygon, edgeRepairs[index], resolved.capacityScale));
}

export function repairMeshSeams(
  polygons: Polygon[],
  seamOptions: number | OverlapOptions = DEFAULT_SEAM_OVERLAP_OPTIONS,
  splitOptions: SplitOptions = DEFAULT_SEAM_FACET_SPLIT_OPTIONS,
) {
  if (polygons.length === 0) return polygons;
  const split = seamFacetSplitPolygons(polygons, seamOptions, splitOptions);
  return seamOverlapPolygons(split, seamOptions);
}

export function seamOverlapDiagnostics(
  polygons: Polygon[],
  options?: number | OverlapOptions,
): OverlapDiagnostics {
  const resolved = resolveSeamOverlapOptions(options);
  if (!seamOverlapEnabled(resolved, options) || polygons.length === 0) return emptyDiagnostics();
  return buildSeamEdgeAmounts(polygons, resolved).diagnostics;
}

export function seamOverlapReport(
  polygons: Polygon[],
  options?: number | OverlapOptions,
): { diagnostics: OverlapDiagnostics; candidates: OverlapCandidate[] } {
  const resolved = resolveSeamOverlapOptions(options);
  if (!seamOverlapEnabled(resolved, options) || polygons.length === 0) {
    return { diagnostics: emptyDiagnostics(), candidates: [] };
  }
  const result = buildSeamEdgeAmounts(polygons, resolved, true);
  return {
    diagnostics: result.diagnostics,
    candidates: result.candidates ?? [],
  };
}
