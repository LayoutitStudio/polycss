import { describe, expect, it } from "vitest";
import { BASE_TILE } from "../camera/camera";
import { buildPolyMeshTransform } from "../transform/meshTransform";
import { buildPolySceneTransform } from "../transform/sceneTransform";
import {
  cssDistanceToWorld,
  cssPositionToWorld,
  polyCssDistanceToWorld,
  polyCssPositionToWorld,
  worldDirectionToCss,
  worldDirectionToPolyCss,
  worldDistanceToCss,
  worldDistanceToPolyCss,
  worldDirectionalLightToCss,
  worldDirectionalLightToPolyCss,
  worldPositionToCss,
  worldPositionToPolyCss,
} from "./receiverFaceGroups";

describe("world/CSS conversion helpers", () => {
  it("converts world distance to CSS pixels with the default renderer scale", () => {
    expect(worldDistanceToCss(3)).toBe(3 * BASE_TILE);
    expect(worldDistanceToCss(-2)).toBe(-2 * BASE_TILE);
    expect(worldDistanceToPolyCss(0.5)).toBe(0.5 * BASE_TILE);
  });

  it("converts CSS distance back to world units with the default renderer scale", () => {
    expect(cssDistanceToWorld(3 * BASE_TILE)).toBe(3);
    expect(cssDistanceToWorld(-2 * BASE_TILE)).toBe(-2);
    expect(polyCssDistanceToWorld(25)).toBe(0.5);
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
    expect(worldPositionToPolyCss([3, 5, 7])).toEqual([
      5 * BASE_TILE,
      3 * BASE_TILE,
      7 * BASE_TILE,
    ]);
  });

  it("converts CSS position back to world XYZ", () => {
    expect(cssPositionToWorld([5 * BASE_TILE, 3 * BASE_TILE, 7 * BASE_TILE])).toEqual([3, 5, 7]);
    expect(polyCssPositionToWorld([5 * BASE_TILE, 3 * BASE_TILE, 7 * BASE_TILE])).toEqual([3, 5, 7]);
  });

  it("applies the explicit world-unit pixel scale to position conversions", () => {
    expect(worldPositionToCss([3, 5, 7], 10)).toEqual([50, 30, 70]);
    expect(cssPositionToWorld([50, 30, 70], 10)).toEqual([3, 5, 7]);
  });

  it("keeps direction conversion unitless", () => {
    expect(worldDirectionToCss([3, 5, 7])).toEqual([5, 3, 7]);
    expect(worldDirectionToPolyCss([0, 0, 1])).toEqual([0, 0, 1]);
  });

  it("converts directional light objects without mutating other fields", () => {
    const light = { direction: [1, 2, 3] as [number, number, number], color: "#fff", intensity: 0.5 };
    expect(worldDirectionalLightToCss(light)).toEqual({ direction: [2, 1, 3], color: "#fff", intensity: 0.5 });
    expect(worldDirectionalLightToPolyCss(light)).toEqual({ direction: [2, 1, 3], color: "#fff", intensity: 0.5 });
  });

  it("rejects invalid world-unit pixel scales", () => {
    expect(() => worldDistanceToCss(1, 0)).toThrow("positive finite");
    expect(() => cssDistanceToWorld(1, Number.NaN)).toThrow("positive finite");
    expect(() => worldPositionToCss([1, 2, 3], -1)).toThrow("positive finite");
    expect(() => cssPositionToWorld([1, 2, 3], Number.POSITIVE_INFINITY)).toThrow("positive finite");
  });
});

describe("public transform builders", () => {
  it("builds mesh transforms in PolyCSS CSS frame order", () => {
    expect(buildPolyMeshTransform({})).toBeUndefined();
    expect(buildPolyMeshTransform({ position: [1, 2, 3] })).toBe(
      "translate3d(100px, 50px, 150px)",
    );
    expect(buildPolyMeshTransform({ rotation: [10, 20, 30], scale: [2, 3, 4] })).toBe(
      "rotateY(-10deg) rotateX(-20deg) rotateZ(-30deg) scale3d(2, 3, 4)",
    );
  });

  it("builds scene transforms from plain camera input", () => {
    expect(buildPolySceneTransform({
      target: [1, 2, 3],
      rotX: 30,
      rotY: 45,
      zoom: 1,
      distance: 10,
    })).toBe(
      "translateZ(-10px) scale(0.02) rotateX(30deg) rotate(45deg) translate3d(-100px, -50px, -150px)",
    );
  });

  it("supports explicit world unit size and layout scale", () => {
    expect(buildPolySceneTransform({
      target: [1, 2, 3],
      rotX: 0,
      rotY: 0,
      zoom: 2,
      distance: 10,
      layoutScale: 2,
      worldUnitPx: 20,
    })).toBe(
      "translateZ(-20px) scale(0.2) rotateX(0deg) rotate(0deg) translate3d(-40px, -20px, -60px)",
    );
  });
});
