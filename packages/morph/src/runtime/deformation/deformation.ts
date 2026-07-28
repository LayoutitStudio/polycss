import {
  computeSolidTrianglePlanFromCssPoints,
  SOLID_TRIANGLE_CANONICAL_SIZE,
  type Polygon,
  type SolidTriangleBasis,
} from "@layoutit/polycss";
import {
  validatePolyMorphModel,
  type PolyMorphMat4,
  type PolyMorphModel,
  type PolyMorphRenderLeaf,
  type PolyMorphTarget,
  type PolyMorphVec3,
} from "../../contracts/index.js";
import type { PolyMorphLeafUpdate } from "../../render/index.js";
import { PolyMorphRuntimeError } from "../runtimeError.js";
import type {
  PolyMorphDeformationFrame,
  PolyMorphDeformationInput,
  PolyMorphDeformationRuntime,
} from "./types.js";

export interface PolyMorphCompiledLeaf {
  readonly leaf: PolyMorphRenderLeaf;
  readonly vertexIndices: readonly number[];
  readonly polygon: Polygon;
  readonly basis: SolidTriangleBasis | null;
}

type MutableVec3 = [number, number, number];

function fail(code: string, path: string, message: string): never {
  throw new PolyMorphRuntimeError(code, path, message);
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("invalid-number", path, "expected a finite number");
  }
  return Object.is(value, -0) ? 0 : value;
}

function normalize(value: PolyMorphVec3): MutableVec3 {
  const length = Math.hypot(...value);
  if (length <= 1e-12) return [0, 0, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function cloneVectors(values: readonly PolyMorphVec3[]): MutableVec3[] {
  return values.map((value) => [value[0], value[1], value[2]]);
}

function freezeVectors(values: MutableVec3[]): readonly PolyMorphVec3[] {
  for (const value of values) Object.freeze(value);
  return Object.freeze(values);
}

function trianglePlan(
  compiled: PolyMorphCompiledLeaf,
  positions: readonly PolyMorphVec3[],
): { readonly matrix: PolyMorphMat4 | null; readonly visible: boolean } {
  const [i0, i1, i2] = compiled.vertexIndices;
  const p0 = positions[i0!]!;
  const p1 = positions[i1!]!;
  const p2 = positions[i2!]!;
  const plan = computeSolidTrianglePlanFromCssPoints(
    compiled.polygon,
    0,
    { seamBleed: 0 },
    {
      basis: compiled.basis ?? undefined,
      includeColor: false,
      primitive: "corner-bevel",
    },
    p0[0], p0[1], p0[2],
    p1[0], p1[1], p1[2],
    p2[0], p2[1], p2[2],
  );
  if (!plan) return { matrix: null, visible: false };
  const match = /^matrix3d\(([^)]+)\)$/u.exec(plan.transformText);
  if (!match) fail("invalid-transform", compiled.leaf.id, "PolyCSS returned no matrix3d");
  const values = match[1]!.split(",").map(Number);
  if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
    fail("invalid-transform", compiled.leaf.id, "PolyCSS returned an invalid matrix3d");
  }
  const xScale = SOLID_TRIANGLE_CANONICAL_SIZE / compiled.leaf.width;
  const yScale = SOLID_TRIANGLE_CANONICAL_SIZE / compiled.leaf.height;
  for (const index of [0, 1, 2]) values[index] *= xScale;
  for (const index of [4, 5, 6]) values[index] *= yScale;
  return {
    matrix: values as unknown as PolyMorphMat4,
    visible: true,
  };
}

function quadMatrix(
  compiled: PolyMorphCompiledLeaf,
  positions: readonly PolyMorphVec3[],
): { readonly matrix: PolyMorphMat4; readonly visible: true } {
  const [i0, i1, i2, i3] = compiled.vertexIndices;
  const p0 = positions[i0!]!;
  const p1 = positions[i1!]!;
  const p2 = positions[i2!]!;
  const p3 = positions[i3!]!;
  const predicted = [
    p1[0] + p3[0] - p0[0],
    p1[1] + p3[1] - p0[1],
    p1[2] + p3[2] - p0[2],
  ] as const;
  if (Math.hypot(
    predicted[0] - p2[0],
    predicted[1] - p2[1],
    predicted[2] - p2[2],
  ) > 1e-6) {
    fail("non-affine-polygon", compiled.leaf.id, "deformed quad is not a parallelogram");
  }
  const x = [
    (p1[0] - p0[0]) / compiled.leaf.width,
    (p1[1] - p0[1]) / compiled.leaf.width,
    (p1[2] - p0[2]) / compiled.leaf.width,
  ] as const;
  const y = [
    (p3[0] - p0[0]) / compiled.leaf.height,
    (p3[1] - p0[1]) / compiled.leaf.height,
    (p3[2] - p0[2]) / compiled.leaf.height,
  ] as const;
  const cross = [
    x[1] * y[2] - x[2] * y[1],
    x[2] * y[0] - x[0] * y[2],
    x[0] * y[1] - x[1] * y[0],
  ] as PolyMorphVec3;
  const z = normalize(cross);
  if (Math.hypot(...z) <= 1e-12) {
    fail("degenerate-polygon", compiled.leaf.id, "deformed quad has no area");
  }
  return {
    matrix: [
      x[0], x[1], x[2], 0,
      y[0], y[1], y[2], 0,
      z[0], z[1], z[2], 0,
      p0[0], p0[1], p0[2], 1,
    ],
    visible: true,
  };
}

