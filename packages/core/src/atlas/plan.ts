import type {
  Polygon,
  TextureTriangle,
  Vec2,
  Vec3,
} from "../types";
import {
  DEFAULT_TILE,
  DEFAULT_LIGHT_DIR,
  DEFAULT_LIGHT_COLOR,
  DEFAULT_LIGHT_INTENSITY,
  DEFAULT_AMBIENT_COLOR,
  DEFAULT_AMBIENT_INTENSITY,
  BASIS_EPS,
  RECT_EPS,
  SURFACE_NORMAL_EPS,
  SURFACE_DISTANCE_EPS,
  SEAM_LIGHT_EPS,
  ATLAS_CANONICAL_SIZE_EXPLICIT,
  PROJECTIVE_QUAD_DENOM_EPS,
  PROJECTIVE_QUAD_MAX_WEIGHT_RATIO,
  PROJECTIVE_QUAD_BLEED,
  SOLID_QUAD_CANONICAL_SIZE,
  resolveBleedRatio,
} from "./constants";
import type {
  TextureAtlasPlan,
  TextureTrianglePlan,
  UvAffine,
  UvSampleRect,
  LocalBasis,
  BasisOptions,
  BasisHint,
  PolygonBasisInfo,
  ProjectiveQuadGuardSettings,
  ProjectiveQuadGuardOverrides,
  ProjectiveQuadCoefficients,
  SolidTrianglePlanOptions,
  InternalSolidTrianglePlanOptions,
  StablePlanBasis,
  ComputeTextureAtlasPlanOptions,
} from "./types";
import { formatMatrix3dValues } from "./matrix";
import {
  cssPoints,
  computeSurfaceNormal,
  isConvexPolygonPoints,
  offsetConvexPolygonPoints,
  offsetConvexPolygonPointsByEdgeAmounts,
  stableBasisFromPlan,
} from "./solidTriangle";
import { textureTintFactors, shadePolygon } from "./paintDefaults";
import {
  computePlanSeamBleedEdgeAmounts,
  computeSeamBleedInsets,
  seamBleedAmountArray,
  normalizedSeamBleed,
} from "./edgeRepair";
import { resolvePolyTextureUrl } from "./textureSource";

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function resolveProjectiveQuadGuards(overrides: ProjectiveQuadGuardOverrides | undefined): ProjectiveQuadGuardSettings {
  const overrideMaxWeightRatio = overrides?.maxWeightRatio;
  const denomEps = Math.max(
    0,
    finiteNumber(overrides?.denomEps, PROJECTIVE_QUAD_DENOM_EPS),
  );
  const maxWeightRatio = typeof overrideMaxWeightRatio === "number" &&
    Number.isFinite(overrideMaxWeightRatio) &&
    overrideMaxWeightRatio > 0
    ? Math.max(1, overrideMaxWeightRatio)
    : PROJECTIVE_QUAD_MAX_WEIGHT_RATIO;
  const bleed = Math.max(
    0,
    finiteNumber(overrides?.bleed, PROJECTIVE_QUAD_BLEED),
  );

  return {
    denomEps,
    maxWeightRatio,
    bleed,
    disableGuards: overrides?.disableGuards === true,
  };
}

export function computeProjectiveQuadCoefficients(
  q: Array<[number, number]>,
  guards: ProjectiveQuadGuardSettings,
): ProjectiveQuadCoefficients | null {
  if (q.length !== 4 || !isConvexPolygonPoints(q)) return null;

  const [q0, q1, q2, q3] = q;
  const sx = q0[0] - q1[0] + q2[0] - q3[0];
  const sy = q0[1] - q1[1] + q2[1] - q3[1];
  const dx1 = q1[0] - q2[0];
  const dx2 = q3[0] - q2[0];
  const dy1 = q1[1] - q2[1];
  const dy2 = q3[1] - q2[1];
  const det = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(det) <= BASIS_EPS) return null;

  const g = (sx * dy2 - sy * dx2) / det;
  const h = (dx1 * sy - dy1 * sx) / det;
  const weights = [1, 1 + g, 1 + g + h, 1 + h];
  if (weights.some((weight) => !Number.isFinite(weight))) {
    return null;
  }

  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  if (!guards.disableGuards) {
    if (minWeight <= guards.denomEps) return null;
    // Very large homogeneous-weight variation means the rectangle's vanishing
    // line is too close to the primitive. Chrome can then tessellate the leaf
    // visibly wrong; the clipped polygon path is steadier for those quads.
    if (maxWeight / minWeight > guards.maxWeightRatio) return null;
  }

  return {
    g,
    h,
    w1: 1 + g,
    w3: 1 + h,
  };
}

