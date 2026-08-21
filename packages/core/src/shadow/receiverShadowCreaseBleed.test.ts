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
// The fixture light sits on the corner BISECTOR of the L: the floor (+z) and
// the wall (−y) then take the SAME Lambert term, resolve to the same lit color,
// and therefore to the same opaque pre-blend. That equality is exactly what
// licenses a crease bleed — two overlapping opaque paints are idempotent only
// when they are the same color. Fixtures that want the opposite use
// `unevenWorldLight` below.
const worldLight: Vec3 = [0, -Math.SQRT1_2, Math.SQRT1_2];
const cssLight: Vec3 = [worldLight[1], worldLight[0], worldLight[2]];
// Tilted off the bisector: floor and wall are both lit, but by different
// amounts, so their pre-blends differ (measured #595959 vs #4b4b4b → rgb(79…)
// vs rgb(69…)). Neither may bleed into the other.
const unevenWorldLight: Vec3 = [0, -0.5, 0.87];
const unevenCssLight: Vec3 = [unevenWorldLight[1], unevenWorldLight[0], unevenWorldLight[2]];
const unevenDirectionalLight = { direction: unevenWorldLight, intensity: 1 };
// Straight down: the floor is fully lit, the wall is exactly edge-on and emits
// no layer at all — the "no abutting shadow to fuse with" case.
const verticalWorldLight: Vec3 = [0, 0, 1];
const verticalCssLight: Vec3 = [verticalWorldLight[1], verticalWorldLight[0], verticalWorldLight[2]];
const verticalDirectionalLight = { direction: verticalWorldLight, intensity: 1 };
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
  opts: {
    creaseBleed: boolean;
    receiverHasTexture?: boolean;
    opacity?: number;
    lightDir?: Vec3;
    dirLight?: { direction: Vec3; intensity: number };
  },
): Map<number, number> {
  const { receiverPlanes, casters } = setup(receiverPolygons);
  const specs = computeReceiverShadowFaces({
    receiverPlanes,
    receiverPolygons,
    receiverHasTexture: opts.receiverHasTexture ?? false,
    casters,
    lightDir: opts.lightDir ?? cssLight,
    cameraRot,
    ambientLight,
    directionalLight: opts.dirLight ?? directionalLight,
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
      const crease = plane.memberCreaseEdges![0];
      expect(crease).toBeDefined();
      expect(crease!.size).toBe(1);
      expect(plane.memberSharedEdges?.[0]).toBeUndefined();
    }
  });

  it("a lone receiver face has no crease edges at all", () => {
    const planes = prepareReceiverFacePlanes([floor], [0, 0, 0], 1, new Set(), 0.05, null);
    expect(planes.length).toBe(1);
    expect(planes[0]!.memberCreaseEdges!.every((s) => s === undefined)).toBe(true);
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
      expect(plane.memberCreaseEdges?.[0]?.size).toBe(1);
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

// The crease detector's input is `memberPolysWorld` (true world vertices), not
// the (u, v) member outline lifted back to 3D. Lifting is exact only when a
// member is perfectly coplanar with its group plane; imported architecture is
// routinely not, and the projection then snaps the SAME shared vertex to two
// different points in the two groups. On the bench castle that displaced
// exactly-shared crease endpoints by ~0.3 CSS px — past RECEIVER_EDGE_PERP_EPS
// (0.25) — so 272 real creases went undetected and painted pale hairlines.
describe("crease detection survives a non-planar member quad", () => {
  // A wall quad whose two top vertices sit slightly off its own best-fit
  // plane, sharing its bottom edge exactly with the floor quad below.
  const OFF = 0.012; // world units ≈ 0.6 CSS px, ≳ the 0.25 px predicate slack
  const skewWall: Polygon = {
    vertices: [[-2, 2, 0], [2, 2, 0], [2, 2 + OFF, 3], [-2, 2 - OFF, 3]],
    color: "#888888",
  };

  it("marks the shared bottom edge as a crease on both members", () => {
    const planes = prepareReceiverFacePlanes(
      [floor, skewWall], [0, 0, 0], 1, new Set(), 0.05, null,
    );
    // The quad really is non-planar: its group projection would move vertices.
    const wallPlane = planes.find((p) => p.memberPolyIndices.includes(1))!;
    const { O, n } = wallPlane;
    const offsets = wallPlane.memberPolysWorld![0]!.map(
      (w) => (w[0] - O[0]) * n[0] + (w[1] - O[1]) * n[1] + (w[2] - O[2]) * n[2],
    );
    expect(Math.max(...offsets.map(Math.abs))).toBeGreaterThan(0.25);

    // Every plane must have found the crease it shares with the other plane.
    for (const plane of planes) {
      const marked = plane.memberCreaseEdges!.some((s) => (s?.size ?? 0) > 0);
      expect(marked).toBe(true);
    }
  });

  it("bleeds that crease, growing the emitted shadow area", () => {
    const bled = specAreas([floor, skewWall], { creaseBleed: true });
    const plain = specAreas([floor, skewWall], { creaseBleed: false });
    let grew = 0;
    for (const [faceIndex, area] of bled) {
      if (area > (plain.get(faceIndex) ?? 0) + 1e-6) grew++;
    }
    expect(grew).toBeGreaterThan(0);
  });
});

// ─── Convex corner: the crease bleed must respect the camera silhouette ──
//
// The L above is a CONCAVE corner: expanding the floor's clip past the crease
// runs into the wall, so the overshoot is always covered. A CONVEX corner (the
// outside edge of a box) folds the two faces AWAY from each other, so the same
// expansion leaves the solid entirely wherever the neighbour is not drawn on
// the far side of the crease.
//
// Both faces camera-facing → the expansion lands on the neighbour (the seam it
// exists to close). Neighbour back-facing → the crease IS the camera
// silhouette, the neighbour emits no SVG to seam against, and the expansion
// would paint outside the model's outline. Measured headlessly on a cube
// (bench/crease-wing.html): before this gate, ~0.5 CSS px of opaque shadow sat
// outside the silhouette at every one of 8 camera angles once the solid leaves'
// own `seamBleed` overscan stopped covering it.
describe("convex crease vs camera silhouette", () => {
  // Top face at z = 0 and a side face hanging DOWN from its y = 2 edge: the
  // two normals (+z, +y) point away from each other — a convex 90° corner.
  const top: Polygon = {
    vertices: [[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]],
    color: "#888888",
  };
  const side: Polygon = {
    vertices: [[2, 2, -3], [-2, 2, -3], [-2, 2, 0], [2, 2, 0]],
    color: "#888888",
  };
  const convexPolys = [top, side];
  // On the corner's bisector, so BOTH faces are lit by the same amount and
  // resolve to the same opaque pre-blend — the configuration where fusing the
  // two SVGs across the crease is sound.
  const convexWorldLight: Vec3 = [0, Math.SQRT1_2, Math.SQRT1_2];
  const convexCssLight: Vec3 = [convexWorldLight[1], convexWorldLight[0], convexWorldLight[2]];
  // Slab above the top face; its shadow band reaches the y = 2 crease.
  const convexCaster: Polygon = {
    vertices: [[-1, 1, 1], [-1, 3, 1], [1, 3, 1], [1, 1, 1]],
    color: "#00ff00",
  };

  function convexAreas(
    cam: { rotX: number; rotY: number },
    creaseBleed: boolean,
    light: { world: Vec3; css: Vec3 } = { world: convexWorldLight, css: convexCssLight },
  ): Map<number, number> {
    const receiverPlanes = prepareReceiverFacePlanes(
      convexPolys, [0, 0, 0], 1, new Set(), 0.05, null,
    );
    const items = prepareCasterPolyItems([convexCaster], [0, 0, 0], 1, () => true, null);
    const specs = computeReceiverShadowFaces({
      receiverPlanes,
      receiverPolygons: convexPolys,
      receiverHasTexture: false,
      casters: [{ id: "c", items, casterPolygonCount: 1 }],
      lightDir: light.css,
      cameraRot: cam,
      ambientLight,
      directionalLight: { direction: light.world, intensity: 1 },
      shadow: { opacity: 0.25 },
      creaseBleed,
    });
    const out = new Map<number, number>();
    for (const spec of specs) {
      out.set(spec.faceIndex, spec.facePolysUv.reduce((t, p) => t + polygonArea(p), 0));
    }
    return out;
  }

  // Camera azimuths are picked by what they can SEE, asserted below through the
  // emitted spec count, so the test does not depend on the rotation convention.
  const BOTH_VISIBLE = { rotX: 55, rotY: 20 };
  const SIDE_HIDDEN = { rotX: 55, rotY: 200 };

  it("still marks the convex crease on both members", () => {
    const planes = prepareReceiverFacePlanes(
      convexPolys, [0, 0, 0], 1, new Set(), 0.05, null,
    );
    expect(planes.length).toBe(2);
    for (const plane of planes) {
      const crease = plane.memberCreaseEdges![0];
      expect(crease?.size).toBe(1);
      // The neighbouring PLANE INDEX is kept alongside the edge — identity, not
      // just a normal, because the bleed gate has to ask that neighbour whether
      // it emits a compatible layer in this pass.
      const neighbours = [...crease!.values()][0]!;
      expect(neighbours.length).toBe(1);
      const other = planes[neighbours[0]!];
      expect(other).toBeDefined();
      expect(other).not.toBe(plane);
      // …and the relation is symmetric, which is what "bleeds back" reads.
      expect(plane.creaseNeighbourPlanes!.has(neighbours[0]!)).toBe(true);
      expect(other!.creaseNeighbourPlanes!.has(planes.indexOf(plane))).toBe(true);
    }
  });

  it("bleeds the convex crease while the neighbour faces the camera", () => {
    const off = convexAreas(BOTH_VISIBLE, false);
    const on = convexAreas(BOTH_VISIBLE, true);
    expect(off.size).toBe(2); // precondition: both faces are drawn
    let grew = 0;
    for (const [faceIndex, offArea] of off) {
      if ((on.get(faceIndex) ?? 0) > offArea + 1e-6) grew++;
    }
    expect(grew).toBeGreaterThan(0);
  });

  it("does not bleed a convex crease that is the camera silhouette", () => {
    const off = convexAreas(SIDE_HIDDEN, false);
    const on = convexAreas(SIDE_HIDDEN, true);
    // Precondition: only the top face is drawn, so its y = 2 crease is the
    // silhouette — there is no neighbouring SVG to seam against.
    expect(off.size).toBe(1);
    expect([...on.keys()]).toEqual([...off.keys()]);
    for (const [faceIndex, offArea] of off) {
      expect(on.get(faceIndex)).toBeCloseTo(offArea, 9);
    }
  });
});

// ─── The bleed decision and the pre-blend outcome must agree ─────────────
//
// Expanding a member clip is only safe because the caller then paints an
// OPAQUE pre-blend, which is idempotent where two faces' expanded clips
// overlap. `blendShadowOverLitBase` cannot represent every pre-blend: a
// translucent receiver shades to `rgba(...)`, and the emission then falls back
// to `fill` at fractional alpha. Expanded clips at fractional alpha
// double-darken across the crease — the exact failure the design prevents. So
// eligibility is decided from the resolved colors, BEFORE the clips are built.
describe("translucent receiver", () => {
  const tFloor: Polygon = { ...floor, color: "rgba(136,136,136,0.5)" };
  const tWall: Polygon = { ...wall, color: "rgba(136,136,136,0.5)" };
  const translucent = [tFloor, tWall];

  it("shades to a color the pre-blend cannot represent", () => {
    const { receiverPlanes, casters } = setup(translucent);
    const specs = computeReceiverShadowFaces({
      receiverPlanes, receiverPolygons: translucent, receiverHasTexture: false,
      casters, lightDir: cssLight, cameraRot, ambientLight, directionalLight,
      shadow: { opacity: 0.25 }, creaseBleed: true,
    });
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(spec.fullLitFill.startsWith("rgba")).toBe(true);
      expect(parseHexColor(spec.fullLitFill)).toBeNull();
      expect(spec.preblendEligible).toBe(false);
      expect(spec.creaseBled).toBe(false);
    }
  });

  it("never emits expanded clips at fractional alpha", () => {
    const faces = mergedFaces(translucent, { opacity: 0.25 });
    expect(faces.length).toBeGreaterThan(0);
    const reference = specAreas(translucent, { creaseBleed: false });
    for (const face of faces) {
      // Fractional alpha is fine — as long as the geometry was NOT expanded.
      expect(face.layers.length).toBe(1);
      const layer = face.layers[0]!;
      expect(layer.opacity).toBeCloseTo(0.25, 6);
      expectAreaUnchanged(pathArea(layer.d), reference.get(face.faceIndex)!);
    }
  });
});

// ─── The pre-blend base is per-GROUP; the leaves are shaded per-POLYGON ──
//
// A face group admits member normals up to RECEIVER_NORMAL_TOL (~2.5°) apart,
// but `fullLitFill` is one color computed from the group plane. Where the
// members' own Lambert terms disagree, the opaque pre-blend is NOT the pixel
// the alpha form produced (residual `(leaf − fullLit)·(1 − opacity)`, measured
// up to 11/255 at opacity 0.25 for a bright base under a grazing light), so
// eligibility is checked against every member's own shading.
describe("group with non-uniform member normals", () => {
  // Triangle fan around an apex at the local origin: every member's plane
  // offset is 0 regardless of tilt, so RECEIVER_OFFSET_TOL cannot separate
  // them, and consecutive rim heights fan the normals apart inside the group
  // normal tolerance.
  const fan: Polygon[] = [];
  {
    const R = 2, N = 6, RAMP = 0.0018;
    const rim: Vec3[] = [];
    // Rim points 0 and 1 stay at z = 0, so member 0's rim edge lies exactly on
    // the wall's bottom edge and the group really does own a crease to bleed.
    for (let i = 0; i <= N; i++) {
      rim.push([-R + (2 * R * i) / N, R, i <= 1 ? 0 : -RAMP * (i - 1) * (i - 1)]);
    }
    for (let i = 0; i < N; i++) {
      fan.push({ vertices: [[0, 0, 0], rim[i + 1]!, rim[i]!], color: "#888888" });
    }
  }
  const fanScene = [...fan, wall];

  it("really is one group with members whose normals differ", () => {
    const planes = prepareReceiverFacePlanes(fanScene, [0, 0, 0], 1, new Set(), 0.05, null);
    const fanPlane = planes.find((p) => p.memberPolyIndices.length > 1);
    expect(fanPlane).toBeDefined();
    expect(fanPlane!.memberPolyIndices.length).toBe(fan.length);
    // Member normals span a real angle — not float noise — yet all grouped.
    const spread = fanPlane!.memberPolysWorld!.map((ws) => {
      const [a, b, c] = [ws[0]!, ws[1]!, ws[2]!];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as Vec3;
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as Vec3;
      const nx = e1[1] * e2[2] - e1[2] * e2[1];
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      const nz = e1[0] * e2[1] - e1[1] * e2[0];
      const l = Math.hypot(nx, ny, nz) || 1;
      const n = fanPlane!.n;
      return Math.abs((nx / l) * n[0] + (ny / l) * n[1] + (nz / l) * n[2]);
    });
    expect(Math.min(...spread)).toBeLessThan(1 - 1e-5);
  });

  // A bright base under a low ambient is where the residual is largest: the
  // Lambert term then moves fastest per degree of normal difference. Measured
  // analytically over the admissible spread, the worst case is 11/255 at
  // opacity 0.25 — five times the threshold this was judged against.
  //
  // The light is tilted along +x, the axis these normals actually fan out on.
  // A light perpendicular to that axis moves the dot only to second order, the
  // members quantize back to one color, and the gate then accepts the group —
  // correctly, because in that configuration the pre-blend really is identical.
  const grazeWorld: Vec3 = [0.7071, 0, 0.7071];
  const grazeCss: Vec3 = [grazeWorld[1], grazeWorld[0], grazeWorld[2]];
  const grazeAmb = { intensity: 0.05 };
  const grazeDir = { direction: grazeWorld, intensity: 1 };

  function grazeSpecs(polys: readonly Polygon[], creaseBleed: boolean) {
    const { receiverPlanes, casters } = setup(polys);
    return computeReceiverShadowFaces({
      receiverPlanes, receiverPolygons: polys, receiverHasTexture: false,
      casters, lightDir: grazeCss, cameraRot, ambientLight: grazeAmb,
      directionalLight: grazeDir, shadow: { opacity: 0.25, maxExtend: 1e6 },
      creaseBleed,
    });
  }

  it("is not pre-blend eligible and keeps unexpanded clips", () => {
    const bright = fanScene.map((p) => ({ ...p, color: "#ffffff" }));
    const specs = grazeSpecs(bright, true);
    const fanSpec = specs.find((s) => s.memberPolyIndices.length > 1);
    expect(fanSpec).toBeDefined();
    // Precondition: this group DOES own a crease — it is the pre-blend, not a
    // missing neighbour, that suppresses the bleed.
    const planes = prepareReceiverFacePlanes(bright, [0, 0, 0], 1, new Set(), 0.05, null);
    const fanPlane = planes.find((p) => p.memberPolyIndices.length > 1)!;
    expect(fanPlane.memberCreaseEdges!.some((c) => (c?.size ?? 0) > 0)).toBe(true);
    expect(fanSpec!.preblendEligible).toBe(false);
    expect(fanSpec!.creaseBled).toBe(false);
    const off = grazeSpecs(bright, false).find((s) => s.faceIndex === fanSpec!.faceIndex)!;
    expect(fanSpec!.facePolysUv.reduce((t, p) => t + polygonArea(p), 0))
      .toBe(off.facePolysUv.reduce((t, p) => t + polygonArea(p), 0));
  });

  it("a group whose members share one normal stays eligible", () => {
    // Same construction with a flat rim: one plane, many members, one normal —
    // eligible even under the grazing light that rejects the fanned one.
    const flat: Polygon[] = [];
    const R = 2, N = 6;
    for (let i = 0; i < N; i++) {
      flat.push({
        vertices: [
          [0, 0, 0],
          [-R + (2 * R * (i + 1)) / N, R, 0],
          [-R + (2 * R * i) / N, R, 0],
        ],
        color: "#ffffff",
      });
    }
    const specs = grazeSpecs([...flat, { ...wall, color: "#ffffff" }], true);
    const flatSpec = specs.find((s) => s.memberPolyIndices.length > 1);
    expect(flatSpec).toBeDefined();
    expect(flatSpec!.preblendEligible).toBe(true);
    // Eligible, but it still does not bleed here: the wall is exactly edge-on
    // to the grazing light (n·L = 0), so it emits no layer for this pass and
    // there is no abutting shadow to fuse with. Eligibility is a property of
    // THIS face; the bleed additionally needs a compatible neighbour.
    expect(specs.some((s) => s.memberPolyIndices.includes(flat.length))).toBe(false);
    expect(flatSpec!.creaseBled).toBe(false);
  });
});

// ─── The opaque form is paid only where it buys the seam fix ─────────────
//
// On the surface the pre-blend is pixel-identical to the alpha form. OFF the
// surface it is not: `shadow.lift` floats the SVG above its face, and at
// grazing angles that parallax hangs part of the card past the silhouette,
// where opaque paint deviates from the backdrop ~4× as much as 25% alpha did
// (measured headlessly on bench/crease-wing.html). So a face that did not bleed
// a crease keeps the alpha form.
describe("pre-blend is gated on an actual crease bleed", () => {
  it("a lone face with no crease keeps the shadowed color at its own alpha", () => {
    const faces = mergedFaces([floor], { opacity: 0.25 });
    expect(faces.length).toBe(1);
    const layer = faces[0]!.layers[0]!;
    expect(layer.opacity).toBeCloseTo(0.25, 6);
    expect(layer.multiply).toBe(false);
  });

  it("a bled crease face emits the opaque pre-blend", () => {
    const faces = mergedFaces([floor, wall], { opacity: 0.25 });
    expect(faces.length).toBe(2);
    for (const face of faces) {
      expect(face.layers[0]!.opacity).toBe(1);
      expect(face.layers[0]!.fill).toMatch(/^rgb\(/);
    }
  });
});

// ─── A crease may only bleed into a COMPATIBLE abutting shadow ───────────
//
// Camera-facing is necessary but nowhere near sufficient. Two further things
// have to be true of the neighbour across the crease, and each was observed
// violated in production geometry:
//
//  (i) it must EMIT a layer in this pass. A face the light cannot reach emits
//      no SVG, so expanding into it paints shadow onto lit surface with nothing
//      to fuse with.
// (ii) its resolved paint must MATCH. Each face's opaque pre-blend derives from
//      its own lit color, and crease neighbours are non-coplanar by
//      construction — so the two colors usually differ, and overlapping two
//      different opaque fills is not idempotent. It simply paints one over the
//      other: a seam of the wrong color, whichever SVG happens to be on top.
describe("crease neighbour must emit a compatible layer", () => {
  it("does not bleed toward a neighbour that emits no layer in this pass", () => {
    const specs = computeReceiverShadowFaces({
      ...setup([floor, wall]),
      receiverPolygons: [floor, wall],
      receiverHasTexture: false,
      lightDir: verticalCssLight,
      cameraRot,
      ambientLight,
      directionalLight: verticalDirectionalLight,
      shadow: { opacity: 0.25 },
      creaseBleed: true,
    });
    // The wall is edge-on to a vertical light: only the floor emits.
    expect(specs.length).toBe(1);
    const floorSpec = specs[0]!;
    expect(floorSpec.memberPolyIndices).toEqual([0]);
    // Precondition: the floor owns the crease and is otherwise free to bleed —
    // the missing neighbour is the only thing stopping it.
    const planes = prepareReceiverFacePlanes([floor, wall], [0, 0, 0], 1, new Set(), 0.05, null);
    const floorPlane = planes.find((p) => p.memberPolyIndices.includes(0))!;
    expect(floorPlane.memberCreaseEdges!.some((c) => (c?.size ?? 0) > 0)).toBe(true);
    expect(floorSpec.preblendEligible).toBe(true);
    expect(floorSpec.creaseBled).toBe(false);
    // …and the emitted geometry is the unbled one.
    const reference = specAreas([floor, wall], {
      creaseBleed: false, lightDir: verticalCssLight, dirLight: verticalDirectionalLight,
    });
    expect(floorSpec.facePolysUv.reduce((t, p) => t + polygonArea(p), 0))
      .toBe(reference.get(floorSpec.faceIndex));
  });

  it("does not bleed between two faces whose lit colors differ", () => {
    const specs = computeReceiverShadowFaces({
      ...setup([floor, wall]),
      receiverPolygons: [floor, wall],
      receiverHasTexture: false,
      lightDir: unevenCssLight,
      cameraRot,
      ambientLight,
      directionalLight: unevenDirectionalLight,
      shadow: { opacity: 0.25 },
      creaseBleed: true,
    });
    // Preconditions: both faces are drawn, both are individually pre-blend
    // eligible, and each owns the crease — only the color mismatch differs.
    expect(specs.length).toBe(2);
    for (const spec of specs) expect(spec.preblendEligible).toBe(true);
    const lit = specs.map((s) => s.fullLitFill);
    expect(lit[0]).not.toBe(lit[1]);
    for (const spec of specs) expect(spec.creaseBled).toBe(false);

    // Geometry stays exactly the unbled reference on both faces.
    const reference = specAreas([floor, wall], {
      creaseBleed: false, lightDir: unevenCssLight, dirLight: unevenDirectionalLight,
    });
    for (const spec of specs) {
      expect(spec.facePolysUv.reduce((t, p) => t + polygonArea(p), 0))
        .toBe(reference.get(spec.faceIndex));
    }

    // …and because nothing bled, neither face takes the opaque form — so two
    // DIFFERENT opaque fills can never overlap at the crease.
    const faces = computeMergedReceiverShadows({
      ...setup([floor, wall]),
      receiverPolygons: [floor, wall],
      receiverHasTexture: false,
      lightDir: unevenCssLight,
      runDirectional: true,
      pointPasses: [],
      allPointLights: [],
      cameraRot,
      ambientLight,
      directionalLight: unevenDirectionalLight,
      shadow: { opacity: 0.25 },
    });
    expect(faces.length).toBe(2);
    for (const face of faces) {
      expect(face.layers.length).toBe(1);
      expect(face.layers[0]!.opacity).toBeCloseTo(0.25, 6);
    }
  });

  it("bleeds once the same two faces are lit equally", () => {
    // The positive control for the test above: same geometry, same camera, same
    // caster — only the light moves onto the corner bisector, which makes the
    // two lit colors (and so the two pre-blends) identical.
    const specs = computeReceiverShadowFaces({
      ...setup([floor, wall]),
      receiverPolygons: [floor, wall],
      receiverHasTexture: false,
      lightDir: cssLight,
      cameraRot,
      ambientLight,
      directionalLight,
      shadow: { opacity: 0.25 },
      creaseBleed: true,
    });
    expect(specs.length).toBe(2);
    expect(specs[0]!.fullLitFill).toBe(specs[1]!.fullLitFill);
    for (const spec of specs) expect(spec.creaseBled).toBe(true);
  });
});

describe("crease reciprocity across a within-group seam", () => {
  // The floor is GROUPED FROM TWO coplanar quads meeting at y = 2, and the wall
  // stands on that very edge — the tessellated / greedy-merged architecture
  // case (interior partition on a subdivided floor), which the one-member-per-
  // plane L fixture above cannot reach. The floor's y = 2 edge is therefore
  // BOTH a within-group seam and the wall's crease neighbour. Suppressing the
  // crease mark on an already-seam-bled edge left the floor with no record of
  // the wall, and `qualifiesCrease`'s reciprocity condition then refused BOTH
  // sides — no bleed, and the pale hairline the pass exists to close returned.
  const floorNear: Polygon = {
    vertices: [[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]],
    color: "#888888",
  };
  const floorFar: Polygon = {
    vertices: [[-2, 2, 0], [2, 2, 0], [2, 6, 0], [-2, 6, 0]],
    color: "#888888",
  };
  const split = [floorNear, floorFar, wall];
  const splitPlanes = () =>
    prepareReceiverFacePlanes(split, [0, 0, 0], 1, new Set(), 0.05, null);
  /** CSS frame swaps world x/y, so the floor is the plane with n ≈ +z. */
  const isFloor = (n: Vec3) => Math.abs(n[2]) > 0.5;

  it("groups the two coplanar quads into one plane with a shared seam", () => {
    const planes = splitPlanes();
    expect(planes.length).toBe(2);
    const floorPlane = planes.find((p) => isFloor(p.n))!;
    expect(floorPlane.memberPolysUv.length).toBe(2);
    const seamed = floorPlane.memberSharedEdges!.filter((s) => (s?.size ?? 0) > 0);
    expect(seamed.length).toBe(2);
  });

  it("records the crease in BOTH directions even though the floor edge is pre-bled", () => {
    const planes = splitPlanes();
    const floorIdx = planes.findIndex((p) => isFloor(p.n));
    const wallIdx = 1 - floorIdx;
    // Wall → floor: the direction the exact endpoint hash always recorded.
    expect(planes[wallIdx]!.creaseNeighbourPlanes?.has(floorIdx)).toBe(true);
    // Floor → wall: the reverse mark. Without it `qualifiesCrease(wall, floor)`
    // is false and the wall silently refuses to bleed.
    expect(planes[floorIdx]!.creaseNeighbourPlanes?.has(wallIdx)).toBe(true);
    // The mark lands on the seam edge itself, and does not invent a second one.
    const creaseEdges = planes[floorIdx]!.memberCreaseEdges!;
    let creaseMarks = 0;
    for (let mi = 0; mi < creaseEdges.length; mi++) {
      for (const [edge] of creaseEdges[mi] ?? []) {
        expect(planes[floorIdx]!.memberSharedEdges?.[mi]?.has(edge)).toBe(true);
        creaseMarks++;
      }
    }
    expect(creaseMarks).toBe(2);
  });

  it("bleeds the wall's crease, and takes the opaque form on both faces", () => {
    const specs = computeReceiverShadowFaces({
      ...setup(split),
      receiverPolygons: split,
      receiverHasTexture: false,
      lightDir: cssLight,
      cameraRot,
      ambientLight,
      directionalLight,
      shadow: { opacity: 0.25 },
      creaseBleed: true,
    });
    expect(specs.length).toBe(2);
    // Same bisector light as the L fixture: floor and wall resolve to the same
    // lit colour, so the overlap of their opaque pre-blends is idempotent.
    expect(specs[0]!.fullLitFill).toBe(specs[1]!.fullLitFill);
    for (const spec of specs) expect(spec.creaseBled).toBe(true);
  });

  it("grows the wall's clipped shadow area versus the unbled reference", () => {
    const off = specAreas(split, { creaseBleed: false });
    const on = specAreas(split, { creaseBleed: true });
    const planes = splitPlanes();
    const wallFace = planes.findIndex((p) => !isFloor(p.n));
    expect(off.get(wallFace)).toBeGreaterThan(0);
    expect(on.get(wallFace)!).toBeGreaterThan(off.get(wallFace)!);
  });
});
