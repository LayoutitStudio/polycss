import { describe, it, expect } from "vitest";
import {
  createPolyBox,
  createPolyPlane,
  createPolyRing,
  createPolyOctahedron,
  createPolyTetrahedron,
  createPolyIcosahedron,
  createPolyDodecahedron,
  createPolyCylinder,
  createPolyCone,
  createPolyTorus,
} from "./createPolyShapes";

describe("createPolyBox", () => {
  it("returns 6 faces for a default box", () => {
    expect(createPolyBox().polygons).toHaveLength(6);
  });

  it("forwards size to boxPolygons", () => {
    const result = createPolyBox({ size: 100 });
    expect(result.polygons).toHaveLength(6);
    expect(result.polygons[0].vertices[0][0]).toBeCloseTo(50);
  });
});

describe("createPolyPlane", () => {
  it("returns 1 polygon for the XY plane", () => {
    const result = createPolyPlane({ axis: 2, size: 10 });
    expect(result.polygons).toHaveLength(1);
    expect(result.polygons[0].vertices).toHaveLength(4);
  });
});

describe("createPolyRing", () => {
  it("returns segments polygons at default 32 segments", () => {
    const result = createPolyRing({ axis: 2, radius: 50 });
    expect(result.polygons).toHaveLength(32);
  });

  it("respects custom segment count", () => {
    const result = createPolyRing({ axis: 2, radius: 50, segments: 8 });
    expect(result.polygons).toHaveLength(8);
  });
});

describe("createPolyOctahedron", () => {
  it("returns 8 triangular faces", () => {
    const result = createPolyOctahedron({ center: [0, 0, 0], size: 50 });
    expect(result.polygons).toHaveLength(8);
    expect(result.polygons[0].vertices).toHaveLength(3);
  });
});

describe("createPolyTetrahedron", () => {
  it("returns 4 triangular faces", () => {
    expect(createPolyTetrahedron().polygons).toHaveLength(4);
  });

  it("forwards size", () => {
    const result = createPolyTetrahedron({ size: 200 });
    expect(result.polygons).toHaveLength(4);
  });
});

describe("createPolyIcosahedron", () => {
  it("returns 20 triangular faces", () => {
    expect(createPolyIcosahedron().polygons).toHaveLength(20);
  });
});

describe("createPolyDodecahedron", () => {
  it("returns 12 pentagonal faces", () => {
    const result = createPolyDodecahedron();
    expect(result.polygons).toHaveLength(12);
    expect(result.polygons[0].vertices).toHaveLength(5);
  });
});

describe("createPolyCylinder", () => {
  it("returns 3 × radialSegments polygons at default 12 segments (12 sides + 12 bottom + 12 top)", () => {
    // default: 12 sides + 12 bottom cap + 12 top cap = 36
    expect(createPolyCylinder().polygons).toHaveLength(36);
  });

  it("respects radialSegments", () => {
    const result = createPolyCylinder({ radialSegments: 6 });
    // 6 sides + 6 bottom + 6 top = 18
    expect(result.polygons).toHaveLength(18);
  });
});

describe("createPolyCone", () => {
  it("returns 2 × radialSegments polygons at default 12 segments (12 sides + 12 base, no top cap)", () => {
    // default: 12 sides + 12 bottom cap = 24 (radiusTop=0 → no top cap)
    expect(createPolyCone().polygons).toHaveLength(24);
  });
});

describe("createPolyTorus", () => {
  it("returns radialSegments × tubularSegments quads at defaults (12 × 16 = 192)", () => {
    expect(createPolyTorus().polygons).toHaveLength(192);
  });

  it("respects custom segment counts", () => {
    const result = createPolyTorus({ radialSegments: 4, tubularSegments: 6 });
    expect(result.polygons).toHaveLength(24);
  });
});
