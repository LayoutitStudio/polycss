import { afterEach, describe, expect, it, vi } from "vitest";
import type { Polygon } from "../types";
import type { ParseResult } from "./types";
import { bakeSolidTextureSamples, getSolidTextureBakedAnimationInfo } from "./solidTextureSamples";

afterEach(() => {
  vi.unstubAllGlobals();
});

function installSolidTextureEnv(color: [number, number, number, number]): void {
  class FakeImage {
    naturalWidth = 1;
    naturalHeight = 1;
    width = 1;
    height = 1;
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
              return { data: color };
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
});
