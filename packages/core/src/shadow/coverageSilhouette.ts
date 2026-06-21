// Coverage-contour cast-shadow silhouette ("definition tier 2").
//
// The convex-hull silhouette (parametricSilhouette.ts) can't represent
// concavity — a castle's towers/gaps collapse to a blob no matter how many
// points. The cast shadow on a plane is actually the 2D COVERAGE of every
// projected face (depth is irrelevant for a plane: any occluder shadows the
// point). So here we rasterize that coverage from the light's POV into a small
// mask, trace its contour with marching squares, simplify to `definition`, and
// lift the loops back to 3D for the normal receiver projector.
//
// DEPTH LAYERS. A single flat outline carries no depth, so it works for a floor
// (every blocker is in front) but over-darkens SELF-shadow: projecting one
// outline onto the caster's own interior faces shadows faces that are actually
// in front of the geometry. Passing `layers > 1` slices the caster into depth
// bands along the light and emits one coverage contour per band, each placed at
// its band's depth. The receiver projector's per-face half-space clip then keeps
// only the bands in front of each face — so a face is shadowed exactly by the
// geometry between it and the light. Cross-mesh casting uses `layers = 1` (one
// band, cheapest, identical result); self-shadow uses N bands scaled by detail.
//
// `definition` drives the mask resolution: low → blobby, high → the real
// concave outline (towers, gaps, courtyards). Robust on any mesh — no manifold
// or polygon-boolean requirement.
import type { Vec3 } from "../types";

function unit(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

// Marching-squares segment table: case (c0|c1<<1|c2<<2|c3<<3) → flat list of
// edge pairs. Edges: 0=bottom, 1=right, 2=top, 3=left.
const MS: number[][] = [
  [], [3, 0], [0, 1], [3, 1], [1, 2], [3, 0, 1, 2], [0, 2], [3, 2],
  [2, 3], [2, 0], [0, 1, 2, 3], [2, 1], [1, 3], [1, 0], [0, 3], [],
];

/** Douglas–Peucker simplify a closed loop (grid coords) to `tol`. */
function simplifyClosed(loop: Array<[number, number]>, tol: number): Array<[number, number]> {
  if (loop.length < 4) return loop;
  // Split the closed loop at the two farthest-apart points, simplify each half.
  let i1 = 1, far = -1;
  for (let i = 0; i < loop.length; i++) {
    const dx = loop[i]![0] - loop[0]![0], dy = loop[i]![1] - loop[0]![1];
    const d = dx * dx + dy * dy;
    if (d > far) { far = d; i1 = i; }
  }
  const dp = (pts: Array<[number, number]>): Array<[number, number]> => {
    if (pts.length < 3) return pts;
    const a = pts[0]!, b = pts[pts.length - 1]!;
    let idx = -1, max = tol;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((pts[i]![0] - a[0]) * dy - (pts[i]![1] - a[1]) * dx) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (idx < 0) return [a, b];
    return [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))];
  };
  const half1 = loop.slice(0, i1 + 1);
  const half2 = [...loop.slice(i1), loop[0]!];
  const s1 = dp(half1), s2 = dp(half2);
  const out = [...s1.slice(0, -1), ...s2.slice(0, -1)];
  return out.length >= 3 ? out : loop;
}

/** Ray-cast point-in-polygon (loop in grid coords). Used to count nesting
 *  depth so contour holes get the opposite winding to their container. */
