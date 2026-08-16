import { describe, it, expect } from "vitest";
import {
  computeMergedReceiverShadows,
  prepareCasterPolyItems,
  POLY_DEFAULT_SHADOW_LIFT,
  prepareReceiverFacePlanes,
} from "./computeReceiverShadows";
import { worldPositionToCss } from "./receiverFaceGroups";
import type { Polygon, Vec3 } from "../types";

// A floor receiver (one big quad) + a small caster just above it. The floor is
// a single coplanar group → one face, so every light's shadow lands on it and
// the merge has to combine them.
const floor: Polygon = {
  vertices: [[-10, -10, -0.1], [10, -10, -0.1], [10, 10, -0.1], [-10, 10, -0.1]],
  color: "#888888",
};
const caster: Polygon = {
  vertices: [[0, 0, 0], [0, 1, 0], [1, 0, 0]],
  color: "#00ff00",
};
const cssLight: Vec3 = [0.5, 0.5, 1]; // CSS-frame to-source, lights the floor
const cameraRot = { rotX: 30, rotY: 0 };

function setup() {
  const receiverPlanes = prepareReceiverFacePlanes(
    [floor], [0, 0, 0], 1, new Set(), 0.001, null,
  );
  const items = prepareCasterPolyItems([caster], [0, 0, 0], 1, () => true, null);
  const casters = [{ id: "c", items, casterPolygonCount: 1 }];
  return { receiverPlanes, casters };
}

describe("computeMergedReceiverShadows", () => {
  it("single directional light → one path per face, no base, no multiply", () => {
    const { receiverPlanes, casters } = setup();
    const faces = computeMergedReceiverShadows({
      receiverPlanes,
      receiverPolygons: [floor],
      receiverHasTexture: false,
      casters,
      lightDir: cssLight,
      runDirectional: true,
      pointPasses: [],
      allPointLights: [],
      cameraRot,
      directionalLight: { direction: [0.5, 0.5, 1], intensity: 1 },
      ambientLight: { intensity: 0.4 },
      shadow: { opacity: 0.25 },
    });
    expect(faces.length).toBeGreaterThan(0);
    const f = faces[0]!;
    expect(f.baseFill).toBeNull();
    expect(f.baseD).toBeNull();
    expect(f.layers.length).toBe(1);
    expect(f.layers[0]!.multiply).toBe(false);
    expect(f.svgOpacity).toBe(1);
    // A single-pass SOLID face emits the PRE-BLENDED color at alpha 1, not the
    // shadowed color at `shadow.opacity`. Same pixel over the lit receiver
    // (blend is exact, antialiased edges included), but idempotent under
    // overlap — which is what lets clips bleed across a crease into the
    // neighbouring face's separate SVG without double-darkening.
    expect(f.layers[0]!.opacity).toBe(1);
    expect(f.layers[0]!.fill).toMatch(/^rgb\(/);
  });

  it("directional + shadow-casting point light → merged face: base + multiply layers", () => {
    const { receiverPlanes, casters } = setup();
    const pointCss = worldPositionToCss([0, 0, 6]); // above the caster
    const faces = computeMergedReceiverShadows({
      receiverPlanes,
      receiverPolygons: [floor],
      receiverHasTexture: false,
      casters,
      lightDir: cssLight,
      runDirectional: true,
      pointPasses: [{ lightPos: pointCss, index: 0 }],
      allPointLights: [{ position: pointCss, color: "#5599ff", intensity: 1 }],
      cameraRot,
      directionalLight: { direction: [0.5, 0.5, 1], intensity: 1 },
      ambientLight: { intensity: 0.4 },
      shadow: { opacity: 1 },
    });
    expect(faces.length).toBeGreaterThan(0);
    const merged = faces.find((f) => f.layers.length > 1);
    expect(merged).toBeDefined();
    // Merged solid face: a full-lit base path + one multiply layer per light.
    expect(merged!.baseFill).not.toBeNull();
    expect(merged!.baseD).not.toBeNull();
    expect(merged!.layers.every((l) => l.multiply)).toBe(true);
    // Strength rides the SVG; layers stay opaque so the multiply is exact.
    expect(merged!.svgOpacity).toBeCloseTo(1, 4);
    expect(merged!.layers.every((l) => l.opacity === 1)).toBe(true);
  });

  it("no lights → no faces", () => {
    const { receiverPlanes, casters } = setup();
    const faces = computeMergedReceiverShadows({
      receiverPlanes,
      receiverPolygons: [floor],
      receiverHasTexture: false,
      casters,
      lightDir: cssLight,
      runDirectional: false,
      pointPasses: [],
      allPointLights: [],
      cameraRot,
      ambientLight: { intensity: 0.4 },
      shadow: { opacity: 0.25 },
    });
    expect(faces.length).toBe(0);
  });
});

describe("POLY_DEFAULT_SHADOW_LIFT", () => {
  it("matches the documented default", () => {
    // Regression guard. This default was written out at seven call sites and
    // two drifted to 0.001, which is too small to clear the receiver — cast
    // shadows emitted paths that darkened nothing in all three renderers.
    expect(POLY_DEFAULT_SHADOW_LIFT).toBe(0.05);
  });

  it("offsets the receiver plane away from the surface", () => {
    const [flat] = prepareReceiverFacePlanes([floor], [0, 0, 0], 1, new Set(), 0, null);
    const [lifted] = prepareReceiverFacePlanes(
      [floor], [0, 0, 0], 1, new Set(), POLY_DEFAULT_SHADOW_LIFT, null,
    );
    expect(flat.lift).toBe(0);
    expect(lifted.lift).toBeGreaterThan(0);
  });
});
