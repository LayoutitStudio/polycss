/**
 * Smoke tests: buildAtlasPages canvas pipeline (Vue atlasBrowser copy)
 *
 * Mirrors React's atlasBrowser.buildAtlasPages.test.ts.
 * happy-dom's canvas stub returns null from getContext("2d"), so pixel-level
 * verification is not possible. We verify:
 *   - the function does not throw on valid plan input
 *   - it returns the correct number of TextureAtlasPage objects
 *   - each page carries the expected width/height from the packed page
 *   - empty plan input produces empty output
 *   - isCancelled() early-exit is respected
 *
 * Note: `url` will be null in the happy-dom environment because canvas.getContext
 * returns null, so `buildAtlasPage` returns `{ url: null }`. That is the
 * expected fall-through in environments without a real 2D canvas context.
 */
import { describe, it, expect, vi } from "vitest";
import type { PackedTextureAtlasEntry, Polygon } from "@layoutit/polycss-core";
import { computeTextureAtlasPlanPublic, expandClipPoints, TEXTURE_TRIANGLE_BLEED } from "@layoutit/polycss-core";
import { buildAtlasPages, drawTexturedAtlasEntry, packTextureAtlasPlansWithScale } from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDesktopDoc(): Document {
  return {
    defaultView: {
      navigator: { userAgent: "Mozilla/5.0 Chrome/120" },
      CSS: { supports: () => false },
      matchMedia: (query: string) => ({
        matches: query.includes("pointer: fine") || query.includes("hover: hover"),
      }),
    },
    createElement: document.createElement.bind(document),
  } as unknown as Document;
}

function neverCancelled(): boolean {
  return false;
}

// ---------------------------------------------------------------------------
// Polygon fixtures
// ---------------------------------------------------------------------------

const SOLID_RECT: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
  color: "#ff0000",
};

const SOLID_TRIANGLE: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  color: "#00ff00",
};

// ---------------------------------------------------------------------------
// Helpers: build a packed atlas from solid polygons
// ---------------------------------------------------------------------------

function buildPacked(polygons: Polygon[]): ReturnType<typeof packTextureAtlasPlansWithScale> {
  const plans = polygons.map((p, i) => computeTextureAtlasPlanPublic(p, i));
  return packTextureAtlasPlansWithScale(plans, 1, makeDesktopDoc());
}

function makeCtx(): {
  ctx: CanvasRenderingContext2D;
  drawImage: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
} {
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  return {
    drawImage,
    fillRect,
    ctx: {
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      clip: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      fillRect,
      drawImage,
    } as unknown as CanvasRenderingContext2D,
  };
}

function repeatedUvEntry(
  textureWrap?: PackedTextureAtlasEntry["polygon"]["textureWrap"],
  textureAlphaMode?: PackedTextureAtlasEntry["polygon"]["textureAlphaMode"],
): PackedTextureAtlasEntry {
  return {
    polygon: {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      color: "#fef1e2",
      texture: "texture.png",
      textureWrap,
      textureAlphaMode,
    },
    x: 0,
    y: 0,
    canvasW: 1,
    canvasH: 1,
    screenPts: [0, 0, 1, 0, 0, 1],
    uvAffine: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    uvSampleRect: { minU: 0, minV: 0, maxU: 1.75, maxV: 1 },
  } as unknown as PackedTextureAtlasEntry;
}

// ---------------------------------------------------------------------------
// Tests: buildAtlasPages smoke
// ---------------------------------------------------------------------------

