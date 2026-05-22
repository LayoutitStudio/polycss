import type { PolyTextureLightingMode } from "@layoutit/polycss-core";
import {
  filterAtlasPlans as filterAtlasPlansCore,
  getSolidPaintDefaultsForPlansCore,
  packTextureAtlasPlansWithScaleCore,
  safariCssProjectiveUnsupported,
  expandClipPoints,
  parseHex,
  rgbKey,
  tintToCss,
  TEXTURE_TRIANGLE_BLEED,
  TEXTURE_EDGE_REPAIR_ALPHA_MIN,
  TEXTURE_EDGE_REPAIR_SOURCE_ALPHA_MIN,
  TEXTURE_EDGE_REPAIR_RADIUS,
} from "@layoutit/polycss-core";
import type {
  TextureAtlasPlan,
  PackedTextureAtlasEntry,
  PackedPage,
  TextureAtlasPage,
  PackedAtlas,
  TextureQuality,
  PolyRenderStrategy,
  PolyRenderStrategiesOption,
  SolidPaintDefaults,
  RGBFactors,
  UvSampleRect,
} from "@layoutit/polycss-core";

// ---------------------------------------------------------------------------
// Browser-capability detection (copied from packages/polycss/src/render/atlas/strategy.ts)
// ---------------------------------------------------------------------------

export function borderShapeSupported(doc: Document): boolean {
  const css = doc.defaultView?.CSS ?? (typeof CSS !== "undefined" ? CSS : undefined);
  const supportsBorderShape = !!css?.supports?.(
    "border-shape",
    "polygon(0 0, 100% 0, 0 100%) circle(0)",
  );
  if (!supportsBorderShape) return false;

  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : undefined);
  const media = win?.matchMedia;
  if (!media) return true;

  return media("(pointer: fine)").matches && media("(hover: hover)").matches;
}

export function solidTriangleSupported(doc: Document): boolean {
  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : undefined);
  const userAgent = win?.navigator?.userAgent ?? "";
  if (!userAgent) return true;

  return !safariCssProjectiveUnsupported(userAgent);
}

export function cornerShapeSupported(doc: Document): boolean {
  const css = doc.defaultView?.CSS ?? (typeof CSS !== "undefined" ? CSS : undefined);
  return !!css?.supports?.("corner-top-left-shape", "bevel") &&
    !!css.supports("corner-top-right-shape", "bevel") &&
    !!css.supports("corner-bottom-right-shape", "bevel") &&
    !!css.supports("corner-bottom-left-shape", "bevel");
}

export function cornerTriangleSupported(doc: Document): boolean {
  const css = doc.defaultView?.CSS ?? (typeof CSS !== "undefined" ? CSS : undefined);
  return !!css?.supports?.("corner-top-left-shape", "bevel") &&
    !!css.supports("corner-top-right-shape", "bevel");
}

export function projectiveQuadSupported(doc: Document): boolean {
  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : undefined);
  const userAgent = win?.navigator?.userAgent ?? "";
  if (!userAgent) return true;

  return !safariCssProjectiveUnsupported(userAgent);
}

export function getSolidPaintDefaultsForPlans(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  strategies?: PolyRenderStrategiesOption,
  cornerShapeGeometryForPlanFn?: (plan: TextureAtlasPlan) => unknown,
): SolidPaintDefaults {
  const disabled = new Set(strategies?.disable ?? []);
  return getSolidPaintDefaultsForPlansCore(
    plans,
    textureLighting,
    disabled,
    {
      solidTriangleSupported: solidTriangleSupported(doc),
      projectiveQuadSupported: projectiveQuadSupported(doc),
      cornerShapeSupported: cornerShapeSupported(doc),
      borderShapeSupported: borderShapeSupported(doc),
    },
    parseHex,
    rgbKey,
    cornerShapeGeometryForPlanFn,
  );
}

export function getSolidPaintDefaultsFromPlans(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  disabled: ReadonlySet<PolyRenderStrategy> = new Set(),
  doc?: Document | null,
): SolidPaintDefaults {
  const resolvedDoc = doc ?? (typeof document !== "undefined" ? document : null);
  if (!resolvedDoc) return {};
  const strategies: PolyRenderStrategiesOption | undefined =
    disabled.size > 0 ? { disable: Array.from(disabled) as PolyRenderStrategy[] } : undefined;
  return getSolidPaintDefaultsForPlans(plans, textureLighting, resolvedDoc, strategies);
}

