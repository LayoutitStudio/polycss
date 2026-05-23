import { describe, expect, it, vi } from "vitest";
import type { PackedTextureAtlasEntry } from "@layoutit/polycss-core";
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
