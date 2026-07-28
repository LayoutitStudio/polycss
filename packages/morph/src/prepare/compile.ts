import {
  computeSolidTrianglePlanFromCssPoints,
  SOLID_TRIANGLE_CANONICAL_SIZE,
  type Polygon,
} from "@layoutit/polycss";
import {
  POLY_MORPH_MODEL_SCHEMA,
  validatePolyMorphModel,
  type PolyMorphCapability,
  type PolyMorphColor,
  type PolyMorphMat4,
  type PolyMorphModel,
  type PolyMorphTarget,
  type PolyMorphVec3,
} from "../contracts/index.js";
import { buildPolyMorphPackage } from "../package/index.js";
import { failPolyMorphPrepare } from "./error.js";
import {
  buildPolyMorphSolidTriangleAtlas,
} from "./solidTriangleAtlas.js";
import packageMetadata from "../../package.json";
import type {
  PolyMorphGltfDocument,
  PolyMorphPrepareConfig,
  PolyMorphPreparedPackage,
  PolyMorphPreparedSource,
} from "./types.js";

const IDENTITY: PolyMorphMat4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];
const PREPARER_VERSION = packageMetadata.version;

function rounded(value: number): number {
  const result = Number(value.toFixed(10));
  return Object.is(result, -0) ? 0 : result;
}

function roundedVec3(value: readonly number[]): PolyMorphVec3 {
  return [rounded(value[0]!), rounded(value[1]!), rounded(value[2]!)];
}

function normalizedName(value: string, fallback: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
  const candidate = slug || fallback;
  return /^[a-z]/u.test(candidate) ? candidate : `item-${candidate}`;
}

function transformPoint(
  matrix: PolyMorphMat4,
  [x, y, z]: PolyMorphVec3,
): PolyMorphVec3 {
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) {
    failPolyMorphPrepare(
      "invalid-transform",
      "$.source.nodes",
      "node has a singular projective transform",
    );
  }
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w,
  ];
}

function transformVector(
  matrix: PolyMorphMat4,
  [x, y, z]: PolyMorphVec3,
): PolyMorphVec3 {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z,
    matrix[1] * x + matrix[5] * y + matrix[9] * z,
    matrix[2] * x + matrix[6] * y + matrix[10] * z,
  ];
}

function authoredVector(
  vector: PolyMorphVec3,
  config: PolyMorphPrepareConfig,
): PolyMorphVec3 {
  const source = { x: vector[0], y: vector[1], z: vector[2] };
  return roundedVec3(config.transform.axes.map((axis, index) =>
    source[axis] * config.transform.signs[index]! * config.transform.scale));
}

function reversesHandedness(
  matrix: PolyMorphMat4,
  config: PolyMorphPrepareConfig,
): boolean {
  const sourceBasis: readonly PolyMorphVec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const basis = sourceBasis.map((vector) => {
    const transformed = transformVector(
      matrix,
      vector,
    );
    const source = {
      x: transformed[0],
      y: transformed[1],
      z: transformed[2],
    };
    return config.transform.axes.map((axis, index) =>
      source[axis] * config.transform.signs[index]! * config.transform.scale,
    ) as unknown as PolyMorphVec3;
  });
  const [x, y, z] = basis;
  const determinant =
    x![0] * (y![1] * z![2] - y![2] * z![1])
    - y![0] * (x![1] * z![2] - x![2] * z![1])
    + z![0] * (x![1] * y![2] - x![2] * y![1]);
  return determinant < 0;
}

function subtract(left: PolyMorphVec3, right: PolyMorphVec3): PolyMorphVec3 {
  return [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  ];
}

function cross(left: PolyMorphVec3, right: PolyMorphVec3): PolyMorphVec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalise(value: readonly number[], path: string): PolyMorphVec3 {
  const length = Math.hypot(...value);
  if (!(length > 1e-10)) {
    failPolyMorphPrepare("degenerate-triangle", path, "triangle has zero area");
  }
  return roundedVec3(value.map((component) => component / length));
}

function computeNormals(
  vertices: readonly PolyMorphVec3[],
  polygons: readonly { readonly id: string; readonly vertexIndices: readonly number[] }[],
): readonly PolyMorphVec3[] {
  const sums = Array.from({ length: vertices.length }, () => [0, 0, 0]);
  for (const polygon of polygons) {
    const [a, b, c] = polygon.vertexIndices.map((index) => vertices[index]!);
    const value = cross(subtract(b!, a!), subtract(c!, a!));
    if (Math.hypot(...value) <= 1e-10) {
      failPolyMorphPrepare(
        "degenerate-triangle",
        `$.topology.${polygon.id}`,
        "triangle has zero area",
      );
    }
    for (const index of polygon.vertexIndices) {
      sums[index]![0] += value[0];
      sums[index]![1] += value[1];
      sums[index]![2] += value[2];
    }
  }
  return sums.map((sum, index) =>
    normalise(sum, `$.topology.normals[${index}]`));
}

