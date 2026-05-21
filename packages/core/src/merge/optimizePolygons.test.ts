import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import type { Polygon, Vec3 } from "../types";
import { parseGltf } from "../parser/parseGltf";
import { parseObj } from "../parser/parseObj";
import { bakeSolidTextureSamples } from "../parser/solidTextureSamples";
import { optimizeMeshPolygons } from "./optimizePolygons";

function rect(x0: number, y0: number, x1: number, y1: number): Polygon[] {
  return [
    { vertices: [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0]], color: "#f00" },
    { vertices: [[x0, y0, 0], [x1, y1, 0], [x0, y1, 0]], color: "#f00" },
  ];
}

function edgeKey(a: Polygon["vertices"][number], b: Polygon["vertices"][number]): string {
  const ak = a.join(",");
  const bk = b.join(",");
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function sharedEdgeCount(polygons: Polygon[]): number {
  const counts = new Map<string, number>();
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.vertices.length; i++) {
      const key = edgeKey(polygon.vertices[i], polygon.vertices[(i + 1) % polygon.vertices.length]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function polygonSignature(polygons: Polygon[]): string[] {
  return polygons.map((polygon) =>
    `${polygon.color ?? ""}:${polygon.vertices.map((vertex) => vertex.join(",")).join(";")}`
  ).sort();
}

function textureTrianglePlaneDistance(polygon: Polygon): number {
  const [a, b, c] = polygon.vertices;
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const unit = [normal[0] / length, normal[1] / length, normal[2] / length];
  let max = 0;
  for (const triangle of polygon.textureTriangles ?? []) {
    for (const vertex of triangle.vertices) {
      max = Math.max(
        max,
        Math.abs(
          (vertex[0] - a[0]) * unit[0] +
            (vertex[1] - a[1]) * unit[1] +
            (vertex[2] - a[2]) * unit[2],
        ),
      );
    }
  }
  return max;
}

function loadObjGalleryFile(name: string): string {
  return readFileSync(
    resolve(__dirname, "../../../../website/public/gallery/obj", name),
    "utf8",
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function galleryGlbPath(name: string): string {
  return resolve(__dirname, "../../../../website/public/gallery/glb", name);
}

function loadGlbGalleryFile(name: string): ArrayBuffer {
  const bytes = readFileSync(galleryGlbPath(name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function installSolidTextureEnv(color: [number, number, number, number]): void {
  class FakeImage {
    naturalWidth = 1;
    naturalHeight = 1;
    width = 1;
    height = 1;
    onload: (() => void) | null = null;

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

function renderCost(polygons: Polygon[]): number {
  let cost = 0;
  for (const polygon of polygons) {
    const vertexCount = polygon.vertices.length;
    const irregularPenalty = vertexCount <= 4 ? 0 : Math.min(4, vertexCount - 4) * 0.12;
    const texturePenalty = polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length
      ? 0.15
      : 0;
    cost += 1 + irregularPenalty + texturePenalty;
  }
  return cost;
}

function triangulatedPatchHalf(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  zAt: (x: number, y: number) => number,
): Polygon[] {
  const polygons: Polygon[] = [];
  const columns = 3;
  const point = (x: number, y: number): Vec3 => [x, y, zAt(x, y)];
  for (let column = 0; column < columns; column++) {
    const xa = x0 + ((x1 - x0) * column) / columns;
    const xb = x0 + ((x1 - x0) * (column + 1)) / columns;
    polygons.push(
      { vertices: [point(xa, y0), point(xb, y0), point(xb, y1)], color: "#f00" },
      { vertices: [point(xa, y0), point(xb, y1), point(xa, y1)], color: "#f00" },
    );
  }
  return polygons;
}

function lowValueApproximationCorpus(): Polygon[] {
  const polygons: Polygon[] = [];
  for (let patch = 0; patch < 90; patch++) {
    const x = patch * 3;
    polygons.push(
      ...triangulatedPatchHalf(x, x + 1, 0, 1, () => 0),
      ...triangulatedPatchHalf(x + 1, x + 2, 0, 1, (px) => (px - x - 1) * 0.08),
    );
  }
  return polygons;
}

describe("optimizeMeshPolygons", () => {
  it("uses exact planar cover candidates for lossless resolution", () => {
    const input = [
      ...rect(0, 0, 1, 1),
      ...rect(1, 0, 2, 1),
      ...rect(2, 0, 3, 1),
    ];

    const result = optimizeMeshPolygons(input, { meshResolution: "lossless" });

    expect(result).toHaveLength(1);
    expect(result[0].vertices).toHaveLength(4);
  });

  it("allows approximate merge candidates only for lossy resolution", () => {
    const input: Polygon[] = [
      { vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], color: "#f00" },
      { vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0.08]], color: "#f00" },
    ];

    const lossless = optimizeMeshPolygons(input, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(lossless).toHaveLength(2);
    expect(lossy).toHaveLength(1);
  });

  it("defaults to lossy resolution", () => {
    const input: Polygon[] = [
      { vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], color: "#f00" },
      { vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0.08]], color: "#f00" },
    ];

    expect(optimizeMeshPolygons(input)).toHaveLength(1);
  });

  it("skips low-value automatic lossy approximation after a small exact result", () => {
    const input = lowValueApproximationCorpus();
    const lossless = optimizeMeshPolygons(input, { meshResolution: "lossless" });
    const automatic = optimizeMeshPolygons(input, { meshResolution: "lossy" });
    const explicit = optimizeMeshPolygons(input, {
      meshResolution: "lossy",
      approximateMerge: {
        maxAngleDeg: 15,
        maxPlaneDisplacement: 0.35,
        maxBoundaryDisplacement: 0.0725,
        isolatedPairs: false,
      },
    });

    expect(input.length).toBeGreaterThanOrEqual(1000);
    expect(renderCost(lossless)).toBeLessThanOrEqual(300);
    expect(automatic).toHaveLength(lossless.length);
    expect(explicit.length).toBeLessThan(lossless.length);
  });

  it("allows lossy approximate merge for same-texture UV polygons", () => {
    const input: Polygon[] = [
      {
        vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
        color: "#fff",
        texture: "texture.png",
        uvs: [[0, 0], [1, 0], [1, 1]],
      },
      {
        vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0.04]],
        color: "#fff",
        texture: "texture.png",
        uvs: [[0, 0], [1, 1], [0, 1]],
      },
    ];

    const lossless = optimizeMeshPolygons(input, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(lossless).toHaveLength(2);
    expect(lossy).toHaveLength(1);
    expect(lossy[0].texture).toBe("texture.png");
    expect(lossy[0].uvs).toHaveLength(4);
    expect(lossy[0].textureTriangles).toHaveLength(2);
    expect(textureTrianglePlaneDistance(lossy[0])).toBeLessThan(1e-8);
  });

  it("does not lossy-merge textured polygons across mismatched UV seams", () => {
    const input: Polygon[] = [
      {
        vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
        color: "#fff",
        texture: "texture.png",
        uvs: [[0, 0], [1, 0], [1, 1]],
      },
      {
        vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0.04]],
        color: "#fff",
        texture: "texture.png",
        uvs: [[0.1, 0], [1, 1], [0, 1]],
      },
    ];

    const lossy = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(lossy).toHaveLength(2);
  });

  it("auto-selects the best lossy approximation strategy", () => {
    const input: Polygon[] = [
      { vertices: [[0, 0, 0], [1, 0, 0], [0.5, 0.5, 0.01]], color: "#f00" },
      { vertices: [[1, 0, 0], [1, 1, 0], [0.5, 0.5, 0.01]], color: "#f00" },
      { vertices: [[1, 1, 0], [0, 1, 0], [0.5, 0.5, 0.01]], color: "#f00" },
      { vertices: [[0, 1, 0], [0, 0, 0], [0.5, 0.5, 0.01]], color: "#f00" },
    ];

    const pairs = optimizeMeshPolygons(input, {
      meshResolution: "lossy",
      approximateMerge: {
        maxAngleDeg: 15,
        maxPlaneDisplacement: 0.35,
        maxBoundaryDisplacement: 0.075,
        isolatedPairs: true,
      },
    });
    const groups = optimizeMeshPolygons(input, {
      meshResolution: "lossy",
      approximateMerge: {
        maxAngleDeg: 15,
        maxPlaneDisplacement: 0.35,
        maxBoundaryDisplacement: 0.075,
        isolatedPairs: false,
      },
    });
    const auto = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(auto.length).toBeLessThanOrEqual(pairs.length);
    expect(auto).toHaveLength(groups.length);
  });

  it("uses wider angle candidates without widening the historical boundary budget", () => {
    const input: Polygon[] = [
      { vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], color: "#f00" },
      { vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0.2]], color: "#f00" },
    ];

    const previousLossy = optimizeMeshPolygons(input, {
      meshResolution: "lossy",
      approximateMerge: {
        maxAngleDeg: 15,
        maxPlaneDisplacement: 0.35,
        maxBoundaryDisplacement: 0.075,
        isolatedPairs: true,
      },
    });
    const auto = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(previousLossy).toHaveLength(2);
    expect(auto).toHaveLength(1);
  });

  it("uses tiny lossy color snapping to unlock exact merges without moving geometry", () => {
    const palette = [
      "#fcca48",
      "#fdca48",
      "#feca48",
      "#fccb48",
      "#fdcb48",
      "#fecb48",
      "#fccc49",
      "#fdcc4a",
    ];
    const input: Polygon[] = [];
    for (let x = 0; x < 12; x++) {
      const color = palette[x % palette.length];
      input.push(...rect(x, 0, x + 1, 1).map((polygon) => ({ ...polygon, color })));
    }

    const lossless = optimizeMeshPolygons(input, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(lossless).toHaveLength(12);
    expect(lossy).toHaveLength(1);
    expect(new Set(lossy[0].vertices.map((vertex) => vertex.join(",")))).toEqual(new Set([
      "0,0,0",
      "12,0,0",
      "12,1,0",
      "0,1,0",
    ]));
  });

  it("keeps automatic lossy optimization exact for large cardinal quad meshes", () => {
    const input: Polygon[] = [];
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        input.push({
          vertices: [[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]],
          color: (x + y) % 2 === 0 ? "#111111" : "#eeeeee",
        });
      }
    }

    const exact = optimizeMeshPolygons(input, {
      meshResolution: "lossy",
      approximateMerge: false,
    });
    const automatic = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(automatic).toHaveLength(exact.length);
    expect(polygonSignature(automatic)).toEqual(polygonSignature(exact));
  });

  it("does not let default lossy rect-cover heuristics regress below lossless", () => {
    const raw = parseGltf(loadGlbGalleryFile("poly-pizza/cardboard-box-closed.glb")).polygons;

    const lossless = optimizeMeshPolygons(raw, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(raw, { meshResolution: "lossy" });

    expect(lossless).toHaveLength(10);
    expect(lossy.length).toBeLessThanOrEqual(lossless.length);
  });

  it("keeps automatic lossy quality fallback under the exact lossless floor", async () => {
    installSolidTextureEnv([10, 20, 30, 255]);

    for (const file of ["poly-pizza/arrow.glb", "poly-pizza/bucket.glb"]) {
      const parsed = parseGltf(loadGlbGalleryFile(file), {
        baseUrl: pathToFileURL(galleryGlbPath(file)).href,
      });
      const baked = await bakeSolidTextureSamples(parsed);

      const lossless = optimizeMeshPolygons(baked.polygons, { meshResolution: "lossless" });
      const lossy = optimizeMeshPolygons(baked.polygons, { meshResolution: "lossy" });

      expect(lossy.length, file).toBeLessThanOrEqual(lossless.length);
      expect(renderCost(lossy), file).toBeLessThanOrEqual(renderCost(lossless) + 1e-9);
    }
  });

  it("does not keep searching lossy candidates after reaching one polygon", () => {
    const input: Polygon[] = [];
    const segments = 12;
    const ring: Vec3[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      ring.push([Math.cos(angle), Math.sin(angle), 0]);
    }
    for (let i = 0; i < segments; i++) {
      input.push({
        vertices: [[0, 0, 0], ring[i], ring[(i + 1) % segments]],
        color: "#abcdef",
      });
    }

    const lossless = optimizeMeshPolygons(input, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(lossless).toHaveLength(1);
    expect(lossy).toHaveLength(1);
    expect(polygonSignature(lossy)).toEqual(polygonSignature(lossless));
  });

  it("salvages safe local pair wins without accepting the unsafe full pair set", () => {
    const raw = parseGltf(loadGlbGalleryFile("Snail.glb")).polygons;

    const lossless = optimizeMeshPolygons(raw, { meshResolution: "lossless" });
    const forced = optimizeMeshPolygons(raw, {
      meshResolution: "lossy",
      approximateMerge: {
        maxAngleDeg: 45,
        maxPlaneDisplacement: 1,
        maxBoundaryDisplacement: 0.0725,
        isolatedPairs: true,
      },
    });
    const automatic = optimizeMeshPolygons(raw, { meshResolution: "lossy" });

    expect(forced.length).toBeLessThan(lossless.length);
    expect(automatic.length).toBeGreaterThan(forced.length);
    expect(automatic.length).toBeLessThan(lossless.length);
  });

  it("keeps lossy pair-merge neighbor seams on shared geometry", () => {
    const input: Polygon[] = [
      { vertices: [[0, 0, 0.02], [1, 0, 0], [1, 1, 0.11]], color: "#f00" },
      { vertices: [[0, 0, 0.02], [1, 1, 0.11], [0, 1, -0.03]], color: "#f00" },
      { vertices: [[1, 0, 0], [2, 0, 0.04], [2, 1, -0.02]], color: "#0f0" },
      { vertices: [[1, 0, 0], [2, 1, -0.02], [1, 1, 0.11]], color: "#0f0" },
    ];

    const baseOptions = {
      meshResolution: "lossy",
      rectCover: false,
      approximateMerge: {
        maxAngleDeg: 45,
        maxPlaneDisplacement: 1,
        maxBoundaryDisplacement: 0.2,
        isolatedPairs: true,
      },
    } as const;
    const lossy = optimizeMeshPolygons(input, baseOptions);

    expect(lossy).toHaveLength(2);
    expect(sharedEdgeCount(lossy)).toBe(1);
  });

  it("keeps finding guarded lossy wins on the coliseum fixture after triangle pairs are exhausted", () => {
    const raw = parseObj(loadObjGalleryFile("coliseum.obj"), {
      targetSize: 80,
      palette: ["#c9a876", "#a78760", "#8b6f47", "#6b5538"],
    }).polygons;

    const lossless = optimizeMeshPolygons(raw, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(raw, { meshResolution: "lossy" });

    expect(lossless.length - lossy.length).toBeGreaterThanOrEqual(480);
  });
});
