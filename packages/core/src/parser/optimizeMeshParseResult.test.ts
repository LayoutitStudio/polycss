import { describe, expect, it } from "vitest";
import type { ParseResult } from "./types";
import type { Polygon, Vec3 } from "../types";
import { optimizeMeshPolygons } from "../merge/optimizePolygons";
import { optimizeMeshParseResult } from "./optimizeMeshParseResult";

function parseResult(polygons: Polygon[]): ParseResult {
  return {
    polygons,
    objectUrls: [],
    dispose() {},
    warnings: [],
  };
}

function grid(size: number): Polygon[] {
  const polygons: Polygon[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const a: Vec3 = [x, y, 0];
      const b: Vec3 = [x + 1, y, 0];
      const c: Vec3 = [x + 1, y + 1, 0];
      const d: Vec3 = [x, y + 1, 0];
      polygons.push(
        { vertices: [a, b, c], color: "#fff" },
        { vertices: [a, c, d], color: "#fff" },
      );
    }
  }
  return polygons;
}

function texturedGrid(size: number): Polygon[] {
  return grid(size).map((polygon) => ({
    ...polygon,
    texture: "texture.png",
    uvs: [[0, 0], [1, 0], [1, 1]],
  }));
}

describe("optimizeMeshParseResult", () => {
  it("runs the core mesh optimizer for parse results", () => {
    const source = parseResult(grid(2));
    const optimized = optimizeMeshParseResult(source, { meshResolution: "lossless" });

    expect(optimized.polygons.length).toBeLessThan(source.polygons.length);
    expect(mergeCountStable(optimized.polygons)).toBe(true);
  });

  it("merges visually redundant baked swatch colors in lossy mode", () => {
    const vertices: [Vec3, Vec3, Vec3, Vec3] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ];
    const before = parseResult([
      {
        vertices: [vertices[0], vertices[1], vertices[2]],
        color: "#ffffff",
        texture: "swatch.png",
        uvs: [[0, 0], [1, 0], [1, 1]],
      },
      {
        vertices: [vertices[0], vertices[2], vertices[3]],
        color: "#ffffff",
        texture: "swatch.png",
        uvs: [[0, 0], [1, 1], [0, 1]],
      },
    ]);
    const baked = parseResult([
      { vertices: [vertices[0], vertices[1], vertices[2]], color: "#feca4a" },
      { vertices: [vertices[0], vertices[2], vertices[3]], color: "#fec144" },
    ]);

    const optimized = optimizeMeshParseResult(baked, {
      meshResolution: "lossy",
      source: before,
    });

    expect(optimized.polygons).toHaveLength(1);
    expect(["#feca4a", "#fec144"]).toContain(optimized.polygons[0].color);
  });

  it("leaves animated parse results structurally unchanged", () => {
    const source = parseResult(grid(4));
    const animated: ParseResult = {
      ...source,
      animation: {
        clips: [{ index: 0, name: "move", duration: 1, channelCount: 1 }],
        sample: () => source.polygons,
      },
    };

    const optimized = optimizeMeshParseResult(animated);

    expect(optimized).toBe(animated);
  });

  it("skips static triangle simplification for texture-dominant parse results", () => {
    const source = parseResult([
      ...grid(8),
      ...texturedGrid(8),
    ]);

    const optimized = optimizeMeshParseResult(source, { meshResolution: "lossy" });
    const baseline = optimizeMeshParseResult(source, {
      meshResolution: "lossy",
      simplifyTriangleMeshes: false,
    });

    expect(optimized.polygons).toHaveLength(baseline.polygons.length);
  });

  it("skips static triangle simplification when baseline merging already collapses the source", () => {
    const source = parseResult(grid(8));

    const optimized = optimizeMeshParseResult(source, { meshResolution: "lossy" });
    const baseline = optimizeMeshParseResult(source, {
      meshResolution: "lossy",
      simplifyTriangleMeshes: false,
    });

    expect(optimized.polygons).toHaveLength(baseline.polygons.length);
  });
});

function mergeCountStable(polygons: Polygon[]): boolean {
  return optimizeMeshPolygons(polygons, { meshResolution: "lossless" }).length === polygons.length;
}
