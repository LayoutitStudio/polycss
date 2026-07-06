import { describe, expect, it } from "vitest";
import { createApp, h } from "vue";
import { boxPolygons } from "@layoutit/polycss-core";
import { PolyScene } from "../scene/PolyScene";
import { PolyThreeMesh } from "./PolyThreeMesh";
import { PolyThreePerspectiveCamera } from "./PolyThreePerspectiveCamera";

describe("PolyThreeMesh", () => {
  it("renders Three-authored polygons inside a PolyCSS scene", () => {
    const container = document.createElement("div");
    const app = createApp({
      render() {
        return h(PolyThreePerspectiveCamera, {
          fov: 50,
          aspect: 1,
          position: [3, 2, 5],
          lookAt: [0, 0, 0],
          viewportHeight: 420,
        }, {
          default: () => h(PolyScene, {}, {
            default: () => h(PolyThreeMesh, {
              polygons: boxPolygons({ size: 1, color: "#66aaff" }),
              rotation: [0, Math.PI / 4, 0],
            }),
          }),
        });
      },
    });
    app.mount(container);

    expect(container.querySelector(".polycss-camera")).toBeTruthy();
    expect(container.querySelector(".polycss-scene")).toBeTruthy();
    expect(container.querySelector(".polycss-mesh")).toBeTruthy();
  });
});
