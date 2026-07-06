import { describe, expect, it } from "vitest";
import { worldDirectionalLightToCss } from "../shadow/receiverFaceGroups";
import {
  DirectionalLight,
  Object3D,
  PerspectiveCamera,
  Vector3,
  threeToPolyPoint,
  transformPolygonsToPoly,
} from "./index";
import type { Polygon } from "../types";

function normalOf(polygon: Polygon): [number, number, number] {
  const [a, b, c] = polygon.vertices;
  const ab = [b![0] - a![0], b![1] - a![1], b![2] - a![2]];
  const ac = [c![0] - a![0], c![1] - a![1], c![2] - a![2]];
  const n: [number, number, number] = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

describe("@layoutit/polycss-core/three", () => {
  it("maps Three Y-up points into PolyCSS Z-up space with a right-handed rotation", () => {
    expect(threeToPolyPoint(new Vector3(1, 2, 3))).toEqual([1, -3, 2]);

    const topFacingThreeQuad: Polygon = {
      vertices: [
        [-1, 0, -1],
        [-1, 0, 1],
        [1, 0, 1],
        [1, 0, -1],
      ],
    };
    const [converted] = transformPolygonsToPoly([topFacingThreeQuad], new Object3D());
    expect(normalOf(converted!)[2]).toBeGreaterThan(0.999);
  });

  it("converts a Three perspective camera into PolyCSS camera state", () => {
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(3, 2, 5);
    camera.lookAt(0, 0, 0);

    const state = camera.toPolyCameraState({ viewportHeight: 420, zoom: 50 });

    expect(state.target.map((v) => Math.abs(v))).toEqual([0, 0, 0]);
    expect(state.zoom).toBe(50);
    expect(state.perspective).toBeCloseTo(420 / (2 * Math.tan((50 * Math.PI / 180) / 2)), 6);
    expect(state.rotX).toBeGreaterThan(0);
    expect(state.rotY).toBeLessThan(0);
  });

  it("converts Three directional lights to PolyCSS source-direction lights", () => {
    const light = new DirectionalLight("#ffffff", 1);
    light.position.set(0, 5, 0);
    light.target.position.set(0, 0, 0);

    const polyLight = light.toPolyDirectionalLight();
    expect(polyLight.direction[0]).toBeCloseTo(0);
    expect(polyLight.direction[1]).toBeCloseTo(0);
    expect(polyLight.direction[2]).toBeCloseTo(1);

    const cssLight = worldDirectionalLightToCss(polyLight);
    expect(cssLight.direction[0]).toBeCloseTo(0);
    expect(cssLight.direction[1]).toBeCloseTo(0);
    expect(cssLight.direction[2]).toBeCloseTo(1);
  });
});
