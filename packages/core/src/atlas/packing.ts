import {
  ATLAS_MAX_SIZE,
  ATLAS_PADDING,
  MIN_ATLAS_SCALE,
  MAX_ATLAS_SCALE,
  AUTO_ATLAS_LOW_AREA,
  AUTO_ATLAS_MEDIUM_AREA,
  AUTO_ATLAS_MAX_BITMAP_SIDE,
  AUTO_ATLAS_MAX_DECODED_BYTES_MOBILE,
  AUTO_ATLAS_MAX_DECODED_BYTES_DESKTOP,
  AUTO_ATLAS_SCALE_GUARD,
  ATLAS_CANONICAL_SIZE_EXPLICIT,
  ATLAS_CANONICAL_SIZE_AUTO_DESKTOP,
} from "./constants";
import type {
  TextureAtlasPlan,
  PackedAtlas,
  PackedPage,
  PackedTextureAtlasEntry,
  PackingPage,
  TextureQuality,
} from "./types";
import type { PolyTextureLeafSizing } from "../types";
import { formatAtlasMatrix } from "./matrix";

export function normalizeAtlasScale(scale: number | string | undefined): number {
  const value = typeof scale === "string" ? Number(scale) : scale;
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(MAX_ATLAS_SCALE, Math.max(MIN_ATLAS_SCALE, value));
}

export function atlasArea(pages: PackedPage[]): number {
  return pages.reduce((sum, page) => sum + page.width * page.height, 0);
}

export function autoAtlasScaleCap(pages: PackedPage[], maxDecodedBytes: number): number {
  const area = atlasArea(pages);
  if (area <= 0) return 1;

  const maxSide = Math.max(
    1,
    ...pages.map((page) => Math.max(page.width, page.height)),
  );
  const sideScale = AUTO_ATLAS_MAX_BITMAP_SIDE / maxSide;
  const memoryScale = Math.sqrt(maxDecodedBytes / (area * 4));

  return normalizeAtlasScale(Math.min(sideScale, memoryScale));
}

export function autoAtlasScale(pages: PackedPage[], maxDecodedBytes: number): number {
  const area = atlasArea(pages);
  let atlasScale = 0.5;
  if (area <= AUTO_ATLAS_LOW_AREA) atlasScale = 1;
  else if (area <= AUTO_ATLAS_MEDIUM_AREA) atlasScale = 0.75;

  return normalizeAtlasScale(Math.min(atlasScale, autoAtlasScaleCap(pages, maxDecodedBytes)));
}

export function atlasBitmapMaxSide(pages: PackedPage[], atlasScale: number): number {
  return pages.reduce((max, page) => Math.max(
    max,
    Math.ceil(page.width * atlasScale),
    Math.ceil(page.height * atlasScale),
  ), 0);
}

export function atlasDecodedBytes(pages: PackedPage[], atlasScale: number): number {
  return pages.reduce((sum, page) =>
    sum +
    Math.ceil(page.width * atlasScale) *
    Math.ceil(page.height * atlasScale) *
    4
  , 0);
}

export function autoAtlasBudgetFactor(
  pages: PackedPage[],
  atlasScale: number,
  maxDecodedBytes: number,
): number {
  const maxSide = atlasBitmapMaxSide(pages, atlasScale);
  const decodedBytes = atlasDecodedBytes(pages, atlasScale);
  const sideFactor = maxSide > AUTO_ATLAS_MAX_BITMAP_SIDE
    ? AUTO_ATLAS_MAX_BITMAP_SIDE / maxSide
    : 1;
  const memoryFactor = decodedBytes > maxDecodedBytes
    ? Math.sqrt(maxDecodedBytes / decodedBytes)
    : 1;
  return Math.min(sideFactor, memoryFactor);
}

/** Returns the max decoded-bytes budget for the given device class. */
export function autoAtlasMaxDecodedBytes(isMobile: boolean): number {
  return isMobile
    ? AUTO_ATLAS_MAX_DECODED_BYTES_MOBILE
    : AUTO_ATLAS_MAX_DECODED_BYTES_DESKTOP;
}

