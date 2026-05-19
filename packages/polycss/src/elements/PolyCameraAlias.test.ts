/**
 * Tests for the <poly-camera> alias pointing to PolyCameraElement
 * (which extends PolyOrthographicCameraElement).
 *
 * Covers: registration, instantiation, camera handle type, and perspectiveStyle.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PolyCameraElement } from "./PolyCameraElement";
import { PolyOrthographicCameraElement } from "./PolyOrthographicCameraElement";

beforeAll(() => {
  if (!customElements.get("poly-camera")) {
    customElements.define("poly-camera", PolyCameraElement);
  }
});

describe("<poly-camera> alias", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (host.parentNode) host.parentNode.removeChild(host);
  });

  it("is registered as <poly-camera>", () => {
    expect(customElements.get("poly-camera")).toBeDefined();
  });

  it("<poly-camera> resolves to PolyCameraElement", () => {
    expect(customElements.get("poly-camera")).toBe(PolyCameraElement);
  });

  it("PolyCameraElement extends PolyOrthographicCameraElement", () => {
    const el = document.createElement("poly-camera");
    expect(el).toBeInstanceOf(PolyOrthographicCameraElement);
  });

  it("instantiation produces a PolyCameraElement", () => {
    const el = document.createElement("poly-camera");
    expect(el).toBeInstanceOf(PolyCameraElement);
  });

  it("camera handle has type 'orthographic' after connect", () => {
    const el = document.createElement("poly-camera") as PolyCameraElement;
    host.appendChild(el);
    const cam = el.getCamera();
    expect(cam).not.toBeNull();
    expect(cam?.type).toBe("orthographic");
  });

  it("camera handle has perspectiveStyle 'none'", () => {
    const el = document.createElement("poly-camera") as PolyCameraElement;
    host.appendChild(el);
    const cam = el.getCamera();
    expect(cam?.perspectiveStyle).toBe("none");
  });
});
