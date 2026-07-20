import type { Vec3 } from "@layoutit/polycss-core";
import type { PolyWorldBounds, PolyWorldData } from "../topology";
import {
  bakePolyWorldBspPvs,
  createPolyWorldBspTree,
  PolyWorldBspError,
  type PolyWorldBspChild,
  type PolyWorldBspDiagnostic,
  type PolyWorldBspPlane,
  type PolyWorldBspPortal,
  type PolyWorldBspPvsBakeOptions,
  type PolyWorldBspTree,
} from "./bsp";

const epsilon = 0.0001;

type BrushBspHalfspaceSide = "front" | "back";

interface BrushBspHalfspace {
  plane: PolyWorldBspPlane;
  side: BrushBspHalfspaceSide;
}

interface BrushBspCell {
  id: string;
  bounds: PolyWorldBounds;
  center: Vec3;
  vertices?: readonly Vec3[];
  halfspaces?: readonly BrushBspHalfspace[];
  solid: boolean;
  brushIds: readonly string[];
  regionId?: string;
  elementIds: readonly string[];
  data?: PolyWorldData;
}

interface BrushBspFace {
  cell: BrushBspCell;
  bounds: PolyWorldBounds;
  vertices: readonly Vec3[];
  plane: PolyWorldBspPlane;
  side: BrushBspHalfspaceSide;
  sideSign: -1 | 1;
}

interface BrushBspPortalBuildResult {
  portals: readonly PolyWorldBspPortal[];
  candidateCount: number;
  rejectedCandidateCount: number;
}

interface BrushBspNodeState {
  nextNodeId: number;
  nextLeafId: number;
  cells: BrushBspCell[];
}

interface PlaneBrushBspCellInput {
  halfspaces: readonly BrushBspHalfspace[];
  vertices: readonly Vec3[];
  bounds: PolyWorldBounds;
  center: Vec3;
}

interface CompiledBrushBspBrush {
  id: string;
  halfspaces: readonly BrushBspHalfspace[];
}

interface BrushBspSplitPlane {
  plane: PolyWorldBspPlane;
  source: "brush" | "region";
  sourceId: string;
  order: number;
}

export type PolyWorldBrushBspOutsideMode = "empty" | "solid" | "flood-fill";

export interface PolyWorldBspBrushPlane extends PolyWorldBspPlane {
  side?: BrushBspHalfspaceSide;
}

export interface PolyWorldBspBrush {
  id: string;
  bounds?: PolyWorldBounds;
  planes?: readonly PolyWorldBspBrushPlane[];
  data?: PolyWorldData;
}

