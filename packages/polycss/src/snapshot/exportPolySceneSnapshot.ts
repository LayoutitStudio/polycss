export type PolySceneSnapshotErrorCode =
  | "INVALID_TARGET"
  | "SCENE_NOT_FOUND"
  | "ASSET_INLINE_FAILED";

export class PolySceneSnapshotError extends Error {
  readonly code: PolySceneSnapshotErrorCode;
  readonly url?: string;

  constructor(code: PolySceneSnapshotErrorCode, message: string, url?: string) {
    super(message);
    this.name = "PolySceneSnapshotError";
    this.code = code;
    this.url = url;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface InlineContext {
  baseUrl: string;
  cache: Map<string, Promise<string>>;
}

interface SnapshotAssetRule {
  attr: string;
  value: string;
  property: "background-image" | "--polycss-atlas-url";
  dataUrl: string;
}

const SNAPSHOT_DOCUMENT_CSS = `
html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
}

body {
  position: relative;
  overflow: hidden;
}
`;

type PolyLeafTag = "b" | "i" | "s" | "u";

interface SnapshotCssFeatures {
  hasCamera: boolean;
  hasScene: boolean;
  hasMesh: boolean;
  hasFpvHost: boolean;
  hasBucket: boolean;
  hasVoxelMesh: boolean;
  hasTransformGizmo: boolean;
  hasTransformRing: boolean;
  hasDynamicLighting: boolean;
  hasQ: boolean;
  leafTags: PolyLeafTag[];
  solidLeafTags: PolyLeafTag[];
}

const POLY_LEAF_TAGS: PolyLeafTag[] = ["b", "i", "s", "u"];
const SOLID_POLY_LEAF_TAGS: PolyLeafTag[] = ["b", "i", "u"];
const LIGHTING_CUSTOM_PROPS = [
  "--plx", "--ply", "--plz",
  "--plr", "--plg", "--plb", "--pli",
  "--par", "--pag", "--pab", "--pai",
  "--pnx", "--pny", "--pnz",
  "--psr", "--psg", "--psb",
  "--plam",
  "--polycss-light-preview-active",
  "--polycss-preview-r",
  "--polycss-preview-g",
  "--polycss-preview-b",
] as const;
const SHADOW_CUSTOM_PROPS = [
  "--clx", "--cly", "--clz", "--shadow-ground-cssz",
] as const;
const ATLAS_CUSTOM_PROPS = [
  "--polycss-atlas-size",
  "--polycss-atlas-url",
  "--polycss-atlas-position",
  "--polycss-atlas-image-size",
] as const;

function isElement(value: unknown): value is Element {
  return !!value
    && typeof (value as Element).querySelector === "function"
    && typeof (value as Element).cloneNode === "function";
}

function findPolySnapshotRoot(target: Element): Element | null {
  const closestCamera = target.closest(".polycss-camera");
  if (closestCamera) return closestCamera;

  const closestScene = target.closest(".polycss-scene");
  if (closestScene) return closestScene.closest(".polycss-camera") ?? closestScene;

  return target.querySelector(".polycss-camera")
    ?? target.querySelector(".polycss-scene");
}

function allElements(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll("*"))];
}

function matchesOrContains(root: Element, selector: string): boolean {
  return root.matches(selector) || !!root.querySelector(selector);
}

function containsTag(root: Element, tagName: string): boolean {
  return root.tagName.toLowerCase() === tagName || !!root.querySelector(tagName);
}

function collectSnapshotCssFeatures(root: Element): SnapshotCssFeatures {
  const leafTags = POLY_LEAF_TAGS.filter((tag) => containsTag(root, tag));
  const solidLeafTags = SOLID_POLY_LEAF_TAGS.filter((tag) => leafTags.includes(tag));
  return {
    hasCamera: matchesOrContains(root, ".polycss-camera"),
    hasScene: matchesOrContains(root, ".polycss-scene"),
    hasMesh: matchesOrContains(root, ".polycss-mesh"),
    hasFpvHost: matchesOrContains(root, ".polycss-fpv-host"),
    hasBucket: matchesOrContains(root, ".polycss-bucket"),
    hasVoxelMesh: matchesOrContains(root, ".polycss-voxel-mesh"),
    hasTransformGizmo: matchesOrContains(root, ".polycss-transform-gizmo"),
    hasTransformRing: matchesOrContains(root, ".polycss-transform-ring"),
    hasDynamicLighting: matchesOrContains(root, '.polycss-scene[data-polycss-lighting="dynamic"]'),
    hasQ: containsTag(root, "q"),
    leafTags,
    solidLeafTags,
  };
}

