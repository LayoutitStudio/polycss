import type { PolyTextureLightingMode, PolyTextureWrapMode } from "@layoutit/polycss-core";
import {
  TEXTURE_TRIANGLE_BLEED,
  TEXTURE_EDGE_REPAIR_ALPHA_MIN,
  TEXTURE_EDGE_REPAIR_SOURCE_ALPHA_MIN,
  TEXTURE_EDGE_REPAIR_RADIUS,
} from "@layoutit/polycss-core";
import type {
  PackedTextureAtlasEntry,
  PackedPage,
  TextureAtlasPage,
  UvSampleRect,
  RGBFactors,
} from "@layoutit/polycss-core";
import { expandClipPoints } from "@layoutit/polycss-core";
import { BASIS_EPS } from "@layoutit/polycss-core";

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

// sRGB ↔ linear helpers — duplicated here to keep applyTextureTint
// self-contained (it runs per-pixel in a hot loop). Matches the conversion
// used by shadePolygon / textureTintFactors in @layoutit/polycss-core.
function srgbByteToLinear(c: number): number {
  const u = c / 255;
  return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
}
function linearToSrgbByte(c: number): number {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
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
  // `tint` is in LINEAR light space (Three.js BRDF parity):
  //   tint = (lightColor × directScale + ambientColor × ambIntensity) / π
  // To avoid distorting the texture's color values we MUST multiply in
  // linear-light, not in sRGB (canvas's `multiply` composite is sRGB×sRGB
  // and produces noticeably brighter results for textured surfaces).
  // Decode each pixel, multiply per-channel, re-encode.
  const px = Math.round(x * atlasScale);
  const py = Math.round(y * atlasScale);
  const pw = Math.max(1, Math.round(width * atlasScale));
  const ph = Math.max(1, Math.round(height * atlasScale));
  const img = ctx.getImageData(px, py, pw, ph);
  const data = img.data;
  const tr = tint.r, tg = tint.g, tb = tint.b;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    data[i]     = linearToSrgbByte(srgbByteToLinear(data[i])     * tr);
    data[i + 1] = linearToSrgbByte(srgbByteToLinear(data[i + 1]) * tg);
    data[i + 2] = linearToSrgbByte(srgbByteToLinear(data[i + 2]) * tb);
  }
  ctx.putImageData(img, px, py);
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

function isTiledWrapMode(mode: PolyTextureWrapMode | undefined): boolean {
  return mode === "repeat" || mode === "mirrored-repeat";
}

function tiledRangeStart(mode: PolyTextureWrapMode | undefined, min: number): number {
  return isTiledWrapMode(mode) ? Math.floor(min) : 0;
}

function tiledRangeEnd(mode: PolyTextureWrapMode | undefined, max: number): number {
  return isTiledWrapMode(mode) ? Math.ceil(max) - 1 : 0;
}

function isMirroredTile(mode: PolyTextureWrapMode | undefined, tile: number): boolean {
  return mode === "mirrored-repeat" && Math.abs(tile % 2) === 1;
}

