import type { Vec3 } from "@layoutit/polycss-core";
import type { PolyWorldData } from "../topology";
import {
  createPolyWorldBspTree,
  PolyWorldBspError,
  type PolyWorldBspChild,
  type PolyWorldBspDiagnostic,
  type PolyWorldBspPlane,
  type PolyWorldBspTree,
} from "./bsp";
import {
  crossVec3 as cross,
  dotVec3 as dot,
  lengthSqVec3 as lengthSq,
  lerpVec3,
  normalizeVec3OrZero as normalizeVec3,
  sameVec3,
  signedPlaneDistance,
  subtractVec3,
} from "./bspGeometry";

type PolygonBspSide = "front" | "back" | "coplanar" | "spanning";

interface PolygonBspFragment {
  id: string;
  sourceSurfaceId: string;
  vertices: Vec3[];
  regionId?: string;
  elementId?: string;
  selectionKeys?: readonly string[];
  data?: PolyWorldData;
}

interface PolygonBspCompileState {
  fragments: PolygonBspFragment[];
  leafCount: number;
  nodeCount: number;
  fragmentCount: number;
}

export interface PolyWorldBspSurface {
  id: string;
  vertices: readonly Vec3[];
  regionId?: string;
  elementId?: string;
  selectionKeys?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldPolygonBspCompileInput {
  surfaces: readonly PolyWorldBspSurface[];
  epsilon?: number;
  maxDepth?: number;
  splitIdPrefix?: string;
  data?: PolyWorldData;
}

export interface PolyWorldBspSurfaceFragment {
  id: string;
  sourceSurfaceId: string;
  vertices: readonly Vec3[];
  regionId?: string;
  elementId?: string;
  selectionKeys?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldPolygonBspCompileResult {
  tree: PolyWorldBspTree;
  fragments: readonly PolyWorldBspSurfaceFragment[];
}

export function compilePolyWorldPolygonBsp(
  input: PolyWorldPolygonBspCompileInput,
): PolyWorldPolygonBspCompileResult {
  const diagnostics = validatePolyWorldPolygonBspInput(input);
  if (diagnostics.length > 0) throw new PolyWorldBspError(diagnostics);

  const state: PolygonBspCompileState = {
    fragments: [],
    leafCount: 0,
    nodeCount: 0,
    fragmentCount: 0,
  };
  const epsilon = input.epsilon ?? 0.0001;
  const maxDepth = input.maxDepth ?? input.surfaces.length * 2;
  const fragments = input.surfaces.map((surface) => ({
    id: surface.id,
    sourceSurfaceId: surface.id,
    vertices: surface.vertices.map((vertex) => [...vertex] as Vec3),
    regionId: surface.regionId,
    elementId: surface.elementId,
    selectionKeys: surface.selectionKeys === undefined ? undefined : [...surface.selectionKeys],
    data: surface.data,
  }));
  const root = compilePolygonBspChild(
    fragments,
    input.splitIdPrefix ?? "polygon-bsp",
    epsilon,
    maxDepth,
    state,
    0,
  );
  const tree = createPolyWorldBspTree({
    root,
    leaves: collectLeafRefs(root).map((leafId) => ({
      id: leafId,
      data: {
        compiled: true,
        compiler: "polygon-bsp",
      },
    })),
    data: {
      ...input.data,
      compiled: true,
      compiler: "polygon-bsp",
      sourceSurfaceCount: input.surfaces.length,
      fragmentCount: state.fragments.length,
    },
  });
  return {
    tree,
    fragments: state.fragments.map((fragment) => ({
      ...fragment,
      vertices: fragment.vertices.map((vertex) => [...vertex] as Vec3),
    })),
  };
}

export function validatePolyWorldPolygonBspInput(
  input: PolyWorldPolygonBspCompileInput,
): PolyWorldBspDiagnostic[] {
  const diagnostics: PolyWorldBspDiagnostic[] = [];
  const surfaceIds = new Set<string>();
  if (input.surfaces.length === 0) {
    diagnostics.push({
      code: "poly-world-empty-polygon-bsp-surfaces",
      message: "PolyWorld polygon BSP compiler requires at least one surface.",
      field: "surfaces",
      kind: "compile",
    });
  }
  for (const surface of input.surfaces) {
    if (typeof surface.id !== "string" || surface.id.length === 0) {
      diagnostics.push({
        code: "poly-world-empty-polygon-bsp-surface-id",
        message: "PolyWorld polygon BSP surface requires a non-empty id.",
        field: "id",
        kind: "surface",
      });
    } else if (surfaceIds.has(surface.id)) {
      diagnostics.push({
        code: "poly-world-duplicate-polygon-bsp-surface-id",
        message: `Duplicate PolyWorld polygon BSP surface id "${surface.id}".`,
        id: surface.id,
        field: "id",
        kind: "surface",
      });
    }
    if (surface.id) surfaceIds.add(surface.id);
    if (!Array.isArray(surface.vertices) || surface.vertices.length < 3) {
      diagnostics.push({
        code: "poly-world-polygon-bsp-surface-too-few-vertices",
        message: `PolyWorld polygon BSP surface "${surface.id}" requires at least three vertices.`,
        id: surface.id,
        field: "vertices",
        kind: "surface",
      });
      continue;
    }
    for (let index = 0; index < surface.vertices.length; index += 1) {
      const vertex = surface.vertices[index];
      if (!Array.isArray(vertex) || vertex.length !== 3 || !vertex.every(isFiniteNumber)) {
        diagnostics.push({
          code: "poly-world-invalid-polygon-bsp-vertex",
          message: `PolyWorld polygon BSP surface "${surface.id}" vertex ${index} must be a finite Vec3.`,
          id: surface.id,
          field: `vertices.${index}`,
          kind: "surface",
        });
      }
    }
    if (surface.vertices.length >= 3 && resolvePolygonPlane(surface.vertices, 0.0001) === undefined) {
      diagnostics.push({
        code: "poly-world-degenerate-polygon-bsp-surface",
        message: `PolyWorld polygon BSP surface "${surface.id}" cannot produce a valid split plane.`,
        id: surface.id,
        field: "vertices",
        kind: "surface",
      });
    }
  }
  if (input.epsilon !== undefined && (!isFiniteNumber(input.epsilon) || input.epsilon <= 0)) {
    diagnostics.push({
      code: "poly-world-invalid-polygon-bsp-epsilon",
      message: "PolyWorld polygon BSP epsilon must be a positive finite number.",
      field: "epsilon",
      kind: "compile",
    });
  }
  if (input.maxDepth !== undefined && (!Number.isInteger(input.maxDepth) || input.maxDepth < 1)) {
    diagnostics.push({
      code: "poly-world-invalid-polygon-bsp-max-depth",
      message: "PolyWorld polygon BSP maxDepth must be a positive integer.",
      field: "maxDepth",
      kind: "compile",
    });
  }
  return diagnostics;
}

function compilePolygonBspChild(
  fragments: readonly PolygonBspFragment[],
  idPrefix: string,
  epsilon: number,
  maxDepth: number,
  state: PolygonBspCompileState,
  depth: number,
): PolyWorldBspChild {
  if (fragments.length === 0 || depth >= maxDepth) {
    return createPolygonBspLeaf(fragments, idPrefix, state);
  }

  const splitter = choosePolygonBspSplitter(fragments, epsilon);
  if (splitter === undefined) return createPolygonBspLeaf(fragments, idPrefix, state);

  const front: PolygonBspFragment[] = [];
  const back: PolygonBspFragment[] = [];
  const coplanar: PolygonBspFragment[] = [];

  for (const fragment of fragments) {
    const side = classifyPolygon(fragment.vertices, splitter.plane, epsilon);
    if (side === "front") {
      front.push(fragment);
    } else if (side === "back") {
      back.push(fragment);
    } else if (side === "coplanar") {
      coplanar.push(fragment);
    } else {
      const split = splitPolygonBspFragment(fragment, splitter.plane, epsilon, state);
      if (split.front !== undefined) front.push(split.front);
      if (split.back !== undefined) back.push(split.back);
    }
  }

  state.fragments.push(...coplanar.map(cloneFragment));

  const nodeId = `${idPrefix}-node-${state.nodeCount}-${depth}-${splitter.fragment.sourceSurfaceId}`;
  state.nodeCount += 1;

  return {
    id: nodeId,
    plane: splitter.plane,
    back: compilePolygonBspChild(back, idPrefix, epsilon, maxDepth, state, depth + 1),
    front: compilePolygonBspChild(front, idPrefix, epsilon, maxDepth, state, depth + 1),
    data: {
      compiled: true,
      compiler: "polygon-bsp",
      splitterSurfaceId: splitter.fragment.sourceSurfaceId,
      splitterFragmentId: splitter.fragment.id,
      surfaceIds: uniqueStrings(coplanar.map((fragment) => fragment.sourceSurfaceId)),
      fragmentIds: coplanar.map((fragment) => fragment.id),
    },
  };
}

function createPolygonBspLeaf(
  fragments: readonly PolygonBspFragment[],
  idPrefix: string,
  state: PolygonBspCompileState,
): PolyWorldBspChild {
  const leafId = `${idPrefix}-leaf-${state.leafCount}`;
  state.leafCount += 1;
  state.fragments.push(...fragments.map(cloneFragment));
  return { leafId };
}

function choosePolygonBspSplitter(
  fragments: readonly PolygonBspFragment[],
  epsilon: number,
): { fragment: PolygonBspFragment; plane: PolyWorldBspPlane } | undefined {
  let best:
    | { fragment: PolygonBspFragment; plane: PolyWorldBspPlane; score: number }
    | undefined;

  for (const fragment of fragments) {
    const plane = resolvePolygonPlane(fragment.vertices, epsilon);
    if (plane === undefined) continue;
    let front = 0;
    let back = 0;
    let splits = 0;
    for (const other of fragments) {
      const side = classifyPolygon(other.vertices, plane, epsilon);
      if (side === "front") front += 1;
      else if (side === "back") back += 1;
      else if (side === "spanning") splits += 1;
    }
    const score = splits * 1000 + Math.abs(front - back);
    if (best === undefined || score < best.score) best = { fragment, plane, score };
  }

  return best;
}

function splitPolygonBspFragment(
  fragment: PolygonBspFragment,
  plane: PolyWorldBspPlane,
  epsilon: number,
  state: PolygonBspCompileState,
): { front?: PolygonBspFragment; back?: PolygonBspFragment } {
  const frontVertices: Vec3[] = [];
  const backVertices: Vec3[] = [];
  const vertices = fragment.vertices;

  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index] as Vec3;
    const next = vertices[(index + 1) % vertices.length] as Vec3;
    const currentDistance = signedPlaneDistance(plane, current);
    const nextDistance = signedPlaneDistance(plane, next);
    const currentFront = currentDistance > epsilon;
    const currentBack = currentDistance < -epsilon;
    const nextFront = nextDistance > epsilon;
    const nextBack = nextDistance < -epsilon;

