/**
 * <poly-perspective-camera> — standalone perspective camera element.
 *
 * Wraps `createPolyPerspectiveCamera`. Unlike <poly-scene> which owns the
 * scene DOM, this element provides a camera context that child controls can
 * read. It creates a `<div class="polycss-camera">` wrapper with the
 * CSS `perspective` property set.
 *
 * Attributes (all optional):
 *   perspective   — number, CSS perspective in pixels (default 32000)
 *   zoom          — number
 *   rot-x         — number, degrees (default 65)
 *   rot-y         — number, degrees (default 45)
 *   target        — "x,y,z" comma-separated world coordinates
 *   distance      — number, camera pull-back in CSS pixels
 */
import {
  createPolyPerspectiveCamera,
  type PolyPerspectiveCameraHandle,
} from "../api/createPolyCamera";
import { parseNumber, parseVec3 } from "./parseAttr";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "perspective",
  "zoom",
  "rot-x",
  "rot-y",
  "target",
  "distance",
] as const;


export class PolyPerspectiveCameraElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _camera: PolyPerspectiveCameraHandle | null = null;
  private _wrapper: HTMLElement | null = null;

  /** Returns the camera handle, or null if not yet connected. */
  getCamera(): PolyPerspectiveCameraHandle | null {
    return this._camera;
  }

  private _readOptions() {
    return {
      perspective: parseNumber(this.getAttribute("perspective")),
      zoom: parseNumber(this.getAttribute("zoom")),
      rotX: parseNumber(this.getAttribute("rot-x")),
      rotY: parseNumber(this.getAttribute("rot-y")),
      target: parseVec3(this.getAttribute("target")),
      distance: parseNumber(this.getAttribute("distance")),
    };
  }

  private _mount(): void {
    if (this._camera) return;
    const opts = this._readOptions();
    this._camera = createPolyPerspectiveCamera(opts);
    this._wrapper = this.ownerDocument!.createElement("div");
    this._wrapper.className = "polycss-camera";
    this._wrapper.style.perspective = this._camera.perspectiveStyle;
    // Move existing children into the wrapper
    while (this.firstChild) {
      this._wrapper.appendChild(this.firstChild);
    }
    this.appendChild(this._wrapper);
    this.dispatchEvent(new CustomEvent("polycss:camera-ready", { bubbles: false }));
  }

  private _teardown(): void {
    // Move children back out of the wrapper
    if (this._wrapper) {
      while (this._wrapper.firstChild) {
        this.insertBefore(this._wrapper.firstChild, this._wrapper);
      }
      if (this._wrapper.parentNode) this._wrapper.parentNode.removeChild(this._wrapper);
      this._wrapper = null;
    }
    this._camera = null;
  }

  connectedCallback(): void {
    this._mount();
  }

  disconnectedCallback(): void {
    this._teardown();
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    if (!this._camera || !this._wrapper) return;
    const opts = this._readOptions();
    if (name === "perspective") {
      // Re-creating the handle is required for perspective — it's baked
      // into `perspectiveStyle` on the wrapper. Everything else uses
      // update() so the SCENE keeps its reference to the same handle.
      this._camera = createPolyPerspectiveCamera(opts);
      this._wrapper.style.perspective = this._camera.perspectiveStyle;
      return;
    }
    // Mutate the existing handle in place — the scene captured this object
    // on connect and looks it up by identity on every `applyCamera()`,
    // so swapping the reference here would orphan the scene's pointer.
    this._camera.update({
      rotX: opts.rotX,
      rotY: opts.rotY,
      zoom: opts.zoom,
      target: opts.target,
      distance: opts.distance,
    });
    // Push the updated transform into the scene root. <poly-scene> is a
    // DESCENDANT of <poly-perspective-camera>, not an ancestor — the
    // scene wraps itself inside the camera's .polycss-camera div on mount.
    const sceneEl = this.querySelector("poly-scene");
    const sc = (sceneEl as unknown as { getScene?: () => { applyCamera: () => void } | null } | null)?.getScene?.();
    sc?.applyCamera();
  }
}
