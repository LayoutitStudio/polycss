/**
 * Tests for <poly-perspective-camera>.
 *
 * Regression coverage: updating the `perspective` attribute at runtime must
 * NOT recreate the camera handle, because <poly-scene> captures the handle
 * by identity at mount time and would be orphaned by a swap — leaving every
 * later rot-x/rot-y/zoom/target update silently no-op'd. The fix mutates the
 * wrapper's CSS perspective in place instead.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PolyPerspectiveCameraElement } from "./PolyPerspectiveCameraElement";

beforeAll(() => {
  if (!customElements.get("poly-perspective-camera")) {
    customElements.define("poly-perspective-camera", PolyPerspectiveCameraElement);
  }
});

describe("<poly-perspective-camera>", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (host.parentNode) host.parentNode.removeChild(host);
  });

  it("creates a camera handle on connect", () => {
    const el = document.createElement("poly-perspective-camera") as PolyPerspectiveCameraElement;
    host.appendChild(el);
    expect(el.getCamera()).not.toBeNull();
  });

  it("preserves the same camera handle when `perspective` attribute changes", () => {
    const el = document.createElement("poly-perspective-camera") as PolyPerspectiveCameraElement;
    el.setAttribute("perspective", "32000");
    host.appendChild(el);
    const handleBefore = el.getCamera();
    el.setAttribute("perspective", "2000");
    const handleAfter = el.getCamera();
    expect(handleAfter).toBe(handleBefore);
  });

  it("updates the wrapper's CSS perspective when `perspective` changes", () => {
    const el = document.createElement("poly-perspective-camera") as PolyPerspectiveCameraElement;
    el.setAttribute("perspective", "32000");
    host.appendChild(el);
    const wrapper = el.querySelector(".polycss-camera") as HTMLElement;
    expect(wrapper.style.perspective).toBe("32000px");
    el.setAttribute("perspective", "2000");
    expect(wrapper.style.perspective).toBe("2000px");
  });

  it("forwards rot-x updates to the live camera handle", () => {
    const el = document.createElement("poly-perspective-camera") as PolyPerspectiveCameraElement;
    el.setAttribute("rot-x", "65");
    host.appendChild(el);
    const handle = el.getCamera()!;
    el.setAttribute("rot-x", "90");
    expect(handle.state.rotX).toBe(90);
  });

  it("forwards rot-x updates even after a `perspective` change", () => {
    const el = document.createElement("poly-perspective-camera") as PolyPerspectiveCameraElement;
    el.setAttribute("rot-x", "65");
    host.appendChild(el);
    const handle = el.getCamera()!;
    el.setAttribute("perspective", "2000");
    el.setAttribute("rot-x", "90");
    expect(handle.state.rotX).toBe(90);
  });
});
