import { describe, it, expect } from "vitest";
import { parseColor, shadeColor } from "./lighting";

/**
 * Extended lighting tests for the pure parseColor path.
 * Named CSS colors ("red", "tomato") are NOT resolved — only hex and rgb/rgba.
 * DOM-based named color resolution lives in html/colorResolver.ts.
 */

describe("parseColor — pure parsing", () => {
  it("returns null for CSS named color 'red' (pure parser cannot resolve)", () => {
    expect(parseColor("red")).toBeNull();
  });

  it("returns null for CSS named color 'blue'", () => {
    expect(parseColor("blue")).toBeNull();
  });

  it("returns null for CSS named color 'green'", () => {
    expect(parseColor("green")).toBeNull();
  });

  it("returns null for invalid CSS color string", () => {
    expect(parseColor("notacolor12345")).toBeNull();
  });

  it("returns null for 'transparent'", () => {
    expect(parseColor("transparent")).toBeNull();
  });

  it("caches parsed colors", () => {
    const a = parseColor("#112233");
    const b = parseColor("#112233");
    expect(a).toBe(b);
  });

  it("shadeColor falls back to default color for unresolvable named colors", () => {
    const result = shadeColor("red", 10);
    // "red" cannot be parsed by pure parser, so it uses default #cccccc
    // default is rgb(204, 204, 204), with delta +10 = rgb(214, 214, 214)
    expect(result).toBe("rgb(214, 214, 214)");
  });

  it("parses rgb() format directly", () => {
    const result = parseColor("rgb(100, 200, 50)");
    expect(result).toEqual({ rgb: [100, 200, 50], alpha: 1 });
  });

  it("parses rgba() format", () => {
    const result = parseColor("rgba(10, 20, 30, 0.5)");
    expect(result).toEqual({ rgb: [10, 20, 30], alpha: 0.5 });
  });
});
