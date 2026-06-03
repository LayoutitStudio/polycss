/**
 * OBB-proxy receiver planes for self-shadow heavy meshes.
 *
 * For high-poly self-shadow meshes (teapot, sphere, GLB imports) the
 * per-coplanar-face receiver decomposition produces 100-250 SVG
 * receivers per frame. Each receiver gets its own silhouette projection
 * + SH-clip even though most of them are near-parallel slices of one
 * smooth surface. The compositor then layers all of them — every receiver
 * SVG is a paint cost.
 *
 * The proxy path replaces the per-face decomposition with ~6 axis-aligned
 * bounding-box (OBB) faces. Each proxy plane gets ONE silhouette
 * projection clipped to the union of polygons that belong to it. The
 * silhouette projects onto an averaged plane → some pixel-space drift
 * (typically 3-5 px on a teapot at default zoom) but the shadow stays
 * attached to the real mesh via per-proxy member-poly clipping.
 *
 * See H11b in `bench/notes/SHADOW_PERF_LOG.md` and
 * `bench/notes/H11B_OBB_PROXY_DESIGN.md`.
 */
import { BASE_TILE } from "../camera/camera";
import { rotateVec3InWrapperCssFrame } from "../math/rotation";
import { convexHull2D, ensureCcw2D } from "./projection";
import {
  worldCssForMesh,
  worldPositionToCss,
} from "./receiverFaceGroups";
import type { Polygon, Vec3 } from "../types";

/** Minimum polygon count before the proxy path activates. Below this
 *  the per-face path is cheaper than building OBB proxies + per-poly
 *  clipping. */
export const PROXY_MIN_POLYS = 60;

/**
 * One OBB-face proxy plane on a receiver mesh. Same shape as
 * `ReceiverFacePlane` so it slots directly into
 * `computeReceiverShadowFaces` — same SH-clip + member-poly clip path,
 * just sourced from one of 6 AABB faces instead of a coplanar group.
 */
export interface ProxyReceiverPlane {
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
  lift: number;
}

/** Six AABB axis-aligned faces in CSS world space. Indices match the
 *  AABB face index passed back as `faceIndex` on each proxy plane. */
const PROXY_AXIS_FACES: Array<{
  n: Vec3;
  u: Vec3;
  v: Vec3;
  label: string;
}> = [
  // +X face — outward normal +x, u = +y, v = +z (right-handed)
  { n: [+1, 0, 0], u: [0, +1, 0], v: [0, 0, +1], label: "+x" },
  // -X face
  { n: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, +1], label: "-x" },
  // +Y face
  { n: [0, +1, 0], u: [-1, 0, 0], v: [0, 0, +1], label: "+y" },
  // -Y face
  { n: [0, -1, 0], u: [+1, 0, 0], v: [0, 0, +1], label: "-y" },
  // +Z face (top)
  { n: [0, 0, +1], u: [+1, 0, 0], v: [0, +1, 0], label: "+z" },
  // -Z face (bottom)
  { n: [0, 0, -1], u: [+1, 0, 0], v: [0, -1, 0], label: "-z" },
];

/**
 * Build OBB proxy planes for a receiver mesh. Returns up to 6 axis-
 * aligned face planes (one per visible AABB face direction) — proxies
 * with no member polygons get dropped. Pure: same inputs → same output.
 *
 * Each polygon is assigned to ONE proxy: the AABB face whose normal is
 * closest to the polygon's outward normal (max dot product). This keeps
 * the proxy face's projected silhouette clipped only to mesh surface
 * regions that actually face the same direction.
 *
 * `shadowLift` is applied along the proxy's outward normal so the
 * shadow SVG composites above the AABB face without z-fighting (same
 * semantic as `prepareReceiverFacePlanes` and the ground path).
 */