export function computePolyMorphPreparedLeafMatrix(
  compiled: PolyMorphCompiledLeaf,
  positions: readonly PolyMorphVec3[],
): { readonly matrix: PolyMorphMat4 | null; readonly visible: boolean } {
  if (compiled.vertexIndices.length === 3) return trianglePlan(compiled, positions);
  if (compiled.vertexIndices.length === 4) return quadMatrix(compiled, positions);
  fail(
    "unsupported-deformation",
    compiled.leaf.id,
    "caller-driven deformation supports prepared triangles and affine quads",
  );
}

export function compilePolyMorphPreparedLeaf(
  model: PolyMorphModel,
  leaf: PolyMorphRenderLeaf,
): PolyMorphCompiledLeaf {
  const polygon = model.topology.polygons.find((entry) => entry.id === leaf.polygonId);
  if (!polygon) fail("unknown-polygon", leaf.id, leaf.polygonId);
  const vertices = polygon.vertexIndices.map((index) => [...model.topology.vertices[index]!] as [
    number,
    number,
    number,
  ]);
  const poly: Polygon = { vertices };
  let basis: SolidTriangleBasis | null = null;
  if (vertices.length === 3) {
    const [p0, p1, p2] = vertices;
    const plan = computeSolidTrianglePlanFromCssPoints(
      poly,
      0,
      { seamBleed: 0 },
      { includeColor: false, primitive: "corner-bevel" },
      p0![0], p0![1], p0![2],
      p1![0], p1![1], p1![2],
      p2![0], p2![1], p2![2],
    );
    if (!plan) fail("degenerate-polygon", leaf.id, "base triangle has no area");
    basis = plan.basis;
  }
  return {
    leaf,
    vertexIndices: polygon.vertexIndices,
    polygon: poly,
    basis,
  };
}

function exactNumericRecord(
  value: Readonly<Record<string, number>> | undefined,
  ids: readonly string[],
  path: string,
  bounds: ReadonlyMap<string, readonly [number, number]>,
): Record<string, number> {
  const input = value ?? {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("invalid-input", path, "expected an object");
  }
  const allowed = new Set(ids);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown) fail("unknown-id", path, unknown);
  return Object.fromEntries(ids.map((id) => {
    const [minimum, maximum] = bounds.get(id) ?? [0, 1];
    const requested = finite(input[id] ?? 0, `${path}.${id}`);
    if (requested < minimum || requested > maximum) {
      fail("out-of-range", `${path}.${id}`, `expected ${minimum} <= value <= ${maximum}`);
    }
    return [id, requested];
  }));
}

function targetMap(model: PolyMorphModel): ReadonlyMap<string, PolyMorphTarget> {
  return new Map(model.deformation.kind === "morph-regions"
    ? model.deformation.targets.map((target) => [target.id, target])
    : []);
}

