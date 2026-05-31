/**
 * Shared 2D→3D extrusion used by both `textPolygons` (single line) and
 * `composeText` (multiline / rich / WordArt). Callers place glyph and
 * decoration contours into a flat "type plane" (x → right, y → up, in world
 * units) and hand them here as pre-grouped shapes; this turns each shape into
 * front/back caps + side walls following the chosen depth profile.
 *
 * Type plane → PolyCSS world: PolyCSS maps world X → screen-down,
 * world Y → screen-right, world Z → toward the viewer. So world Y = plane x,
 * world X = -plane y (screen-up), and depth runs along world Z. That single
 * y-negation is a reflection, so it flips winding — every emitted polygon is
 * wound in reverse to stay outward-facing (PolyCSS hides back-faces).
 */
import earcut from "earcut";
import type { Polygon, Vec2, Vec3 } from "@layoutit/polycss-core";

export type Pt = [number, number];
export type Contour = Pt[];

/**
 * Cross-section of the extrusion along its depth:
 * - "flat"  — straight slab with vertical walls (a depth-only extrude).
 * - "round" — a quarter-circle round-over on the front/back edges (bullnose).
 * - "bevel" — a straight 45° chamfer on the front/back edges.
 */
export type ExtrudeProfile = "flat" | "round" | "bevel";

export interface Shape {
  outer: Contour;
  holes: Contour[];
}

export interface ExtrudeOptions {
  depth: number;
  profile: ExtrudeProfile;
  profileSegments: number;
  /** Cap on inward edge inset (keeps round/bevel from pinching thin stems). */
  maxInset: number;
  /** Front cap color. */
  color: string;
  /** Side-wall color. */
  sideColor: string;
  /** Back cap color. Defaults to `color`. Set differently for a layered look. */
  backColor?: string;
  /**
   * Oblique in-plane shift of the back relative to the front, in world units
   * ([rightward, upward]). Non-zero turns the extrude into a leaning block so
   * the differently-colored back peeks out (classic retro 3D / drop shadow).
   */
  oblique?: [number, number];
  /** Depth offset applied to the whole shape (for layered/offset effects). */
  zOffset?: number;
  /**
   * Master fill texture (data URL / URL) painted continuously across the whole
   * word's front face. The face caps are UV-mapped to `faceUvBounds`, so one
   * shared, browser-cached texture flows across every glyph (gradient / rainbow
   * / image). Without it the face stays the solid `color`.
   */
  faceTexture?: string;
  /** Stable material key so every face polygon shares one cached texture. */
  faceTextureKey?: string;
  /** Type-plane bounds the face UVs normalize against (the whole word). */
  faceUvBounds?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Outline stroke color, drawn as a halo just behind the front face. */
  outlineColor?: string;
  /** Outline stroke width in world units (only used with `outlineColor`). */
  outlineWidth?: number;
  /**
   * Flat two-layer mode: emit only the front cap + an offset back cap (shifted
   * by the full `oblique`), with no connecting side walls — the classic WordArt
   * "two flat meshes" drop shadow.
   */
  layered?: boolean;
}

interface Ring {
  z: number;
  inset: number;
}

const toWorld = (p: Pt, z: number): Vec3 => [-p[1], p[0], z];

