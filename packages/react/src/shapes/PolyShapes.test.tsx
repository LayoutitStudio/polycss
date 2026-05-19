import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
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

function renderShape(shape: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        PolyCamera,
        {},
        React.createElement(PolyScene, {}, shape),
      ),
    ),
  );
  return container;
}

function hasLeaves(container: HTMLElement): boolean {
  return container.querySelectorAll("i,b,s,u").length > 0;
}

describe("PolyBox", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(<PolyBox size={100} color="#ff6644" />);
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyPlane", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(<PolyPlane axis={2} size={50} color="#cccccc" />);
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyRing", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(<PolyRing axis={2} radius={50} segments={8} />);
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyOctahedron", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(<PolyOctahedron center={[0, 0, 0]} size={50} />);
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyTetrahedron", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(<PolyTetrahedron size={100} color="#aabb00" />);
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyIcosahedron", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(<PolyIcosahedron size={80} color="#8800ff" />);
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyDodecahedron", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(<PolyDodecahedron size={80} color="#ff88cc" />);
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyCylinder", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(<PolyCylinder radius={40} height={80} radialSegments={6} />);
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyCone", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(<PolyCone radius={40} height={80} radialSegments={6} />);
    expect(hasLeaves(container)).toBe(true);
  });
});

describe("PolyTorus", () => {
  it("renders leaf DOM inside PolyCamera > PolyScene", () => {
    const container = renderShape(
      <PolyTorus radius={40} tube={10} radialSegments={4} tubularSegments={6} />,
    );
    expect(hasLeaves(container)).toBe(true);
  });
});
