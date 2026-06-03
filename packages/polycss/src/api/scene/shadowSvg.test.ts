import { describe, expect, it } from "vitest";
import {
  ShadowSvgState,
  disposeGroundShadow,
  ensureGroundShadow,
  hideGroundShadow,
  syncShadowPaths,
} from "./shadowSvg";

const SVG_NS = "http://www.w3.org/2000/svg";

describe("ShadowSvgState", () => {
  it("initialises empty", () => {
    const s = new ShadowSvgState();
    expect(s.groundSvg).toBeNull();
    expect(s.groundVisible).toBe(false);
    expect(s.currentGroundCssZ).toBeNull();
  });
});

describe("ensureGroundShadow", () => {
  it("lazily creates the ground SVG inside the .polycss-shadows wrapper as the wrapper's first child", () => {
    // Commit a5b106a grouped every shadow SVG inside a single
    // `.polycss-shadows` wrapper mounted under the scene root. The ground
    // SVG sits inside that wrapper, not directly under sceneEl.
    const sceneEl = document.createElement("div");
    sceneEl.appendChild(document.createElement("span"));
    const state = new ShadowSvgState();
    // Pass debugAttrs=true so the data-poly-shadow-* attributes are emitted
    // (off by default — commit 7940543 gated them behind debugShadowAttrs).
    const { svg } = ensureGroundShadow(state, document, sceneEl, true);
    expect(svg).toBeTruthy();
    expect(state.groundSvg).toBe(svg);
    expect(state.groundVisible).toBe(true);
    const wrapper = sceneEl.querySelector(".polycss-shadows");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.firstChild).toBe(svg);
    expect(svg.getAttribute("class")).toContain("polycss-shadow");
    expect(svg.getAttribute("data-poly-shadow-type")).toBe("ground");
    expect(svg.getAttribute("data-poly-shadow-receiver")).toBe("ground");
  });
  it("returns the same SVG on subsequent calls (idempotent)", () => {
    const sceneEl = document.createElement("div");
    const state = new ShadowSvgState();
    const a = ensureGroundShadow(state, document, sceneEl).svg;
    const b = ensureGroundShadow(state, document, sceneEl).svg;
    expect(a).toBe(b);
  });
  it("reinserts the SVG if it was detached from the DOM", () => {
    // The SVG sits inside the .polycss-shadows wrapper, so detach from its
    // actual parent (the wrapper), not directly from sceneEl.
    const sceneEl = document.createElement("div");
    const state = new ShadowSvgState();
    const { svg } = ensureGroundShadow(state, document, sceneEl);
    const wrapper = svg.parentNode as HTMLElement;
    expect(wrapper.classList.contains("polycss-shadows")).toBe(true);
    wrapper.removeChild(svg);
    expect(svg.parentNode).toBeNull();
    const { svg: again } = ensureGroundShadow(state, document, sceneEl);
    expect(again).toBe(svg);
    expect(svg.parentNode).toBe(wrapper);
  });
  it("toggles back to display:block when re-shown after hide", () => {
    const sceneEl = document.createElement("div");
    const state = new ShadowSvgState();
    const { svg } = ensureGroundShadow(state, document, sceneEl);
    hideGroundShadow(state);
    expect(svg.style.display).toBe("none");
    ensureGroundShadow(state, document, sceneEl);
    expect(svg.style.display).toBe("block");
    expect(state.groundVisible).toBe(true);
  });
});

describe("hideGroundShadow", () => {
  it("no-op when state has no SVG", () => {
    const state = new ShadowSvgState();
    expect(() => hideGroundShadow(state)).not.toThrow();
  });
  it("toggles display:none and flips groundVisible to false", () => {
    const sceneEl = document.createElement("div");
    const state = new ShadowSvgState();
    const { svg } = ensureGroundShadow(state, document, sceneEl);
    hideGroundShadow(state);
    expect(svg.style.display).toBe("none");
    expect(state.groundVisible).toBe(false);
  });
});

describe("disposeGroundShadow", () => {
  it("detaches the SVG and resets state to initial", () => {
    const sceneEl = document.createElement("div");
    const state = new ShadowSvgState();
    const { svg } = ensureGroundShadow(state, document, sceneEl);
    expect(sceneEl.contains(svg)).toBe(true);
    disposeGroundShadow(state);
    expect(sceneEl.contains(svg)).toBe(false);
    expect(state.groundSvg).toBeNull();
    expect(state.groundVisible).toBe(false);
  });
  it("is idempotent on already-disposed state", () => {
    const state = new ShadowSvgState();
    disposeGroundShadow(state);
    expect(state.groundSvg).toBeNull();
  });
});

describe("syncShadowPaths", () => {
  it("creates the requested number of <path> children with shared attributes", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    const paths = syncShadowPaths(svg, document, 3, false);
    expect(paths).toHaveLength(3);
    for (const p of paths) {
      expect(p.tagName.toLowerCase()).toBe("path");
      expect(p.getAttribute("fill-rule")).toBe("nonzero");
      expect(p.getAttribute("stroke-width")).toBeNull();
    }
    expect(svg.childNodes.length).toBe(3);
  });
  it("withStroke adds stroke-width/linejoin", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    const [p] = syncShadowPaths(svg, document, 1, true);
    // 3 px stroke (= 1.5 px outside the path) covers sub-pixel SH-clip
    // gaps + seam bleed + residual CSS-compositor 1-px overlap that
    // survives even seamBleed:0 (each leaf is a separate matrix3d layer
    // and browsers rasterise each on its own pixel grid).
    expect(p!.getAttribute("stroke-width")).toBe("0.5");
    expect(p!.getAttribute("stroke-linejoin")).toBe("round");
  });
  it("shrinks the path list by removing trailing children", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    syncShadowPaths(svg, document, 5, false);
    syncShadowPaths(svg, document, 2, false);
    expect(svg.childNodes.length).toBe(2);
  });
  it("reuses existing path elements (does not detach/recreate)", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    const [a, b] = syncShadowPaths(svg, document, 2, false);
    const [c, d] = syncShadowPaths(svg, document, 2, false);
    expect(c).toBe(a);
    expect(d).toBe(b);
  });
  it("zero count empties the SVG", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    syncShadowPaths(svg, document, 4, false);
    const paths = syncShadowPaths(svg, document, 0, false);
    expect(paths).toEqual([]);
    expect(svg.childNodes.length).toBe(0);
  });
  it("non-path leftover children are also removed (cleared on transition)", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    const stray = document.createElementNS(SVG_NS, "rect");
    svg.appendChild(stray);
    const paths = syncShadowPaths(svg, document, 1, false);
    expect(paths).toHaveLength(1);
    expect(svg.childNodes.length).toBe(1);
    expect((svg.firstChild as Element).tagName.toLowerCase()).toBe("path");
  });
});
