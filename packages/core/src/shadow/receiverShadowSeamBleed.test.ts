import { describe, it, expect } from "vitest";
import {
  computeReceiverShadowFaces,
  prepareCasterPolyItems,
  prepareReceiverFacePlanes,
  SHADOW_CLIP_SEAM_BLEED,
} from "./computeReceiverShadows";
import { detectMemberSharedEdges, worldCssForMesh } from "./receiverFaceGroups";
import type { Polygon, Vec3 } from "../types";

// Two abutting 2×4-world squares in one coplanar face group (shared world
// edge x=0 from y=-2 to y=2). Same winding as the mergedReceiverShadows
// floor so the group normal faces the light and the camera.
const memberA: Polygon = {
  vertices: [[-2, -2, 0], [0, -2, 0], [0, 2, 0], [-2, 2, 0]],
  color: "#888888",
};
const memberB: Polygon = {
  vertices: [[0, -2, 0], [2, -2, 0], [2, 2, 0], [0, 2, 0]],
  color: "#888888",
};
// Straight-down light (CSS-frame to-source) so the caster projects 1:1.
const cssLight: Vec3 = [0, 0, 1];
const cameraRot = { rotX: 30, rotY: 0 };

function makeCaster(vertices: Vec3[]): Polygon {
  // Reverse so the caster's normal points AWAY from the straight-down light —
  // the per-poly path single-sided-culls polygons that face the light.
  return { vertices: [...vertices].reverse(), color: "#00ff00" };
}

function computeFaces(
  receiverPolys: Polygon[],
  caster: Polygon,
  overrideSilhouette?: Vec3[][],
) {
  const receiverPlanes = prepareReceiverFacePlanes(
    receiverPolys, [0, 0, 0], 1, new Set(), 0.001, null,
  );
  const items = prepareCasterPolyItems([caster], [0, 0, 0], 1, () => true, null);
  return computeReceiverShadowFaces({
    receiverPlanes,
    receiverPolygons: receiverPolys,
    receiverHasTexture: false,
    casters: [{ id: "c", items, casterPolygonCount: 1, overrideSilhouette }],
    lightDir: cssLight,
    cameraRot,
    directionalLight: { direction: [0, 0, 1], intensity: 1 },
    ambientLight: { intensity: 0.4 },
    shadow: { opacity: 0.25 },
  });
}

type BBox = { minU: number; minV: number; maxU: number; maxV: number };
function bbox(poly: ReadonlyArray<readonly [number, number]>): BBox {
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (const p of poly) {
    if (p[0] < minU) minU = p[0];
    if (p[0] > maxU) maxU = p[0];
    if (p[1] < minV) minV = p[1];
    if (p[1] > maxV) maxV = p[1];
  }
  return { minU, minV, maxU, maxV };
}

/** Overlap interval lengths of two bboxes along U and V. */
function overlap(a: BBox, b: BBox): [number, number] {
  return [
    Math.min(a.maxU, b.maxU) - Math.max(a.minU, b.minU),
    Math.min(a.maxV, b.maxV) - Math.max(a.minV, b.minV),
  ];
}

