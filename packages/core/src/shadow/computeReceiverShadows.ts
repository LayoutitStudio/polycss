/**
 * Pure receiver-shadow algorithm. For each coplanar receiver face group on a
 * `receiveShadow: true` mesh, project every caster polygon onto that face's
 * plane along the directional-light vector, Sutherland-Hodgman-clip against
 * the face outline, and emit one ShadowFaceSpec per visible group.
 *
 * Shared across vanilla / React / Vue. Renderers handle cache invalidation
 * + DOM mounting; this module owns the geometry.
 *
 * Caching strategy: every input is precomputed by the caller (caster items +
 * receiver face planes). The caller maintains WeakMap<Mesh, ...> caches and
 * re-runs the prepare* helpers only when their bust keys change. The
 * compute step is pure data-in/data-out so it's safe to call every frame.
 */
import { BASE_TILE } from "../camera/camera";
import { normalFacesCamera, type CameraCullRotation } from "../cull/cameraBackfaceCulling";
import { shadePolygon } from "../atlas/paintDefaults";
import { clipPolygonToConvex2D } from "./clipping";
import { ensureCcw2D } from "./projection";
import {
  groupReceiverFaceGroups,
  meshScaleVec3,
  worldCssForMesh,
} from "./receiverFaceGroups";
import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  Polygon,
  Vec3,
} from "../types";

/**
 * Per-receiver cached face geometry. One record per coplanar face group:
 * plane (O, n, u, v), outline polygon (Sutherland-Hodgman clip), bbox in
 * (u, v) for SVG sizing, and the pre-stringified matrix3d transform that
 * places an SVG on that face plane.
 *
 * All of this is invariant under light/caster changes. Per light tick the
 * caller just re-runs the per-tri SH and builds the path `d` — never
 * recompute groups or basis. Cache invalidated when the receiver's polygon
 * count or position changes.
 */
export interface ReceiverFacePlane {
  O: Vec3;
  n: Vec3;
  u: Vec3;
  v: Vec3;
  outlineUv: Array<[number, number]>;
  memberPolysUv: Array<Array<[number, number]>>;
  memberPolyIndices: number[];
  minU: number;
  minV: number;
  width: number;
  height: number;
  matrixCss: string;
  faceIndex: number;
}

/**
 * Per-caster cached per-polygon data: world-space vertices + 3D AABB
 * corners + caster-polygon plane normal/offset. Invariant under light
 * direction; depends only on the caster mesh's geometry and position.
 */
export interface CasterPolyItem {
  wv: Vec3[];
  bboxCorners: Vec3[];
  planeN: Vec3 | null;
  planeOffset: number;
  polygonIndex: number;
}

/** A caster mesh's prepared items paired with a stable identifier the caller
 *  can use for per-path attribution. */
export interface ReceiverCasterInput<T = unknown> {
  /** Caller-defined identifier (e.g. mesh ref, mesh shadow id). Echoed back
   *  on each emitted path so the renderer can map a subpath to its source
   *  caster mesh. */
  id: T;
  items: CasterPolyItem[];
}

/** One contributing caster's shadow subpath on a single receiver face. */
export interface ReceiverShadowPath<T = unknown> {
  /** Caster id echoed from the input. */
  casterId: T;
  /** Path data string: `M…L…Z` subpaths in face-local (u, v) coordinates
   *  pre-translated so the SVG's `viewBox` is `0 0 width height`. */
  d: string;
  /** Source polygon indices on the caster mesh in subpath order (one per
   *  M…L…Z block). Used for DevTools attribution. */
  casterPolygonIndices: number[];
}

