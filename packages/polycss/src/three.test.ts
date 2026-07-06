import { describe, expect, it } from "vitest";
import {
  PerspectiveCamera,
  Object3D,
  boxPolygons,
  mountPolyThreeScene,
  transformPolygonsToPoly,
} from "./three";

describe("polycss/three", () => {
  it("mounts Three-authored polygons through the vanilla scene API", () => {
    const host = document.createElement("div");
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(3, 2, 5);
    camera.lookAt(0, 0, 0);
    const object = new Object3D();

    const scene = mountPolyThreeScene(host, {
      camera,
      cameraOptions: { viewportHeight: 420 },
      polygons: transformPolygonsToPoly(
        boxPolygons({ size: 1, color: "#66aaff" }),
        object,
      ),
    });

    expect(host.querySelector(".polycss-scene")).toBeTruthy();
    expect(host.querySelector(".polycss-mesh")).toBeTruthy();
    expect(scene.camera.state.zoom).toBe(50);
    scene.destroy();
  });
});