function selectorList(tags: readonly string[], prefix = ".polycss-scene "): string {
  return tags.map((tag) => `${prefix}${tag}`).join(",\n");
}

function directLeafSelectorList(tags: readonly string[]): string {
  return tags
    .map((tag) => `.polycss-scene[data-polycss-lighting="dynamic"] :not(.polycss-bucket) > ${tag}`)
    .join(",\n");
}

function dynamicPropertyCss(includeShadowProjection: boolean): string {
  const props = [
    '@property --plx { syntax: "<number>"; inherits: true; initial-value: 0; }',
    '@property --ply { syntax: "<number>"; inherits: true; initial-value: 0; }',
    '@property --plz { syntax: "<number>"; inherits: true; initial-value: 1; }',
    '@property --plr { syntax: "<number>"; inherits: true; initial-value: 1; }',
    '@property --plg { syntax: "<number>"; inherits: true; initial-value: 1; }',
    '@property --plb { syntax: "<number>"; inherits: true; initial-value: 1; }',
    '@property --pli { syntax: "<number>"; inherits: true; initial-value: 1; }',
    '@property --par { syntax: "<number>"; inherits: true; initial-value: 1; }',
    '@property --pag { syntax: "<number>"; inherits: true; initial-value: 1; }',
    '@property --pab { syntax: "<number>"; inherits: true; initial-value: 1; }',
    '@property --pai { syntax: "<number>"; inherits: true; initial-value: 0.4; }',
    '@property --pnx { syntax: "<number>"; inherits: true; initial-value: 0; }',
    '@property --pny { syntax: "<number>"; inherits: true; initial-value: 0; }',
    '@property --pnz { syntax: "<number>"; inherits: true; initial-value: 1; }',
    '@property --psr { syntax: "<number>"; inherits: true; initial-value: 1; }',
    '@property --psg { syntax: "<number>"; inherits: true; initial-value: 1; }',
    '@property --psb { syntax: "<number>"; inherits: true; initial-value: 1; }',
    '@property --plam { syntax: "<number>"; inherits: true; initial-value: 0; }',
  ];
  if (includeShadowProjection) {
    props.push(
      '@property --clx { syntax: "<number>"; inherits: true; initial-value: 0.01; }',
      '@property --cly { syntax: "<number>"; inherits: true; initial-value: 0; }',
      '@property --clz { syntax: "<number>"; inherits: true; initial-value: 1; }',
      '@property --shadow-ground-cssz { syntax: "<number>"; inherits: true; initial-value: 0; }',
    );
  }
  return props.join("\n");
}

