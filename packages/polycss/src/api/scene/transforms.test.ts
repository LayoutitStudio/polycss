import { describe, expect, it } from "vitest";
import { BASE_TILE } from "@layoutit/polycss-core";
import {
  DEFAULT_TILE,
  DEFAULT_ZOOM,
  LAMBERT_BUCKET_PRECISION,
  applyCssZoomCompensation,
  buildMeshTransform,
  buildSceneTransformFromCamera,
  effectiveCssZoom,
  parseCssZoom,
  quantizeNormalKey,
  worldDirectionToCss,
  worldDirectionalLightToCss,
  worldPositionToCss,
} from "./transforms";
import { createPolyOrthographicCamera } from "../createPolyCamera";

describe("transforms — constants", () => {
  it("DEFAULT_TILE equals core BASE_TILE", () => {
    expect(DEFAULT_TILE).toBe(BASE_TILE);
  });
  it("DEFAULT_ZOOM is 1", () => {
    expect(DEFAULT_ZOOM).toBe(1);
  });
  it("LAMBERT_BUCKET_PRECISION is 0.1", () => {
    expect(LAMBERT_BUCKET_PRECISION).toBe(0.1);
  });
});

describe("worldPositionToCss", () => {
  it("swaps world.x↔world.y and scales by DEFAULT_TILE", () => {
    const out = worldPositionToCss([3, 5, 7]);
    expect(out).toEqual([5 * DEFAULT_TILE, 3 * DEFAULT_TILE, 7 * DEFAULT_TILE]);
  });
  it("preserves zero vector", () => {
    expect(worldPositionToCss([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe("worldDirectionToCss", () => {
  it("swaps x↔y, leaves z, no scale", () => {
    expect(worldDirectionToCss([1, 0, 0])).toEqual([0, 1, 0]);
    expect(worldDirectionToCss([0, 1, 0])).toEqual([1, 0, 0]);
    expect(worldDirectionToCss([0, 0, 1])).toEqual([0, 0, 1]);
  });
});

describe("worldDirectionalLightToCss", () => {
  it("converts the light's direction in-place via spread (no mutation)", () => {
    const light = { direction: [1, 2, 3] as [number, number, number], color: "#fff" };
    const out = worldDirectionalLightToCss(light);
    expect(out!.direction).toEqual([2, 1, 3]);
    expect(light.direction).toEqual([1, 2, 3]); // original untouched
    expect(out!.color).toBe("#fff");
  });
  it("returns input unchanged when undefined or missing direction", () => {
    expect(worldDirectionalLightToCss(undefined)).toBeUndefined();
    const noDir: { direction?: [number, number, number]; color: string } = { color: "#fff" };
    expect(worldDirectionalLightToCss(noDir)).toBe(noDir);
  });
});

describe("buildMeshTransform", () => {
  it("returns undefined for identity transform", () => {
    expect(buildMeshTransform({})).toBeUndefined();
    expect(buildMeshTransform({ position: [0, 0, 0] })).toBeUndefined();
    expect(buildMeshTransform({ scale: 1, rotation: [0, 0, 0] })).toBeUndefined();
  });
  it("position-only emits plain translate3d in CSS frame", () => {
    expect(buildMeshTransform({ position: [1, 2, 3] })).toBe(
      `translate3d(${2 * DEFAULT_TILE}px, ${1 * DEFAULT_TILE}px, ${3 * DEFAULT_TILE}px)`,
    );
  });
  it("scale-only with no bbox emits scale3d alone", () => {
    expect(buildMeshTransform({ scale: 2 })).toBe("scale3d(2, 2, 2)");
  });
  it("rotation-only swaps X↔Y axes and negates angles (world↔CSS reflection)", () => {
    // World↔CSS swap is a reflection (det=-1). Conjugation flips axis and sign:
    // world rotX(θ) → CSS rotateY(-θ); world rotY(θ) → CSS rotateX(-θ);
    // world rotZ(θ) → CSS rotateZ(-θ).
    expect(buildMeshTransform({ rotation: [10, 20, 30] })).toBe(
      "rotateY(-10deg) rotateX(-20deg) rotateZ(-30deg)",
    );
  });
  it("scale pivots at local (0,0,0) — no bbox folding", () => {
    expect(buildMeshTransform({ scale: 2 })).toBe("scale3d(2, 2, 2)");
  });
  it("scale + position: T(pos) · S, no bbox folding", () => {
    // cssPos = world [1,1,1] × tile, swapped → [tile, tile, tile]
    expect(buildMeshTransform({ position: [1, 1, 1], scale: 2 })).toBe(
      `translate3d(${DEFAULT_TILE}px, ${DEFAULT_TILE}px, ${DEFAULT_TILE}px) scale3d(2, 2, 2)`,
    );
  });
  it("vector scale separates per-axis", () => {
    expect(buildMeshTransform({ scale: [2, 3, 4] })).toBe("scale3d(2, 3, 4)");
  });
  it("scale + rotation: R · S (translate, then rotate, then scale applied to vertex)", () => {
    expect(buildMeshTransform({ scale: 2, rotation: [0, 0, 45] })).toBe(
      "rotateZ(-45deg) scale3d(2, 2, 2)",
    );
  });
  it("rotation + position emits T(pos) · R (rotate around local origin)", () => {
    expect(buildMeshTransform({ position: [1, 0, 0], rotation: [0, 0, 90] })).toBe(
      `translate3d(0px, ${DEFAULT_TILE}px, 0px) rotateZ(-90deg)`,
    );
  });
});

describe("buildSceneTransformFromCamera", () => {
  it("at zoom=1 with no distance: scale(1/tile) and rotateX/rotate from camera", () => {
    const camera = createPolyOrthographicCamera({ rotX: 30, rotY: 45, zoom: 1 });
    const css = buildSceneTransformFromCamera(camera);
    expect(css).toBe(
      `scale(${1 / DEFAULT_TILE}) rotateX(30deg) rotate(45deg) translate3d(0px, 0px, 0px)`,
    );
  });
  it("includes translateZ(-distance) when distance non-zero", () => {
    const camera = createPolyOrthographicCamera({ rotX: 0, rotY: 0, zoom: DEFAULT_TILE, distance: 100 });
    const css = buildSceneTransformFromCamera(camera);
    expect(css.startsWith("translateZ(-100px) ")).toBe(true);
  });
  it("autoCenterOffset and target both move the scene-root translate", () => {
    const camera = createPolyOrthographicCamera({ rotX: 0, rotY: 0, zoom: DEFAULT_TILE, target: [1, 2, 3] });
    const css = buildSceneTransformFromCamera(camera, [0, 0, 0]);
    // target × tile, swapped: cssX=2*tile, cssY=1*tile, cssZ=3*tile, negated
    expect(css.endsWith(`translate3d(${-2 * DEFAULT_TILE}px, ${-1 * DEFAULT_TILE}px, ${-3 * DEFAULT_TILE}px)`)).toBe(true);
  });
  it("zoom 1 means 1 world unit = 1 CSS px on screen (after × tile)", () => {
    const camera = createPolyOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
    const css = buildSceneTransformFromCamera(camera);
    expect(css).toContain(`scale(${1 / DEFAULT_TILE})`);
  });
  it("layoutScale multiplies the scene scale and the distance", () => {
    const camera = createPolyOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1, distance: 10 });
    const css = buildSceneTransformFromCamera(camera, [0, 0, 0], 2);
    expect(css.startsWith("translateZ(-20px) ")).toBe(true);
    expect(css).toContain(`scale(${(1 / DEFAULT_TILE) * 2})`);
  });
});

describe("parseCssZoom", () => {
  it("'normal' → 1", () => expect(parseCssZoom("normal")).toBe(1));
  it("'' → 1", () => expect(parseCssZoom("")).toBe(1));
  it("'1.5' → 1.5", () => expect(parseCssZoom("1.5")).toBe(1.5));
  it("'75%' → 0.75", () => expect(parseCssZoom("75%")).toBe(0.75));
  it("invalid → 1", () => expect(parseCssZoom("garbage")).toBe(1));
  it("negative → 1 (rejected)", () => expect(parseCssZoom("-1")).toBe(1));
  it("zero → 1 (rejected)", () => expect(parseCssZoom("0")).toBe(1));
});

describe("effectiveCssZoom", () => {
  it("returns 1 when ownerDocument has no defaultView", () => {
    const el = { ownerDocument: { defaultView: null } } as unknown as HTMLElement;
    expect(effectiveCssZoom(el)).toBe(1);
  });
  it("multiplies zoom up the parent chain", () => {
    const host = document.createElement("div");
    const parent = document.createElement("div");
    const target = document.createElement("div");
    parent.style.setProperty("zoom", "2");
    target.style.setProperty("zoom", "1.5");
    parent.appendChild(target);
    host.appendChild(parent);
    document.body.appendChild(host);
    try {
      expect(effectiveCssZoom(target)).toBeCloseTo(3, 5);
    } finally {
      document.body.removeChild(host);
    }
  });
});

describe("applyCssZoomCompensation", () => {
  it("removes zoom when scale is 1", () => {
    const el = document.createElement("div");
    el.style.setProperty("zoom", "0.5");
    applyCssZoomCompensation(el, 1);
    expect(el.style.getPropertyValue("zoom")).toBe("");
  });
  it("sets zoom to 1/scale to neutralize browser zoom", () => {
    const el = document.createElement("div");
    applyCssZoomCompensation(el, 2);
    expect(el.style.getPropertyValue("zoom")).toBe("0.5");
  });
});

describe("quantizeNormalKey", () => {
  it("returns null for degenerate polygons (<3 verts)", () => {
    expect(quantizeNormalKey({ vertices: [[0, 0, 0], [1, 0, 0]], color: "#fff" } as any)).toBeNull();
  });
  it("returns null for zero-area (collinear) polygons", () => {
    expect(
      quantizeNormalKey({
        vertices: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] as any,
        color: "#fff",
      } as any),
    ).toBeNull();
  });
  it("a triangle in the XY plane (CCW) buckets to a +Z (CSS frame) key", () => {
    const result = quantizeNormalKey({
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as any,
      color: "#fff",
    } as any);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("0,0,1");
    expect(result!.vec).toEqual([0, 0, 1]);
  });
  it("two near-identical normals end up in the same bucket key (quantization)", () => {
    const aSlight = quantizeNormalKey({
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0.001]] as any,
      color: "#fff",
    } as any);
    const aFlat = quantizeNormalKey({
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as any,
      color: "#fff",
    } as any);
    expect(aSlight!.key).toBe(aFlat!.key);
  });
});
