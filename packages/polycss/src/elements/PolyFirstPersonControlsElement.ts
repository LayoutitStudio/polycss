/**
 * <poly-first-person-controls> — declarative wrapper around `createPolyFirstPersonControls`.
 *
 * Behavior element: no rendered output. Sits inside <poly-scene> and walks
 * up via parent nodes to attach itself to the parent scene.
 * The full options surface from createPolyFirstPersonControls is exposed via
 * kebab-case attributes:
 *
 *   <poly-first-person-controls
 *     enabled="false"
 *     look-enabled="false"
 *     move-enabled="false"
 *     jump-enabled="false"
 *     crouch-enabled="false"
 *     look-sensitivity="0.2"
 *     invert-y
 *     move-speed="8"
 *     jump-velocity="10"
 *     gravity="20"
 *     eye-height="1.7"
 *     crouch-height="1"
 *     ground-z="0"
 *     min-pitch="5"
 *     max-pitch="175"
 *   ></poly-first-person-controls>
 */
import { PolySceneElement } from "./PolySceneElement";
import {
  createPolyFirstPersonControls,
  type PolyFirstPersonControlsHandle,
  type PolyFirstPersonControlsOptions,
} from "../api/createPolyFirstPersonControls";
import { parseNumber, parseBoolAttr } from "./parseAttr";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "enabled",
  "look-enabled",
  "move-enabled",
  "jump-enabled",
  "crouch-enabled",
  "look-sensitivity",
  "invert-y",
  "move-speed",
  "jump-velocity",
  "gravity",
  "eye-height",
  "crouch-height",
  "ground-z",
  "min-pitch",
  "max-pitch",
] as const;


export class PolyFirstPersonControlsElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _controls: PolyFirstPersonControlsHandle | null = null;

  private _readOptions(): PolyFirstPersonControlsOptions {
    const opts: PolyFirstPersonControlsOptions = {};
    const enabled = parseBoolAttr(this.getAttribute("enabled"));
    if (enabled !== undefined) opts.enabled = enabled;
    const lookEnabled = parseBoolAttr(this.getAttribute("look-enabled"));
    if (lookEnabled !== undefined) opts.lookEnabled = lookEnabled;
    const moveEnabled = parseBoolAttr(this.getAttribute("move-enabled"));
    if (moveEnabled !== undefined) opts.moveEnabled = moveEnabled;
    const jumpEnabled = parseBoolAttr(this.getAttribute("jump-enabled"));
    if (jumpEnabled !== undefined) opts.jumpEnabled = jumpEnabled;
    const crouchEnabled = parseBoolAttr(this.getAttribute("crouch-enabled"));
    if (crouchEnabled !== undefined) opts.crouchEnabled = crouchEnabled;
    const lookSensitivity = parseNumber(this.getAttribute("look-sensitivity"));
    if (lookSensitivity !== undefined) opts.lookSensitivity = lookSensitivity;
    // invert-y is a boolean presence attribute
    if (this.hasAttribute("invert-y")) {
      const invertY = parseBoolAttr(this.getAttribute("invert-y"));
      if (invertY !== undefined) opts.invertY = invertY;
    }
    const moveSpeed = parseNumber(this.getAttribute("move-speed"));
    if (moveSpeed !== undefined) opts.moveSpeed = moveSpeed;
    const jumpVelocity = parseNumber(this.getAttribute("jump-velocity"));
    if (jumpVelocity !== undefined) opts.jumpVelocity = jumpVelocity;
    const gravity = parseNumber(this.getAttribute("gravity"));
    if (gravity !== undefined) opts.gravity = gravity;
    const eyeHeight = parseNumber(this.getAttribute("eye-height"));
    if (eyeHeight !== undefined) opts.eyeHeight = eyeHeight;
    const crouchHeight = parseNumber(this.getAttribute("crouch-height"));
    if (crouchHeight !== undefined) opts.crouchHeight = crouchHeight;
    const groundZ = parseNumber(this.getAttribute("ground-z"));
    if (groundZ !== undefined) opts.groundZ = groundZ;
    const minPitch = parseNumber(this.getAttribute("min-pitch"));
    if (minPitch !== undefined) opts.minPitch = minPitch;
    const maxPitch = parseNumber(this.getAttribute("max-pitch"));
    if (maxPitch !== undefined) opts.maxPitch = maxPitch;
    return opts;
  }

  private _findScene(): PolySceneElement | null {
    let node: Node | null = this.parentNode;
    while (node) {
      if (node instanceof PolySceneElement) return node;
      node = node.parentNode;
    }
    return null;
  }

  private _attach(): void {
    if (this._controls) return;
    const sceneEl = this._findScene();
    const handle = sceneEl?.getScene();
    if (!handle) {
      if (sceneEl) {
        const onReady = (): void => {
          sceneEl.removeEventListener("polycss:scene-ready", onReady);
          this._attach();
        };
        sceneEl.addEventListener("polycss:scene-ready", onReady);
      }
      return;
    }
    this._controls = createPolyFirstPersonControls(handle, this._readOptions());
  }

  connectedCallback(): void {
    this._attach();
  }

  disconnectedCallback(): void {
    if (this._controls) {
      this._controls.destroy();
      this._controls = null;
    }
  }

  attributeChangedCallback(
    _name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    if (!this._controls) return;
    this._controls.update(this._readOptions());
  }
}