export function computeProjectiveQuadMatrix(
  screenPts: number[],
  xAxis: Vec3,
  yAxis: Vec3,
  normal: Vec3,
  tx: number,
  ty: number,
  tz: number,
  guards: ProjectiveQuadGuardSettings,
  seamBleedEdgeAmounts?: ReadonlyMap<number, number>,
): string | null {
  if (screenPts.length !== 8) return null;
  const rawQ: Array<[number, number]> = [
    [screenPts[0], screenPts[1]],
    [screenPts[2], screenPts[3]],
    [screenPts[4], screenPts[5]],
    [screenPts[6], screenPts[7]],
  ];
  if (!computeProjectiveQuadCoefficients(rawQ, guards)) return null;

  const edgeAmounts = seamBleedAmountArray(4, seamBleedEdgeAmounts);
  const expandedPts = edgeAmounts
    ? offsetConvexPolygonPointsByEdgeAmounts(screenPts, edgeAmounts)
    : offsetConvexPolygonPoints(screenPts, guards.bleed);
  const q: Array<[number, number]> = [
    [expandedPts[0], expandedPts[1]],
    [expandedPts[2], expandedPts[3]],
    [expandedPts[4], expandedPts[5]],
    [expandedPts[6], expandedPts[7]],
  ];
  const coeffs = computeProjectiveQuadCoefficients(q, guards);
  if (!coeffs) return null;
  const { g, h, w1, w3 } = coeffs;
  const [q0, q1, , q3] = q;

  const p0: Vec3 = [
    tx + q0[0] * xAxis[0] + q0[1] * yAxis[0],
    ty + q0[0] * xAxis[1] + q0[1] * yAxis[1],
    tz + q0[0] * xAxis[2] + q0[1] * yAxis[2],
  ];
  const projectiveColumn = ([x, y]: Vec2, weight: number): Vec3 => [
    (weight - 1) * tx + (weight * x - q0[0]) * xAxis[0] + (weight * y - q0[1]) * yAxis[0],
    (weight - 1) * ty + (weight * x - q0[0]) * xAxis[1] + (weight * y - q0[1]) * yAxis[1],
    (weight - 1) * tz + (weight * x - q0[0]) * xAxis[2] + (weight * y - q0[1]) * yAxis[2],
  ];

  const values = [
    ...projectiveColumn(q1, w1), g,
    ...projectiveColumn(q3, w3), h,
    normal[0], normal[1], normal[2], 0,
    p0[0], p0[1], p0[2], 1,
  ];
  for (let i = 0; i < 8; i += 1) values[i] /= SOLID_QUAD_CANONICAL_SIZE;
  return formatMatrix3dValues(values, 6);
}