/** Extrude pre-grouped 2D shapes (type-plane, world units) into polygons. */
export function extrudeContours(shapes: Shape[], opts: ExtrudeOptions): Polygon[] {
  const { profile, profileSegments, maxInset, color, sideColor } = opts;
  const layered = opts.layered ?? false;
  const backColor = opts.backColor ?? color;
  const [obx, oby] = opts.oblique ?? [0, 0];
  const zCenter = opts.zOffset ?? 0;
  // Layered mode forces a minimum front/back separation so the offset shadow
  // sits behind the face even when depth is ~0.
  const depth = layered ? Math.max(opts.depth, 1) : opts.depth;
  const frontZ = zCenter + depth / 2;
  const backZ = zCenter - depth / 2;
  const rings = buildRings(profile, frontZ, backZ, depth, profileSegments, maxInset);
  const polygons: Polygon[] = [];

  // Each ring is shifted in-plane proportional to how far back it sits, so the
  // back leans away from the front by the full oblique offset.
  const obliqueAt = (z: number): Pt => {
    const t = depth > 0 ? (frontZ - z) / depth : 0;
    return [obx * t, oby * t];
  };
  const place = (p: Pt, z: number, o: Pt): Vec3 => toWorld([p[0] + o[0], p[1] + o[1]], z);

  // Face UV: normalize a type-plane point to the whole-word bounds (v=0 bottom,
  // OBJ convention — matches PolyCSS UV expectations).
  const fb = opts.faceUvBounds;
  const faceW = fb ? Math.max(fb.maxX - fb.minX, 1e-6) : 1;
  const faceH = fb ? Math.max(fb.maxY - fb.minY, 1e-6) : 1;
  const uvOf = (p: Pt): Vec2 => [
    Math.min(1, Math.max(0, (p[0] - fb!.minX) / faceW)),
    Math.min(1, Math.max(0, (p[1] - fb!.minY) / faceH)),
  ];
  const hasFaceFill = !!(opts.faceTexture && fb);
  const outlineWidth = opts.outlineColor ? Math.max(0, opts.outlineWidth ?? 0) : 0;

  const maxRingInset = rings.reduce((m, r) => Math.max(m, r.inset), 0);

  for (const shape of shapes) {
    const contours = [shape.outer, ...shape.holes];

    // Clamp the round/bevel inset to this glyph's thinnest feature so the offset
    // can't cross itself (the hairline strokes of high-contrast display faces
    // like Abril Fatface are thinner than a fixed inset would survive).
    const insetScale = maxRingInset > 1e-6
      ? Math.min(1, safeInset(contours, maxRingInset) / maxRingInset)
      : 1;
    const si = (inset: number) => inset * insetScale;

    // Emit a flat cap of `contours` offset by `offset`, at depth `z`, shifted
    // in-plane by `o`. When `fill` is set and a master texture exists, the cap
    // is UV-mapped across the whole word.
    const cap = (offset: number, z: number, o: Pt, flip: boolean, capColor: string, fill = false) => {
      const flat: number[] = [];
      const holeIndices: number[] = [];
      for (let r = 0; r < contours.length; r++) {
        if (r > 0) holeIndices.push(flat.length / 2);
        for (const [x, y] of offsetContour(contours[r], offset)) flat.push(x, y);
      }
      const tris = earcut(flat, holeIndices, 2);
      const vert = (i: number): Pt => [flat[i * 2], flat[i * 2 + 1]];
      for (let t = 0; t < tris.length; t += 3) {
        const a = vert(tris[t]);
        const b = vert(tris[t + 1]);
        const c = vert(tris[t + 2]);
        const tri = flip ? [a, b, c] : [a, c, b];
        const ordered: [Pt, Pt, Pt] = [tri[2], tri[1], tri[0]];
        const poly: Polygon = {
          vertices: [place(ordered[0], z, o), place(ordered[1], z, o), place(ordered[2], z, o)],
          color: capColor,
        };
        if (fill && hasFaceFill) {
          // Inline `texture` (not just `material`) so the mesh atlas planner —
          // which reads polygon.texture — UV-maps the shared fill; material is
          // also set for the direct single-polygon render path.
          poly.texture = opts.faceTexture!;
          poly.material = { texture: opts.faceTexture!, key: opts.faceTextureKey };
          poly.uvs = [uvOf(ordered[0]), uvOf(ordered[1]), uvOf(ordered[2])];
        }
        polygons.push(poly);
      }
    };

    // Outline halo: a larger silhouette in the outline color sitting just behind
    // the front face, so it peeks out around every outer and counter edge.
    if (outlineWidth > 0) {
      cap(-outlineWidth, frontZ - 1e-3, obliqueAt(frontZ), false, opts.outlineColor!);
    }

    // Front face — UV-filled when a master texture is present.
    cap(si(rings[0].inset), rings[0].z, obliqueAt(rings[0].z), false, color, true);

    if (layered) {
      // Flat two-layer shadow: offset back cap, no connecting walls.
      cap(si(rings[rings.length - 1].inset), backZ, [obx, oby], true, backColor);
      continue;
    }

    // Back cap.
    cap(
      si(rings[rings.length - 1].inset),
      rings[rings.length - 1].z,
      obliqueAt(rings[rings.length - 1].z),
      true,
      backColor,
    );

    for (const contour of contours) {
      let prevOffset = offsetContour(contour, si(rings[0].inset));
      let prevO = obliqueAt(rings[0].z);
      for (let r = 1; r < rings.length; r++) {
        const curOffset = offsetContour(contour, si(rings[r].inset));
        const curO = obliqueAt(rings[r].z);
        const z0 = rings[r - 1].z;
        const z1 = rings[r].z;
        for (let i = 0, len = contour.length; i < len; i++) {
          const j = (i + 1) % len;
          polygons.push({
            vertices: [
              place(curOffset[i], z1, curO),
              place(curOffset[j], z1, curO),
              place(prevOffset[j], z0, prevO),
              place(prevOffset[i], z0, prevO),
            ],
            color: sideColor,
          });
        }
        prevOffset = curOffset;
        prevO = curO;
      }
    }
  }

  return polygons;
}