    if (!currentBack) pushDistinctVertex(frontVertices, current, epsilon);
    if (!currentFront) pushDistinctVertex(backVertices, current, epsilon);

    if ((currentFront && nextBack) || (currentBack && nextFront)) {
      const t = currentDistance / (currentDistance - nextDistance);
      const intersection = lerpVec3(current, next, t);
      pushDistinctVertex(frontVertices, intersection, epsilon);
      pushDistinctVertex(backVertices, intersection, epsilon);
    }
  }

  return {
    front: createSplitFragment(fragment, frontVertices, state),
    back: createSplitFragment(fragment, backVertices, state),
  };
}

function createSplitFragment(
  source: PolygonBspFragment,
  vertices: readonly Vec3[],
  state: PolygonBspCompileState,
): PolygonBspFragment | undefined {
  const cleaned = cleanPolygonVertices(vertices, 0.0001);
  if (cleaned.length < 3) return undefined;
  state.fragmentCount += 1;
  return {
    ...source,
    id: `${source.sourceSurfaceId}#${state.fragmentCount}`,
    vertices: cleaned,
    data: {
      ...source.data,
      splitFromFragmentId: source.id,
    },
  };
}

function classifyPolygon(
  vertices: readonly Vec3[],
  plane: PolyWorldBspPlane,
  epsilon: number,
): PolygonBspSide {
  let hasFront = false;
  let hasBack = false;
  for (const vertex of vertices) {
    const distance = signedPlaneDistance(plane, vertex);
    if (distance > epsilon) hasFront = true;
    else if (distance < -epsilon) hasBack = true;
    if (hasFront && hasBack) return "spanning";
  }
  if (hasFront) return "front";
  if (hasBack) return "back";
  return "coplanar";
}

