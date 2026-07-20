import type { Vec3 } from "@layoutit/polycss-core";
import type {
  PolyWorldBounds,
  PolyWorldData,
  PolyWorldSelection,
  PolyWorldSelectionReason,
  PolyWorldSpatialElement,
  PolyWorldSpatialElementRole,
  PolyWorldSpatialElementVisibility,
  PolyWorldTopology,
} from "../topology";
import {
  resolvePolyWorldSpatialElementRole,
  resolvePolyWorldSpatialElementVisibility,
} from "../topology";
import {
  addVec3,
  averageVec3,
  crossVec3 as cross,
  dotVec3 as dot,
  normalizeVec3OrUndefined as normalizeBspVector,
  polygonAreaNormal,
  scaleVec3,
  subtractVec3,
  uniqueVec3,
} from "./bspGeometry";

export type PolyWorldBspPvsProjection = "xy" | "xz" | "yz";

interface PolyWorldBspClipPlane {
  normal: Vec3;
  distance: number;
}

interface PolyWorldBspPortalClip {
  planes: readonly PolyWorldBspClipPlane[];
  origin: Vec3;
  rays: readonly Vec3[];
}

export interface PolyWorldBspPlane {
  normal: Vec3;
  distance: number;
  epsilon?: number;
}

export interface PolyWorldBspLeafRef {
  leafId: string;
}

export interface PolyWorldBspNode {
  id: string;
  plane: PolyWorldBspPlane;
  front: PolyWorldBspChild;
  back: PolyWorldBspChild;
  onPlane?: "front" | "back";
  data?: PolyWorldData;
}

export type PolyWorldBspChild = PolyWorldBspNode | PolyWorldBspLeafRef;