export interface PolyWorldBrushBspRegion {
  id: string;
  regionId?: string;
  bounds: PolyWorldBounds;
  elementIds?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldBrushBspCompileInput {
  worldBounds: PolyWorldBounds;
  brushes: readonly PolyWorldBspBrush[];
  regions?: readonly PolyWorldBrushBspRegion[];
  outside?: PolyWorldBrushBspOutsideMode;
  splitIdPrefix?: string;
  bakePvs?: boolean;
  pvs?: PolyWorldBspPvsBakeOptions;
  data?: PolyWorldData;
}

export interface PolyWorldBrushBspCompileResult {
  tree: PolyWorldBspTree;
  solidLeafIds: readonly string[];
  emptyLeafIds: readonly string[];
  outsideLeafIds: readonly string[];
  portals: readonly PolyWorldBspPortal[];
}

export function compilePolyWorldBrushBsp(
  input: PolyWorldBrushBspCompileInput,
): PolyWorldBrushBspCompileResult {
  const diagnostics = validatePolyWorldBrushBspInput(input);
  if (diagnostics.length > 0) throw new PolyWorldBspError(diagnostics);

  const prefix = input.splitIdPrefix ?? "brush-bsp";
  const regions = input.regions ?? [];
  const outsideMode = input.outside ?? "empty";
  const compiledBrushes = input.brushes.map((brush) => ({
    id: brush.id,
    halfspaces: brushHalfspaces(brush),
  }));
  const compiled = compileRecursiveBrushBsp(
    input.worldBounds,
    compiledBrushes,
    regions,
    outsideMode,
    prefix,
  );
  const cells = compiled.cells;
  const initialPortalBuild = createPlaneBrushBspPortalBuild(cells, prefix);
  const outsideLeafIds = outsideMode === "flood-fill"
    ? applyBrushBspOutsideFloodFill(
      cells,
      input.worldBounds,
      initialPortalBuild.portals,
    )
    : cells.filter((cell) => cell.data?.outside === true).map((cell) => cell.id);
  const leaves = cells.map((cell) => ({
    id: cell.id,
    ...(cell.regionId === undefined ? {} : { regionId: cell.regionId }),
    bounds: cloneBounds(cell.bounds),
    center: [...cell.center] as Vec3,
    pvsSamplePoints: [[...cell.center] as Vec3],
    ...(cell.elementIds.length === 0 ? {} : { elementIds: [...cell.elementIds] }),
    data: {
      ...cell.data,
      compiled: true,
      compiler: "brush-bsp",
      solid: cell.solid,
      brushIds: [...cell.brushIds],
    },
  }));
  const portalBuild = createPlaneBrushBspPortalBuild(cells, prefix);
  const portals = portalBuild.portals;
  const tree = createPolyWorldBspTree({
    root: compiled.root,
    leaves,
    portals,
    data: {
      ...input.data,
      compiled: true,
      compiler: "brush-bsp",
      partition: "recursive-plane",
      leafBuilder: "recursive-convex-halfspace",
      portalBuilder: "leaf-face-overlap",
      solidLeafIds: cells.filter((cell) => cell.solid).map((cell) => cell.id),
      emptyLeafIds: cells.filter((cell) => !cell.solid).map((cell) => cell.id),
      outsideLeafIds,
      portalCandidateCount: portalBuild.candidateCount,
      rejectedPortalCandidateCount: portalBuild.rejectedCandidateCount,
    },
  });
  const finalTree = input.bakePvs === false ? tree : bakePolyWorldBspPvs(tree, input.pvs);
  return {
    tree: finalTree,
    solidLeafIds: cells.filter((cell) => cell.solid).map((cell) => cell.id),
    emptyLeafIds: cells.filter((cell) => !cell.solid).map((cell) => cell.id),
    outsideLeafIds,
    portals: finalTree.portals,
  };
}

export function validatePolyWorldBrushBspInput(
  input: PolyWorldBrushBspCompileInput,
): PolyWorldBspDiagnostic[] {
  const diagnostics: PolyWorldBspDiagnostic[] = [];
  const brushIds = new Set<string>();
  const regionIds = new Set<string>();
  validateBounds("world", "world", input.worldBounds, diagnostics);
  if (
    input.outside !== undefined &&
    input.outside !== "empty" &&
    input.outside !== "solid" &&
    input.outside !== "flood-fill"
  ) {
    diagnostics.push({
      code: "poly-world-invalid-brush-bsp-outside-mode",
      message: 'PolyWorld brush BSP outside must be "empty", "solid", or "flood-fill".',
      field: "outside",
      kind: "compile",
    });
  }

  for (const brush of input.brushes) {
    if (typeof brush.id !== "string" || brush.id.length === 0) {
      diagnostics.push({
        code: "poly-world-empty-brush-bsp-brush-id",
        message: "PolyWorld brush BSP brush requires a non-empty id.",
        field: "id",
        kind: "brush",
      });
    } else if (brushIds.has(brush.id)) {
      diagnostics.push({
        code: "poly-world-duplicate-brush-bsp-brush-id",
        message: `Duplicate PolyWorld brush BSP brush id "${brush.id}".`,
        id: brush.id,
        field: "id",
        kind: "brush",
      });
    }
    if (brush.id) brushIds.add(brush.id);
    if (brush.bounds === undefined && (brush.planes?.length ?? 0) === 0) {
      diagnostics.push({
        code: "poly-world-empty-brush-bsp-brush-shape",
        message: `PolyWorld brush BSP brush "${brush.id}" requires bounds, planes, or both.`,
        id: brush.id,
        field: "bounds",
        kind: "brush",
      });
    }
    if (brush.bounds !== undefined) validateBounds("brush", brush.id, brush.bounds, diagnostics);
    validateBrushPlanes(brush, diagnostics);
    if (brush.bounds !== undefined && !boundsContainsBounds(input.worldBounds, brush.bounds)) {
      diagnostics.push({
        code: "poly-world-brush-bsp-brush-outside-world",
        message: `PolyWorld brush BSP brush "${brush.id}" must be inside worldBounds.`,
        id: brush.id,
        field: "bounds",
        kind: "brush",
      });
    }
  }

  for (const region of input.regions ?? []) {
    if (typeof region.id !== "string" || region.id.length === 0) {
      diagnostics.push({
        code: "poly-world-empty-brush-bsp-region-id",
        message: "PolyWorld brush BSP region requires a non-empty id.",
        field: "id",
        kind: "region",
      });
    } else if (regionIds.has(region.id)) {
      diagnostics.push({
        code: "poly-world-duplicate-brush-bsp-region-id",
        message: `Duplicate PolyWorld brush BSP region id "${region.id}".`,
        id: region.id,
        field: "id",
        kind: "region",
      });
    }
    if (region.id) regionIds.add(region.id);
    validateBounds("region", region.id, region.bounds, diagnostics);
    if (!boundsContainsBounds(input.worldBounds, region.bounds)) {
      diagnostics.push({
        code: "poly-world-brush-bsp-region-outside-world",
        message: `PolyWorld brush BSP region "${region.id}" must be inside worldBounds.`,
        id: region.id,
        field: "bounds",
        kind: "region",
      });
    }
    if (region.elementIds !== undefined && !isStringArray(region.elementIds)) {
      diagnostics.push({
        code: "poly-world-invalid-brush-bsp-region-element-ids",
        message: `PolyWorld brush BSP region "${region.id}" elementIds must contain only non-empty strings.`,
        id: region.id,
        field: "elementIds",
        kind: "region",
      });
    }
  }

  return diagnostics;
}

function compileRecursiveBrushBsp(
  worldBounds: PolyWorldBounds,
  compiledBrushes: readonly CompiledBrushBspBrush[],
  regions: readonly PolyWorldBrushBspRegion[],
  outside: PolyWorldBrushBspOutsideMode,
  prefix: string,
): { root: PolyWorldBspChild; cells: BrushBspCell[] } {
  const splitPlanes = collectBrushBspSplitPlanes(compiledBrushes, regions);
  const rootCell = buildPlaneBrushBspCell(boundsHalfspaces(worldBounds));
  if (rootCell === undefined) {
    throw new PolyWorldBspError([{
      code: "poly-world-brush-bsp-invalid-world-cell",
      message: "PolyWorld brush BSP compiler could not create a valid world cell.",
      kind: "compile",
    }]);
  }
  const state: BrushBspNodeState = { nextNodeId: 0, nextLeafId: 0, cells: [] };
  return {
    root: compileRecursiveBrushBspChild(
      rootCell,
      splitPlanes,
      compiledBrushes,
      regions,
      outside,
      prefix,
      state,
      0,
    ),
    cells: state.cells,
  };
}

function applyBrushBspOutsideFloodFill(
  cells: BrushBspCell[],
  worldBounds: PolyWorldBounds,
  portals: readonly PolyWorldBspPortal[],
): string[] {
  const cellsById = new Map(cells.map((cell) => [cell.id, cell]));
  const portalLeafIdsByLeafId = new Map<string, string[]>();
  for (const portal of portals) {
    pushMap(portalLeafIdsByLeafId, portal.fromLeafId, portal.toLeafId);
    pushMap(portalLeafIdsByLeafId, portal.toLeafId, portal.fromLeafId);
  }

  const outsideLeafIds: string[] = [];
  const visitedOutsideLeafIds = new Set<string>();
  const queue = cells
    .filter((cell) => !cell.solid && boundsTouchesBoundsBoundary(cell.bounds, worldBounds))
    .map((cell) => cell.id);

  while (queue.length > 0) {
    const leafId = queue.shift();
    if (leafId === undefined || visitedOutsideLeafIds.has(leafId)) continue;
    const cell = cellsById.get(leafId);
    if (cell === undefined || cell.solid) continue;
    visitedOutsideLeafIds.add(leafId);
    outsideLeafIds.push(leafId);
    for (const linkedLeafId of portalLeafIdsByLeafId.get(leafId) ?? []) {
      if (!visitedOutsideLeafIds.has(linkedLeafId)) queue.push(linkedLeafId);
    }
  }

  const outsideLeafIdSet = new Set(outsideLeafIds);
  for (const cell of cells) {
    if (!outsideLeafIdSet.has(cell.id)) continue;
    cell.solid = true;
    delete cell.regionId;
    cell.elementIds = [];
    cell.data = {
      ...cell.data,
      outside: true,
      outsideFill: true,
    };
  }

  return outsideLeafIds;
}

function collectBrushBspSplitPlanes(
  brushes: readonly CompiledBrushBspBrush[],
  regions: readonly PolyWorldBrushBspRegion[],
): BrushBspSplitPlane[] {
  const planes: BrushBspSplitPlane[] = [];
  let order = 0;
  for (const brush of brushes) {
    for (const halfspace of brush.halfspaces) {
      addUniqueBrushBspSplitPlane(planes, {
        plane: halfspace.plane,
        source: "brush",
        sourceId: brush.id,
        order,
      });
      order += 1;
    }
  }
  for (const region of regions) {
    for (const halfspace of boundsHalfspaces(region.bounds)) {
      addUniqueBrushBspSplitPlane(planes, {
        plane: halfspace.plane,
        source: "region",
        sourceId: region.id,
        order,
      });
      order += 1;
    }
  }
  return planes;
}

function addUniqueBrushBspSplitPlane(
  planes: BrushBspSplitPlane[],
  candidate: BrushBspSplitPlane,
): void {
  const normalized = {
    ...candidate,
    plane: normalizePlane(candidate.plane),
  };
  if (!planes.some((existing) => samePlane(existing.plane, normalized.plane))) planes.push(normalized);
}

function compileRecursiveBrushBspChild(
  cell: PlaneBrushBspCellInput,
  splitPlanes: readonly BrushBspSplitPlane[],
  brushes: readonly CompiledBrushBspBrush[],
  regions: readonly PolyWorldBrushBspRegion[],
  outside: PolyWorldBrushBspOutsideMode,
  prefix: string,
  state: BrushBspNodeState,
  depth: number,
): PolyWorldBspChild {
  if (depth > splitPlanes.length + 6) {
    throw new PolyWorldBspError([{
      code: "poly-world-brush-bsp-recursive-depth-exceeded",
      message: "PolyWorld brush BSP compiler exceeded the recursive split depth budget.",
      kind: "compile",
    }]);
  }
  const split = chooseRecursiveBrushBspSplit(cell, splitPlanes);
  if (split === undefined) {
    return createRecursiveBrushBspLeaf(cell, brushes, regions, outside, prefix, state);
  }
  const nodeId = state.nextNodeId;
  state.nextNodeId += 1;
  return {
    id: `${prefix}-node-${nodeId}-plane-${formatNumber(split.plane.distance)}`,
    plane: clonePlane(split.plane),
    back: compileRecursiveBrushBspChild(
      split.back,
      splitPlanes,
      brushes,
      regions,
      outside,
      prefix,
      state,
      depth + 1,
    ),
    front: compileRecursiveBrushBspChild(
      split.front,
      splitPlanes,
      brushes,
      regions,
      outside,
      prefix,
      state,
      depth + 1,
    ),
    data: {
      compiled: true,
      compiler: "brush-bsp",
      partition: "recursive-plane",
      splitterSource: split.source,
      splitterSourceId: split.sourceId,
    },
  };
}

function chooseRecursiveBrushBspSplit(
  cell: PlaneBrushBspCellInput,
  splitPlanes: readonly BrushBspSplitPlane[],
): (BrushBspSplitPlane & { back: PlaneBrushBspCellInput; front: PlaneBrushBspCellInput }) | undefined {
  let best:
    | (BrushBspSplitPlane & {
      back: PlaneBrushBspCellInput;
      front: PlaneBrushBspCellInput;
      score: number;
    })
    | undefined;

  for (const splitPlane of splitPlanes) {
    if (classifyVerticesAgainstPlane(cell.vertices, splitPlane.plane) !== "spanning") continue;
    const back = buildPlaneBrushBspCell([...cell.halfspaces, { plane: splitPlane.plane, side: "back" }]);
    const front = buildPlaneBrushBspCell([...cell.halfspaces, { plane: splitPlane.plane, side: "front" }]);
    if (back === undefined || front === undefined) continue;
    const backVolume = boundsVolume(back.bounds);
    const frontVolume = boundsVolume(front.bounds);
    const totalVolume = Math.max(epsilon, backVolume + frontVolume);
    const balancePenalty = Math.abs(backVolume - frontVolume) / totalVolume;
    const sourcePenalty = splitPlane.source === "brush" ? 0 : 4;
    const score = sourcePenalty + balancePenalty + splitPlane.order * 0.0001;
    if (best === undefined || score < best.score) {
      best = { ...splitPlane, back, front, score };
    }
  }

  return best;
}

function createRecursiveBrushBspLeaf(
  cell: PlaneBrushBspCellInput,
  brushes: readonly CompiledBrushBspBrush[],
  regions: readonly PolyWorldBrushBspRegion[],
  outside: PolyWorldBrushBspOutsideMode,
  prefix: string,
  state: BrushBspNodeState,
): PolyWorldBspChild {
  const brushIds = brushes
    .filter((brush) => cellInsideHalfspaces(cell.vertices, brush.halfspaces))
    .map((brush) => brush.id);
  const region = resolveBrushBspRegion(cell.center, regions);
  const outsideSolid = outside === "solid" && region === undefined;
  const solid = brushIds.length > 0 || outsideSolid;
  const emptyRegion = solid ? undefined : region;
  const id = `${prefix}-leaf-${state.nextLeafId}`;
  state.nextLeafId += 1;
  state.cells.push({
    id,
    bounds: cloneBounds(cell.bounds),
    center: [...cell.center] as Vec3,
    vertices: cell.vertices.map((vertex) => [...vertex] as Vec3),
    halfspaces: cell.halfspaces.map((halfspace) => ({
      plane: clonePlane(halfspace.plane),
      side: halfspace.side,
    })),
    solid,
    brushIds,
    ...(emptyRegion === undefined ? {} : { regionId: emptyRegion.regionId ?? emptyRegion.id }),
    elementIds: emptyRegion?.elementIds === undefined ? [] : [...emptyRegion.elementIds],
    data: {
      ...emptyRegion?.data,
      ...(outsideSolid ? { outside: true } : {}),
    },
  });
  return { leafId: id };
}

function buildPlaneBrushBspCell(
  halfspaces: readonly BrushBspHalfspace[],
): PlaneBrushBspCellInput | undefined {
  const vertices: Vec3[] = [];
  for (let a = 0; a < halfspaces.length - 2; a += 1) {
    for (let b = a + 1; b < halfspaces.length - 1; b += 1) {
      for (let c = b + 1; c < halfspaces.length; c += 1) {
        const point = intersectPlanes(
          halfspaces[a]?.plane,
          halfspaces[b]?.plane,
          halfspaces[c]?.plane,
        );
        if (point !== undefined && pointInsideHalfspaces(point, halfspaces)) {
          pushUniqueVec3(vertices, point);
        }
      }
    }
  }
  if (vertices.length < 4 || !hasNonZeroVolume(vertices)) return undefined;
  const bounds = boundsFromPoints(vertices);
  return {
    halfspaces: halfspaces.map((halfspace) => ({
      plane: clonePlane(halfspace.plane),
      side: halfspace.side,
    })),
    vertices,
    bounds,
    center: averageVec3(vertices),
  };
}

function createPlaneBrushBspPortalBuild(
  cells: readonly BrushBspCell[],
  prefix: string,
): BrushBspPortalBuildResult {
  const portals: PolyWorldBspPortal[] = [];
  const facesByPlane = new Map<string, BrushBspFace[]>();
  const seenPortals = new Set<string>();
  let index = 0;
  let candidateCount = 0;
  let rejectedCandidateCount = 0;

  for (const cell of cells) {
    if (cell.solid || cell.vertices === undefined || cell.halfspaces === undefined) continue;
    for (const halfspace of cell.halfspaces) {
      const vertices = faceVerticesFromCell(cell.vertices, halfspace.plane);
      if (vertices.length < 3) continue;
      const canonical = canonicalPlane(halfspace.plane);
      pushMap(facesByPlane, canonicalPlaneKey(halfspace.plane), {
        cell,
        bounds: boundsFromPoints(vertices),
        vertices,
        plane: halfspace.plane,
        side: halfspace.side,
        sideSign: brushBspFaceSideSign(halfspace, canonical.normal),
      });
    }
  }

  for (const faces of facesByPlane.values()) {
    for (let aIndex = 0; aIndex < faces.length; aIndex += 1) {
      const a = faces[aIndex];
      if (a === undefined) continue;
      for (let bIndex = aIndex + 1; bIndex < faces.length; bIndex += 1) {
        const b = faces[bIndex];
        if (b === undefined || a.cell.id === b.cell.id || a.sideSign === b.sideSign) continue;
        candidateCount += 1;
        const vertices = overlapBrushBspFaces(a, b);
        if (vertices.length < 3) {
          rejectedCandidateCount += 1;
          continue;
        }
        const dedupeKey = portalOverlapKey(a, b, vertices);
        if (seenPortals.has(dedupeKey)) {
          rejectedCandidateCount += 1;
          continue;
        }
        seenPortals.add(dedupeKey);
        const bounds = boundsFromPoints(vertices);
        portals.push({
          id: `${prefix}-portal-${index}`,
          fromLeafId: a.cell.id,
          toLeafId: b.cell.id,
          vertices,
          data: {
            compiled: true,
            compiler: "brush-bsp",
            partition: "recursive-plane",
            portalBuilder: "leaf-face-overlap",
            bounds: cloneBounds(bounds),
            fromFaceBounds: cloneBounds(a.bounds),
            toFaceBounds: cloneBounds(b.bounds),
          },
        });
        index += 1;
      }
    }
  }

  return { portals, candidateCount, rejectedCandidateCount };
}

function pushMap<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [value]);
  else existing.push(value);
}

