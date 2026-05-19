/**
 * <poly-scene> custom element. Vanilla counterpart to React's <PolyScene>.
 *
 * On `connectedCallback`, instantiates a `createPolyScene(this, options)` and
 * stores the handle. Children (<poly-mesh>, <poly-polygon>) walk up the tree
 * to find this element via `closest("poly-scene")` and call its `getScene()`
 * to register themselves.
 *
 * Camera sourcing: <poly-scene> first walks up the DOM tree looking for an
 * ancestor that has a `getCamera()` method (a <poly-perspective-camera> or
 * <poly-orthographic-camera> element). If found, that camera is used. If no
 * ancestor camera is found, an implicit orthographic camera is created from
 * the scene element's own camera attributes (perspective, rot-x, rot-y, zoom,
 * distance, target) for backward compatibility.
 *
 * Attribute parsing — minimal-footprint string → typed conversion. Unknown
 * attributes are ignored (HTML semantics, not validation).
 */
import type { PolyAmbientLight, PolyDirectionalLight, PolyTextureLightingMode, Vec3 } from "@layoutit/polycss-core";
import {
  createPolyScene,
  type PolySceneOptions,
  type PolySceneHandle,
} from "../api/createPolyScene";
import {
  createPolyOrthographicCamera,
  createPolyPerspectiveCamera,
  type PolyOrthographicCameraHandle,
  type PolyPerspectiveCameraHandle,
} from "../api/createPolyCamera";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  // Camera attrs (used when no ancestor camera element is present)
  "perspective",
  "rot-x",
  "rot-y",
  "zoom",
  // Scene-level attrs
  "directional-direction",
  "directional-color",
  "directional-intensity",
  "ambient-color",
  "ambient-intensity",
  "texture-lighting",
  "texture-quality",
  "auto-center",
] as const;

function parseNumber(value: string | null): number | undefined {
  if (value == null) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

function parsePerspective(value: string | null): number | false | undefined {
  if (value === "false") return false;
  return parseNumber(value);
}

function parseVec3(value: string | null): Vec3 | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) {
    return undefined;
  }
  return [parts[0], parts[1], parts[2]];
}

function parseTextureLighting(value: string | null): PolyTextureLightingMode | undefined {
  if (value === "baked" || value === "dynamic") return value;
  return undefined;
}

function parseTextureQuality(value: string | null): PolySceneOptions["textureQuality"] | undefined {
  if (value === "auto") return "auto";
  return parseNumber(value);
}

type CameraElement = {
  getCamera(): PolyPerspectiveCameraHandle | PolyOrthographicCameraHandle | null;
};

function isCameraElement(el: Element): el is Element & CameraElement {
  return typeof (el as unknown as CameraElement).getCamera === "function";
}

