import { describe, it, expect } from "vitest";
import type { Polygon } from "../types";
import {
  ARROW_SPECS,
  FALLBACK_SHAFT_LENGTH,
  PLANE_SPECS,
  RING_SPECS,
  SCENE_TILE_SIZE,
  SHAFT_LENGTH_RATIO,
  WORLD_AXIS_FOR_CSS,
  gizmoCenterForMesh,
  gizmoLengthForMesh,
  isAxisBackFacing,
  screenPlaneDet,
  snap,
  solveAxisDragDelta,
  solvePlaneDragDeltas,
  unwrapAngleDelta,
  userAxisLetterOf,
  withAlpha,
} from "./gizmo";

function quad(vertices: Array<[number, number, number]>): Polygon {
  return { vertices, material: { type: "color", color: "#ffffff" } } as unknown as Polygon;
}

describe("spec tables", () => {
  it("covers six signed arrows, three rings, three planes", () => {
    expect(ARROW_SPECS.map((s) => s.key)).toEqual(["x", "-x", "y", "-y", "z", "-z"]);
    expect(RING_SPECS.map((s) => s.key)).toEqual(["x", "y", "z"]);
    expect(PLANE_SPECS.map((s) => s.key)).toEqual(["xy", "xz", "yz"]);
  });

  it("WORLD_AXIS_FOR_CSS is the involutive x↔y swap", () => {
    expect(WORLD_AXIS_FOR_CSS[0]).toBe(1);
    expect(WORLD_AXIS_FOR_CSS[1]).toBe(0);
    expect(WORLD_AXIS_FOR_CSS[2]).toBe(2);
    for (const a of [0, 1, 2] as const) {
      expect(WORLD_AXIS_FOR_CSS[WORLD_AXIS_FOR_CSS[a]]).toBe(a);
    }
  });
});

describe("userAxisLetterOf", () => {
  it("strips the sign prefix", () => {
    expect(userAxisLetterOf("x")).toBe("x");
    expect(userAxisLetterOf("-z")).toBe("z");
  });
});

describe("withAlpha", () => {
  it("expands 6-digit hex to rgba", () => {
    expect(withAlpha("#ff3653", 0.6)).toBe("rgba(255, 54, 83, 0.6)");
  });

  it("passes non-hex strings through unchanged", () => {
    expect(withAlpha("rebeccapurple", 0.5)).toBe("rebeccapurple");
    expect(withAlpha("#fff", 0.5)).toBe("#fff");
  });
});

describe("snap", () => {
  it("rounds to the nearest step", () => {
    expect(snap(7.4, 5)).toBe(5);
    expect(snap(7.6, 5)).toBe(10);
    expect(snap(-7.6, 5)).toBe(-10);
  });

  it("passes through for null / undefined / non-positive steps", () => {
    expect(snap(7.6, null)).toBe(7.6);
    expect(snap(7.6, undefined)).toBe(7.6);
    expect(snap(7.6, 0)).toBe(7.6);
    expect(snap(7.6, -2)).toBe(7.6);
  });
});

describe("isAxisBackFacing", () => {
  it("marks +z front-facing and -z back-facing for the default iso camera", () => {
    expect(isAxisBackFacing(2, 1, 65, 45)).toBe(false);
    expect(isAxisBackFacing(2, -1, 65, 45)).toBe(true);
  });

  it("exactly one of each signed pair is back-facing when not edge-on", () => {
    for (const cssAxis of [0, 1, 2] as const) {
      const pos = isAxisBackFacing(cssAxis, 1, 65, 45);
      const neg = isAxisBackFacing(cssAxis, -1, 65, 45);
      expect(pos).not.toBe(neg);
    }
  });

  it("flips the x-axis verdict when the camera yaws 180°", () => {
    const at45 = isAxisBackFacing(0, 1, 65, 45);
    const at225 = isAxisBackFacing(0, 1, 65, 225);
    expect(at45).not.toBe(at225);
  });
});

describe("gizmoLengthForMesh", () => {
  it("returns the fallback for empty meshes", () => {
    expect(gizmoLengthForMesh([])).toBe(FALLBACK_SHAFT_LENGTH);
  });

  it("scales the largest bbox extent by tile size and shaft ratio", () => {
    const polys = [quad([[0, 0, 0], [4, 0, 0], [4, 2, 0], [0, 2, 1]])];
    expect(gizmoLengthForMesh(polys)).toBeCloseTo(4 * SCENE_TILE_SIZE * SHAFT_LENGTH_RATIO, 10);
  });
});

describe("gizmoCenterForMesh", () => {
  it("returns origin for empty meshes", () => {
    expect(gizmoCenterForMesh([])).toEqual([0, 0, 0]);
  });

  it("maps the world bbox center through the world→CSS axis swap × tile", () => {
    const polys = [quad([[0, 0, 0], [4, 0, 0], [4, 2, 0], [0, 2, 6]])];
    // world center = (2, 1, 3) → CSS [y, x, z] × 50
    expect(gizmoCenterForMesh(polys)).toEqual([1 * 50, 2 * 50, 3 * 50]);
  });
});

describe("solveAxisDragDelta", () => {
  it("recovers t exactly when the pointer moves along the projected axis", () => {
    // Screen axis (0.6, 0.8), pointer delta = 12.5 × axis.
    expect(solveAxisDragDelta(0.6 * 12.5, 0.8 * 12.5, 0.6, 0.8)).toBeCloseTo(12.5, 10);
  });

  it("ignores pointer motion perpendicular to the axis", () => {
    expect(solveAxisDragDelta(-0.8, 0.6, 0.6, 0.8)).toBeCloseTo(0, 10);
  });

  it("divides by the squared projection length (short axis → big t)", () => {
    expect(solveAxisDragDelta(10, 0, 0.5, 0)).toBeCloseTo(20, 10);
  });
});

describe("plane drag solve", () => {
  it("computes the 2x2 determinant", () => {
    expect(screenPlaneDet({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1);
    expect(screenPlaneDet({ x: 1, y: 0 }, { x: 2, y: 0 })).toBe(0);
  });

  it("round-trips a known (tA, tB) through the screen basis", () => {
    // Known camera-ish basis: axis A projects to (0.9, 0.3), B to (-0.2, 0.7).
    const pA = { x: 0.9, y: 0.3 };
    const pB = { x: -0.2, y: 0.7 };
    const tA = 14;
    const tB = -6;
    const dx = tA * pA.x + tB * pB.x;
    const dy = tA * pA.y + tB * pB.y;
    const det = screenPlaneDet(pA, pB);
    const solved = solvePlaneDragDeltas(dx, dy, pA, pB, det);
    expect(solved.tA).toBeCloseTo(tA, 10);
    expect(solved.tB).toBeCloseTo(tB, 10);
  });
});

describe("unwrapAngleDelta", () => {
  it("returns the plain difference away from the boundary", () => {
    expect(unwrapAngleDelta(1.0, 0.4)).toBeCloseTo(0.6, 10);
    expect(unwrapAngleDelta(0.4, 1.0)).toBeCloseTo(-0.6, 10);
  });

  it("unwraps across the ±π boundary", () => {
    expect(unwrapAngleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(0.2, 10);
    expect(unwrapAngleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(-0.2, 10);
  });
});