function validateBrushPlanes(
  brush: PolyWorldBspBrush,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  if (brush.planes === undefined) return;
  if (brush.planes.length === 0) {
    diagnostics.push({
      code: "poly-world-empty-brush-bsp-brush-planes",
      message: `PolyWorld brush BSP brush "${brush.id}" planes must not be empty when provided.`,
      id: brush.id,
      field: "planes",
      kind: "brush",
    });
    return;
  }
  if (brush.bounds === undefined && brush.planes.length < 4) {
    diagnostics.push({
      code: "poly-world-open-brush-bsp-brush-planes",
      message: `PolyWorld brush BSP brush "${brush.id}" requires at least four planes without bounds.`,
      id: brush.id,
      field: "planes",
      kind: "brush",
    });
  }
  brush.planes.forEach((plane, index) => {
    if (!isVec3(plane.normal) || !isFiniteNumber(plane.distance)) {
      diagnostics.push({
        code: "poly-world-invalid-brush-bsp-plane",
        message: `PolyWorld brush BSP brush "${brush.id}" plane ${index} must have a finite normal and distance.`,
        id: brush.id,
        field: "planes",
        kind: "brush",
      });
      return;
    }
    if (vecLength(plane.normal) <= epsilon) {
      diagnostics.push({
        code: "poly-world-zero-brush-bsp-plane-normal",
        message: `PolyWorld brush BSP brush "${brush.id}" plane ${index} normal cannot be zero.`,
        id: brush.id,
        field: "planes",
        kind: "brush",
      });
    }
    if (plane.epsilon !== undefined && (!isFiniteNumber(plane.epsilon) || plane.epsilon < 0)) {
      diagnostics.push({
        code: "poly-world-invalid-brush-bsp-plane-epsilon",
        message: `PolyWorld brush BSP brush "${brush.id}" plane ${index} epsilon must be finite and non-negative.`,
        id: brush.id,
        field: "planes",
        kind: "brush",
      });
    }
    if (plane.side !== undefined && plane.side !== "front" && plane.side !== "back") {
      diagnostics.push({
        code: "poly-world-invalid-brush-bsp-plane-side",
        message: `PolyWorld brush BSP brush "${brush.id}" plane ${index} side must be "front" or "back".`,
        id: brush.id,
        field: "planes",
        kind: "brush",
      });
    }
  });
}

