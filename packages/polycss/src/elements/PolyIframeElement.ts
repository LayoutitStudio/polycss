/**
 * <poly-iframe src="…"> custom element. Vanilla counterpart to React's
 * <PolyIframe> / Vue's <PolyIframe>. A flat textured "quad" whose texture
 * is a live document instead of an atlas slice — the iframe inherits the
 * scene's preserve-3d context so `matrix3d` transforms compose naturally
 * with surrounding polygons.
 *
 * Conventions match `<poly-mesh>` post-parity:
 *   - `position` (Vec3, world units, world-axis order +X right +Y forward +Z up)
 *   - `rotation` (Vec3, Euler degrees, world XYZ)
 *   - `scale`    (number or Vec3, defaults to 1)
 *   - `width` / `height` (numbers, world units — the iframe surface size)
 *
 * The iframe is centered at the wrapper's local origin (the trailing
 * `translate(-w/2, -h/2)` in the transform string), so rotation/scale
 * pivot at the visible center — matching `<poly-icosahedron size>` and
 * other primitive shapes whose vertices straddle the origin.
 *
 * On connect: walks up to the nearest `<poly-scene>` and appends a
 * wrapper div + iframe inside the scene's `.polycss-scene` element so
 * the CSS camera transform applies. On disconnect: removes the wrapper.
 */
import { BASE_TILE } from "@layoutit/polycss-core";
import type { Vec3 } from "@layoutit/polycss-core";
import type { PolySceneElement } from "./PolySceneElement";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "src",
  "width",
  "height",
  "position",
  "rotation",
  "scale",
  "allow",
  "loading",
  "referrerpolicy",
  "sandbox",
  "title",
] as const;

function parseVec3(value: string | null): Vec3 | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return undefined;
  return [parts[0], parts[1], parts[2]];
}

function parseScale(value: string | null): number | Vec3 | undefined {
  if (!value) return undefined;
  if (!value.includes(",")) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return parseVec3(value);
}

