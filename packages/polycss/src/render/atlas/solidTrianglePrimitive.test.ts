/**
 * Feature tests: solid triangle primitive dispatch (border vs corner-bevel)
 *
 * Covers the resolveSolidTrianglePrimitive observable result via the public
 * renderPolygonsWithStableTriangles API — whether the element gets the
 * polycss-corner-triangle class (corner-bevel) or not (border).
 *
 * We also verify the dispatch from renderPolygonsWithTextureAtlas:
 * triangles use the cheapest supported primitive and fall through correctly.
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "@layoutit/polycss-core";
import { renderPolygonsWithStableTriangles } from "./stableTriangle";
import { renderPolygonsWithTextureAtlas } from "./renderPolygons";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(options: {
  cornerShape?: boolean;
  solidTriangleSupported?: boolean;
  borderShape?: boolean;
} = {}): Document {
  const solidTriangleOk = options.solidTriangleSupported !== false;
  return {
    defaultView: {
      navigator: {
        // Safari UA → solid triangles NOT supported (compositing bug)
        userAgent: solidTriangleOk
          ? "Mozilla/5.0 Chrome/120"
          : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      },
      CSS: {
        supports: (property: string, value?: string) => {
          if (property === "border-shape") return options.borderShape === true;
          if (property.startsWith("corner-") && value === "bevel") return options.cornerShape === true;
          return false;
        },
      },
      matchMedia: (query: string) => ({
        matches: query.includes("pointer: fine") || query.includes("hover: hover"),
      }),
    },
    createElement(tagName: string) {
      return document.createElement(tagName);
    },
  } as unknown as Document;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRIANGLE: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  color: "#ff0000",
};

const TRIANGLE_2: Polygon = {
  vertices: [[1, 0, 0], [2, 0, 0], [1, 1, 0]],
  color: "#00ff00",
};

// ---------------------------------------------------------------------------
// Tests: corner-bevel vs border primitive selection
// ---------------------------------------------------------------------------

describe("solid triangle primitive — corner-bevel vs border", () => {
  it("corner-shape supported → polycss-corner-triangle class is present", () => {
    const doc = makeDoc({ cornerShape: true });
    const result = renderPolygonsWithStableTriangles([TRIANGLE], { doc });
    expect(result).not.toBeNull();
    expect(result!.rendered[0].element.classList.contains("polycss-corner-triangle")).toBe(true);
    result!.dispose();
  });

  it("corner-shape NOT supported → polycss-corner-triangle class is absent", () => {
    const doc = makeDoc({ cornerShape: false });
    const result = renderPolygonsWithStableTriangles([TRIANGLE], { doc });
    expect(result).not.toBeNull();
    expect(result!.rendered[0].element.classList.contains("polycss-corner-triangle")).toBe(false);
    result!.dispose();
  });

  it("Safari UA → renderPolygonsWithStableTriangles returns null (solid triangles unsupported)", () => {
    const doc = makeDoc({ solidTriangleSupported: false });
    const result = renderPolygonsWithStableTriangles([TRIANGLE], { doc });
    expect(result).toBeNull();
  });

  it("Safari UA → triangle falls through to atlas <s> via renderPolygonsWithTextureAtlas", () => {
    const doc = makeDoc({ solidTriangleSupported: false, borderShape: false });
    const result = renderPolygonsWithTextureAtlas([TRIANGLE], { doc });
    // Safari: u not supported, i disabled (no border-shape), falls to s
    const tags: Record<string, number> = { b: 0, i: 0, s: 0, u: 0 };
    for (const { element } of result.rendered) {
      const tag = element.tagName.toLowerCase();
      tags[tag] = (tags[tag] ?? 0) + 1;
    }
    expect(tags.u).toBe(0);
    expect(tags.s).toBe(1);
    result.dispose();
  });
});

// ---------------------------------------------------------------------------
// Tests: strategy disable interactions with triangle primitive
// ---------------------------------------------------------------------------

describe("solid triangle primitive — strategy disable interactions", () => {
  it("disabling u → triangle goes to <i> when border-shape is supported", () => {
    const doc = makeDoc({ borderShape: true, cornerShape: false });
    const result = renderPolygonsWithTextureAtlas([TRIANGLE], {
      doc,
      strategies: { disable: ["u"] },
    });
    const tags: Record<string, number> = { b: 0, i: 0, s: 0, u: 0 };
    for (const { element } of result.rendered) {
      const tag = element.tagName.toLowerCase();
      tags[tag] = (tags[tag] ?? 0) + 1;
    }
    expect(tags.u).toBe(0);
    expect(tags.i).toBe(1);
    result.dispose();
  });

  it("disabling u and i → triangle falls to atlas <s>", () => {
    const doc = makeDoc({ borderShape: false, cornerShape: false });
    const result = renderPolygonsWithTextureAtlas([TRIANGLE], {
      doc,
      strategies: { disable: ["u", "i"] },
    });
    const tags: Record<string, number> = { b: 0, i: 0, s: 0, u: 0 };
    for (const { element } of result.rendered) {
      const tag = element.tagName.toLowerCase();
      tags[tag] = (tags[tag] ?? 0) + 1;
    }
    expect(tags.u).toBe(0);
    expect(tags.i).toBe(0);
    expect(tags.s).toBe(1);
    result.dispose();
  });

  it("renderPolygonsWithStableTriangles returns null when u is disabled", () => {
    const doc = makeDoc({ cornerShape: true });
    const result = renderPolygonsWithStableTriangles([TRIANGLE], {
      doc,
      strategies: { disable: ["u"] },
    });
    expect(result).toBeNull();
  });

  it("multiple triangles: all get the same primitive class consistently", () => {
    const doc = makeDoc({ cornerShape: true });
    const result = renderPolygonsWithStableTriangles([TRIANGLE, TRIANGLE_2], { doc });
    expect(result).not.toBeNull();
    for (const { element } of result!.rendered) {
      expect(element.classList.contains("polycss-corner-triangle")).toBe(true);
    }
    result!.dispose();
  });
});