/** Per-receiver-face shadow spec. Renderer mounts one SVG per spec. */
export interface ReceiverShadowFaceSpec<T = unknown> {
  /** Index into the prepared `ReceiverFacePlane[]` list. Stable across
   *  frames; used as the `data-poly-shadow-receiver-face` attr. */
  faceIndex: number;
  /** Receiver polygon indices that make up this coplanar group. */
  memberPolyIndices: number[];
  /** matrix3d(...) transform that places the SVG on the face plane. */
  matrixCss: string;
  width: number;
  height: number;
  /** Fill (and stroke) color resolved per-face: textured receivers get the
   *  user's `shadow.color`; solid receivers get their own ambient-only
   *  shadePolygon for byte-exact Three.js parity. */
  fill: string;
  /** Per-face opacity (already accounts for textured-darken Lambert ratio
   *  if applicable). */
  opacity: number;
  paths: Array<ReceiverShadowPath<T>>;
}

/**
 * Build CasterPolyItem[] for a caster mesh. Pure: same inputs → same output.
 * The caller memoizes by mesh ref + bust key. `includePolygonIndex(idx)`
 * decides which polygons participate (e.g. dedup drop + atlas-plan filter
 * in vanilla; just dedup drop in React/Vue without an atlas-plan concept).
 */
export function prepareCasterPolyItems(
  polygons: readonly Polygon[],
  position: Vec3,
  scale: number | Vec3 | undefined | null,
  includePolygonIndex: (polygonIndex: number) => boolean,
): CasterPolyItem[] {
  const out: CasterPolyItem[] = [];
  const worldCss = worldCssForMesh(scale);
  for (let i = 0; i < polygons.length; i++) {
    if (!includePolygonIndex(i)) continue;
    const polygon = polygons[i];
    if (!polygon) continue;
    const wv = polygon.vertices.map((vert) => worldCss(vert, position));
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const w of wv) {
      if (w[0] < minX) minX = w[0]; if (w[0] > maxX) maxX = w[0];
      if (w[1] < minY) minY = w[1]; if (w[1] > maxY) maxY = w[1];
      if (w[2] < minZ) minZ = w[2]; if (w[2] > maxZ) maxZ = w[2];
    }
    const bboxCorners: Vec3[] = [
      [minX, minY, minZ], [maxX, minY, minZ],
      [minX, maxY, minZ], [maxX, maxY, minZ],
      [minX, minY, maxZ], [maxX, minY, maxZ],
      [minX, maxY, maxZ], [maxX, maxY, maxZ],
    ];
    let planeN: Vec3 | null = null;
    let planeOffset = 0;
    if (wv.length >= 3) {
      const O = wv[0]!, w1 = wv[1]!, w2 = wv[2]!;
      const e1: Vec3 = [w1[0] - O[0], w1[1] - O[1], w1[2] - O[2]];
      const e2: Vec3 = [w2[0] - O[0], w2[1] - O[1], w2[2] - O[2]];
      const nx = e2[1] * e1[2] - e2[2] * e1[1];
      const ny = e2[2] * e1[0] - e2[0] * e1[2];
      const nz = e2[0] * e1[1] - e2[1] * e1[0];
      const nLen = Math.hypot(nx, ny, nz);
      if (nLen > 1e-9) {
        planeN = [nx / nLen, ny / nLen, nz / nLen];
        planeOffset = planeN[0] * O[0] + planeN[1] * O[1] + planeN[2] * O[2];
      }
    }
    out.push({ wv, bboxCorners, planeN, planeOffset, polygonIndex: i });
  }
  return out;
}

/**
 * Build ReceiverFacePlane[] for a receiver mesh. Pure: groups coplanar
 * polygons, computes (u,v) basis + outline, applies interior occlusion cull
 * (drops face planes hidden behind a parallel face plane within wall-
 * thickness range).
 *
 * `shadowLift` is the world-unit lift applied along each face normal so the
 * shadow SVG composites above the surface without z-fighting (matches the
 * ground-shadow `shadow.lift` option).
 */
