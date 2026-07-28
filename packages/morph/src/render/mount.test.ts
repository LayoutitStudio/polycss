import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PolyMorphContractError } from "../contracts/index.js";
import {
  clonePolyMorphFixture,
  createPolyMorphModelFixture,
  POLY_MORPH_IDENTITY_MATRIX,
} from "../testing/modelFixture.js";
import {
  mountPolyMorphModel,
  PolyMorphRenderError,
} from "./index.js";

function createTwoLeafFixture() {
  const fixture = clonePolyMorphFixture(createPolyMorphModelFixture());
  fixture.topology.vertices.push([1, 1, 0]);
  fixture.topology.normals.push([0, 0, 1]);
  fixture.topology.polygons.push({
    id: "accent-panel",
    vertexIndices: [1, 3, 2],
    normalIndices: [1, 3, 2],
  });
  fixture.materials.push({
    id: "cyan",
    color: [0, 0.8, 1, 1],
  });
  fixture.render.cssText = ".polycss-morph-leaf{pointer-events:none}";
  fixture.render.shapes.push({
    id: "accent",
    matrix: POLY_MORPH_IDENTITY_MATRIX,
  });
  fixture.render.leaves.push({
    id: "accent-panel-leaf",
    polygonId: "accent-panel",
    shapeId: "accent",
    materialId: "cyan",
    strategy: "solid-quad",
    width: 64,
    height: 64,
    matrix: POLY_MORPH_IDENTITY_MATRIX,
    atlas: null,
    fallback: null,
  });
  return fixture;
}

