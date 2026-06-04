/**
 * <PolyIframe> React component tests. Renders an <iframe> wrapper inside
 * the scene's preserve-3d context with the same world→CSS transform
 * conventions as <PolyMesh>.
 */
import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { BASE_TILE } from "@layoutit/polycss-core";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "./PolyScene";
import { PolyIframe } from "./PolyIframe";

function renderIframe(
  props: React.ComponentProps<typeof PolyIframe>,
): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        PolyCamera,
        {},
        React.createElement(
          PolyScene,
          {},
          React.createElement(PolyIframe, props),
        ),
      ),
    ),
  );
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("<PolyIframe>", () => {
  it("renders an <iframe> inside .polycss-iframe inside .polycss-scene", () => {
    const container = renderIframe({ src: "https://example.com", width: 16, height: 9 });
    const sceneRoot = container.querySelector(".polycss-scene");
    expect(sceneRoot).not.toBeNull();
    const wrapper = sceneRoot!.querySelector(".polycss-iframe");
    expect(wrapper).not.toBeNull();
    const iframe = wrapper!.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toBe("https://example.com");
  });

  it("sets the iframe's CSS-px size from width/height × BASE_TILE (world units)", () => {
    const container = renderIframe({ src: "about:blank", width: 16, height: 9 });
    const iframe = container.querySelector(".polycss-iframe iframe") as HTMLIFrameElement;
    expect(iframe.style.width).toBe(`${16 * BASE_TILE}px`);
    expect(iframe.style.height).toBe(`${9 * BASE_TILE}px`);
  });

  it("centers the iframe at the wrapper's local origin (translate(-w/2, -h/2))", () => {
    const container = renderIframe({ src: "about:blank", width: 16, height: 9 });
    const wrapper = container.querySelector(".polycss-iframe") as HTMLElement;
    expect(wrapper.style.transform).toContain("translate(-400px, -225px)");
  });

  it("applies world→CSS axis swap on position and ×BASE_TILE", () => {
    const container = renderIframe({
      src: "about:blank",
      width: 16,
      height: 9,
      position: [3, 5, 7],
    });
    const wrapper = container.querySelector(".polycss-iframe") as HTMLElement;
    // position=[3, 5, 7] → CSS [pos[1]*50, pos[0]*50, pos[2]*50] = [250, 150, 350]
    expect(wrapper.style.transform).toContain("translate3d(250px, 150px, 350px)");
  });

  it("applies the post-parity rotation conjugation (rotateY(-rx) rotateX(-ry) rotateZ(-rz))", () => {
    const container = renderIframe({
      src: "about:blank",
      width: 16,
      height: 9,
      rotation: [30, 0, 0],
    });
    const wrapper = container.querySelector(".polycss-iframe") as HTMLElement;
    expect(wrapper.style.transform).toContain("rotateY(-30deg)");
  });

  it("applies scale via scale3d", () => {
    const container = renderIframe({ src: "about:blank", width: 16, height: 9, scale: 2 });
    const wrapper = container.querySelector(".polycss-iframe") as HTMLElement;
    expect(wrapper.style.transform).toContain("scale3d(2, 2, 2)");
  });

  it("forwards iframe attributes (allow, sandbox, loading, referrerPolicy, title)", () => {
    const container = renderIframe({
      src: "https://example.com",
      width: 16,
      height: 9,
      allow: "autoplay; encrypted-media",
      sandbox: "allow-scripts",
      loading: "lazy",
      referrerPolicy: "no-referrer",
      title: "Example",
    });
    const iframe = container.querySelector(".polycss-iframe iframe") as HTMLIFrameElement;
    expect(iframe.getAttribute("allow")).toBe("autoplay; encrypted-media");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("loading")).toBe("lazy");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe.getAttribute("title")).toBe("Example");
  });

  it("merges className + style overrides on the wrapper without overwriting transform", () => {
    const container = renderIframe({
      src: "about:blank",
      width: 16,
      height: 9,
      position: [1, 0, 0],
      className: "tv-screen",
      style: { opacity: 0.9 },
    });
    const wrapper = container.querySelector(".polycss-iframe") as HTMLElement;
    expect(wrapper.className).toContain("polycss-iframe");
    expect(wrapper.className).toContain("tv-screen");
    expect(wrapper.style.opacity).toBe("0.9");
    // position[1]=0 → cssX=0, position[0]=1 → cssY=50.
    expect(wrapper.style.transform).toContain("translate3d(0px, 50px, 0px)");
  });
});
