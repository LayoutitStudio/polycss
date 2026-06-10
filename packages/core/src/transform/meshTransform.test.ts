import { describe, expect, it } from "vitest";
import { BASE_TILE } from "../camera/camera";
import { buildPolyMeshTransform } from "./meshTransform";

describe("buildPolyMeshTransform", () => {
  it("returns undefined for an identity transform", () => {
    expect(buildPolyMeshTransform({})).toBeUndefined();
    expect(buildPolyMeshTransform({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 })).toBeUndefined();
  });

  it("converts world position into the renderer CSS frame", () => {
    expect(buildPolyMeshTransform({ position: [1, 2, 3] })).toBe(
      `translate3d(${2 * BASE_TILE}px, ${1 * BASE_TILE}px, ${3 * BASE_TILE}px)`,
    );
  });

  it("swaps rotation axes and flips angle sense", () => {
    expect(buildPolyMeshTransform({ rotation: [10, 20, 30] })).toBe(
      "rotateY(-10deg) rotateX(-20deg) rotateZ(-30deg)",
    );
  });

  it("combines position, rotation, and scale in wrapper order", () => {
    expect(buildPolyMeshTransform({ position: [1, 0, 0], rotation: [0, 0, 90], scale: [2, 3, 4] })).toBe(
      `translate3d(0px, ${BASE_TILE}px, 0px) rotateZ(-90deg) scale3d(2, 3, 4)`,
    );
  });
});
