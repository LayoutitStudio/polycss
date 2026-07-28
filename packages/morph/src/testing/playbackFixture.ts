import type { PolyMorphMat4, PolyMorphModel } from "../contracts/index.js";
import {
  clonePolyMorphFixture,
  createPolyMorphModelFixture,
  POLY_MORPH_IDENTITY_MATRIX,
} from "./modelFixture.js";

export function polyMorphTranslation(
  x: number,
  y: number,
  z: number,
): PolyMorphMat4 {
  const matrix = [...POLY_MORPH_IDENTITY_MATRIX] as number[];
  matrix[12] = x;
  matrix[13] = y;
  matrix[14] = z;
  return matrix as unknown as PolyMorphMat4;
}

export function createPolyMorphPlaybackFixture(): PolyMorphModel {
  const fixture = clonePolyMorphFixture(createPolyMorphModelFixture("prepared-playback"));
  fixture.topology.vertices.push(
    [3, 0, 0],
    [4, 0, 0],
    [3, 1, 0],
  );
  fixture.topology.normals.push(
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
  );
  fixture.topology.polygons.push({
    id: "static-panel",
    vertexIndices: [3, 4, 5],
    normalIndices: [3, 4, 5],
  });
  const animatedLeaf = fixture.render.leaves[0]!;
  animatedLeaf.strategy = "atlas-slice";
  animatedLeaf.width = 4;
  animatedLeaf.height = 4;
  animatedLeaf.atlas = {
    resourcePath: "assets/gem.webp",
    x: 0,
    y: 0,
    width: 4,
    height: 4,
    pageWidth: 4,
    pageHeight: 8,
  };
  fixture.render.leaves.push({
    id: "static-panel-leaf",
    polygonId: "static-panel",
    shapeId: "gem",
    materialId: "amber",
    strategy: "solid-triangle",
    width: 32,
    height: 32,
    matrix: POLY_MORPH_IDENTITY_MATRIX,
    atlas: null,
    fallback: null,
  });
  fixture.playback = {
    durationMs: 1000,
    loop: true,
    frames: [
      {
        timeMs: 0,
        modelMatrix: null,
        shapes: [],
        leaves: [],
      },
      {
        timeMs: 250,
        modelMatrix: polyMorphTranslation(1, 0, 0),
        shapes: [{
          shapeId: "gem",
          matrix: polyMorphTranslation(0, 2, 0),
        }],
        leaves: [{
          leafId: "gem-panel-leaf",
          matrix: polyMorphTranslation(0, 0, 3),
          visible: false,
          opacity: 0.5,
          atlasRow: 1,
        }],
      },
      {
        timeMs: 750,
        modelMatrix: POLY_MORPH_IDENTITY_MATRIX,
        shapes: [{
          shapeId: "gem",
          matrix: POLY_MORPH_IDENTITY_MATRIX,
        }],
        leaves: [{
          leafId: "gem-panel-leaf",
          matrix: POLY_MORPH_IDENTITY_MATRIX,
          visible: true,
          opacity: 1,
          atlasRow: 0,
        }],
      },
    ],
  };
  return fixture;
}