function buildDynamicLightingCss(features: SnapshotCssFeatures): string {
  const parts = [dynamicPropertyCss(features.hasQ)];

  if (features.hasBucket) {
    parts.push(`
.polycss-scene[data-polycss-lighting="dynamic"] .polycss-bucket {
  --plam: max(0, calc(
    var(--pnx) * var(--plx) +
    var(--pny) * var(--ply) +
    var(--pnz) * var(--plz)
  ));
}
`);
  }

  if (features.leafTags.length > 0) {
    parts.push(`
${directLeafSelectorList(features.leafTags)} {
  --plam: max(0, calc(
    var(--pnx) * var(--plx) +
    var(--pny) * var(--ply) +
    var(--pnz) * var(--plz)
  ));
}
`);
  }

  if (features.leafTags.includes("s")) {
    parts.push(`
.polycss-scene[data-polycss-lighting="dynamic"] s {
  contain: strict;
  background-color: rgb(
    calc(255 * (var(--par) * var(--pai)
         + var(--plr) * var(--pli) * var(--plam)))
    calc(255 * (var(--pag) * var(--pai)
         + var(--plg) * var(--pli) * var(--plam)))
    calc(255 * (var(--pab) * var(--pai)
         + var(--plb) * var(--pli) * var(--plam)))
  );
  background-blend-mode: multiply;
  background-image: var(--polycss-atlas-url);
  background-position: var(--polycss-atlas-position);
  background-repeat: no-repeat;
  background-size: var(--polycss-atlas-image-size);
  mask-image: var(--polycss-atlas-url);
  mask-mode: alpha;
  mask-position: var(--polycss-atlas-position);
  mask-repeat: no-repeat;
  mask-size: var(--polycss-atlas-image-size);
  -webkit-mask-image: var(--polycss-atlas-url);
  -webkit-mask-position: var(--polycss-atlas-position);
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-size: var(--polycss-atlas-image-size);
}
`);
  }

  if (features.solidLeafTags.length > 0) {
    parts.push(`
${selectorList(features.solidLeafTags)} {
  color: rgb(
    calc(255 * var(--psr) * (var(--par) * var(--pai)
         + var(--plr) * var(--pli) * var(--plam)))
    calc(255 * var(--psg) * (var(--pag) * var(--pai)
         + var(--plg) * var(--pli) * var(--plam)))
    calc(255 * var(--psb) * (var(--pab) * var(--pai)
         + var(--plb) * var(--pli) * var(--plam)))
  );
}
`);
  }

  if (features.hasQ) {
    parts.push(`
.polycss-scene[data-polycss-lighting="dynamic"] {
  --shadow-proj: matrix3d(
    1, 0, 0, 0,
    0, 1, 0, 0,
    calc(-1 * var(--clx) / var(--clz)),
    calc(-1 * var(--cly) / var(--clz)),
    0.01,
    0,
    calc(var(--shadow-ground-cssz) * var(--clx) / var(--clz)),
    calc(var(--shadow-ground-cssz) * var(--cly) / var(--clz)),
    calc(var(--shadow-ground-cssz) * 0.99),
    1
  );
}

.polycss-scene[data-polycss-lighting="dynamic"] q {
  opacity: clamp(0, calc((var(--pnx) * var(--clx) + var(--pny) * var(--cly) + var(--pnz) * var(--clz)) * 10), 1);
}
`);
  }

  return parts.join("\n");
}

