/**
 * <poly-iframe> custom element tests. Locates the nearest <poly-scene>,
 * mounts a wrapper + iframe inside `.polycss-scene`, applies the same
 * world→CSS transform composition as <poly-mesh>, and tears down on
 * disconnect.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BASE_TILE } from "@layoutit/polycss-core";
import { PolyIframeElement, buildIframeTransform } from "./PolyIframeElement";
import { PolySceneElement } from "./PolySceneElement";

beforeAll(() => {
  if (!customElements.get("poly-scene")) {
    customElements.define("poly-scene", PolySceneElement);
  }
  if (!customElements.get("poly-iframe")) {
    customElements.define("poly-iframe", PolyIframeElement);
  }
});

describe("PolyIframeElement", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (host.parentNode) host.parentNode.removeChild(host);
  });

  describe("registration", () => {
    it("is registered as <poly-iframe>", () => {
      expect(customElements.get("poly-iframe")).toBe(PolyIframeElement);
    });

    it("declares the documented observed attributes", () => {
      const observed = PolyIframeElement.observedAttributes;
      expect(observed).toContain("src");
      expect(observed).toContain("width");
      expect(observed).toContain("height");
      expect(observed).toContain("position");
      expect(observed).toContain("rotation");
      expect(observed).toContain("scale");
      expect(observed).toContain("allow");
    });
  });

  describe("mounting", () => {
    it("appends a .polycss-iframe wrapper inside the parent .polycss-scene", () => {
      host.innerHTML = `
        <poly-scene>
          <poly-iframe src="https://example.com" width="16" height="9"></poly-iframe>
        </poly-scene>
      `;
      const sceneRoot = host.querySelector(".polycss-scene")!;
      expect(sceneRoot).not.toBeNull();
      const wrapper = sceneRoot.querySelector(".polycss-iframe");
      expect(wrapper).not.toBeNull();
      const iframe = wrapper!.querySelector("iframe");
      expect(iframe).not.toBeNull();
      expect(iframe!.src).toBe("https://example.com/");
    });

    it("removes its wrapper on disconnect", () => {
      host.innerHTML = `
        <poly-scene>
          <poly-iframe src="https://example.com" width="16" height="9"></poly-iframe>
        </poly-scene>
      `;
      const sceneRoot = host.querySelector(".polycss-scene")!;
      expect(sceneRoot.querySelector(".polycss-iframe")).not.toBeNull();
      const polyIframe = host.querySelector("poly-iframe")!;
      polyIframe.remove();
      expect(sceneRoot.querySelector(".polycss-iframe")).toBeNull();
    });

    it("forwards the iframe-content attributes (allow, sandbox, title, loading, referrerpolicy)", () => {
      host.innerHTML = `
        <poly-scene>
          <poly-iframe
            src="https://example.com"
            allow="autoplay; encrypted-media"
            sandbox="allow-scripts"
            title="Example"
            loading="lazy"
            referrerpolicy="no-referrer"
          ></poly-iframe>
        </poly-scene>
      `;
      const iframe = host.querySelector(".polycss-iframe iframe")!;
      expect(iframe.getAttribute("allow")).toBe("autoplay; encrypted-media");
      expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
      expect(iframe.getAttribute("title")).toBe("Example");
      expect(iframe.getAttribute("loading")).toBe("lazy");
      expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    });
  });

  describe("geometry", () => {
    it("sets the iframe's CSS-px size from width/height × BASE_TILE (world units)", () => {
      host.innerHTML = `
        <poly-scene>
          <poly-iframe src="about:blank" width="16" height="9"></poly-iframe>
        </poly-scene>
      `;
      const iframe = host.querySelector(".polycss-iframe iframe") as HTMLIFrameElement;
      expect(iframe.style.width).toBe(`${16 * BASE_TILE}px`);
      expect(iframe.style.height).toBe(`${9 * BASE_TILE}px`);
    });

    it("centers the iframe at the wrapper's local origin (translate(-w/2, -h/2))", () => {
      // With width=16, height=9 (world units) → 800px × 450px iframe.
      // The wrapper transform ends with translate(-400px, -225px) so the
      // iframe content straddles (0,0) instead of starting at it.
      host.innerHTML = `
        <poly-scene>
          <poly-iframe src="about:blank" width="16" height="9"></poly-iframe>
        </poly-scene>
      `;
      const wrapper = host.querySelector(".polycss-iframe") as HTMLElement;
      expect(wrapper.style.transform).toContain("translate(-400px, -225px)");
    });

    it("applies world→CSS axis swap on position and ×BASE_TILE", () => {
      host.innerHTML = `
        <poly-scene>
          <poly-iframe src="about:blank" width="16" height="9" position="3, 5, 7"></poly-iframe>
        </poly-scene>
      `;
      const wrapper = host.querySelector(".polycss-iframe") as HTMLElement;
      // position=[3, 5, 7] (world axes) → CSS [pos[1]*50, pos[0]*50, pos[2]*50]
      // = [250, 150, 350]
      expect(wrapper.style.transform).toContain("translate3d(250px, 150px, 350px)");
    });

    it("applies the post-parity rotation conjugation (rotateY(-rx) rotateX(-ry) rotateZ(-rz))", () => {
      host.innerHTML = `
        <poly-scene>
          <poly-iframe src="about:blank" width="16" height="9" rotation="30, 0, 0"></poly-iframe>
        </poly-scene>
      `;
      const wrapper = host.querySelector(".polycss-iframe") as HTMLElement;
      expect(wrapper.style.transform).toContain("rotateY(-30deg)");
    });

    it("applies scale via scale3d", () => {
      host.innerHTML = `
        <poly-scene>
          <poly-iframe src="about:blank" width="16" height="9" scale="2"></poly-iframe>
        </poly-scene>
      `;
      const wrapper = host.querySelector(".polycss-iframe") as HTMLElement;
      expect(wrapper.style.transform).toContain("scale3d(2, 2, 2)");
    });

    it("updates transform when position changes", () => {
      host.innerHTML = `
        <poly-scene>
          <poly-iframe src="about:blank" width="16" height="9" position="0, 0, 0"></poly-iframe>
        </poly-scene>
      `;
      const polyIframe = host.querySelector("poly-iframe")!;
      polyIframe.setAttribute("position", "1, 2, 3");
      const wrapper = host.querySelector(".polycss-iframe") as HTMLElement;
      // position=[1,2,3] → CSS [pos[1]*50, pos[0]*50, pos[2]*50] = [100, 50, 150]
      expect(wrapper.style.transform).toContain("translate3d(100px, 50px, 150px)");
    });

    it("updates iframe.src when the src attribute changes", () => {
      host.innerHTML = `
        <poly-scene>
          <poly-iframe src="https://a.example" width="16" height="9"></poly-iframe>
        </poly-scene>
      `;
      const polyIframe = host.querySelector("poly-iframe")!;
      polyIframe.setAttribute("src", "https://b.example");
      const iframe = host.querySelector(".polycss-iframe iframe") as HTMLIFrameElement;
      expect(iframe.src).toBe("https://b.example/");
    });
  });

  describe("buildIframeTransform (pure helper)", () => {
    it("returns identity-ish transform (just centering) when no position/rotation/scale supplied", () => {
      const t = buildIframeTransform(undefined, undefined, undefined, 800, 450);
      expect(t).toBe("translate3d(0px, 0px, 0px) translate(-400px, -225px)");
    });

    it("composes translate3d → rotation → scale → 2D centering in that order", () => {
      const t = buildIframeTransform([1, 2, 3], [10, 0, 0], 1.5, 800, 450);
      // translate3d(pos[1]*50, pos[0]*50, pos[2]*50) → translate3d(100, 50, 150)
      // rotateY(-rotation[0]) → rotateY(-10)
      // scale3d(1.5, 1.5, 1.5)
      // translate(-w/2, -h/2)
      expect(t).toBe(
        "translate3d(100px, 50px, 150px) rotateY(-10deg) scale3d(1.5, 1.5, 1.5) translate(-400px, -225px)",
      );
    });
  });
});
