import { describe, expect, it } from "vitest";
import { BASE_TILE } from "../camera/camera";
import {
  cssDistanceToWorld,
  cssPositionToWorld,
  worldDirectionToCss,
  worldDistanceToCss,
  worldPositionToCss,
} from "./receiverFaceGroups";

describe("world/CSS coordinate helpers", () => {
  it("converts world distance to CSS pixels with the default renderer scale", () => {
    expect(worldDistanceToCss(3)).toBe(3 * BASE_TILE);
    expect(worldDistanceToCss(-2)).toBe(-2 * BASE_TILE);
  });

  it("converts CSS distance back to world units with the default renderer scale", () => {
    expect(cssDistanceToWorld(3 * BASE_TILE)).toBe(3);
    expect(cssDistanceToWorld(-2 * BASE_TILE)).toBe(-2);
  });

  it("supports an explicit world-unit pixel scale for adapters", () => {
    expect(worldDistanceToCss(3, 10)).toBe(30);
    expect(cssDistanceToWorld(30, 10)).toBe(3);
  });

  it("converts world position to the swapped CSS frame", () => {
    expect(worldPositionToCss([3, 5, 7])).toEqual([
      5 * BASE_TILE,
      3 * BASE_TILE,
      7 * BASE_TILE,
    ]);
  });

  it("converts CSS position back to world XYZ", () => {
    expect(cssPositionToWorld([5 * BASE_TILE, 3 * BASE_TILE, 7 * BASE_TILE])).toEqual([3, 5, 7]);
  });

  it("applies the explicit world-unit pixel scale to position conversions", () => {
    expect(worldPositionToCss([3, 5, 7], 10)).toEqual([50, 30, 70]);
    expect(cssPositionToWorld([50, 30, 70], 10)).toEqual([3, 5, 7]);
  });

  it("keeps direction conversion unitless", () => {
    expect(worldDirectionToCss([3, 5, 7])).toEqual([5, 3, 7]);
  });

  it("rejects invalid world-unit pixel scales", () => {
    expect(() => worldDistanceToCss(1, 0)).toThrow("positive finite");
    expect(() => cssDistanceToWorld(1, Number.NaN)).toThrow("positive finite");
    expect(() => worldPositionToCss([1, 2, 3], -1)).toThrow("positive finite");
    expect(() => cssPositionToWorld([1, 2, 3], Number.POSITIVE_INFINITY)).toThrow("positive finite");
  });
});