/**
 * Returns true when the browser supports the `border-shape` CSS property and
 * the pointer/hover media queries indicate a fine-pointer device (desktop-class).
 * Falls back to a globalThis-based check when no Document is available.
 */
export function isBorderShapeSupported(doc?: Document | null): boolean {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  if (!d) {
    const css = typeof CSS !== "undefined" ? CSS : undefined;
    const supportsBorderShape = !!css?.supports?.("border-shape", "polygon(0 0, 100% 0, 0 100%) circle(0)");
    if (!supportsBorderShape) return false;
    const media = typeof matchMedia !== "undefined" ? matchMedia : undefined;
    if (!media) return true;
    return media("(pointer: fine)").matches && media("(hover: hover)").matches;
  }
  return borderShapeSupported(d);
}

/**
 * Returns true when the browser renders CSS border-trick triangles correctly.
 * WebKit/Safari renders them incorrectly when transformed — this check gates
 * the `<u>` strategy path.
 */
export function isSolidTriangleSupported(doc?: Document | null): boolean {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  if (!d) {
    const userAgent = (typeof navigator !== "undefined" ? navigator : globalThis.navigator)?.userAgent ?? "";
    if (!userAgent) return true;
    const isChromiumFamily = /\b(?:Chrome|HeadlessChrome|Chromium|Edg|OPR)\//.test(userAgent);
    const isSafariFamily = /\bVersion\/[\d.]+.*\bSafari\//.test(userAgent);
    return !isSafariFamily || isChromiumFamily;
  }
  return solidTriangleSupported(d);
}

/**
 * Filter a plan array to the subset that needs atlas packing, given the active
 * render strategies and texture-lighting mode. Plans excluded from the atlas
 * will be rendered via `<b>`, `<i>`, or `<u>` by the framework components.
 */
export function filterAtlasPlans(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  disabled: ReadonlySet<PolyRenderStrategy>,
  doc?: Document | null,
): Array<TextureAtlasPlan | null> {
  return filterAtlasPlansCore(plans, textureLighting, disabled, {
    solidTriangleSupported: isSolidTriangleSupported(doc),
    borderShapeSupported: isBorderShapeSupported(doc),
  });
}

// ---------------------------------------------------------------------------
// Atlas packing (copied from packages/polycss/src/render/atlas/packing.ts)
// ---------------------------------------------------------------------------

export function isMobileDocument(doc: Document | null | undefined): boolean {
  if (!doc) return false;
  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : undefined);
  const media = win?.matchMedia;
  if (!media) return false;
  // Same device-class heuristic as borderShapeSupported: coarse pointer or
  // no hover capability = phone/tablet, which has a tight GPU-memory budget
  // for composited 3D layers.
  return media("(pointer: coarse)").matches || media("(hover: none)").matches;
}

export function packTextureAtlasPlansWithScale(
  plans: Array<TextureAtlasPlan | null>,
  textureQualityInput: TextureQuality | undefined,
  doc: Document | null | undefined,
): { packed: PackedAtlas; atlasScale: number; atlasCanonicalSize: number } {
  return packTextureAtlasPlansWithScaleCore(plans, textureQualityInput, isMobileDocument(doc));
}

// ---------------------------------------------------------------------------
// Atlas rasterisation (copied from packages/polycss/src/render/atlas/rasterise.ts)
// ---------------------------------------------------------------------------

export const TEXTURE_IMAGE_CACHE = new Map<string, Promise<HTMLImageElement>>();

export function loadTextureImage(url: string): Promise<HTMLImageElement> {
  let p = TEXTURE_IMAGE_CACHE.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      // Request CORS so cross-origin textures can be drawn to the atlas canvas
      // without tainting it (atlas rasterisation reads pixels via toBlob /
      // getImageData). Same-origin loads ignore the attribute; cross-origin
      // servers need `Access-Control-Allow-Origin` set, which is standard for
      // public CDNs like esm.sh / polycss.com.
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`texture load failed: ${url}`));
      img.src = url;
    });
    TEXTURE_IMAGE_CACHE.set(url, p);
    p.then(
      () => {
        if (TEXTURE_IMAGE_CACHE.get(url) === p) TEXTURE_IMAGE_CACHE.delete(url);
      },
      () => {
        if (TEXTURE_IMAGE_CACHE.get(url) === p) TEXTURE_IMAGE_CACHE.delete(url);
      },
    );
  }
  return p;
}

export function setCssTransform(
  ctx: CanvasRenderingContext2D,
  atlasScale: number,
  a = 1,
  b = 0,
  c = 0,
  d = 1,
  e = 0,
  f = 0,
): void {
  ctx.setTransform(
    a * atlasScale,
    b * atlasScale,
    c * atlasScale,
    d * atlasScale,
    e * atlasScale,
    f * atlasScale,
  );
}