function brushHalfspaces(brush: PolyWorldBspBrush): BrushBspHalfspace[] {
  return [
    ...(brush.bounds === undefined ? [] : boundsHalfspaces(brush.bounds)),
    ...(brush.planes ?? []).map((plane) => ({
      plane: normalizePlane(plane),
      side: plane.side ?? "back",
    })),
  ];
}

function boundsHalfspaces(bounds: PolyWorldBounds): BrushBspHalfspace[] {
  return [
    { plane: { normal: [1, 0, 0], distance: bounds.min[0] }, side: "front" },
    { plane: { normal: [1, 0, 0], distance: bounds.max[0] }, side: "back" },
    { plane: { normal: [0, 1, 0], distance: bounds.min[1] }, side: "front" },
    { plane: { normal: [0, 1, 0], distance: bounds.max[1] }, side: "back" },
    { plane: { normal: [0, 0, 1], distance: bounds.min[2] }, side: "front" },
    { plane: { normal: [0, 0, 1], distance: bounds.max[2] }, side: "back" },
  ];
}

function normalizePlane(plane: PolyWorldBspPlane): PolyWorldBspPlane {
  const length = vecLength(plane.normal);
  if (length <= epsilon) return clonePlane(plane);
  return {
    normal: [
      plane.normal[0] / length,
      plane.normal[1] / length,
      plane.normal[2] / length,
    ],
    distance: plane.distance / length,
    ...(plane.epsilon === undefined ? {} : { epsilon: plane.epsilon / length }),
  };
}