export function createPolyMorphDeformationRuntime(
  modelInput: unknown,
): PolyMorphDeformationRuntime {
  const model = validatePolyMorphModel(modelInput);
  if (model.deformation.kind === "joint-skin") {
    fail("profile-not-executable", "$.profile", "joint skin requires the skinning runtime");
  }
  const targets = targetMap(model);
  const targetIds = [...targets.keys()];
  const controlIds = model.controls.map((control) => control.id);
  const targetBounds = new Map(targetIds.map((id) => [id, [0, 1] as const]));
  const controlBounds = new Map(model.controls.map((control) => [
    control.id,
    [control.minimum, control.maximum] as const,
  ]));
  const leafByPolygon = new Map(model.render.leaves.map((leaf) => [leaf.polygonId, leaf]));
  const polygonsByVertex = new Map<number, string[]>();
  for (const polygon of model.topology.polygons) {
    for (const vertexIndex of polygon.vertexIndices) {
      const rows = polygonsByVertex.get(vertexIndex) ?? [];
      rows.push(polygon.id);
      polygonsByVertex.set(vertexIndex, rows);
    }
  }
  const affectedLeavesByTarget = new Map<string, ReadonlySet<string>>();
  for (const target of targets.values()) {
    const leafIds = new Set<string>();
    for (const delta of target.deltas) {
      for (const polygonId of polygonsByVertex.get(delta.vertexIndex) ?? []) {
        const leaf = leafByPolygon.get(polygonId);
        if (leaf) leafIds.add(leaf.id);
      }
    }
    affectedLeavesByTarget.set(target.id, leafIds);
  }
  const compiledLeaves = new Map(model.render.leaves.map((leaf) => [
    leaf.id,
    compilePolyMorphPreparedLeaf(model, leaf),
  ]));
  const basePositions = freezeVectors(cloneVectors(model.topology.vertices));
  const baseNormals = freezeVectors(cloneVectors(model.topology.normals));
  let priorEffective = Object.fromEntries(targetIds.map((id) => [id, 0])) as Record<string, number>;
  let lastPositions = basePositions;
  let lastNormals = baseNormals;

  const sample = (input: PolyMorphDeformationInput): PolyMorphDeformationFrame => {
    if (!input || !Number.isSafeInteger(input.tick) || input.tick < 0) {
      fail("invalid-tick", "$.tick", "expected a non-negative safe integer");
    }
    const requestedMorph = exactNumericRecord(
      input.morphWeights,
      targetIds,
      "$.morphWeights",
      targetBounds,
    );
    const controlValues = exactNumericRecord(
      input.controlValues,
      controlIds,
      "$.controlValues",
      controlBounds,
    );
    const effective: Record<string, number> = { ...requestedMorph };
    for (const control of model.controls) {
      const value = controlValues[control.id]!;
      for (const target of control.targets) {
        effective[target.targetId] = Math.max(
          0,
          Math.min(1, (effective[target.targetId] ?? 0) + value * target.scale),
        );
      }
    }
    const changedTargets = targetIds.filter((id) => effective[id] !== priorEffective[id]);
    let positions: readonly PolyMorphVec3[] = lastPositions;
    let normals: readonly PolyMorphVec3[] = lastNormals;
    if (changedTargets.length > 0) {
      const nextPositions = cloneVectors(basePositions);
      let nextNormals = cloneVectors(baseNormals);
      for (const targetId of targetIds) {
        const weight = effective[targetId]!;
        if (weight === 0) continue;
        for (const delta of targets.get(targetId)!.deltas) {
          const position = nextPositions[delta.vertexIndex]!;
          if (delta.position) {
            position[0] += delta.position[0] * weight;
            position[1] += delta.position[1] * weight;
            position[2] += delta.position[2] * weight;
          }
          const normal = nextNormals[delta.vertexIndex]!;
          if (delta.normal) {
            normal[0] += delta.normal[0] * weight;
            normal[1] += delta.normal[1] * weight;
            normal[2] += delta.normal[2] * weight;
          }
        }
      }
      nextNormals = nextNormals.map(normalize);
      positions = freezeVectors(nextPositions);
      normals = freezeVectors(nextNormals);
    }
    const dirtySet = new Set<string>();
    for (const targetId of changedTargets) {
      for (const leafId of affectedLeavesByTarget.get(targetId) ?? []) dirtySet.add(leafId);
    }
    const dirtyLeafIds = model.render.leaves
      .map((leaf) => leaf.id)
      .filter((id) => dirtySet.has(id));
    const leafUpdates: PolyMorphLeafUpdate[] = dirtyLeafIds.map((leafId) => {
      const prepared = computePolyMorphPreparedLeafMatrix(compiledLeaves.get(leafId)!, positions);
      return {
        leafId,
        visible: prepared.visible,
        ...(prepared.matrix ? { matrix: prepared.matrix } : {}),
      };
    });
    lastPositions = positions;
    lastNormals = normals;
    priorEffective = { ...effective };
    return {
      tick: input.tick,
      positions,
      normals,
      morphWeights: Object.freeze({ ...effective }),
      controlValues: Object.freeze({ ...controlValues }),
      dirtyLeafIds: Object.freeze(dirtyLeafIds),
      leafUpdates: Object.freeze(leafUpdates),
      runtimePolygonConstructions: 0,
      runtimeTopologyConstructions: 0,
      atlasRedraws: 0,
    };
  };

  return Object.freeze({
    model,
    targetIds: Object.freeze(targetIds),
    controlIds: Object.freeze(controlIds),
    basePositions: Object.freeze(basePositions),
    baseNormals: Object.freeze(baseNormals),
    sample,
    reset(): void {
      priorEffective = Object.fromEntries(targetIds.map((id) => [id, 0]));
      lastPositions = basePositions;
      lastNormals = baseNormals;
    },
  });
}
