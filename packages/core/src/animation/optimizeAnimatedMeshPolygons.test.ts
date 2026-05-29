import { describe, expect, it } from "vitest";
import type { ParseAnimationController, ParseResult } from "../parser/types";
import type { Polygon } from "../types";
import { cullInteriorPolygons } from "../cull/cullInteriorPolygons";
import { optimizeAnimatedMeshPolygons } from "./optimizeAnimatedMeshPolygons";

function axisQuad(
  cx: number,
  cy: number,
  cz: number,
  normalAxis: "x" | "y" | "z",
  sign: 1 | -1,
  size = 1,
): Polygon {
  const h = size / 2;
  const color = "#88aacc";
  if (normalAxis === "x") {
    return sign > 0
      ? {
          vertices: [
            [cx, cy - h, cz - h],
            [cx, cy + h, cz - h],
            [cx, cy + h, cz + h],
            [cx, cy - h, cz + h],
          ],
          color,
        }
      : {
          vertices: [
            [cx, cy - h, cz - h],
            [cx, cy - h, cz + h],
            [cx, cy + h, cz + h],
            [cx, cy + h, cz - h],
          ],
          color,
        };
  }
  if (normalAxis === "y") {
    return sign > 0
      ? {
          vertices: [
            [cx - h, cy, cz - h],
            [cx - h, cy, cz + h],
            [cx + h, cy, cz + h],
            [cx + h, cy, cz - h],
          ],
          color,
        }
      : {
          vertices: [
            [cx - h, cy, cz - h],
            [cx + h, cy, cz - h],
            [cx + h, cy, cz + h],
            [cx - h, cy, cz + h],
          ],
          color,
        };
  }
  return sign > 0
    ? {
        vertices: [
          [cx - h, cy - h, cz],
          [cx + h, cy - h, cz],
          [cx + h, cy + h, cz],
          [cx - h, cy + h, cz],
        ],
        color,
      }
    : {
        vertices: [
          [cx - h, cy - h, cz],
          [cx - h, cy + h, cz],
          [cx + h, cy + h, cz],
          [cx + h, cy - h, cz],
        ],
        color,
      };
}

function cubeOutward(cx: number, cy: number, cz: number, size = 1): Polygon[] {
  const h = size / 2;
  return [
    axisQuad(cx + h, cy, cz, "x", 1, size),
    axisQuad(cx - h, cy, cz, "x", -1, size),
    axisQuad(cx, cy + h, cz, "y", 1, size),
    axisQuad(cx, cy - h, cz, "y", -1, size),
    axisQuad(cx, cy, cz + h, "z", 1, size),
    axisQuad(cx, cy, cz - h, "z", -1, size),
  ];
}

function translateFrame(polygons: Polygon[], x: number): Polygon[] {
  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map((vertex): [number, number, number] => [
      vertex[0] + x,
      vertex[1],
      vertex[2],
    ]),
  }));
}

function makeAnimatedParseResult(polygons: Polygon[]): ParseResult {
  const clips = [{ index: 0, name: "run", duration: 1, channelCount: 1 }];
  const animation: ParseAnimationController = {
    clips,
    sample: (_clip, timeSeconds) => translateFrame(polygons, timeSeconds),
  };
  return {
    polygons,
    animation,
    objectUrls: [],
    dispose() {},
    warnings: [],
    metadata: { triangleCount: polygons.length, animations: clips },
  };
}

describe("optimizeAnimatedMeshPolygons", () => {
  it("filters animated frames through the culled rest-pose plan", () => {
    const outer = cubeOutward(0, 0, 0, 10);
    const interior = axisQuad(0, 0, 0, "z", 1, 0.1);
    const result = makeAnimatedParseResult([...outer, interior]);
    const kept = cullInteriorPolygons(result.polygons);
    const keptSet = new Set(kept);
    const keptIndices = result.polygons.flatMap((polygon, index) =>
      keptSet.has(polygon) ? [index] : []
    );

    const optimized = optimizeAnimatedMeshPolygons(result, { meshResolution: "lossy" });
    const running = optimized.animation?.clips.find((clip) => clip.name === "run");

    expect(running).toBeDefined();
    expect(optimized.polygons.length).toBeLessThan(result.polygons.length);
    expect(optimized.polygons).toHaveLength(keptIndices.length);

    for (const time of [0, 0.25, running!.duration / 2]) {
      const fullFrame = result.animation!.sample(running!.name, time);
      const frame = optimized.animation!.sample(running!.name, time);
      expect(frame).toHaveLength(optimized.polygons.length);
      for (let i = 0; i < frame.length; i += 1) {
        expect(frame[i].vertices).toEqual(fullFrame[keptIndices[i]!]!.vertices);
      }
    }
  });

});