/** Returns the atlas canonical size for the given texture quality and device class. */
export function atlasCanonicalSizeForTextureQuality(
  textureQualityInput: TextureQuality | undefined,
  isMobile: boolean,
): number {
  if (textureQualityInput !== undefined && textureQualityInput !== "auto") {
    return ATLAS_CANONICAL_SIZE_EXPLICIT;
  }
  return isMobile ? ATLAS_CANONICAL_SIZE_EXPLICIT : ATLAS_CANONICAL_SIZE_AUTO_DESKTOP;
}

export function applyPackedAtlasCanonicalSize(
  packed: PackedAtlas,
  atlasCanonicalSize: number,
): PackedAtlas {
  return applyPackedAtlasLeafSizing(packed, atlasCanonicalSize, 1, "canonical");
}

export function resolveAtlasLeafBox(
  entry: TextureAtlasPlan,
  atlasScale: number,
  textureLeafSizing: PolyTextureLeafSizing | undefined,
  atlasCanonicalSize = atlasCanonicalSizeForEntry(entry),
): { width: number; height: number; sizing: PolyTextureLeafSizing } {
  const sizing = textureLeafSizing ?? "canonical";
  if (sizing === "local") {
    return {
      width: Math.max(1, entry.canvasW || 1),
      height: Math.max(1, entry.canvasH || 1),
      sizing,
    };
  }
  if (sizing === "raster") {
    const scale = normalizeAtlasScale(atlasScale);
    return {
      width: Math.max(1, (entry.canvasW || 1) * scale),
      height: Math.max(1, (entry.canvasH || 1) * scale),
      sizing,
    };
  }
  return {
    width: atlasCanonicalSize,
    height: atlasCanonicalSize,
    sizing: "canonical",
  };
}

export function applyPackedAtlasLeafSizing(
  packed: PackedAtlas,
  atlasCanonicalSize: number,
  atlasScale: number,
  textureLeafSizing: PolyTextureLeafSizing | undefined = "canonical",
): PackedAtlas {
  for (const entry of packed.entries) {
    if (!entry) continue;
    const leafBox = resolveAtlasLeafBox(entry, atlasScale, textureLeafSizing, atlasCanonicalSize);
    entry.atlasCanonicalSize = atlasCanonicalSize;
    entry.atlasLeafSizing = leafBox.sizing;
    entry.atlasLeafWidth = leafBox.width;
    entry.atlasLeafHeight = leafBox.height;
    entry.atlasMatrix = formatAtlasMatrix(entry, leafBox.width, leafBox.height);
  }
  return packed;
}

export function atlasCanonicalSizeForEntry(entry: TextureAtlasPlan): number {
  return entry.atlasCanonicalSize ?? ATLAS_CANONICAL_SIZE_EXPLICIT;
}

export function atlasPadding(atlasScale: number): number {
  return Math.max(ATLAS_PADDING, Math.ceil(ATLAS_PADDING / atlasScale));
}

