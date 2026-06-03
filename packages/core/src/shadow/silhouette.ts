/**
 * Caster-mesh silhouette extraction for the receiver-shadow path.
 *
 * Given a closed (or near-closed) caster mesh and a directional light,
 * computes the silhouette LOOPS — the closed cycles of edges where
 * adjacent polygons disagree on whether they face the light. For a
 * closed manifold convex mesh that's one loop; for concave or
 * higher-genus meshes it may be several.
 *
 * The receiver-shadow algorithm normally projects every caster
 * polygon's outline independently, which collapses to a silhouette at
 * paint time via SVG fill-rule:nonzero. That makes the browser do the
 * union work AFTER we've already paid the DOM cost for hundreds or
 * thousands of triangle sub-paths. Extracting the silhouette here lets
 * us emit ONE outline per mesh per receiver, dropping path-d size by
 * 100× on heavy meshes like the teapot. See H9 in
 * `bench/notes/SHADOW_PERF_LOG.md` and `bench/notes/H9_SILHOUETTE_DESIGN.md`.
 *
 * Pure data; no DOM access. Used by `computeReceiverShadowFaces` once
 * H9 lands.
 */
import type { Polygon, Vec3 } from "../types";

/** Per-edge ownership record. `polyB === null` for boundary edges (open
 *  meshes). Vertex coords are the canonical "from" vertices of the edge —
 *  silhouette walking uses them to reconstruct loop geometry. */
export interface EdgeOwners {
  polyA: number;
  polyB: number | null;
  vertA: Vec3;
  vertB: Vec3;
}

/**
 * Build a map from canonical edge key → owning polygon(s). Mirrors the
 * vertex-quantization used by `buildSharedEdgeMap` so we agree on what
 * "same edge" means.
 *
 * Edge keys are orientation-independent (vertex-pair sorted by string),
 * so two polygons sharing an edge will report the same key. Polygons
 * are listed in encounter order; for manifold meshes each edge has
 * exactly 2 owners. Non-manifold edges (3+ owners) get truncated to
 * `polyB = null` so the caller treats them as boundaries — safer than
 * picking an arbitrary "second" polygon.
 */
export function buildEdgeOwners(polygons: readonly Polygon[]): Map<string, EdgeOwners> {
  const EDGE_MATCH_PRECISION = 1e-4;
  const quant = (n: number): string => Math.round(n / EDGE_MATCH_PRECISION).toString(36);
  const vertKey = (v: Vec3): string => `${quant(v[0])},${quant(v[1])},${quant(v[2])}`;
  const edgeKey = (a: Vec3, b: Vec3): string => {
    const ka = vertKey(a);
    const kb = vertKey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };

  type Accum = { polyA: number; polyB: number | null; vertA: Vec3; vertB: Vec3; degree: number };
  const accum = new Map<string, Accum>();

  for (let i = 0; i < polygons.length; i++) {
    const poly = polygons[i];
    if (!poly || poly.vertices.length < 2) continue;
    const verts = poly.vertices;
    for (let j = 0; j < verts.length; j++) {
      const a = verts[j]!;
      const b = verts[(j + 1) % verts.length]!;
      const k = edgeKey(a, b);
      const existing = accum.get(k);
      if (!existing) {
        accum.set(k, { polyA: i, polyB: null, vertA: a, vertB: b, degree: 1 });
      } else {
        existing.degree += 1;
        // Only record the second owner — third+ make this a non-manifold
        // edge and we drop it to boundary (polyB stays null on overflow).
        if (existing.degree === 2) existing.polyB = i;
        else existing.polyB = null;
      }
    }
  }

  const out = new Map<string, EdgeOwners>();
  for (const [k, v] of accum) {
    out.set(k, { polyA: v.polyA, polyB: v.polyB, vertA: v.vertA, vertB: v.vertB });
  }
  return out;
}

/** Classify each polygon as facing the light. Convention: `n · L < 0`
 *  means the polygon's outward face is toward the light source (light
 *  TRAVELS in direction L, polygons are CCW-from-outside). Matches the
 *  light-backface cull's sign convention. */
export function classifyFacing(
  planeNormals: Array<Vec3 | null>,
  lightDir: Vec3,
): boolean[] {
  const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / lLen;
  const ly = lightDir[1] / lLen;
  const lz = lightDir[2] / lLen;
  return planeNormals.map((n) => {
    if (!n) return true;
    const dot = n[0] * lx + n[1] * ly + n[2] * lz;
    return dot < -1e-6;
  });
}

/**
 * Walk silhouette edges into closed loops. An edge is silhouette iff
 * its two adjacent polygons disagree on `facing`. Boundary edges
 * (polyB === null) are silhouette iff their owner is front-facing —
 * the boundary is where the lit side ends.
 *
 * Returns one closed loop per connected silhouette cycle, each as a
 * Vec3[] sequence (last vertex equals first vertex implicitly; not
 * duplicated). For non-manifold or open meshes some edges may not form
 * a clean cycle; those edges are dropped and the remaining cycles are
 * returned best-effort.
 */
export function extractSilhouetteLoops(
  edgeOwners: ReadonlyMap<string, EdgeOwners>,
  facing: boolean[],
): Vec3[][] {
  // Collect silhouette edges.
  const silEdges: Array<[Vec3, Vec3]> = [];
  for (const e of edgeOwners.values()) {
    const fA = facing[e.polyA] ?? false;
    if (e.polyB === null) {
      if (fA) silEdges.push([e.vertA, e.vertB]);
    } else {
      const fB = facing[e.polyB] ?? false;
      if (fA !== fB) silEdges.push([e.vertA, e.vertB]);
    }
  }
  if (silEdges.length === 0) return [];

  // Index edges by vertex key for fast next-edge lookup during walk.
  const EDGE_MATCH_PRECISION = 1e-4;
  const quant = (n: number): string => Math.round(n / EDGE_MATCH_PRECISION).toString(36);
  const vKey = (v: Vec3): string => `${quant(v[0])},${quant(v[1])},${quant(v[2])}`;

  type EdgeNode = { a: Vec3; b: Vec3; aKey: string; bKey: string; used: boolean };
  const nodes: EdgeNode[] = silEdges.map(([a, b]) => ({ a, b, aKey: vKey(a), bKey: vKey(b), used: false }));
  const byVertex = new Map<string, EdgeNode[]>();
  for (const n of nodes) {
    let aList = byVertex.get(n.aKey);
    if (!aList) { aList = []; byVertex.set(n.aKey, aList); }
    aList.push(n);
    let bList = byVertex.get(n.bKey);
    if (!bList) { bList = []; byVertex.set(n.bKey, bList); }
    bList.push(n);
  }

  const loops: Vec3[][] = [];
  for (const start of nodes) {
    if (start.used) continue;
    const loop: Vec3[] = [start.a];
    let current = start;
    let lastKey = start.aKey;
    let nextKey = start.bKey;
    current.used = true;
    for (let safety = 0; safety < nodes.length + 1; safety++) {
      loop.push(current.bKey === nextKey ? current.b : current.a);
      // Find the next unused edge attached to `nextKey` that isn't current.
      const incident = byVertex.get(nextKey) ?? [];
      let next: EdgeNode | null = null;
      for (const cand of incident) {
        if (cand === current || cand.used) continue;
        next = cand;
        break;
      }
      if (!next) break;
      next.used = true;
      lastKey = nextKey;
      nextKey = next.aKey === lastKey ? next.bKey : next.aKey;
      current = next;
      if (nextKey === start.aKey) break; // closed
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
