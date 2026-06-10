import { describe, expect, it } from "vitest";
import { BASE_TILE } from "@layoutit/polycss-core";
import {
  buildPolyMeshTransform,
  worldDirectionToPolyCss,
  worldPositionToPolyCss,
} from "./index";

describe("public transform helpers", () => {
  it("exposes the world-to-CSS position conversion used by scene meshes", () => {
    expect(worldPositionToPolyCss([3, 5, 7])).toEqual([
      5 * BASE_TILE,
      3 * BASE_TILE,
      7 * BASE_TILE,
    ]);
  });

  it("exposes the world-to-CSS direction conversion without scaling", () => {
    expect(worldDirectionToPolyCss([1, 2, 3])).toEqual([2, 1, 3]);
  });

  it("exposes the mesh wrapper transform builder", () => {
    expect(buildPolyMeshTransform({
      position: [1, 2, 3],
      rotation: [10, 20, 30],
      scale: 2,
    })).toBe(
      `translate3d(${2 * BASE_TILE}px, ${1 * BASE_TILE}px, ${3 * BASE_TILE}px) rotateY(-10deg) rotateX(-20deg) rotateZ(-30deg) scale3d(2, 2, 2)`,
    );
  });
});