describe("buildAtlasPages — smoke tests", () => {
  it("returns an empty array for empty pages input", async () => {
    const result = await buildAtlasPages([], "baked", document, 1, neverCancelled);
    expect(result).toEqual([]);
  });

  it("does not throw for a single solid-polygon page", async () => {
    const { packed, atlasScale } = buildPacked([SOLID_RECT]);
    await expect(
      buildAtlasPages(packed.pages, "baked", document, atlasScale, neverCancelled),
    ).resolves.toBeDefined();
  });

  it("returns one TextureAtlasPage per packed page", async () => {
    const { packed, atlasScale } = buildPacked([SOLID_RECT, SOLID_TRIANGLE]);
    const pages = await buildAtlasPages(packed.pages, "baked", document, atlasScale, neverCancelled);
    expect(pages.length).toBe(packed.pages.length);
  });

  it("each returned page has width and height matching the packed page", async () => {
    const { packed, atlasScale } = buildPacked([SOLID_RECT]);
    const pages = await buildAtlasPages(packed.pages, "baked", document, atlasScale, neverCancelled);
    for (let i = 0; i < pages.length; i++) {
      expect(pages[i].width).toBe(packed.pages[i].width);
      expect(pages[i].height).toBe(packed.pages[i].height);
    }
  });

  it("isCancelled early-exit: returns fewer pages when cancelled after first", async () => {
    const { packed, atlasScale } = buildPacked([SOLID_RECT, SOLID_TRIANGLE]);
    if (packed.pages.length < 2) {
      return;
    }
    let callCount = 0;
    const cancelAfterFirst = () => {
      callCount++;
      return callCount > 1;
    };
    const pages = await buildAtlasPages(packed.pages, "baked", document, atlasScale, cancelAfterFirst);
    expect(pages.length).toBeLessThan(packed.pages.length);
  });

  it("does not throw for dynamic lighting mode", async () => {
    const { packed, atlasScale } = buildPacked([SOLID_RECT]);
    await expect(
      buildAtlasPages(packed.pages, "dynamic", document, atlasScale, neverCancelled),
    ).resolves.toBeDefined();
  });

  it("url field is present on each returned page (may be null in stub env)", async () => {
    const { packed, atlasScale } = buildPacked([SOLID_RECT]);
    const pages = await buildAtlasPages(packed.pages, "baked", document, atlasScale, neverCancelled);
    for (const page of pages) {
      expect(page.url === null || typeof page.url === "string").toBe(true);
    }
  });

  it("draws repeated glTF texture tiles for affine UVs", () => {
    const { ctx, drawImage } = makeCtx();
    const image = { naturalWidth: 512, naturalHeight: 512, width: 512, height: 512 } as HTMLImageElement;

    drawTexturedAtlasEntry(
      ctx,
      repeatedUvEntry({ s: "repeat", t: "repeat" }),
      image,
      1,
    );

    expect(drawImage.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      [0, 0],
      [512, 0],
    ]);
  });

  it("keeps legacy single-tile drawing without explicit texture wrap", () => {
    const { ctx, drawImage } = makeCtx();
    const image = { naturalWidth: 512, naturalHeight: 512, width: 512, height: 512 } as HTMLImageElement;

    drawTexturedAtlasEntry(ctx, repeatedUvEntry(), image, 1);

    expect(drawImage.mock.calls.map((call) => [call[1], call[2]])).toEqual([[0, 0]]);
  });

  it("fills opaque texture alpha with the polygon base color", () => {
    const { ctx, fillRect } = makeCtx();
    const image = { naturalWidth: 512, naturalHeight: 512, width: 512, height: 512 } as HTMLImageElement;

    drawTexturedAtlasEntry(
      ctx,
      repeatedUvEntry({ s: "repeat", t: "repeat" }, "opaque"),
      image,
      1,
    );

    expect(fillRect).toHaveBeenCalledWith(0, 0, 1, 1);
  });
});

describe("drawTexturedAtlasEntry — textured-triangle clip bleed", () => {
  function makeClipCtx() {
    const moveTo = vi.fn();
    const lineTo = vi.fn();
    return {
      moveTo,
      lineTo,
      ctx: {
        save: vi.fn(),
        restore: vi.fn(),
        setTransform: vi.fn(),
        beginPath: vi.fn(),
        moveTo,
        lineTo,
        closePath: vi.fn(),
        clip: vi.fn(),
        fillRect: vi.fn(),
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D,
    };
  }

  const SCREEN_PTS = [0, 0, 40, 0, 0, 40];

  function triangleClipEntry(bleedRatio?: number): PackedTextureAtlasEntry {
    return {
      polygon: {
        vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        color: "#ffffff",
        texture: "texture.png",
      },
      x: 10,
      y: 20,
      canvasW: 40,
      canvasH: 40,
      screenPts: SCREEN_PTS,
      textureTriangles: [{ screenPts: SCREEN_PTS }],
      bleedRatio,
    } as unknown as PackedTextureAtlasEntry;
  }

  function tracedPoints(entry: PackedTextureAtlasEntry): number[] {
    const { ctx, moveTo, lineTo } = makeClipCtx();
    const image = { naturalWidth: 64, naturalHeight: 64, width: 64, height: 64 } as HTMLImageElement;
    drawTexturedAtlasEntry(ctx, entry, image, 1);
    return [...moveTo.mock.calls, ...lineTo.mock.calls].flatMap((call) => [call[0], call[1]]);
  }

  function expectedPoints(ratio: number): number[] {
    const expanded = expandClipPoints(SCREEN_PTS, TEXTURE_TRIANGLE_BLEED * ratio);
    return [0, 1, 2].flatMap((i) => [10 + expanded[i * 2], 20 + expanded[i * 2 + 1]]);
  }

  it("scales the clip expansion by entry.bleedRatio (seamBleed=0 disables it)", () => {
    // bleedRatio is stamped from resolveBleedRatio(options.seamBleed); the
    // drifted copy ignored it and always expanded by the full bleed.
    expect(tracedPoints(triangleClipEntry(0))).toEqual(expectedPoints(0));
    expect(tracedPoints(triangleClipEntry(0.5))).toEqual(expectedPoints(0.5));
  });

  it("defaults a missing bleedRatio to the full triangle bleed", () => {
    expect(tracedPoints(triangleClipEntry(undefined))).toEqual(expectedPoints(1));
    expect(tracedPoints(triangleClipEntry(undefined))).not.toEqual(expectedPoints(0));
  });
});
