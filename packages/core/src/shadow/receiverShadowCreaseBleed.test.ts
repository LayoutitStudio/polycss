import { describe, it, expect } from "vitest";
import {
  computeMergedReceiverShadows,
  computeReceiverShadowFaces,
  prepareCasterPolyItems,
  prepareReceiverFacePlanes,
} from "./computeReceiverShadows";
import { parseHexColor } from "../color/color";
import type { Polygon, Vec3 } from "../types";

// An L: a floor quad and a wall quad meeting at the world edge
// (-2, 2, 0) → (2, 2, 0). The two are NOT coplanar, so they land in separate
// face groups and emit separate shadow SVGs — the crease class this file
// covers. The caster is a slab hovering over the floor near the wall, and the
// light is tilted so its shadow reaches the crease on both surfaces.
const floor: Polygon = {
  vertices: [[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]],
  color: "#888888",
};
const wall: Polygon = {
  vertices: [[-2, 2, 0], [2, 2, 0], [2, 2, 3], [-2, 2, 3]],
  color: "#888888",
};
const caster: Polygon = {
  vertices: [[-1, 1.8, 1], [1, 1.8, 1], [1, 0, 1], [-1, 0, 1]],
  color: "#00ff00",
};
const worldLight: Vec3 = [0, -0.5, 0.87];
const cssLight: Vec3 = [worldLight[1], worldLight[0], worldLight[2]];
const cameraRot = { rotX: 60, rotY: 200 };
const ambientLight = { intensity: 0.4 };
const directionalLight = { direction: worldLight, intensity: 1 };

function setup(receiverPolygons: readonly Polygon[]) {
  const receiverPlanes = prepareReceiverFacePlanes(
    receiverPolygons, [0, 0, 0], 1, new Set(), 0.05, null,
  );
  const items = prepareCasterPolyItems([caster], [0, 0, 0], 1, () => true, null);
  return { receiverPlanes, casters: [{ id: "c", items, casterPolygonCount: 1 }] };
}

function polygonArea(poly: ReadonlyArray<readonly [number, number]>): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** Total clipped-shadow area a pass emits per receiver face. */
function specAreas(
  receiverPolygons: readonly Polygon[],
  opts: { creaseBleed: boolean; receiverHasTexture?: boolean; opacity?: number },
): Map<number, number> {
  const { receiverPlanes, casters } = setup(receiverPolygons);
  const specs = computeReceiverShadowFaces({
    receiverPlanes,
    receiverPolygons,
    receiverHasTexture: opts.receiverHasTexture ?? false,
    casters,
    lightDir: cssLight,
    cameraRot,
    ambientLight,
    directionalLight,
    shadow: { opacity: opts.opacity ?? 0.25 },
    creaseBleed: opts.creaseBleed,
  });
  const out = new Map<number, number>();
  for (const spec of specs) {
    out.set(spec.faceIndex, spec.facePolysUv.reduce((t, p) => t + polygonArea(p), 0));
  }
  return out;
}

/** Path `d` coordinates are quantized to 0.1 px, so an area recovered from a
 *  path string can never equal the pre-quantization reference exactly. The
 *  crease bleed changes area by ~0.7%, well clear of this band. */
function expectAreaUnchanged(actual: number, reference: number): void {
  expect(Math.abs(actual - reference) / reference).toBeLessThan(0.002);
}

/** Total area of an `M…L…Z` path in its own SVG user space. */
function pathArea(d: string): number {
  let total = 0;
  for (const sub of d.split("Z")) {
    if (!sub) continue;
    const pts = sub.split(/[ML]/).filter(Boolean).map((s) => {
      const [x, y] = s.split(",");
      return [Number(x), Number(y)] as [number, number];
    });
    if (pts.length >= 3) total += polygonArea(pts);
  }
  return total;
}

function mergedFaces(
  receiverPolygons: readonly Polygon[],
  opts: {
    receiverHasTexture?: boolean;
    opacity?: number;
    pointPasses?: Array<{ lightPos: Vec3; index: number }>;
    allPointLights?: Array<{ position: Vec3; color?: string; intensity?: number }>;
  } = {},
) {
  const { receiverPlanes, casters } = setup(receiverPolygons);
  return computeMergedReceiverShadows({
    receiverPlanes,
    receiverPolygons,
    receiverHasTexture: opts.receiverHasTexture ?? false,
    casters,
    lightDir: cssLight,
    runDirectional: true,
    pointPasses: opts.pointPasses ?? [],
    allPointLights: opts.allPointLights ?? [],
    cameraRot,
    ambientLight,
    directionalLight,
    shadow: { opacity: opts.opacity ?? 0.25 },
  });
}

