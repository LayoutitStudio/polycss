import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { boxPolygons } from "@layoutit/polycss-core";
import { PolyScene } from "../scene/PolyScene";
import { PolyThreeMesh } from "./PolyThreeMesh";
import { PolyThreePerspectiveCamera } from "./PolyThreePerspectiveCamera";

function renderToDiv(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(element));
  return container;
}

describe("PolyThreeMesh", () => {
  it("renders Three-authored polygons inside a PolyCSS scene", async () => {
    const container = renderToDiv(
      <PolyThreePerspectiveCamera
        fov={50}
        aspect={1}
        position={[3, 2, 5]}
        lookAt={[0, 0, 0]}
        viewportHeight={420}
      >
        <PolyScene>
          <PolyThreeMesh
            polygons={boxPolygons({ size: 1, color: "#66aaff" })}
            rotation={[0, Math.PI / 4, 0]}
          />
        </PolyScene>
      </PolyThreePerspectiveCamera>,
    );

    expect(container.querySelector(".polycss-camera")).toBeTruthy();
    expect(container.querySelector(".polycss-scene")).toBeTruthy();
    expect(container.querySelector(".polycss-mesh")).toBeTruthy();
  });
});