function buildPolySnapshotCss(features: SnapshotCssFeatures): string {
  const parts = [SNAPSHOT_DOCUMENT_CSS];

  if (features.hasScene) {
    parts.push(`
.polycss-scene,
.polycss-scene *,
.polycss-scene *::before,
.polycss-scene *::after {
  box-sizing: border-box;
}

.polycss-scene {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
}
`);
  }

  if (features.hasCamera) {
    parts.push(`
.polycss-camera {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
}
`);
  }

  if (features.hasFpvHost) {
    parts.push(`
.polycss-fpv-host {
  perspective: var(--polycss-fpv-perspective, 2000px) !important;
  transform-style: preserve-3d !important;
}
`);
  }

  if (features.hasMesh) {
    parts.push(`
.polycss-mesh {
  position: absolute;
  transform-style: preserve-3d;
}
`);
  }

  if (features.hasBucket) {
    parts.push(`
.polycss-bucket {
  position: absolute;
  transform-style: preserve-3d;
}
`);
  }

  if (features.leafTags.length > 0) {
    parts.push(`
${selectorList(features.leafTags)} {
  position: absolute;
  display: block;
  transform-origin: 0 0;
  transform-style: preserve-3d;
  margin: 0;
  padding: 0;
  font: inherit;
  font-weight: normal;
  font-style: normal;
  line-height: 0;
  text-decoration: none;
  backface-visibility: hidden;
  background-repeat: no-repeat;
}
`);
  }

  if (features.solidLeafTags.length > 0 && !features.hasDynamicLighting) {
    parts.push(`
${selectorList(features.solidLeafTags)} {
  color: currentColor;
}
`);
  }

  if (features.leafTags.includes("b")) {
    parts.push(`
.polycss-scene b {
  background: currentColor;
  width: 64px;
  height: 64px;
}
`);
  }

  if (features.hasVoxelMesh) {
    parts.push(`
.polycss-mesh.polycss-voxel-mesh > .polycss-voxel-face {
  position: absolute;
  display: block;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
  transform-origin: 0 0;
  margin: 0;
  padding: 0;
  font: inherit;
  line-height: 0;
  pointer-events: none;
}

.polycss-mesh.polycss-voxel-mesh > .polycss-voxel-face > b {
  top: 0;
  left: 0;
  width: var(--polycss-voxel-primitive, 1px);
  height: var(--polycss-voxel-primitive, 1px);
  backface-visibility: visible;
  pointer-events: none;
}
`);
  }

  if (features.leafTags.includes("i")) {
    parts.push(`
.polycss-scene i {
  width: 16px;
  height: 16px;
  border-color: currentColor;
}
`);
  }

  if (features.leafTags.includes("s")) {
    parts.push(`
.polycss-scene s {
  width: 64px;
  height: 64px;
}
`);
  }

  if (features.leafTags.includes("u")) {
    parts.push(`
.polycss-scene u {
  width: 0;
  height: 0;
  background: transparent;
  box-sizing: content-box;
  border: 0 solid transparent;
  border-color: transparent transparent currentColor transparent;
  border-width: 0 16px 32px 16px;
}

@supports (corner-top-left-shape: bevel) and (corner-top-right-shape: bevel) {
  .polycss-scene > u,
  .polycss-mesh > u,
  .polycss-bucket > u {
    border-width: 0;
    width: 32px;
    height: 32px;
    background-color: currentColor;
    border-top-left-radius: 50% 100%;
    border-top-right-radius: 50% 100%;
    corner-top-left-shape: bevel;
    corner-top-right-shape: bevel;
  }

  .polycss-scene > u.polycss-corner-shape-solid,
  .polycss-mesh > u.polycss-corner-shape-solid,
  .polycss-bucket > u.polycss-corner-shape-solid {
    width: 16px;
    height: 16px;
    box-sizing: border-box;
    border: 0;
    background: currentColor;
    border-radius: 0;
    corner-top-left-shape: initial;
    corner-top-right-shape: initial;
    corner-bottom-right-shape: initial;
    corner-bottom-left-shape: initial;
  }
}
`);
  }

  if (features.hasQ) {
    parts.push(`
.polycss-scene q {
  position: absolute;
  display: block;
  transform-origin: 0 0;
  transform-style: preserve-3d;
  margin: 0;
  padding: 0;
  font: inherit;
  font-weight: normal;
  font-style: normal;
  line-height: 0;
  text-decoration: none;
  backface-visibility: visible;
  border-color: currentColor;
  pointer-events: none;
}

.polycss-scene q::before,
.polycss-scene q::after {
  content: none;
}
`);
  }

  if (features.hasTransformGizmo) {
    const tags = features.leafTags.length > 0 ? features.leafTags : POLY_LEAF_TAGS;
    parts.push(`
${selectorList(tags, ".polycss-mesh.polycss-transform-gizmo ")} {
  backface-visibility: visible;
  transition: color 150ms ease-out, border-color 150ms ease-out, background-color 150ms ease-out;
}
`);
  }

  if (features.hasTransformRing) {
    const tags = features.leafTags.length > 0 ? features.leafTags : POLY_LEAF_TAGS;
    parts.push(`
${selectorList(tags, ".polycss-mesh.polycss-transform-ring ")} {
  --ring-inner-r: calc(var(--ring-inner-ratio, 0.92) * 50%);
  --ring-outer-r: calc(var(--ring-outer-ratio, 1) * 50%);
  -webkit-mask: radial-gradient(circle at 50% 50%,
    transparent 0%,
    transparent var(--ring-inner-r),
    black var(--ring-inner-r),
    black var(--ring-outer-r),
    transparent var(--ring-outer-r));
          mask: radial-gradient(circle at 50% 50%,
    transparent 0%,
    transparent var(--ring-inner-r),
    black var(--ring-inner-r),
    black var(--ring-outer-r),
    transparent var(--ring-outer-r));
}
`);
  }

  if (features.hasDynamicLighting) {
    parts.push(buildDynamicLightingCss(features));
  }

  return parts.map((part) => part.trim()).filter(Boolean).join("\n\n");
}

