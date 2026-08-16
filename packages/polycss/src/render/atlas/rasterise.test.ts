import { describe, expect, it, vi } from "vitest";
import type { PackedTextureAtlasEntry } from "@layoutit/polycss-core";
import { expandClipPoints, TEXTURE_TRIANGLE_BLEED } from "@layoutit/polycss-core";
import { drawTexturedAtlasEntry } from "./rasterise";

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

describe("drawTexturedAtlasEntry", () => {
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