export function dotVec(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function crossVec(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function isBasisOptimizable(polygon: Polygon): boolean {
  return !polygon.texture;
}

export function getPolygonBasisInfo(
  polygon: Polygon,
  tile: number,
  elev: number,
): PolygonBasisInfo | null {
  if (!polygon.vertices || polygon.vertices.length < 3) return null;
  const pts = cssPoints(polygon.vertices, tile, elev);
  const normal = computeSurfaceNormal(pts);
  if (!normal) return null;
  return {
    pts,
    normal,
    planeD: dotVec(normal, pts[0]),
    optimizable: isBasisOptimizable(polygon),
  };
}

export function compatibleSurface(
  a: PolygonBasisInfo | null,
  b: PolygonBasisInfo | null,
): boolean {
  if (!a || !b || !a.optimizable || !b.optimizable) return false;
  return compatibleBleedSurface(a, b);
}

export function compatibleBleedSurface(
  a: PolygonBasisInfo | null,
  b: PolygonBasisInfo | null,
): boolean {
  if (!a || !b) return false;
  if (dotVec(a.normal, b.normal) < 1 - SURFACE_NORMAL_EPS) return false;
  return Math.abs(a.planeD - b.planeD) <= SURFACE_DISTANCE_EPS;
}

export function seamLightBrightness(
  info: PolygonBasisInfo | null,
  options: SolidTrianglePlanOptions,
): number | null {
  if (!info) return null;
  const directionalCfg = options.directionalLight;
  const ambientCfg = options.ambientLight;
  const lightDir = directionalCfg?.direction ?? DEFAULT_LIGHT_DIR;
  const lightColor = directionalCfg?.color ?? DEFAULT_LIGHT_COLOR;
  const lightIntensity = Math.max(0, directionalCfg?.intensity ?? DEFAULT_LIGHT_INTENSITY);
  const ambientColor = ambientCfg?.color ?? DEFAULT_AMBIENT_COLOR;
  const ambientIntensity = Math.max(0, ambientCfg?.intensity ?? DEFAULT_AMBIENT_INTENSITY);
  const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
  const directScale = lightIntensity * Math.max(0, info.normal[0] * lx + info.normal[1] * ly + info.normal[2] * lz);
  const tint = textureTintFactors(directScale, lightColor, ambientColor, ambientIntensity);
  return tint.r * 0.2126 + tint.g * 0.7152 + tint.b * 0.0722;
}

export function basisAxisKey(axis: Vec3): string {
  const canonical: Vec3 = [...axis] as Vec3;
  const first = Math.abs(canonical[0]) > BASIS_EPS
    ? 0
    : Math.abs(canonical[1]) > BASIS_EPS
      ? 1
      : 2;
  if (canonical[first] < 0) {
    canonical[0] *= -1;
    canonical[1] *= -1;
    canonical[2] *= -1;
  }
  return `${canonical[0].toFixed(6)},${canonical[1].toFixed(6)},${canonical[2].toFixed(6)}`;
}

export function makeLocalBasis(
  pts: Vec3[],
  origin: Vec3,
  normal: Vec3,
  rawXAxis: Vec3,
  options: { boundsOrigin?: Vec3; snapBounds?: boolean } = {},
): LocalBasis | null {
  const dot = dotVec(rawXAxis, normal);
  const planeX: Vec3 = [
    rawXAxis[0] - dot * normal[0],
    rawXAxis[1] - dot * normal[1],
    rawXAxis[2] - dot * normal[2],
  ];
  const xLength = Math.hypot(planeX[0], planeX[1], planeX[2]);
  if (xLength <= BASIS_EPS) return null;

  const xAxis: Vec3 = [
    planeX[0] / xLength,
    planeX[1] / xLength,
    planeX[2] / xLength,
  ];
  const yAxisRaw: Vec3 = [
    normal[1] * xAxis[2] - normal[2] * xAxis[1],
    normal[2] * xAxis[0] - normal[0] * xAxis[2],
    normal[0] * xAxis[1] - normal[1] * xAxis[0],
  ];
  const yLength = Math.hypot(yAxisRaw[0], yAxisRaw[1], yAxisRaw[2]);
  if (yLength <= BASIS_EPS) return null;
  const yAxis: Vec3 = [
    yAxisRaw[0] / yLength,
    yAxisRaw[1] / yLength,
    yAxisRaw[2] / yLength,
  ];

  const local2D = pts.map((p): Vec2 => {
    const dx = p[0] - origin[0], dy = p[1] - origin[1], dz = p[2] - origin[2];
    return [
      dx * xAxis[0] + dy * xAxis[1] + dz * xAxis[2],
      dx * yAxis[0] + dy * yAxis[1] + dz * yAxis[2],
    ];
  });

  const boundsOrigin = options.boundsOrigin ?? origin;
  const odx = origin[0] - boundsOrigin[0];
  const ody = origin[1] - boundsOrigin[1];
  const odz = origin[2] - boundsOrigin[2];
  const originOffsetX = odx * xAxis[0] + ody * xAxis[1] + odz * xAxis[2];
  const originOffsetY = odx * yAxis[0] + ody * yAxis[1] + odz * yAxis[2];
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const [x, y] of local2D) {
    const boundsX = x + originOffsetX;
    const boundsY = y + originOffsetY;
    if (boundsX < xMin) xMin = boundsX; if (boundsX > xMax) xMax = boundsX;
    if (boundsY < yMin) yMin = boundsY; if (boundsY > yMax) yMax = boundsY;
  }

  const w = xMax - xMin;
  const h = yMax - yMin;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;

  const boxMinX = options.snapBounds ? Math.floor(xMin + RECT_EPS) : xMin;
  const boxMinY = options.snapBounds ? Math.floor(yMin + RECT_EPS) : yMin;
  const boxMaxX = options.snapBounds ? Math.ceil(xMax - RECT_EPS) : xMax;
  const boxMaxY = options.snapBounds ? Math.ceil(yMax - RECT_EPS) : yMax;
  const canvasW = Math.max(1, options.snapBounds ? boxMaxX - boxMinX : Math.ceil(w));
  const canvasH = Math.max(1, options.snapBounds ? boxMaxY - boxMinY : Math.ceil(h));
  return {
    xAxis,
    yAxis,
    local2D,
    shiftX: originOffsetX - boxMinX,
    shiftY: originOffsetY - boxMinY,
    canvasW,
    canvasH,
    pixelArea: canvasW * canvasH,
    rawArea: w * h,
  };
}

function pointKey(point: Vec3): string {
  return `${point[0]},${point[1]},${point[2]}`;
}

function canonicalEdgeVector(a: Vec3, b: Vec3): Vec3 {
  return pointKey(a) < pointKey(b)
    ? [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    : [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function edgeKey(a: Vec3, b: Vec3): string {
  const ak = pointKey(a);
  const bk = pointKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

export function evaluateIslandAxis(
  component: number[],
  infos: Array<PolygonBasisInfo | null>,
  axis: Vec3,
  boundsOrigin: Vec3,
): { pixelArea: number; rawArea: number } | null {
  let pixelArea = 0;
  let rawArea = 0;
  for (const index of component) {
    const info = infos[index];
    if (!info) return null;
    const basis = makeLocalBasis(info.pts, info.pts[0], info.normal, axis, {
      boundsOrigin,
      snapBounds: true,
    });
    if (!basis) return null;
    pixelArea += basis.pixelArea;
    rawArea += basis.rawArea;
  }
  return { pixelArea, rawArea };
}

export function chooseIslandXAxis(
  component: number[],
  infos: Array<PolygonBasisInfo | null>,
): BasisHint | null {
  const boundsOrigin = infos[component[0]]?.pts[0];
  if (!boundsOrigin) return null;
  let baseline: { pixelArea: number; rawArea: number } | null = { pixelArea: 0, rawArea: 0 };
  let best: { xAxis: Vec3; pixelArea: number; rawArea: number } | null = null;
  const seen = new Set<string>();

  for (const polygonIndex of component) {
    const info = infos[polygonIndex];
    if (!info) continue;

    const firstEdge: Vec3 = [
      info.pts[1][0] - info.pts[0][0],
      info.pts[1][1] - info.pts[0][1],
      info.pts[1][2] - info.pts[0][2],
    ];
    const firstBasis = makeLocalBasis(info.pts, info.pts[0], info.normal, firstEdge);
    if (baseline && firstBasis) {
      baseline.pixelArea += firstBasis.pixelArea;
      baseline.rawArea += firstBasis.rawArea;
    } else {
      baseline = null;
    }

    for (let i = 0; i < info.pts.length; i++) {
      const rawAxis = canonicalEdgeVector(info.pts[i], info.pts[(i + 1) % info.pts.length]);
      const basis = makeLocalBasis(info.pts, info.pts[0], info.normal, rawAxis);
      if (!basis) continue;
      const key = basisAxisKey(basis.xAxis);
      if (seen.has(key)) continue;
      seen.add(key);

      const candidate = evaluateIslandAxis(component, infos, basis.xAxis, boundsOrigin);
      if (!candidate) continue;
      if (
        !best ||
        candidate.pixelArea < best.pixelArea ||
        (candidate.pixelArea === best.pixelArea && candidate.rawArea < best.rawArea - RECT_EPS)
      ) {
        best = { xAxis: basis.xAxis, ...candidate };
      }
    }
  }

  if (!best) return null;
  if (
    baseline &&
    (
      best.pixelArea < baseline.pixelArea ||
      (best.pixelArea === baseline.pixelArea && best.rawArea <= baseline.rawArea + RECT_EPS)
    )
  ) {
    return { xAxis: best.xAxis, boundsOrigin, seamEdges: new Set<number>() };
  }
  return null;
}

export function buildBasisHints(
  polygons: Polygon[],
  options: SolidTrianglePlanOptions,
): Array<BasisHint | undefined> {
  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? tile;
  const infos = polygons.map((polygon) => getPolygonBasisInfo(polygon, tile, elev));
  const edgeOwners = new Map<string, Array<{ polygon: number; edge: number }>>();
  const seamEdges = polygons.map(() => new Set<number>());
  const textureEdgeRepairEdges = polygons.map(() => new Set<number>());
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
    const vertices = polygons[polygonIndex].vertices;
    if (!vertices || vertices.length < 3) continue;
    for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex++) {
      const key = edgeKey(
        vertices[edgeIndex],
        vertices[(edgeIndex + 1) % vertices.length],
      );
      const owners = edgeOwners.get(key);
      const owner = { polygon: polygonIndex, edge: edgeIndex };
      if (owners) owners.push(owner);
      else edgeOwners.set(key, [owner]);
    }
  }

  const adjacency = polygons.map(() => new Set<number>());
  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const aOwner = owners[i];
        const bOwner = owners[j];
        const a = aOwner.polygon;
        const b = bOwner.polygon;
        if (polygons[a].texture && polygons[b].texture) {
          textureEdgeRepairEdges[aOwner.polygon].add(aOwner.edge);
          textureEdgeRepairEdges[bOwner.polygon].add(bOwner.edge);
        }
        if (compatibleBleedSurface(infos[a], infos[b])) {
          seamEdges[aOwner.polygon].add(aOwner.edge);
          seamEdges[bOwner.polygon].add(bOwner.edge);
        } else {
          const aLight = seamLightBrightness(infos[a], options);
          const bLight = seamLightBrightness(infos[b], options);
          if (aLight !== null && bLight !== null) {
            if (aLight <= bLight + SEAM_LIGHT_EPS) seamEdges[aOwner.polygon].add(aOwner.edge);
            if (bLight <= aLight + SEAM_LIGHT_EPS) seamEdges[bOwner.polygon].add(bOwner.edge);
          }
        }
        if (!compatibleSurface(infos[a], infos[b])) continue;
        adjacency[a].add(b);
        adjacency[b].add(a);
      }
    }
  }

  const hints: Array<BasisHint | undefined> = Array(polygons.length).fill(undefined);
  const visited = new Set<number>();
  for (let i = 0; i < polygons.length; i++) {
    if (visited.has(i) || !infos[i]?.optimizable) continue;
    const component: number[] = [];
    const stack = [i];
    visited.add(i);
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adjacency[current]) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }

    if (component.length < 2) continue;
    const hint = chooseIslandXAxis(component, infos);
    if (!hint) continue;
    for (const index of component) {
      hints[index] = {
        xAxis: hint.xAxis,
        boundsOrigin: hint.boundsOrigin,
        seamEdges: seamEdges[index],
        textureEdgeRepairEdges: textureEdgeRepairEdges[index],
      };
    }
  }

  for (let i = 0; i < polygons.length; i++) {
    if (!hints[i] && (seamEdges[i].size > 0 || textureEdgeRepairEdges[i].size > 0)) {
      hints[i] = {
        seamEdges: seamEdges[i],
        textureEdgeRepairEdges: textureEdgeRepairEdges[i],
      };
    }
  }

  return hints;
}