function triangleMatrix(
  vertices: readonly PolyMorphVec3[],
  path: string,
): PolyMorphMat4 {
  const polygon: Polygon = { vertices: vertices.map((vertex) => [...vertex]) };
  const [p0, p1, p2] = vertices;
  const plan = computeSolidTrianglePlanFromCssPoints(
    polygon,
    0,
    { seamBleed: 0 },
    {
      includeColor: false,
      matrixDecimals: 10,
      primitive: "border",
    },
    p0![0], p0![1], p0![2],
    p1![0], p1![1], p1![2],
    p2![0], p2![1], p2![2],
  );
  const match = /^matrix3d\(([^)]+)\)$/u.exec(plan?.transformText ?? "");
  const values = match?.[1]?.split(",").map(Number);
  if (!values || values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
    failPolyMorphPrepare("unrenderable-triangle", path, "PolyCSS produced no stable matrix");
  }
  return values.map(rounded) as unknown as PolyMorphMat4;
}

function capabilities(config: PolyMorphPrepareConfig): readonly PolyMorphCapability[] {
  const values = new Set<PolyMorphCapability>(["retained-render"]);
  if (config.profile === "morph-regions") {
    values.add("morph-targets");
    values.add("sparse-updates");
  }
  if (config.controls.length > 0) values.add("semantic-controls");
  if (config.springs.length > 0) values.add("springs");
  if (config.animations.length > 0) values.add("animation");
  return [...values].sort();
}

