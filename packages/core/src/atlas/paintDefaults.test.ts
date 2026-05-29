/**
 * Feature tests: paintDefaults helpers
 *
 * Covers parseHex, rgbKey, rgbToHex, shadePolygon, parseAlpha,
 * textureTintFactors, tintToCss, quantizeCssColor, rgbEqual,
 * stepRgbToward, and colorErrorScore.
 *
 * These are the observable numeric contracts callers rely on when building
 * atlas textures and DOM color inline styles.
 */
import { describe, it, expect } from "vitest";
import {
  parseHex,
  rgbKey,
  rgbToHex,
  shadePolygon,
  parseAlpha,
  textureTintFactors,
  tintToCss,
  quantizeCssColor,
  rgbEqual,
  stepRgbToward,
  rgbToCss,
  colorErrorScore,
} from "./paintDefaults";

// ---------------------------------------------------------------------------
// parseHex — CSS color → RGB
// ---------------------------------------------------------------------------

describe("parseHex — CSS color parsing", () => {
  it("parses a 6-digit hex color", () => {
    expect(parseHex("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHex("#00ff00")).toEqual({ r: 0, g: 255, b: 0 });
    expect(parseHex("#0000ff")).toEqual({ r: 0, g: 0, b: 255 });
  });

  it("parses white and black", () => {
    expect(parseHex("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("parses rgb() CSS color", () => {
    const result = parseHex("rgb(100, 150, 200)");
    expect(result.r).toBe(100);
    expect(result.g).toBe(150);
    expect(result.b).toBe(200);
  });

  it("parses rgba() CSS color (alpha is ignored for RGB output)", () => {
    const result = parseHex("rgba(10, 20, 30, 0.5)");
    expect(result.r).toBe(10);
    expect(result.g).toBe(20);
    expect(result.b).toBe(30);
  });

  it("returns white fallback for unparseable input", () => {
    expect(parseHex("not-a-color")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("")).toEqual({ r: 255, g: 255, b: 255 });
  });
});

// ---------------------------------------------------------------------------
// rgbKey — RGB → canonical string key
// ---------------------------------------------------------------------------

describe("rgbKey — canonical string representation", () => {
  it("produces a deterministic string for known RGB values", () => {
    expect(rgbKey({ r: 255, g: 0, b: 128 })).toBe("255,0,128");
  });

  it("two equal RGB values produce the same key", () => {
    expect(rgbKey({ r: 10, g: 20, b: 30 })).toBe(rgbKey({ r: 10, g: 20, b: 30 }));
  });

  it("different RGB values produce different keys", () => {
    expect(rgbKey({ r: 1, g: 2, b: 3 })).not.toBe(rgbKey({ r: 3, g: 2, b: 1 }));
  });
});

// ---------------------------------------------------------------------------
// rgbToHex — RGB → hex string
// ---------------------------------------------------------------------------

describe("rgbToHex — round-trip with parseHex", () => {
  it("converts RGB to 6-digit hex", () => {
    expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe("#ff0000");
    expect(rgbToHex({ r: 0, g: 255, b: 0 })).toBe("#00ff00");
    expect(rgbToHex({ r: 0, g: 0, b: 255 })).toBe("#0000ff");
  });

  it("rounds float channel values", () => {
    // 127.6 → rounds to 128 → 0x80
    expect(rgbToHex({ r: 127.6, g: 0, b: 0 })).toBe("#800000");
  });

  it("clamps out-of-range channel values", () => {
    expect(rgbToHex({ r: -10, g: 300, b: 0 })).toBe("#00ff00");
  });

  it("parseHex(rgbToHex(rgb)) round-trips for integer values", () => {
    const original = { r: 42, g: 123, b: 200 };
    expect(parseHex(rgbToHex(original))).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// parseAlpha — alpha extraction
// ---------------------------------------------------------------------------

describe("parseAlpha — alpha extraction from CSS color strings", () => {
  it("returns 1 for fully opaque hex colors", () => {
    expect(parseAlpha("#ff0000")).toBe(1);
    expect(parseAlpha("#ffffff")).toBe(1);
  });

  it("returns the alpha value for rgba() colors", () => {
    expect(parseAlpha("rgba(255, 0, 0, 0.5)")).toBeCloseTo(0.5);
    expect(parseAlpha("rgba(0, 0, 0, 0)")).toBe(0);
  });

  it("returns 1 for unparseable input (default)", () => {
    expect(parseAlpha("not-a-color")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// shadePolygon — Lambert shading
// ---------------------------------------------------------------------------

describe("shadePolygon — Lambert shading outputs", () => {
  it("white polygon with white light at intensity=1, zero ambient → ~mid grey (physical Lambert / π)", () => {
    // Lambert is now physically based: `lit_linear = albedo_linear × intensity ×
    // max(n·L, 0) / π`. At intensity=1, lambert=1, a perfectly white surface
    // reaches `1 / π ≈ 0.318` in linear-light space, which sRGB-encodes to
    // ~#999999 (mid-grey). Matches Three.js MeshLambertMaterial.
    const result = shadePolygon("#ffffff", 1, "#ffffff", "#000000", 0);
    expect(result).toBe("#999999");
  });

  it("white polygon with white light at intensity=π, zero ambient → full white", () => {
    // Multiplying intensity by π cancels the BRDF normalization for callers
    // that still want the pre-physical "intensity=1 = saturated" behavior.
    const result = shadePolygon("#ffffff", Math.PI, "#ffffff", "#000000", 0);
    expect(result).toBe("#ffffff");
  });

  it("white polygon with no light and no ambient → black output", () => {
    const result = shadePolygon("#ffffff", 0, "#000000", "#000000", 0);
    expect(result).toBe("#000000");
  });

  it("red polygon with white ambient at intensity=π → red output (physical Lambert)", () => {
    // BRDF_Lambert wraps both direct and indirect (ambient): lit = albedo/π ×
    // (direct + ambient). To get a saturated red back from pure ambient,
    // ambientIntensity must compensate for /π. At intensity=π → albedo × 1.
    const result = shadePolygon("#ff0000", 0, "#000000", "#ffffff", Math.PI);
    expect(result).toBe("#ff0000");
  });

  it("returns a hex CSS color string in the format #rrggbb for opaque input", () => {
    const result = shadePolygon("#ff8800", 0.5, "#ffffff", "#ffffff", 0.4);
    expect(result).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("transparent input preserves alpha channel in rgba() output", () => {
    const result = shadePolygon("rgba(255, 0, 0, 0.5)", 0, "#000000", "#ffffff", 1);
    expect(result).toContain("rgba");
    expect(result).toContain("0.5");
  });

  it("output is clamped to [0, 255] per channel", () => {
    // Very large directScale would overflow without clamping
    const result = shadePolygon("#ffffff", 100, "#ffffff", "#ffffff", 100);
    expect(parseHex(result)).toEqual({ r: 255, g: 255, b: 255 });
  });
});

// ---------------------------------------------------------------------------
// textureTintFactors — tint factor computation
// ---------------------------------------------------------------------------

describe("textureTintFactors — tint factor output (linear / π — Three.js parity)", () => {
  it("full white light + zero ambient at direct scale 1 → factors of 1/π", () => {
    // Physical BRDF: tint = (lightLinear × directScale) / π. White light is
    // linear (1,1,1); at directScale=1 the factor is 1/π for each channel.
    const tint = textureTintFactors(1, "#ffffff", "#000000", 0);
    expect(tint.r).toBeCloseTo(1 / Math.PI);
    expect(tint.g).toBeCloseTo(1 / Math.PI);
    expect(tint.b).toBeCloseTo(1 / Math.PI);
  });

  it("zero directScale + white ambient at intensity=π → factors of 1", () => {
    // Same physical Lambert: the BRDF /π wraps ambient too. Restore the
    // legacy "saturated tint" behaviour by passing intensity=π.
    const tint = textureTintFactors(0, "#000000", "#ffffff", Math.PI);
    expect(tint.r).toBeCloseTo(1);
    expect(tint.g).toBeCloseTo(1);
    expect(tint.b).toBeCloseTo(1);
  });

  it("red light only → only r factor is positive", () => {
    const tint = textureTintFactors(1, "#ff0000", "#000000", 0);
    expect(tint.r).toBeGreaterThan(0);
    expect(tint.g).toBeCloseTo(0);
    expect(tint.b).toBeCloseTo(0);
  });
});

// ---------------------------------------------------------------------------
// tintToCss — RGBFactors → CSS rgb()
// ---------------------------------------------------------------------------

describe("tintToCss — factors to CSS color string", () => {
  it("factors of 1 → rgb(255 255 255)", () => {
    expect(tintToCss({ r: 1, g: 1, b: 1 })).toBe("rgb(255 255 255)");
  });

  it("factors of 0 → rgb(0 0 0)", () => {
    expect(tintToCss({ r: 0, g: 0, b: 0 })).toBe("rgb(0 0 0)");
  });

  it("clamps values above 1 and below 0", () => {
    const result = tintToCss({ r: 2, g: -0.5, b: 0.5 });
    expect(result).toBe("rgb(255 0 128)");
  });
});

// ---------------------------------------------------------------------------
// quantizeCssColor — color quantization
// ---------------------------------------------------------------------------

describe("quantizeCssColor — color quantization", () => {
  it("steps=1 returns the input unchanged", () => {
    expect(quantizeCssColor("#ff0000", 1)).toBe("#ff0000");
  });

  it("steps=2 quantizes each channel to 0 or 255", () => {
    const result = quantizeCssColor("#804040", 2);
    // 0x80 = 128 rounds to 255 at 2 steps; channels: 128→255, 64→0, 64→0
    expect(result).toBe("#ff0000");
  });

  it("steps=256 produces nearly exact color", () => {
    const result = quantizeCssColor("#ff8040", 256);
    expect(result).toBe("#ff8040");
  });

  it("non-finite steps returns input unchanged", () => {
    expect(quantizeCssColor("#aabbcc", Infinity)).toBe("#aabbcc");
    expect(quantizeCssColor("#aabbcc", NaN)).toBe("#aabbcc");
  });
});

// ---------------------------------------------------------------------------
// rgbEqual — RGB equality
// ---------------------------------------------------------------------------

describe("rgbEqual — RGB comparison", () => {
  it("returns true for identical RGB values", () => {
    expect(rgbEqual({ r: 100, g: 200, b: 50 }, { r: 100, g: 200, b: 50 })).toBe(true);
  });

  it("returns false for different channel values", () => {
    expect(rgbEqual({ r: 100, g: 200, b: 50 }, { r: 100, g: 200, b: 51 })).toBe(false);
  });

  it("returns false when either argument is undefined", () => {
    expect(rgbEqual(undefined, { r: 0, g: 0, b: 0 })).toBe(false);
    expect(rgbEqual({ r: 0, g: 0, b: 0 }, undefined)).toBe(false);
    expect(rgbEqual(undefined, undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stepRgbToward — incremental color stepping
// ---------------------------------------------------------------------------

describe("stepRgbToward — incremental color update", () => {
  it("jumps directly when delta is within maxStep", () => {
    const result = stepRgbToward({ r: 100, g: 100, b: 100 }, { r: 105, g: 90, b: 100 }, 10);
    expect(result).toEqual({ r: 105, g: 90, b: 100 });
  });

  it("steps by maxStep when delta exceeds it", () => {
    const result = stepRgbToward({ r: 0, g: 0, b: 0 }, { r: 100, g: 0, b: 0 }, 10);
    expect(result.r).toBe(10);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });

  it("handles negative deltas correctly", () => {
    const result = stepRgbToward({ r: 200, g: 200, b: 200 }, { r: 100, g: 200, b: 200 }, 20);
    expect(result.r).toBe(180);
    expect(result.g).toBe(200);
    expect(result.b).toBe(200);
  });

  it("returns target unchanged when already equal", () => {
    const target = { r: 50, g: 50, b: 50 };
    const result = stepRgbToward(target, target, 10);
    expect(result).toEqual(target);
  });
});

// ---------------------------------------------------------------------------
// rgbToCss — RGB to CSS string
// ---------------------------------------------------------------------------

describe("rgbToCss — RGB to CSS output", () => {
  it("opaque RGB produces a hex string", () => {
    expect(rgbToCss({ r: 255, g: 0, b: 0 })).toBe("#ff0000");
  });

  it("partial alpha produces rgba() string", () => {
    const result = rgbToCss({ r: 255, g: 0, b: 0 }, 0.5);
    expect(result).toContain("rgba");
    expect(result).toContain("0.5");
  });
});

// ---------------------------------------------------------------------------
// colorErrorScore — perceptual distance metric
// ---------------------------------------------------------------------------

describe("colorErrorScore — perceptual distance", () => {
  it("identical colors produce 0 error", () => {
    expect(colorErrorScore("#ff0000", "#ff0000")).toBe(0);
  });

  it("undefined current produces POSITIVE_INFINITY", () => {
    expect(colorErrorScore(undefined, "#ff0000")).toBe(Number.POSITIVE_INFINITY);
  });

  it("black to white produces maximum error (≈1)", () => {
    const score = colorErrorScore("#000000", "#ffffff");
    // sqrt(255^2 + 255^2 + 255^2) / 510 ≈ sqrt(3)*255/510 ≈ 0.866
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it("similar colors produce lower error than dissimilar ones", () => {
    const closePair = colorErrorScore("#ff0000", "#fe0000");
    const farPair = colorErrorScore("#ff0000", "#0000ff");
    expect(closePair).toBeLessThan(farPair);
  });
});
