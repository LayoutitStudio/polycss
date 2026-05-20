/**
 * Tests for primitive shape custom elements — verify registration and that
 * mounting inside a <poly-scene> produces leaf DOM nodes.
 */
import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { PolySceneElement } from "./PolySceneElement";
import {
  PolyBoxElement,
  PolyPlaneElement,
  PolyRingElement,
  PolyOctahedronElement,
  PolySphereElement,
  PolyTetrahedronElement,
  PolyIcosahedronElement,
  PolyDodecahedronElement,
  PolyCylinderElement,
  PolyConeElement,
  PolyTorusElement,
} from "./PolyShapeElements";

beforeAll(() => {
  if (!customElements.get("poly-scene")) {
    customElements.define("poly-scene", PolySceneElement);
  }
  if (!customElements.get("poly-box")) {
    customElements.define("poly-box", PolyBoxElement);
  }
  if (!customElements.get("poly-plane")) {
    customElements.define("poly-plane", PolyPlaneElement);
  }
  if (!customElements.get("poly-ring")) {
    customElements.define("poly-ring", PolyRingElement);
  }
  if (!customElements.get("poly-octahedron")) {
    customElements.define("poly-octahedron", PolyOctahedronElement);
  }
  if (!customElements.get("poly-tetrahedron")) {
    customElements.define("poly-tetrahedron", PolyTetrahedronElement);
  }
  if (!customElements.get("poly-sphere")) {
    customElements.define("poly-sphere", PolySphereElement);
  }
  if (!customElements.get("poly-icosahedron")) {
    customElements.define("poly-icosahedron", PolyIcosahedronElement);
  }
  if (!customElements.get("poly-dodecahedron")) {
    customElements.define("poly-dodecahedron", PolyDodecahedronElement);
  }
  if (!customElements.get("poly-cylinder")) {
    customElements.define("poly-cylinder", PolyCylinderElement);
  }
  if (!customElements.get("poly-cone")) {
    customElements.define("poly-cone", PolyConeElement);
  }
  if (!customElements.get("poly-torus")) {
    customElements.define("poly-torus", PolyTorusElement);
  }
});

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  if (host.parentNode) host.parentNode.removeChild(host);
});

function mountInScene(tag: string, attrs: Record<string, string> = {}): PolySceneElement {
  // Append scene to host FIRST so its connectedCallback fires before children.
  const scene = document.createElement("poly-scene") as PolySceneElement;
  host.appendChild(scene);
  // Then add the shape element — it finds a ready scene via getScene().
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  scene.appendChild(el);
  return scene;
}

describe("registration", () => {
  it("registers poly-box", () => {
    expect(customElements.get("poly-box")).toBe(PolyBoxElement);
  });
  it("registers poly-plane", () => {
    expect(customElements.get("poly-plane")).toBe(PolyPlaneElement);
  });
  it("registers poly-ring", () => {
    expect(customElements.get("poly-ring")).toBe(PolyRingElement);
  });
  it("registers poly-octahedron", () => {
    expect(customElements.get("poly-octahedron")).toBe(PolyOctahedronElement);
  });
  it("registers poly-tetrahedron", () => {
    expect(customElements.get("poly-tetrahedron")).toBe(PolyTetrahedronElement);
  });
  it("registers poly-sphere", () => {
    expect(customElements.get("poly-sphere")).toBe(PolySphereElement);
  });
  it("registers poly-icosahedron", () => {
    expect(customElements.get("poly-icosahedron")).toBe(PolyIcosahedronElement);
  });
  it("registers poly-dodecahedron", () => {
    expect(customElements.get("poly-dodecahedron")).toBe(PolyDodecahedronElement);
  });
  it("registers poly-cylinder", () => {
    expect(customElements.get("poly-cylinder")).toBe(PolyCylinderElement);
  });
  it("registers poly-cone", () => {
    expect(customElements.get("poly-cone")).toBe(PolyConeElement);
  });
  it("registers poly-torus", () => {
    expect(customElements.get("poly-torus")).toBe(PolyTorusElement);
  });
});

describe("leaf DOM production", () => {
  it("poly-box produces leaf nodes inside poly-scene", () => {
    const scene = mountInScene("poly-box", { size: "100", color: "#ff6644" });
    expect(scene.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
  });

  it("poly-plane produces leaf nodes inside poly-scene", () => {
    const scene = mountInScene("poly-plane", { axis: "2", size: "50", color: "#cccccc" });
    expect(scene.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
  });

  it("poly-ring produces leaf nodes inside poly-scene", () => {
    const scene = mountInScene("poly-ring", { axis: "2", radius: "50", segments: "8" });
    expect(scene.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
  });

  it("poly-octahedron produces leaf nodes inside poly-scene", () => {
    const scene = mountInScene("poly-octahedron", { size: "50", color: "#aabbcc" });
    expect(scene.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
  });

  it("poly-tetrahedron produces leaf nodes inside poly-scene", () => {
    const scene = mountInScene("poly-tetrahedron", { size: "100" });
    expect(scene.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
  });

  it("poly-sphere produces leaf nodes inside poly-scene", () => {
    const scene = mountInScene("poly-sphere", { radius: "50", subdivisions: "1" });
    expect(scene.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
  });

  it("poly-icosahedron produces leaf nodes inside poly-scene", () => {
    const scene = mountInScene("poly-icosahedron", { size: "80" });
    expect(scene.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
  });

  it("poly-dodecahedron produces leaf nodes inside poly-scene", () => {
    const scene = mountInScene("poly-dodecahedron", { size: "80" });
    expect(scene.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
  });

  it("poly-cylinder produces leaf nodes inside poly-scene", () => {
    const scene = mountInScene("poly-cylinder", { radius: "40", height: "80", "radial-segments": "6" });
    expect(scene.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
  });

  it("poly-cone produces leaf nodes inside poly-scene", () => {
    const scene = mountInScene("poly-cone", { radius: "40", height: "80", "radial-segments": "6" });
    expect(scene.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
  });

  it("poly-torus produces leaf nodes inside poly-scene", () => {
    const scene = mountInScene("poly-torus", { radius: "40", tube: "10", "radial-segments": "4", "tubular-segments": "6" });
    expect(scene.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
  });

  it("noop when no poly-scene ancestor exists", () => {
    const el = document.createElement("poly-box");
    el.setAttribute("size", "100");
    host.appendChild(el);
    expect(host.querySelectorAll("i,b,s,u").length).toBe(0);
  });

  it("disposes mesh on disconnect", () => {
    const scene = mountInScene("poly-box", { size: "100" });
    const el = scene.querySelector("poly-box")!;
    expect(scene.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
    scene.removeChild(el);
    expect(scene.querySelectorAll(".polycss-mesh").length).toBe(0);
  });
});
