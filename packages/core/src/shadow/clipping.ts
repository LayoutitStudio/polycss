// Sutherland-Hodgman polygon clipping (2D).
//
// Used by the experimental per-receiver-face shadow projection: each
// casting polygon's projection onto a receiver face's plane gets clipped
// to that face's outline so the shadow doesn't bleed beyond the receiver.
// Standard textbook algorithm; assumes the clip polygon (receiver face
// outline) is CONVEX and the subject polygon (projected shadow) is
// arbitrary. Non-convex receiver faces would need a Greiner-Hormann
// implementation instead.

type Pt = readonly [number, number];

/**
 * Clips `subject` against the convex polygon `clip`. Both polygons are
 * 2D, given in CCW vertex order. Returns the clipped polygon as a new
 * array of points; an empty array means `subject` lies entirely outside.
 */
export function clipPolygonToConvex2D(
  subject: ReadonlyArray<Pt>,
  clip: ReadonlyArray<Pt>,
): Array<[number, number]> {
  if (subject.length === 0 || clip.length < 3) return [];
  let output: Array<[number, number]> = subject.map((v) => [v[0], v[1]]);
  const n = clip.length;

  for (let i = 0; i < n; i++) {
    if (output.length === 0) return [];
    const input = output;
    output = [];
    const a = clip[i]!;
    const b = clip[(i + 1) % n]!;
    // Edge AB normal points "left" for a CCW clip polygon. A point is
    // inside the clip's half-plane if the cross product is ≥ 0.
    const inside = (p: Pt): boolean => {
      return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    };
    const intersect = (p: Pt, q: Pt): [number, number] => {
      const x1 = a[0], y1 = a[1], x2 = b[0], y2 = b[1];
      const x3 = p[0], y3 = p[1], x4 = q[0], y4 = q[1];
      const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      // Parallel segments: fall back to the subject vertex so we don't
      // introduce a degenerate (collinear) point.
      if (Math.abs(denom) < 1e-12) return [p[0], p[1]];
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
      return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    };
    const inLen = input.length;
    for (let j = 0; j < inLen; j++) {
      const current = input[j]!;
      const prev = input[(j + inLen - 1) % inLen]!;
      const currIn = inside(current);
      const prevIn = inside(prev);
      if (currIn) {
        if (!prevIn) output.push(intersect(prev, current));
        output.push([current[0], current[1]]);
      } else if (prevIn) {
        output.push(intersect(prev, current));
      }
    }
  }
  return output;
}