function parseNumber(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function findSceneRoot(el: HTMLElement): HTMLElement | null {
  const sceneCustomEl = el.closest("poly-scene") as
    | (PolySceneElement & Element)
    | null;
  if (!sceneCustomEl) return null;
  // createPolyScene mounts `.polycss-scene` two levels deep inside
  // `<poly-scene>` (`<poly-scene> > .polycss-camera > .polycss-scene`).
  return sceneCustomEl.querySelector(".polycss-scene") as HTMLElement | null;
}

/**
 * Build the wrapper transform string. Mirrors `buildMeshTransform` in
 * `packages/polycss/src/api/scene/transforms.ts` exactly — world→CSS axis
 * swap on position, rotation conjugation (`rotateY(-rx) rotateX(-ry)
 * rotateZ(-rz)` because the swap reflects axes, det=-1), scale at the
 * end. The trailing `translate(-w/2, -h/2)` is the only addition: it
 * centers the iframe content at the wrapper's local origin (otherwise the
 * iframe would extend from (0,0) to (w,h) and rotation would pivot at the
 * iframe's corner).
 */
export function buildIframeTransform(
  position: Vec3 | undefined,
  rotation: Vec3 | undefined,
  scale: number | Vec3 | undefined,
  cssWidth: number,
  cssHeight: number,
): string {
  const sx = typeof scale === "number" ? scale : (scale?.[0] ?? 1);
  const sy = typeof scale === "number" ? scale : (scale?.[1] ?? 1);
  const sz = typeof scale === "number" ? scale : (scale?.[2] ?? 1);
  const hasScale = sx !== 1 || sy !== 1 || sz !== 1;
  const hasRotation = !!rotation && (!!rotation[0] || !!rotation[1] || !!rotation[2]);
  const cssX = (position?.[1] ?? 0) * BASE_TILE;
  const cssY = (position?.[0] ?? 0) * BASE_TILE;
  const cssZ = (position?.[2] ?? 0) * BASE_TILE;

  const parts: string[] = [];
  parts.push(`translate3d(${cssX}px, ${cssY}px, ${cssZ}px)`);
  if (hasRotation) {
    if (rotation![0]) parts.push(`rotateY(${-rotation![0]}deg)`);
    if (rotation![1]) parts.push(`rotateX(${-rotation![1]}deg)`);
    if (rotation![2]) parts.push(`rotateZ(${-rotation![2]}deg)`);
  }
  if (hasScale) {
    parts.push(`scale3d(${sx}, ${sy}, ${sz})`);
  }
  // 2D translate at the end: rotation/scale operate on the centered
  // iframe, then the centering offset is applied. Order matters — placing
  // this before rotation would rotate the offset itself and the iframe
  // would orbit instead of spinning in place.
  parts.push(`translate(${-cssWidth / 2}px, ${-cssHeight / 2}px)`);
  return parts.join(" ");
}

export class PolyIframeElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _wrapper: HTMLDivElement | null = null;
  private _iframe: HTMLIFrameElement | null = null;

  /** The iframe element this <poly-iframe> mounted, or null when detached. */
  getIframeElement(): HTMLIFrameElement | null {
    return this._iframe;
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
    if (!this._wrapper || !this._iframe) return;
    if (name === "src") {
      this._iframe.src = this.getAttribute("src") ?? "";
      return;
    }
    if (name === "allow" || name === "loading" || name === "referrerpolicy" || name === "sandbox" || name === "title") {
      const v = this.getAttribute(name);
      if (v === null) this._iframe.removeAttribute(name);
      else this._iframe.setAttribute(name, v);
      return;
    }
    // Geometry-affecting attribute: rebuild transform + iframe size.
    this._applyGeometry();
  }

  private _mount(): void {
    const sceneRoot = findSceneRoot(this);
    if (!sceneRoot) return;
    const doc = this.ownerDocument;
    if (!doc) return;

    const wrapper = doc.createElement("div");
    wrapper.className = "polycss-iframe";
    wrapper.style.position = "absolute";
    wrapper.style.left = "0";
    wrapper.style.top = "0";
    wrapper.style.transformOrigin = "0 0";
    wrapper.style.transformStyle = "preserve-3d";

    const iframe = doc.createElement("iframe");
    iframe.style.display = "block";
    iframe.style.border = "0";
    iframe.style.background = "#000";
    // Forward iframe-specific attributes if they're set on the custom
    // element. Useful for autoplay (`allow="autoplay"`), iOS inline
    // playback (`playsinline` — passed via the src URL params on YouTube
    // embeds, not via an attribute), permissions, etc.
    const src = this.getAttribute("src");
    if (src) iframe.src = src;
    const allow = this.getAttribute("allow");
    if (allow) iframe.setAttribute("allow", allow);
    for (const attr of ["loading", "referrerpolicy", "sandbox", "title"] as const) {
      const v = this.getAttribute(attr);
      if (v !== null) iframe.setAttribute(attr, v);
    }

    wrapper.appendChild(iframe);
    sceneRoot.appendChild(wrapper);
    this._wrapper = wrapper;
    this._iframe = iframe;
    this._applyGeometry();
  }

  private _applyGeometry(): void {
    if (!this._wrapper || !this._iframe) return;
    const width = parseNumber(this.getAttribute("width"), 16);
    const height = parseNumber(this.getAttribute("height"), 9);
    const cssW = width * BASE_TILE;
    const cssH = height * BASE_TILE;
    this._iframe.style.width = `${cssW}px`;
    this._iframe.style.height = `${cssH}px`;
    const position = parseVec3(this.getAttribute("position"));
    const rotation = parseVec3(this.getAttribute("rotation"));
    const scale = parseScale(this.getAttribute("scale"));
    this._wrapper.style.transform = buildIframeTransform(position, rotation, scale, cssW, cssH);
  }

  private _teardown(): void {
    if (this._wrapper?.parentNode) {
      this._wrapper.parentNode.removeChild(this._wrapper);
    }
    this._wrapper = null;
    this._iframe = null;
  }
}