describe("mountPolyMorphModel", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mounts every declared shape and leaf exactly once", () => {
    const mounted = mountPolyMorphModel(host, createTwoLeafFixture());
    expect(mounted.shapeElements.size).toBe(2);
    expect(mounted.leafHandles.size).toBe(2);
    expect(mounted.modelElement.querySelectorAll(".polycss-morph-shape")).toHaveLength(2);
    expect(mounted.modelElement.querySelectorAll(".polycss-morph-leaf")).toHaveLength(2);
    expect(mounted.leafHandles.get("gem-panel-leaf")?.element.localName).toBe("u");
    expect(mounted.leafHandles.get("accent-panel-leaf")?.element.localName).toBe("b");
    expect(mounted.leafHandles.get("gem-panel-leaf")?.element.style.width).toBe("");
    expect(mounted.leafHandles.get("gem-panel-leaf")?.element.style.height).toBe("");
    expect(mounted.leafHandles.get("accent-panel-leaf")?.element.style.width).toBe("");
    expect(mounted.leafHandles.get("accent-panel-leaf")?.element.style.height).toBe("");
    expect(mounted.cameraElement.querySelector("style")?.textContent).toContain("pointer-events");
    expect(mounted.stats).toMatchObject({
      mountCount: 1,
      shapeRoots: 2,
      leafCount: 2,
      topologyConstructions: 1,
      atlasConstructions: 0,
      schedulerCount: 0,
    });
  });

  it("mounts polygon-sized slices across prepared pages when corner triangles are unavailable", () => {
    const view = document.defaultView as Window & {
      CSS?: { supports(property: string, value: string): boolean };
    };
    const priorCss = view.CSS;
    Object.defineProperty(view, "CSS", {
      configurable: true,
      value: { supports: () => false },
    });
    try {
      const fixture = createTwoLeafFixture();
      fixture.render.leaves[1]!.strategy = "solid-triangle";
      fixture.render.leaves[1]!.width = 32;
      fixture.render.leaves[1]!.height = 32;
      fixture.render.leaves[0]!.fallback = {
        width: 7,
        height: 5,
        matrixFromLeaf: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          4, 0, 0, 1,
        ],
        atlas: {
          resourcePath: "assets/solid-triangles-000.png",
          x: 1,
          y: 1,
          width: 7,
          height: 5,
          pageWidth: 24,
          pageHeight: 12,
        },
      };
      fixture.render.leaves[1]!.fallback = {
        width: 11,
        height: 9,
        matrixFromLeaf: POLY_MORPH_IDENTITY_MATRIX,
        atlas: {
          resourcePath: "assets/solid-triangles-001.png",
          x: 1,
          y: 1,
          width: 11,
          height: 9,
          pageWidth: 13,
          pageHeight: 11,
        },
      };
      const resolver = vi.fn(
        (path: string) => `https://assets.example.test/${path}`,
      );
      const mounted = mountPolyMorphModel(host, fixture, {
        resolveResourceUrl: resolver,
      });
      const leaves = [...mounted.leafHandles.values()].map(({ element }) => element);
      expect(leaves.every((element) => element.localName === "s")).toBe(true);
      expect(leaves.every((element) =>
        element.dataset.polyMorphResolvedStrategy === "atlas-slice"
        && element.style.backgroundColor === "currentcolor")).toBe(true);
      expect(leaves.map((element) =>
        element.style.getPropertyValue("mask-image"))).toEqual([
        'url("https://assets.example.test/assets/solid-triangles-000.png")',
        'url("https://assets.example.test/assets/solid-triangles-001.png")',
      ]);
      expect(leaves.map((element) =>
        element.style.getPropertyValue("-webkit-mask-image"))).toEqual([
        'url("https://assets.example.test/assets/solid-triangles-000.png")',
        'url("https://assets.example.test/assets/solid-triangles-001.png")',
      ]);
      expect(leaves.map((element) => [
        element.style.width,
        element.style.height,
      ])).toEqual([["7px", "5px"], ["11px", "9px"]]);
      expect(resolver.mock.calls).toEqual([
        ["assets/solid-triangles-000.png"],
        ["assets/solid-triangles-001.png"],
      ]);
      const translated = [...POLY_MORPH_IDENTITY_MATRIX] as number[];
      translated[12] = 10;
      expect(mounted.apply({
        leaves: [{
          leafId: "gem-panel-leaf",
          matrix: translated as typeof POLY_MORPH_IDENTITY_MATRIX,
        }],
      }).leafTransformWrites).toBe(1);
      expect(leaves[0]!.style.transform).toBe(
        "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,14,0,0,1)",
      );
      mounted.assertStableDomIdentity();
      expect(mounted.stats.atlasConstructions).toBe(0);
    } finally {
      Object.defineProperty(view, "CSS", {
        configurable: true,
        value: priorCss,
      });
    }
  });

  it("fails before mounting when a browser needs an undeclared fallback", () => {
    const view = document.defaultView as Window & {
      CSS?: { supports(property: string, value: string): boolean };
    };
    const priorCss = view.CSS;
    Object.defineProperty(view, "CSS", {
      configurable: true,
      value: { supports: () => false },
    });
    try {
      expect(() =>
        mountPolyMorphModel(host, createPolyMorphModelFixture())
      ).toThrowError(PolyMorphRenderError);
      expect(host.childElementCount).toBe(0);
    } finally {
      Object.defineProperty(view, "CSS", {
        configurable: true,
        value: priorCss,
      });
    }
  });

  it("preserves identity and writes only caller-declared dirty rows", () => {
    const mounted = mountPolyMorphModel(host, createTwoLeafFixture());
    const target = mounted.leafHandles.get("gem-panel-leaf")!.element;
    const untouched = mounted.leafHandles.get("accent-panel-leaf")!.element;
    const targetIdentity = target;
    const untouchedTransform = untouched.style.transform;
    const translated = [...POLY_MORPH_IDENTITY_MATRIX] as number[];
    translated[12] = 12;

    const first = mounted.apply({
      leaves: [
        {
          leafId: "gem-panel-leaf",
          matrix: translated as typeof POLY_MORPH_IDENTITY_MATRIX,
          visible: false,
          opacity: 0.5,
        },
      ],
    });
    expect(first).toMatchObject({
      dirtyLeavesVisited: 1,
      leafTransformWrites: 1,
      visibilityWrites: 1,
      opacityWrites: 1,
      domCreations: 0,
      domRemovals: 0,
      topologyConstructions: 0,
      atlasRedraws: 0,
      schedulerCallbacks: 0,
    });
    expect(mounted.leafHandles.get("gem-panel-leaf")?.element).toBe(targetIdentity);
    expect(untouched.style.transform).toBe(untouchedTransform);
    mounted.assertStableDomIdentity();

    const repeated = mounted.apply({
      leaves: [
        {
          leafId: "gem-panel-leaf",
          matrix: translated as typeof POLY_MORPH_IDENTITY_MATRIX,
          visible: false,
          opacity: 0.5,
        },
      ],
    });
    expect(repeated).toMatchObject({
      dirtyLeavesVisited: 1,
      leafTransformWrites: 0,
      visibilityWrites: 0,
      opacityWrites: 0,
    });
  });

  it("applies model and shape matrices without visiting leaves", () => {
    const mounted = mountPolyMorphModel(host, createTwoLeafFixture());
    const translated = [...POLY_MORPH_IDENTITY_MATRIX] as number[];
    translated[13] = 8;
    const result = mounted.apply({
      modelMatrix: translated as typeof POLY_MORPH_IDENTITY_MATRIX,
      shapes: [{
        shapeId: "accent",
        matrix: translated as typeof POLY_MORPH_IDENTITY_MATRIX,
      }],
    });
    expect(result).toMatchObject({
      modelTransformWrites: 1,
      shapeTransformWrites: 1,
      leafTransformWrites: 0,
      dirtyLeavesVisited: 0,
    });
  });

  it("maps image paint once and advances only validated rows", () => {
    const fixture = clonePolyMorphFixture(createPolyMorphModelFixture());
    const leaf = fixture.render.leaves[0]!;
    leaf.strategy = "atlas-slice";
    leaf.width = 4;
    leaf.height = 4;
    leaf.atlas = {
      resourcePath: "assets/gem.webp",
      x: 0,
      y: 0,
      width: 4,
      height: 4,
      pageWidth: 4,
      pageHeight: 8,
    };
    const resolver = vi.fn((path: string) => `https://assets.example.test/${path}`);
    const mounted = mountPolyMorphModel(host, fixture, { resolveResourceUrl: resolver });
    const element = mounted.leafHandles.get("gem-panel-leaf")!.element;
    expect(element.localName).toBe("s");
    expect(element.style.width).toBe("4px");
    expect(element.style.height).toBe("4px");
    expect(element.style.backgroundImage).toContain("gem.webp");
    expect(element.style.backfaceVisibility).toBe("visible");
    expect(resolver).toHaveBeenCalledOnce();

    expect(mounted.apply({
      leaves: [{ leafId: "gem-panel-leaf", atlasRow: 1 }],
    }).atlasRowWrites).toBe(1);
    expect(element.style.backgroundPosition).toBe("0px -4px");
    expect(() => mounted.apply({
      leaves: [{ leafId: "gem-panel-leaf", atlasRow: 2 }],
    })).toThrowError(PolyMorphRenderError);
    expect(mounted.stats.atlasConstructions).toBe(0);
  });

  it("rejects incomplete plans and unknown update handles", () => {
    const incomplete = clonePolyMorphFixture(createPolyMorphModelFixture());
    incomplete.render.leaves = [];
    expect(() => mountPolyMorphModel(host, incomplete)).toThrowError(PolyMorphContractError);
    expect(host.childElementCount).toBe(0);

    const mounted = mountPolyMorphModel(host, createPolyMorphModelFixture());
    expect(() => mounted.apply({
      shapes: [{ shapeId: "missing-shape", matrix: POLY_MORPH_IDENTITY_MATRIX }],
    })).toThrowError(PolyMorphRenderError);
    expect(() => mounted.apply({
      leaves: [{ leafId: "missing-leaf", visible: false }],
    })).toThrowError(PolyMorphRenderError);
  });

  it("never schedules animation and destroys idempotently", () => {
    const requestFrame = vi.fn(() => 1);
    const previous = globalThis.requestAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: requestFrame,
    });
    try {
      const mounted = mountPolyMorphModel(host, createPolyMorphModelFixture());
      mounted.apply({});
      expect(requestFrame).not.toHaveBeenCalled();
      mounted.destroy();
      mounted.destroy();
      expect(mounted.destroyed).toBe(true);
      expect(host.childElementCount).toBe(0);
      expect(() => mounted.assertStableDomIdentity()).toThrowError(PolyMorphRenderError);
    } finally {
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: previous,
      });
    }
  });

  it("updates the camera only when caller state changes", () => {
    const mounted = mountPolyMorphModel(host, createPolyMorphModelFixture());
    expect(mounted.updateCamera()).toBe(false);
    mounted.camera.update({ rotY: 30 });
    expect(mounted.updateCamera()).toBe(true);
    expect(mounted.updateCamera()).toBe(false);
  });
});