describe("cross-group crease adjacency", () => {
  it("marks exactly the shared 3D edge and never a free boundary edge", () => {
    const planes = prepareReceiverFacePlanes(
      [floor, wall], [0, 0, 0], 1, new Set(), 0.05, null,
    );
    expect(planes.length).toBe(2);
    for (const plane of planes) {
      // One member per plane, one crease edge on it: the L's inner corner.
      // The three remaining edges of each quad are true mesh-boundary edges —
      // bleeding those would push shadow off the model's silhouette into the
      // background, so they must stay out of the set.
      expect(plane.memberPolysUv.length).toBe(1);
      const crease = plane.memberCreaseEdges[0];
      expect(crease).toBeDefined();
      expect(crease!.size).toBe(1);
      expect(plane.memberSharedEdges[0]).toBeUndefined();
    }
  });

  it("a lone receiver face has no crease edges at all", () => {
    const planes = prepareReceiverFacePlanes([floor], [0, 0, 0], 1, new Set(), 0.05, null);
    expect(planes.length).toBe(1);
    expect(planes[0]!.memberCreaseEdges.every((s) => s === undefined)).toBe(true);
  });

  it("crease neighbours across a T-junction still match", () => {
    // The wall covers only the middle half of the floor's y = 2 edge, so the
    // exact endpoint-pair hash cannot see the adjacency — the collinear-overlap
    // sweep in world space has to.
    const halfWall: Polygon = {
      vertices: [[-1, 2, 0], [1, 2, 0], [1, 2, 3], [-1, 2, 3]],
      color: "#888888",
    };
    const planes = prepareReceiverFacePlanes(
      [floor, halfWall], [0, 0, 0], 1, new Set(), 0.05, null,
    );
    expect(planes.length).toBe(2);
    for (const plane of planes) {
      expect(plane.memberCreaseEdges[0]?.size).toBe(1);
    }
  });
});

describe("crease seam bleed", () => {
  it("expands the clip along crease edges only when enabled", () => {
    const off = specAreas([floor, wall], { creaseBleed: false });
    const on = specAreas([floor, wall], { creaseBleed: true });
    expect(off.size).toBe(2);
    expect([...on.keys()].sort()).toEqual([...off.keys()].sort());
    for (const [faceIndex, offArea] of off) {
      // Both faces' shadows reach the crease, so both grow. The gain is the
      // crease edge length × the achievable outward offset — bounded by the
      // group outline's own RECEIVER_OUTLINE_EXPAND, which is why it is 0.5 px
      // per side rather than the full SHADOW_CLIP_SEAM_BLEED.
      expect(on.get(faceIndex)!).toBeGreaterThan(offArea);
    }
  });

  it("is suppressed for a textured receiver", () => {
    const off = specAreas([floor, wall], { creaseBleed: false, receiverHasTexture: true });
    const on = specAreas([floor, wall], { creaseBleed: true, receiverHasTexture: true });
    for (const [faceIndex, offArea] of off) {
      expect(on.get(faceIndex)!).toBe(offArea);
    }
  });

  it("is suppressed for a multi-colored coplanar group", () => {
    // Two coplanar floor halves with DIFFERENT base colors group together by
    // plane + adjacency. `fullLitFill` comes from member[0] only, so it is not
    // the painted color of member[1] — the pre-blend would shift that member's
    // color, and without the pre-blend the crease bleed would double-darken.
    const left: Polygon = {
      vertices: [[-2, -2, 0], [0, -2, 0], [0, 2, 0], [-2, 2, 0]], color: "#888888",
    };
    const right: Polygon = {
      vertices: [[0, -2, 0], [2, -2, 0], [2, 2, 0], [0, 2, 0]], color: "#cc4444",
    };
    const polys = [left, right, wall];
    const { receiverPlanes, casters } = setup(polys);
    const specs = computeReceiverShadowFaces({
      receiverPlanes, receiverPolygons: polys, receiverHasTexture: false, casters,
      lightDir: cssLight, cameraRot, ambientLight, directionalLight,
      shadow: { opacity: 0.25 }, creaseBleed: true,
    });
    const floorSpec = specs.find((s) => s.memberPolyIndices.length === 2);
    expect(floorSpec).toBeDefined();
    expect(floorSpec!.preblendEligible).toBe(false);

    const off = specAreas(polys, { creaseBleed: false });
    expect(specs.find((s) => s.faceIndex === floorSpec!.faceIndex)!.facePolysUv
      .reduce((t, p) => t + polygonArea(p), 0)).toBe(off.get(floorSpec!.faceIndex));
  });
});

