/**
 * Feature tests: unified seamBleed semantics through the vanilla renderer.
 *
 * `options.seamBleed` is the raw public option (`number | "auto" | undefined`)
 * and passes straight through to core plan construction:
 *   - undefined / "auto" → the full DEFAULT_SEAM_BLEED (1.5px) overscan
 *   - a finite number ≥ 0 → that many raw CSS px (no 1.5 clamp — previously
 *     vanilla clamped the option to 0..1 and multiplied the default)
 *   - 0 → no shared-edge overscan AND all primitive bleeds disabled
 *   - sub-1.5 numbers → primitive bleeds scale by px / 1.5
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "@layoutit/polycss-core";
import { DEFAULT_SEAM_BLEED } from "@layoutit/polycss-core";
import { renderPolygonsWithTextureAtlas } from "./renderPolygons";
import type { InternalRenderTextureAtlasOptions } from "./types";

/** Two coplanar unit rects sharing the x=1 edge → a detected solid seam. */
const SEAM_RECTS: Polygon[] = [
  { vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], color: "#ff0000" },
  { vertices: [[1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0]], color: "#ff0000" },
];

/** Isolated convex non-rect quad (no seams) — exercises the projective-quad
 *  guard bleed instead of per-edge seam amounts. */
const LONE_QUAD: Polygon[] = [
  { vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 3, 0]], color: "#00ff00" },
];

function renderPlans(polygons: Polygon[], seamBleed?: number | "auto") {
  const options: InternalRenderTextureAtlasOptions = { doc: document, seamBleed };
  const { rendered, dispose } = renderPolygonsWithTextureAtlas(polygons, options);
  const plans = rendered
    .sort((a, b) => a.polygonIndex - b.polygonIndex)
    .map((item) => item.plan);
  dispose();
  return plans;
}

function maxSeamAmount(plan: ReturnType<typeof renderPlans>[number]): number | undefined {
  const amounts = plan?.seamBleedEdgeAmounts;
  return amounts ? Math.max(...amounts.values()) : undefined;
}

describe("vanilla renderer — unified seamBleed pass-through", () => {
  it("undefined and 'auto' resolve to the full 1.5px shared-edge overscan", () => {
    for (const value of [undefined, "auto"] as const) {
      const plans = renderPlans(SEAM_RECTS, value);
      expect(plans).toHaveLength(2);
      for (const plan of plans) {
        expect(maxSeamAmount(plan)).toBe(DEFAULT_SEAM_BLEED);
        expect(plan?.bleedRatio).toBe(1);
      }
    }
  });

  it("numbers above 1.5 are raw px, no longer clamped to the default", () => {
    // Old vanilla semantics: clamp(3, 0, 1) × 1.5 = 1.5px. New: 3px.
    const plans = renderPlans(SEAM_RECTS, 3);
    for (const plan of plans) {
      expect(maxSeamAmount(plan)).toBe(3);
      expect(plan?.bleedRatio).toBe(1);
    }
  });

  it("0 disables the shared-edge overscan and zeroes the primitive-bleed ratio", () => {
    const plans = renderPlans(SEAM_RECTS, 0);
    for (const plan of plans) {
      expect(plan?.seamBleedEdgeAmounts).toBeUndefined();
      expect(plan?.seamBleedEdges).toBeUndefined();
      expect(plan?.bleedRatio).toBe(0);
    }
  });

  it("sub-1.5 numbers are raw px and scale primitive bleeds by px / 1.5", () => {
    // Old vanilla semantics: overscan 0.5 × 1.5 = 0.75px at ratio 0.5.
    const plans = renderPlans(SEAM_RECTS, 0.5);
    for (const plan of plans) {
      expect(maxSeamAmount(plan)).toBe(0.5);
      expect(plan?.bleedRatio).toBeCloseTo(0.5 / 1.5, 10);
    }
  });

  it("seamBleed scales the projective-quad guard bleed on initial render", () => {
    const [full] = renderPlans(LONE_QUAD);
    const [none] = renderPlans(LONE_QUAD, 0);
    expect(full?.projectiveMatrix).toBeTruthy();
    expect(none?.projectiveMatrix).toBeTruthy();
    // bleed 0.6 vs 0 expands the quad differently → different matrix3d.
    expect(none?.projectiveMatrix).not.toEqual(full?.projectiveMatrix);
  });
});