export async function compilePolyMorphSource(
  source: PolyMorphGltfDocument,
  config: PolyMorphPrepareConfig,
): Promise<PolyMorphPreparedSource> {
  type PendingPolygon = {
    readonly id: string;
    readonly shapeId: string;
    readonly materialIndex: number;
    readonly vertexIndices: readonly [number, number, number];
  };
  const vertices: PolyMorphVec3[] = [];
  const pendingPolygons: PendingPolygon[] = [];
  const shapes: { id: string; matrix: PolyMorphMat4 }[] = [];
  const aliasEntries = Object.entries(config.morphAliases);
  const deltasByTarget = new Map<string, PolyMorphVec3[]>(
    aliasEntries.map(([, targetId]) => [targetId, []]),
  );
  const usedMaterialIndices = new Set<number>();
  let shapeIndex = 0;
  let polygonIndex = 0;

  for (const instance of source.instances) {
    const reverseWinding = reversesHandedness(instance.matrix, config);
    for (const primitive of instance.primitives) {
      const shapeId = `shape-${String(shapeIndex).padStart(4, "0")}-${normalizedName(
        `${instance.meshName}-${primitive.primitiveIndex}`,
        "mesh",
      )}`;
      shapes.push({ id: shapeId, matrix: IDENTITY });
      const targetByName = new Map(
        primitive.targets.map((target) => [target.name, target]),
      );
      if (
        aliasEntries.some(([sourceName]) => !targetByName.has(sourceName))
      ) {
        failPolyMorphPrepare(
          "missing-morph",
          `$.source.${shapeId}`,
          "every primitive must contain every configured morph target",
        );
      }
      const usedVertexIndices = [...new Set(primitive.triangles.flat())]
        .sort((left, right) => left - right);
      const preparedIndexBySource = new Map<number, number>();
      for (const localIndex of usedVertexIndices) {
        const position = primitive.positions[localIndex]!;
        preparedIndexBySource.set(localIndex, vertices.length);
        const world = transformPoint(instance.matrix, position);
        vertices.push(authoredVector(world, config));
        for (const [sourceName, targetId] of aliasEntries) {
          const sourceDelta = targetByName.get(sourceName)!.positionDeltas[localIndex]!;
          const worldDelta = transformVector(instance.matrix, sourceDelta);
          deltasByTarget.get(targetId)!.push(authoredVector(worldDelta, config));
        }
      }
      usedMaterialIndices.add(primitive.materialIndex);
      for (const triangle of primitive.triangles) {
        const ordered = reverseWinding
          ? [triangle[0], triangle[2], triangle[1]]
          : triangle;
        pendingPolygons.push({
          id: `polygon-${String(polygonIndex).padStart(6, "0")}`,
          shapeId,
          materialIndex: primitive.materialIndex,
          vertexIndices: [
            preparedIndexBySource.get(ordered[0])!,
            preparedIndexBySource.get(ordered[1])!,
            preparedIndexBySource.get(ordered[2])!,
          ],
        });
        polygonIndex += 1;
      }
      shapeIndex += 1;
    }
  }

  if (config.transform.center) {
    const minimum = [Infinity, Infinity, Infinity];
    const maximum = [-Infinity, -Infinity, -Infinity];
    for (const vertex of vertices) {
      for (let axis = 0; axis < 3; axis += 1) {
        minimum[axis] = Math.min(minimum[axis]!, vertex[axis]!);
        maximum[axis] = Math.max(maximum[axis]!, vertex[axis]!);
      }
    }
    const center = minimum.map((value, axis) =>
      (value + maximum[axis]!) / 2) as unknown as PolyMorphVec3;
    for (let index = 0; index < vertices.length; index += 1) {
      vertices[index] = roundedVec3(subtract(vertices[index]!, center));
    }
  }

  const materialRows = [...usedMaterialIndices].sort((left, right) => left - right);
  const sourceMaterialByIndex = new Map(
    source.materials.map((material) => [material.sourceIndex, material]),
  );
  const materials = materialRows.map((sourceIndex) => {
    const sourceMaterial = sourceIndex === -1
      ? { name: "Default", color: [1, 1, 1, 1] as PolyMorphColor }
      : sourceMaterialByIndex.get(sourceIndex);
    if (!sourceMaterial) {
      failPolyMorphPrepare(
        "invalid-material",
        "$.source.materials",
        `primitive references missing material ${sourceIndex}`,
      );
    }
    return {
      sourceIndex,
      id: sourceIndex === -1
        ? "material-default"
        : `material-${String(sourceIndex).padStart(4, "0")}-${normalizedName(
          sourceMaterial.name,
          "source",
        )}`,
      color: sourceMaterial.color,
    };
  });
  const materialIdByIndex = new Map(
    materials.map((material) => [material.sourceIndex, material.id]),
  );
  const polygons = pendingPolygons.map((polygon) => ({
    id: polygon.id,
    vertexIndices: polygon.vertexIndices,
    normalIndices: polygon.vertexIndices,
  }));
  const normals = computeNormals(vertices, polygons);
  const targets: PolyMorphTarget[] = aliasEntries.map(([, targetId]) => ({
    id: targetId,
    deltas: deltasByTarget.get(targetId)!
      .map((position, vertexIndex) => ({ position, vertexIndex }))
      .filter(({ position }) => Math.hypot(...position) > 1e-12)
      .map(({ position, vertexIndex }) => ({
        vertexIndex,
        position,
        normal: null,
      })),
  }));
  if (targets.some((target) => target.deltas.length === 0)) {
    failPolyMorphPrepare(
      "empty-morph",
      "$.morphAliases",
      "every configured morph target must move at least one vertex",
    );
  }
  const baseLeaves = pendingPolygons.map((polygon) => {
    const materialId = materialIdByIndex.get(polygon.materialIndex)!;
    return {
      id: `leaf-${polygon.id}`,
      polygonId: polygon.id,
      shapeId: polygon.shapeId,
      materialId,
      strategy: "solid-triangle" as const,
      width: SOLID_TRIANGLE_CANONICAL_SIZE,
      height: SOLID_TRIANGLE_CANONICAL_SIZE,
      matrix: triangleMatrix(
        polygon.vertexIndices.map((index) => vertices[index]!),
        `$.render.${polygon.id}`,
      ),
      atlas: null,
      fallback: null,
    };
  });
  const fallbackAtlas = buildPolyMorphSolidTriangleAtlas(
    pendingPolygons.map((polygon, index) => ({
      vertexIndices: polygon.vertexIndices,
      vertices: polygon.vertexIndices.map((vertexIndex) =>
        vertices[vertexIndex]!) as unknown as readonly [
          PolyMorphVec3,
          PolyMorphVec3,
          PolyMorphVec3,
        ],
      materialId: materialIdByIndex.get(polygon.materialIndex)!,
      leafMatrix: baseLeaves[index]!.matrix,
    })),
  );
  const leaves = baseLeaves.map((leaf, index) => ({
    ...leaf,
    fallback: fallbackAtlas.fallbacks[index]!,
  }));
  const modelInput: PolyMorphModel = {
    schema: POLY_MORPH_MODEL_SCHEMA,
    identity: config.identity,
    profile: config.profile,
    capabilities: capabilities(config),
    budgets: config.budgets,
    topology: { vertices, normals, polygons },
    materials: materials.map(({ id, color }) => ({ id, color })),
    render: {
      modelMatrix: IDENTITY,
      shapes,
      leaves,
    },
    deformation: config.profile === "morph-regions"
      ? { kind: "morph-regions", targets }
      : { kind: "none" },
    controls: config.controls,
    springs: config.springs,
    animations: config.animations,
    playback: null,
    provenance: {
      generator: "polycss-morph",
      generatorVersion: PREPARER_VERSION,
      sources: [{
        id: config.source.id,
        kind: config.source.kind,
        uri: config.source.uri,
        sha256: source.contentSha256,
        license: config.source.license,
      }],
    },
  };
  const model = validatePolyMorphModel(modelInput);
  return {
    model,
    fallbackAtlasPages: fallbackAtlas.pages,
  };
}

export async function buildPolyMorphPreparedPackage(
  source: PolyMorphGltfDocument,
  config: PolyMorphPrepareConfig,
): Promise<PolyMorphPreparedPackage> {
  const prepared = await compilePolyMorphSource(source, config);
  const built = await buildPolyMorphPackage(prepared.model, [
    ...prepared.fallbackAtlasPages.map((page) => ({
      path: page.path,
      role: "image",
      mediaType: "image/png",
      bytes: page.bytes,
    } as const)),
  ]);
  return { source, prepared, package: built };
}