export function drawWrappedImageTiles(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  uvSampleRect: UvSampleRect | null | undefined,
  wrapS: PolyTextureWrapMode | undefined,
  wrapT: PolyTextureWrapMode | undefined,
): void {
  const startS = uvSampleRect ? tiledRangeStart(wrapS, uvSampleRect.minU) : 0;
  const endS = uvSampleRect ? tiledRangeEnd(wrapS, uvSampleRect.maxU) : 0;
  const startT = uvSampleRect ? tiledRangeStart(wrapT, uvSampleRect.minV) : 0;
  const endT = uvSampleRect ? tiledRangeEnd(wrapT, uvSampleRect.maxV) : 0;

  for (let s = startS; s <= endS; s++) {
    for (let t = startT; t <= endT; t++) {
      const flipS = isMirroredTile(wrapS, s);
      const flipT = isMirroredTile(wrapT, t);
      if (!flipS && !flipT) {
        ctx.drawImage(img, s * imgW, t * imgH);
        continue;
      }
      ctx.save();
      ctx.translate((flipS ? s + 1 : s) * imgW, (flipT ? t + 1 : t) * imgH);
      ctx.scale(flipS ? -1 : 1, flipT ? -1 : 1);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    }
  }
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

function paintOpaqueTextureBase(
  ctx: CanvasRenderingContext2D,
  entry: PackedTextureAtlasEntry,
  atlasScale: number,
  offsetX: number,
  offsetY: number,
): void {
  if (entry.polygon.textureAlphaMode !== "opaque") return;
  setCssTransform(ctx, atlasScale);
  ctx.fillStyle = entry.polygon.color ?? "#cccccc";
  ctx.fillRect(entry.x + offsetX, entry.y + offsetY, entry.canvasW, entry.canvasH);
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
      // entry.bleedRatio is stamped by computeTextureAtlasPlan from
      // resolveBleedRatio(options.seamBleed). The textured-triangle clip
      // expansion scales by it so options.seamBleed=0 fully disables it.
      const clipPts = expandClipPoints(triangle.screenPts, TEXTURE_TRIANGLE_BLEED * (entry.bleedRatio ?? 1));
      ctx.save();
      setCssTransform(ctx, atlasScale);
      ctx.beginPath();
      traceOffsetPolygonPath(ctx, entry.x, entry.y, clipPts, offsetX, offsetY);
      ctx.clip();
      paintOpaqueTextureBase(ctx, entry, atlasScale, offsetX, offsetY);
      if (triangle.uvAffine) {
        setCssTransform(
          ctx,
          atlasScale,
          triangle.uvAffine.a / imgW, triangle.uvAffine.c / imgW,
          triangle.uvAffine.b / imgH, triangle.uvAffine.d / imgH,
          entry.x + triangle.uvAffine.e + offsetX,
          entry.y + triangle.uvAffine.f + offsetY,
        );
        drawWrappedImageTiles(
          ctx,
          srcImg,
          imgW,
          imgH,
          triangle.uvSampleRect,
          entry.polygon.textureWrap?.s,
          entry.polygon.textureWrap?.t,
        );
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
    const clipOpaque = entry.polygon.textureAlphaMode === "opaque";
    if (clipOpaque) {
      ctx.save();
      setCssTransform(ctx, atlasScale);
      ctx.beginPath();
      traceOffsetPolygonPath(ctx, entry.x, entry.y, entry.screenPts, offsetX, offsetY);
      ctx.clip();
      paintOpaqueTextureBase(ctx, entry, atlasScale, offsetX, offsetY);
    }
    setCssTransform(
      ctx,
      atlasScale,
      entry.uvAffine.a / imgW, entry.uvAffine.c / imgW,
      entry.uvAffine.b / imgH, entry.uvAffine.d / imgH,
      entry.x + entry.uvAffine.e + offsetX,
      entry.y + entry.uvAffine.f + offsetY,
    );
    drawWrappedImageTiles(
      ctx,
      srcImg,
      imgW,
      imgH,
      entry.uvSampleRect,
      entry.polygon.textureWrap?.s,
      entry.polygon.textureWrap?.t,
    );
    if (clipOpaque) ctx.restore();
  } else if (entry.uvSampleRect) {
    const clipOpaque = entry.polygon.textureAlphaMode === "opaque";
    if (clipOpaque) {
      ctx.save();
      setCssTransform(ctx, atlasScale);
      ctx.beginPath();
      traceOffsetPolygonPath(ctx, entry.x, entry.y, entry.screenPts, offsetX, offsetY);
      ctx.clip();
      paintOpaqueTextureBase(ctx, entry, atlasScale, offsetX, offsetY);
    }
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
    if (clipOpaque) ctx.restore();
  } else {
    const clipOpaque = entry.polygon.textureAlphaMode === "opaque";
    if (clipOpaque) {
      ctx.save();
      setCssTransform(ctx, atlasScale);
      ctx.beginPath();
      traceOffsetPolygonPath(ctx, entry.x, entry.y, entry.screenPts, offsetX, offsetY);
      ctx.clip();
      paintOpaqueTextureBase(ctx, entry, atlasScale, offsetX, offsetY);
    }
    drawImageCover(
      ctx,
      srcImg,
      entry.x + offsetX,
      entry.y + offsetY,
      entry.canvasW,
      entry.canvasH,
      atlasScale,
    );
    if (clipOpaque) ctx.restore();
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
  if (lenSq <= BASIS_EPS) return Math.hypot(px - ax, py - ay);
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
