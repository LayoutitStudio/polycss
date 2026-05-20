import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PolyCamera } from "./PolyCamera";

function renderToDiv(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(element));
  return container;
}

// PolyCamera is an alias for PolyOrthographicCamera. Perspective rendering
// is available via PolyPerspectiveCamera.
describe("PolyCamera behavior", () => {
  describe("renders camera wrapper", () => {
    it("has the polycss-camera class", () => {
      const container = renderToDiv(
        <PolyCamera>
          <div />
        </PolyCamera>
      );
      expect(container.querySelector(".polycss-camera")).toBeTruthy();
    });
  });

  describe("projection", () => {
    it("sets perspective to none (orthographic, the default)", () => {
      const container = renderToDiv(
        <PolyCamera>
          <div />
        </PolyCamera>
      );
      const camera = container.querySelector(".polycss-camera") as HTMLElement;
      expect(camera.style.perspective).toBe("none");
    });
  });

  describe("children", () => {
    it("renders children inside the camera wrapper", () => {
      const container = renderToDiv(
        <PolyCamera>
          <span className="inner-child">Hello</span>
        </PolyCamera>
      );
      const child = container.querySelector(".polycss-camera .inner-child");
      expect(child).toBeTruthy();
      expect(child?.textContent).toBe("Hello");
    });

    it("renders multiple children", () => {
      const container = renderToDiv(
        <PolyCamera>
          <div className="a" />
          <div className="b" />
        </PolyCamera>
      );
      expect(container.querySelector(".a")).toBeTruthy();
      expect(container.querySelector(".b")).toBeTruthy();
    });
  });

  describe("custom className", () => {
    it("appends custom className alongside polycss-camera", () => {
      const container = renderToDiv(
        <PolyCamera className="my-custom-class">
          <div />
        </PolyCamera>
      );
      const camera = container.querySelector(".polycss-camera");
      expect(camera?.classList.contains("my-custom-class")).toBe(true);
      expect(camera?.classList.contains("polycss-camera")).toBe(true);
    });
  });
});