function clonePlane(plane: PolyWorldBspPlane): PolyWorldBspPlane {
  return {
    normal: [...plane.normal] as Vec3,
    distance: plane.distance,
    ...(plane.epsilon === undefined ? {} : { epsilon: plane.epsilon }),
  };
}

function pointInsideHalfspaces(point: Vec3, halfspaces: readonly BrushBspHalfspace[]): boolean {
  return halfspaces.every((halfspace) => {
    const signed = signedDistance(halfspace.plane, point);
    const planeEpsilon = halfspace.plane.epsilon ?? epsilon;
    return halfspace.side === "front" ? signed >= -planeEpsilon : signed <= planeEpsilon;
  });
}

function cellInsideHalfspaces(vertices: readonly Vec3[], halfspaces: readonly BrushBspHalfspace[]): boolean {
  return vertices.every((vertex) => pointInsideHalfspaces(vertex, halfspaces));
}

function classifyVerticesAgainstPlane(
  vertices: readonly Vec3[],
  plane: PolyWorldBspPlane,
): "front" | "back" | "spanning" | "coplanar" {
  let hasFront = false;
  let hasBack = false;
  const planeEpsilon = plane.epsilon ?? epsilon;
  for (const vertex of vertices) {
    const signed = signedDistance(plane, vertex);
    if (signed > planeEpsilon) hasFront = true;
    if (signed < -planeEpsilon) hasBack = true;
    if (hasFront && hasBack) return "spanning";
  }
  if (hasFront) return "front";
  if (hasBack) return "back";
  return "coplanar";
}