export function chooseLocalBasis(
  pts: Vec3[],
  origin: Vec3,
  normal: Vec3,
  options: BasisOptions,
): LocalBasis | null {
  if (options.optimize && options.fixedXAxis) {
    return makeLocalBasis(pts, origin, normal, options.fixedXAxis, {
      boundsOrigin: options.boundsOrigin,
      snapBounds: options.snapBounds,
    });
  }

  let best: LocalBasis | null = null;
  const seamCandidates = options.optimize && options.seamEdges && options.seamEdges.size > 0
    ? Array.from(options.seamEdges)
    : null;
  const candidateEdges = seamCandidates ?? (
    options.optimize
      ? pts.map((_, edgeIndex) => edgeIndex)
      : [0]
  );

  for (const i of candidateEdges) {
    const next = (i + 1) % pts.length;
    const edge = seamCandidates
      ? canonicalEdgeVector(pts[i], pts[next])
      : [
          pts[next][0] - pts[i][0],
          pts[next][1] - pts[i][1],
          pts[next][2] - pts[i][2],
        ] as Vec3;
    const candidate = makeLocalBasis(pts, origin, normal, edge, {
      boundsOrigin: options.boundsOrigin,
      snapBounds: options.snapBounds,
    });
    if (!candidate) continue;

    if (
      !best ||
      candidate.pixelArea < best.pixelArea ||
      (candidate.pixelArea === best.pixelArea && candidate.rawArea < best.rawArea - RECT_EPS)
    ) {
      best = candidate;
    }
  }

  return best;
}

