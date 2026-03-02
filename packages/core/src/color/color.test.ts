import { describe, it, expect } from "vitest";
import {
  parseHexColor,
  parseRgbColor,
  parsePureColor,
  clampChannel,
  formatColor
} from "./color";

describe("color — pure parsing (zero DOM)", () => {
  describe("parseHexColor", () => {
    it("parses 6-digit hex with hash", () => {
      const r = parseHexColor("#ff8800");
      expect(r).toEqual({ rgb: [255, 136, 0], alpha: 1 });
    });

    it("parses 6-digit hex without hash", () => {
      const r = parseHexColor("aabbcc");
      expect(r).toEqual({ rgb: [170, 187, 204], alpha: 1 });
    });

    it("parses 3-digit hex with hash", () => {
      const r = parseHexColor("#f80");
      expect(r).toEqual({ rgb: [255, 136, 0], alpha: 1 });
    });

    it("parses 3-digit hex without hash", () => {
      const r = parseHexColor("abc");
      expect(r).toEqual({ rgb: [170, 187, 204], alpha: 1 });
    });

    it("returns null for invalid hex", () => {
      expect(parseHexColor("xyz")).toBeNull();
      expect(parseHexColor("#gggggg")).toBeNull();
      expect(parseHexColor("")).toBeNull();
      expect(parseHexColor("#12")).toBeNull();
      expect(parseHexColor("#1234567")).toBeNull();
    });

    it("parses black and white", () => {
      expect(parseHexColor("#000000")).toEqual({ rgb: [0, 0, 0], alpha: 1 });
      expect(parseHexColor("#ffffff")).toEqual({ rgb: [255, 255, 255], alpha: 1 });
    });
  });

  describe("parseRgbColor", () => {
    it("parses rgb()", () => {
      const r = parseRgbColor("rgb(100, 200, 50)");
      expect(r).toEqual({ rgb: [100, 200, 50], alpha: 1 });
    });

    it("parses rgba() with alpha", () => {
      const r = parseRgbColor("rgba(10, 20, 30, 0.5)");
      expect(r).toEqual({ rgb: [10, 20, 30], alpha: 0.5 });
    });

    it("parses rgba() without alpha (defaults to 1)", () => {
      const r = parseRgbColor("rgba(10, 20, 30)");
      expect(r).toEqual({ rgb: [10, 20, 30], alpha: 1 });
    });

    it("returns null for non-rgb strings", () => {
      expect(parseRgbColor("#ff0000")).toBeNull();
      expect(parseRgbColor("red")).toBeNull();
      expect(parseRgbColor("")).toBeNull();
    });

    it("handles extra whitespace", () => {
      const r = parseRgbColor("rgb(  10 ,  20 ,  30  )");
      expect(r).toEqual({ rgb: [10, 20, 30], alpha: 1 });
    });
  });

  describe("parsePureColor", () => {
    it("parses hex colors", () => {
      expect(parsePureColor("#ff0000")).toEqual({ rgb: [255, 0, 0], alpha: 1 });
    });

    it("parses rgb() colors", () => {
      expect(parsePureColor("rgb(0, 128, 255)")).toEqual({ rgb: [0, 128, 255], alpha: 1 });
    });

    it("returns null for empty/falsy input", () => {
      expect(parsePureColor("")).toBeNull();
      expect(parsePureColor(null as unknown as string)).toBeNull();
      expect(parsePureColor(undefined as unknown as string)).toBeNull();
    });

    it("returns null for CSS named colors (pure parser cannot resolve them)", () => {
      expect(parsePureColor("red")).toBeNull();
      expect(parsePureColor("tomato")).toBeNull();
    });

    it("trims whitespace", () => {
      expect(parsePureColor("  #ff0000  ")).toEqual({ rgb: [255, 0, 0], alpha: 1 });
    });
  });

  describe("clampChannel", () => {
    it("clamps below 0 to 0", () => {
      expect(clampChannel(-50)).toBe(0);
    });

    it("clamps above 255 to 255", () => {
      expect(clampChannel(300)).toBe(255);
    });

    it("rounds to nearest integer", () => {
      expect(clampChannel(127.6)).toBe(128);
      expect(clampChannel(127.4)).toBe(127);
    });

    it("passes through valid values", () => {
      expect(clampChannel(0)).toBe(0);
      expect(clampChannel(128)).toBe(128);
      expect(clampChannel(255)).toBe(255);
    });
  });

  describe("formatColor", () => {
    it("formats as rgb() when alpha is 1", () => {
      expect(formatColor({ rgb: [255, 0, 0], alpha: 1 })).toBe("rgb(255, 0, 0)");
    });

    it("formats as rgba() when alpha < 1", () => {
      expect(formatColor({ rgb: [0, 128, 255], alpha: 0.5 })).toBe("rgba(0, 128, 255, 0.5)");
    });

    it("clamps channels in output", () => {
      expect(formatColor({ rgb: [300, -10, 128.7], alpha: 1 })).toBe("rgb(255, 0, 129)");
    });
  });
});
