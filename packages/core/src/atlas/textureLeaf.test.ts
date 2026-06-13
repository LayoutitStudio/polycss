import { describe, expect, it } from "vitest";
import type { Polygon } from "../types";
import { computeTextureAtlasPlanPublic, resolveProjectiveQuadGuards } from "./plan";
import { resolvePolyTextureLeafGeometry } from "./textureLeaf";

const SOURCE = {
  url: "https://example.com/source.png",
  width: 320,
  height: 200,
  sourceRect: { x: 16, y: 24, width: 80, height: 40 },
};

function directImagePolygon(overrides: Partial<Polygon> = {}): Polygon {
  return {
    vertices: [
      [0, 0, 0],
      [2, 0, 0],
      [2, 1, 0],
      [0, 1, 0],
    ],
    textureImageSource: SOURCE,
    texturePresentation: { backend: "image" },
    ...overrides,
  };
}

describe("resolvePolyTextureLeafGeometry", () => {
  it("resolves an affine individual image leaf from source metadata", () => {
    const polygon = directImagePolygon({
      texturePresentation: { backend: "image", imageRendering: "pixelated" },
    });
    const plan = computeTextureAtlasPlanPublic(polygon, 0)!;
    const geometry = resolvePolyTextureLeafGeometry(plan)!;

    expect(geometry).toMatchObject({
      url: SOURCE.url,
      sourceRect: SOURCE.sourceRect,
      leafWidth: 80,
      leafHeight: 40,
      backgroundPosition: [-16, -24],
      backgroundSize: [320, 200],
      imageRendering: "pixelated",
      lighting: "source",
      projection: "affine",
    });
    expect(geometry.matrix).toMatch(/^-?\d/);
  });

  it("requires explicit image backend and source lighting", () => {
    const atlasBackend = computeTextureAtlasPlanPublic(directImagePolygon({
      texturePresentation: { backend: "atlas" },
    }), 0)!;
    const sceneLit = computeTextureAtlasPlanPublic(directImagePolygon({
      texturePresentation: { backend: "image", lighting: "scene" },
    }), 0)!;

    expect(resolvePolyTextureLeafGeometry(atlasBackend)).toBeNull();
    expect(resolvePolyTextureLeafGeometry(sceneLit)).toBeNull();
  });

  it("accepts backend and projection defaults from resolver options", () => {
    const polygon = directImagePolygon({
      texturePresentation: undefined,
    });
    const plan = computeTextureAtlasPlanPublic(polygon, 0)!;

    expect(resolvePolyTextureLeafGeometry(plan)).toBeNull();
    const geometry = resolvePolyTextureLeafGeometry(plan, {
      backend: "image",
      imageRendering: "pixelated",
      projection: "affine",
    });

    expect(geometry?.url).toBe(SOURCE.url);
    expect(geometry?.imageRendering).toBe("pixelated");
    expect(geometry?.projection).toBe("affine");
  });

  it("falls back when projective image leaves are not allowed", () => {
    const polygon = directImagePolygon({
      vertices: [
        [0, 0, 0],
        [2, 0, 0],
        [2, 1, 0],
        [0, 2, 0],
      ],
      texturePresentation: { backend: "image", projection: "projective" },
    });
    const plan = computeTextureAtlasPlanPublic(polygon, 0)!;

    expect(resolvePolyTextureLeafGeometry(plan, { allowProjective: false })).toBeNull();
  });

  it("resolves guarded projective individual image leaves for non-rect quads", () => {
    const polygon = directImagePolygon({
      vertices: [
        [0, 0, 0],
        [2, 0, 0],
        [2, 1, 0],
        [0, 2, 0],
      ],
      texturePresentation: { backend: "image", projection: "projective" },
    });
    const plan = computeTextureAtlasPlanPublic(polygon, 0)!;
    const geometry = resolvePolyTextureLeafGeometry(plan, {
      projectiveQuadGuards: resolveProjectiveQuadGuards({ disableGuards: true }),
    });

    expect(geometry?.projection).toBe("projective");
    expect(geometry?.matrix).toMatch(/^-?\d/);
  });
});