describe("receiver-shadow member-clip seam bleed", () => {
  it("abutting members: clipped subpaths overlap across the shared edge (per-poly path)", () => {
    // Caster TRIANGLE spanning both members (a quad would fan-triangulate
    // into two tris → four member clips); projects centered on the seam.
    const caster = makeCaster([[-1, -1, 1], [1, 0, 1], [-1, 1, 1]]);
    const faces = computeFaces([memberA, memberB], caster);
    expect(faces.length).toBe(1);
    const polys = faces[0]!.facePolysUv;
    // One clipped piece per member.
    expect(polys.length).toBe(2);
    const [ba, bb] = [bbox(polys[0]!), bbox(polys[1]!)];
    const [ou, ov] = overlap(ba, bb);
    // Each piece extends ≥ SHADOW_CLIP_SEAM_BLEED past the seam, so their
    // bbox intersection along the seam-normal axis is 2×bleed; the other
    // axis overlaps by the triangle's width around the seam (tens of px).
    // min-dimension = the seam overlap.
    const seamOverlap = Math.min(ou, ov);
    expect(seamOverlap).toBeGreaterThanOrEqual(SHADOW_CLIP_SEAM_BLEED);
    expect(seamOverlap).toBeLessThanOrEqual(2 * SHADOW_CLIP_SEAM_BLEED + 1e-6);
    expect(Math.max(ou, ov)).toBeGreaterThan(10);
  });

  it("abutting members: silhouette-path member clips also overlap across the seam", () => {
    const caster = makeCaster([[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]);
    // Feed the same quad as a precomputed override silhouette loop
    // (world-CSS frame) so the silhouette clip site runs instead of the
    // per-poly fan-triangulation.
    const worldCss = worldCssForMesh(1);
    const loop = caster.vertices.map((v) => worldCss(v, [0, 0, 0]));
    const faces = computeFaces([memberA, memberB], caster, [loop]);
    expect(faces.length).toBe(1);
    const polys = faces[0]!.facePolysUv;
    expect(polys.length).toBe(2);
    const [ou, ov] = overlap(bbox(polys[0]!), bbox(polys[1]!));
    const seamOverlap = Math.min(ou, ov);
    expect(seamOverlap).toBeGreaterThanOrEqual(SHADOW_CLIP_SEAM_BLEED);
    expect(seamOverlap).toBeLessThanOrEqual(2 * SHADOW_CLIP_SEAM_BLEED + 1e-6);
  });

  it("outer silhouette edges are NOT expanded — union stays within the member outline", () => {
    // Caster larger than the whole receiver: every member clip is bounded
    // by its (expanded) member outline, so the union bbox must equal the
    // member-union bbox exactly — bleed applies only along the interior
    // shared edge, never the group boundary.
    const caster = makeCaster([[-5, -5, 1], [5, -5, 1], [5, 5, 1], [-5, 5, 1]]);
    const faces = computeFaces([memberA, memberB], caster);
    expect(faces.length).toBe(1);
    const polys = faces[0]!.facePolysUv;
    // Two fan triangles × two members.
    expect(polys.length).toBe(4);
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const poly of polys) {
      const b = bbox(poly);
      minU = Math.min(minU, b.minU);
      minV = Math.min(minV, b.minV);
      maxU = Math.max(maxU, b.maxU);
      maxV = Math.max(maxV, b.maxV);
    }
    // Members span 4×4 world = 200×200 CSS px total. The face-plane UV
    // basis originates at member A's first vertex, so the union is exactly
    // [0..200]×[0..200] up to float noise — no outer-edge expansion.
    expect(maxU - minU).toBeCloseTo(200, 4);
    expect(maxV - minV).toBeCloseTo(200, 4);
    // And the interior pieces still overlap across the seam.
    const [ou, ov] = overlap(bbox(polys[0]!), bbox(polys[1]!));
    expect(Math.min(ou, ov)).toBeGreaterThanOrEqual(SHADOW_CLIP_SEAM_BLEED);
  });

  it("tiny sliver member falls back gracefully (fitted or zero bleed, no crash)", () => {
    // A 0.001-world-wide sliver (0.05 CSS px) abutting a full square. The
    // per-edge fit caps the bleed far below SHADOW_CLIP_SEAM_BLEED; the
    // compute must not throw and must emit finite geometry.
    const sliver: Polygon = {
      vertices: [[0, -2, 0], [0.001, -2, 0], [0.001, 2, 0], [0, 2, 0]],
      color: "#888888",
    };
    const caster = makeCaster([[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]);
    const faces = computeFaces([memberA, sliver], caster);
    expect(faces.length).toBe(1);
    for (const poly of faces[0]!.facePolysUv) {
      for (const p of poly) {
        expect(Number.isFinite(p[0])).toBe(true);
        expect(Number.isFinite(p[1])).toBe(true);
      }
    }
  });
});

describe("detectMemberSharedEdges", () => {
  it("flags the coinciding edge on both members, in either endpoint order", () => {
    // Two CCW unit squares sharing the x=1 edge; B lists the shared edge
    // with reversed endpoints.
    const a: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const b: Array<[number, number]> = [[1, 0], [2, 0], [2, 1], [1, 1]];
    const shared = detectMemberSharedEdges([a, b]);
    // a's edge 1 is (1,0)→(1,1); b's edge 3 is (1,1)→(1,0).
    expect(shared[0]).toEqual(new Set([1]));
    expect(shared[1]).toEqual(new Set([3]));
  });

  it("returns undefined per member when nothing coincides", () => {
    const a: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const b: Array<[number, number]> = [[5, 0], [6, 0], [6, 1], [5, 1]];
    const shared = detectMemberSharedEdges([a, b]);
    expect(shared[0]).toBeUndefined();
    expect(shared[1]).toBeUndefined();
  });

  it("single-member group has no shared edges", () => {
    const a: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(detectMemberSharedEdges([a])).toEqual([undefined]);
  });

  it("T-junction: edge abutting the middle of a longer edge → both shared", () => {
    // A is a 4-wide square; B is a 1-wide square sitting against the middle
    // of A's right edge (x=4, y∈[1..2]). No shared endpoints — the exact
    // pass finds nothing; the collinear-overlap pass must flag A's edge 1
    // ((4,0)→(4,4)) and B's edge 3 ((4,2)→(4,1)).
    const a: Array<[number, number]> = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const b: Array<[number, number]> = [[4, 1], [5, 1], [5, 2], [4, 2]];
    const shared = detectMemberSharedEdges([a, b]);
    expect(shared[0]).toEqual(new Set([1]));
    expect(shared[1]).toEqual(new Set([3]));
  });

  it("collinear but NON-overlapping ranges (corner continuation / gap) → not shared", () => {
    // B's left edge lies on A's right-edge LINE but the parameter ranges
    // don't overlap: B spans y∈[5..6] beyond A's y∈[0..4]. Also covers the
    // corner-continuation case (touching at a single point has zero overlap
    // length, below OVERLAP_EPS).
    const a: Array<[number, number]> = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const b: Array<[number, number]> = [[4, 5], [5, 5], [5, 6], [4, 6]];
    const shared = detectMemberSharedEdges([a, b]);
    expect(shared[0]).toBeUndefined();
    expect(shared[1]).toBeUndefined();
  });

  it("near-parallel but offset beyond epsilon → not shared", () => {
    // B's left edge runs parallel to A's right edge but 1 UV px away —
    // far past PERP_EPS (0.25), so it's a genuinely separate boundary.
    const a: Array<[number, number]> = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const b: Array<[number, number]> = [[5, 1], [6, 1], [6, 2], [5, 2]];
    const shared = detectMemberSharedEdges([a, b]);
    expect(shared[0]).toBeUndefined();
    expect(shared[1]).toBeUndefined();
  });
});