function buildRings(
  profile: ExtrudeProfile,
  frontZ: number,
  backZ: number,
  depth: number,
  seg: number,
  maxInset: number,
): Ring[] {
  if (profile === "flat" || depth <= 0) {
    return [{ z: frontZ, inset: 0 }, { z: backZ, inset: 0 }];
  }
  const edge = Math.min(maxInset, depth / 2);
  const s = profile === "round" ? Math.max(2, seg) : 1;
  const ease = profile === "round"
    ? (u: number) => Math.cos((u * Math.PI) / 2)
    : (u: number) => 1 - u;

  const rings: Ring[] = [];
  for (let k = 0; k <= s; k++) {
    const u = k / s;
    rings.push({ z: frontZ - u * edge, inset: edge * ease(u) });
  }
  if (backZ + edge < frontZ - edge - 1e-6) {
    rings.push({ z: backZ + edge, inset: 0 });
  }
  for (let k = 1; k <= s; k++) {
    const u = 1 - k / s;
    rings.push({ z: backZ + edge * u, inset: edge * ease(u) });
  }
  return rings;
}

/**
 * Largest inset that's safe for this glyph: ~40% of the smallest gap between
 * any two non-adjacent contour vertices (across the outer + holes). That gap is
 * roughly the thinnest stroke / counter wall, so insetting less than half of it
 * keeps the offset outer and hole edges from crossing.
 */
function safeInset(contours: Contour[], desired: number): number {
  // Sample each contour at its vertices AND edge midpoints, so a thin stroke
  // between two long edges is found even when the glyph was flattened coarsely
  // (curve=1). `e` is a fractional edge index used to skip same/adjacent edges.
  const pts: { x: number; y: number; c: number; e: number; n: number }[] = [];
  contours.forEach((cont, ci) => {
    const n = cont.length;
    for (let i = 0; i < n; i++) {
      const a = cont[i];
      const b = cont[(i + 1) % n];
      pts.push({ x: a[0], y: a[1], c: ci, e: i, n });
      pts.push({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, c: ci, e: i + 0.5, n });
    }
  });
  let minSq = Infinity;
  for (let a = 0; a < pts.length; a++) {
    for (let b = a + 1; b < pts.length; b++) {
      if (pts[a].c === pts[b].c) {
        const d = Math.abs(pts[a].e - pts[b].e);
        if (d <= 1.5 || d >= pts[a].n - 1.5) continue; // skip same/adjacent edges
      }
      const dx = pts[a].x - pts[b].x;
      const dy = pts[a].y - pts[b].y;
      const sq = dx * dx + dy * dy;
      if (sq < minSq) minSq = sq;
    }
  }
  return Math.min(desired, Math.sqrt(minSq) * 0.4);
}

function leftNormal(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}

/**
 * Miter-offset a contour inward by `dist` (clamped miter so sharp corners
 * don't spike). Positive `dist` shrinks a CCW outer ring and grows a CW hole.
 */