function pointInLoop(x: number, y: number, loop: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const xi = loop[i]![0], yi = loop[i]![1], xj = loop[j]![0], yj = loop[j]![1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

interface Poly2D {
  pts: Array<[number, number]>;
  depth: number; // centroid depth along L
}

/**
 * Build concave coverage-contour silhouette loops for a caster lit by a
 * directional light.
 *
 * @param polysWorldVerts  Each caster polygon's vertices in the world-CSS frame
 *                         (e.g. `CasterPolyItem.wv`).
 * @param lightDir         Directional light vector (to-source) in that frame.
 * @param definition       Detail knob → coverage mask resolution.
 * @param layers           Depth bands along the light. 1 (default) = one flat
 *                         outline (cross-mesh casting). >1 = depth-stratified
 *                         outlines for correct self-shadow.
 * @returns Closed 3D loops, or `null`.
 */
export function computeCoverageShadowSilhouette(
  polysWorldVerts: ReadonlyArray<ReadonlyArray<Vec3>>,
  lightDir: Vec3,
  definition: number,
  layers = 1,
  mode: "contour" | "pixel" = "contour",
): Vec3[][] | null {
  const L = unit(lightDir);
  const seed: Vec3 = Math.abs(L[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const sd = seed[0] * L[0] + seed[1] * L[1] + seed[2] * L[2];
  const e1 = unit([seed[0] - sd * L[0], seed[1] - sd * L[1], seed[2] - sd * L[2]]);
  const e2: Vec3 = [
    L[1] * e1[2] - L[2] * e1[1],
    L[2] * e1[0] - L[0] * e1[2],
    L[0] * e1[1] - L[1] * e1[0],
  ];
  // Project every vertex to the light-perpendicular plane; track bbox and each
  // polygon's centroid depth (its position along L) for depth banding.
  let minA = Infinity, minB = Infinity, maxA = -Infinity, maxB = -Infinity;
  let tMin = Infinity, tMax = -Infinity;
  const polys: Poly2D[] = [];
  for (const poly of polysWorldVerts) {
    if (poly.length < 3) continue;
    const pts: Array<[number, number]> = [];
    let dSum = 0;
    for (const v of poly) {
      const a = v[0] * e1[0] + v[1] * e1[1] + v[2] * e1[2];
      const b = v[0] * e2[0] + v[1] * e2[1] + v[2] * e2[2];
      const t = v[0] * L[0] + v[1] * L[1] + v[2] * L[2];
      pts.push([a, b]);
      dSum += t;
      if (a < minA) minA = a; if (a > maxA) maxA = a;
      if (b < minB) minB = b; if (b > maxB) maxB = b;
      if (t < tMin) tMin = t; if (t > tMax) tMax = t;
    }
    polys.push({ pts, depth: dSum / poly.length });
  }
  if (!Number.isFinite(minA) || polys.length === 0) return null;
  const spanA = maxA - minA, spanB = maxB - minB;
  const maxSpan = Math.max(spanA, spanB);
  if (maxSpan < 1e-6) return null;

  // Mask resolution scales with definition; 1-cell empty padding so the
  // contour closes inside the grid. One shared grid sizing for every band.
  // Contour traces at 2× definition for smooth outlines; pixel mode uses
  // `definition` directly as the cell-grid resolution so it reads as chunky.
  const res = Math.max(mode === "pixel" ? 3 : 8, Math.min(384, Math.round(definition * (mode === "pixel" ? 1 : 2))));
  const cell = maxSpan / res;
  const pad = 1;
  const oA = minA - pad * cell, oB = minB - pad * cell;
  const M = Math.ceil(spanA / cell) + 2 * pad + 1;
  const K = Math.ceil(spanB / cell) + 2 * pad + 1;
  if (M * K > 400_000) return null; // safety
  const tol = 0.6; // grid cells

  const traceBand = (subset: Poly2D[], depth: number, out: Vec3[][]): void => {
    const mask = new Uint8Array(M * K);
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= M || j >= K ? 0 : mask[j * M + i]!);
    // Rasterize coverage: fan-triangulate each polygon, fill cells whose center
    // is inside (bbox-bounded point-in-triangle).
    const d = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
      (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    for (const poly of subset) {
      const p = poly.pts;
      for (let t = 1; t < p.length - 1; t++) {
        const A = p[0]!, B = p[t]!, C = p[t + 1]!;
        let lo = Math.floor((Math.min(A[0], B[0], C[0]) - oA) / cell);
        let hi = Math.ceil((Math.max(A[0], B[0], C[0]) - oA) / cell);
        let lj = Math.floor((Math.min(A[1], B[1], C[1]) - oB) / cell);
        let hj = Math.ceil((Math.max(A[1], B[1], C[1]) - oB) / cell);
        if (lo < 0) lo = 0; if (hi > M - 1) hi = M - 1;
        if (lj < 0) lj = 0; if (hj > K - 1) hj = K - 1;
        if (Math.abs(d(A[0], A[1], B[0], B[1], C[0], C[1])) < 1e-12) continue;
        for (let j = lj; j <= hj; j++) {
          const py = oB + (j + 0.5) * cell;
          for (let i = lo; i <= hi; i++) {
            if (mask[j * M + i]) continue;
            const px = oA + (i + 0.5) * cell;
            const w0 = d(B[0], B[1], C[0], C[1], px, py);
            const w1 = d(C[0], C[1], A[0], A[1], px, py);
            const w2 = d(A[0], A[1], B[0], B[1], px, py);
            if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) {
              mask[j * M + i] = 1;
            }
          }
        }
      }
    }

    if (mode === "pixel") {
      // Greedy-mesh the filled cells into axis-aligned rects (voxel-style) and
      // emit one rect loop each. Holes are simply absent cells — no winding or
      // fill-rule subtraction needed. Run-length + vertical-extend keeps the
      // rect count low (the same merge the .vox path uses). The blocky look IS
      // the effect; `definition` is the grid resolution (lower → chunkier).
      const used = new Uint8Array(M * K);
      const lift = (gi: number, gj: number): Vec3 => {
        const a = oA + gi * cell, b = oB + gj * cell;
        return [
          a * e1[0] + b * e2[0] + depth * L[0],
          a * e1[1] + b * e2[1] + depth * L[1],
          a * e1[2] + b * e2[2] + depth * L[2],
        ];
      };
      for (let j = 0; j < K; j++) {
        for (let i = 0; i < M; i++) {
          if (!mask[j * M + i] || used[j * M + i]) continue;
          let w = 1;
          while (i + w < M && mask[j * M + i + w] && !used[j * M + i + w]) w++;
          let h = 1;
          outer: while (j + h < K) {
            for (let k = 0; k < w; k++) {
              if (!mask[(j + h) * M + i + k] || used[(j + h) * M + i + k]) break outer;
            }
            h++;
          }
          for (let jj = j; jj < j + h; jj++) for (let ii = i; ii < i + w; ii++) used[jj * M + ii] = 1;
          out.push([lift(i, j), lift(i + w, j), lift(i + w, j + h), lift(i, j + h)]);
        }
      }
      return;
    }

    // Marching squares → undirected segments between edge midpoints.
    const key = (x: number, y: number) => `${Math.round(x * 2)},${Math.round(y * 2)}`;
    const adj = new Map<string, Array<[number, number]>>();
    const ptOf = new Map<string, [number, number]>();
    const emid = (e: number, i: number, j: number): [number, number] =>
      e === 0 ? [i + 0.5, j] : e === 1 ? [i + 1, j + 0.5] : e === 2 ? [i + 0.5, j + 1] : [i, j + 0.5];
    const addSeg = (a: [number, number], b: [number, number]) => {
      const ka = key(a[0], a[1]), kb = key(b[0], b[1]);
      if (ka === kb) return;
      if (!adj.has(ka)) adj.set(ka, []);
      if (!adj.has(kb)) adj.set(kb, []);
      adj.get(ka)!.push(b); adj.get(kb)!.push(a);
      ptOf.set(ka, a); ptOf.set(kb, b);
    };
    for (let j = 0; j < K - 1; j++) {
      for (let i = 0; i < M - 1; i++) {
        const c = at(i, j) | (at(i + 1, j) << 1) | (at(i + 1, j + 1) << 2) | (at(i, j + 1) << 3);
        const segs = MS[c]!;
        for (let s = 0; s < segs.length; s += 2) {
          addSeg(emid(segs[s]!, i, j), emid(segs[s + 1]!, i, j));
        }
      }
    }
    if (adj.size === 0) return;

    // Stitch segments into closed loops.
    const used = new Set<string>();
    const simpLoops: Array<Array<[number, number]>> = [];
    for (const start of adj.keys()) {
      if (used.has(start)) continue;
      const loop: Array<[number, number]> = [];
      let cur = start, prev = "", guard = 0;
      while (cur && !used.has(cur) && guard++ < 1e6) {
        used.add(cur);
        loop.push(ptOf.get(cur)!);
        const nbrs = adj.get(cur) ?? [];
        let next = "";
        for (const n of nbrs) { const k = key(n[0], n[1]); if (k !== prev && !used.has(k)) { next = k; break; } }
        if (!next) { for (const n of nbrs) { const k = key(n[0], n[1]); if (k !== prev) { next = k; break; } } }
        prev = cur; cur = next;
        if (cur === start) break;
      }
      if (loop.length < 3) continue;
      const simp = simplifyClosed(loop, tol);
      if (simp.length >= 3) simpLoops.push(simp);
    }

    // Orient by nesting so holes subtract under the receiver's nonzero fill:
    // a loop nested in an EVEN number of others is an outer boundary (CCW); an
    // ODD nesting is a hole (CW). Marching squares can emit either winding, so
    // set it explicitly here.
    for (const loop of simpLoops) {
      let depthCount = 0;
      const px = loop[0]![0], py = loop[0]![1];
      for (const other of simpLoops) {
        if (other === loop) continue;
        if (pointInLoop(px, py, other)) depthCount++;
      }
      const wantCcw = depthCount % 2 === 0;
      let area = 0;
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i]!, q = loop[(i + 1) % loop.length]!;
        area += p[0] * q[1] - q[0] * p[1];
      }
      const isCcw = area > 0;
      const ordered = isCcw === wantCcw ? loop : [...loop].reverse();
      out.push(ordered.map((g) => {
        const a = oA + g[0] * cell, b = oB + g[1] * cell;
        return [
          a * e1[0] + b * e2[0] + depth * L[0],
          a * e1[1] + b * e2[1] + depth * L[1],
          a * e1[2] + b * e2[2] + depth * L[2],
        ] as Vec3;
      }));
    }
  };

  const out: Vec3[][] = [];
  const nLayers = Math.max(1, Math.floor(layers));
  if (nLayers <= 1 || tMax - tMin < 1e-6) {
    // Cross-mesh: ONE flat proxy outline. Projection onto a receiver is
    // depth-invariant (moving a point along L doesn't change where it lands),
    // BUT the receiver projector clips loop vertices that fall below the
    // receiver plane — and a flat outline at the caster's mid-depth has its
    // lower half below a floor, so clipping mangles it and the survivor
    // projects far. Slide the whole outline toward the light, past the
    // caster's frontmost point, so every vertex clears any receiver beneath
    // the caster. Footprint is unchanged (depth-invariance); only the clip is
    // avoided.
    const depth = tMax + (tMax - tMin) + maxSpan;
    traceBand(polys, depth, out);
  } else {
    // Self-shadow: depth-stratified bands. Each band's flat proxy is a tilted
    // quad that pokes slightly above the real face planes even where the actual
    // geometry doesn't, so a band tends to false-shadow the very surface that
    // generated it (a convex mesh ends up self-shadowed, which is wrong). Push
    // each band slightly deeper (away from the light) by a small FIXED bias so
    // its proxy sits below the planes of faces at its own depth — a face is then
    // only shadowed by geometry genuinely in front of it. The bias is a fraction
    // of the whole depth span, NOT one band-thickness: tying it to band count
    // made fewer/thicker bands over-bias and erase real interior self-shadow
    // (the coliseum's seating). Genuine occluders sit far ahead and still cast.
    const span = tMax - tMin;
    const band = span / nLayers;
    const bias = span * 0.05;
    for (let k = 0; k < nLayers; k++) {
      const lo = tMin + k * band, hi = k === nLayers - 1 ? Infinity : tMin + (k + 1) * band;
      const subset = polys.filter((p) => p.depth >= lo && p.depth < hi);
      if (subset.length) traceBand(subset, lo - bias, out);
    }
  }
  return out.length ? out : null;
}
