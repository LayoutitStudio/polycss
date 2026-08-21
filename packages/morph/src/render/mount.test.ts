import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PolyMorphContractError } from "../contracts/index.js";
import {
  clonePolyMorphFixture,
  createPolyMorphModelFixture,
  POLY_MORPH_IDENTITY_MATRIX,
  polyMorphIdentityMatrix,
} from "../testing/modelFixture.js";
import {
  mountPolyMorphModel,
  PolyMorphRenderError,
} from "./index.js";

function imageResources(paths: readonly string[]) {
  return new Map(paths.map((path, index) => [
    path,
    {
      descriptor: {
        path,
        role: "image" as const,
        mediaType: "image/png",
        bytes: 1,
        sha256: "0".repeat(64),
      },
      bytes: new Uint8Array([index]),
    },
  ]));
}

function overrideUserAgent(value: string): () => void {
  const navigator = document.defaultView!.navigator;
  const prior = Object.getOwnPropertyDescriptor(navigator, "userAgent");
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value,
  });
  return () => {
    if (prior) Object.defineProperty(navigator, "userAgent", prior);
    else delete (navigator as { userAgent?: string }).userAgent;
  };
}

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
  fixture.render.shapes.push({
    id: "accent",
    matrix: [...POLY_MORPH_IDENTITY_MATRIX],
  });
  fixture.render.leaves.push({
    id: "accent-panel-leaf",
    polygonId: "accent-panel",
    shapeId: "accent",
    materialId: "cyan",
    strategy: "solid-quad",
    width: 64,
    height: 64,
    matrix: [...POLY_MORPH_IDENTITY_MATRIX],
    atlas: null,
    fallback: null,
  });
  return fixture;
}

function createSolidQuadFixture() {
  const fixture = clonePolyMorphFixture(createPolyMorphModelFixture());
  fixture.topology.vertices.push([1, 1, 0]);
  fixture.topology.normals.push([0, 0, 1]);
  fixture.topology.polygons[0]!.vertexIndices = [0, 1, 3, 2];
  fixture.topology.polygons[0]!.normalIndices = [0, 1, 3, 2];
  fixture.render.leaves[0]!.strategy = "solid-quad";
  fixture.render.leaves[0]!.width = 64;
  fixture.render.leaves[0]!.height = 64;
  return fixture;
}

function projectiveMatrix() {
  const value = polyMorphIdentityMatrix();
  value[3] = 0.25 / 64;
  return value;
}

const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const IOS_CHROME_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1";
const WKWEBVIEW_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function parsedMatrix(element: HTMLElement): number[] {
  const match = /^matrix3d\(([^)]+)\)$/u.exec(element.style.transform);
  if (!match) throw new TypeError("expected matrix3d transform");
  return match[1]!.split(",").map(Number);
}

function applyMatrix(
  matrix: readonly number[],
  [x, y]: readonly [number, number],
): readonly [number, number] {
  const w = matrix[3]! * x + matrix[7]! * y + matrix[15]!;
  return [
    (matrix[0]! * x + matrix[4]! * y + matrix[12]!) / w,
    (matrix[1]! * x + matrix[5]! * y + matrix[13]!) / w,
  ];
}

