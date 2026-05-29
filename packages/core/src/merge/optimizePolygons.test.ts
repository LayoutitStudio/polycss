import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import type { Polygon, Vec3 } from "../types";
import { parseGltf } from "../parser/parseGltf";
import { parseObj } from "../parser/parseObj";
import { bakeSolidTextureSamples } from "../parser/solidTextureSamples";
import { seamOverlapDiagnostics } from "./seamRepair";
import { optimizeMeshPolygons } from "./optimizePolygons";

function rect(x0: number, y0: number, x1: number, y1: number): Polygon[] {
  return [
    { vertices: [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0]], color: "#f00" },
    { vertices: [[x0, y0, 0], [x1, y1, 0], [x0, y1, 0]], color: "#f00" },
  ];
}

function shallowFoldedTrianglePairs(count: number): Polygon[] {
  const polygons: Polygon[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = i * 2;
    polygons.push(
      {
        vertices: [[x, 0, 0], [x + 1, 0, 0], [x + 1, 1, 0]],
        color: "#6688aa",
      },
      {
        vertices: [[x, 0, 0], [x + 1, 1, 0], [x, 1, 0.04]],
        color: "#6688aa",
      },
    );
  }
  return polygons;
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

function strictNonConvexPolygonCount(polygons: Polygon[]): number {
  let count = 0;
  for (const polygon of polygons) {
    if (polygon.vertices.length < 3 || polygonTriangleFanArea(polygon.vertices) <= 1e-8) continue;
    if (!isStrictlyWeakConvexPolygon(polygon.vertices)) count += 1;
  }
  return count;
}

function polygonTriangleFanArea(vertices: Vec3[]): number {
  let area = 0;
  const origin = vertices[0];
  for (let i = 1; i + 1 < vertices.length; i++) {
    const ab = [
      vertices[i][0] - origin[0],
      vertices[i][1] - origin[1],
      vertices[i][2] - origin[2],
    ];
    const ac = [
      vertices[i + 1][0] - origin[0],
      vertices[i + 1][1] - origin[1],
      vertices[i + 1][2] - origin[2],
    ];
    area += Math.hypot(
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ) * 0.5;
  }
  return area;
}

function isStrictlyWeakConvexPolygon(vertices: Vec3[]): boolean {
  const normal = polygonNormal(vertices);
  if (!normal) return false;
  let sign = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const c = vertices[(i + 2) % vertices.length];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const bc = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const turn =
      (ab[1] * bc[2] - ab[2] * bc[1]) * normal[0] +
      (ab[2] * bc[0] - ab[0] * bc[2]) * normal[1] +
      (ab[0] * bc[1] - ab[1] * bc[0]) * normal[2];
    if (Math.abs(turn) <= 1e-9) continue;
    const nextSign = Math.sign(turn);
    if (sign === 0) sign = nextSign;
    else if (nextSign !== sign) return false;
  }
  return true;
}

