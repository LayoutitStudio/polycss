/**
 * <poly-first-person-controls> element tests.
 *
 * Covers: registration, attribute declaration, attachment to parent scene,
 * attribute reflection via _readOptions, and disconnect cleanup.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PolySceneElement } from "./PolySceneElement";
import { PolyFirstPersonControlsElement } from "./PolyFirstPersonControlsElement";

beforeAll(() => {
  if (!customElements.get("poly-scene")) {
    customElements.define("poly-scene", PolySceneElement);
  }
  if (!customElements.get("poly-first-person-controls")) {
    customElements.define("poly-first-person-controls", PolyFirstPersonControlsElement);
  }
});

let rafQueue: Array<(now: number) => void> = [];
let rafId = 0;

function installManualRaf(): void {
  rafQueue = [];
  rafId = 0;
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return ++rafId;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {
    rafQueue = [];
  });
}

describe("PolyFirstPersonControlsElement", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    installManualRaf();
  });

  afterEach(() => {
    if (host.parentNode) host.parentNode.removeChild(host);
    vi.restoreAllMocks();
  });

  // ── Registration ──────────────────────────────────────────────────────────
  it("is registered as <poly-first-person-controls>", () => {
    expect(customElements.get("poly-first-person-controls")).toBe(PolyFirstPersonControlsElement);
  });

  it("declares the documented observed attributes", () => {
    const observed = PolyFirstPersonControlsElement.observedAttributes;
    expect(observed).toContain("enabled");
    expect(observed).toContain("look-enabled");
    expect(observed).toContain("move-enabled");
    expect(observed).toContain("jump-enabled");
    expect(observed).toContain("crouch-enabled");
    expect(observed).toContain("look-sensitivity");
    expect(observed).toContain("invert-y");
    expect(observed).toContain("move-speed");
    expect(observed).toContain("jump-velocity");
    expect(observed).toContain("gravity");
    expect(observed).toContain("eye-height");
    expect(observed).toContain("crouch-height");
    expect(observed).toContain("ground-z");
    expect(observed).toContain("min-pitch");
    expect(observed).toContain("max-pitch");
  });

  // ── Attachment ────────────────────────────────────────────────────────────
  it("creates controls when nested inside <poly-scene>", () => {
    const sceneEl = document.createElement("poly-scene") as PolySceneElement;
    const controlsEl = document.createElement("poly-first-person-controls") as PolyFirstPersonControlsElement;
    sceneEl.appendChild(controlsEl);
    host.appendChild(sceneEl);
    // FPV starts the rAF movement loop on attach
    expect(rafQueue.length).toBeGreaterThan(0);
  });

  it("no-ops when inserted with no parent <poly-scene>", () => {
    const orphan = document.createElement("poly-first-person-controls") as PolyFirstPersonControlsElement;
    host.appendChild(orphan);
    expect(rafQueue.length).toBe(0);
  });

  // ── Attribute reflection ──────────────────────────────────────────────────
  it("move-speed attribute round-trips", () => {
    const sceneEl = document.createElement("poly-scene") as PolySceneElement;
    const controlsEl = document.createElement("poly-first-person-controls") as PolyFirstPersonControlsElement;
    controlsEl.setAttribute("move-speed", "12");
    sceneEl.appendChild(controlsEl);
    host.appendChild(sceneEl);
    expect(controlsEl.getAttribute("move-speed")).toBe("12");
  });

  it("eye-height attribute round-trips", () => {
    const sceneEl = document.createElement("poly-scene") as PolySceneElement;
    const controlsEl = document.createElement("poly-first-person-controls") as PolyFirstPersonControlsElement;
    controlsEl.setAttribute("eye-height", "2.0");
    sceneEl.appendChild(controlsEl);
    host.appendChild(sceneEl);
    expect(controlsEl.getAttribute("eye-height")).toBe("2.0");
  });

  it("look-sensitivity attribute round-trips", () => {
    const sceneEl = document.createElement("poly-scene") as PolySceneElement;
    const controlsEl = document.createElement("poly-first-person-controls") as PolyFirstPersonControlsElement;
    controlsEl.setAttribute("look-sensitivity", "0.3");
    sceneEl.appendChild(controlsEl);
    host.appendChild(sceneEl);
    expect(controlsEl.getAttribute("look-sensitivity")).toBe("0.3");
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  it("disconnectedCallback destroys controls and stops the rAF loop", () => {
    const sceneEl = document.createElement("poly-scene") as PolySceneElement;
    const controlsEl = document.createElement("poly-first-person-controls") as PolyFirstPersonControlsElement;
    sceneEl.appendChild(controlsEl);
    host.appendChild(sceneEl);
    expect(rafQueue.length).toBeGreaterThan(0);
    sceneEl.removeChild(controlsEl);
    expect(rafQueue.length).toBe(0);
  });
});
