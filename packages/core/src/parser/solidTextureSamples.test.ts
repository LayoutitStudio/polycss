import { afterEach, describe, expect, it, vi } from "vitest";
import type { Polygon } from "../types";
import type { ParseResult } from "./types";
import { bakeSolidTextureSamples, getSolidTextureBakedAnimationInfo } from "./solidTextureSamples";

afterEach(() => {
  vi.unstubAllGlobals();
});

function installSolidTextureEnv(color: [number, number, number, number]): void {
  installSolidTextureDataEnv(1, 1, color);
}

function installSolidTextureDataEnv(width: number, height: number, data: ArrayLike<number>): void {
  class FakeImage {
    naturalWidth = width;
    naturalHeight = height;
    width = width;
    height = height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }

  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("document", {
    createElement(tagName: string) {
      if (tagName !== "canvas") throw new Error(`unexpected element ${tagName}`);
      return {
        width: 0,
        height: 0,
        getContext(type: string) {
          if (type !== "2d") return null;
          return {
            drawImage() {},
            getImageData() {
              return { data };
            },
          };
        },
      };
    },
  });
}

function texturedTriangle(vertices: Polygon["vertices"]): Polygon {
  const uvs: Polygon["uvs"] = [[0, 0], [1, 0], [0, 1]];
  return {
    vertices,
    color: "#000000",
    texture: "texture.png",
    uvs,
    textureTriangles: [{ uvs: [uvs[0], uvs[1], uvs[2]] }],
  };
}

function pointSampledTexturedTriangle(vertices: Polygon["vertices"], uv: [number, number]): Polygon {
  return {
    vertices,
    color: "#000000",
    texture: "texture.png",
    uvs: [uv, uv, uv],
    textureTriangles: [{ uvs: [uv, uv, uv] }],
  };
}