export function isFullRectBasis(basis: LocalBasis): boolean {
  if (basis.local2D.length !== 4) return false;

  const xs: number[] = [];
  const ys: number[] = [];
  const addUnique = (list: number[], value: number): void => {
    for (const existing of list) {
      if (Math.abs(existing - value) <= RECT_EPS) return;
    }
    list.push(value);
  };

  for (const [x, y] of basis.local2D) {
    addUnique(xs, x + basis.shiftX);
    addUnique(ys, y + basis.shiftY);
  }
  if (xs.length !== 2 || ys.length !== 2) return false;

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  if (
    Math.abs(xs[0]) > RECT_EPS ||
    Math.abs(ys[0]) > RECT_EPS ||
    xs[1] - xs[0] <= RECT_EPS ||
    ys[1] - ys[0] <= RECT_EPS
  ) {
    return false;
  }

  for (const [rawX, rawY] of basis.local2D) {
    const x = rawX + basis.shiftX;
    const y = rawY + basis.shiftY;
    const onX = Math.abs(x - xs[0]) <= RECT_EPS || Math.abs(x - xs[1]) <= RECT_EPS;
    const onY = Math.abs(y - ys[0]) <= RECT_EPS || Math.abs(y - ys[1]) <= RECT_EPS;
    if (!onX || !onY) return false;
  }
  return true;
}

