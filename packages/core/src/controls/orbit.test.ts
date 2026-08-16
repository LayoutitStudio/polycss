import { describe, it, expect } from "vitest";
import {
  POINTER_DRAG_SPEED,
  applyOrbit,
  applyPan,
  applyWheelDolly,
  applyWheelZoom,
  invertFactor,
  normalizeWheelDelta,
} from "./orbit";
import { BASE_TILE } from "../camera/camera";

describe("invertFactor", () => {
  it("maps booleans and passes numbers through", () => {
    expect(invertFactor(false)).toBe(1);
    expect(invertFactor(undefined)).toBe(1);
    expect(invertFactor(true)).toBe(-1);
    expect(invertFactor(2.5)).toBe(2.5);
    expect(invertFactor(-0.5)).toBe(-0.5);
  });
});

describe("applyOrbit", () => {
  it("converts pointer px to degrees at POINTER_DRAG_SPEED px/deg", () => {
    const r = applyOrbit(POINTER_DRAG_SPEED * 10, POINTER_DRAG_SPEED * 5, 65, 45, false);
    expect(r.rotX).toBeCloseTo(60, 10); // 65 - 5
    expect(r.rotY).toBeCloseTo(35, 10); // 45 - 10
  });

  it("wraps rotY into [0, 360) but leaves rotX unclamped", () => {
    const r = applyOrbit(POINTER_DRAG_SPEED * 50, -POINTER_DRAG_SPEED * 200, 65, 10, false);
    expect(r.rotY).toBeCloseTo(320, 10); // 10 - 50 → wraps
    expect(r.rotX).toBeCloseTo(265, 10); // 65 + 200, no clamp
  });

  it("inverts with invert=true and scales with numeric invert", () => {
    const normal = applyOrbit(8, 4, 65, 45, false);
    const inverted = applyOrbit(8, 4, 65, 45, true);
    expect(inverted.rotX - 65).toBeCloseTo(-(normal.rotX - 65), 10);
    const doubled = applyOrbit(8, 4, 65, 45, 2);
    expect(doubled.rotX - 65).toBeCloseTo(2 * (normal.rotX - 65), 10);
  });
});

describe("applyPan", () => {
  it("pans a top-down camera (rotX=0, rotY=0) with slippy-map semantics", () => {
    // rotY=0: sin=0, cos=1; cosRotX clamps at cos(0)=1.
    const { targetD0, targetD1 } = applyPan(10, 20, 1, 0, 0);
    expect(targetD0).toBeCloseTo(-20 / BASE_TILE, 10); // (0 - dy·1/1)/k
    expect(targetD1).toBeCloseTo(-10 / BASE_TILE, 10); // -(dx·1 + 0)/k
  });

  it("divides the dy term by cos(rotX) for tilt foreshortening", () => {
    const flat = applyPan(0, 10, 1, 0, 0);
    const tilted = applyPan(0, 10, 1, 60, 0);
    // cos(60°)=0.5 → tilted dy pan moves twice as far
    expect(tilted.targetD0).toBeCloseTo(flat.targetD0 * 2, 10);
  });

  it("clamps cos(rotX) magnitude to 0.1 near the edge-on singularity", () => {
    const nearEdge = applyPan(0, 10, 1, 89.9999, 0);
    expect(nearEdge.targetD0).toBeCloseTo(-10 / (0.1 * BASE_TILE), 6);
  });

  it("preserves the sign of cos(rotX) past 90° so the dy term flips", () => {
    const below = applyPan(0, 10, 1, 60, 0);
    const above = applyPan(0, 10, 1, 120, 0); // cos(120°) = -0.5
    expect(above.targetD0).toBeCloseTo(-below.targetD0, 10);
  });

  it("clamps zoom to a minimum of 0.01", () => {
    const a = applyPan(10, 0, 0, 0, 0);
    const b = applyPan(10, 0, 0.01, 0, 0);
    expect(a.targetD1).toBeCloseTo(b.targetD1, 10);
  });
});

describe("normalizeWheelDelta", () => {
  it("applies deltaMode line/page factors", () => {
    expect(normalizeWheelDelta(2, 0, false)).toBe(2 * 3);
    expect(normalizeWheelDelta(2, 1, false)).toBe(2 * 16 * 3);
    expect(normalizeWheelDelta(2, 2, false)).toBe(2 * 100 * 3);
  });

  it("amplifies pinch (ctrlKey) by 10 and scroll by 3", () => {
    expect(normalizeWheelDelta(5, 0, true)).toBe(50);
    expect(normalizeWheelDelta(5, 0, false)).toBe(15);
  });
});

describe("applyWheelZoom", () => {
  it("zooms in on negative delta and out on positive delta", () => {
    expect(applyWheelZoom(1, -100, 0.1, 10)).toBeGreaterThan(1);
    expect(applyWheelZoom(1, 100, 0.1, 10)).toBeLessThan(1);
  });

  it("clamps to [minZoom, maxZoom]", () => {
    expect(applyWheelZoom(9.99, -1e6, 0.1, 10)).toBe(10);
    expect(applyWheelZoom(0.11, 1e6, 0.1, 10)).toBe(0.1);
  });
});

describe("applyWheelDolly", () => {
  it("moves distance additively by DOLLY_STEP px per unit delta", () => {
    expect(applyWheelDolly(100, 40, 0, Infinity)).toBeCloseTo(102, 10);
  });

  it("clamps to [minDistance, maxDistance]", () => {
    expect(applyWheelDolly(4999, 1e6, 0, 5000)).toBe(5000);
    expect(applyWheelDolly(1, -1e6, 0, 5000)).toBe(0);
  });
});
