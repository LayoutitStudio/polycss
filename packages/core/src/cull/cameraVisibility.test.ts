import { describe, it, expect } from "vitest";
import {
  computeCameraVisibility,
  createCameraVisibilityContext,
} from "./cameraVisibility";
import type { Polygon, Vec3 } from "../types";

// Axis-aligned quad facing +Z (top), CCW from +Z so its normal points +Z.
function topQuad(cx: number, cy: number, cz: number, size = 2): Polygon {
  const h = size / 2;
  return {
    vertices: [
      [cx - h, cy - h, cz],
      [cx + h, cy - h, cz],
      [cx + h, cy + h, cz],
      [cx - h, cy + h, cz],
    ],
  };
}

// Quad facing +X (a wall in the y-z plane), CCW when viewed from +X.
function wallQuadX(cx: number, cy: number, cz: number, size = 10): Polygon {
  const h = size / 2;
  return {
    vertices: [
      [cx, cy - h, cz - h],
      [cx, cy + h, cz - h],
      [cx, cy + h, cz + h],
      [cx, cy - h, cz + h],
    ],
  };
}

describe("computeCameraVisibility", () => {
  it("a lone front-facing quad is visible; from behind it is not", () => {
    const polys: Polygon[] = [topQuad(0, 0, 0)];
    const above = computeCameraVisibility(polys, [0, 0, 10]);
    expect(above.has(0)).toBe(true);
    const below = computeCameraVisibility(polys, [0, 0, -10]);
    expect(below.has(0)).toBe(false); // back-facing to the eye
  });

  it("an opaque wall between eye and target occludes the target", () => {
    // Two +X-facing walls; eye far on +X. Near wall (x=5) occludes the far
    // wall (x=0) which sits directly behind it along the view ray.
    const polys: Polygon[] = [
      wallQuadX(0, 0, 0), // index 0 — far, hidden behind index 1
      wallQuadX(5, 0, 0), // index 1 — near, visible
    ];
    const eye: Vec3 = [100, 0, 0];
    const visible = computeCameraVisibility(polys, eye);
    expect(visible.has(1)).toBe(true);
    expect(visible.has(0)).toBe(false);
  });

  it("target is visible when the eye can see around the occluder", () => {
    // Move the eye off-axis in +Y so the far wall is no longer behind the
    // small near wall — the ray to the far centroid is now unblocked.
    const polys: Polygon[] = [
      wallQuadX(0, 0, 0, 40), // far, large
      wallQuadX(5, 0, 0, 4),  // near, small — only blocks a sliver
    ];
    // Steep off-axis eye: the far centroid→eye ray crosses the x=5 plane at
    // y≈15, well clear of the small near wall's y∈[-2,2] span.
    const eye: Vec3 = [10, 30, 0];
    const visible = computeCameraVisibility(polys, eye);
    expect(visible.has(0)).toBe(true);
  });

  it("frustum culls faces outside the view cone", () => {
    const polys: Polygon[] = [topQuad(0, 0, 0)];
    // Eye above looking DOWN (-Z) sees it; looking UP (+Z) does not.
    const looking = computeCameraVisibility(polys, [0, 0, 10], {
      frustum: { forward: [0, 0, -1], fovRadians: Math.PI / 3 },
    });
    expect(looking.has(0)).toBe(true);
    const away = computeCameraVisibility(polys, [0, 0, 10], {
      frustum: { forward: [0, 0, 1], fovRadians: Math.PI / 3 },
    });
    expect(away.has(0)).toBe(false);
  });

  it("context reuse: anyVisible answers per-group queries without rebuilding", () => {
    const polys: Polygon[] = [
      wallQuadX(0, 0, 0), // group A (far)
      wallQuadX(5, 0, 0), // group B (near, occludes A)
    ];
    const ctx = createCameraVisibilityContext(polys);
    const eye: Vec3 = [100, 0, 0];
    expect(ctx.anyVisible(eye, [1])).toBe(true);
    expect(ctx.anyVisible(eye, [0])).toBe(false);
    expect(ctx.query(eye).has(1)).toBe(true);
  });
});
