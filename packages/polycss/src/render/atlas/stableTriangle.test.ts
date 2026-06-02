/**
 * Feature tests: stable triangle DOM operations
 *
 * Covers renderPolygonsWithStableTriangles, updatePolygonsWithStableTriangles,
 * and updateStableTriangleFrame.
 *
 * The key contracts:
 * - renderPolygonsWithStableTriangles emits one <u> per triangle.
 * - When "u" strategy is disabled, renderPolygonsWithStableTriangles returns null.
 * - updatePolygonsWithStableTriangles updates transform in-place without re-mounting.
 * - updateStableTriangleFrame requires optimizeStableTriangleStyle=true to return true.
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "@layoutit/polycss-core";
import {
  renderPolygonsWithStableTriangles,
  updatePolygonsWithStableTriangles,
} from "./stableTriangle";
import { updateStableTriangleFrame } from "./renderPolygons";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(options: { cornerShape?: boolean } = {}): Document {
  return {
    defaultView: {
      navigator: { userAgent: "Mozilla/5.0 Chrome/120" },
      CSS: {
        supports: (property: string, value?: string) => {
          if (property.startsWith("corner-") && value === "bevel") return options.cornerShape === true;
          return false;
        },
      },
      matchMedia: () => ({ matches: false }),
    },
    createElement(tagName: string) {
      return document.createElement(tagName);
    },
  } as unknown as Document;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRIANGLE_A: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  color: "#ff0000",
};

const TRIANGLE_B: Polygon = {
  vertices: [[1, 0, 0], [2, 0, 0], [1, 1, 0]],
  color: "#00ff00",
};

const ADJACENT_TRIANGLE_A: Polygon = {
  vertices: [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
  color: "#ff0000",
};

const MOVED_TRIANGLE_A: Polygon = {
  vertices: [[0.1, 0, 0], [1.1, 0, 0], [0.1, 1, 0]],
  color: "#ff0000",
};

// ---------------------------------------------------------------------------
// Tests: renderPolygonsWithStableTriangles
// ---------------------------------------------------------------------------

describe("renderPolygonsWithStableTriangles — initial render", () => {
  it("returns null when u strategy is disabled", () => {
    const doc = makeDoc();
    const result = renderPolygonsWithStableTriangles([TRIANGLE_A], {
      doc,
      strategies: { disable: ["u"] },
    });
    expect(result).toBeNull();
  });

  it("returns null when any polygon has a texture", () => {
    const doc = makeDoc();
    const textured: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      texture: "https://example.com/t.png",
      color: "#fff",
    };
    const result = renderPolygonsWithStableTriangles([TRIANGLE_A, textured], { doc });
    expect(result).toBeNull();
  });

  it("returns null when any polygon is not a triangle", () => {
    const doc = makeDoc();
    const quad: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      color: "#ff0000",
    };
    const result = renderPolygonsWithStableTriangles([TRIANGLE_A, quad], { doc });
    expect(result).toBeNull();
  });

  it("emits one <u> leaf per triangle", () => {
    const doc = makeDoc();
    const result = renderPolygonsWithStableTriangles([TRIANGLE_A, TRIANGLE_B], { doc });
    expect(result).not.toBeNull();
    expect(result!.rendered.length).toBe(2);
    for (const { element } of result!.rendered) {
      expect(element.tagName.toLowerCase()).toBe("u");
    }
    result!.dispose();
  });

  it("each rendered poly has kind=triangle", () => {
    const doc = makeDoc();
    const result = renderPolygonsWithStableTriangles([TRIANGLE_A], { doc });
    expect(result!.rendered[0].kind).toBe("triangle");
    result!.dispose();
  });

  it("each leaf has a transform style with matrix3d", () => {
    const doc = makeDoc();
    const result = renderPolygonsWithStableTriangles([TRIANGLE_A], { doc });
    const el = result!.rendered[0].element;
    expect(el.style.transform).toContain("matrix3d(");
    result!.dispose();
  });

  it("applies internal seam bleed to detected shared triangle edges", () => {
    const doc = makeDoc();
    const baseA = renderPolygonsWithStableTriangles([TRIANGLE_A], { doc })!;
    const baseB = renderPolygonsWithStableTriangles([ADJACENT_TRIANGLE_A], { doc })!;
    const bleed = renderPolygonsWithStableTriangles([TRIANGLE_A, ADJACENT_TRIANGLE_A], { doc })!;
    expect(bleed.rendered[0].element.style.transform)
      .not.toBe(baseA.rendered[0].element.style.transform);
    expect(bleed.rendered[1].element.style.transform)
      .not.toBe(baseB.rendered[0].element.style.transform);
    baseA.dispose();
    baseB.dispose();
    bleed.dispose();
  });

  it("leaves corner-shape triangle paint to base CSS when supported", () => {
    const doc = makeDoc({ cornerShape: true });
    const result = renderPolygonsWithStableTriangles([TRIANGLE_A], { doc });
    expect(result).not.toBeNull();
    const el = result!.rendered[0].element;
    expect(el.className).toBe("");
    expect(el.style.getPropertyValue("corner-top-left-shape")).toBe("");
    expect(el.style.backgroundColor).toBe("");
    expect(el.style.borderWidth).toBe("");
    result!.dispose();
  });

  it("keeps border-triangle paint classless when corner-shape is unsupported", () => {
    const doc = makeDoc({ cornerShape: false });
    const result = renderPolygonsWithStableTriangles([TRIANGLE_A], { doc });
    const el = result!.rendered[0].element;
    expect(el.className).toBe("");
    expect(el.style.getPropertyValue("corner-top-left-shape")).toBe("");
    result!.dispose();
  });
});

// ---------------------------------------------------------------------------
// Tests: updatePolygonsWithStableTriangles
// ---------------------------------------------------------------------------

describe("updatePolygonsWithStableTriangles — in-place update", () => {
  it("returns null when u strategy is disabled", () => {
    const doc = makeDoc();
    const initial = renderPolygonsWithStableTriangles([TRIANGLE_A], { doc })!;
    const updated = updatePolygonsWithStableTriangles(initial.rendered, [MOVED_TRIANGLE_A], {
      doc,
      strategies: { disable: ["u"] },
    });
    expect(updated).toBeNull();
    initial.dispose();
  });

  it("returns null when rendered contains non-triangle kinds", () => {
    const doc = makeDoc();
    const fakeRendered = [{
      polygonIndex: 0,
      element: document.createElement("b"),
      kind: "solid" as const,
      dispose: () => {},
    }];
    const result = updatePolygonsWithStableTriangles(fakeRendered, [TRIANGLE_A], { doc });
    expect(result).toBeNull();
  });

  it("returns null when polygon count mismatches rendered count", () => {
    const doc = makeDoc();
    const initial = renderPolygonsWithStableTriangles([TRIANGLE_A, TRIANGLE_B], { doc })!;
    const result = updatePolygonsWithStableTriangles(initial.rendered, [TRIANGLE_A], { doc });
    expect(result).toBeNull();
    initial.dispose();
  });

  it("returns the same rendered array (no remount)", () => {
    const doc = makeDoc();
    const initial = renderPolygonsWithStableTriangles([TRIANGLE_A], { doc })!;
    const originalElement = initial.rendered[0].element;
    const updated = updatePolygonsWithStableTriangles(
      initial.rendered,
      [MOVED_TRIANGLE_A],
      { doc },
    );
    expect(updated).not.toBeNull();
    expect(updated!.rendered[0].element).toBe(originalElement); // same DOM node
    initial.dispose();
  });

  it("updates the transform on the leaf after update", () => {
    const doc = makeDoc();
    const initial = renderPolygonsWithStableTriangles([TRIANGLE_A], { doc })!;
    const beforeTransform = initial.rendered[0].element.style.transform;
    updatePolygonsWithStableTriangles(initial.rendered, [MOVED_TRIANGLE_A], { doc });
    const afterTransform = initial.rendered[0].element.style.transform;
    // Transform should change when polygon moves
    expect(afterTransform).not.toBe(beforeTransform);
    initial.dispose();
  });
});

// ---------------------------------------------------------------------------
// Tests: updateStableTriangleFrame
// ---------------------------------------------------------------------------

describe("updateStableTriangleFrame — frame-data fast path", () => {
  it("returns false when optimizeStableTriangleStyle is not enabled", () => {
    const doc = makeDoc();
    const initial = renderPolygonsWithStableTriangles([TRIANGLE_A], { doc })!;
    const frame = {
      polygonCount: 1,
      vertices: new Float32Array(9).fill(0),
    };
    const result = updateStableTriangleFrame(initial.rendered, [TRIANGLE_A], frame, { doc });
    expect(result).toBe(false);
    initial.dispose();
  });

  it("returns false when polygon count mismatches frame polygonCount", () => {
    const doc = makeDoc();
    const initial = renderPolygonsWithStableTriangles([TRIANGLE_A, TRIANGLE_B], { doc })!;
    const frame = {
      polygonCount: 1, // wrong count
      vertices: new Float32Array(9).fill(0),
    };
    const result = updateStableTriangleFrame(
      initial.rendered,
      [TRIANGLE_A, TRIANGLE_B],
      frame,
      { doc, ...(({ optimizeStableTriangleStyle: true }) as Record<string, unknown>) },
    );
    expect(result).toBe(false);
    initial.dispose();
  });

  it("returns true and updates transforms when optimizeStableTriangleStyle=true", () => {
    const doc = makeDoc();
    const options = {
      doc,
      // Cast through unknown to set internal option
      ...(({ optimizeStableTriangleStyle: true }) as Record<string, unknown>),
    };
    const initial = renderPolygonsWithStableTriangles([TRIANGLE_A], { doc })!;
    const v = TRIANGLE_A.vertices;
    // Frame vertices: [x0,y0,z0, x1,y1,z1, x2,y2,z2]
    const vertices = new Float32Array([
      v[0][0], v[0][1], v[0][2],
      v[1][0], v[1][1], v[1][2],
      v[2][0], v[2][1], v[2][2],
    ]);
    const frame = { polygonCount: 1, vertices };
    const result = updateStableTriangleFrame(
      initial.rendered,
      [TRIANGLE_A],
      frame,
      options as Parameters<typeof updateStableTriangleFrame>[3],
    );
    expect(result).toBe(true);
    initial.dispose();
  });
});