export function prepareReceiverFacePlanes(
  polygons: readonly Polygon[],
  position: Vec3,
  scale: number | Vec3 | undefined | null,
  dedupDrop: ReadonlySet<number>,
  shadowLift: number,
): ReceiverFacePlane[] {
  const worldCss = worldCssForMesh(scale);
  const surfaces = groupReceiverFaceGroups(polygons, position, worldCss, dedupDrop);
  let planes: ReceiverFacePlane[] = surfaces.map((group, faceIndex): ReceiverFacePlane => {
    const { O, n, u, v, outlineUv, memberPolysUv, memberPolyIndices } = group;
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const pt of outlineUv) {
      if (pt[0] < minU) minU = pt[0];
      if (pt[1] < minV) minV = pt[1];
      if (pt[0] > maxU) maxU = pt[0];
      if (pt[1] > maxV) maxV = pt[1];
    }
    const width = maxU - minU;
    const height = maxV - minV;
    const lift = shadowLift * BASE_TILE;
    const Ox = O[0] + minU * u[0] + minV * v[0] + lift * n[0];
    const Oy = O[1] + minU * u[1] + minV * v[1] + lift * n[1];
    const Oz = O[2] + minU * u[2] + minV * v[2] + lift * n[2];
    const m = [
      u[0], u[1], u[2], 0,
      v[0], v[1], v[2], 0,
      n[0], n[1], n[2], 0,
      Ox,   Oy,   Oz,   1,
    ];
    const matrixCss = `matrix3d(${m.map((x) => x.toFixed(4)).join(",")})`;
    return {
      O, n, u, v, outlineUv, memberPolysUv, memberPolyIndices,
      minU, minV, width, height, matrixCss, faceIndex,
    };
  });

  // Interior occlusion cull. Drop face planes hidden behind a parallel
  // plane along the outward normal (interior wall layers inside imported
  // building meshes). Without z-buffer occlusion the interior wall's shadow
  // would paint where the user can't see it.
  const OCCL_NORMAL_TOL = 0.015;
  const OCCL_OFFSET_TOL = 0.5;
  // Wall thickness is typically 1-10 CSS px; beyond that the planes are
  // separated by air, not nested geometry.
  const OCCL_MAX_GAP = 20;
  const occluded = new Set<number>();
  for (let i = 0; i < planes.length; i++) {
    if (occluded.has(i)) continue;
    const pi = planes[i]!;
    const offsetI = pi.n[0] * pi.O[0] + pi.n[1] * pi.O[1] + pi.n[2] * pi.O[2];
    const iMinU = pi.minU, iMinV = pi.minV;
    const iMaxU = pi.minU + pi.width, iMaxV = pi.minV + pi.height;
    for (let j = 0; j < planes.length; j++) {
      if (j === i || occluded.has(j)) continue;
      const pj = planes[j]!;
      const dotN = pi.n[0] * pj.n[0] + pi.n[1] * pj.n[1] + pi.n[2] * pj.n[2];
      if (dotN < 1 - OCCL_NORMAL_TOL) continue;
      const offsetJ = pi.n[0] * pj.O[0] + pi.n[1] * pj.O[1] + pi.n[2] * pj.O[2];
      if (offsetJ <= offsetI + OCCL_OFFSET_TOL) continue;
      if (offsetJ - offsetI > OCCL_MAX_GAP) continue;
      let jMinU = Infinity, jMinV = Infinity, jMaxU = -Infinity, jMaxV = -Infinity;
      for (const pt of pj.outlineUv) {
        const wx = pj.O[0] + pt[0] * pj.u[0] + pt[1] * pj.v[0];
        const wy = pj.O[1] + pt[0] * pj.u[1] + pt[1] * pj.v[1];
        const wz = pj.O[2] + pt[0] * pj.u[2] + pt[1] * pj.v[2];
        const dx = wx - pi.O[0], dy = wy - pi.O[1], dz = wz - pi.O[2];
        const iu = dx * pi.u[0] + dy * pi.u[1] + dz * pi.u[2];
        const iv = dx * pi.v[0] + dy * pi.v[1] + dz * pi.v[2];
        if (iu < jMinU) jMinU = iu;
        if (iu > jMaxU) jMaxU = iu;
        if (iv < jMinV) jMinV = iv;
        if (iv > jMaxV) jMaxV = iv;
      }
      if (jMinU <= iMinU && jMaxU >= iMaxU && jMinV <= iMinV && jMaxV >= iMaxV) {
        // Don't cull when j is much LARGER than i — small surface feature
        // (door frame, recess) sitting inside a broader wall.
        const iArea = Math.max(0, iMaxU - iMinU) * Math.max(0, iMaxV - iMinV);
        const jArea = Math.max(0, jMaxU - jMinU) * Math.max(0, jMaxV - jMinV);
        const OCCL_AREA_RATIO = 2.0;
        if (jArea > iArea * OCCL_AREA_RATIO) continue;
        occluded.add(i);
        break;
      }
    }
  }
  planes = planes.filter((_, i) => !occluded.has(i));
  return planes;
}