export function applyTextureTint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  tint: RGBFactors,
  atlasScale: number,
): void {
  if (
    Math.abs(tint.r - 1) < 0.001 &&
    Math.abs(tint.g - 1) < 0.001 &&
    Math.abs(tint.b - 1) < 0.001
  ) {
    return;
  }
  ctx.save();
  setCssTransform(ctx, atlasScale);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = tintToCss(tint);
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  atlasScale: number,
): void {
  const srcW = img.naturalWidth || img.width || 1;
  const srcH = img.naturalHeight || img.height || 1;
  const scale = Math.max(width / srcW, height / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  setCssTransform(ctx, atlasScale);
  ctx.drawImage(img, x + (width - drawW) / 2, y + (height - drawH) / 2, drawW, drawH);
}

function clampSourceCoord(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

export function drawImageUvSample(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rect: UvSampleRect,
  x: number,
  y: number,
  width: number,
  height: number,
  atlasScale: number,
): void {
  const imgW = img.naturalWidth || img.width || 1;
  const imgH = img.naturalHeight || img.height || 1;
  const rawX0 = clampSourceCoord(Math.min(rect.minU, rect.maxU) * imgW, imgW);
  const rawX1 = clampSourceCoord(Math.max(rect.minU, rect.maxU) * imgW, imgW);
  const rawY0 = clampSourceCoord(Math.min(rect.minV, rect.maxV) * imgH, imgH);
  const rawY1 = clampSourceCoord(Math.max(rect.minV, rect.maxV) * imgH, imgH);

  let sx = Math.floor(rawX0);
  let sy = Math.floor(rawY0);
  let sw = Math.ceil(rawX1) - sx;
  let sh = Math.ceil(rawY1) - sy;

  if (sw < 1) {
    sx = Math.floor(clampSourceCoord(((rect.minU + rect.maxU) / 2) * imgW, imgW - 1));
    sw = 1;
  }
  if (sh < 1) {
    sy = Math.floor(clampSourceCoord(((rect.minV + rect.maxV) / 2) * imgH, imgH - 1));
    sh = 1;
  }
  sx = Math.max(0, Math.min(imgW - 1, sx));
  sy = Math.max(0, Math.min(imgH - 1, sy));
  sw = Math.max(1, Math.min(imgW - sx, sw));
  sh = Math.max(1, Math.min(imgH - sy, sh));

  setCssTransform(ctx, atlasScale);
  ctx.drawImage(img, sx, sy, sw, sh, x, y, width, height);
}

export function tracePolygonPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  points: number[],
): void {
  for (let i = 0; i < points.length; i += 2) {
    const px = x + points[i];
    const py = y + points[i + 1];
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function traceOffsetPolygonPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  points: number[],
  offsetX: number,
  offsetY: number,
): void {
  for (let i = 0; i < points.length; i += 2) {
    const px = x + points[i] + offsetX;
    const py = y + points[i + 1] + offsetY;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function paintSolidAtlasEntry(
  ctx: CanvasRenderingContext2D,
  entry: PackedTextureAtlasEntry,
  textureLighting: PolyTextureLightingMode,
  atlasScale: number,
): void {
  setCssTransform(ctx, atlasScale);
  ctx.beginPath();
  tracePolygonPath(ctx, entry.x, entry.y, entry.screenPts);
  ctx.clip();
  setCssTransform(ctx, atlasScale);
  // Dynamic mode multiplies the tint at render time via background-blend-mode,
  // so the atlas keeps the polygon's unshaded base color.
  ctx.fillStyle = textureLighting === "dynamic"
    ? (entry.polygon.color ?? "#cccccc")
    : entry.shadedColor;
  ctx.fillRect(entry.x, entry.y, entry.canvasW, entry.canvasH);
}

export function drawTexturedAtlasEntry(
  ctx: CanvasRenderingContext2D,
  entry: PackedTextureAtlasEntry,
  srcImg: HTMLImageElement,
  atlasScale: number,
  offsetX = 0,
  offsetY = 0,
): void {
  if (entry.textureTriangles?.length) {
    const imgW = srcImg.naturalWidth || srcImg.width || 1;
    const imgH = srcImg.naturalHeight || srcImg.height || 1;
    for (const triangle of entry.textureTriangles) {
      const clipPts = expandClipPoints(triangle.screenPts, TEXTURE_TRIANGLE_BLEED);
      ctx.save();
      setCssTransform(ctx, atlasScale);
      ctx.beginPath();
      traceOffsetPolygonPath(ctx, entry.x, entry.y, clipPts, offsetX, offsetY);
      ctx.clip();
      if (triangle.uvAffine) {
        setCssTransform(
          ctx,
          atlasScale,
          triangle.uvAffine.a / imgW, triangle.uvAffine.c / imgW,
          triangle.uvAffine.b / imgH, triangle.uvAffine.d / imgH,
          entry.x + triangle.uvAffine.e + offsetX,
          entry.y + triangle.uvAffine.f + offsetY,
        );
        ctx.drawImage(srcImg, 0, 0);
      } else if (triangle.uvSampleRect) {
        drawImageUvSample(
          ctx,
          srcImg,
          triangle.uvSampleRect,
          entry.x + offsetX,
          entry.y + offsetY,
          entry.canvasW,
          entry.canvasH,
          atlasScale,
        );
      }
      ctx.restore();
    }
  } else if (entry.uvAffine) {
    const imgW = srcImg.naturalWidth || srcImg.width || 1;
    const imgH = srcImg.naturalHeight || srcImg.height || 1;
    setCssTransform(
      ctx,
      atlasScale,
      entry.uvAffine.a / imgW, entry.uvAffine.c / imgW,
      entry.uvAffine.b / imgH, entry.uvAffine.d / imgH,
      entry.x + entry.uvAffine.e + offsetX,
      entry.y + entry.uvAffine.f + offsetY,
    );
    ctx.drawImage(srcImg, 0, 0);
  } else if (entry.uvSampleRect) {
    drawImageUvSample(
      ctx,
      srcImg,
      entry.uvSampleRect,
      entry.x + offsetX,
      entry.y + offsetY,
      entry.canvasW,
      entry.canvasH,
      atlasScale,
    );
  } else {
    drawImageCover(
      ctx,
      srcImg,
      entry.x + offsetX,
      entry.y + offsetY,
      entry.canvasW,
      entry.canvasH,
      atlasScale,
    );
  }
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function distanceToPolygonEdges(
  px: number,
  py: number,
  points: number[],
  edgeIndices: Set<number>,
): number {
  let best = Infinity;
  const count = points.length / 2;
  for (const edgeIndex of edgeIndices) {
    if (edgeIndex < 0 || edgeIndex >= count) continue;
    const i = edgeIndex * 2;
    const next = ((edgeIndex + 1) % count) * 2;
    best = Math.min(
      best,
      distanceToSegment(px, py, points[i], points[i + 1], points[next], points[next + 1]),
    );
  }
  return best;
}

function nearestOpaquePixelOffset(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): number | null {
  const minX = Math.max(0, x - radius);
  const maxX = Math.min(width - 1, x + radius);
  const minY = Math.max(0, y - radius);
  const maxY = Math.min(height - 1, y + radius);
  let bestOffset: number | null = null;
  let bestDistanceSq = Infinity;
  for (let yy = minY; yy <= maxY; yy++) {
    for (let xx = minX; xx <= maxX; xx++) {
      if (xx === x && yy === y) continue;
      const dx = xx - x;
      const dy = yy - y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > radius * radius || distanceSq >= bestDistanceSq) continue;
      const offset = (yy * width + xx) * 4;
      if (data[offset + 3] < TEXTURE_EDGE_REPAIR_SOURCE_ALPHA_MIN) continue;
      bestOffset = offset;
      bestDistanceSq = distanceSq;
    }
  }
  return bestOffset;
}

export function repairTextureEdgeAlpha(
  ctx: CanvasRenderingContext2D,
  entry: PackedTextureAtlasEntry,
  atlasScale: number,
): void {
  if (!entry.textureEdgeRepair || !entry.texture) return;
  if (!entry.textureEdgeRepairEdges || entry.textureEdgeRepairEdges.size === 0) return;
  const canvas = (ctx as CanvasRenderingContext2D & { canvas?: HTMLCanvasElement }).canvas;
  if (!canvas) return;
  const pixelX = Math.max(0, Math.floor(entry.x * atlasScale));
  const pixelY = Math.max(0, Math.floor(entry.y * atlasScale));
  const pixelW = Math.max(1, Math.min(canvas.width - pixelX, Math.ceil(entry.canvasW * atlasScale)));
  const pixelH = Math.max(1, Math.min(canvas.height - pixelY, Math.ceil(entry.canvasH * atlasScale)));
  if (pixelW <= 0 || pixelH <= 0) return;

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(pixelX, pixelY, pixelW, pixelH);
  } catch {
    return;
  }

  const data = imageData.data;
  const source = new Uint8ClampedArray(data);
  const radius = Math.max(TEXTURE_EDGE_REPAIR_RADIUS, TEXTURE_EDGE_REPAIR_RADIUS / atlasScale);
  const sourceRadius = Math.max(2, Math.ceil(radius * atlasScale) + 1);
  let changed = false;
  for (let y = 0; y < pixelH; y++) {
    for (let x = 0; x < pixelW; x++) {
      const offset = (y * pixelW + x) * 4;
      const alpha = data[offset + 3];
      if (alpha < TEXTURE_EDGE_REPAIR_ALPHA_MIN || alpha === 255) continue;
      const localX = (pixelX + x + 0.5) / atlasScale - entry.x;
      const localY = (pixelY + y + 0.5) / atlasScale - entry.y;
      if (distanceToPolygonEdges(localX, localY, entry.screenPts, entry.textureEdgeRepairEdges) > radius) {
        continue;
      }
      const sourceOffset = nearestOpaquePixelOffset(source, pixelW, pixelH, x, y, sourceRadius);
      if (sourceOffset === null) continue;
      data[offset] = source[sourceOffset];
      data[offset + 1] = source[sourceOffset + 1];
      data[offset + 2] = source[sourceOffset + 2];
      data[offset + 3] = 255;
      changed = true;
    }
  }
  if (!changed) return;
  ctx.putImageData(imageData, pixelX, pixelY);
}

export function canvasToUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  if (typeof canvas.toBlob === "function") {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob ? URL.createObjectURL(blob) : null);
      }, "image/png");
    });
  }
  try {
    return Promise.resolve(canvas.toDataURL("image/png"));
  } catch {
    return Promise.resolve(null);
  }
}