export function prepareProxyReceiverPlanes(
  polygons: readonly Polygon[],
  position: Vec3,
  scale: number | Vec3 | undefined | null,
  dedupDrop: ReadonlySet<number>,
  shadowLift: number,
  rotation?: Vec3 | null,
): ProxyReceiverPlane[] {
  // World-CSS transform identical to prepareReceiverFacePlanes so proxy
  // planes share the receiver's frame.
  const baseWorldCss = worldCssForMesh(scale);
  const hasRotation = !!rotation && (rotation[0] !== 0 || rotation[1] !== 0 || rotation[2] !== 0);
  const cssPivot = hasRotation ? worldPositionToCss(position) : null;
  const worldCss: (vert: Vec3, pos: Vec3) => Vec3 = (hasRotation && cssPivot && rotation)
    ? (vert, pos) => {
        const w = baseWorldCss(vert, pos);
        const local: Vec3 = [w[0] - cssPivot[0], w[1] - cssPivot[1], w[2] - cssPivot[2]];
        const r = rotateVec3InWrapperCssFrame(local, rotation);
        return [r[0] + cssPivot[0], r[1] + cssPivot[1], r[2] + cssPivot[2]];
      }
    : baseWorldCss;

  // Per-polygon: world vertices + outward normal (Newell-style).
  type FaceInfo = {
    polyIndex: number;
    verts: Vec3[];
    normal: Vec3 | null;
  };
  const faces: FaceInfo[] = [];
  let aabbMinX = Infinity, aabbMinY = Infinity, aabbMinZ = Infinity;
  let aabbMaxX = -Infinity, aabbMaxY = -Infinity, aabbMaxZ = -Infinity;
  for (let i = 0; i < polygons.length; i++) {
    if (dedupDrop.has(i)) continue;
    const poly = polygons[i];
    if (!poly || poly.vertices.length < 3) continue;
    const ws: Vec3[] = poly.vertices.map((vert) => worldCss(vert, position));
    const O = ws[0]!;
    let nx = 0, ny = 0, nz = 0;
    for (let k = 1; k + 1 < ws.length; k++) {
      const a = ws[k]!, b = ws[k + 1]!;
      const e1x = a[0] - O[0], e1y = a[1] - O[1], e1z = a[2] - O[2];
      const e2x = b[0] - O[0], e2y = b[1] - O[1], e2z = b[2] - O[2];
      nx += e2y * e1z - e2z * e1y;
      ny += e2z * e1x - e2x * e1z;
      nz += e2x * e1y - e2y * e1x;
    }
    const nLen = Math.hypot(nx, ny, nz);
    const normal: Vec3 | null = nLen > 1e-9 ? [nx / nLen, ny / nLen, nz / nLen] : null;
    for (const w of ws) {
      if (w[0] < aabbMinX) aabbMinX = w[0];
      if (w[0] > aabbMaxX) aabbMaxX = w[0];
      if (w[1] < aabbMinY) aabbMinY = w[1];
      if (w[1] > aabbMaxY) aabbMaxY = w[1];
      if (w[2] < aabbMinZ) aabbMinZ = w[2];
      if (w[2] > aabbMaxZ) aabbMaxZ = w[2];
    }
    faces.push({ polyIndex: i, verts: ws, normal });
  }
  if (faces.length === 0 || !Number.isFinite(aabbMinX)) return [];

  // AABB face center + assigned polygons per proxy.
  const aabbCenter: Vec3 = [
    (aabbMinX + aabbMaxX) * 0.5,
    (aabbMinY + aabbMaxY) * 0.5,
    (aabbMinZ + aabbMaxZ) * 0.5,
  ];
  const halfExtent: Vec3 = [
    (aabbMaxX - aabbMinX) * 0.5,
    (aabbMaxY - aabbMinY) * 0.5,
    (aabbMaxZ - aabbMinZ) * 0.5,
  ];

  type ProxyAccum = {
    faceIndex: number;
    n: Vec3;
    u: Vec3;
    v: Vec3;
    O: Vec3;
    members: FaceInfo[];
  };
  const accums: ProxyAccum[] = PROXY_AXIS_FACES.map((face, faceIndex) => {
    const O: Vec3 = [
      aabbCenter[0] + face.n[0] * halfExtent[0],
      aabbCenter[1] + face.n[1] * halfExtent[1],
      aabbCenter[2] + face.n[2] * halfExtent[2],
    ];
    return { faceIndex, n: face.n, u: face.u, v: face.v, O, members: [] };
  });

  // Assign each polygon to the proxy whose normal best matches.
  // Skips polys whose normal couldn't be computed (degenerate).
  for (const f of faces) {
    if (!f.normal) continue;
    let bestIdx = -1;
    let bestDot = -Infinity;
    for (let pi = 0; pi < accums.length; pi++) {
      const a = accums[pi]!;
      const d = f.normal[0] * a.n[0] + f.normal[1] * a.n[1] + f.normal[2] * a.n[2];
      if (d > bestDot) { bestDot = d; bestIdx = pi; }
    }
    // Reject polygons whose outward normal points AWAY from every proxy
    // (back-facing through every AABB face). Cheap sanity guard.
    if (bestIdx < 0 || bestDot <= 0) continue;
    accums[bestIdx]!.members.push(f);
  }

  const lift = shadowLift * BASE_TILE;
  const out: ProxyReceiverPlane[] = [];
  for (const accum of accums) {
    if (accum.members.length === 0) continue;
    const { O, n, u, v, faceIndex } = accum;
    const allUv: Array<[number, number]> = [];
    const memberPolysUv: Array<Array<[number, number]>> = [];
    const memberPolyIndices: number[] = [];
    for (const m of accum.members) {
      const polyUv: Array<[number, number]> = [];
      for (const w of m.verts) {
        const dx = w[0] - O[0];
        const dy = w[1] - O[1];
        const dz = w[2] - O[2];
        const pt: [number, number] = [
          dx * u[0] + dy * u[1] + dz * u[2],
          dx * v[0] + dy * v[1] + dz * v[2],
        ];
        polyUv.push(pt);
        allUv.push(pt);
      }
      if (polyUv.length >= 3) {
        memberPolysUv.push(ensureCcw2D(polyUv));
        memberPolyIndices.push(m.polyIndex);
      }
    }
    if (memberPolysUv.length === 0) continue;
    const hull = convexHull2D(allUv);
    if (hull.length < 3) continue;
    const outlineUv = ensureCcw2D(hull);
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const pt of outlineUv) {
      if (pt[0] < minU) minU = pt[0];
      if (pt[1] < minV) minV = pt[1];
      if (pt[0] > maxU) maxU = pt[0];
      if (pt[1] > maxV) maxV = pt[1];
    }
    const width = maxU - minU;
    const height = maxV - minV;
    if (!(width > 0) || !(height > 0)) continue;
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
    out.push({
      O, n, u, v, outlineUv, memberPolysUv, memberPolyIndices,
      minU, minV, width, height, matrixCss, faceIndex, lift,
    });
  }
  return out;
}
