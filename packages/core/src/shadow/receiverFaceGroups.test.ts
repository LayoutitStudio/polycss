import { describe, expect, it } from "vitest";
import { BASE_TILE } from "../camera/camera";
import { buildPolyMeshTransform } from "../transform/meshTransform";
import { buildPolySceneTransform } from "../transform/sceneTransform";
import {
  cssDistanceToWorld,
  cssPositionToWorld,
  polyCssDistanceToWorld,
  polyCssPositionToWorld,
  worldDirectionToCss,
  worldDirectionToPolyCss,
  worldDistanceToCss,
  worldDistanceToPolyCss,
  worldDirectionalLightToCss,
  worldDirectionalLightToPolyCss,
  worldPositionToCss,
  worldPositionToPolyCss,
  groupReceiverFaceGroups,
  worldCssForMesh,
} from "./receiverFaceGroups";
import type { ReceiverPlaneGroup } from "./receiverFaceGroups";
import type { Polygon, Vec3 } from "../types";

describe("world/CSS conversion helpers", () => {
  it("converts world distance to CSS pixels with the default renderer scale", () => {
    expect(worldDistanceToCss(3)).toBe(3 * BASE_TILE);
    expect(worldDistanceToCss(-2)).toBe(-2 * BASE_TILE);
    expect(worldDistanceToPolyCss(0.5)).toBe(0.5 * BASE_TILE);
  });

  it("converts CSS distance back to world units with the default renderer scale", () => {
    expect(cssDistanceToWorld(3 * BASE_TILE)).toBe(3);
    expect(cssDistanceToWorld(-2 * BASE_TILE)).toBe(-2);
    expect(polyCssDistanceToWorld(25)).toBe(0.5);
  });

  it("supports an explicit world-unit pixel scale for adapters", () => {
    expect(worldDistanceToCss(3, 10)).toBe(30);
    expect(cssDistanceToWorld(30, 10)).toBe(3);
  });

  it("converts world position to the swapped CSS frame", () => {
    expect(worldPositionToCss([3, 5, 7])).toEqual([
      5 * BASE_TILE,
      3 * BASE_TILE,
      7 * BASE_TILE,
    ]);
    expect(worldPositionToPolyCss([3, 5, 7])).toEqual([
      5 * BASE_TILE,
      3 * BASE_TILE,
      7 * BASE_TILE,
    ]);
  });

  it("converts CSS position back to world XYZ", () => {
    expect(cssPositionToWorld([5 * BASE_TILE, 3 * BASE_TILE, 7 * BASE_TILE])).toEqual([3, 5, 7]);
    expect(polyCssPositionToWorld([5 * BASE_TILE, 3 * BASE_TILE, 7 * BASE_TILE])).toEqual([3, 5, 7]);
  });

  it("applies the explicit world-unit pixel scale to position conversions", () => {
    expect(worldPositionToCss([3, 5, 7], 10)).toEqual([50, 30, 70]);
    expect(cssPositionToWorld([50, 30, 70], 10)).toEqual([3, 5, 7]);
  });

  it("keeps direction conversion unitless", () => {
    expect(worldDirectionToCss([3, 5, 7])).toEqual([5, 3, 7]);
    expect(worldDirectionToPolyCss([0, 0, 1])).toEqual([0, 0, 1]);
  });

  it("converts directional light objects without mutating other fields", () => {
    const light = { direction: [1, 2, 3] as [number, number, number], color: "#fff", intensity: 0.5 };
    expect(worldDirectionalLightToCss(light)).toEqual({ direction: [2, 1, 3], color: "#fff", intensity: 0.5 });
    expect(worldDirectionalLightToPolyCss(light)).toEqual({ direction: [2, 1, 3], color: "#fff", intensity: 0.5 });
  });

  it("rejects invalid world-unit pixel scales", () => {
    expect(() => worldDistanceToCss(1, 0)).toThrow("positive finite");
    expect(() => cssDistanceToWorld(1, Number.NaN)).toThrow("positive finite");
    expect(() => worldPositionToCss([1, 2, 3], -1)).toThrow("positive finite");
    expect(() => cssPositionToWorld([1, 2, 3], Number.POSITIVE_INFINITY)).toThrow("positive finite");
  });
});

