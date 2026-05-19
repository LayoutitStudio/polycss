import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h } from "vue";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "../scene/PolyScene";
import {
  PolyBox,
  PolyPlane,
  PolyRing,
  PolyOctahedron,
  PolyTetrahedron,
  PolyIcosahedron,
  PolyDodecahedron,
  PolyCylinder,
  PolyCone,
  PolyTorus,
} from "./PolyShapes";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function renderShape(shapeVNode: ReturnType<typeof h>): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(PolyCamera, {}, {
          default: () =>
            h(PolyScene, {}, {
              default: () => shapeVNode,
            }),
        });
    },
  });
  app.mount(container);
  return container;
}

function hasLeaves(container: HTMLElement): boolean {
  return container.querySelectorAll("i,b,s,u").length > 0;
}

describe("PolyBox (Vue)", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(h(PolyBox, { size: 100, color: "#ff6644" }));
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyPlane (Vue)", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(h(PolyPlane, { axis: 2, size: 50, color: "#cccccc" }));
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyRing (Vue)", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(h(PolyRing, { axis: 2, radius: 50, segments: 8 }));
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyOctahedron (Vue)", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(
      h(PolyOctahedron, { center: [0, 0, 0], size: 50, color: "#aabbcc" }),
    );
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyTetrahedron (Vue)", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(h(PolyTetrahedron, { size: 100, color: "#aabb00" }));
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyIcosahedron (Vue)", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(h(PolyIcosahedron, { size: 80, color: "#8800ff" }));
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyDodecahedron (Vue)", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(h(PolyDodecahedron, { size: 80, color: "#ff88cc" }));
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyCylinder (Vue)", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(
      h(PolyCylinder, { radius: 40, height: 80, radialSegments: 6 }),
    );
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyCone (Vue)", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(
      h(PolyCone, { radius: 40, height: 80, radialSegments: 6 }),
    );
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyTorus (Vue)", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(
      h(PolyTorus, { radius: 40, tube: 10, radialSegments: 4, tubularSegments: 6 }),
    );
    expect(hasLeaves(container)).toBe(true);
  });
});