/** Input for `computeReceiverShadowFaces`. */
export interface ComputeReceiverShadowFacesInput<T = unknown> {
  /** Precomputed face planes from `prepareReceiverFacePlanes`. */
  receiverPlanes: ReceiverFacePlane[];
  /** Receiver's polygon list, used to look up per-face fill color. */
  receiverPolygons: readonly Polygon[];
  /** Whether the receiver mesh has any textured polygons. Drives the
   *  textured-darken opacity calc vs solid-replace fill color. */
  receiverHasTexture: boolean;
  /** Per-caster items + caller id, in caller-defined order. */
  casters: ReceiverCasterInput<T>[];
  /** Directional light vector in CSS frame. */
  lightDir: Vec3;
  /** Camera cull rotation (rotX/rotY + receiver mesh rotation) so back-
   *  facing receiver faces can be skipped. */
  cameraRot: CameraCullRotation;
  /** Ambient light (used for solid-receiver shadow tint via shadePolygon). */
  ambientLight?: PolyAmbientLight;
  /** Directional light (used for textured-darken opacity calc). */
  directionalLight?: PolyDirectionalLight;
  /** Scene shadow options. */
  shadow?: { color?: string; opacity?: number };
}

/**
 * The pure per-frame algorithm. Returns one ReceiverShadowFaceSpec for each
 * visible receiver face that catches at least one caster's shadow. Skips
 * back-facing faces. Caller mounts SVGs per spec.
 */