export interface PolyWorldBspLeaf {
  id: string;
  regionId?: string;
  clusterId?: string;
  bounds?: PolyWorldBounds;
  center?: Vec3;
  pvsSamplePoints?: readonly Vec3[];
  pvs?: PolyWorldBspBakedPvs;
  elementIds?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldBspPvsIndex {
  leafIds: readonly string[];
  portalIds: readonly string[];
  leafIndexById: ReadonlyMap<string, number>;
  portalIndexById: ReadonlyMap<string, number>;
}

export interface PolyWorldBspBakedPvs {
  leafBits: Uint32Array;
  portalBits: Uint32Array;
  regionIds: readonly string[];
  linkIds: readonly string[];
  selectionKeys: readonly string[];
  elementIds: readonly string[];
}

export interface PolyWorldBspPortal {
  id: string;
  fromLeafId: string;
  toLeafId: string;
  linkId?: string;
  vertices: readonly Vec3[];
  selectionKeys?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldBspCompileRegion {
  id: string;
  regionId?: string;
  clusterId?: string;
  bounds: PolyWorldBounds;
  center?: Vec3;
  pvsSamplePoints?: readonly Vec3[];
  elementIds?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldBspCompilePortal {
  id: string;
  fromRegionId: string;
  toRegionId: string;
  linkId?: string;
  bounds?: PolyWorldBounds;
  vertices?: readonly Vec3[];
  selectionKeys?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldBspCompileOptions {
  pvs?: PolyWorldBspPvsBakeOptions;
  bakePvs?: boolean;
  splitIdPrefix?: string;
}

export interface PolyWorldBspCompileInput extends PolyWorldBspCompileOptions {
  regions: readonly PolyWorldBspCompileRegion[];
  portals?: readonly PolyWorldBspCompilePortal[];
  data?: PolyWorldData;
}

export interface PolyWorldBspTreeInput {
  root: PolyWorldBspChild;
  leaves: readonly PolyWorldBspLeaf[];
  portals?: readonly PolyWorldBspPortal[];
  pvsIndex?: PolyWorldBspPvsIndex;
  data?: PolyWorldData;
}

export interface PolyWorldBspTree {
  root: PolyWorldBspChild;
  leaves: readonly PolyWorldBspLeaf[];
  portals: readonly PolyWorldBspPortal[];
  leavesById: ReadonlyMap<string, PolyWorldBspLeaf>;
  portalsById: ReadonlyMap<string, PolyWorldBspPortal>;
  portalsByLeafId: ReadonlyMap<string, readonly PolyWorldBspPortal[]>;
  pvsIndex?: PolyWorldBspPvsIndex;
  data?: PolyWorldData;
}

export interface PolyWorldBspLeafResolution {
  leaf: PolyWorldBspLeaf;
  leafId: string;
  path: readonly string[];
}

export interface PolyWorldBspPvsReasonLabels {
  leaf?: string;
  pvs?: string;
  selectionKey?: string;
}

export interface PolyWorldBspPvsSelectionOptions extends PolyWorldBspPvsBakeOptions {
  point?: Vec3;
  leafId?: string;
  includeLeafRegion?: boolean;
  includePvs?: boolean;
  regionIds?: readonly string[];
  linkIds?: readonly string[];
  selectionKeys?: readonly string[];
  elementIds?: readonly string[];
  reasonLabels?: PolyWorldBspPvsReasonLabels;
  reasons?: readonly PolyWorldSelectionReason[];
  data?: PolyWorldData;
}

export interface PolyWorldBspViewPvsReasonLabels extends PolyWorldBspPvsReasonLabels {
  view?: string;
}

export interface PolyWorldBspViewPvsOptions extends PolyWorldBspPvsBakeOptions {
  point: Vec3;
  leafId?: string;
  forward: Vec3;
  up?: Vec3;
  aspect?: number;
  fovDegrees?: number;
  near?: number;
  far?: number;
}

export interface PolyWorldBspViewPvsSelectionOptions extends PolyWorldBspViewPvsOptions {
  includeLeafRegion?: boolean;
  includePvs?: boolean;
  regionIds?: readonly string[];
  linkIds?: readonly string[];
  selectionKeys?: readonly string[];
  elementIds?: readonly string[];
  reasonLabels?: PolyWorldBspViewPvsReasonLabels;
  reasons?: readonly PolyWorldSelectionReason[];
  data?: PolyWorldData;
}

export interface PolyWorldBspPvsBakeOptions {
  projection?: PolyWorldBspPvsProjection;
  sampleInset?: number;
  maxDepth?: number;
  includePortalSelectionKeys?: boolean;
  portalState?: PolyWorldBspPortalState;
}

export interface PolyWorldBspPortalStateContext {
  fromLeafId: string;
  toLeafId: string;
  depth: number;
}

export type PolyWorldBspPortalStateValue = boolean | "open" | "closed" | "blocked";

export type PolyWorldBspPortalStateResolver = (
  portal: PolyWorldBspPortal,
  context: PolyWorldBspPortalStateContext,
) => boolean;

export type PolyWorldBspPortalState =
  | Readonly<Record<string, PolyWorldBspPortalStateValue>>
  | PolyWorldBspPortalStateResolver;

export interface PolyWorldBspResolvedPvs {
  leafId: string;
  leafIds: readonly string[];
  clusterIds: readonly string[];
  regionIds: readonly string[];
  linkIds: readonly string[];
  portalIds: readonly string[];
  selectionKeys: readonly string[];
  elementIds: readonly string[];
}

export interface PolyWorldBspResolvedViewPvs extends PolyWorldBspResolvedPvs {
  broadPhaseLeafIds: readonly string[];
  broadPhasePortalIds: readonly string[];
  fovDegrees: number;
}

export interface PolyWorldBspViewSurfaceElement extends PolyWorldSpatialElement {
  vertices: readonly Vec3[];
  role?: PolyWorldBspViewSurfaceRole;
  visibility?: PolyWorldBspViewSurfaceVisibility;
}

export type PolyWorldBspViewSurfaceRole = PolyWorldSpatialElementRole;

export type PolyWorldBspViewSurfaceVisibility = PolyWorldSpatialElementVisibility;

export interface PolyWorldBspViewSurfaceElementOptions extends PolyWorldBspViewPvsOptions {
  surfaces: readonly PolyWorldBspViewSurfaceElement[];
}

export interface PolyWorldBspResolvedViewSurfaceElements {
  surfaceIds: readonly string[];
  elementIds: readonly string[];
  structuralSurfaceIds: readonly string[];
  structuralElementIds: readonly string[];
  detailSurfaceIds: readonly string[];
  detailElementIds: readonly string[];
  leafIds: readonly string[];
  regionIds: readonly string[];
  roles: readonly PolyWorldBspResolvedViewSurfaceRoleSummary[];
}

export interface PolyWorldBspResolvedViewSurfaceRoleSummary {
  role: PolyWorldBspViewSurfaceRole;
  count: number;
  surfaceIds: readonly string[];
  elementIds: readonly string[];
}

export type PolyWorldBspViewPvsTraceStatus =
  | "visible"
  | "outside-broad-phase"
  | "closed"
  | "blocked"
  | "depth-capped"
  | "missing-target-leaf"
  | "clipped"
  | "degenerate-clip";

export interface PolyWorldBspViewPvsTraceEntry {
  portalId: string;
  fromLeafId: string;
  toLeafId: string;
  depth: number;
  status: PolyWorldBspViewPvsTraceStatus;
  inputVertexCount: number;
  clippedVertexCount?: number;
  clipPlaneCount?: number;
  linkId?: string;
  selectionKeys?: readonly string[];
}

export interface PolyWorldBspViewPvsTrace extends PolyWorldBspResolvedViewPvs {
  entries: readonly PolyWorldBspViewPvsTraceEntry[];
}

export interface PolyWorldBspDiagnostic {
  code: string;
  message: string;
  id?: string;
  field?: string;
  kind?: "brush" | "compile" | "tree" | "node" | "leaf" | "portal" | "region" | "surface";
}

export class PolyWorldBspError extends Error {
  readonly diagnostics: readonly PolyWorldBspDiagnostic[];

  constructor(diagnostics: readonly PolyWorldBspDiagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
    this.name = "PolyWorldBspError";
    this.diagnostics = diagnostics;
  }
}

export function compilePolyWorldBsp(input: PolyWorldBspCompileInput): PolyWorldBspTree {
  const diagnostics = validatePolyWorldBspCompileInput(input);
  if (diagnostics.length > 0) throw new PolyWorldBspError(diagnostics);

  const leaves = input.regions.map((region) => ({
    id: region.id,
    regionId: region.regionId ?? region.id,
    ...(region.clusterId === undefined ? {} : { clusterId: region.clusterId }),
    bounds: cloneBounds(region.bounds),
    center: region.center === undefined ? boundsCenter(region.bounds) : [...region.center] as Vec3,
    ...(region.pvsSamplePoints === undefined ? {} : {
      pvsSamplePoints: region.pvsSamplePoints.map((point) => [...point] as Vec3),
    }),
    ...(region.elementIds === undefined ? {} : { elementIds: [...region.elementIds] }),
    data: {
      ...region.data,
      compiled: true,
    },
  }));
  const regionsById = new Map(input.regions.map((region) => [region.id, region]));
  const portals = (input.portals ?? []).map((portal) => compileBspPortal(portal, regionsById));
  const root = compileBspChild(leaves, input.splitIdPrefix ?? "bsp", 0);
  const tree = createPolyWorldBspTree({
    root,
    leaves,
    portals,
    data: {
      ...input.data,
      compiled: true,
      compiler: "bounds-bsp",
    },
  });
  if (input.bakePvs === false) return tree;
  return bakePolyWorldBspPvs(tree, input.pvs);
}

export function validatePolyWorldBspCompileInput(
  input: PolyWorldBspCompileInput,
): PolyWorldBspDiagnostic[] {
  const diagnostics: PolyWorldBspDiagnostic[] = [];
  const regionIds = new Set<string>();
  const portalIds = new Set<string>();

  if (input.regions.length === 0) {
    diagnostics.push({
      code: "poly-world-empty-bsp-compile-regions",
      message: "PolyWorld BSP compiler requires at least one region.",
      field: "regions",
      kind: "compile",
    });
  }

  for (const region of input.regions) {
    validateId("region", region.id, diagnostics);
    if (region.id && regionIds.has(region.id)) {
      diagnostics.push({
        code: "poly-world-duplicate-bsp-compile-region-id",
        message: `Duplicate PolyWorld BSP compile region id "${region.id}".`,
        id: region.id,
        field: "id",
        kind: "region",
      });
    }
    if (region.id) regionIds.add(region.id);
    validateOptionalString("region", region.id, "clusterId", region.clusterId, diagnostics);
    validateBounds("region", region.id, region.bounds, diagnostics);
    validateVec3("region", region.id, "center", region.center, diagnostics);
    validateVec3Array("region", region.id, "pvsSamplePoints", region.pvsSamplePoints, diagnostics);
    validateStringArray("region", region.id, "elementIds", region.elementIds, diagnostics);
  }

  for (const portal of input.portals ?? []) {
    validateId("portal", portal.id, diagnostics);
    if (portal.id && portalIds.has(portal.id)) {
      diagnostics.push({
        code: "poly-world-duplicate-bsp-compile-portal-id",
        message: `Duplicate PolyWorld BSP compile portal id "${portal.id}".`,
        id: portal.id,
        field: "id",
        kind: "portal",
      });
    }
    if (portal.id) portalIds.add(portal.id);
    validateCompilePortalRegion(portal, "fromRegionId", regionIds, diagnostics);
    validateCompilePortalRegion(portal, "toRegionId", regionIds, diagnostics);
    if (portal.fromRegionId === portal.toRegionId) {
      diagnostics.push({
        code: "poly-world-bsp-compile-portal-self-link",
        message: `PolyWorld BSP compile portal "${portal.id}" must connect two different regions.`,
        id: portal.id,
        field: "toRegionId",
        kind: "portal",
      });
    }
    validateBounds("portal", portal.id, portal.bounds, diagnostics);
    validateVec3Array("portal", portal.id, "vertices", portal.vertices, diagnostics);
    validateStringArray("portal", portal.id, "selectionKeys", portal.selectionKeys, diagnostics);
  }

  return diagnostics;
}

export function createPolyWorldBspTree(input: PolyWorldBspTreeInput): PolyWorldBspTree {
  const diagnostics = validatePolyWorldBspTree(input);
  if (diagnostics.length > 0) throw new PolyWorldBspError(diagnostics);

  const leaves = input.leaves.map((leaf) => cloneBspLeaf(leaf));
  const portals = (input.portals ?? []).map((portal) => cloneBspPortal(portal));
  const pvsIndex = input.pvsIndex === undefined ? undefined : cloneBspPvsIndex(input.pvsIndex);
  const portalsByLeafId = new Map<string, PolyWorldBspPortal[]>();
  for (const portal of portals) {
    pushMap(portalsByLeafId, portal.fromLeafId, portal);
    pushMap(portalsByLeafId, portal.toLeafId, portal);
  }

  return {
    root: cloneBspChild(input.root),
    leaves,
    portals,
    leavesById: new Map(leaves.map((leaf) => [leaf.id, leaf])),
    portalsById: new Map(portals.map((portal) => [portal.id, portal])),
    portalsByLeafId,
    ...(pvsIndex === undefined ? {} : { pvsIndex }),
    data: input.data,
  };
}

export function createPolyWorldBspPvsIndex(tree: Pick<PolyWorldBspTree, "leaves" | "portals">): PolyWorldBspPvsIndex {
  const leafIds = tree.leaves.map((leaf) => leaf.id);
  const portalIds = tree.portals.map((portal) => portal.id);
  return {
    leafIds,
    portalIds,
    leafIndexById: new Map(leafIds.map((leafId, index) => [leafId, index])),
    portalIndexById: new Map(portalIds.map((portalId, index) => [portalId, index])),
  };
}

export function decodePolyWorldBspPvsLeafIds(
  index: PolyWorldBspPvsIndex,
  pvs: PolyWorldBspBakedPvs,
): string[] {
  return bitsetIds(index.leafIds, pvs.leafBits);
}

export function decodePolyWorldBspPvsPortalIds(
  index: PolyWorldBspPvsIndex,
  pvs: PolyWorldBspBakedPvs,
): string[] {
  return bitsetIds(index.portalIds, pvs.portalBits);
}

export function resolvePolyWorldBspBakedPvs(
  tree: PolyWorldBspTree,
  leafId: string,
): PolyWorldBspResolvedPvs | undefined {
  const leaf = tree.leavesById.get(leafId);
  if (leaf === undefined) {
    throw new PolyWorldBspError([{
      code: "poly-world-missing-bsp-baked-pvs-leaf",
      message: `PolyWorld BSP baked PVS cannot resolve missing leaf "${leafId}".`,
      id: leafId,
      kind: "leaf",
    }]);
  }
  if (leaf.pvs === undefined) return undefined;
  if (tree.pvsIndex === undefined) {
    throw new PolyWorldBspError([{
      code: "poly-world-bsp-baked-pvs-missing-index",
      message: `PolyWorld BSP baked PVS for leaf "${leafId}" requires a tree pvsIndex.`,
      id: leafId,
      field: "pvsIndex",
      kind: "tree",
    }]);
  }
  const leafIds = decodePolyWorldBspPvsLeafIds(tree.pvsIndex, leaf.pvs);
  return {
    leafId: leaf.id,
    leafIds,
    clusterIds: clusterIdsForLeafIds(tree, leafIds),
    regionIds: [...leaf.pvs.regionIds],
    linkIds: [...leaf.pvs.linkIds],
    portalIds: decodePolyWorldBspPvsPortalIds(tree.pvsIndex, leaf.pvs),
    selectionKeys: [...leaf.pvs.selectionKeys],
    elementIds: [...leaf.pvs.elementIds],
  };
}

export function validatePolyWorldBspTree(input: PolyWorldBspTreeInput): PolyWorldBspDiagnostic[] {
  const diagnostics: PolyWorldBspDiagnostic[] = [];
  const leafIds = new Set<string>();
  const leavesById = new Map<string, PolyWorldBspLeaf>();
  const nodeIds = new Set<string>();
  const portalIds = new Set<string>();
  const rootLeafIds = new Set<string>();
  const rootLeafRefCounts = new Map<string, number>();

  if (input.leaves.length === 0) {
    diagnostics.push({
      code: "poly-world-empty-bsp-leaves",
      message: "PolyWorld BSP tree requires at least one leaf.",
      field: "leaves",
      kind: "tree",
    });
  }

  for (const leaf of input.leaves) {
    validateId("leaf", leaf.id, diagnostics);
    if (leaf.id && leafIds.has(leaf.id)) {
      diagnostics.push({
        code: "poly-world-duplicate-bsp-leaf-id",
        message: `Duplicate PolyWorld BSP leaf id "${leaf.id}".`,
        id: leaf.id,
        field: "id",
        kind: "leaf",
      });
    }
    if (leaf.id) leafIds.add(leaf.id);
    if (leaf.id) leavesById.set(leaf.id, leaf);
    validateOptionalString("leaf", leaf.id, "clusterId", leaf.clusterId, diagnostics);
    validateVec3("leaf", leaf.id, "center", leaf.center, diagnostics);
    validateVec3Array("leaf", leaf.id, "pvsSamplePoints", leaf.pvsSamplePoints, diagnostics);
    validateBounds("leaf", leaf.id, leaf.bounds, diagnostics);
    validateBspBakedPvs(leaf.id, leaf.pvs, diagnostics);
    validateStringArray("leaf", leaf.id, "elementIds", leaf.elementIds, diagnostics);
  }

  if (input.pvsIndex === undefined && input.leaves.some((leaf) => leaf.pvs !== undefined)) {
    diagnostics.push({
      code: "poly-world-bsp-pvs-missing-index",
      message: "PolyWorld BSP leaves with baked PVS require a tree pvsIndex.",
      field: "pvsIndex",
      kind: "tree",
    });
  }

  validateBspChild(input.root, leafIds, nodeIds, diagnostics, rootLeafIds, rootLeafRefCounts);
  validateBspRootLeafReferences(leafIds, rootLeafIds, rootLeafRefCounts, diagnostics);

  for (const portal of input.portals ?? []) {
    validateId("portal", portal.id, diagnostics);
    if (portal.id && portalIds.has(portal.id)) {
      diagnostics.push({
        code: "poly-world-duplicate-bsp-portal-id",
        message: `Duplicate PolyWorld BSP portal id "${portal.id}".`,
        id: portal.id,
        field: "id",
        kind: "portal",
      });
    }
    if (portal.id) portalIds.add(portal.id);
    validatePortalLeaf(portal, "fromLeafId", leafIds, diagnostics);
    validatePortalLeaf(portal, "toLeafId", leafIds, diagnostics);
    if (portal.fromLeafId === portal.toLeafId) {
      diagnostics.push({
        code: "poly-world-bsp-portal-self-link",
        message: `PolyWorld BSP portal "${portal.id}" must connect two different leaves.`,
        id: portal.id,
        field: "toLeafId",
        kind: "portal",
      });
    }
    validateVec3Array("portal", portal.id, "vertices", portal.vertices, diagnostics);
    if (portal.vertices.length < 3) {
      diagnostics.push({
        code: "poly-world-bsp-portal-too-few-vertices",
        message: `PolyWorld BSP portal "${portal.id}" requires at least three vertices.`,
        id: portal.id,
        field: "vertices",
        kind: "portal",
      });
    } else if (isValidVec3Array(portal.vertices)) {
      try {
        normalizeBspPortalVertices(portal.id, portal.vertices);
      } catch (error) {
        if (error instanceof PolyWorldBspError) diagnostics.push(...error.diagnostics);
        else throw error;
      }
      validateBspPortalAdjacency(portal, leavesById, diagnostics);
    }
    validateStringArray("portal", portal.id, "selectionKeys", portal.selectionKeys, diagnostics);
  }

  const reachableLeafIds = collectReachableBspLeafIds(rootLeafIds, input.portals ?? []);
  for (const leafId of leafIds) {
    if (reachableLeafIds.has(leafId)) continue;
    diagnostics.push({
      code: "poly-world-unreachable-bsp-leaf",
      message: `PolyWorld BSP leaf "${leafId}" is not reachable from the root leaf set or portal graph.`,
      id: leafId,
      kind: "leaf",
    });
  }

  if (input.pvsIndex !== undefined) {
    validateBspPvsIndex(input.pvsIndex, leafIds, portalIds, diagnostics);
    for (const leaf of input.leaves) {
      validateBspBakedPvsIndex(leaf.id, leaf.pvs, input.pvsIndex, input.leaves, input.portals ?? [], diagnostics);
    }
  }

  return diagnostics;
}

export function bakePolyWorldBspPvs(
  tree: PolyWorldBspTree,
  options: PolyWorldBspPvsBakeOptions = {},
): PolyWorldBspTree {
  const pvsIndex = createPolyWorldBspPvsIndex(tree);
  const leaves = tree.leaves.map((leaf) => {
    const pvs = resolvePolyWorldBspPvs(tree, leaf.id, options);
    return {
      ...leaf,
      pvs: encodeBspPvs(pvs, pvsIndex),
    };
  });
  return createPolyWorldBspTree({
    root: tree.root,
    leaves,
    portals: tree.portals,
    pvsIndex,
    data: {
      ...tree.data,
      pvsGenerated: true,
      pvsMethod: "portal-clipped-baked",
      pvsProjection: options.projection ?? "xy",
      pvsSource: "polycss-world",
    },
  });
}

export function resolvePolyWorldBspPvs(
  tree: PolyWorldBspTree,
  leafId: string,
  options: PolyWorldBspPvsBakeOptions = {},
): PolyWorldBspResolvedPvs {
  const sourceLeaf = tree.leavesById.get(leafId);
  if (sourceLeaf === undefined) {
    throw new PolyWorldBspError([{
      code: "poly-world-missing-bsp-pvs-leaf",
      message: `PolyWorld BSP PVS cannot resolve missing leaf "${leafId}".`,
      id: leafId,
      kind: "leaf",
    }]);
  }

  const projection = options.projection ?? "xy";
  const maxDepth = options.maxDepth ?? tree.leaves.length;
  const leafIds = new Set<string>();
  const portalIds = new Set<string>();
  const linkIds = new Set<string>();
  const selectionKeys = new Set<string>();
  const elementIds = new Set<string>();
  const regionIds = new Set<string>();
  addVisibleLeaf(sourceLeaf, leafIds, regionIds, elementIds);

  for (const samplePoint of resolveBspLeafSamplePoints(sourceLeaf, projection, options)) {
    traceBspPortalFrustumPvs(
      tree,
      sourceLeaf.id,
      samplePoint,
      { planes: [], origin: [...samplePoint] as Vec3, rays: [] },
      new Set(),
      {
        leafIds,
        portalIds,
        linkIds,
        selectionKeys,
        elementIds,
        regionIds,
      },
      { ...options, projection, maxDepth },
      0,
    );
  }

  return {
    leafId,
    leafIds: tree.leaves.filter((leaf) => leafIds.has(leaf.id)).map((leaf) => leaf.id),
    clusterIds: unique(tree.leaves.flatMap((leaf) => leafIds.has(leaf.id) && leaf.clusterId ? [leaf.clusterId] : [])),
    regionIds: unique(tree.leaves.flatMap((leaf) => leafIds.has(leaf.id) && leaf.regionId ? [leaf.regionId] : [])),
    linkIds: unique(tree.portals.flatMap((portal) => portalIds.has(portal.id) && portal.linkId ? [portal.linkId] : [])),
    portalIds: tree.portals.filter((portal) => portalIds.has(portal.id)).map((portal) => portal.id),
    selectionKeys: unique([
      ...tree.portals.flatMap((portal) => portalIds.has(portal.id) ? [...(portal.selectionKeys ?? [])] : []),
      ...Array.from(selectionKeys),
    ]),
    elementIds: unique(tree.leaves.flatMap((leaf) => leafIds.has(leaf.id) ? [...(leaf.elementIds ?? [])] : [])),
  };
}

export function resolvePolyWorldBspViewPvs(
  tree: PolyWorldBspTree,
  options: PolyWorldBspViewPvsOptions,
): PolyWorldBspResolvedViewPvs {
  return resolveBspViewPvs(tree, options);
}

export function tracePolyWorldBspViewPvs(
  tree: PolyWorldBspTree,
  options: PolyWorldBspViewPvsOptions,
): PolyWorldBspViewPvsTrace {
  const entries: PolyWorldBspViewPvsTraceEntry[] = [];
  return {
    ...resolveBspViewPvs(tree, options, entries),
    entries,
  };
}

export function resolvePolyWorldBspViewSurfaceElements(
  tree: PolyWorldBspTree,
  options: PolyWorldBspViewSurfaceElementOptions,
): PolyWorldBspResolvedViewSurfaceElements {
  const leafClips = new Map<string, PolyWorldBspPortalClip[]>();
  resolveBspViewPvs(tree, options, undefined, leafClips);
  const surfaceIds = new Set<string>();
  const elementIds = new Set<string>();
  const structuralSurfaceIds = new Set<string>();
  const structuralElementIds = new Set<string>();
  const detailSurfaceIds = new Set<string>();
  const detailElementIds = new Set<string>();
  const leafIds = new Set<string>();
  const regionIds = new Set<string>();

  for (const surface of options.surfaces) {
    for (const [leafId, clips] of leafClips) {
      const leaf = tree.leavesById.get(leafId);
      if (leaf === undefined || !surfaceMatchesBspLeaf(surface, leaf)) continue;
      if (resolveBspViewSurfaceVisibility(surface) === "structural") {
        addBspSelectedViewSurface(
          surface,
          leafId,
          surfaceIds,
          elementIds,
          structuralSurfaceIds,
          structuralElementIds,
          leafIds,
          regionIds,
        );
        break;
      }
      if (!clips.some((clip) => surfaceIntersectsBspClip(surface.vertices, clip))) continue;
      addBspSelectedViewSurface(
        surface,
        leafId,
        surfaceIds,
        elementIds,
        detailSurfaceIds,
        detailElementIds,
        leafIds,
        regionIds,
      );
      break;
    }
  }

  return {
    surfaceIds: options.surfaces.filter((surface) => surfaceIds.has(surface.id)).map((surface) => surface.id),
    elementIds: unique(options.surfaces.flatMap((surface) =>
      surfaceIds.has(surface.id) ? [surface.elementId ?? surface.id] : []
    )),
    structuralSurfaceIds: options.surfaces
      .filter((surface) => structuralSurfaceIds.has(surface.id))
      .map((surface) => surface.id),
    structuralElementIds: unique(options.surfaces.flatMap((surface) =>
      structuralSurfaceIds.has(surface.id) ? [surface.elementId ?? surface.id] : []
    )),
    detailSurfaceIds: options.surfaces
      .filter((surface) => detailSurfaceIds.has(surface.id))
      .map((surface) => surface.id),
    detailElementIds: unique(options.surfaces.flatMap((surface) =>
      detailSurfaceIds.has(surface.id) ? [surface.elementId ?? surface.id] : []
    )),
    leafIds: tree.leaves.filter((leaf) => leafIds.has(leaf.id)).map((leaf) => leaf.id),
    regionIds: unique(tree.leaves.flatMap((leaf) =>
      leafIds.has(leaf.id) && leaf.regionId !== undefined ? [leaf.regionId] : []
    )),
    roles: summarizeBspViewSurfaceRoles(options.surfaces.filter((surface) => surfaceIds.has(surface.id))),
  };
}

function addBspSelectedViewSurface(
  surface: PolyWorldBspViewSurfaceElement,
  leafId: string,
  surfaceIds: Set<string>,
  elementIds: Set<string>,
  visibilitySurfaceIds: Set<string>,
  visibilityElementIds: Set<string>,
  leafIds: Set<string>,
  regionIds: Set<string>,
): void {
  const elementId = surface.elementId ?? surface.id;
  surfaceIds.add(surface.id);
  elementIds.add(elementId);
  visibilitySurfaceIds.add(surface.id);
  visibilityElementIds.add(elementId);
  leafIds.add(leafId);
  if (surface.regionId !== undefined) regionIds.add(surface.regionId);
}

function resolveBspViewSurfaceVisibility(
  surface: PolyWorldBspViewSurfaceElement,
): PolyWorldBspViewSurfaceVisibility {
  return resolvePolyWorldSpatialElementVisibility(surface);
}

function resolveBspViewSurfaceRole(
  surface: PolyWorldBspViewSurfaceElement,
): PolyWorldBspViewSurfaceRole {
  return resolvePolyWorldSpatialElementRole(surface);
}

function summarizeBspViewSurfaceRoles(
  surfaces: readonly PolyWorldBspViewSurfaceElement[],
): PolyWorldBspResolvedViewSurfaceRoleSummary[] {
  const summaries = new Map<PolyWorldBspViewSurfaceRole, {
    surfaceIds: string[];
    elementIds: string[];
  }>();
  for (const surface of surfaces) {
    const role = resolveBspViewSurfaceRole(surface);
    const summary = summaries.get(role);
    if (summary === undefined) {
      summaries.set(role, {
        surfaceIds: [surface.id],
        elementIds: [surface.elementId ?? surface.id],
      });
      continue;
    }
    summary.surfaceIds.push(surface.id);
    add(summary.elementIds, surface.elementId ?? surface.id);
  }
  return bspViewSurfaceRoleOrder.flatMap((role) => {
    const summary = summaries.get(role);
    if (summary === undefined) return [];
    return [{
      role,
      count: summary.surfaceIds.length,
      surfaceIds: summary.surfaceIds,
      elementIds: summary.elementIds,
    }];
  });
}

const bspViewSurfaceRoleOrder: readonly PolyWorldBspViewSurfaceRole[] = [
  "root",
  "shell",
  "opening",
  "detail",
  "prop",
];

function resolveBspViewPvs(
  tree: PolyWorldBspTree,
  options: PolyWorldBspViewPvsOptions,
  traceEntries?: PolyWorldBspViewPvsTraceEntry[],
  leafClips?: Map<string, PolyWorldBspPortalClip[]>,
): PolyWorldBspResolvedViewPvs {
  const resolution = options.leafId === undefined
    ? resolvePolyWorldBspLeaf(tree, options.point)
    : resolveBspLeafById(tree, options.leafId);
  if (resolution === undefined) {
    throw new PolyWorldBspError([{
      code: "poly-world-missing-bsp-view-pvs-leaf",
      message: "PolyWorld BSP view PVS requires a point inside the BSP tree or an existing leafId.",
      id: options.leafId,
      kind: "leaf",
    }]);
  }

  const projection = options.projection ?? "xy";
  const maxDepth = options.maxDepth ?? tree.leaves.length;
  const fovDegrees = resolveBspViewFovDegrees(options.fovDegrees);
  const broadPhase = resolveBspBroadPhasePvs(tree, resolution.leaf, options);
  const broadPhaseLeafIds = new Set(broadPhase.leafIds);
  const leafIds = new Set<string>();
  const portalIds = new Set<string>();
  const linkIds = new Set<string>();
  const selectionKeys = new Set<string>();
  const elementIds = new Set<string>();
  const regionIds = new Set<string>();
  addVisibleLeaf(resolution.leaf, leafIds, regionIds, elementIds);
  const viewClip = createBspViewClip(options.point, options.forward, {
    up: options.up,
    aspect: options.aspect,
    fovDegrees,
    near: options.near,
    far: options.far,
  });
  addBspLeafClip(leafClips, resolution.leaf.id, viewClip);

  traceBspPortalFrustumPvs(
    tree,
    resolution.leaf.id,
    options.point,
    viewClip,
    new Set(),
    {
      leafIds,
      portalIds,
      linkIds,
      selectionKeys,
      elementIds,
      regionIds,
    },
    { ...options, projection, maxDepth },
    0,
    { leafIds: broadPhaseLeafIds },
    traceEntries,
    leafClips,
  );

  return {
    leafId: resolution.leaf.id,
    leafIds: tree.leaves.filter((leaf) => leafIds.has(leaf.id)).map((leaf) => leaf.id),
    clusterIds: unique(tree.leaves.flatMap((leaf) => leafIds.has(leaf.id) && leaf.clusterId ? [leaf.clusterId] : [])),
    regionIds: unique(tree.leaves.flatMap((leaf) => leafIds.has(leaf.id) && leaf.regionId ? [leaf.regionId] : [])),
    linkIds: unique(tree.portals.flatMap((portal) => portalIds.has(portal.id) && portal.linkId ? [portal.linkId] : [])),
    portalIds: tree.portals.filter((portal) => portalIds.has(portal.id)).map((portal) => portal.id),
    selectionKeys: unique([
      ...tree.portals.flatMap((portal) => portalIds.has(portal.id) ? [...(portal.selectionKeys ?? [])] : []),
      ...Array.from(selectionKeys),
    ]),
    elementIds: unique(Array.from(elementIds)),
    broadPhaseLeafIds: broadPhase.leafIds,
    broadPhasePortalIds: broadPhase.portalIds,
    fovDegrees,
  };
}

function surfaceMatchesBspLeaf(
  surface: PolyWorldBspViewSurfaceElement,
  leaf: PolyWorldBspLeaf,
): boolean {
  if (surface.leafId !== undefined) return surface.leafId === leaf.id;
  if (surface.regionId !== undefined) return surface.regionId === leaf.regionId;
  const center = averageVec3(surface.vertices);
  return boundsContainsBspPoint(leaf.bounds, center);
}

function boundsContainsBspPoint(bounds: PolyWorldBounds | undefined, point: Vec3): boolean {
  if (bounds === undefined) return false;
  return point.every((value, axis) =>
    value >= bounds.min[axis] - 0.0001 && value <= bounds.max[axis] + 0.0001
  );
}

export function resolvePolyWorldBspLeaf(
  tree: PolyWorldBspTree,
  point: Vec3,
): PolyWorldBspLeafResolution | undefined {
  const path: string[] = [];
  let child: PolyWorldBspChild = tree.root;

  while (!isBspLeafRef(child)) {
    path.push(child.id);
    child = selectBspChild(child, point);
  }

  const leaf = tree.leavesById.get(child.leafId);
  if (leaf === undefined) return undefined;
  return { leaf, leafId: leaf.id, path };
}

export function selectPolyWorldBspPvs(
  topology: PolyWorldTopology,
  tree: PolyWorldBspTree,
  options: PolyWorldBspPvsSelectionOptions,
): PolyWorldSelection {
  const labels = {
    leaf: "bsp-leaf",
    pvs: "pvs",
    selectionKey: "selection-key",
    ...options.reasonLabels,
  };
  const regionIds: string[] = [];
  const linkIds: string[] = [];
  const selectionKeys: string[] = [];
  const elementIds: string[] = [];
  const reasons: PolyWorldSelectionReason[] = [...(options.reasons ?? [])];
  const resolution = resolveSelectionLeaf(tree, options);
  const leaf = resolution?.leaf;

  if (leaf !== undefined && options.includeLeafRegion !== false && leaf.regionId !== undefined) {
    add(regionIds, leaf.regionId);
    reasons.push({
      id: "poly-world-bsp-leaf",
      kind: "bspLeaf",
      label: labels.leaf,
      regionIds: [leaf.regionId],
      data: {
        leafId: leaf.id,
        path: resolution?.path ?? [],
      },
    });
  }

  if (leaf !== undefined && options.includePvs !== false) {
    const pvs = resolveBspBroadPhasePvs(tree, leaf, options);
    for (const regionId of pvs.regionIds) add(regionIds, regionId);
    for (const linkId of pvs.linkIds) add(linkIds, linkId);
    for (const selectionKey of pvs.selectionKeys) add(selectionKeys, selectionKey);
    for (const elementId of pvs.elementIds) add(elementIds, elementId);
    addLinkSelectionKeys(topology, linkIds, selectionKeys);
    if (
      pvs.regionIds.length > 0 ||
      pvs.linkIds.length > 0 ||
      pvs.selectionKeys.length > 0 ||
      pvs.elementIds.length > 0
    ) {
      reasons.push({
        id: "poly-world-bsp-pvs",
        kind: "pvs",
        label: labels.pvs,
        regionIds: pvs.regionIds,
        linkIds: pvs.linkIds,
        selectionKeys: pvs.selectionKeys,
        data: {
          leafId: leaf.id,
          portalIds: pvs.portalIds,
          leafIds: pvs.leafIds,
          clusterIds: pvs.clusterIds,
        },
      });
    }
  }

  for (const regionId of options.regionIds ?? []) add(regionIds, regionId);
  for (const linkId of options.linkIds ?? []) add(linkIds, linkId);
  for (const selectionKey of options.selectionKeys ?? []) add(selectionKeys, selectionKey);
  for (const elementId of options.elementIds ?? []) add(elementIds, elementId);
  addLinkSelectionKeys(topology, linkIds, selectionKeys);

  if (selectionKeys.length > 0) {
    reasons.push({
      id: "poly-world-bsp-selection-key",
      kind: "selectionKey",
      label: labels.selectionKey,
      selectionKeys,
    });
  }

  return {
    regionIds,
    linkIds,
    selectionKeys,
    elementIds,
    reasons,
    data: {
      ...options.data,
      ...(leaf === undefined ? {} : { leafId: leaf.id }),
    },
  };
}

export function selectPolyWorldBspViewPvs(
  topology: PolyWorldTopology,
  tree: PolyWorldBspTree,
  options: PolyWorldBspViewPvsSelectionOptions,
): PolyWorldSelection {
  const labels = {
    leaf: "bsp-leaf",
    view: "view-pvs",
    selectionKey: "selection-key",
    ...options.reasonLabels,
  };
  const regionIds: string[] = [];
  const linkIds: string[] = [];
  const selectionKeys: string[] = [];
  const elementIds: string[] = [];
  const reasons: PolyWorldSelectionReason[] = [...(options.reasons ?? [])];
  const resolution = resolveSelectionLeaf(tree, options);
  const leaf = resolution?.leaf;

  if (leaf !== undefined && options.includeLeafRegion !== false && leaf.regionId !== undefined) {
    add(regionIds, leaf.regionId);
    reasons.push({
      id: "poly-world-bsp-leaf",
      kind: "bspLeaf",
      label: labels.leaf,
      regionIds: [leaf.regionId],
      data: {
        leafId: leaf.id,
        path: resolution?.path ?? [],
      },
    });
  }

  if (leaf !== undefined && options.includePvs !== false) {
    const view = resolvePolyWorldBspViewPvs(tree, {
      ...options,
      leafId: leaf.id,
    });
    for (const regionId of view.regionIds) add(regionIds, regionId);
    for (const linkId of view.linkIds) add(linkIds, linkId);
    for (const selectionKey of view.selectionKeys) add(selectionKeys, selectionKey);
    for (const elementId of view.elementIds) add(elementIds, elementId);
    addLinkSelectionKeys(topology, linkIds, selectionKeys);
    reasons.push({
      id: "poly-world-bsp-view-pvs",
      kind: "viewPvs",
      label: labels.view,
      regionIds: view.regionIds,
      linkIds: view.linkIds,
      selectionKeys: view.selectionKeys,
      data: {
        leafId: view.leafId,
        portalIds: view.portalIds,
        leafIds: view.leafIds,
        clusterIds: view.clusterIds,
        broadPhaseLeafIds: view.broadPhaseLeafIds,
        broadPhasePortalIds: view.broadPhasePortalIds,
        fovDegrees: view.fovDegrees,
      },
    });
  }

  for (const regionId of options.regionIds ?? []) add(regionIds, regionId);
  for (const linkId of options.linkIds ?? []) add(linkIds, linkId);
  for (const selectionKey of options.selectionKeys ?? []) add(selectionKeys, selectionKey);
  for (const elementId of options.elementIds ?? []) add(elementIds, elementId);
  addLinkSelectionKeys(topology, linkIds, selectionKeys);

  if (selectionKeys.length > 0) {
    reasons.push({
      id: "poly-world-bsp-selection-key",
      kind: "selectionKey",
      label: labels.selectionKey,
      selectionKeys,
    });
  }

  return {
    regionIds,
    linkIds,
    selectionKeys,
    elementIds,
    reasons,
    data: {
      ...options.data,
      ...(leaf === undefined ? {} : { leafId: leaf.id }),
    },
  };
}

function resolveSelectionLeaf(
  tree: PolyWorldBspTree,
  options: PolyWorldBspPvsSelectionOptions,
): PolyWorldBspLeafResolution | undefined {
  if (options.leafId !== undefined) {
    const leaf = tree.leavesById.get(options.leafId);
    return leaf === undefined ? undefined : { leaf, leafId: leaf.id, path: [] };
  }
  return options.point === undefined ? undefined : resolvePolyWorldBspLeaf(tree, options.point);
}

function selectBspChild(node: PolyWorldBspNode, point: Vec3): PolyWorldBspChild {
  const signedDistance = dot(node.plane.normal, point) - node.plane.distance;
  const epsilon = node.plane.epsilon ?? 0;
  if (Math.abs(signedDistance) <= epsilon) return node.onPlane === "back" ? node.back : node.front;
  return signedDistance >= 0 ? node.front : node.back;
}

function compileBspChild(
  leaves: readonly PolyWorldBspLeaf[],
  idPrefix: string,
  depth: number,
): PolyWorldBspChild {
  if (leaves.length === 1) return { leafId: leaves[0]?.id ?? "" };
  const split = chooseBspSplit(leaves);
  const normal: Vec3 = [0, 0, 0];
  normal[split.axis] = 1;
  return {
    id: `${idPrefix}-split-${depth}-${axisName(split.axis)}-${formatSplitDistance(split.distance)}-${formatLeafGroupId(leaves)}`,
    plane: { normal, distance: split.distance },
    back: compileBspChild(split.back, idPrefix, depth + 1),
    front: compileBspChild(split.front, idPrefix, depth + 1),
    data: {
      compiled: true,
      axis: axisName(split.axis),
      backLeafIds: split.back.map((leaf) => leaf.id),
      frontLeafIds: split.front.map((leaf) => leaf.id),
    },
  };
}

function chooseBspSplit(leaves: readonly PolyWorldBspLeaf[]): {
  axis: 0 | 1 | 2;
  distance: number;
  back: readonly PolyWorldBspLeaf[];
  front: readonly PolyWorldBspLeaf[];
} {
  let best:
    | {
      axis: 0 | 1 | 2;
      distance: number;
      back: readonly PolyWorldBspLeaf[];
      front: readonly PolyWorldBspLeaf[];
      score: number;
    }
    | undefined;

  for (const axis of [0, 1, 2] as const) {
    const sorted = [...leaves].sort((a, b) =>
      leafCenter(a)[axis] - leafCenter(b)[axis] || a.id.localeCompare(b.id),
    );
    for (let cut = 1; cut < sorted.length; cut += 1) {
      const back = sorted.slice(0, cut);
      const front = sorted.slice(cut);
      const backMax = Math.max(...back.map((leaf) => leafMax(leaf, axis)));
      const frontMin = Math.min(...front.map((leaf) => leafMin(leaf, axis)));
      const backCenter = Math.max(...back.map((leaf) => leafCenter(leaf)[axis]));
      const frontCenter = Math.min(...front.map((leaf) => leafCenter(leaf)[axis]));
      const hasGap = backMax <= frontMin;
      const distance = hasGap ? (backMax + frontMin) / 2 : (backCenter + frontCenter) / 2;
      const overlapPenalty = Math.max(0, backMax - frontMin);
      const balancePenalty = Math.abs(front.length - back.length);
      const extent = Math.max(...sorted.map((leaf) => leafMax(leaf, axis))) -
        Math.min(...sorted.map((leaf) => leafMin(leaf, axis)));
      const score = overlapPenalty * 1000 + balancePenalty * 10 - extent * 0.001 + axis * 0.0001;
      if (best === undefined || score < best.score) {
        best = { axis, distance, back, front, score };
      }
    }
  }

  if (best !== undefined) return best;
  throw new PolyWorldBspError([{
    code: "poly-world-bsp-compile-no-split",
    message: "PolyWorld BSP compiler could not split the supplied regions.",
    kind: "compile",
  }]);
}

function compileBspPortal(
  portal: PolyWorldBspCompilePortal,
  regionsById: ReadonlyMap<string, PolyWorldBspCompileRegion>,
): PolyWorldBspPortal {
  const from = regionsById.get(portal.fromRegionId);
  const to = regionsById.get(portal.toRegionId);
  if (from === undefined || to === undefined) {
    throw new PolyWorldBspError([{
      code: "poly-world-bsp-compile-missing-portal-region",
      message: `PolyWorld BSP compile portal "${portal.id}" references a missing region.`,
      id: portal.id,
      kind: "portal",
    }]);
  }
  const bounds = portal.bounds ?? derivePortalBounds(portal.id, from.bounds, to.bounds);
  const vertices = portal.vertices === undefined
    ? verticesFromPortalBounds(portal.id, bounds)
    : portal.vertices.map((vertex) => [...vertex] as Vec3);
  return {
    id: portal.id,
    fromLeafId: portal.fromRegionId,
    toLeafId: portal.toRegionId,
    linkId: portal.linkId,
    vertices,
    ...(portal.selectionKeys === undefined ? {} : { selectionKeys: [...portal.selectionKeys] }),
    data: {
      ...portal.data,
      compiled: true,
      bounds,
    },
  };
}

function derivePortalBounds(
  portalId: string,
  a: PolyWorldBounds,
  b: PolyWorldBounds,
): PolyWorldBounds {
  const epsilon = 0.0001;
  for (const axis of [0, 1, 2] as const) {
    const aTouchesB = Math.abs(a.max[axis] - b.min[axis]) <= epsilon;
    const bTouchesA = Math.abs(b.max[axis] - a.min[axis]) <= epsilon;
    if (!aTouchesB && !bTouchesA) continue;
    const bounds = cloneBounds({
      min: [0, 0, 0],
      max: [0, 0, 0],
    });
    const plane = aTouchesB ? a.max[axis] : b.max[axis];
    bounds.min[axis] = plane;
    bounds.max[axis] = plane;
    let valid = true;
    for (const otherAxis of [0, 1, 2] as const) {
      if (otherAxis === axis) continue;
      bounds.min[otherAxis] = Math.max(a.min[otherAxis], b.min[otherAxis]);
      bounds.max[otherAxis] = Math.min(a.max[otherAxis], b.max[otherAxis]);
      if (bounds.max[otherAxis] - bounds.min[otherAxis] <= epsilon) valid = false;
    }
    if (valid) return bounds;
  }
  throw new PolyWorldBspError([{
    code: "poly-world-bsp-compile-no-shared-portal-face",
    message: `PolyWorld BSP compile portal "${portalId}" requires bounds or two regions with a shared face.`,
    id: portalId,
    kind: "portal",
  }]);
}

function verticesFromPortalBounds(portalId: string, bounds: PolyWorldBounds): Vec3[] {
  const epsilon = 0.0001;
  const zeroAxes = ([0, 1, 2] as const).filter((axis) => Math.abs(bounds.max[axis] - bounds.min[axis]) <= epsilon);
  if (zeroAxes.length !== 1) {
    throw new PolyWorldBspError([{
      code: "poly-world-bsp-compile-invalid-portal-bounds",
      message: `PolyWorld BSP compile portal "${portalId}" bounds must describe one planar rectangle.`,
      id: portalId,
      field: "bounds",
      kind: "portal",
    }]);
  }
  const planeAxis = zeroAxes[0] ?? 0;
  const axes = ([0, 1, 2] as const).filter((axis) => axis !== planeAxis);
  const a = axes[0] ?? 0;
  const b = axes[1] ?? 1;
  const makePoint = (aa: number, bb: number): Vec3 => {
    const point = [0, 0, 0] as Vec3;
    point[planeAxis] = bounds.min[planeAxis];
    point[a] = aa;
    point[b] = bb;
    return point;
  };
  return [
    makePoint(bounds.min[a], bounds.min[b]),
    makePoint(bounds.max[a], bounds.min[b]),
    makePoint(bounds.max[a], bounds.max[b]),
    makePoint(bounds.min[a], bounds.max[b]),
  ];
}

function normalizeBspPortalVertices(portalId: string, vertices: readonly Vec3[]): Vec3[] {
  const epsilon = 0.0001;
  const uniqueVertices = uniqueVec3(vertices.map((vertex) => [...vertex] as Vec3));
  if (uniqueVertices.length < 3) {
    throw new PolyWorldBspError([{
      code: "poly-world-bsp-portal-too-few-unique-vertices",
      message: `PolyWorld BSP portal "${portalId}" requires at least three unique vertices.`,
      id: portalId,
      field: "vertices",
      kind: "portal",
    }]);
  }

  const plane = resolveBspPortalPlane(portalId, uniqueVertices);
  for (const vertex of uniqueVertices) {
    if (Math.abs(dot(plane.normal, vertex) - plane.distance) > epsilon) {
      throw new PolyWorldBspError([{
        code: "poly-world-bsp-portal-non-coplanar",
        message: `PolyWorld BSP portal "${portalId}" vertices must be coplanar.`,
        id: portalId,
        field: "vertices",
        kind: "portal",
      }]);
    }
  }

  const center = averageVec3(uniqueVertices);
  const tangent = resolveBspPortalTangent(plane.normal, uniqueVertices, center);
  const bitangent = normalizeBspVector(cross(plane.normal, tangent)) ?? [0, 1, 0];
  const sorted = [...uniqueVertices].sort((a, b) => {
    const da = subtractVec3(a, center);
    const db = subtractVec3(b, center);
    return Math.atan2(dot(da, bitangent), dot(da, tangent)) -
      Math.atan2(dot(db, bitangent), dot(db, tangent));
  });
  const areaNormal = polygonAreaNormal(sorted);
  if (dot(areaNormal, plane.normal) < 0) sorted.reverse();
  validateBspPortalConvexity(portalId, sorted, plane.normal);
  return sorted.map((vertex) => [...vertex] as Vec3);
}

function resolveBspPortalPlane(
  portalId: string,
  vertices: readonly Vec3[],
): { normal: Vec3; distance: number } {
  const origin = vertices[0] ?? [0, 0, 0];
  for (let aIndex = 1; aIndex < vertices.length - 1; aIndex += 1) {
    for (let bIndex = aIndex + 1; bIndex < vertices.length; bIndex += 1) {
      const a = subtractVec3(vertices[aIndex] ?? origin, origin);
      const b = subtractVec3(vertices[bIndex] ?? origin, origin);
      const normal = normalizeBspVector(cross(a, b));
      if (normal !== undefined) {
        return {
          normal,
          distance: dot(normal, origin),
        };
      }
    }
  }
  throw new PolyWorldBspError([{
    code: "poly-world-bsp-portal-degenerate-plane",
    message: `PolyWorld BSP portal "${portalId}" vertices must define a non-degenerate plane.`,
    id: portalId,
    field: "vertices",
    kind: "portal",
  }]);
}

function resolveBspPortalTangent(
  normal: Vec3,
  vertices: readonly Vec3[],
  center: Vec3,
): Vec3 {
  for (const vertex of vertices) {
    const direction = subtractVec3(vertex, center);
    const projected = subtractVec3(direction, scaleVec3(normal, dot(direction, normal)));
    const tangent = normalizeBspVector(projected);
    if (tangent !== undefined) return tangent;
  }
  return Math.abs(normal[2]) < 0.9
    ? normalizeBspVector(cross(normal, [0, 0, 1])) ?? [1, 0, 0]
    : normalizeBspVector(cross(normal, [0, 1, 0])) ?? [1, 0, 0];
}

function validateBspPortalConvexity(
  portalId: string,
  vertices: readonly Vec3[],
  normal: Vec3,
): void {
  const epsilon = 0.0001;
  const area = Math.hypot(...polygonAreaNormal(vertices));
  if (area <= epsilon) {
    throw new PolyWorldBspError([{
      code: "poly-world-bsp-portal-degenerate-area",
      message: `PolyWorld BSP portal "${portalId}" vertices must enclose non-zero area.`,
      id: portalId,
      field: "vertices",
      kind: "portal",
    }]);
  }
  for (let index = 0; index < vertices.length; index += 1) {
    const previous = vertices[(index + vertices.length - 1) % vertices.length] ?? vertices[index] ?? [0, 0, 0];
    const current = vertices[index] ?? previous;
    const next = vertices[(index + 1) % vertices.length] ?? current;
    const a = subtractVec3(current, previous);
    const b = subtractVec3(next, current);
    const turn = dot(cross(a, b), normal);
    if (turn < -epsilon) {
      throw new PolyWorldBspError([{
        code: "poly-world-bsp-portal-concave",
        message: `PolyWorld BSP portal "${portalId}" vertices must describe a convex polygon.`,
        id: portalId,
        field: "vertices",
        kind: "portal",
      }]);
    }
  }
}

function traceBspPortalFrustumPvs(
  tree: PolyWorldBspTree,
  currentLeafId: string,
  sourcePoint: Vec3,
  clip: PolyWorldBspPortalClip,
  pathPortalIds: Set<string>,
  visible: {
    leafIds: Set<string>;
    portalIds: Set<string>;
    linkIds: Set<string>;
    selectionKeys: Set<string>;
    elementIds: Set<string>;
    regionIds: Set<string>;
  },
  options: Required<Pick<PolyWorldBspPvsBakeOptions, "projection" | "maxDepth">> & PolyWorldBspPvsBakeOptions,
  depth: number,
  broadPhase?: { leafIds: ReadonlySet<string> },
  traceEntries?: PolyWorldBspViewPvsTraceEntry[],
  leafClips?: Map<string, PolyWorldBspPortalClip[]>,
): void {
  if (depth >= options.maxDepth) {
    for (const portal of tree.portalsByLeafId.get(currentLeafId) ?? []) {
      const nextLeafId = otherPortalLeafId(portal, currentLeafId);
      if (nextLeafId === undefined || pathPortalIds.has(portal.id)) continue;
      addBspViewPvsTraceEntry(traceEntries, portal, currentLeafId, nextLeafId, depth, "depth-capped");
    }
    return;
  }

  for (const portal of tree.portalsByLeafId.get(currentLeafId) ?? []) {
    if (pathPortalIds.has(portal.id)) continue;
    const nextLeafId = otherPortalLeafId(portal, currentLeafId);
    if (nextLeafId === undefined) continue;
    const portalState = resolveBspPortalTraversalState(portal, currentLeafId, nextLeafId, depth, options.portalState);
    if (portalState !== "open") {
      addBspViewPvsTraceEntry(traceEntries, portal, currentLeafId, nextLeafId, depth, portalState);
      continue;
    }
    if (broadPhase !== undefined && !broadPhase.leafIds.has(nextLeafId)) {
      addBspViewPvsTraceEntry(traceEntries, portal, currentLeafId, nextLeafId, depth, "outside-broad-phase");
      continue;
    }
    const nextLeaf = tree.leavesById.get(nextLeafId);
    if (nextLeaf === undefined) {
      addBspViewPvsTraceEntry(traceEntries, portal, currentLeafId, nextLeafId, depth, "missing-target-leaf");
      continue;
    }
    const clippedPortal = clipPolygonByBspPlanes(portal.vertices, clip.planes);
    if (clippedPortal.length < 3) {
      addBspViewPvsTraceEntry(traceEntries, portal, currentLeafId, nextLeafId, depth, "clipped", {
        clippedVertexCount: clippedPortal.length,
      });
      continue;
    }
    const portalPlanes = createBspPortalClipPlanes(sourcePoint, clippedPortal);
    if (portalPlanes.length === 0) {
      addBspViewPvsTraceEntry(traceEntries, portal, currentLeafId, nextLeafId, depth, "degenerate-clip", {
        clippedVertexCount: clippedPortal.length,
      });
      continue;
    }
    const nextClip: PolyWorldBspPortalClip = {
      planes: [...clip.planes, ...portalPlanes],
      origin: clip.origin,
      rays: clippedPortal
        .map((vertex) => normalizeBspVector(subtractVec3(vertex, clip.origin)))
        .filter((ray): ray is Vec3 => ray !== undefined),
    };
    addBspLeafClip(leafClips, nextLeafId, nextClip);
    addBspViewPvsTraceEntry(traceEntries, portal, currentLeafId, nextLeafId, depth, "visible", {
      clippedVertexCount: clippedPortal.length,
      clipPlaneCount: nextClip.planes.length,
    });

    addVisibleLeaf(nextLeaf, visible.leafIds, visible.regionIds, visible.elementIds);
    visible.portalIds.add(portal.id);
    if (portal.linkId !== undefined) visible.linkIds.add(portal.linkId);
    if (options.includePortalSelectionKeys !== false) {
      for (const key of portal.selectionKeys ?? []) visible.selectionKeys.add(key);
    }

    traceBspPortalFrustumPvs(
      tree,
      nextLeafId,
      sourcePoint,
      nextClip,
      new Set([...pathPortalIds, portal.id]),
      visible,
      options,
      depth + 1,
      broadPhase,
      traceEntries,
      leafClips,
    );
  }
}

function addBspLeafClip(
  leafClips: Map<string, PolyWorldBspPortalClip[]> | undefined,
  leafId: string,
  clip: PolyWorldBspPortalClip,
): void {
  if (leafClips === undefined) return;
  const clips = leafClips.get(leafId) ?? [];
  clips.push(clip);
  leafClips.set(leafId, clips);
}

function addBspViewPvsTraceEntry(
  entries: PolyWorldBspViewPvsTraceEntry[] | undefined,
  portal: PolyWorldBspPortal,
  fromLeafId: string,
  toLeafId: string,
  depth: number,
  status: PolyWorldBspViewPvsTraceStatus,
  extra: Pick<PolyWorldBspViewPvsTraceEntry, "clippedVertexCount" | "clipPlaneCount"> = {},
): void {
  if (entries === undefined) return;
  entries.push({
    portalId: portal.id,
    fromLeafId,
    toLeafId,
    depth,
    status,
    inputVertexCount: portal.vertices.length,
    ...extra,
    ...(portal.linkId === undefined ? {} : { linkId: portal.linkId }),
    ...(portal.selectionKeys === undefined ? {} : { selectionKeys: [...portal.selectionKeys] }),
  });
}

function addVisibleLeaf(
  leaf: PolyWorldBspLeaf,
  leafIds: Set<string>,
  regionIds: Set<string>,
  elementIds: Set<string>,
  collectElementIds = true,
): void {
  leafIds.add(leaf.id);
  if (leaf.regionId !== undefined) regionIds.add(leaf.regionId);
  if (collectElementIds) {
    for (const elementId of leaf.elementIds ?? []) elementIds.add(elementId);
  }
}

function resolveBspLeafById(
  tree: PolyWorldBspTree,
  leafId: string,
): PolyWorldBspLeafResolution | undefined {
  const leaf = tree.leavesById.get(leafId);
  return leaf === undefined ? undefined : { leaf, leafId: leaf.id, path: [] };
}

function resolveBspBroadPhasePvs(
  tree: PolyWorldBspTree,
  leaf: PolyWorldBspLeaf,
  options: PolyWorldBspPvsBakeOptions,
): PolyWorldBspResolvedPvs {
  if (leaf.pvs !== undefined && options.portalState === undefined) {
    const baked = resolvePolyWorldBspBakedPvs(tree, leaf.id);
    if (baked !== undefined) return baked;
  }
  return resolvePolyWorldBspPvs(tree, leaf.id, options);
}

function resolveBspLeafSamplePoints(
  leaf: PolyWorldBspLeaf,
  projection: PolyWorldBspPvsProjection,
  options: PolyWorldBspPvsBakeOptions,
): Vec3[] {
  if (leaf.pvsSamplePoints !== undefined && leaf.pvsSamplePoints.length > 0) {
    return leaf.pvsSamplePoints.map((point) => [...point] as Vec3);
  }
  if (leaf.bounds !== undefined) return sampleBounds(leaf.bounds, projection, options.sampleInset ?? 0);
  if (leaf.center !== undefined) return [[...leaf.center] as Vec3];
  throw new PolyWorldBspError([{
    code: "poly-world-bsp-leaf-missing-pvs-samples",
    message: `PolyWorld BSP leaf "${leaf.id}" requires bounds, center, or pvsSamplePoints before baking PVS.`,
    id: leaf.id,
    kind: "leaf",
  }]);
}

function sampleBounds(
  bounds: PolyWorldBounds,
  projection: PolyWorldBspPvsProjection,
  inset: number,
): Vec3[] {
  const center: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const [a, b] = projectionAxes(projection);
  const insetA = Math.min(Math.max(0, inset), (bounds.max[a] - bounds.min[a]) / 2);
  const insetB = Math.min(Math.max(0, inset), (bounds.max[b] - bounds.min[b]) / 2);
  const minA = bounds.min[a] + insetA;
  const maxA = bounds.max[a] - insetA;
  const minB = bounds.min[b] + insetB;
  const maxB = bounds.max[b] - insetB;
  const points = [center];
  for (const aa of [minA, maxA]) {
    for (const bb of [minB, maxB]) {
      const point = [...center] as Vec3;
      point[a] = aa;
      point[b] = bb;
      points.push(point);
    }
  }
  return uniqueVec3(points);
}

function resolveBspViewFovDegrees(value: number | undefined): number {
  const fovDegrees = value ?? 90;
  if (!Number.isFinite(fovDegrees) || fovDegrees <= 0) {
    throw new PolyWorldBspError([{
      code: "poly-world-invalid-bsp-view-pvs-fov",
      message: "PolyWorld BSP view PVS fovDegrees must be a finite number greater than zero.",
      field: "fovDegrees",
      kind: "compile",
    }]);
  }
  return Math.min(fovDegrees, 360);
}

function createBspViewClip(
  origin: Vec3,
  forward: Vec3,
  options: {
    up?: Vec3;
    aspect?: number;
    fovDegrees: number;
    near?: number;
    far?: number;
  },
): PolyWorldBspPortalClip {
  const forwardDirection = normalizeBspVector(forward);
  if (forwardDirection === undefined) {
    throw new PolyWorldBspError([{
      code: "poly-world-invalid-bsp-view-pvs-forward",
      message: "PolyWorld BSP view PVS forward vector must have non-zero length.",
      field: "forward",
      kind: "compile",
    }]);
  }

  const aspect = resolveBspViewAspect(options.aspect);
  const planes: PolyWorldBspClipPlane[] = [];
  const rays: Vec3[] = [forwardDirection];
  const near = options.near ?? 0.001;
  if (near > 0) {
    planes.push({
      normal: forwardDirection,
      distance: dot(forwardDirection, origin) + near,
    });
  }
  if (options.far !== undefined && Number.isFinite(options.far) && options.far > near) {
    const farNormal = scaleVec3(forwardDirection, -1);
    planes.push({
      normal: farNormal,
      distance: dot(farNormal, addVec3(origin, scaleVec3(forwardDirection, options.far))),
    });
  }
  if (options.fovDegrees >= 359.999) {
    return { planes, origin: [...origin] as Vec3, rays };
  }

  const basis = createBspViewBasis(forwardDirection, options.up);
  const halfHorizontal = options.fovDegrees * Math.PI / 360;
  const halfVertical = Math.atan(Math.tan(halfHorizontal) / aspect);
  const horizontal = Math.tan(halfHorizontal);
  const vertical = Math.tan(halfVertical);
  const topLeft = normalizeBspVector(addVec3(addVec3(forwardDirection, scaleVec3(basis.up, vertical)), scaleVec3(basis.right, -horizontal)));
  const topRight = normalizeBspVector(addVec3(addVec3(forwardDirection, scaleVec3(basis.up, vertical)), scaleVec3(basis.right, horizontal)));
  const bottomRight = normalizeBspVector(addVec3(addVec3(forwardDirection, scaleVec3(basis.up, -vertical)), scaleVec3(basis.right, horizontal)));
  const bottomLeft = normalizeBspVector(addVec3(addVec3(forwardDirection, scaleVec3(basis.up, -vertical)), scaleVec3(basis.right, -horizontal)));
  for (const ray of [topLeft, topRight, bottomRight, bottomLeft]) {
    if (ray !== undefined) rays.push(ray);
  }
  for (const plane of [
    createBspRayPlane(origin, topLeft, topRight, forwardDirection),
    createBspRayPlane(origin, topRight, bottomRight, forwardDirection),
    createBspRayPlane(origin, bottomRight, bottomLeft, forwardDirection),
    createBspRayPlane(origin, bottomLeft, topLeft, forwardDirection),
  ]) {
    if (plane !== undefined) planes.push(plane);
  }
  return { planes, origin: [...origin] as Vec3, rays };
}

function surfaceIntersectsBspClip(
  vertices: readonly Vec3[],
  clip: PolyWorldBspPortalClip,
): boolean {
  if (clipPolygonByBspPlanes(vertices, clip.planes).length >= 3) return true;
  return clip.rays.some((ray) => rayIntersectsBspSurfacePolygon(clip.origin, ray, vertices, clip.planes));
}

function rayIntersectsBspSurfacePolygon(
  origin: Vec3,
  ray: Vec3,
  vertices: readonly Vec3[],
  planes: readonly PolyWorldBspClipPlane[],
): boolean {
  if (vertices.length < 3) return false;
  const normal = normalizeBspVector(polygonAreaNormal(vertices));
  if (normal === undefined) return false;
  const denominator = dot(normal, ray);
  if (Math.abs(denominator) <= 0.000001) return false;
  const distance = dot(normal, vertices[0] ?? [0, 0, 0]);
  const t = (distance - dot(normal, origin)) / denominator;
  if (t <= 0.0001) return false;
  const point = addVec3(origin, scaleVec3(ray, t));
  if (!planes.every((plane) => signedBspPlaneDistance(plane, point) >= -0.0001)) return false;
  return pointInConvexBspPolygon(point, vertices, normal);
}

function pointInConvexBspPolygon(point: Vec3, vertices: readonly Vec3[], normal: Vec3): boolean {
  let hasPositive = false;
  let hasNegative = false;
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index] ?? [0, 0, 0];
    const b = vertices[(index + 1) % vertices.length] ?? a;
    const side = dot(cross(subtractVec3(b, a), subtractVec3(point, a)), normal);
    if (side > 0.0001) hasPositive = true;
    if (side < -0.0001) hasNegative = true;
    if (hasPositive && hasNegative) return false;
  }
  return true;
}

function resolveBspViewAspect(value: number | undefined): number {
  if (value === undefined) return 1;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function createBspViewBasis(forward: Vec3, up: Vec3 | undefined): { right: Vec3; up: Vec3 } {
  const worldUp = normalizeBspVector(up ?? [0, 0, 1]) ?? [0, 0, 1];
  let right = normalizeBspVector(cross(forward, worldUp));
  if (right === undefined) right = normalizeBspVector(cross(forward, [0, 1, 0])) ?? [1, 0, 0];
  const viewUp = normalizeBspVector(cross(right, forward)) ?? worldUp;
  return { right, up: viewUp };
}

function createBspRayPlane(
  origin: Vec3,
  a: Vec3 | undefined,
  b: Vec3 | undefined,
  insideDirection: Vec3,
): PolyWorldBspClipPlane | undefined {
  if (a === undefined || b === undefined) return undefined;
  let normal = normalizeBspVector(cross(a, b));
  if (normal === undefined) return undefined;
  if (dot(normal, insideDirection) < 0) normal = scaleVec3(normal, -1);
  return {
    normal,
    distance: dot(normal, origin),
  };
}

function clipPolygonByBspPlanes(
  vertices: readonly Vec3[],
  planes: readonly PolyWorldBspClipPlane[],
): Vec3[] {
  let clipped = vertices.map((vertex) => [...vertex] as Vec3);
  for (const plane of planes) {
    clipped = clipPolygonByBspPlane(clipped, plane);
    if (clipped.length < 3) return [];
  }
  return uniqueVec3(clipped);
}

function clipPolygonByBspPlane(
  vertices: readonly Vec3[],
  plane: PolyWorldBspClipPlane,
): Vec3[] {
  if (vertices.length === 0) return [];
  const clipped: Vec3[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index] ?? [0, 0, 0];
    const next = vertices[(index + 1) % vertices.length] ?? current;
    const currentDistance = signedBspPlaneDistance(plane, current);
    const nextDistance = signedBspPlaneDistance(plane, next);
    const currentInside = currentDistance >= -0.0001;
    const nextInside = nextDistance >= -0.0001;
    if (currentInside && nextInside) {
      clipped.push([...next] as Vec3);
    } else if (currentInside && !nextInside) {
      clipped.push(intersectBspPlaneSegment(current, next, currentDistance, nextDistance));
    } else if (!currentInside && nextInside) {
      clipped.push(intersectBspPlaneSegment(current, next, currentDistance, nextDistance), [...next] as Vec3);
    }
  }
  return clipped;
}

function intersectBspPlaneSegment(a: Vec3, b: Vec3, aDistance: number, bDistance: number): Vec3 {
  const denominator = aDistance - bDistance;
  const t = Math.abs(denominator) <= 0.000001 ? 0 : aDistance / denominator;
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function signedBspPlaneDistance(plane: PolyWorldBspClipPlane, point: Vec3): number {
  return dot(plane.normal, point) - plane.distance;
}

function createBspPortalClipPlanes(origin: Vec3, vertices: readonly Vec3[]): PolyWorldBspClipPlane[] {
  const center = averageVec3(vertices);
  const insideDirection = subtractVec3(center, origin);
  const planes: PolyWorldBspClipPlane[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const a = subtractVec3(vertices[index] ?? center, origin);
    const b = subtractVec3(vertices[(index + 1) % vertices.length] ?? center, origin);
    let normal = normalizeBspVector(cross(a, b));
    if (normal === undefined) continue;
    if (dot(normal, insideDirection) < 0) normal = scaleVec3(normal, -1);
    planes.push({
      normal,
      distance: dot(normal, origin),
    });
  }
  return planes;
}

function resolveBspPortalTraversalState(
  portal: PolyWorldBspPortal,
  fromLeafId: string,
  toLeafId: string,
  depth: number,
  state: PolyWorldBspPortalState | undefined,
): "open" | "closed" | "blocked" {
  if (state === undefined) return "open";
  if (typeof state === "function") {
    return state(portal, { fromLeafId, toLeafId, depth }) ? "open" : "closed";
  }
  const value = state[portal.id] ?? (portal.linkId === undefined ? undefined : state[portal.linkId]);
  if (value === "blocked") return "blocked";
  return value === undefined || value === true || value === "open" ? "open" : "closed";
}

function encodeBspPvs(
  pvs: PolyWorldBspResolvedPvs,
  index: PolyWorldBspPvsIndex,
): PolyWorldBspBakedPvs {
  return {
    leafBits: bitsetFromIds(pvs.leafIds, index.leafIndexById, index.leafIds.length),
    portalBits: bitsetFromIds(pvs.portalIds, index.portalIndexById, index.portalIds.length),
    regionIds: [...pvs.regionIds],
    linkIds: [...pvs.linkIds],
    selectionKeys: [...pvs.selectionKeys],
    elementIds: [...pvs.elementIds],
  };
}

function bitsetFromIds(
  ids: readonly string[],
  indexById: ReadonlyMap<string, number>,
  size: number,
): Uint32Array {
  const bits = new Uint32Array(Math.ceil(size / 32));
  for (const id of ids) {
    const index = indexById.get(id);
    if (index !== undefined) setBit(bits, index);
  }
  return bits;
}

function bitsetIds(ids: readonly string[], bits: Uint32Array): string[] {
  const result: string[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    if (hasBit(bits, index)) result.push(ids[index] ?? "");
  }
  return result.filter((id) => id.length > 0);
}

function clusterIdsForLeafIds(tree: PolyWorldBspTree, leafIds: readonly string[]): string[] {
  const leafIdSet = new Set(leafIds);
  return unique(tree.leaves.flatMap((leaf) =>
    leafIdSet.has(leaf.id) && leaf.clusterId !== undefined ? [leaf.clusterId] : []
  ));
}

function setBit(bits: Uint32Array, index: number): void {
  bits[index >> 5] |= 1 << (index & 31);
}

function hasBit(bits: Uint32Array, index: number): boolean {
  return (bits[index >> 5] & (1 << (index & 31))) !== 0;
}

function projectionAxes(projection: PolyWorldBspPvsProjection): readonly [0 | 1 | 2, 0 | 1 | 2] {
  switch (projection) {
    case "xy":
      return [0, 1];
    case "xz":
      return [0, 2];
    case "yz":
      return [1, 2];
  }
}

function otherPortalLeafId(portal: PolyWorldBspPortal, leafId: string): string | undefined {
  if (portal.fromLeafId === leafId) return portal.toLeafId;
  if (portal.toLeafId === leafId) return portal.fromLeafId;
  return undefined;
}

function cloneBspChild(child: PolyWorldBspChild): PolyWorldBspChild {
  if (isBspLeafRef(child)) return { ...child };
  return {
    ...child,
    plane: {
      ...child.plane,
      normal: [...child.plane.normal] as Vec3,
    },
    front: cloneBspChild(child.front),
    back: cloneBspChild(child.back),
  };
}

function cloneBspLeaf(leaf: PolyWorldBspLeaf): PolyWorldBspLeaf {
  return {
    ...leaf,
    ...(leaf.bounds === undefined ? {} : {
      bounds: {
        min: [...leaf.bounds.min] as Vec3,
        max: [...leaf.bounds.max] as Vec3,
      },
    }),
    ...(leaf.center === undefined ? {} : { center: [...leaf.center] as Vec3 }),
    ...(leaf.pvsSamplePoints === undefined ? {} : {
      pvsSamplePoints: leaf.pvsSamplePoints.map((point) => [...point] as Vec3),
    }),
    ...(leaf.pvs === undefined ? {} : { pvs: cloneBspBakedPvs(leaf.pvs) }),
    ...(leaf.elementIds === undefined ? {} : { elementIds: [...leaf.elementIds] }),
  };
}

function cloneBspBakedPvs(pvs: PolyWorldBspBakedPvs): PolyWorldBspBakedPvs {
  return {
    leafBits: new Uint32Array(pvs.leafBits),
    portalBits: new Uint32Array(pvs.portalBits),
    regionIds: [...pvs.regionIds],
    linkIds: [...pvs.linkIds],
    selectionKeys: [...pvs.selectionKeys],
    elementIds: [...pvs.elementIds],
  };
}

function cloneBspPvsIndex(index: PolyWorldBspPvsIndex): PolyWorldBspPvsIndex {
  return {
    leafIds: [...index.leafIds],
    portalIds: [...index.portalIds],
    leafIndexById: new Map(index.leafIndexById),
    portalIndexById: new Map(index.portalIndexById),
  };
}

function cloneBspPortal(portal: PolyWorldBspPortal): PolyWorldBspPortal {
  return {
    ...portal,
    vertices: normalizeBspPortalVertices(portal.id, portal.vertices),
    ...(portal.selectionKeys === undefined ? {} : { selectionKeys: [...portal.selectionKeys] }),
  };
}

function cloneBounds(bounds: PolyWorldBounds): PolyWorldBounds {
  return {
    min: [...bounds.min] as Vec3,
    max: [...bounds.max] as Vec3,
  };
}

function isBspLeafRef(child: PolyWorldBspChild): child is PolyWorldBspLeafRef {
  return "leafId" in child;
}

function addLinkSelectionKeys(
  topology: PolyWorldTopology,
  linkIds: readonly string[],
  selectionKeys: string[],
): void {
  for (const linkId of linkIds) {
    const link = topology.linksById.get(linkId);
    for (const selectionKey of link?.selectionKeys ?? []) add(selectionKeys, selectionKey);
  }
}

function validateBspChild(
  child: PolyWorldBspChild,
  leafIds: ReadonlySet<string>,
  nodeIds: Set<string>,
  diagnostics: PolyWorldBspDiagnostic[],
  rootLeafIds: Set<string>,
  rootLeafRefCounts: Map<string, number>,
): void {
  if (isBspLeafRef(child)) {
    if (typeof child.leafId !== "string" || child.leafId.length === 0) {
      diagnostics.push({
        code: "poly-world-empty-bsp-leaf-ref",
        message: "PolyWorld BSP leaf reference requires a non-empty leafId.",
        field: "leafId",
        kind: "leaf",
      });
      return;
    }
    rootLeafIds.add(child.leafId);
    rootLeafRefCounts.set(child.leafId, (rootLeafRefCounts.get(child.leafId) ?? 0) + 1);
    if (!leafIds.has(child.leafId)) {
      diagnostics.push({
        code: "poly-world-missing-bsp-leaf-ref",
        message: `PolyWorld BSP leaf reference points to missing leaf "${child.leafId}".`,
        id: child.leafId,
        field: "leafId",
        kind: "leaf",
      });
    }
    return;
  }

  validateId("node", child.id, diagnostics);
  if (child.id && nodeIds.has(child.id)) {
    diagnostics.push({
      code: "poly-world-duplicate-bsp-node-id",
      message: `Duplicate PolyWorld BSP node id "${child.id}".`,
      id: child.id,
      field: "id",
      kind: "node",
    });
  }
  if (child.id) nodeIds.add(child.id);
  validatePlane(child.id, child.plane, diagnostics);
  if (child.onPlane !== undefined && child.onPlane !== "front" && child.onPlane !== "back") {
    diagnostics.push({
      code: "poly-world-invalid-bsp-node-on-plane",
      message: `PolyWorld BSP node "${child.id}" has invalid onPlane value "${String(child.onPlane)}".`,
      id: child.id,
      field: "onPlane",
      kind: "node",
    });
  }
  validateBspChild(child.front, leafIds, nodeIds, diagnostics, rootLeafIds, rootLeafRefCounts);
  validateBspChild(child.back, leafIds, nodeIds, diagnostics, rootLeafIds, rootLeafRefCounts);
}

function validateBspRootLeafReferences(
  leafIds: ReadonlySet<string>,
  rootLeafIds: ReadonlySet<string>,
  rootLeafRefCounts: ReadonlyMap<string, number>,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  for (const leafId of leafIds) {
    if (rootLeafIds.has(leafId)) continue;
    diagnostics.push({
      code: "poly-world-unreferenced-bsp-leaf",
      message: `PolyWorld BSP leaf "${leafId}" is not referenced by the BSP root tree.`,
      id: leafId,
      field: "root",
      kind: "leaf",
    });
  }

  for (const [leafId, count] of rootLeafRefCounts) {
    if (count <= 1 || !leafIds.has(leafId)) continue;
    diagnostics.push({
      code: "poly-world-duplicate-bsp-leaf-ref",
      message: `PolyWorld BSP leaf "${leafId}" is referenced ${count} times by the BSP root tree.`,
      id: leafId,
      field: "root",
      kind: "leaf",
    });
  }
}

function collectReachableBspLeafIds(
  rootLeafIds: ReadonlySet<string>,
  portals: readonly PolyWorldBspPortal[],
): Set<string> {
  const reachable = new Set(rootLeafIds);
  const portalLeafIds = new Map<string, string[]>();
  for (const portal of portals) {
    pushMap(portalLeafIds, portal.fromLeafId, portal.toLeafId);
    pushMap(portalLeafIds, portal.toLeafId, portal.fromLeafId);
  }

  const queue = [...rootLeafIds];
  while (queue.length > 0) {
    const leafId = queue.shift();
    if (leafId === undefined) continue;
    for (const nextLeafId of portalLeafIds.get(leafId) ?? []) {
      if (reachable.has(nextLeafId)) continue;
      reachable.add(nextLeafId);
      queue.push(nextLeafId);
    }
  }
  return reachable;
}

function validateBspPvsIndex(
  index: PolyWorldBspPvsIndex,
  leafIds: ReadonlySet<string>,
  portalIds: ReadonlySet<string>,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  const indexedLeafIds = new Set<string>();
  for (let position = 0; position < index.leafIds.length; position += 1) {
    const leafId = index.leafIds[position] ?? "";
    if (typeof leafId !== "string" || leafId.length === 0) {
      diagnostics.push({
        code: "poly-world-empty-bsp-pvs-index-leaf-id",
        message: "PolyWorld BSP pvsIndex leafIds must contain only non-empty strings.",
        field: "pvsIndex.leafIds",
        kind: "tree",
      });
      continue;
    }
    if (indexedLeafIds.has(leafId)) {
      diagnostics.push({
        code: "poly-world-duplicate-bsp-pvs-index-leaf-id",
        message: `Duplicate PolyWorld BSP pvsIndex leaf id "${leafId}".`,
        id: leafId,
        field: "pvsIndex.leafIds",
        kind: "leaf",
      });
    }
    indexedLeafIds.add(leafId);
    if (!leafIds.has(leafId)) {
      diagnostics.push({
        code: "poly-world-missing-bsp-pvs-index-leaf",
        message: `PolyWorld BSP pvsIndex references missing leaf "${leafId}".`,
        id: leafId,
        field: "pvsIndex.leafIds",
        kind: "leaf",
      });
    }
    if (index.leafIndexById.get(leafId) !== position) {
      diagnostics.push({
        code: "poly-world-invalid-bsp-pvs-index-leaf-map",
        message: `PolyWorld BSP pvsIndex leafIndexById must map "${leafId}" to index ${position}.`,
        id: leafId,
        field: "pvsIndex.leafIndexById",
        kind: "leaf",
      });
    }
  }

  for (const leafId of leafIds) {
    if (indexedLeafIds.has(leafId)) continue;
    diagnostics.push({
      code: "poly-world-missing-bsp-pvs-index-leaf",
      message: `PolyWorld BSP pvsIndex is missing leaf "${leafId}".`,
      id: leafId,
      field: "pvsIndex.leafIds",
      kind: "leaf",
    });
  }

  for (const [leafId, position] of index.leafIndexById) {
    if (indexedLeafIds.has(leafId) && index.leafIds[position] === leafId) continue;
    diagnostics.push({
      code: "poly-world-invalid-bsp-pvs-index-leaf-map",
      message: `PolyWorld BSP pvsIndex leafIndexById has a stale entry for "${leafId}".`,
      id: leafId,
      field: "pvsIndex.leafIndexById",
      kind: "leaf",
    });
  }

  const indexedPortalIds = new Set<string>();
  for (let position = 0; position < index.portalIds.length; position += 1) {
    const portalId = index.portalIds[position] ?? "";
    if (typeof portalId !== "string" || portalId.length === 0) {
      diagnostics.push({
        code: "poly-world-empty-bsp-pvs-index-portal-id",
        message: "PolyWorld BSP pvsIndex portalIds must contain only non-empty strings.",
        field: "pvsIndex.portalIds",
        kind: "tree",
      });
      continue;
    }
    if (indexedPortalIds.has(portalId)) {
      diagnostics.push({
        code: "poly-world-duplicate-bsp-pvs-index-portal-id",
        message: `Duplicate PolyWorld BSP pvsIndex portal id "${portalId}".`,
        id: portalId,
        field: "pvsIndex.portalIds",
        kind: "portal",
      });
    }
    indexedPortalIds.add(portalId);
    if (!portalIds.has(portalId)) {
      diagnostics.push({
        code: "poly-world-missing-bsp-pvs-index-portal",
        message: `PolyWorld BSP pvsIndex references missing portal "${portalId}".`,
        id: portalId,
        field: "pvsIndex.portalIds",
        kind: "portal",
      });
    }
    if (index.portalIndexById.get(portalId) !== position) {
      diagnostics.push({
        code: "poly-world-invalid-bsp-pvs-index-portal-map",
        message: `PolyWorld BSP pvsIndex portalIndexById must map "${portalId}" to index ${position}.`,
        id: portalId,
        field: "pvsIndex.portalIndexById",
        kind: "portal",
      });
    }
  }

  for (const portalId of portalIds) {
    if (indexedPortalIds.has(portalId)) continue;
    diagnostics.push({
      code: "poly-world-missing-bsp-pvs-index-portal",
      message: `PolyWorld BSP pvsIndex is missing portal "${portalId}".`,
      id: portalId,
      field: "pvsIndex.portalIds",
      kind: "portal",
    });
  }

  for (const [portalId, position] of index.portalIndexById) {
    if (indexedPortalIds.has(portalId) && index.portalIds[position] === portalId) continue;
    diagnostics.push({
      code: "poly-world-invalid-bsp-pvs-index-portal-map",
      message: `PolyWorld BSP pvsIndex portalIndexById has a stale entry for "${portalId}".`,
      id: portalId,
      field: "pvsIndex.portalIndexById",
      kind: "portal",
    });
  }
}

function validateBspBakedPvsIndex(
  leafId: string,
  pvs: PolyWorldBspBakedPvs | undefined,
  index: PolyWorldBspPvsIndex,
  leaves: readonly PolyWorldBspLeaf[],
  portals: readonly PolyWorldBspPortal[],
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  if (pvs === undefined) return;
  if (pvs.leafBits instanceof Uint32Array && pvs.leafBits.length !== bitsetLength(index.leafIds.length)) {
    diagnostics.push({
      code: "poly-world-invalid-bsp-pvs-leaf-bits-length",
      message: `PolyWorld BSP leaf "${leafId}" pvs.leafBits length must match pvsIndex.leafIds.`,
      id: leafId,
      field: "pvs.leafBits",
      kind: "leaf",
    });
  }
  if (pvs.portalBits instanceof Uint32Array && pvs.portalBits.length !== bitsetLength(index.portalIds.length)) {
    diagnostics.push({
      code: "poly-world-invalid-bsp-pvs-portal-bits-length",
      message: `PolyWorld BSP leaf "${leafId}" pvs.portalBits length must match pvsIndex.portalIds.`,
      id: leafId,
      field: "pvs.portalBits",
      kind: "leaf",
    });
  }
  if (!(pvs.leafBits instanceof Uint32Array) || !(pvs.portalBits instanceof Uint32Array)) return;
  if (pvs.leafBits.length !== bitsetLength(index.leafIds.length)) return;
  if (pvs.portalBits.length !== bitsetLength(index.portalIds.length)) return;

  const decodedLeafIds = bitsetIds(index.leafIds, pvs.leafBits);
  const decodedPortalIds = bitsetIds(index.portalIds, pvs.portalBits);
  const decodedLeafIdSet = new Set(decodedLeafIds);
  const decodedPortalIdSet = new Set(decodedPortalIds);
  validateBspBakedPvsReachability(leafId, decodedLeafIdSet, decodedPortalIdSet, portals, diagnostics);
  validateBspPvsMetadataList(
    leafId,
    "regionIds",
    pvs.regionIds,
    unique(leaves.flatMap((leaf) =>
      decodedLeafIdSet.has(leaf.id) && leaf.regionId !== undefined ? [leaf.regionId] : []
    )),
    diagnostics,
  );
  validateBspPvsMetadataList(
    leafId,
    "linkIds",
    pvs.linkIds,
    unique(portals.flatMap((portal) =>
      decodedPortalIdSet.has(portal.id) && portal.linkId !== undefined ? [portal.linkId] : []
    )),
    diagnostics,
  );
  validateBspPvsMetadataList(
    leafId,
    "selectionKeys",
    pvs.selectionKeys,
    unique(portals.flatMap((portal) =>
      decodedPortalIdSet.has(portal.id) ? [...(portal.selectionKeys ?? [])] : []
    )),
    diagnostics,
  );
  validateBspPvsMetadataList(
    leafId,
    "elementIds",
    pvs.elementIds,
    unique(leaves.flatMap((leaf) =>
      decodedLeafIdSet.has(leaf.id) ? [...(leaf.elementIds ?? [])] : []
    )),
    diagnostics,
  );
}

function validateBspBakedPvsReachability(
  leafId: string,
  decodedLeafIds: ReadonlySet<string>,
  decodedPortalIds: ReadonlySet<string>,
  portals: readonly PolyWorldBspPortal[],
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  if (!decodedLeafIds.has(leafId)) {
    diagnostics.push({
      code: "poly-world-bsp-pvs-missing-source-leaf",
      message: `PolyWorld BSP leaf "${leafId}" pvs.leafBits must include its source leaf.`,
      id: leafId,
      field: "pvs.leafBits",
      kind: "leaf",
    });
  }

  for (const portal of portals) {
    const adjacentLeafId = portal.fromLeafId === leafId
      ? portal.toLeafId
      : portal.toLeafId === leafId
        ? portal.fromLeafId
        : undefined;
    if (adjacentLeafId === undefined) continue;
    if (!decodedPortalIds.has(portal.id)) {
      diagnostics.push({
        code: "poly-world-bsp-pvs-missing-adjacent-portal",
        message: `PolyWorld BSP leaf "${leafId}" pvs.portalBits must include directly adjacent portal "${portal.id}".`,
        id: leafId,
        field: "pvs.portalBits",
        kind: "leaf",
      });
    }
    if (!decodedLeafIds.has(adjacentLeafId)) {
      diagnostics.push({
        code: "poly-world-bsp-pvs-missing-adjacent-leaf",
        message: `PolyWorld BSP leaf "${leafId}" pvs.leafBits must include directly adjacent leaf "${adjacentLeafId}".`,
        id: leafId,
        field: "pvs.leafBits",
        kind: "leaf",
      });
    }
  }

  const decodedPortals = portals.filter((portal) => decodedPortalIds.has(portal.id));
  for (const portal of decodedPortals) {
    if (decodedLeafIds.has(portal.fromLeafId) && decodedLeafIds.has(portal.toLeafId)) continue;
    diagnostics.push({
      code: "poly-world-bsp-pvs-portal-outside-leaf-set",
      message: `PolyWorld BSP leaf "${leafId}" pvs.portalBits include portal "${portal.id}" outside pvs.leafBits.`,
      id: leafId,
      field: "pvs.portalBits",
      kind: "leaf",
    });
  }

  const reachable = collectReachableBspLeafIds(new Set([leafId]), decodedPortals);
  for (const decodedLeafId of decodedLeafIds) {
    if (reachable.has(decodedLeafId)) continue;
    diagnostics.push({
      code: "poly-world-bsp-pvs-unreachable-leaf",
      message: `PolyWorld BSP leaf "${leafId}" pvs.leafBits include unreachable leaf "${decodedLeafId}".`,
      id: leafId,
      field: "pvs.leafBits",
      kind: "leaf",
    });
  }
}

function bitsetLength(size: number): number {
  return Math.ceil(size / 32);
}

function validateBspPvsMetadataList(
  leafId: string,
  field: "regionIds" | "linkIds" | "selectionKeys" | "elementIds",
  actual: readonly string[],
  expected: readonly string[],
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  if (sameStringList(actual, expected)) return;
  diagnostics.push({
    code: `poly-world-bsp-pvs-${bspPvsMetadataCodeField(field)}-metadata-mismatch`,
    message: `PolyWorld BSP leaf "${leafId}" pvs.${field} must match decoded PVS bitsets.`,
    id: leafId,
    field: `pvs.${field}`,
    kind: "leaf",
  });
}

function bspPvsMetadataCodeField(field: "regionIds" | "linkIds" | "selectionKeys" | "elementIds"): string {
  switch (field) {
    case "regionIds":
      return "region-ids";
    case "linkIds":
      return "link-ids";
    case "selectionKeys":
      return "selection-keys";
    case "elementIds":
      return "element-ids";
  }
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function validatePlane(
  nodeId: string,
  plane: PolyWorldBspPlane,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  validateVec3("node", nodeId, "plane.normal", plane.normal, diagnostics);
  if (!isFiniteNumber(plane.distance)) {
    diagnostics.push({
      code: "poly-world-invalid-bsp-plane-distance",
      message: `PolyWorld BSP node "${nodeId}" requires a finite plane distance.`,
      id: nodeId,
      field: "plane.distance",
      kind: "node",
    });
  }
  if (plane.epsilon !== undefined && (!isFiniteNumber(plane.epsilon) || plane.epsilon < 0)) {
    diagnostics.push({
      code: "poly-world-invalid-bsp-plane-epsilon",
      message: `PolyWorld BSP node "${nodeId}" requires a finite non-negative plane epsilon.`,
      id: nodeId,
      field: "plane.epsilon",
      kind: "node",
    });
  }
  if (Array.isArray(plane.normal) && plane.normal.length === 3 && plane.normal.every(isFiniteNumber)) {
    const lengthSq = dot(plane.normal, plane.normal);
    if (lengthSq <= 0) {
      diagnostics.push({
        code: "poly-world-zero-bsp-plane-normal",
        message: `PolyWorld BSP node "${nodeId}" plane normal cannot be zero.`,
        id: nodeId,
        field: "plane.normal",
        kind: "node",
      });
    }
  }
}

function validatePortalLeaf(
  portal: PolyWorldBspPortal,
  field: "fromLeafId" | "toLeafId",
  leafIds: ReadonlySet<string>,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  const leafId = portal[field];
  if (typeof leafId !== "string" || leafId.length === 0) {
    diagnostics.push({
      code: "poly-world-empty-bsp-portal-leaf",
      message: `PolyWorld BSP portal "${portal.id}" requires a non-empty ${field}.`,
      id: portal.id,
      field,
      kind: "portal",
    });
    return;
  }
  if (!leafIds.has(leafId)) {
    diagnostics.push({
      code: "poly-world-missing-bsp-portal-leaf",
      message: `PolyWorld BSP portal "${portal.id}" references missing leaf "${leafId}".`,
      id: portal.id,
      field,
      kind: "portal",
    });
  }
}

function validateBspPortalAdjacency(
  portal: PolyWorldBspPortal,
  leavesById: ReadonlyMap<string, PolyWorldBspLeaf>,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  const fromLeaf = leavesById.get(portal.fromLeafId);
  const toLeaf = leavesById.get(portal.toLeafId);
  if (fromLeaf === undefined || toLeaf === undefined) return;

  validateBspPortalTargetLeaf(portal, fromLeaf, "fromLeafId", diagnostics);
  validateBspPortalTargetLeaf(portal, toLeaf, "toLeafId", diagnostics);
  if (fromLeaf.bounds !== undefined) {
    validateBspPortalVerticesInsideLeafBounds(portal, fromLeaf, "fromLeafId", diagnostics);
  }
  if (toLeaf.bounds !== undefined) {
    validateBspPortalVerticesInsideLeafBounds(portal, toLeaf, "toLeafId", diagnostics);
  }
  if (fromLeaf.bounds !== undefined && toLeaf.bounds !== undefined) {
    validateBspPortalSharedBoundsFace(portal, fromLeaf, toLeaf, diagnostics);
  }
}

function validateBspPortalTargetLeaf(
  portal: PolyWorldBspPortal,
  leaf: PolyWorldBspLeaf,
  field: "fromLeafId" | "toLeafId",
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  if (leaf.data?.solid === true) {
    diagnostics.push({
      code: "poly-world-bsp-portal-solid-leaf",
      message: `PolyWorld BSP portal "${portal.id}" cannot connect to solid leaf "${leaf.id}".`,
      id: portal.id,
      field,
      kind: "portal",
    });
  }
  if (leaf.data?.outside === true) {
    diagnostics.push({
      code: "poly-world-bsp-portal-outside-leaf",
      message: `PolyWorld BSP portal "${portal.id}" cannot connect to outside leaf "${leaf.id}".`,
      id: portal.id,
      field,
      kind: "portal",
    });
  }
}

function validateBspPortalVerticesInsideLeafBounds(
  portal: PolyWorldBspPortal,
  leaf: PolyWorldBspLeaf,
  field: "fromLeafId" | "toLeafId",
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  const bounds = leaf.bounds;
  if (bounds === undefined) return;
  if (portal.vertices.every((vertex) => boundsContainsPoint(bounds, vertex))) return;
  diagnostics.push({
    code: "poly-world-bsp-portal-vertices-outside-leaf-bounds",
    message: `PolyWorld BSP portal "${portal.id}" vertices must fit inside leaf "${leaf.id}" bounds.`,
    id: portal.id,
    field,
    kind: "portal",
  });
}

function validateBspPortalSharedBoundsFace(
  portal: PolyWorldBspPortal,
  fromLeaf: PolyWorldBspLeaf,
  toLeaf: PolyWorldBspLeaf,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  if (fromLeaf.bounds === undefined || toLeaf.bounds === undefined) return;
  const sharedFace = sharedBoundsFace(fromLeaf.bounds, toLeaf.bounds);
  if (sharedFace === undefined) return;
  if (portal.vertices.every((vertex) => Math.abs(vertex[sharedFace.axis] - sharedFace.distance) <= 0.0001)) return;
  diagnostics.push({
    code: "poly-world-bsp-portal-not-on-shared-bounds-face",
    message: `PolyWorld BSP portal "${portal.id}" vertices must lie on the shared bounds face between leaves "${fromLeaf.id}" and "${toLeaf.id}".`,
    id: portal.id,
    field: "vertices",
    kind: "portal",
  });
}

function sharedBoundsFace(
  a: PolyWorldBounds,
  b: PolyWorldBounds,
): { axis: 0 | 1 | 2; distance: number } | undefined {
  for (const axis of [0, 1, 2] as const) {
    if (Math.abs(a.max[axis] - b.min[axis]) <= 0.0001) {
      return { axis, distance: (a.max[axis] + b.min[axis]) / 2 };
    }
    if (Math.abs(b.max[axis] - a.min[axis]) <= 0.0001) {
      return { axis, distance: (b.max[axis] + a.min[axis]) / 2 };
    }
  }
  return undefined;
}

function boundsContainsPoint(bounds: PolyWorldBounds, point: Vec3): boolean {
  return point.every((value, axis) =>
    value >= bounds.min[axis] - 0.0001 && value <= bounds.max[axis] + 0.0001
  );
}

function validateCompilePortalRegion(
  portal: PolyWorldBspCompilePortal,
  field: "fromRegionId" | "toRegionId",
  regionIds: ReadonlySet<string>,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  const regionId = portal[field];
  if (typeof regionId !== "string" || regionId.length === 0) {
    diagnostics.push({
      code: "poly-world-empty-bsp-compile-portal-region",
      message: `PolyWorld BSP compile portal "${portal.id}" requires a non-empty ${field}.`,
      id: portal.id,
      field,
      kind: "portal",
    });
    return;
  }
  if (!regionIds.has(regionId)) {
    diagnostics.push({
      code: "poly-world-missing-bsp-compile-portal-region",
      message: `PolyWorld BSP compile portal "${portal.id}" references missing region "${regionId}".`,
      id: portal.id,
      field,
      kind: "portal",
    });
  }
}

function validateId(
  kind: "node" | "leaf" | "portal" | "region",
  id: string,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  if (typeof id !== "string" || id.length === 0) {
    diagnostics.push({
      code: `poly-world-empty-bsp-${kind}-id`,
      message: `PolyWorld BSP ${kind} requires a non-empty id.`,
      field: "id",
      kind,
    });
  }
}

function validateBounds(
  kind: "leaf" | "portal" | "region",
  id: string,
  bounds: PolyWorldBounds | undefined,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  if (bounds === undefined) return;
  validateVec3(kind, id, "bounds.min", bounds.min, diagnostics);
  validateVec3(kind, id, "bounds.max", bounds.max, diagnostics);
  if (
    Array.isArray(bounds.min) &&
    Array.isArray(bounds.max) &&
    bounds.min.length === 3 &&
    bounds.max.length === 3 &&
    bounds.min.every(isFiniteNumber) &&
    bounds.max.every(isFiniteNumber)
  ) {
    for (let axis = 0; axis < 3; axis += 1) {
      if ((bounds.min[axis] ?? 0) > (bounds.max[axis] ?? 0)) {
        diagnostics.push({
          code: "poly-world-invalid-bsp-leaf-bounds",
          message: `PolyWorld BSP leaf "${id}" bounds.min must be <= bounds.max on every axis.`,
          id,
          field: "bounds",
          kind,
        });
        return;
      }
    }
  }
}

function validateVec3Array(
  kind: "leaf" | "portal" | "region",
  id: string,
  field: string,
  values: readonly Vec3[] | undefined,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  if (values === undefined) return;
  if (!Array.isArray(values)) {
    diagnostics.push({
      code: "poly-world-invalid-bsp-vec3-array",
      message: `PolyWorld BSP ${kind} "${id}" ${field} must be an array.`,
      id,
      field,
      kind,
    });
    return;
  }
  values.forEach((value, index) => validateVec3(kind, id, `${field}.${index}`, value, diagnostics));
}

function isValidVec3Array(values: readonly Vec3[]): boolean {
  return Array.isArray(values) && values.every((value) =>
    Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)
  );
}

function validateVec3(
  kind: "node" | "leaf" | "portal" | "region",
  id: string,
  field: string,
  value: Vec3 | undefined,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) {
    diagnostics.push({
      code: "poly-world-invalid-bsp-vec3",
      message: `PolyWorld BSP ${kind} "${id}" ${field} must be a finite Vec3.`,
      id,
      field,
      kind,
    });
  }
}

function validateStringArray(
  kind: "leaf" | "portal" | "region",
  id: string,
  field: string,
  values: readonly string[] | undefined,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  if (values === undefined) return;
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) {
    diagnostics.push({
      code: "poly-world-invalid-bsp-string-array",
      message: `PolyWorld BSP ${kind} "${id}" ${field} must contain only non-empty strings.`,
      id,
      field,
      kind,
    });
  }
}

function validateOptionalString(
  kind: "leaf" | "region",
  id: string,
  field: string,
  value: string | undefined,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push({
      code: "poly-world-invalid-bsp-string",
      message: `PolyWorld BSP ${kind} "${id}" ${field} must be a non-empty string.`,
      id,
      field,
      kind,
    });
  }
}