function samePlane(a: PolyWorldBspPlane, b: PolyWorldBspPlane): boolean {
  const an = normalizePlane(a);
  const bn = normalizePlane(b);
  return (
    Math.abs(an.normal[0] - bn.normal[0]) <= epsilon &&
    Math.abs(an.normal[1] - bn.normal[1]) <= epsilon &&
    Math.abs(an.normal[2] - bn.normal[2]) <= epsilon &&
    Math.abs(an.distance - bn.distance) <= epsilon
  ) || (
    Math.abs(an.normal[0] + bn.normal[0]) <= epsilon &&
    Math.abs(an.normal[1] + bn.normal[1]) <= epsilon &&
    Math.abs(an.normal[2] + bn.normal[2]) <= epsilon &&
    Math.abs(an.distance + bn.distance) <= epsilon
  );
}

function intersectPlanes(
  a: PolyWorldBspPlane | undefined,
  b: PolyWorldBspPlane | undefined,
  c: PolyWorldBspPlane | undefined,
): Vec3 | undefined {
  if (a === undefined || b === undefined || c === undefined) return undefined;
  const ab = normalizePlane(a);
  const bb = normalizePlane(b);
  const cb = normalizePlane(c);
  const bc = cross(bb.normal, cb.normal);
  const ca = cross(cb.normal, ab.normal);
  const abCross = cross(ab.normal, bb.normal);
  const denominator = dot(ab.normal, bc);
  if (Math.abs(denominator) <= epsilon) return undefined;
  return [
    (ab.distance * bc[0] + bb.distance * ca[0] + cb.distance * abCross[0]) / denominator,
    (ab.distance * bc[1] + bb.distance * ca[1] + cb.distance * abCross[1]) / denominator,
    (ab.distance * bc[2] + bb.distance * ca[2] + cb.distance * abCross[2]) / denominator,
  ];
}

function faceVerticesFromCell(vertices: readonly Vec3[], plane: PolyWorldBspPlane): Vec3[] {
  return orderFaceVertices(
    uniqueVec3(vertices.filter((vertex) => Math.abs(signedDistance(plane, vertex)) <= (plane.epsilon ?? epsilon))),
    plane.normal,
  );
}