describe("bakeSolidTextureSamples", () => {
  it("reuses baked solid texture colors for animated samples", async () => {
    installSolidTextureEnv([10, 20, 30, 255]);
    const rest = texturedTriangle([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    const animated = texturedTriangle([[0, 0, 0], [2, 0, 0], [0, 2, 0]]);
    let sampleCalls = 0;
    const result: ParseResult = {
      polygons: [rest],
      objectUrls: [],
      dispose() {},
      warnings: [],
      animation: {
        clips: [{ index: 0, name: "move", duration: 1, channelCount: 1 }],
        sample() {
          sampleCalls++;
          return [animated];
        },
      },
    };

    const baked = await bakeSolidTextureSamples(result);
    const frame = baked.animation!.sample("move", 0.5);
    const bakedAnimationInfo = getSolidTextureBakedAnimationInfo(baked.animation);

    expect(sampleCalls).toBe(1);
    expect(bakedAnimationInfo?.source).toBe(result.animation);
    expect(bakedAnimationInfo?.bakedColorEntries).toEqual([{ index: 0, color: "#0a141e" }]);
    expect(baked.polygons[0].color).toBe("#0a141e");
    expect(baked.polygons[0].texture).toBeUndefined();
    expect(frame[0].vertices).toEqual(animated.vertices);
    expect(frame[0].color).toBe("#0a141e");
    expect(frame[0].texture).toBeUndefined();
    expect(frame[0].uvs).toBeUndefined();
    expect(frame[0].textureTriangles).toBeUndefined();
  });

  it("normalizes close baked texture swatch colors", async () => {
    installSolidTextureDataEnv(2, 1, [
      254, 202, 74, 255,
      254, 193, 68, 255,
    ]);
    const dominantUv: [number, number] = [0.25, 0.5];
    const closeUv: [number, number] = [0.75, 0.5];
    const authoredCloseColor: Polygon = {
      vertices: [[0, 2, 0], [1, 2, 0], [0, 3, 0]],
      color: "#fec144",
    };
    const result: ParseResult = {
      polygons: [
        pointSampledTexturedTriangle([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dominantUv),
        pointSampledTexturedTriangle([[1, 0, 0], [2, 0, 0], [1, 1, 0]], dominantUv),
        pointSampledTexturedTriangle([[2, 0, 0], [3, 0, 0], [2, 1, 0]], closeUv),
        authoredCloseColor,
      ],
      objectUrls: [],
      dispose() {},
      warnings: [],
    };

    const baked = await bakeSolidTextureSamples(result);

    expect(baked.polygons.map((polygon) => polygon.color)).toEqual([
      "#feca4a",
      "#feca4a",
      "#feca4a",
      "#fec144",
    ]);
    expect(baked.polygons.slice(0, 3).every((polygon) => polygon.texture === undefined)).toBe(true);
  });

  it("preserves UV-derived simplifier seam keys when baking solid textures", async () => {
    installSolidTextureEnv([10, 20, 30, 255]);
    const polygon = texturedTriangle([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    const result: ParseResult = {
      polygons: [polygon],
      objectUrls: [],
      dispose() {},
      warnings: [],
    };

    const baked = await bakeSolidTextureSamples(result);

    expect(baked.polygons[0].texture).toBeUndefined();
    expect(baked.polygons[0].uvs).toBeUndefined();
    expect(baked.polygons[0].textureTriangles).toBeUndefined();
    expect(baked.polygons[0].simplifyVertexKeys).toEqual([
      "uv:0,0",
      "uv:100000,0",
      "uv:0,100000",
    ]);
  });

  it("preserves source simplifier keys when appending baked UV seam identity", async () => {
    installSolidTextureEnv([10, 20, 30, 255]);
    const polygon: Polygon = {
      ...texturedTriangle([[0, 0, 0], [1, 0, 0], [0, 1, 0]]),
      simplifySourceVertexKeys: ["source:0", "source:1", "source:2"],
    };
    const result: ParseResult = {
      polygons: [polygon],
      objectUrls: [],
      dispose() {},
      warnings: [],
    };

    const baked = await bakeSolidTextureSamples(result);

    expect(baked.polygons[0].simplifySourceVertexKeys).toEqual([
      "source:0|uv:0,0",
      "source:1|uv:100000,0",
      "source:2|uv:0,100000",
    ]);
  });

  it("uses texture wrap when baking repeated UVs into solid colors", async () => {
    installSolidTextureDataEnv(2, 1, [
      10, 20, 30, 255,
      0, 0, 0, 0,
    ]);
    const uv: [number, number] = [1.25, 0.5];
    const polygon: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      color: "#000000",
      texture: "texture.png",
      textureWrap: { s: "repeat", t: "repeat" },
      uvs: [uv, uv, uv],
      textureTriangles: [{ uvs: [uv, uv, uv] }],
    };
    const result: ParseResult = {
      polygons: [polygon],
      objectUrls: [],
      dispose() {},
      warnings: [],
    };

    const baked = await bakeSolidTextureSamples(result);

    expect(baked.polygons[0].color).toBe("#0a141e");
    expect(baked.polygons[0].texture).toBeUndefined();
    expect(baked.polygons[0].textureWrap).toBeUndefined();
  });

  it("uses the polygon base color for opaque texture padding", async () => {
    installSolidTextureDataEnv(1, 1, [0, 0, 0, 0]);
    const uv: [number, number] = [0.5, 0.5];
    const polygon: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      color: "#fef1e2",
      texture: "texture.png",
      textureAlphaMode: "opaque",
      uvs: [uv, uv, uv],
      textureTriangles: [{ uvs: [uv, uv, uv] }],
    };
    const result: ParseResult = {
      polygons: [polygon],
      objectUrls: [],
      dispose() {},
      warnings: [],
    };

    const baked = await bakeSolidTextureSamples(result);

    expect(baked.polygons[0].color).toBe("#fef1e2");
    expect(baked.polygons[0].texture).toBeUndefined();
    expect(baked.polygons[0].textureAlphaMode).toBeUndefined();
  });

  it("uses the polygon base color for mixed opaque texture padding", async () => {
    installSolidTextureDataEnv(2, 1, [
      254, 241, 226, 255,
      0, 0, 0, 0,
    ]);
    const polygon: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      color: "#fef1e2",
      texture: "texture.png",
      textureAlphaMode: "opaque",
      uvs: [[0.25, 0.5], [0.75, 0.5], [0.75, 0.5]],
      textureTriangles: [{ uvs: [[0.25, 0.5], [0.75, 0.5], [0.75, 0.5]] }],
    };
    const result: ParseResult = {
      polygons: [polygon],
      objectUrls: [],
      dispose() {},
      warnings: [],
    };

    const baked = await bakeSolidTextureSamples(result);

    expect(baked.polygons[0].color).toBe("#fef1e2");
    expect(baked.polygons[0].texture).toBeUndefined();
    expect(baked.polygons[0].textureAlphaMode).toBeUndefined();
  });
});
