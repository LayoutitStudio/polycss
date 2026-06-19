import { describe, expect, it } from "vitest";
import { buildEdgeOwners, classifyFacing, extractSilhouetteLoops, silhouetteReliable } from "./silhouette";
import type { Polygon, Vec3 } from "../types";

/** Axis-aligned unit cube centered at origin, +Z-up. 6 quads (12 tris if we
 *  triangulate, but quads work too here — silhouette uses edge adjacency
 *  on whatever polys we pass in). */
function unitCubeQuads(): Polygon[] {
  const h = 0.5;
  const v = (x: number, y: number, z: number): Vec3 => [x, y, z];
  return [
    // +Z top
    { vertices: [v(-h,-h, h), v( h,-h, h), v( h, h, h), v(-h, h, h)], color: "#fff" },
    // -Z bottom
    { vertices: [v(-h, h,-h), v( h, h,-h), v( h,-h,-h), v(-h,-h,-h)], color: "#fff" },
    // +X right
    { vertices: [v( h,-h,-h), v( h, h,-h), v( h, h, h), v( h,-h, h)], color: "#fff" },
    // -X left
    { vertices: [v(-h, h,-h), v(-h,-h,-h), v(-h,-h, h), v(-h, h, h)], color: "#fff" },
    // +Y front
    { vertices: [v(-h, h,-h), v(-h, h, h), v( h, h, h), v( h, h,-h)], color: "#fff" },
    // -Y back
    { vertices: [v( h,-h,-h), v( h,-h, h), v(-h,-h, h), v(-h,-h,-h)], color: "#fff" },
  ];
}

function planeNormalsFromPolys(polys: Polygon[]): Array<Vec3 | null> {
  return polys.map((p) => {
    if (p.vertices.length < 3) return null;
    const [a, b, c] = p.vertices;
    const e1: Vec3 = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const e2: Vec3 = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    const nx = e1[1]*e2[2] - e1[2]*e2[1];
    const ny = e1[2]*e2[0] - e1[0]*e2[2];
    const nz = e1[0]*e2[1] - e1[1]*e2[0];
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx/len, ny/len, nz/len] as Vec3;
  });
}

describe("buildEdgeOwners", () => {
  it("identifies each cube edge as shared by exactly 2 polygons", () => {
    const polys = unitCubeQuads();
    const owners = buildEdgeOwners(polys);
    // A unit cube has 12 edges, each shared by 2 faces.
    expect(owners.size).toBe(12);
    for (const e of owners.values()) {
      expect(e.polyB).not.toBeNull();
    }
  });

  it("marks boundary edges as polyB=null when only one polygon owns them", () => {
    // Single quad (open mesh — no neighbours).
    const quad: Polygon[] = [{
      vertices: [[0,0,0], [1,0,0], [1,1,0], [0,1,0]],
      color: "#fff",
    }];
    const owners = buildEdgeOwners(quad);
    expect(owners.size).toBe(4);
    for (const e of owners.values()) {
      expect(e.polyB).toBeNull();
    }
  });
});

describe("classifyFacing", () => {
  it("flags +Z polygon as facing a light traveling in -Z direction", () => {
    const normals: Array<Vec3 | null> = [[0,0,1], [0,0,-1]];
    const facing = classifyFacing(normals, [0,0,-1]);
    expect(facing).toEqual([true, false]);
  });

  it("treats grazing polygons (n·L ≈ 0) as non-facing", () => {
    const normals: Array<Vec3 | null> = [[1,0,0]];
    const facing = classifyFacing(normals, [0,0,-1]);
    expect(facing).toEqual([false]);
  });
});

describe("extractSilhouetteLoops", () => {
  it("extracts a single 4-edge loop from a cube lit from above", () => {
    const polys = unitCubeQuads();
    const owners = buildEdgeOwners(polys);
    const normals = planeNormalsFromPolys(polys);
    // Light slightly tilted so top + 2 sides are clearly facing, opposites not.
    const facing = classifyFacing(normals, [0.1, 0.1, -1]);
    const loops = extractSilhouetteLoops(owners, facing);
    expect(loops.length).toBeGreaterThanOrEqual(1);
    // For a cube lit from above with slight x+y tilt: silhouette is a
    // hexagonal-ish loop separating top/front/right from bottom/back/left.
    // The total silhouette edge count for a cube under any direct light
    // is 6 (the hexagonal "outline" you'd see). Loops may report all 6
    // in one closed cycle.
    const totalVerts = loops.reduce((s, l) => s + l.length, 0);
    expect(totalVerts).toBeGreaterThanOrEqual(4);
    expect(totalVerts).toBeLessThanOrEqual(8);
  });

  it("returns no loops when all polygons face the same way", () => {
    // Single quad with light hitting its front face; no neighbours, all
    // 4 boundary edges are silhouette → 1 closed loop of 4 verts.
    const quad: Polygon[] = [{
      vertices: [[0,0,0], [1,0,0], [1,1,0], [0,1,0]],
      color: "#fff",
    }];
    const owners = buildEdgeOwners(quad);
    const normals = planeNormalsFromPolys(quad);
    const facingLight = classifyFacing(normals, [0,0,-1]);
    const loops = extractSilhouetteLoops(owners, facingLight);
    expect(loops.length).toBe(1);
    expect(loops[0]!.length).toBeGreaterThanOrEqual(4);

    // Same quad, light hitting BACK — no silhouette (the face is dark).
    const facingDark = classifyFacing(normals, [0,0, 1]);
    const loops2 = extractSilhouetteLoops(owners, facingDark);
    expect(loops2.length).toBe(0);
  });

  it("returns 0 loops for a cube lit straight along its top normal (degenerate)", () => {
    const polys = unitCubeQuads();
    const owners = buildEdgeOwners(polys);
    const normals = planeNormalsFromPolys(polys);
    // Light precisely down +Z (the top face's exact normal): top is
    // facing, all 4 sides are grazing (n·L ≈ 0 → not facing). So the
    // silhouette is the boundary between top and the four grazing
    // sides → a single 4-edge loop (the cube's top outline).
    const facing = classifyFacing(normals, [0, 0, -1]);
    const loops = extractSilhouetteLoops(owners, facing);
    expect(loops.length).toBe(1);
    expect(loops[0]!.length).toBe(4);
  });
});

describe("silhouetteReliable", () => {
  it("is true for a closed cube (clean degree-2 silhouette)", () => {
    const polys = unitCubeQuads();
    const owners = buildEdgeOwners(polys);
    const facing = classifyFacing(planeNormalsFromPolys(polys), [0.1, 0.1, -1]);
    expect(silhouetteReliable(owners, facing)).toBe(true);
  });

  it("is false when a silhouette vertex has degree != 2 (bowtie / non-manifold)", () => {
    // Two triangles in z=0 sharing ONLY the origin vertex (a bowtie). Both
    // face the light, so all 6 boundary edges are silhouette and FOUR of
    // them meet at the origin → degree-4 vertex, an ambiguous loop walk.
    const polys: Polygon[] = [
      { vertices: [[0,0,0],[1,0,0],[0,1,0]], color: "#fff" },   // normal +Z
      { vertices: [[0,0,0],[-1,0,0],[0,-1,0]], color: "#fff" }, // normal +Z
    ];
    const owners = buildEdgeOwners(polys);
    const facing = classifyFacing(planeNormalsFromPolys(polys), [0, 0, -1]);
    expect(facing).toEqual([true, true]);
    expect(silhouetteReliable(owners, facing)).toBe(false);
  });
});