function inlineStyleFor(el: Element): CSSStyleDeclaration | null {
  const value = (el as unknown as ElementCSSInlineStyle).style;
  return value && typeof value.getPropertyValue === "function" ? value : null;
}

function cleanupEmptyStyleAttr(el: Element): void {
  const style = el.getAttribute("style");
  if (style !== null && style.trim() === "") el.removeAttribute("style");
}

function inheritedInlineCustomProperty(el: Element, property: string): string {
  let current: Element | null = el;
  while (current) {
    const value = inlineStyleFor(current)?.getPropertyValue(property).trim();
    if (value) return value;
    current = current.parentElement;
  }
  return "";
}

function inlineSnapshotStaticStyleHints(
  sourceRoot: Element,
  cloneRoot: Element,
  features: SnapshotCssFeatures,
): void {
  const sourceElements = allElements(sourceRoot);
  const cloneElements = allElements(cloneRoot);
  for (let i = 0; i < cloneElements.length; i++) {
    const sourceEl = sourceElements[i];
    const cloneEl = cloneElements[i];
    if (!sourceEl || !cloneEl) continue;
    const cloneStyle = inlineStyleFor(cloneEl);
    if (!cloneStyle) continue;

    if (cloneEl.classList.contains("polycss-mesh")) {
      const origin = cloneStyle.getPropertyValue("--origin").trim();
      if (origin) {
        cloneStyle.setProperty("transform-origin", origin);
        cloneStyle.removeProperty("--origin");
      }
    }

    const tag = cloneEl.tagName.toLowerCase();
    if (tag === "s") {
      const atlasSize = cloneStyle.getPropertyValue("--polycss-atlas-size").trim();
      if (atlasSize) {
        cloneStyle.setProperty("width", atlasSize);
        cloneStyle.setProperty("height", atlasSize);
      }
      if (!features.hasDynamicLighting) {
        for (const property of ATLAS_CUSTOM_PROPS) {
          cloneStyle.removeProperty(property);
        }
      } else {
        cloneStyle.removeProperty("--polycss-atlas-size");
      }
    } else if (tag === "b" || tag === "i" || tag === "u") {
      const paint = inheritedInlineCustomProperty(sourceEl, "--polycss-paint");
      const computedColor = !features.hasDynamicLighting
        ? sourceEl.ownerDocument.defaultView?.getComputedStyle(sourceEl).color
        : "";
      if (computedColor) {
        cloneStyle.setProperty("color", computedColor);
      } else if (paint && !cloneStyle.getPropertyValue("color")) {
        cloneStyle.setProperty("color", paint);
      }
    }

    if (!features.hasDynamicLighting) {
      for (const property of LIGHTING_CUSTOM_PROPS) {
        cloneStyle.removeProperty(property);
      }
    }
    if (!features.hasQ) {
      for (const property of SHADOW_CUSTOM_PROPS) {
        cloneStyle.removeProperty(property);
      }
    }
    cloneStyle.removeProperty("will-change");
    cloneStyle.removeProperty("--polycss-paint");
    cleanupEmptyStyleAttr(cloneEl);
  }
}

function sanitizeClone(root: Element): void {
  for (const script of Array.from(root.querySelectorAll("script"))) {
    script.remove();
  }

  for (const el of allElements(root)) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith("on")) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

function isInlineOrLocalReference(url: string): boolean {
  const value = url.trim();
  return value === "" || value.startsWith("#") || /^data:/i.test(value);
}

function inlineAssetKey(rawUrl: string, ctx: InlineContext): string {
  if (/^data:/i.test(rawUrl.trim())) return rawUrl.trim();
  return resolveAssetUrl(rawUrl, ctx.baseUrl);
}

function extractCssUrl(value: string): string | null {
  const match = /url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/i.exec(value);
  return (match?.[2] ?? match?.[3] ?? "").trim() || null;
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ");
}

function resolveAssetUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    throw new PolySceneSnapshotError(
      "ASSET_INLINE_FAILED",
      `exportPolySceneSnapshot: could not resolve asset URL "${url}".`,
      url,
    );
  }
}

function inferMimeType(url: string): string {
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();

  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".avif")) return "image/avif";
  return "application/octet-stream";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function isObjectUrl(url: string): boolean {
  return /^(blob|filesystem):/i.test(url.trim());
}