function orderFaceVertices(vertices: readonly Vec3[], normal: Vec3): Vec3[] {
  if (vertices.length < 3) return vertices.map((vertex) => [...vertex] as Vec3);
  const center = averageVec3(vertices);
  const unitNormal = normalizeVec3(normal);
  const seed: Vec3 = Math.abs(unitNormal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = normalizeVec3(cross(seed, unitNormal));
  const v = cross(unitNormal, u);
  return [...vertices]
    .sort((a, b) =>
      Math.atan2(dot(subtract(a, center), v), dot(subtract(a, center), u)) -
      Math.atan2(dot(subtract(b, center), v), dot(subtract(b, center), u)),
    )
    .map((vertex) => [...vertex] as Vec3);
}

function overlapBrushBspFaces(a: BrushBspFace, b: BrushBspFace): Vec3[] {
  const normal = normalizeVec3(canonicalPlane(a.plane).normal);
  if (vecLength(normal) <= epsilon) return [];
  const subject = orderFaceVertices(a.vertices, normal);
  const clip = orderFaceVertices(b.vertices, normal);
  const clipped = clipConvexPolygonByConvexPolygon(subject, clip, normal);
  const vertices = orderFaceVertices(uniqueVec3(clipped), normal);
  if (vertices.length < 3) return [];
  const area = Math.abs(dot(polygonAreaNormal(vertices), normal));
  return area <= epsilon ? [] : vertices;
}

function clipConvexPolygonByConvexPolygon(
  subject: readonly Vec3[],
  clip: readonly Vec3[],
  normal: Vec3,
): Vec3[] {
  let output = subject.map((vertex) => [...vertex] as Vec3);
  for (let index = 0; index < clip.length; index += 1) {
    const edgeStart = clip[index] ?? [0, 0, 0];
    const edgeEnd = clip[(index + 1) % clip.length] ?? edgeStart;
    output = clipConvexPolygonByEdge(output, edgeStart, edgeEnd, normal);
    if (output.length < 3) return [];
  }
  return output;
}

function clipConvexPolygonByEdge(
  vertices: readonly Vec3[],
  edgeStart: Vec3,
  edgeEnd: Vec3,
  normal: Vec3,
): Vec3[] {
  const clipped: Vec3[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const previous = vertices[(index + vertices.length - 1) % vertices.length] ?? vertices[index] ?? [0, 0, 0];
    const current = vertices[index] ?? previous;
    const previousDistance = edgeSignedDistance(edgeStart, edgeEnd, previous, normal);
    const currentDistance = edgeSignedDistance(edgeStart, edgeEnd, current, normal);
    const previousInside = previousDistance >= -epsilon;
    const currentInside = currentDistance >= -epsilon;
    if (currentInside) {
      if (!previousInside) {
        clipped.push(intersectEdgeClipSegment(previous, current, previousDistance, currentDistance));
      }
      clipped.push([...current] as Vec3);
    } else if (previousInside) {
      clipped.push(intersectEdgeClipSegment(previous, current, previousDistance, currentDistance));
    }
  }
  return uniqueVec3(clipped);
}

function edgeSignedDistance(edgeStart: Vec3, edgeEnd: Vec3, point: Vec3, normal: Vec3): number {
  return dot(cross(subtract(edgeEnd, edgeStart), subtract(point, edgeStart)), normal);
}

function intersectEdgeClipSegment(
  a: Vec3,
  b: Vec3,
  aDistance: number,
  bDistance: number,
): Vec3 {
  const denominator = aDistance - bDistance;
  const t = Math.abs(denominator) <= epsilon ? 0 : aDistance / denominator;
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function brushBspFaceSideSign(halfspace: BrushBspHalfspace, canonicalNormal: Vec3): -1 | 1 {
  const normalized = normalizePlane(halfspace.plane);
  const normalSign = dot(normalized.normal, canonicalNormal) >= 0 ? 1 : -1;
  const sideSign = halfspace.side === "front" ? normalSign : -normalSign;
  return sideSign >= 0 ? 1 : -1;
}

function portalOverlapKey(a: BrushBspFace, b: BrushBspFace, vertices: readonly Vec3[]): string {
  const leafKey = [a.cell.id, b.cell.id].sort().join("<>");
  const vertexKey = [...vertices]
    .map((vertex) => vertex.map(formatNumber).join(","))
    .sort()
    .join("|");
  return `${leafKey}:${vertexKey}`;
}

function canonicalPlaneKey(plane: PolyWorldBspPlane): string {
  const canonical = canonicalPlane(plane);
  return `${canonical.normal.map(formatNumber).join(",")}:${formatNumber(canonical.distance)}`;
}

function canonicalPlane(plane: PolyWorldBspPlane): PolyWorldBspPlane {
  const normalized = normalizePlane(plane);
  let normal = normalized.normal;
  let distance = normalized.distance;
  const flip = normal.find((component) => Math.abs(component) > epsilon) ?? 0;
  if (flip < 0) {
    normal = [-normal[0], -normal[1], -normal[2]];
    distance = -distance;
  }
  return {
    normal: [...normal] as Vec3,
    distance,
    ...(normalized.epsilon === undefined ? {} : { epsilon: normalized.epsilon }),
  };
}

function signedDistance(plane: PolyWorldBspPlane, point: Vec3): number {
  return dot(plane.normal, point) - plane.distance;
}

function pushUniqueVec3(points: Vec3[], point: Vec3): void {
  if (!points.some((existing) => distanceSq(existing, point) <= epsilon * epsilon)) {
    points.push([point[0], point[1], point[2]]);
  }
}

function uniqueVec3(points: readonly Vec3[]): Vec3[] {
  const result: Vec3[] = [];
  for (const point of points) pushUniqueVec3(result, point);
  return result;
}

function boundsFromPoints(points: readonly Vec3[]): PolyWorldBounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  return { min, max };
}

function averageVec3(points: readonly Vec3[]): Vec3 {
  const total = points.reduce((acc, point) => [
    acc[0] + point[0],
    acc[1] + point[1],
    acc[2] + point[2],
  ] as Vec3, [0, 0, 0] as Vec3);
  return [total[0] / points.length, total[1] / points.length, total[2] / points.length];
}

function hasNonZeroVolume(points: readonly Vec3[]): boolean {
  for (let a = 0; a < points.length - 3; a += 1) {
    for (let b = a + 1; b < points.length - 2; b += 1) {
      for (let c = b + 1; c < points.length - 1; c += 1) {
        for (let d = c + 1; d < points.length; d += 1) {
          const pa = points[a];
          const pb = points[b];
          const pc = points[c];
          const pd = points[d];
          if (pa === undefined || pb === undefined || pc === undefined || pd === undefined) continue;
          const volume = Math.abs(dot(cross(subtract(pb, pa), subtract(pc, pa)), subtract(pd, pa)));
          if (volume > epsilon) return true;
        }
      }
    }
  }
  return false;
}

function polygonAreaNormal(vertices: readonly Vec3[]): Vec3 {
  return vertices.reduce<Vec3>((acc, vertex, index) => {
    const next = vertices[(index + 1) % vertices.length] ?? vertex;
    return [
      acc[0] + vertex[1] * next[2] - vertex[2] * next[1],
      acc[1] + vertex[2] * next[0] - vertex[0] * next[2],
      acc[2] + vertex[0] * next[1] - vertex[1] * next[0],
    ];
  }, [0, 0, 0]);
}

function normalizeVec3(value: Vec3): Vec3 {
  const length = vecLength(value);
  if (length <= epsilon) return [0, 0, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function vecLength(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function validateBounds(
  kind: "world" | "brush" | "region",
  id: string,
  bounds: PolyWorldBounds,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  if (!isVec3(bounds.min) || !isVec3(bounds.max)) {
    diagnostics.push({
      code: "poly-world-invalid-brush-bsp-bounds",
      message: `PolyWorld brush BSP ${kind} "${id}" bounds must be finite Vec3 min/max.`,
      id,
      field: "bounds",
      kind: kind === "world" ? "compile" : kind,
    });
    return;
  }
  for (const axis of [0, 1, 2] as const) {
    if (bounds.min[axis] >= bounds.max[axis]) {
      diagnostics.push({
        code: "poly-world-invalid-brush-bsp-bounds-order",
        message: `PolyWorld brush BSP ${kind} "${id}" bounds.min must be < bounds.max on every axis.`,
        id,
        field: "bounds",
        kind: kind === "world" ? "compile" : kind,
      });
      return;
    }
  }
}

function resolveBrushBspRegion(
  point: Vec3,
  regions: readonly PolyWorldBrushBspRegion[],
): PolyWorldBrushBspRegion | undefined {
  return regions
    .filter((region) => boundsContainsPoint(region.bounds, point))
    .sort((a, b) => boundsVolume(a.bounds) - boundsVolume(b.bounds) || a.id.localeCompare(b.id))[0];
}

function boundsVolume(bounds: PolyWorldBounds): number {
  return Math.max(0, bounds.max[0] - bounds.min[0]) *
    Math.max(0, bounds.max[1] - bounds.min[1]) *
    Math.max(0, bounds.max[2] - bounds.min[2]);
}

function boundsContainsBounds(container: PolyWorldBounds, bounds: PolyWorldBounds): boolean {
  return ([0, 1, 2] as const).every((axis) =>
    bounds.min[axis] >= container.min[axis] - 0.0001 &&
    bounds.max[axis] <= container.max[axis] + 0.0001
  );
}

function boundsContainsPoint(bounds: PolyWorldBounds, point: Vec3): boolean {
  return ([0, 1, 2] as const).every((axis) =>
    point[axis] >= bounds.min[axis] - 0.0001 &&
    point[axis] <= bounds.max[axis] + 0.0001
  );
}

function boundsTouchesBoundsBoundary(bounds: PolyWorldBounds, container: PolyWorldBounds): boolean {
  return ([0, 1, 2] as const).some((axis) =>
    Math.abs(bounds.min[axis] - container.min[axis]) <= 0.0001 ||
    Math.abs(bounds.max[axis] - container.max[axis]) <= 0.0001
  );
}

function cloneBounds(bounds: PolyWorldBounds): PolyWorldBounds {
  return {
    min: [...bounds.min] as Vec3,
    max: [...bounds.max] as Vec3,
  };
}

function boundsCenter(bounds: PolyWorldBounds): Vec3 {
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000).replace("-", "neg-").replace(".", "p");
}

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