export function packTextureAtlasPlans(
  plans: Array<TextureAtlasPlan | null>,
  atlasScale = 1,
): PackedAtlas {
  const entries: Array<PackedTextureAtlasEntry | null> = Array(plans.length).fill(null);
  const pages: PackingPage[] = [];
  const padding = atlasPadding(atlasScale);
  const sortedPlans = plans
    .filter((plan): plan is TextureAtlasPlan => !!plan)
    .sort((a, b) =>
      b.canvasH - a.canvasH ||
      b.canvasW - a.canvasW ||
      a.index - b.index
    );

  const createPage = (): PackingPage => ({
    width: padding,
    height: padding,
    entries: [],
    shelves: [],
  });

  const placeOnPage = (
    page: PackingPage,
    plan: TextureAtlasPlan,
    pageIndex: number,
  ): PackedTextureAtlasEntry | null => {
    if (page.sealed) return null;
    for (const shelf of page.shelves) {
      if (
        plan.canvasH <= shelf.height &&
        shelf.x + plan.canvasW + padding <= ATLAS_MAX_SIZE
      ) {
        const entry = { ...plan, pageIndex, x: shelf.x, y: shelf.y };
        shelf.x += plan.canvasW + padding * 2;
        page.entries.push(entry);
        page.width = Math.max(page.width, entry.x + plan.canvasW + padding);
        return entry;
      }
    }

    const shelfY = page.shelves.length === 0 ? padding : page.height + padding;
    if (shelfY + plan.canvasH + padding > ATLAS_MAX_SIZE) return null;

    const entry = { ...plan, pageIndex, x: padding, y: shelfY };
    page.shelves.push({
      x: padding + plan.canvasW + padding * 2,
      y: shelfY,
      height: plan.canvasH,
    });
    page.entries.push(entry);
    page.width = Math.max(page.width, entry.x + plan.canvasW + padding);
    page.height = Math.max(page.height, shelfY + plan.canvasH + padding);
    return entry;
  };

  for (const plan of sortedPlans) {
    const tooLarge =
      plan.canvasW + padding * 2 > ATLAS_MAX_SIZE ||
      plan.canvasH + padding * 2 > ATLAS_MAX_SIZE;

    if (tooLarge) {
      const pageIndex = pages.length;
      const entry = { ...plan, pageIndex, x: padding, y: padding };
      entries[plan.index] = entry;
      pages.push({
        width: plan.canvasW + padding * 2,
        height: plan.canvasH + padding * 2,
        entries: [entry],
        shelves: [],
        sealed: true,
      });
      continue;
    }

    let placed: PackedTextureAtlasEntry | null = null;
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      placed = placeOnPage(pages[pageIndex], plan, pageIndex);
      if (placed) break;
    }
    if (!placed) {
      const page = createPage();
      const pageIndex = pages.length;
      pages.push(page);
      placed = placeOnPage(page, plan, pageIndex);
    }
    if (placed) entries[plan.index] = placed;
  }

  return {
    entries,
    pages: pages.map(({ width, height, entries }) => ({ width, height, entries })),
  };
}

function packTextureAtlasPlansAuto(
  plans: Array<TextureAtlasPlan | null>,
  fullScalePacked: PackedAtlas,
  maxDecodedBytes: number,
): { packed: PackedAtlas; atlasScale: number } {
  let atlasScale = autoAtlasScale(fullScalePacked.pages, maxDecodedBytes);
  let packed = atlasScale === 1
    ? fullScalePacked
    : packTextureAtlasPlans(plans, atlasScale);

  // Lower scales increase padding, so verify the final packed bitmap budget.
  for (let i = 0; i < 4; i++) {
    const factor = autoAtlasBudgetFactor(packed.pages, atlasScale, maxDecodedBytes);
    if (factor >= 1) break;

    const nextAtlasScale = normalizeAtlasScale(atlasScale * factor * AUTO_ATLAS_SCALE_GUARD);
    if (nextAtlasScale >= atlasScale) break;
    atlasScale = nextAtlasScale;
    packed = packTextureAtlasPlans(plans, atlasScale);
  }

  return { packed, atlasScale };
}

/**
 * Pack atlas plans and resolve atlas scale, accepting a pre-resolved isMobile
 * boolean instead of a Document reference.
 */
export function packTextureAtlasPlansWithScaleCore(
  plans: Array<TextureAtlasPlan | null>,
  textureQualityInput: TextureQuality | undefined,
  isMobile: boolean,
  textureLeafSizing: PolyTextureLeafSizing | undefined = "canonical",
): { packed: PackedAtlas; atlasScale: number; atlasCanonicalSize: number } {
  const atlasCanonicalSize = atlasCanonicalSizeForTextureQuality(textureQualityInput, isMobile);
  if (textureQualityInput !== undefined && textureQualityInput !== "auto") {
    const atlasScale = normalizeAtlasScale(textureQualityInput);
    return {
      packed: applyPackedAtlasLeafSizing(
        packTextureAtlasPlans(plans, atlasScale),
        atlasCanonicalSize,
        atlasScale,
        textureLeafSizing,
      ),
      atlasScale,
      atlasCanonicalSize,
    };
  }

  const fullScalePacked = packTextureAtlasPlans(plans, 1);
  const autoPacked = packTextureAtlasPlansAuto(plans, fullScalePacked, autoAtlasMaxDecodedBytes(isMobile));
  return {
    packed: applyPackedAtlasLeafSizing(
      autoPacked.packed,
      atlasCanonicalSize,
      autoPacked.atlasScale,
      textureLeafSizing,
    ),
    atlasScale: autoPacked.atlasScale,
    atlasCanonicalSize,
  };
}
