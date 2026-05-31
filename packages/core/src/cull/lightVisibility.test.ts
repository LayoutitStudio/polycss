import { describe, it, expect } from "vitest";
import { computeLightVisibility } from "./lightVisibility";
import type { Polygon, Vec3 } from "../types";

// Axis-aligned quad facing +Z (top), at z=cz, size×size. Vertices CCW
// when viewed from +Z so the cross-product normal points +Z.
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

describe("computeLightVisibility", () => {
  // Sanity: a single polygon is never occluded — no other geometry to
  // block the ray, so the returned set is empty.
  it("returns empty set when there is nothing to occlude", () => {
    const polys: Polygon[] = [topQuad(0, 0, 0)];
    const lightDir: Vec3 = [0, 0, 1];
    expect(computeLightVisibility(polys, lightDir).size).toBe(0);
  });

  // Two parallel quads stacked along the light direction: the LOWER
  // quad's ray toward the light hits the upper quad → lower flagged.
  // The upper quad's ray escapes → not flagged.
  it("flags the lower of two stacked quads", () => {
    const polys: Polygon[] = [
      topQuad(0, 0, 0),   // index 0 — lower, blocked
      topQuad(0, 0, 5),   // index 1 — upper, escapes
    ];
    const lightDir: Vec3 = [0, 0, 1];
    const occluded = computeLightVisibility(polys, lightDir);
    expect(occluded.has(0)).toBe(true);
    expect(occluded.has(1)).toBe(false);
  });

  // skipIndices excludes a polygon from being raytraced AND from being
  // a candidate occluder. With the upper quad skipped, the lower quad's
  // ray finds no blocker → not flagged.
  it("skipIndices excludes both as source and as occluder", () => {
    const polys: Polygon[] = [
      topQuad(0, 0, 0),
      topQuad(0, 0, 5),
    ];
    const lightDir: Vec3 = [0, 0, 1];
    const skip = new Set<number>([1]);
    const occluded = computeLightVisibility(polys, lightDir, skip);
    expect(occluded.has(0)).toBe(false);
    expect(occluded.has(1)).toBe(false);
  });

  // The skipped index never appears in the result even when it WOULD
  // have been occluded — it's excluded from the source-iteration loop.
  it("skipped polygon is never in the returned set", () => {
    const polys: Polygon[] = [
      topQuad(0, 0, 0),
      topQuad(0, 0, 5),
      topQuad(0, 0, 10),  // blocks index 1
    ];
    const lightDir: Vec3 = [0, 0, 1];
    const skip = new Set<number>([0, 1]);
    const occluded = computeLightVisibility(polys, lightDir, skip);
    // Index 0 + 1 in skip → never in output.
    expect(occluded.has(0)).toBe(false);
    expect(occluded.has(1)).toBe(false);
    // Index 2 is the topmost, escapes.
    expect(occluded.has(2)).toBe(false);
  });

  // Regression: the cottage false-positive case. Two near-coincident
  // parallel walls (e.g. an OBJ exporter doubling the outer face slightly
  // outside the inner) would self-occlude — the outer wall's ray hits
  // the duplicate outer wall and gets flagged as occluded. With dedup-
  // before-raytrace passing the duplicate index in skipIndices, the
  // outer wall escapes correctly.
  it("dedup-skip prevents self-occlusion from near-coincident duplicates", () => {
    const polys: Polygon[] = [
      topQuad(0, 0, 0),        // outer wall
      topQuad(0, 0, 0.08),     // near-coincident duplicate ~0.08 above
    ];
    const lightDir: Vec3 = [0, 0, 1];
    // Without skipIndices the lower quad is occluded by its near twin.
    expect(computeLightVisibility(polys, lightDir).has(0)).toBe(true);
    // With the duplicate marked for skip, the outer wall escapes.
    const occluded = computeLightVisibility(polys, lightDir, new Set([1]));
    expect(occluded.has(0)).toBe(false);
  });

  // Back-facing-to-light polygons (n·L <= 0) are never iterated as
  // sources — they can't be lit, occlusion is irrelevant. Their
  // omission must not depend on the skipIndices set.
  it("never flags back-facing-to-light polygons even without skip", () => {
    const polys: Polygon[] = [
      topQuad(0, 0, 0),   // faces +Z
      topQuad(0, 0, 5),
    ];
    // Light direction is -Z — both quads face away from it.
    const lightDir: Vec3 = [0, 0, -1];
    const occluded = computeLightVisibility(polys, lightDir);
    expect(occluded.size).toBe(0);
  });
});