function resolvePolygonPlane(
  vertices: readonly Vec3[],
  epsilon: number,
): PolyWorldBspPlane | undefined {
  const origin = vertices[0];
  if (origin === undefined) return undefined;
  for (let i = 1; i < vertices.length - 1; i += 1) {
    const a = vertices[i];
    const b = vertices[i + 1];
    if (a === undefined || b === undefined) continue;
    const normal = normalizeVec3(cross(subtractVec3(a, origin), subtractVec3(b, origin)));
    if (lengthSq(normal) <= epsilon * epsilon) continue;
    return {
      normal,
      distance: dot(normal, origin),
      epsilon,
    };
  }
  return undefined;
}

function collectLeafRefs(child: PolyWorldBspChild): string[] {
  if ("leafId" in child) return [child.leafId];
  return [...collectLeafRefs(child.back), ...collectLeafRefs(child.front)];
}

function cloneFragment(fragment: PolygonBspFragment): PolygonBspFragment {
  return {
    ...fragment,
    vertices: fragment.vertices.map((vertex) => [...vertex] as Vec3),
    selectionKeys: fragment.selectionKeys === undefined ? undefined : [...fragment.selectionKeys],
  };
}

function cleanPolygonVertices(vertices: readonly Vec3[], epsilon: number): Vec3[] {
  const cleaned: Vec3[] = [];
  for (const vertex of vertices) pushDistinctVertex(cleaned, vertex, epsilon);
  if (cleaned.length > 1 && sameVec3(cleaned[0] as Vec3, cleaned[cleaned.length - 1] as Vec3, epsilon)) {
    cleaned.pop();
  }
  return cleaned;
}

function pushDistinctVertex(vertices: Vec3[], vertex: Vec3, epsilon: number): void {
  if (vertices.length > 0 && sameVec3(vertices[vertices.length - 1] as Vec3, vertex, epsilon)) return;
  vertices.push([...vertex] as Vec3);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
