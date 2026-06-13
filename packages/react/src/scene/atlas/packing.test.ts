/**
 * Feature tests: packTextureAtlasPlansWithScale wrapper (React atlasBrowser copy)
 *
 * Mirrors PolyCSS's atlasPacking.test.ts.
 * Imports from the React-local copy so drift surfaces immediately.
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "@layoutit/polycss-core";
import { computeTextureAtlasPlanPublic } from "@layoutit/polycss-core";
import { packTextureAtlasPlansWithScale, isMobileDocument } from "./packing";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(options: { pointer?: "fine" | "coarse" } = {}): Document {
  const pointer = options.pointer ?? "fine";
  return {
    defaultView: {
      navigator: { userAgent: "Mozilla/5.0 Chrome/120" },
      CSS: { supports: () => false },
      matchMedia: (query: string) => ({
        matches: pointer === "fine"
          ? (query.includes("pointer: fine") || query.includes("hover: hover"))
          : (query.includes("pointer: coarse") || query.includes("hover: none")),
      }),
    },
  } as unknown as Document;
}

// ---------------------------------------------------------------------------
// Polygon fixtures
// ---------------------------------------------------------------------------

const TEXTURED_QUAD_A: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
  texture: "https://example.com/a.png",
  color: "#ffffff",
};

const TEXTURED_QUAD_B: Polygon = {
  vertices: [[2, 0, 0], [4, 0, 0], [4, 2, 0], [2, 2, 0]],
  texture: "https://example.com/b.png",
  color: "#cccccc",
};

const TEXTURED_RECT: Polygon = {
  vertices: [[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0]],
  texture: "https://example.com/rect.png",
  color: "#ffffff",
};

// ---------------------------------------------------------------------------
// isMobileDocument
// ---------------------------------------------------------------------------

describe("isMobileDocument — device-class detection", () => {
  it("returns false for null doc", () => {
    expect(isMobileDocument(null)).toBe(false);
  });

  it("returns false for a fine-pointer desktop doc", () => {
    expect(isMobileDocument(makeDoc({ pointer: "fine" }))).toBe(false);
  });

  it("returns true for a coarse-pointer mobile doc", () => {
    expect(isMobileDocument(makeDoc({ pointer: "coarse" }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// packTextureAtlasPlansWithScale — output structure
// ---------------------------------------------------------------------------

describe("packTextureAtlasPlansWithScale — packing output structure", () => {
  it("entries array length matches the input plans array length", () => {
    const plans = [
      computeTextureAtlasPlanPublic(TEXTURED_QUAD_A, 0),
      computeTextureAtlasPlanPublic(TEXTURED_QUAD_B, 1),
    ];
    const { packed } = packTextureAtlasPlansWithScale(plans, 1, makeDoc());
    expect(packed.entries.length).toBe(2);
  });

  it("textured plan entries are non-null and carry x/y/pageIndex", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD_A, 0);
    const { packed } = packTextureAtlasPlansWithScale([plan], 1, makeDoc());
    const entry = packed.entries[0];
    expect(entry).not.toBeNull();
    expect(typeof entry!.x).toBe("number");
    expect(typeof entry!.y).toBe("number");
    expect(typeof entry!.pageIndex).toBe("number");
  });

  it("null plans at their index positions remain null in output entries", () => {
    const planA = computeTextureAtlasPlanPublic(TEXTURED_QUAD_A, 0);
    const planB = computeTextureAtlasPlanPublic(TEXTURED_QUAD_B, 2);
    const { packed } = packTextureAtlasPlansWithScale([planA, null, planB], 1, makeDoc());
    expect(packed.entries[0]).not.toBeNull();
    expect(packed.entries[1]).toBeNull();
    expect(packed.entries[2]).not.toBeNull();
  });

  it("packed entries have non-overlapping positions on the same page", () => {
    const plans = [
      computeTextureAtlasPlanPublic(TEXTURED_QUAD_A, 0),
      computeTextureAtlasPlanPublic(TEXTURED_QUAD_B, 1),
    ];
    const { packed } = packTextureAtlasPlansWithScale(plans, 1, makeDoc());
    const samePageEntries = packed.entries.filter(
      (e) => e && packed.entries[0] && e.pageIndex === packed.entries[0]!.pageIndex,
    );
    if (samePageEntries.length >= 2) {
      const [a, b] = samePageEntries as NonNullable<typeof samePageEntries[0]>[];
      const aRight = a.x + a.canvasW;
      const bRight = b.x + b.canvasW;
      const aBottom = a.y + a.canvasH;
      const bBottom = b.y + b.canvasH;
      const nonOverlap =
        aRight <= b.x || bRight <= a.x || aBottom <= b.y || bBottom <= a.y;
      expect(nonOverlap).toBe(true);
    }
  });

  it("page dimensions are at least as large as the largest entry extent", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD_A, 0);
    const { packed } = packTextureAtlasPlansWithScale([plan], 1, makeDoc());
    const entry = packed.entries[0]!;
    const page = packed.pages[entry.pageIndex];
    expect(page.width).toBeGreaterThanOrEqual(entry.x + entry.canvasW);
    expect(page.height).toBeGreaterThanOrEqual(entry.y + entry.canvasH);
  });
});

// ---------------------------------------------------------------------------
// packTextureAtlasPlansWithScale — scale and canonical size
// ---------------------------------------------------------------------------

describe("packTextureAtlasPlansWithScale — scale and canonical size", () => {
  it("numeric quality 0.5 produces atlasScale = 0.5", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD_A, 0);
    const { atlasScale } = packTextureAtlasPlansWithScale([plan], 0.5, makeDoc());
    expect(atlasScale).toBeCloseTo(0.5);
  });

  it("numeric quality clamps below 0.1 to 0.1", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD_A, 0);
    const { atlasScale } = packTextureAtlasPlansWithScale([plan], 0.001, makeDoc());
    expect(atlasScale).toBeCloseTo(0.1);
  });

  it("numeric quality clamps above 1 to 1", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD_A, 0);
    const { atlasScale } = packTextureAtlasPlansWithScale([plan], 999, makeDoc());
    expect(atlasScale).toBeCloseTo(1);
  });

  it("explicit numeric quality produces canonical size of 64px", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD_A, 0);
    const { atlasCanonicalSize } = packTextureAtlasPlansWithScale([plan], 0.5, makeDoc());
    expect(atlasCanonicalSize).toBe(64);
  });

  it("auto quality on desktop produces canonical size of 128px", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD_A, 0);
    const { atlasCanonicalSize } = packTextureAtlasPlansWithScale(
      [plan],
      "auto",
      makeDoc({ pointer: "fine" }),
    );
    expect(atlasCanonicalSize).toBe(128);
  });

  it("auto quality on mobile produces canonical size of 64px", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD_A, 0);
    const { atlasCanonicalSize } = packTextureAtlasPlansWithScale(
      [plan],
      "auto",
      makeDoc({ pointer: "coarse" }),
    );
    expect(atlasCanonicalSize).toBe(64);
  });

  it("atlasMatrix is set on entries when canonical size is applied", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_QUAD_A, 0);
    const { packed } = packTextureAtlasPlansWithScale([plan], 1, makeDoc());
    const entry = packed.entries[0]!;
    expect(typeof entry.atlasMatrix).toBe("string");
    expect(entry.atlasMatrix.length).toBeGreaterThan(0);
  });

  it("can keep atlas leaves at local polygon bounds", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_RECT, 0);
    const { packed } = packTextureAtlasPlansWithScale([plan], 1, makeDoc(), "local");
    const entry = packed.entries[0]!;
    expect(entry.atlasLeafSizing).toBe("local");
    expect(entry.atlasLeafWidth).toBe(100);
    expect(entry.atlasLeafHeight).toBe(50);
  });

  it("can keep atlas leaves at rasterized polygon bounds", () => {
    const plan = computeTextureAtlasPlanPublic(TEXTURED_RECT, 0);
    const { packed } = packTextureAtlasPlansWithScale([plan], 0.5, makeDoc(), "raster");
    const entry = packed.entries[0]!;
    expect(entry.atlasLeafSizing).toBe("raster");
    expect(entry.atlasLeafWidth).toBe(50);
    expect(entry.atlasLeafHeight).toBe(25);
  });
});