export function computeUvAffine(points: Vec2[], uvs: Vec2[]): UvAffine | null {
  if (points.length < 3 || uvs.length < 3) return null;
  const [p0, p1, p2] = points;
  const [uv0, uv1, uv2] = uvs;
  const sx0 = p0[0], sy0 = p0[1];
  const sx1 = p1[0], sy1 = p1[1];
  const sx2 = p2[0], sy2 = p2[1];
  const u0 = uv0[0], V0 = 1 - uv0[1];
  const u1 = uv1[0], V1 = 1 - uv1[1];
  const u2 = uv2[0], V2 = 1 - uv2[1];
  const du1 = u1 - u0, dV1 = V1 - V0;
  const du2 = u2 - u0, dV2 = V2 - V0;
  const det = du1 * dV2 - du2 * dV1;
  if (Math.abs(det) <= 1e-9) return null;

  const dx1 = sx1 - sx0, dx2 = sx2 - sx0;
  const dy1 = sy1 - sy0, dy2 = sy2 - sy0;
  const affine = {
    a: (dx1 * dV2 - dx2 * dV1) / det,
    b: (du1 * dx2 - du2 * dx1) / det,
    c: (dy1 * dV2 - dy2 * dV1) / det,
    d: (du1 * dy2 - du2 * dy1) / det,
    e: 0,
    f: 0,
  };
  affine.e = sx0 - affine.a * u0 - affine.b * V0;
  affine.f = sy0 - affine.c * u0 - affine.d * V0;
  return affine;
}

export function computeUvSampleRect(uvs: Vec2[]): UvSampleRect | null {
  if (uvs.length === 0) return null;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const uv of uvs) {
    const u = uv[0];
    const v = 1 - uv[1];
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return { minU, minV, maxU, maxV };
}

export function projectTextureTriangle(
  triangle: TextureTriangle,
  tile: number,
  elev: number,
  origin: Vec3,
  xAxis: Vec3,
  yAxis: Vec3,
  shiftX: number,
  shiftY: number,
): TextureTrianglePlan | null {
  const pts = cssPoints(triangle.vertices, tile, elev);
  const points = pts.map((point): Vec2 => {
    const dx = point[0] - origin[0];
    const dy = point[1] - origin[1];
    const dz = point[2] - origin[2];
    return [
      dx * xAxis[0] + dy * xAxis[1] + dz * xAxis[2] + shiftX,
      dx * yAxis[0] + dy * yAxis[1] + dz * yAxis[2] + shiftY,
    ];
  });
  const uvAffine = computeUvAffine(points, triangle.uvs);
  const uvSampleRect = computeUvSampleRect(triangle.uvs);
  if (!uvAffine && !uvSampleRect) return null;
  return {
    screenPts: points.flatMap(([x, y]) => [x, y]),
    uvAffine,
    uvSampleRect,
  };
}