describe("opaque pre-blend", () => {
  // The identity proof. A single-pass solid face used to paint `fill` at
  // `opacity` over a receiver painted `fullLitFill`; it now paints
  // blend(fullLitFill, fill, opacity) at alpha 1. Compositing is source-over
  // in sRGB, so the two are the same pixel to within integer rounding — and
  // that holds at antialiased coverage c too, since
  // base·(1−c) + blend·c == base·(1−o·c) + fill·o·c.
  for (const opacity of [1, 0.5, 0.25]) {
    it(`emits blend(lit, shadowed, ${opacity}) at alpha 1`, () => {
      const { receiverPlanes, casters } = setup([floor, wall]);
      const specs = computeReceiverShadowFaces({
        receiverPlanes, receiverPolygons: [floor, wall], receiverHasTexture: false,
        casters, lightDir: cssLight, cameraRot, ambientLight, directionalLight,
        shadow: { opacity },
      });
      const faces = mergedFaces([floor, wall], { opacity });
      expect(faces.length).toBe(specs.length);
      expect(faces.length).toBeGreaterThan(0);
      for (const face of faces) {
        const spec = specs.find((s) => s.faceIndex === face.faceIndex)!;
        expect(spec.preblendEligible).toBe(true);
        expect(face.svgOpacity).toBe(1);
        expect(face.baseFill).toBeNull();
        expect(face.layers.length).toBe(1);
        const layer = face.layers[0]!;
        expect(layer.opacity).toBe(1);
        const base = parseHexColor(spec.fullLitFill)!.rgb;
        const fill = parseHexColor(spec.fill)!.rgb;
        const expected = base.map((b, i) => Math.round(b + (fill[i]! - b) * opacity));
        expect(layer.fill).toBe(`rgb(${expected[0]},${expected[1]},${expected[2]})`);
      }
    });
  }

  it("at opacity 1 the pre-blend is the shadowed color itself", () => {
    const { receiverPlanes, casters } = setup([floor, wall]);
    const specs = computeReceiverShadowFaces({
      receiverPlanes, receiverPolygons: [floor, wall], receiverHasTexture: false,
      casters, lightDir: cssLight, cameraRot, ambientLight, directionalLight,
      shadow: { opacity: 1 },
    });
    const faces = mergedFaces([floor, wall], { opacity: 1 });
    for (const face of faces) {
      const spec = specs.find((s) => s.faceIndex === face.faceIndex)!;
      const fill = parseHexColor(spec.fill)!.rgb;
      expect(face.layers[0]!.fill).toBe(`rgb(${fill[0]},${fill[1]},${fill[2]})`);
    }
  });

  it("textured receivers keep the shadow color at its own alpha", () => {
    const faces = mergedFaces([floor, wall], { receiverHasTexture: true, opacity: 0.25 });
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face.baseFill).toBeNull();
      expect(face.svgOpacity).toBe(1);
      for (const layer of face.layers) {
        expect(layer.multiply).toBe(false);
        expect(layer.opacity).toBeLessThan(1);
        expect(layer.fill).toBe("#000000");
      }
    }
    // …and the emitted geometry is byte-identical to the unbled reference.
    const reference = specAreas([floor, wall], { creaseBleed: false, receiverHasTexture: true });
    for (const face of faces) {
      expectAreaUnchanged(
        pathArea(face.layers.map((l) => l.d).join("")), reference.get(face.faceIndex)!,
      );
    }
  });

  it("multi-light faces keep the base + multiply path and no crease bleed", () => {
    const pointCss: Vec3 = [0, -60, 60];
    const faces = mergedFaces([floor, wall], {
      opacity: 0.4,
      pointPasses: [{ lightPos: pointCss, index: 0 }],
      allPointLights: [{ position: pointCss, color: "#5599ff", intensity: 1 }],
    });
    const merged = faces.filter((f) => f.layers.length > 1);
    expect(merged.length).toBeGreaterThan(0);
    for (const face of merged) {
      expect(face.baseFill).not.toBeNull();
      expect(face.svgOpacity).toBeCloseTo(0.4, 6);
      expect(face.layers.every((l) => l.multiply && l.opacity === 1)).toBe(true);
    }
    // Two passes disable crease bleed for the whole receiver, so even the
    // single-layer faces in this run carry the unbled geometry.
    const reference = specAreas([floor, wall], { creaseBleed: false, opacity: 0.4 });
    for (const face of faces) {
      if (face.layers.length !== 1) continue;
      expectAreaUnchanged(pathArea(face.layers[0]!.d), reference.get(face.faceIndex)!);
    }
  });
});
