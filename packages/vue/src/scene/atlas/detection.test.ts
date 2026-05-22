/**
 * Feature tests: browser-capability detection (Vue atlasBrowser copy)
 *
 * Mirrors React's atlasBrowser.detection.test.ts.
 * Imports from the Vue-local copy so drift between the three copies surfaces
 * immediately.
 */
import { describe, it, expect } from "vitest";
import {
  isBorderShapeSupported,
  isSolidTriangleSupported,
  borderShapeSupported,
  solidTriangleSupported,
  cornerShapeSupported,
} from "./detection";
import { isMobileDocument } from "./packing";

// ---------------------------------------------------------------------------
// Helpers: mock Document factory
// ---------------------------------------------------------------------------

function makeDoc(options: {
  borderShape?: boolean;
  cornerShape?: boolean;
  pointer?: "fine" | "coarse";
  userAgent?: string;
}): Document {
  const pointer = options.pointer ?? "fine";
  const ua = options.userAgent ?? "Mozilla/5.0 Chrome/120";
  return {
    defaultView: {
      navigator: { userAgent: ua },
      CSS: {
        supports: (property: string, value?: string) => {
          if (property === "border-shape") return options.borderShape === true;
          if (property.startsWith("corner-") && value === "bevel") return options.cornerShape === true;
          return false;
        },
      },
      matchMedia: (query: string) => ({
        matches: pointer === "fine"
          ? (query.includes("pointer: fine") || query.includes("hover: hover"))
          : (query.includes("pointer: coarse") || query.includes("hover: none")),
      }),
    },
  } as unknown as Document;
}

const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const CHROME_UA = "Mozilla/5.0 Chrome/120";

// ---------------------------------------------------------------------------
// borderShapeSupported (doc-required variant)
// ---------------------------------------------------------------------------

describe("borderShapeSupported — direct doc variant", () => {
  it("returns false when CSS.supports says border-shape is not supported", () => {
    const doc = makeDoc({ borderShape: false });
    expect(borderShapeSupported(doc)).toBe(false);
  });

  it("returns true when border-shape is supported and pointer is fine", () => {
    const doc = makeDoc({ borderShape: true, pointer: "fine" });
    expect(borderShapeSupported(doc)).toBe(true);
  });

  it("returns false when border-shape is supported but pointer is coarse", () => {
    const doc = makeDoc({ borderShape: true, pointer: "coarse" });
    expect(borderShapeSupported(doc)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// solidTriangleSupported (doc-required variant)
// ---------------------------------------------------------------------------

describe("solidTriangleSupported — direct doc variant", () => {
  it("returns true for a Chrome user agent", () => {
    const doc = makeDoc({ userAgent: CHROME_UA });
    expect(solidTriangleSupported(doc)).toBe(true);
  });

  it("returns false for a Safari user agent", () => {
    const doc = makeDoc({ userAgent: SAFARI_UA });
    expect(solidTriangleSupported(doc)).toBe(false);
  });

  it("returns true when userAgent string is empty (unknown UA → optimistic)", () => {
    const doc = makeDoc({ userAgent: "" });
    expect(solidTriangleSupported(doc)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cornerShapeSupported
// ---------------------------------------------------------------------------

describe("cornerShapeSupported", () => {
  it("returns false when CSS.supports does not support corner-*-shape", () => {
    const doc = makeDoc({ cornerShape: false });
    expect(cornerShapeSupported(doc)).toBe(false);
  });

  it("returns true when all four corner-*-shape properties are supported", () => {
    const doc = makeDoc({ cornerShape: true });
    expect(cornerShapeSupported(doc)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isBorderShapeSupported (wrapper with optional doc)
// ---------------------------------------------------------------------------

describe("isBorderShapeSupported — wrapper", () => {
  it("returns false for a coarse-pointer doc with border-shape support", () => {
    const doc = makeDoc({ borderShape: true, pointer: "coarse" });
    expect(isBorderShapeSupported(doc)).toBe(false);
  });

  it("returns true for a fine-pointer doc with border-shape support", () => {
    const doc = makeDoc({ borderShape: true, pointer: "fine" });
    expect(isBorderShapeSupported(doc)).toBe(true);
  });

  it("returns false for a fine-pointer doc without border-shape support", () => {
    const doc = makeDoc({ borderShape: false, pointer: "fine" });
    expect(isBorderShapeSupported(doc)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isSolidTriangleSupported (wrapper with optional doc)
// ---------------------------------------------------------------------------

describe("isSolidTriangleSupported — wrapper", () => {
  it("returns true when doc has a Chrome UA", () => {
    const doc = makeDoc({ userAgent: CHROME_UA });
    expect(isSolidTriangleSupported(doc)).toBe(true);
  });

  it("returns false when doc has a Safari UA", () => {
    const doc = makeDoc({ userAgent: SAFARI_UA });
    expect(isSolidTriangleSupported(doc)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isMobileDocument
// ---------------------------------------------------------------------------

describe("isMobileDocument", () => {
  it("returns false for null", () => {
    expect(isMobileDocument(null)).toBe(false);
  });

  it("returns false for a fine-pointer desktop doc", () => {
    const doc = makeDoc({ pointer: "fine" });
    expect(isMobileDocument(doc)).toBe(false);
  });

  it("returns true for a coarse-pointer mobile doc", () => {
    const doc = makeDoc({ pointer: "coarse" });
    expect(isMobileDocument(doc)).toBe(true);
  });
});
