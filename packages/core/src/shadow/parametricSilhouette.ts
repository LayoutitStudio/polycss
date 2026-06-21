// Parametric cast-shadow silhouette.
//
// The cast shadow of an object on ANY receiver plane is the projection of the
// object's silhouette (its outline as seen from the light) along the light
// direction. Instead of re-projecting every caster polygon, this builds a
// single low-resolution silhouette loop as a function of the light direction —
// `Shadow(lightDir, definition)` — which the receiver-shadow projector then
// casts onto every receiver face (clip + colored-merge unchanged).
//
// `definition` is the quality knob: the maximum number of points in the loop.
// Low → a blobby approximation (lightweight DOM, cheap projection); high →
// converges to the caster's exact convex outline. Concave detail beyond the
// convex hull is intentionally not represented (that's the "approximate but
// light" trade — a future definition tier could add it).
import type { Vec3 } from "../types";

/** Unit vector; falls back to +Z for a zero input. */
function unit(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** 2D convex hull (Andrew's monotone chain) returning INDICES into `pts`, CCW. */
function convexHullIndices(pts: ReadonlyArray<readonly [number, number]>): number[] {
  const n = pts.length;
  if (n < 3) return pts.map((_, i) => i);
  const idx = pts.map((_, i) => i).sort((a, b) =>
    pts[a]![0] - pts[b]![0] || pts[a]![1] - pts[b]![1]);
  const cross = (o: number, a: number, b: number): number =>
    (pts[a]![0] - pts[o]![0]) * (pts[b]![1] - pts[o]![1]) -
    (pts[a]![1] - pts[o]![1]) * (pts[b]![0] - pts[o]![0]);
  const lower: number[] = [];
  for (const i of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, i) <= 0) upper.pop();
    upper.push(i);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Build the parametric silhouette loop for a caster lit by a directional light.
 *
 * @param worldVerts  Every caster vertex in the same world-CSS frame the
 *                    receiver projector works in (e.g. `CasterPolyItem.wv`).
 * @param lightDir    Directional light vector (to-source) in that frame.
 * @param definition  Max loop points. The convex hull is decimated down to this
 *                    by repeatedly dropping the lowest-area vertex (shape-
 *                    preserving). `<= 2` is treated as 3.
 * @returns A closed 3D loop (the silhouette vertices), or `null` if degenerate.
 */
export function computeParametricShadowSilhouette(
  worldVerts: ReadonlyArray<Vec3>,
  lightDir: Vec3,
  definition: number,
): Vec3[] | null {
  if (worldVerts.length < 3) return null;
  const L = unit(lightDir);
  // Orthonormal basis (e1, e2) spanning the plane perpendicular to L.
  const seed: Vec3 = Math.abs(L[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = seed[0] * L[0] + seed[1] * L[1] + seed[2] * L[2];
  const e1 = unit([seed[0] - d * L[0], seed[1] - d * L[1], seed[2] - d * L[2]]);
  const e2: Vec3 = [
    L[1] * e1[2] - L[2] * e1[1],
    L[2] * e1[0] - L[0] * e1[2],
    L[0] * e1[1] - L[1] * e1[0],
  ];
  // Project to the light-perpendicular plane (keeps the 3D index association).
  const proj: Array<[number, number]> = worldVerts.map((v) => [
    v[0] * e1[0] + v[1] * e1[1] + v[2] * e1[2],
    v[0] * e2[0] + v[1] * e2[1] + v[2] * e2[2],
  ]);
  let hull = convexHullIndices(proj);
  if (hull.length < 3) return null;

  // Decimate to `definition` points, dropping the vertex whose removal changes
  // the loop area least (Visvalingam-style) so the silhouette shape is kept.
  const target = Math.max(3, Math.floor(definition));
  if (hull.length > target) {
    const tri = (a: number, b: number, c: number): number => {
      const ax = proj[a]![0], ay = proj[a]![1];
      return Math.abs((proj[b]![0] - ax) * (proj[c]![1] - ay) - (proj[c]![0] - ax) * (proj[b]![1] - ay)) * 0.5;
    };
    while (hull.length > target) {
      let minA = Infinity, minI = 0;
      for (let i = 0; i < hull.length; i++) {
        const a = tri(hull[(i - 1 + hull.length) % hull.length]!, hull[i]!, hull[(i + 1) % hull.length]!);
        if (a < minA) { minA = a; minI = i; }
      }
      hull.splice(minI, 1);
    }
  }
  return hull.map((i) => [worldVerts[i]![0], worldVerts[i]![1], worldVerts[i]![2]] as Vec3);
}