describe("public transform builders", () => {
  it("builds mesh transforms in PolyCSS CSS frame order", () => {
    expect(buildPolyMeshTransform({})).toBeUndefined();
    expect(buildPolyMeshTransform({ position: [1, 2, 3] })).toBe(
      "translate3d(100px, 50px, 150px)",
    );
    expect(buildPolyMeshTransform({ rotation: [10, 20, 30], scale: [2, 3, 4] })).toBe(
      "rotateY(-10deg) rotateX(-20deg) rotateZ(-30deg) scale3d(2, 3, 4)",
    );
  });

  it("builds scene transforms from plain camera input", () => {
    expect(buildPolySceneTransform({
      target: [1, 2, 3],
      rotX: 30,
      rotY: 45,
      zoom: 1,
      distance: 10,
    })).toBe(
      "translateZ(-10px) scale(0.02) rotateX(30deg) rotate(45deg) translate3d(-100px, -50px, -150px)",
    );
  });

  it("supports explicit world unit size and layout scale", () => {
    expect(buildPolySceneTransform({
      target: [1, 2, 3],
      rotX: 0,
      rotY: 0,
      zoom: 2,
      distance: 10,
      layoutScale: 2,
      worldUnitPx: 20,
    })).toBe(
      "translateZ(-20px) scale(0.2) rotateX(0deg) rotate(0deg) translate3d(-40px, -20px, -60px)",
    );
  });
});

describe("groupReceiverFaceGroups plane-bucket unioning", () => {
  const quad = (pts: Array<[number, number, number]>): Polygon => ({
    vertices: pts.map(([x, y, z]) => [x, y, z] as Vec3),
    color: "#888888",
  });
  const group = (polys: Polygon[]): ReceiverPlaneGroup[] =>
    groupReceiverFaceGroups(polys, [0, 0, 0], worldCssForMesh(1), new Set());
  const memberCounts = (groups: ReceiverPlaneGroup[]): number[] =>
    groups.map((g) => g.memberPolysUv.length).sort((a, b) => b - a);

  // A 4x4 floor tile on z = 0. Every case below is built against it.
  const base = quad([[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0]]);

  it("unions T-junction neighbours into ONE group", () => {
    // The 1x1 tile abuts the MIDDLE of `base`'s right edge (x=4, y in [1,2]).
    // No two vertices coincide, so the exact >=2-shared-vertex test fails —
    // only the collinear-overlap predicate can see this adjacency. Leaving
    // them split emits two SVGs whose abutting antialiased edges do not sum
    // to full coverage, which is the castle's hairline-crack artifact.
    const groups = group([base, quad([[4, 1, 0], [5, 1, 0], [5, 2, 0], [4, 2, 0]])]);
    expect(groups).toHaveLength(1);
    expect(memberCounts(groups)).toEqual([2]);
  });

  it("keeps coplanar faces that only touch at a POINT in separate groups", () => {
    // Corner-to-corner contact: collinear along both x=4 and y=4, but the
    // overlap length is zero. A zero-length seam has no crack to close, and
    // merging would bridge the air gap inside the group's convex hull.
    const groups = group([base, quad([[4, 4, 0], [5, 4, 0], [5, 5, 0], [4, 5, 0]])]);
    expect(groups).toHaveLength(2);
  });

  it("keeps coplanar faces separated by a GAP in separate groups", () => {
    const groups = group([base, quad([[5, 1, 0], [6, 1, 0], [6, 2, 0], [5, 2, 0]])]);
    expect(groups).toHaveLength(2);
  });

  it("never unions faces on different planes even when they share a full edge", () => {
    // A wall standing on `base`'s right edge shares BOTH endpoints, so the
    // exact test would union it — the plane bucket is what keeps them apart.
    // Merging would leak the floor's shadow onto a perpendicular surface.
    const groups = group([base, quad([[4, 0, 0], [4, 4, 0], [4, 4, 4], [4, 0, 4]])]);
    expect(groups).toHaveLength(2);
    expect(memberCounts(groups)).toEqual([1, 1]);
  });

  it("still unions a pair that shares a full edge (unchanged grouping)", () => {
    const groups = group([base, quad([[4, 0, 0], [8, 0, 0], [8, 4, 0], [4, 4, 0]])]);
    expect(groups).toHaveLength(1);
    expect(memberCounts(groups)).toEqual([2]);
  });

  it("chains a T-junction through to a full-edge neighbour in one component", () => {
    const groups = group([
      base,
      quad([[4, 1, 0], [5, 1, 0], [5, 2, 0], [4, 2, 0]]),
      quad([[5, 1, 0], [6, 1, 0], [6, 2, 0], [5, 2, 0]]),
    ]);
    expect(groups).toHaveLength(1);
    expect(memberCounts(groups)).toEqual([3]);
  });
});
