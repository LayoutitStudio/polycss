// Shared parametric-shadow override builder.
//
// Given a caster's world-frame polygons + light(s), produces the low-res
// silhouette loops the receiver projector casts. This is the single source of
// truth for the parametric correction terms (flat-caster skip, convex self
// skip, depth-banded self-shadow, vector vs pixel style, per-point-light radial
// silhouettes) so the vanilla, React, and Vue renderers stay identical — each
// just calls this and drops the result onto its `ReceiverCasterInput`.
import type { Vec3 } from "../types";
import { computeCoverageShadowSilhouette } from "./coverageSilhouette";
import { computeParametricShadowSilhouette } from "./parametricSilhouette";

/** True when every caster vertex lies in a single plane (a ground quad, a
 *  billboard, etc.). Such casters have no coverage volume for the parametric
 *  proxy — their tilted proxy would project garbage onto a coplanar receiver —
 *  so the caller routes them through the exact path instead. */
export function isFlatCaster(polysWv: ReadonlyArray<ReadonlyArray<Vec3>>): boolean {
  let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0, ox = 0, oy = 0, oz = 0;
  let haveBasis = false;
  for (const poly of polysWv) {
    if (poly.length >= 3 && !haveBasis) {
      const p0 = poly[0]!, p1 = poly[1]!, p2 = poly[2]!;
      ax = p1[0] - p0[0]; ay = p1[1] - p0[1]; az = p1[2] - p0[2];
      bx = p2[0] - p0[0]; by = p2[1] - p0[1]; bz = p2[2] - p0[2];
      ox = p0[0]; oy = p0[1]; oz = p0[2];
      haveBasis = true;
    }
  }
  if (!haveBasis) return true;
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-9) return true;
  nx /= nl; ny /= nl; nz /= nl;
  let span = 0;
  for (const poly of polysWv) for (const p of poly) {
    span = Math.max(span, Math.abs(p[0] - ox) + Math.abs(p[1] - oy) + Math.abs(p[2] - oz));
  }
  const tol = Math.max(1e-3, span * 1e-3);
  for (const poly of polysWv) for (const p of poly) {
    const d = (p[0] - ox) * nx + (p[1] - oy) * ny + (p[2] - oz) * nz;
    if (Math.abs(d) > tol) return false;
  }
  return true;
}

/** Rubric: a CONVEX caster self-shadows nothing. The depth-band proxy still
 *  leaks a little false self-shadow on convex meshes, so detect convexity and
 *  skip self-shadow for them. Capped at `maxPolys` (O(faces × verts), and large
 *  meshes are essentially never convex — they early-exit on the first concave
 *  face anyway). */
export function isConvexCaster(polysWv: ReadonlyArray<ReadonlyArray<Vec3>>, maxPolys = 300): boolean {
  if (polysWv.length === 0 || polysWv.length > maxPolys) return false;
  let span = 0, ox = 0, oy = 0, oz = 0, seeded = false;
  for (const poly of polysWv) for (const p of poly) {
    if (!seeded) { ox = p[0]; oy = p[1]; oz = p[2]; seeded = true; }
    span = Math.max(span, Math.abs(p[0] - ox) + Math.abs(p[1] - oy) + Math.abs(p[2] - oz));
  }
  const tol = Math.max(1e-3, span * 5e-3);
  for (const face of polysWv) {
    if (face.length < 3) continue;
    const a = face[0]!, b = face[1]!, c = face[2]!;
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-9) continue;
    nx /= nl; ny /= nl; nz /= nl;
    let pos = false, neg = false;
    for (const poly of polysWv) for (const p of poly) {
      const d = (p[0] - a[0]) * nx + (p[1] - a[1]) * ny + (p[2] - a[2]) * nz;
      if (d > tol) pos = true; else if (d < -tol) neg = true;
      if (pos && neg) return false;
    }
  }
  return true;
}

export interface ParametricOverrideInput {
  /** Caster polygons, each a vertex list in the world-CSS frame. */
  polysWorldVerts: ReadonlyArray<ReadonlyArray<Vec3>>;
  /** Directional light (to-source) in the world-CSS frame. */
  lightDir: Vec3;
  /** Effective definition (caller folds in per-mesh override + drag cap). */
  definition: number;
  /** True when the caster is also the receiver (self-shadow). */
  isSelf: boolean;
  /** `"pixel"` greedy-meshes the coverage into voxel rects; default contour. */
  style?: "vector" | "pixel";
  /** Shadow-casting point lights (CSS position + index in `allPointLights`). */
  pointLights?: ReadonlyArray<{ position: Vec3; index: number }>;
}

export interface ParametricOverrideResult {
  /** Directional override loops, or undefined to use the exact path. */
  overrideSilhouette?: Vec3[][];
  /** Per-point-light radial override loops (indexed by point light index). */
  overridePointSilhouettes?: Array<Vec3[][] | undefined>;
}

/** Build the parametric override(s) for one caster — directional plus one
 *  radial silhouette per shadow-casting point light. Returns empty overrides
 *  (use the exact path) for flat casters and convex self-shadow. */
export function buildParametricCasterOverride(input: ParametricOverrideInput): ParametricOverrideResult {
  const { polysWorldVerts, lightDir, definition, isSelf, style, pointLights } = input;
  const flat = isFlatCaster(polysWorldVerts);
  const convexSelfSkip = isSelf && isConvexCaster(polysWorldVerts);
  if (flat || convexSelfSkip) return {};
  const layers = isSelf ? Math.max(2, Math.min(6, Math.round(definition / 8))) : 1;
  const mode = style === "pixel" ? "pixel" : "contour";
  const buildOverride = (dir: Vec3): Vec3[][] | undefined => {
    const loops = computeCoverageShadowSilhouette(polysWorldVerts, dir, definition, layers, mode);
    if (loops && loops.length) return loops;
    if (!isSelf) {
      const allWv: Vec3[] = [];
      for (const poly of polysWorldVerts) for (const w of poly) allWv.push(w as Vec3);
      const loop = computeParametricShadowSilhouette(allWv, dir, definition);
      if (loop && loop.length >= 3) return [loop];
    }
    return undefined;
  };
  const overrideSilhouette = buildOverride(lightDir);
  let overridePointSilhouettes: Array<Vec3[][] | undefined> | undefined;
  if (pointLights && pointLights.length > 0) {
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (const poly of polysWorldVerts) for (const w of poly) { cx += w[0]; cy += w[1]; cz += w[2]; n++; }
    if (n > 0) { cx /= n; cy /= n; cz /= n; }
    overridePointSilhouettes = [];
    for (const pl of pointLights) {
      const dir: Vec3 = [pl.position[0] - cx, pl.position[1] - cy, pl.position[2] - cz];
      overridePointSilhouettes[pl.index] = buildOverride(dir);
    }
  }
  return { overrideSilhouette, overridePointSilhouettes };
}