export function offsetContour(c: Contour, dist: number): Contour {
  if (dist === 0) return c;
  const n = c.length;
  const out: Contour = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = c[(i - 1 + n) % n];
    const cur = c[i];
    const next = c[(i + 1) % n];
    const n1 = leftNormal(prev, cur);
    const n2 = leftNormal(cur, next);
    let mx = n1[0] + n2[0];
    let my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml;
    my /= ml;
    const cos = mx * n1[0] + my * n1[1];
    const len = dist * Math.min(1.5, 1 / Math.max(cos, 1e-3));
    out[i] = [cur[0] + mx * len, cur[1] + my * len];
  }
  return out;
}

/** Perpendicular distance from point p to the infinite line through a→b. */
function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

/** Ramer–Douglas–Peucker on an open polyline (keeps both endpoints). */
function rdp(points: Contour, eps: number): Contour {
  if (points.length < 3) return points;
  const a = points[0];
  const b = points[points.length - 1];
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], a, b);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const left = rdp(points.slice(0, idx + 1), eps);
    const right = rdp(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

/**
 * Simplify a closed contour by dropping points within `tolerance` of the line
 * between their neighbours — cuts cap triangles and wall quads at the cost of
 * detail (higher tolerance = blockier glyphs, fewer polygons). Anchored at the
 * vertex farthest from point 0 so the closed loop simplifies symmetrically.
 *
 * The tolerance is clamped to a fraction of the contour's own size, so small
 * counters/holes (e.g. the centre of `o`, `e`, `a`) never collapse no matter
 * how high the global tolerance goes — holes stay holes.
 */
export function simplifyContour(c: Contour, tolerance: number): Contour {
  if (tolerance <= 0 || c.length < 5) return c;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of c) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const eps = Math.min(tolerance, Math.hypot(maxX - minX, maxY - minY) * 0.12);
  if (eps <= 1e-3) return c;

  let far = 0;
  let best = -1;
  for (let i = 1; i < c.length; i++) {
    const d = Math.hypot(c[i][0] - c[0][0], c[i][1] - c[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const first = rdp(c.slice(0, far + 1), eps);
  const second = rdp([...c.slice(far), c[0]], eps);
  const merged = first.concat(second.slice(1, -1));
  return merged.length >= 3 ? merged : c;
}

export function dedupeContour(c: Contour, eps = 0.05): Contour {
  const out: Contour = [];
  for (const p of c) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > eps) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps) out.pop();
    else break;
  }
  return out;
}

export function signedArea(c: Contour): number {
  let a = 0;
  for (let i = 0, n = c.length; i < n; i++) {
    const [x0, y0] = c[i];
    const [x1, y1] = c[(i + 1) % n];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function pointInPolygon(p: Pt, poly: Contour): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const hit = yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function withWinding(c: Contour, ccw: boolean): Contour {
  const positive = signedArea(c) > 0;
  return positive === ccw ? c : c.slice().reverse();
}

/**
 * Group contours into filled shapes with holes by nesting depth (even depth =
 * filled, odd = hole of its immediate parent), independent of font winding.
 * Call this PER glyph / per decoration — never across overlapping pieces, or a
 * strikethrough bar would swallow the glyphs it crosses as "holes".
 */
export function groupShapes(contours: Contour[]): Shape[] {
  const valid = contours.filter((c) => c.length >= 3);
  const n = valid.length;
  const depth = new Array(n).fill(0);
  const parent = new Array<number>(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const probe = valid[i][0];
    let bestParent = -1;
    let bestArea = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (pointInPolygon(probe, valid[j])) {
        depth[i]++;
        const a = Math.abs(signedArea(valid[j]));
        if (a < bestArea) {
          bestArea = a;
          bestParent = j;
        }
      }
    }
    parent[i] = bestParent;
  }

  const shapes: Shape[] = [];
  const indexOfShape = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 === 0) {
      indexOfShape.set(i, shapes.length);
      shapes.push({ outer: withWinding(valid[i], true), holes: [] });
    }
  }
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 === 1) {
      const si = indexOfShape.get(parent[i]);
      if (si !== undefined) shapes[si].holes.push(withWinding(valid[i], false));
    }
  }
  return shapes;
}

/** Axis-aligned rectangle as a single shape (for underline / strike bars). */
export function rectShape(x0: number, y0: number, x1: number, y1: number): Shape {
  return { outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], holes: [] };
}

/** Multiply a hex color toward black by `f` (0..1). */
export function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