export function computeTextureAtlasPlan(
  polygon: Polygon,
  index: number,
  options: SolidTrianglePlanOptions,
  projectiveQuadGuards: ProjectiveQuadGuardSettings,
  basisHint?: BasisHint,
): TextureAtlasPlan | null {
  const internalOptions = options as InternalSolidTrianglePlanOptions;
  const { vertices, uvs } = polygon;
  const texture = resolvePolyTextureUrl(polygon);
  if (!vertices || vertices.length < 3) return null;

  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? tile;
  const pts = cssPoints(vertices, tile, elev);
  const p0 = pts[0];
  const p1 = pts[1];

  const e1: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const l01 = Math.hypot(e1[0], e1[1], e1[2]);
  if (l01 === 0) return null;

  const normal = computeSurfaceNormal(pts);
  if (!normal) return null;

  const firstEdgeBasis = chooseLocalBasis(pts, p0, normal, { optimize: false });
  const basis = texture
    ? firstEdgeBasis
    : firstEdgeBasis && isFullRectBasis(firstEdgeBasis)
      ? firstEdgeBasis
      : chooseLocalBasis(pts, p0, normal, {
          optimize: true,
          fixedXAxis: basisHint?.xAxis,
          boundsOrigin: basisHint?.boundsOrigin,
          snapBounds: Boolean(basisHint),
          seamEdges: basisHint?.seamEdges,
        });
  if (!basis) return null;
  const { xAxis, yAxis, local2D } = basis;
  const textureEdgeRepairEdges = texture && basisHint?.textureEdgeRepairEdges?.size
    ? basisHint.textureEdgeRepairEdges
    : null;
  const textureEdgeRepair = Boolean(texture && textureEdgeRepairEdges);
  const shiftX = basis.shiftX;
  const shiftY = basis.shiftY;
  const canvasW = basis.canvasW;
  const canvasH = basis.canvasH;

  const screenPts: number[] = [];
  for (const [x, y] of local2D) screenPts.push(x + shiftX, y + shiftY);

  const tx = p0[0] - shiftX * xAxis[0] - shiftY * yAxis[0];
  const ty = p0[1] - shiftX * xAxis[1] - shiftY * yAxis[1];
  const tz = p0[2] - shiftX * xAxis[2] - shiftY * yAxis[2];
  const matrix = formatMatrix3dValues([
    xAxis[0], xAxis[1], xAxis[2], 0,
    yAxis[0], yAxis[1], yAxis[2], 0,
    normal[0], normal[1], normal[2], 0,
    tx, ty, tz, 1,
  ]);
  const canonicalMatrix = formatMatrix3dValues([
    xAxis[0] * canvasW, xAxis[1] * canvasW, xAxis[2] * canvasW, 0,
    yAxis[0] * canvasH, yAxis[1] * canvasH, yAxis[2] * canvasH, 0,
    normal[0], normal[1], normal[2], 0,
    tx, ty, tz, 1,
  ]);
  const atlasMatrix = formatMatrix3dValues([
    xAxis[0] * canvasW / ATLAS_CANONICAL_SIZE_EXPLICIT,
    xAxis[1] * canvasW / ATLAS_CANONICAL_SIZE_EXPLICIT,
    xAxis[2] * canvasW / ATLAS_CANONICAL_SIZE_EXPLICIT,
    0,
    yAxis[0] * canvasH / ATLAS_CANONICAL_SIZE_EXPLICIT,
    yAxis[1] * canvasH / ATLAS_CANONICAL_SIZE_EXPLICIT,
    yAxis[2] * canvasH / ATLAS_CANONICAL_SIZE_EXPLICIT,
    0,
    normal[0], normal[1], normal[2], 0,
    tx, ty, tz, 1,
  ]);
  const seamBleedRequest = normalizedSeamBleed(internalOptions.seamBleed);
  const seamBleedEdgeAmounts = computePlanSeamBleedEdgeAmounts(
    screenPts,
    internalOptions.seamEdges ?? basisHint?.seamEdges,
    seamBleedRequest,
  );
  const seamBleedEdges = seamBleedEdgeAmounts
    ? new Set(seamBleedEdgeAmounts.keys())
    : undefined;
  const seamBleed = seamBleedEdgeAmounts
    ? Math.max(...seamBleedEdgeAmounts.values())
    : undefined;
  const seamBleedInsets = computeSeamBleedInsets(screenPts, seamBleedEdgeAmounts);
  const projectiveMatrix = !texture && vertices.length === 4
    ? computeProjectiveQuadMatrix(
        screenPts,
        xAxis,
        yAxis,
        normal,
        tx,
        ty,
        tz,
        projectiveQuadGuards,
        seamBleedEdgeAmounts,
      )
    : null;

  const directionalCfg = options.directionalLight;
  const ambientCfg = options.ambientLight;
  const lightDir = directionalCfg?.direction ?? DEFAULT_LIGHT_DIR;
  const lightColor = directionalCfg?.color ?? DEFAULT_LIGHT_COLOR;
  const lightIntensity = Math.max(0, directionalCfg?.intensity ?? DEFAULT_LIGHT_INTENSITY);
  const ambientColor = ambientCfg?.color ?? DEFAULT_AMBIENT_COLOR;
  const ambientIntensity = Math.max(0, ambientCfg?.intensity ?? DEFAULT_AMBIENT_INTENSITY);
  const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
  // Decoupled: directional and ambient sum independently. No (1 - ambient)
  // budget — matches three.js's lighting model.
  const occluded = options.lightOccludedPolyIndices?.has(index) ?? false;
  const directScale = occluded
    ? 0
    : lightIntensity * Math.max(0, normal[0] * lx + normal[1] * ly + normal[2] * lz);
  const textureTint = textureTintFactors(directScale, lightColor, ambientColor, ambientIntensity);
  const shadedColor = shadePolygon(polygon.color ?? "#cccccc", directScale, lightColor, ambientColor, ambientIntensity);

  let uvAffine: UvAffine | null = null;
  let uvSampleRect: UvSampleRect | null = null;
  if (texture && uvs && uvs.length >= 3 && uvs.length === vertices.length) {
    uvSampleRect = computeUvSampleRect(uvs);
    uvAffine = computeUvAffine(
      local2D.map(([x, y]) => [x + shiftX, y + shiftY]),
      uvs,
    );
  }
  const textureTriangles = texture && polygon.textureTriangles?.length
    ? polygon.textureTriangles
        .map((triangle) =>
          projectTextureTriangle(triangle, tile, elev, p0, xAxis, yAxis, shiftX, shiftY)
        )
        .filter((triangle): triangle is TextureTrianglePlan => !!triangle)
    : null;

  return {
    index,
    polygon,
    texture,
    tileSize: tile,
    layerElevation: elev,
    matrix,
    canonicalMatrix,
    atlasMatrix,
    projectiveMatrix,
    canvasW,
    canvasH,
    screenPts,
    uvAffine,
    uvSampleRect,
    textureTriangles,
    textureEdgeRepairEdges,
    textureEdgeRepair,
    seamBleed,
    seamBleedEdges,
    seamBleedEdgeAmounts,
    seamBleedInsets,
    // Stamp the resolved per-strategy bleed ratio onto the plan so
    // downstream emitters (borderShape, projective-quad, atlas-edge
    // expand, etc.) all read the same value from the plan instead of
    // each having to thread `options.seamBleed` through their own
    // function-parameter chains.
    bleedRatio: resolveBleedRatio(internalOptions.seamBleed),
    normal,
    textureTint,
    shadedColor,
  };
}

