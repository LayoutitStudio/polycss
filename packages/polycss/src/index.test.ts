import { describe, expect, it } from "vitest";
import { BASE_TILE } from "@layoutit/polycss-core";
import {
  buildPolyMeshTransform,
  buildPolySceneTransform,
  polyCssDistanceToWorld,
  polyCssPositionToWorld,
  worldDistanceToPolyCss,
  worldDirectionalLightToPolyCss,
  worldDirectionToPolyCss,
  worldPositionToPolyCss,
} from "./index";
import type { PolySceneTransformInput } from "./index";

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

  it("exposes the directional-light object conversion", () => {
    expect(worldDirectionalLightToPolyCss({
      direction: [1, 2, 3],
      color: "#ffffff",
      intensity: 0.5,
    })).toEqual({
      direction: [2, 1, 3],
      color: "#ffffff",
      intensity: 0.5,
    });
  });

  it("exposes scalar and inverse position conversions", () => {
    expect(worldDistanceToPolyCss(3)).toBe(3 * BASE_TILE);
    expect(polyCssDistanceToWorld(3 * BASE_TILE)).toBe(3);
    expect(polyCssPositionToWorld([5 * BASE_TILE, 3 * BASE_TILE, 7 * BASE_TILE])).toEqual([3, 5, 7]);
  });

  it("exposes custom-scale conversions for external adapters", () => {
    expect(worldPositionToPolyCss([3, 5, 7], 10)).toEqual([50, 30, 70]);
    expect(worldDistanceToPolyCss(3, 10)).toBe(30);
    expect(polyCssDistanceToWorld(30, 10)).toBe(3);
    expect(polyCssPositionToWorld([50, 30, 70], 10)).toEqual([3, 5, 7]);
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

  it("exposes the scene-root transform builder", () => {
    const input: PolySceneTransformInput = {
      rotX: 30,
      rotY: 45,
      zoom: 1,
      target: [3, 5, 7],
    };
    expect(buildPolySceneTransform(input)).toBe(
      `scale(${1 / BASE_TILE}) rotateX(30deg) rotate(45deg) translate3d(${-5 * BASE_TILE}px, ${-3 * BASE_TILE}px, ${-7 * BASE_TILE}px)`,
    );
  });
});