function validateBspBakedPvs(
  leafId: string,
  pvs: PolyWorldBspBakedPvs | undefined,
  diagnostics: PolyWorldBspDiagnostic[],
): void {
  if (pvs === undefined) return;
  if (!(pvs.leafBits instanceof Uint32Array)) {
    diagnostics.push({
      code: "poly-world-invalid-bsp-pvs-leaf-bits",
      message: `PolyWorld BSP leaf "${leafId}" pvs.leafBits must be a Uint32Array.`,
      id: leafId,
      field: "pvs.leafBits",
      kind: "leaf",
    });
  }
  if (!(pvs.portalBits instanceof Uint32Array)) {
    diagnostics.push({
      code: "poly-world-invalid-bsp-pvs-portal-bits",
      message: `PolyWorld BSP leaf "${leafId}" pvs.portalBits must be a Uint32Array.`,
      id: leafId,
      field: "pvs.portalBits",
      kind: "leaf",
    });
  }
  validateStringArray("leaf", leafId, "pvs.regionIds", pvs.regionIds, diagnostics);
  validateStringArray("leaf", leafId, "pvs.linkIds", pvs.linkIds, diagnostics);
  validateStringArray("leaf", leafId, "pvs.selectionKeys", pvs.selectionKeys, diagnostics);
  validateStringArray("leaf", leafId, "pvs.elementIds", pvs.elementIds, diagnostics);
}