function loadBlobViaXhr(url: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "blob";
    xhr.onload = () => {
      // Object URLs report status 0 on success; treat that as OK.
      if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
        resolve(xhr.response as Blob);
      } else {
        reject(new Error(`XHR ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("XHR request failed"));
    xhr.send();
  });
}

async function loadAssetBlob(url: string): Promise<Blob> {
  // Object URLs (blob:/filesystem:) are same-document; a credentials mode is
  // meaningless for them and trips some WebKit builds, so omit it there.
  const objectUrl = isObjectUrl(url);
  try {
    if (typeof fetch !== "function") {
      throw new Error("fetch is not available");
    }
    const response = await fetch(url, objectUrl ? undefined : { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.blob();
  } catch (error) {
    // WebKit/Safari intermittently fails to fetch() object URLs ("Load
    // failed"); XMLHttpRequest is the reliable fallback for same-document
    // object URLs and is why a textured/atlas export breaks only on Safari.
    if (objectUrl && typeof XMLHttpRequest === "function") {
      return loadBlobViaXhr(url);
    }
    throw error;
  }
}

async function inlineAssetUrl(rawUrl: string, ctx: InlineContext): Promise<string> {
  if (isInlineOrLocalReference(rawUrl)) return rawUrl;

  const resolvedUrl = resolveAssetUrl(rawUrl, ctx.baseUrl);
  const cached = ctx.cache.get(resolvedUrl);
  if (cached) return cached;

  const next = (async () => {
    try {
      const blob = await loadAssetBlob(resolvedUrl);
      const mime = blob.type || inferMimeType(resolvedUrl);
      const base64 = arrayBufferToBase64(await blob.arrayBuffer());
      return `data:${mime};base64,${base64}`;
    } catch {
      throw new PolySceneSnapshotError(
        "ASSET_INLINE_FAILED",
        `exportPolySceneSnapshot: could not inline asset "${resolvedUrl}".`,
        resolvedUrl,
      );
    }
  })();

  ctx.cache.set(resolvedUrl, next);
  return next;
}

async function inlineCssUrls(cssText: string, ctx: InlineContext): Promise<string> {
  const urlPattern = /url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi;
  let output = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(cssText)) !== null) {
    output += cssText.slice(lastIndex, match.index);
    const rawUrl = (match[2] ?? match[3] ?? "").trim();
    const inlinedUrl = await inlineAssetUrl(rawUrl, ctx);
    output += isInlineOrLocalReference(rawUrl) ? match[0] : `url("${inlinedUrl}")`;
    lastIndex = urlPattern.lastIndex;
  }

  return output + cssText.slice(lastIndex);
}

async function inlineCloneStyleUrls(root: Element, ctx: InlineContext): Promise<void> {
  for (const el of allElements(root)) {
    const style = el.getAttribute("style");
    if (style) {
      el.setAttribute("style", await inlineCssUrls(style, ctx));
    }
  }

  for (const styleEl of Array.from(root.querySelectorAll("style"))) {
    styleEl.textContent = await inlineCssUrls(styleEl.textContent ?? "", ctx);
  }
}

function backgroundLonghands(style: CSSStyleDeclaration): {
  position: string;
  size: string;
  repeat: string;
} {
  return {
    position: style.getPropertyValue("background-position").trim(),
    size: style.getPropertyValue("background-size").trim(),
    repeat: style.getPropertyValue("background-repeat").trim(),
  };
}

function restoreBackgroundLonghands(
  style: CSSStyleDeclaration,
  values: ReturnType<typeof backgroundLonghands>,
): void {
  if (values.position) style.setProperty("background-position", values.position);
  if (values.size) style.setProperty("background-size", values.size);
  if (values.repeat) style.setProperty("background-repeat", values.repeat);
}

async function compactSharedInlineAssets(root: Element, ctx: InlineContext): Promise<string> {
  const rules: SnapshotAssetRule[] = [];
  const assetIds = new Map<string, string>();
  const assetDataUrls = new Map<string, string>();

  const assetIdFor = async (rawUrl: string): Promise<string> => {
    const key = inlineAssetKey(rawUrl, ctx);
    const existing = assetIds.get(key);
    if (existing) return existing;
    const id = `a${assetIds.size}`;
    assetIds.set(key, id);
    assetDataUrls.set(key, await inlineAssetUrl(rawUrl, ctx));
    return id;
  };

  const dataUrlForId = (id: string): string => {
    for (const [key, candidateId] of assetIds) {
      if (candidateId === id) return assetDataUrls.get(key) ?? "";
    }
    return "";
  };

  for (const el of allElements(root)) {
    const style = inlineStyleFor(el);
    if (!style || el.tagName.toLowerCase() !== "s") continue;

    const atlasUrl = extractCssUrl(style.getPropertyValue("--polycss-atlas-url"));
    if (atlasUrl && !atlasUrl.startsWith("#")) {
      const id = await assetIdFor(atlasUrl);
      const attr = "data-polycss-snapshot-atlas";
      el.setAttribute(attr, id);
      style.removeProperty("--polycss-atlas-url");
      rules.push({
        attr,
        value: id,
        property: "--polycss-atlas-url",
        dataUrl: dataUrlForId(id),
      });
    }

    const backgroundUrl = extractCssUrl(style.getPropertyValue("background-image"));
    if (!backgroundUrl || backgroundUrl.startsWith("#")) continue;
    const id = await assetIdFor(backgroundUrl);
    const attr = "data-polycss-snapshot-bg";
    const longhands = backgroundLonghands(style);
    el.setAttribute(attr, id);
    style.removeProperty("background");
    style.removeProperty("background-image");
    restoreBackgroundLonghands(style, longhands);
    rules.push({
      attr,
      value: id,
      property: "background-image",
      dataUrl: dataUrlForId(id),
    });
    cleanupEmptyStyleAttr(el);
  }

  const seenRules = new Set<string>();
  return rules
    .filter((rule) => {
      const key = `${rule.attr}|${rule.value}|${rule.property}`;
      if (seenRules.has(key)) return false;
      seenRules.add(key);
      return true;
    })
    .map((rule) => (
      `.polycss-scene [${rule.attr}="${rule.value}"] {\n` +
      `  ${rule.property}: url("${escapeCssString(rule.dataUrl)}");\n` +
      "}"
    ))
    .join("\n\n");
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeStyleText(cssText: string): string {
  return cssText.replace(/<\/style/gi, "<\\/style");
}

function snapshotBaseUrl(doc: Document): string {
  return doc.baseURI || doc.URL || doc.defaultView?.location.href || "http://localhost/";
}

/**
 * Serialize the current rendered PolyCSS DOM into a standalone HTML document.
 * The snapshot is intentionally static: it preserves the scene's current DOM,
 * inlines CSS image assets, and emits no scripts or PolyCSS runtime imports.
 */
export async function exportPolySceneSnapshot(target: Element): Promise<string> {
  if (!isElement(target)) {
    throw new PolySceneSnapshotError(
      "INVALID_TARGET",
      "exportPolySceneSnapshot: target must be an Element.",
    );
  }

  const root = findPolySnapshotRoot(target);
  if (!root) {
    throw new PolySceneSnapshotError(
      "SCENE_NOT_FOUND",
      "exportPolySceneSnapshot: target is not inside and does not contain a rendered PolyCSS scene.",
    );
  }

  const doc = target.ownerDocument;
  const ctx: InlineContext = {
    baseUrl: snapshotBaseUrl(doc),
    cache: new Map(),
  };
  const clone = root.cloneNode(true) as Element;
  const features = collectSnapshotCssFeatures(clone);

  inlineSnapshotStaticStyleHints(root, clone, features);
  sanitizeClone(clone);
  const assetCss = await compactSharedInlineAssets(clone, ctx);
  await inlineCloneStyleUrls(clone, ctx);

  const baseCss = await inlineCssUrls(
    [buildPolySnapshotCss(features), assetCss].filter(Boolean).join("\n\n"),
    ctx,
  );
  const title = doc.title ? `<title>${escapeHtmlText(doc.title)}</title>` : "";

  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    title,
    `<style>${escapeStyleText(baseCss)}</style>`,
    "</head>",
    "<body>",
    clone.outerHTML,
    "</body>",
    "</html>",
  ].filter(Boolean).join("");
}
