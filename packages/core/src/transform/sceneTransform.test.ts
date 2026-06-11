import { describe, expect, it } from "vitest";
import { BASE_TILE, DEFAULT_CAMERA_STATE } from "../camera/camera";
import { buildPolySceneTransform } from "./sceneTransform";

describe("buildPolySceneTransform", () => {
  it("uses the default camera state when fields are omitted", () => {
    expect(buildPolySceneTransform()).toBe(
      `scale(${DEFAULT_CAMERA_STATE.zoom / BASE_TILE}) rotateX(${DEFAULT_CAMERA_STATE.rotX}deg) rotate(${DEFAULT_CAMERA_STATE.rotY}deg) translate3d(0px, 0px, 0px)`,
    );
  });

  it("builds the renderer scene-root transform from explicit camera state", () => {
    expect(buildPolySceneTransform({ rotX: 30, rotY: 45, zoom: 1 })).toBe(
      `scale(${1 / BASE_TILE}) rotateX(30deg) rotate(45deg) translate3d(0px, 0px, 0px)`,
    );
  });

  it("prepends translateZ when distance is non-zero", () => {
    expect(buildPolySceneTransform({ rotX: 0, rotY: 0, zoom: BASE_TILE, distance: 100 })).toBe(
      "translateZ(-100px) scale(1) rotateX(0deg) rotate(0deg) translate3d(0px, 0px, 0px)",
    );
  });

  it("adds target and autoCenterOffset before world-to-CSS conversion", () => {
    expect(buildPolySceneTransform({
      rotX: 0,
      rotY: 0,
      zoom: BASE_TILE,
      target: [1, 2, 3],
      autoCenterOffset: [10, 20, 30],
    })).toBe(
      `scale(1) rotateX(0deg) rotate(0deg) translate3d(${-22 * BASE_TILE}px, ${-11 * BASE_TILE}px, ${-33 * BASE_TILE}px)`,
    );
  });

  it("folds layoutScale into scene scale and camera distance", () => {
    expect(buildPolySceneTransform({ rotX: 0, rotY: 0, zoom: 1, distance: 10, layoutScale: 2 })).toBe(
      `translateZ(-20px) scale(${(1 / BASE_TILE) * 2}) rotateX(0deg) rotate(0deg) translate3d(0px, 0px, 0px)`,
    );
  });

  it("supports a custom world unit size for external adapters", () => {
    expect(buildPolySceneTransform({ rotX: 0, rotY: 0, zoom: 1, target: [3, 5, 7], worldUnitPx: 10 })).toBe(
      "scale(0.1) rotateX(0deg) rotate(0deg) translate3d(-50px, -30px, -70px)",
    );
  });
});