/**
 * Compute the per-polygon layout plan for one polygon in isolation.
 *
 * This is the public single-polygon variant used by React and Vue components.
 * It does not run the cross-polygon basis-optimisation or seam-detection that
 * the full `renderPolygonsWithTextureAtlas` pipeline performs, but the
 * strategy selection (projective-quad, rect, etc.) is identical to the
 * canonical renderer.
 *
 * The `projectiveQuadOverrides` parameter is the pre-resolved override bag
 * formerly obtained from `doc.defaultView.__polycssProjectiveQuadGuards`.
 * Callers that have a Document should extract it before calling; callers in
 * browser-free environments can pass `undefined` for the default guards.
 */
export function computeTextureAtlasPlanPublic(
  polygon: Polygon,
  index: number,
  options: ComputeTextureAtlasPlanOptions = {},
  projectiveQuadOverrides?: ProjectiveQuadGuardOverrides,
  /** Cross-polygon basis hint pre-computed via {@link buildBasisHints} on
   *  the full polygon array. When supplied, it overrides the per-polygon
   *  textureEdgeRepairEdges fallback below. Vanilla's renderer always passes
   *  this from {@link buildBasisHints}; React/Vue mirror that path. */
  basisHintOverride?: BasisHint,
): TextureAtlasPlan | null {
  const projectiveQuadGuards = resolveProjectiveQuadGuards(projectiveQuadOverrides);
  const internalOptions = options as ComputeTextureAtlasPlanOptions & InternalSolidTrianglePlanOptions;
  // Only auto-construct a basisHint when textureEdgeRepairEdges is provided
  // — that field is read ONLY off the basisHint inside computeTextureAtlasPlan,
  // so single-polygon callers passing it via options need this bridge.
  // DO NOT also auto-forward options.seamEdges to basisHint.seamEdges — those
  // two fields are read by different code paths (bleed amount vs basis edge-
  // candidate restriction), and forwarding them here makes React/Vue pick a
  // different basis for any polygon with a seam-bleed edge, breaking parity
  // with vanilla's renderer which never reconstructs such a hint.
  const basisHint: BasisHint | undefined = basisHintOverride
    ?? (options.textureEdgeRepairEdges?.size
      ? {
          seamEdges: new Set<number>(),
          textureEdgeRepairEdges: options.textureEdgeRepairEdges,
        }
      : undefined);
  return computeTextureAtlasPlan(polygon, index, internalOptions, projectiveQuadGuards, basisHint);
}

// Re-export from solidTriangle so callers that import from plan continue to work.
export { stableBasisFromPlan };