function polygonNormal(vertices: Vec3[]): Vec3 | null {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const length = Math.hypot(nx, ny, nz);
  return length > 1e-12 ? [nx / length, ny / length, nz / length] : null;
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

  it("preserves double-sided reverse-wound polygons through optimization", () => {
    const front: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      color: "#f00",
      doubleSided: true,
    };
    const back: Polygon = {
      vertices: [[0, 0, 0], [0, 1, 0], [1, 0, 0]],
      color: "#f00",
      doubleSided: true,
    };

    expect(optimizeMeshPolygons([front, back], { meshResolution: "lossless" })).toHaveLength(2);
    expect(optimizeMeshPolygons([front, back], { meshResolution: "lossy" })).toHaveLength(2);
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

  it("preserves texture wrap through lossy textured merges", () => {
    const input: Polygon[] = [
      {
        vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
        color: "#fff",
        texture: "texture.png",
        textureWrap: { s: "repeat", t: "repeat" },
        textureAlphaMode: "opaque",
        uvs: [[0, 0], [1, 0], [1, 1]],
      },
      {
        vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0.04]],
        color: "#fff",
        texture: "texture.png",
        textureWrap: { s: "repeat", t: "repeat" },
        textureAlphaMode: "opaque",
        uvs: [[0, 0], [1, 1], [0, 1]],
      },
    ];

    const lossy = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(lossy).toHaveLength(1);
    expect(lossy[0].textureWrap).toEqual({ s: "repeat", t: "repeat" });
    expect(lossy[0].textureAlphaMode).toBe("opaque");
  });

  it("does not lossy-merge textured polygons across different texture wraps", () => {
    const input: Polygon[] = [
      {
        vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
        color: "#fff",
        texture: "texture.png",
        textureWrap: { s: "repeat", t: "repeat" },
        uvs: [[0, 0], [1, 0], [1, 1]],
      },
      {
        vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0.04]],
        color: "#fff",
        texture: "texture.png",
        textureWrap: { s: "clamp-to-edge", t: "repeat" },
        uvs: [[0, 0], [1, 1], [0, 1]],
      },
    ];

    const lossy = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(lossy).toHaveLength(2);
  });

  it("does not lossy-merge textured polygons across different texture alpha modes", () => {
    const input: Polygon[] = [
      {
        vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
        color: "#fff",
        texture: "texture.png",
        textureAlphaMode: "opaque",
        uvs: [[0, 0], [1, 0], [1, 1]],
      },
      {
        vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0.04]],
        color: "#fff",
        texture: "texture.png",
        textureAlphaMode: "blend",
        uvs: [[0, 0], [1, 1], [0, 1]],
      },
    ];

    const lossy = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(lossy).toHaveLength(2);
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

  it("keeps tiny color differences as material boundaries", () => {
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
    expect(lossy).toHaveLength(12);
  });

  it("keeps default lossy optimization exact for large cardinal quad meshes", () => {
    const input: Polygon[] = [];
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        input.push({
          vertices: [[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]],
          color: (x + y) % 2 === 0 ? "#111111" : "#eeeeee",
        });
      }
    }

    const exact = optimizeMeshPolygons(input, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(lossy).toHaveLength(exact.length);
    expect(polygonSignature(lossy)).toEqual(polygonSignature(exact));
  });

  it("does not let default lossy rect-cover heuristics regress below lossless", () => {
    const raw = parseGltf(loadGlbGalleryFile("poly-pizza/cardboard-box-closed.glb")).polygons;

    const lossless = optimizeMeshPolygons(raw, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(raw, { meshResolution: "lossy" });

    expect(lossless).toHaveLength(10);
    expect(renderCost(lossy)).toBeLessThanOrEqual(renderCost(lossless) + 1e-9);
  });

  it("keeps default lossy solid-texture fixtures no more expensive than lossless", async () => {
    installSolidTextureEnv([10, 20, 30, 255]);

    for (const file of ["poly-pizza/arrow.glb", "poly-pizza/bucket.glb"]) {
      const parsed = parseGltf(loadGlbGalleryFile(file), {
        baseUrl: pathToFileURL(galleryGlbPath(file)).href,
      });
      const baked = await bakeSolidTextureSamples(parsed);

      const lossless = optimizeMeshPolygons(baked.polygons, { meshResolution: "lossless" });
      const lossy = optimizeMeshPolygons(baked.polygons, { meshResolution: "lossy" });

      expect(renderCost(lossy), file).toBeLessThanOrEqual(renderCost(lossless) + 1e-9);
    }
  });

  it("keeps lossy approximate wins on a long strip of shallow folds", () => {
    const raw = shallowFoldedTrianglePairs(80);

    const lossless = optimizeMeshPolygons(raw, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(raw, { meshResolution: "lossy" });

    expect(lossy.length).toBeLessThan(lossless.length);
    expect(renderCost(lossy)).toBeLessThan(renderCost(lossless));
  });

  it("keeps default lossy cheaper than lossless on the Large Building fixture", () => {
    const raw = parseGltf(loadGlbGalleryFile("city/Large Building.glb"), { targetSize: 60 }).polygons;

    const lossless = optimizeMeshPolygons(raw, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(raw, { meshResolution: "lossy" });

    expect(lossy.length).toBeLessThanOrEqual(lossless.length);
    expect(renderCost(lossy)).toBeLessThanOrEqual(renderCost(lossless));
  }, 10_000);

  it("uses the gated aggressive approximate pass without adding unclosed seams", () => {
    const raw = parseGltf(loadGlbGalleryFile("poly-pizza/animated-shark.glb"), { targetSize: 60 }).polygons;

    const lossy = optimizeMeshPolygons(raw, { meshResolution: "lossy" });
    const seamDiagnostics = seamOverlapDiagnostics(lossy);

    expect(lossy).toHaveLength(634);
    expect(seamDiagnostics.unclosedPairs).toBe(0);
    expect(seamDiagnostics.maxResidualGapPx).toBe(0);
  });

  it("rejects large-model rect-cover candidates when topology gap diagnostics are not clean", () => {
    const raw = parseGltf(loadGlbGalleryFile("nasa/opportunity.glb"), { targetSize: 60 }).polygons;

    const lossless = optimizeMeshPolygons(raw, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(raw, { meshResolution: "lossy" });
    const losslessSeams = seamOverlapDiagnostics(lossless);
    const lossySeams = seamOverlapDiagnostics(lossy);

    expect(lossless).toHaveLength(1895);
    expect(lossy).toHaveLength(1667);
    expect(renderCost(lossy)).toBeLessThanOrEqual(renderCost(lossless));
    expect(lossySeams.unclosedPairs).toBeLessThanOrEqual(losslessSeams.unclosedPairs);
    expect(lossySeams.maxResidualGapPx).toBeLessThanOrEqual(losslessSeams.maxResidualGapPx);
  }, 10_000);

  it("keeps small seam-risk fixtures seam-safe under gated lossy candidates", () => {
    const rock = parseGltf(loadGlbGalleryFile("poly-pizza/rock.glb"), { targetSize: 60 }).polygons;
    const hauntedHouse = parseObj(
      loadObjGalleryFile("opengameart/haunted-house/hauntedhouse.obj"),
      { targetSize: 60 },
    ).polygons;
    const chest = parseObj(loadObjGalleryFile("quaternius/dungeon/Chest_gold.obj"), {
      targetSize: 60,
    }).polygons;

    expect(optimizeMeshPolygons(rock, { meshResolution: "lossy" })).toHaveLength(58);
    expect(optimizeMeshPolygons(hauntedHouse, { meshResolution: "lossy" })).toHaveLength(184);
    const chestLossless = optimizeMeshPolygons(chest, { meshResolution: "lossless" });
    const chestLossy = optimizeMeshPolygons(chest, { meshResolution: "lossy" });
    const losslessSeams = seamOverlapDiagnostics(chestLossless);
    const lossySeams = seamOverlapDiagnostics(chestLossy);

    expect(chestLossless).toHaveLength(258);
    expect(chestLossy).toHaveLength(250);
    expect(lossySeams.unclosedPairs).toBeLessThanOrEqual(losslessSeams.unclosedPairs);
    expect(lossySeams.maxResidualGapPx).toBeLessThanOrEqual(losslessSeams.maxResidualGapPx);
  });

  it("keeps lossless optimization from culling open spacecraft geometry", () => {
    const raw = parseGltf(loadGlbGalleryFile("nasa/cubesat-1u.glb"), { targetSize: 60 }).polygons;

    const lossless = optimizeMeshPolygons(raw, { meshResolution: "lossless" });

    expect(raw).toHaveLength(6063);
    expect(lossless.length).toBeGreaterThan(1500);
  }, 10_000);

  it("does not turn castle lossy output into concave render polygons", () => {
    const raw = parseObj(loadObjGalleryFile("castle.obj"), { targetSize: 60 }).polygons;

    const lossless = optimizeMeshPolygons(raw, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(raw, { meshResolution: "lossy" });

    expect(strictNonConvexPolygonCount(lossy)).toBeLessThanOrEqual(
      strictNonConvexPolygonCount(lossless) + 1,
    );
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

  it("keeps default lossy pair wins on the Snail fixture", () => {
    const raw = parseGltf(loadGlbGalleryFile("Snail.glb")).polygons;

    const lossless = optimizeMeshPolygons(raw, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(raw, { meshResolution: "lossy" });

    expect(lossy.length).toBeLessThan(lossless.length);
    expect(renderCost(lossy)).toBeLessThan(renderCost(lossless));
  });

  it("keeps default lossy wins on repeated shallow triangle folds", () => {
    const raw = shallowFoldedTrianglePairs(48);

    const lossless = optimizeMeshPolygons(raw, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(raw, { meshResolution: "lossy" });

    expect(lossless.length - lossy.length).toBeGreaterThanOrEqual(40);
    expect(renderCost(lossy)).toBeLessThan(renderCost(lossless));
  });
});