describe("mountPolyMorphModel", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement("div");
    document.body.appendChild(host);
    let objectUrl = 0;
    vi.spyOn(document.defaultView!.URL, "createObjectURL")
      .mockImplementation(() => `blob:test-${objectUrl += 1}`);
    vi.spyOn(document.defaultView!.URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
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
    expect(mounted.leafHandles.get("accent-panel-leaf")?.element.style.width).toBe("64px");
    expect(mounted.leafHandles.get("accent-panel-leaf")?.element.style.height).toBe("64px");
    expect(mounted.cameraElement.querySelector("style")).toBeNull();
    expect(mounted.stats).toMatchObject({
      mountCount: 1,
      shapeRoots: 2,
      leafCount: 2,
      topologyConstructions: 1,
      atlasConstructions: 0,
      schedulerCount: 0,
    });
  });

  it("applies projective solid quad matrices on supported browsers", () => {
    const restoreUserAgent = overrideUserAgent(CHROME_UA);
    try {
      const mounted = mountPolyMorphModel(host, createSolidQuadFixture());
      const element = mounted.leafHandles.get("gem-panel-leaf")!.element;

      expect(mounted.apply({
        leaves: [{ leafId: "gem-panel-leaf", matrix: projectiveMatrix() }],
      }).leafTransformWrites).toBe(1);
      expect(element.style.transform).toContain("0.00390625");
    } finally {
      restoreUserAgent();
    }
  });

  it("preserves projective terms smaller than six decimal places", () => {
    const restoreUserAgent = overrideUserAgent(CHROME_UA);
    try {
      const fixture = createSolidQuadFixture();
      const leaf = fixture.render.leaves[0]!;
      const size = 10_000;
      const h = -40 / 10_040;
      leaf.width = size;
      leaf.height = size;
      const value = polyMorphIdentityMatrix();
      value[5] = 1 + h;
      value[7] = h / size;
      const mounted = mountPolyMorphModel(host, fixture);
      const element = mounted.leafHandles.get("gem-panel-leaf")!.element;

      mounted.apply({
        leaves: [{
          leafId: "gem-panel-leaf",
          matrix: value as typeof POLY_MORPH_IDENTITY_MATRIX,
        }],
      });

      const emitted = parsedMatrix(element);
      expect(emitted[7]).toBe(value[7]);
      const corner = applyMatrix(emitted, [size, size]);
      expect(corner[0]).toBeCloseTo(10_040, 10);
      expect(corner[1]).toBeCloseTo(10_000, 10);
    } finally {
      restoreUserAgent();
    }
  });

  it.each([
    ["Safari", SAFARI_UA],
    ["iOS Chrome", IOS_CHROME_UA],
    ["WKWebView", WKWEBVIEW_UA],
  ])("fails before mounting projective solid quads on %s", (_name, userAgent) => {
    const restoreUserAgent = overrideUserAgent(userAgent);
    try {
      const fixture = createSolidQuadFixture();
      fixture.render.leaves[0]!.matrix = projectiveMatrix();

      expect(() => mountPolyMorphModel(host, fixture))
        .toThrowError(PolyMorphRenderError);
      expect(host.childElementCount).toBe(0);
    } finally {
      restoreUserAgent();
    }
  });

  it("rejects projective solid quad updates on Safari before writes", () => {
    const restoreUserAgent = overrideUserAgent(SAFARI_UA);
    try {
      const mounted = mountPolyMorphModel(host, createSolidQuadFixture());
      const element = mounted.leafHandles.get("gem-panel-leaf")!.element;
      const transform = element.style.transform;
      const applyCount = mounted.stats.applyCount;

      expect(() => mounted.apply({
        leaves: [{ leafId: "gem-panel-leaf", matrix: projectiveMatrix() }],
      })).toThrowError(PolyMorphRenderError);
      expect(element.style.transform).toBe(transform);
      expect(mounted.stats.applyCount).toBe(applyCount);
    } finally {
      restoreUserAgent();
    }
  });

  it("rejects projective leaves on Safari regardless of topology arity", () => {
    const restoreUserAgent = overrideUserAgent(SAFARI_UA);
    try {
      const initial = createTwoLeafFixture();
      initial.render.leaves[1]!.matrix = projectiveMatrix();
      expect(() => mountPolyMorphModel(host, initial))
        .toThrowError(PolyMorphRenderError);
      expect(host.childElementCount).toBe(0);

      const mounted = mountPolyMorphModel(host, createTwoLeafFixture());
      const element = mounted.leafHandles.get("accent-panel-leaf")!.element;
      const transform = element.style.transform;
      const applyCount = mounted.stats.applyCount;
      expect(() => mounted.apply({
        leaves: [{ leafId: "accent-panel-leaf", matrix: projectiveMatrix() }],
      })).toThrowError(PolyMorphRenderError);
      expect(element.style.transform).toBe(transform);
      expect(mounted.stats.applyCount).toBe(applyCount);
    } finally {
      restoreUserAgent();
    }
  });

  it("checks the resolved fallback matrix before mounting on Safari", () => {
    const view = document.defaultView as Window & {
      CSS?: { supports(property: string, value: string): boolean };
    };
    const priorCss = view.CSS;
    Object.defineProperty(view, "CSS", {
      configurable: true,
      value: { supports: () => false },
    });
    const restoreUserAgent = overrideUserAgent(SAFARI_UA);
    try {
      const fixture = createSolidQuadFixture();
      const leaf = fixture.render.leaves[0]!;
      leaf.strategy = "solid-triangle";
      leaf.fallback = {
        width: 64,
        height: 64,
        matrixFromLeaf: projectiveMatrix(),
        atlas: {
          resourcePath: "assets/projective-fallback.png",
          x: 0,
          y: 0,
          width: 64,
          height: 64,
          pageWidth: 64,
          pageHeight: 64,
        },
      };

      expect(() => mountPolyMorphModel(host, fixture))
        .toThrowError(PolyMorphRenderError);
      expect(host.childElementCount).toBe(0);
      expect(document.defaultView!.URL.createObjectURL).not.toHaveBeenCalled();
    } finally {
      restoreUserAgent();
      Object.defineProperty(view, "CSS", {
        configurable: true,
        value: priorCss,
      });
    }
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
    const restoreUserAgent = overrideUserAgent(SAFARI_UA);
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
        matrixFromLeaf: [...POLY_MORPH_IDENTITY_MATRIX],
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
      const mounted = mountPolyMorphModel(host, fixture, {
        resources: imageResources([
          "assets/solid-triangles-000.png",
          "assets/solid-triangles-001.png",
        ]),
      });
      const leaves = [...mounted.leafHandles.values()].map(({ element }) => element);
      expect(leaves.every((element) => element.localName === "s")).toBe(true);
      expect(leaves.every((element) =>
        element.dataset.polyMorphResolvedStrategy === "atlas-slice"
        && element.style.backgroundColor === "currentcolor")).toBe(true);
      expect(leaves.map((element) =>
        element.style.getPropertyValue("mask-image"))).toEqual([
        'url("blob:test-1")',
        'url("blob:test-2")',
      ]);
      expect(leaves.map((element) =>
        element.style.getPropertyValue("-webkit-mask-image"))).toEqual([
        'url("blob:test-1")',
        'url("blob:test-2")',
      ]);
      expect(leaves.map((element) => [
        element.style.width,
        element.style.height,
      ])).toEqual([["7px", "5px"], ["11px", "9px"]]);
      expect(document.defaultView!.URL.createObjectURL).toHaveBeenCalledTimes(2);
      const translated = polyMorphIdentityMatrix();
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
      restoreUserAgent();
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
    const restoreUserAgent = overrideUserAgent(SAFARI_UA);
    try {
      expect(() =>
        mountPolyMorphModel(host, createPolyMorphModelFixture())
      ).toThrowError(PolyMorphRenderError);
      expect(host.childElementCount).toBe(0);
    } finally {
      restoreUserAgent();
      Object.defineProperty(view, "CSS", {
        configurable: true,
        value: priorCss,
      });
    }
  });

  it("keeps Firefox on the native border-triangle path", () => {
    const view = document.defaultView as Window & {
      CSS?: { supports(property: string, value: string): boolean };
    };
    const priorCss = view.CSS;
    Object.defineProperty(view, "CSS", {
      configurable: true,
      value: { supports: () => false },
    });
    const restoreUserAgent = overrideUserAgent(
      "Mozilla/5.0 Firefox/141.0",
    );
    try {
      const mounted = mountPolyMorphModel(host, createPolyMorphModelFixture());
      expect(mounted.leafHandles.get("gem-panel-leaf")!.element.localName).toBe("u");
      expect(document.defaultView!.URL.createObjectURL).not.toHaveBeenCalled();
    } finally {
      restoreUserAgent();
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
    const translated = polyMorphIdentityMatrix();
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
    const translated = polyMorphIdentityMatrix();
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
    const mounted = mountPolyMorphModel(host, fixture, {
      resources: imageResources(["assets/gem.webp"]),
    });
    const element = mounted.leafHandles.get("gem-panel-leaf")!.element;
    expect(element.localName).toBe("s");
    expect(element.style.width).toBe("4px");
    expect(element.style.height).toBe("4px");
    expect(element.style.backgroundImage).toContain("blob:test-1");
    expect(element.style.backfaceVisibility).toBe("visible");
    expect(document.defaultView!.URL.createObjectURL).toHaveBeenCalledOnce();

    expect(mounted.apply({
      leaves: [{ leafId: "gem-panel-leaf", atlasRow: 1 }],
    }).atlasRowWrites).toBe(1);
    expect(element.style.backgroundPosition).toBe("0px -4px");
    expect(() => mounted.apply({
      leaves: [{ leafId: "gem-panel-leaf", atlasRow: 2 }],
    })).toThrowError(PolyMorphRenderError);
    expect(mounted.stats.atlasConstructions).toBe(0);
    mounted.destroy();
    expect(document.defaultView!.URL.revokeObjectURL)
      .toHaveBeenCalledWith("blob:test-1");
  });

  it("rejects incomplete plans and unknown update handles", () => {
    const incomplete = clonePolyMorphFixture(createPolyMorphModelFixture());
    incomplete.render.leaves = [];
    expect(() => mountPolyMorphModel(host, incomplete)).toThrowError(PolyMorphContractError);
    expect(host.childElementCount).toBe(0);

    const mounted = mountPolyMorphModel(host, createTwoLeafFixture());
    expect(() => mounted.apply({
      shapes: [{ shapeId: "missing-shape", matrix: [...POLY_MORPH_IDENTITY_MATRIX] }],
    })).toThrowError(PolyMorphRenderError);
    expect(() => mounted.apply({
      leaves: [{ leafId: "missing-leaf", visible: false }],
    })).toThrowError(PolyMorphRenderError);

    const translated = polyMorphIdentityMatrix();
    translated[12] = 9;
    const accent = mounted.leafHandles.get("accent-panel-leaf")!.element;
    const before = accent.style.transform;
    const applyCount = mounted.stats.applyCount;
    expect(() => mounted.apply({
      leaves: [
        {
          leafId: "accent-panel-leaf",
          matrix: translated as typeof POLY_MORPH_IDENTITY_MATRIX,
        },
        { leafId: "gem-panel-leaf", atlasRow: 1 },
      ],
    })).toThrowError(PolyMorphRenderError);
    expect(accent.style.transform).toBe(before);
    expect(mounted.stats.applyCount).toBe(applyCount);
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
      expect(host.style.position).toBe("relative");
      mounted.apply({});
      expect(requestFrame).not.toHaveBeenCalled();
      mounted.destroy();
      mounted.destroy();
      expect(mounted.destroyed).toBe(true);
      expect(host.childElementCount).toBe(0);
      expect(host.style.position).toBe("");
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