function pushMap<TKey, TValue>(map: Map<TKey, TValue[]>, key: TKey, value: TValue): void {
  const values = map.get(key);
  if (values === undefined) {
    map.set(key, [value]);
    return;
  }
  values.push(value);
}

function add(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])];
}

function leafCenter(leaf: PolyWorldBspLeaf): Vec3 {
  if (leaf.center !== undefined) return leaf.center;
  if (leaf.bounds !== undefined) return boundsCenter(leaf.bounds);
  return [0, 0, 0];
}

function boundsCenter(bounds: PolyWorldBounds): Vec3 {
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

function leafMin(leaf: PolyWorldBspLeaf, axis: 0 | 1 | 2): number {
  return leaf.bounds?.min[axis] ?? leafCenter(leaf)[axis];
}

function leafMax(leaf: PolyWorldBspLeaf, axis: 0 | 1 | 2): number {
  return leaf.bounds?.max[axis] ?? leafCenter(leaf)[axis];
}

function axisName(axis: 0 | 1 | 2): "x" | "y" | "z" {
  return axis === 0 ? "x" : axis === 1 ? "y" : "z";
}

function formatSplitDistance(distance: number): string {
  return String(Math.round(distance * 1000) / 1000).replace("-", "neg-").replace(".", "p");
}

function formatLeafGroupId(leaves: readonly PolyWorldBspLeaf[]): string {
  return leaves
    .map((leaf) => leaf.id)
    .sort()
    .join("-")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