export function computeReceiverShadowFaces<T = unknown>(
  input: ComputeReceiverShadowFacesInput<T>,
): ReceiverShadowFaceSpec<T>[] {
  const {
    receiverPlanes, receiverPolygons, receiverHasTexture, casters,
    lightDir, cameraRot, ambientLight, directionalLight, shadow,
  } = input;

  const llen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const Lx = lightDir[0] / llen;
  const Ly = lightDir[1] / llen;
  const Lz = lightDir[2] / llen;
  const ambColor = ambientLight?.color ?? "#ffffff";
  const ambIntensity = ambientLight?.intensity ?? 0.4;
  const dirIntensity = directionalLight?.intensity ?? 1;
  const userShadowColor = shadow?.color ?? "#000000";
  const opacity = shadow?.opacity ?? 0.25;

  const out: ReceiverShadowFaceSpec<T>[] = [];

  for (const group of receiverPlanes) {
    const { O, n, u, v, outlineUv, minU, minV, width, height, matrixCss } = group;
    // Back-facing receiver face → can't receive light → skip.
    const Ldotn = Lx * n[0] + Ly * n[1] + Lz * n[2];
    if (Ldotn <= 1e-6) continue;
    // Camera back-face cull. SVGs don't honor CSS backface-visibility
    // reliably, so a back-of-camera receiver-face SVG would still paint.
    if (!normalFacesCamera(n, cameraRot)) continue;

    const planeDist = (w: Vec3): number =>
      (w[0] - O[0]) * n[0] + (w[1] - O[1]) * n[1] + (w[2] - O[2]) * n[2];
    const planeCross = (a: Vec3, b: Vec3, da: number, db: number): Vec3 => {
      const s = da / (da - db);
      return [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1]), a[2] + s * (b[2] - a[2])];
    };
    const projectOntoPlane = (w: Vec3): [number, number] => {
      const VmOx = w[0] - O[0];
      const VmOy = w[1] - O[1];
      const VmOz = w[2] - O[2];
      const t = (VmOx * n[0] + VmOy * n[1] + VmOz * n[2]) / Ldotn;
      const Px = w[0] - t * Lx;
      const Py = w[1] - t * Ly;
      const Pz = w[2] - t * Lz;
      const dx = Px - O[0];
      const dy = Py - O[1];
      const dz = Pz - O[2];
      return [dx * u[0] + dy * u[1] + dz * u[2], dx * v[0] + dy * v[1] + dz * v[2]];
    };

    type PerCasterClip = {
      id: T;
      verts: Array<Array<[number, number]>>;
      subPolygonIndices: number[];
    };
    const clippedByCaster = new Map<T, PerCasterClip>();
    let totalClipped = 0;
    const fMinU = minU, fMinV = minV;
    const fMaxU = group.minU + width;
    const fMaxV = group.minV + height;
    const SELF_SHADOW_EPS = 0.05;
    const receiverPlaneOffset = n[0] * O[0] + n[1] * O[1] + n[2] * O[2];
    const COPLANAR_NORMAL_TOL = 0.0025;
    const COPLANAR_OFFSET_TOL = 5.0;
    for (const casterEntry of casters) {
      for (const item of casterEntry.items) {
        // Coplanar caster skip.
        if (item.planeN) {
          const cn = item.planeN;
          const dot = cn[0] * n[0] + cn[1] * n[1] + cn[2] * n[2];
          if (Math.abs(dot) > 1 - COPLANAR_NORMAL_TOL) {
            const sign = dot > 0 ? 1 : -1;
            if (Math.abs(item.planeOffset - sign * receiverPlaneOffset) < COPLANAR_OFFSET_TOL) {
              continue;
            }
          }
        }
        // 8-projection bbox prefilter, also confirms ≥ 1 corner ABOVE plane.
        const corners = item.bboxCorners;
        let anyAbove = false;
        let pMinU = Infinity, pMinV = Infinity, pMaxU = -Infinity, pMaxV = -Infinity;
        for (let ci = 0; ci < 8; ci++) {
          const c = corners[ci]!;
          if (planeDist(c) > SELF_SHADOW_EPS) anyAbove = true;
          const pr = projectOntoPlane(c);
          if (pr[0] < pMinU) pMinU = pr[0];
          if (pr[0] > pMaxU) pMaxU = pr[0];
          if (pr[1] < pMinV) pMinV = pr[1];
          if (pr[1] > pMaxV) pMaxV = pr[1];
        }
        if (!anyAbove) continue;
        if (pMaxU < fMinU || pMinU > fMaxU || pMaxV < fMinV || pMinV > fMaxV) continue;
        const wv = item.wv;
        // Fan-triangulate.
        for (let triIdx = 1; triIdx < wv.length - 1; triIdx++) {
          const tA = wv[0]!, tB = wv[triIdx]!, tC = wv[triIdx + 1]!;
          const dA = planeDist(tA), dB = planeDist(tB), dC = planeDist(tC);
          const above: Vec3[] = [];
          const cycle: Array<[Vec3, number]> = [[tA, dA], [tB, dB], [tC, dC]];
          for (let k = 0; k < 3; k++) {
            const [p, dp] = cycle[k]!;
            const [q, dq] = cycle[(k + 1) % 3]!;
            const pAbove = dp > SELF_SHADOW_EPS;
            const qAbove = dq > SELF_SHADOW_EPS;
            if (pAbove) above.push(p);
            if (pAbove !== qAbove) above.push(planeCross(p, q, dp, dq));
          }
          if (above.length < 3) continue;
          const projected = above.map(projectOntoPlane);
          const subjectCcw = ensureCcw2D(projected);
          const clip = clipPolygonToConvex2D(subjectCcw, outlineUv);
          if (clip.length < 3) continue;
          // Drop sub-shadows whose centroid lands inside the convex hull
          // but OUTSIDE the actual polygon union (concave bridging regions
          // of L-shaped face groups). PIP test against member polys.
          let ccx = 0, ccy = 0;
          for (const pt of clip) { ccx += pt[0]; ccy += pt[1]; }
          ccx /= clip.length; ccy /= clip.length;
          let insideUnion = false;
          for (const memberPoly of group.memberPolysUv) {
            let inside = false;
            for (let mi = 0, mj = memberPoly.length - 1; mi < memberPoly.length; mj = mi++) {
              const xi = memberPoly[mi]![0], yi = memberPoly[mi]![1];
              const xj = memberPoly[mj]![0], yj = memberPoly[mj]![1];
              const intersects = ((yi > ccy) !== (yj > ccy)) &&
                (ccx < ((xj - xi) * (ccy - yi)) / (yj - yi || 1e-12) + xi);
              if (intersects) inside = !inside;
            }
            if (inside) { insideUnion = true; break; }
          }
          if (!insideUnion) continue;
          let bucket = clippedByCaster.get(casterEntry.id);
          if (!bucket) {
            bucket = { id: casterEntry.id, verts: [], subPolygonIndices: [] };
            clippedByCaster.set(casterEntry.id, bucket);
          }
          bucket.verts.push(clip);
          bucket.subPolygonIndices.push(item.polygonIndex);
          totalClipped++;
        }
      }
    }

    if (totalClipped === 0 || !(width > 0) || !(height > 0)) continue;

    // Per-group opacity for textured receivers. Three.js darkens linearly:
    // shadow_linear = lit_linear × ambient/(direct + ambient). CSS opacity
    // blends in sRGB, so apply a gamma-2.4 approximation to match.
    let effOp = opacity;
    if (receiverHasTexture) {
      const direct = dirIntensity * Math.max(0, Ldotn);
      const total = direct + Math.max(0, ambIntensity);
      if (total > 0) {
        const ratioLinear = Math.max(0, ambIntensity) / total;
        const ratioSrgb = Math.pow(ratioLinear, 1 / 2.4);
        effOp = opacity * (1 - ratioSrgb);
      } else {
        effOp = 0;
      }
    }

    // Per-face shadow tint. Each receiver face uses ITS OWN polygon color
    // for the ambient-only fill (one material per coplanar group).
    const groupPolyIdx = group.memberPolyIndices[0] ?? 0;
    const groupColor = receiverPolygons[groupPolyIdx]?.color ?? "#cccccc";
    const fillColor = receiverHasTexture
      ? userShadowColor
      : shadePolygon(groupColor, 0, "#000000", ambColor, ambIntensity);

    const paths: Array<ReceiverShadowPath<T>> = [];
    for (const entry of clippedByCaster.values()) {
      let d = "";
      for (const verts of entry.verts) {
        d += `M${(verts[0]![0] - minU).toFixed(1)},${(verts[0]![1] - minV).toFixed(1)}`;
        for (let j = 1; j < verts.length; j++) {
          d += `L${(verts[j]![0] - minU).toFixed(1)},${(verts[j]![1] - minV).toFixed(1)}`;
        }
        d += "Z";
      }
      paths.push({ casterId: entry.id, d, casterPolygonIndices: entry.subPolygonIndices });
    }

    out.push({
      faceIndex: group.faceIndex,
      memberPolyIndices: group.memberPolyIndices,
      matrixCss, width, height,
      fill: fillColor,
      opacity: effOp,
      paths,
    });
  }

  return out;
}

/** Re-export caster scale helper for caller convenience. */
export { meshScaleVec3 };