export class PolySceneElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _scene: PolySceneHandle | null = null;
  private _implicitCamera: PolyPerspectiveCameraHandle | PolyOrthographicCameraHandle | null = null;

  /**
   * Returns the underlying PolySceneHandle. Children call this during their own
   * connectedCallback to register meshes.
   */
  getScene(): PolySceneHandle | null {
    return this._scene;
  }

  private _findAncestorCamera(): (PolyPerspectiveCameraHandle | PolyOrthographicCameraHandle) | null {
    let current: Element | null = this.parentElement;
    while (current) {
      if (isCameraElement(current)) {
        const cam = current.getCamera();
        if (cam) return cam;
      }
      current = current.parentElement;
    }
    return null;
  }

  private _buildImplicitCamera(): PolyPerspectiveCameraHandle | PolyOrthographicCameraHandle {
    const perspective = parsePerspective(this.getAttribute("perspective"));
    const rotX = parseNumber(this.getAttribute("rot-x"));
    const rotY = parseNumber(this.getAttribute("rot-y"));
    const zoom = parseNumber(this.getAttribute("zoom"));
    const distance = parseNumber(this.getAttribute("distance"));
    const target = parseVec3(this.getAttribute("target"));
    const opts = {
      ...(rotX !== undefined ? { rotX } : {}),
      ...(rotY !== undefined ? { rotY } : {}),
      ...(zoom !== undefined ? { zoom } : {}),
      ...(distance !== undefined ? { distance } : {}),
      ...(target !== undefined ? { target } : {}),
    };
    if (perspective === false) {
      // `perspective="false"` → orthographic
      return createPolyOrthographicCamera(opts);
    }
    if (perspective !== undefined) {
      // Explicit numeric perspective → perspective camera
      return createPolyPerspectiveCamera({ ...opts, perspective });
    }
    // No perspective attribute → default orthographic
    return createPolyOrthographicCamera(opts);
  }

  private _readNonCameraOptions(): Omit<PolySceneOptions, "camera"> {
    const directionalLight = this._readDirectionalLight();
    const ambientLight = this._readAmbientLight();
    const opts: Omit<PolySceneOptions, "camera"> = {};
    opts.textureLighting = parseTextureLighting(this.getAttribute("texture-lighting")) ?? "baked";
    const textureQuality = parseTextureQuality(this.getAttribute("texture-quality"));
    if (textureQuality !== undefined) opts.textureQuality = textureQuality;
    opts.autoCenter = this.hasAttribute("auto-center");
    if (directionalLight) opts.directionalLight = directionalLight;
    if (ambientLight) opts.ambientLight = ambientLight;
    return opts;
  }

  private _readDirectionalLight(): PolyDirectionalLight | undefined {
    const direction = parseVec3(this.getAttribute("directional-direction"));
    const color = this.getAttribute("directional-color") || undefined;
    const intensity = parseNumber(this.getAttribute("directional-intensity"));
    if (!direction && !color && intensity === undefined) return undefined;
    const light: PolyDirectionalLight = {
      direction: direction ?? [0.4, -0.7, 0.59],
    };
    if (color) light.color = color;
    if (intensity !== undefined) light.intensity = intensity;
    return light;
  }

  private _readAmbientLight(): PolyAmbientLight | undefined {
    const color = this.getAttribute("ambient-color") || undefined;
    const intensity = parseNumber(this.getAttribute("ambient-intensity"));
    if (!color && intensity === undefined) return undefined;
    const ambient: PolyAmbientLight = {};
    if (color) ambient.color = color;
    if (intensity !== undefined) ambient.intensity = intensity;
    return ambient;
  }

  connectedCallback(): void {
    if (this._scene) return;
    const ancestorCamera = this._findAncestorCamera();
    let camera: PolyPerspectiveCameraHandle | PolyOrthographicCameraHandle;
    if (ancestorCamera) {
      camera = ancestorCamera;
      this._implicitCamera = null;
    } else {
      // No ancestor camera — create an implicit one from our own attributes.
      this._implicitCamera = this._buildImplicitCamera();
      camera = this._implicitCamera;
    }
    this._scene = createPolyScene(this, { camera, ...this._readNonCameraOptions() });
    // Notify any descendant <poly-mesh> / <poly-polygon> elements that the
    // scene is ready. They listen for this on connect via a custom event so
    // their own connectedCallback (which may fire BEFORE the scene's, when
    // the scene is hydrated upgrade-after-children) can retry.
    this.dispatchEvent(
      new CustomEvent("polycss:scene-ready", { bubbles: false }),
    );
  }

  disconnectedCallback(): void {
    if (this._scene) {
      this._scene.destroy();
      this._scene = null;
    }
    this._implicitCamera = null;
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    if (!this._scene) return;

    // If we own an implicit camera, update it when camera-related attrs change.
    if (this._implicitCamera) {
      const cameraAttrs = ["rot-x", "rot-y", "zoom", "distance", "target"];
      if (cameraAttrs.includes(name)) {
        const rotX = parseNumber(this.getAttribute("rot-x"));
        const rotY = parseNumber(this.getAttribute("rot-y"));
        const zoom = parseNumber(this.getAttribute("zoom"));
        const distance = parseNumber(this.getAttribute("distance"));
        const target = parseVec3(this.getAttribute("target"));
        if (rotX !== undefined) this._implicitCamera.update({ rotX });
        if (rotY !== undefined) this._implicitCamera.update({ rotY });
        if (zoom !== undefined) this._implicitCamera.update({ zoom });
        if (distance !== undefined) this._implicitCamera.update({ distance });
        if (target !== undefined) this._implicitCamera.update({ target });
        this._scene.applyCamera();
        return;
      }
    }

    // Non-camera attrs → update scene options.
    this._scene.setOptions(this._readNonCameraOptions());
  }
}