async function buildAtlasPage(
  page: PackedPage,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  atlasScale: number,
): Promise<TextureAtlasPage> {
  const canvas = doc.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(page.width * atlasScale));
  canvas.height = Math.max(1, Math.ceil(page.height * atlasScale));
  const needsReadback = page.entries.some((entry) =>
    entry.textureEdgeRepair &&
    entry.texture &&
    entry.textureEdgeRepairEdges &&
    entry.textureEdgeRepairEdges.size > 0
  );
  const ctx = canvas.getContext("2d", needsReadback ? { willReadFrequently: true } : undefined);
  if (!ctx) return { width: page.width, height: page.height, url: null };

  const uniqueTextures = Array.from(new Set(
    page.entries.flatMap((entry) => entry.texture ? [entry.texture] : []),
  ));
  const loaded = new Map<string, HTMLImageElement>();
  await Promise.all(uniqueTextures.map(async (url) => {
    loaded.set(url, await loadTextureImage(url));
  }));

  for (const entry of page.entries) {
    const srcImg = entry.texture ? loaded.get(entry.texture) : null;
    if (!entry.texture) {
      ctx.save();
      paintSolidAtlasEntry(ctx, entry, textureLighting, atlasScale);
      ctx.restore();
      continue;
    }

    if (srcImg) {
      ctx.save();
      setCssTransform(
        ctx,
        atlasScale,
      );
      ctx.beginPath();
      tracePolygonPath(ctx, entry.x, entry.y, entry.screenPts);
      ctx.clip();
      drawTexturedAtlasEntry(ctx, entry, srcImg, atlasScale);
      ctx.restore();
    }
    if (entry.texture && textureLighting === "baked") {
      ctx.save();
      setCssTransform(ctx, atlasScale);
      ctx.beginPath();
      tracePolygonPath(ctx, entry.x, entry.y, entry.screenPts);
      ctx.clip();
      applyTextureTint(ctx, entry.x, entry.y, entry.canvasW, entry.canvasH, entry.textureTint, atlasScale);
      ctx.restore();
    }
    repairTextureEdgeAlpha(ctx, entry, atlasScale);
  }

  const url = await canvasToUrl(canvas);
  canvas.width = 1;
  canvas.height = 1;

  return {
    width: page.width,
    height: page.height,
    url,
  };
}

export async function buildAtlasPages(
  pages: PackedPage[],
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  atlasScale: number,
  isCancelled: () => boolean,
): Promise<TextureAtlasPage[]> {
  const built: TextureAtlasPage[] = [];
  for (const page of pages) {
    if (isCancelled()) break;
    built.push(await buildAtlasPage(page, textureLighting, doc, atlasScale));
  }
  return built;
}
