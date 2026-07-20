import type { Vec3 } from "@layoutit/polycss-core";

export type PolyWorldData = Record<string, unknown>;
export type PolyWorldRegionMatch = "any" | "all";
export type PolyWorldLinkDirection = "bidirectional" | "forward";
export type PolyWorldElementMatchKind = "region" | "selectionKey" | "elementId" | "sourceId" | "alias";
export type PolyWorldElementRelationKind = "parent" | "container";
export type PolyWorldElementPurpose = "render" | "collision" | "occluder" | "portal" | "chunk" | "debug" | "proxy";
export type PolyWorldSelectionKeyOwnerKind = "region" | "link" | "element";
export type PolyWorldSpatialElementRole = "root" | "shell" | "opening" | "detail" | "prop";
export type PolyWorldSpatialElementVisibility = "structural" | "detail";

export interface PolyWorldBounds {
  min: Vec3;
  max: Vec3;
}

export interface PolyWorldElementTransform {
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  matrix?: readonly number[];
}

export interface PolyWorldRegion {
  id: string;
  kind?: string;
  bounds?: PolyWorldBounds;
  center?: Vec3;
  selectionKeys?: readonly string[];
  sourceId?: string;
  aliases?: readonly string[];
  tags?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldLink {
  id: string;
  fromRegionId: string;
  toRegionId: string;
  direction?: PolyWorldLinkDirection;
  kind?: string;
  selectionKeys?: readonly string[];
  sourceId?: string;
  aliases?: readonly string[];
  tags?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldElement {
  id: string;
  kind?: string;
  path?: string;
  parentId?: string;
  containerId?: string;
  bounds?: PolyWorldBounds;
  transform?: PolyWorldElementTransform;
  purposes?: readonly PolyWorldElementPurpose[];
  resourceIds?: readonly string[];
  regionIds?: readonly string[];
  regionMatch?: PolyWorldRegionMatch;
  selectionKeys?: readonly string[];
  sourceIds?: readonly string[];
  aliases?: readonly string[];
  layers?: readonly string[];
  tags?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldSpatialElement {
  id: string;
  elementId?: string;
  regionId?: string;
  leafId?: string;
  bounds?: PolyWorldBounds;
  vertices?: readonly Vec3[];
  role?: PolyWorldSpatialElementRole;
  visibility?: PolyWorldSpatialElementVisibility;
  resourceIds?: readonly string[];
  sourceId?: string;
  aliases?: readonly string[];
  tags?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldSelectionReason {
  id?: string;
  label: string;
  kind?: string;
  regionIds?: readonly string[];
  linkIds?: readonly string[];
  selectionKeys?: readonly string[];
  elementIds?: readonly string[];
  sourceIds?: readonly string[];
  aliases?: readonly string[];
  tags?: readonly string[];
  data?: PolyWorldData;
}

export interface PolyWorldSelection {
  regionIds?: readonly string[];
  linkIds?: readonly string[];
  selectionKeys?: readonly string[];
  elementIds?: readonly string[];
  sourceIds?: readonly string[];
  aliases?: readonly string[];
  reasons?: readonly PolyWorldSelectionReason[];
  data?: PolyWorldData;
}

export interface PolyWorldTopologyValidationOptions {
  strict?: boolean;
  requireRegionSpatialReference?: boolean;
  requireRegionBounds?: boolean;
  requireConnectedRegions?: boolean;
  requireElementLayers?: boolean;
}

export interface PolyWorldTopologyInput {
  regions: readonly PolyWorldRegion[];
  links?: readonly PolyWorldLink[];
  elements?: readonly PolyWorldElement[];
  spatialElements?: readonly PolyWorldSpatialElement[];
  validation?: PolyWorldTopologyValidationOptions;
  data?: PolyWorldData;
}

export interface PolyWorldTopology {
  regions: readonly PolyWorldRegion[];
  links: readonly PolyWorldLink[];
  elements: readonly PolyWorldElement[];
  spatialElements: readonly PolyWorldSpatialElement[];
  data?: PolyWorldData;
  regionsById: ReadonlyMap<string, PolyWorldRegion>;
  linksById: ReadonlyMap<string, PolyWorldLink>;
  elementsById: ReadonlyMap<string, PolyWorldElement>;
  elementsByPath: ReadonlyMap<string, PolyWorldElement>;
  spatialElementsById: ReadonlyMap<string, PolyWorldSpatialElement>;
  spatialElementsByElementId: ReadonlyMap<string, readonly PolyWorldSpatialElement[]>;
  spatialElementsByRegionId: ReadonlyMap<string, readonly PolyWorldSpatialElement[]>;
  spatialElementsByLeafId: ReadonlyMap<string, readonly PolyWorldSpatialElement[]>;
  spatialElementsByRole: ReadonlyMap<PolyWorldSpatialElementRole, readonly PolyWorldSpatialElement[]>;
  spatialElementsByVisibility: ReadonlyMap<PolyWorldSpatialElementVisibility, readonly PolyWorldSpatialElement[]>;
  spatialElementsByResourceId: ReadonlyMap<string, readonly PolyWorldSpatialElement[]>;
  linksByRegionId: ReadonlyMap<string, readonly PolyWorldLink[]>;
  elementsByRegionId: ReadonlyMap<string, readonly PolyWorldElement[]>;
  elementsBySelectionKey: ReadonlyMap<string, readonly PolyWorldElement[]>;
  selectionKeyOwnersByKey: ReadonlyMap<string, readonly PolyWorldSelectionKeyOwner[]>;
  elementsBySourceId: ReadonlyMap<string, readonly PolyWorldElement[]>;
  elementsByAlias: ReadonlyMap<string, readonly PolyWorldElement[]>;
  elementsByPurpose: ReadonlyMap<PolyWorldElementPurpose, readonly PolyWorldElement[]>;
  elementsByResourceId: ReadonlyMap<string, readonly PolyWorldElement[]>;
  elementsByLayer: ReadonlyMap<string, readonly PolyWorldElement[]>;
  elementsByTag: ReadonlyMap<string, readonly PolyWorldElement[]>;
  elementsByParentId: ReadonlyMap<string, readonly PolyWorldElement[]>;
  elementsByContainerId: ReadonlyMap<string, readonly PolyWorldElement[]>;
}

export interface PolyWorldSelectionKeyOwner {
  kind: PolyWorldSelectionKeyOwnerKind;
  id: string;
}

export interface PolyWorldValidationDiagnostic {
  code: string;
  message: string;
  id?: string;
  field?: string;
  kind?: "topology" | "region" | "link" | "element" | "spatialElement";
}

export interface PolyWorldElementResolutionOptions {
  layers?: readonly string[];
  tags?: readonly string[];
}

export interface PolyWorldElementRelationExpansionOptions {
  includeParents?: boolean;
  includeContainers?: boolean;
  recursive?: boolean;
}

export interface PolyWorldElementRelation {
  kind: PolyWorldElementRelationKind;
  elementId: string;
  relatedElementId: string;
  depth: number;
}

export interface PolyWorldMissingElementRelation {
  kind: PolyWorldElementRelationKind;
  elementId: string;
  relatedElementId: string;
  depth: number;
}

export interface PolyWorldElementRelationExpansion {
  seedElementIds: readonly string[];
  elementIds: readonly string[];
  relatedElementIds: readonly string[];
  parentElementIds: readonly string[];
  containerElementIds: readonly string[];
  missingElementIds: readonly string[];
  missingRelations: readonly PolyWorldMissingElementRelation[];
  relations: readonly PolyWorldElementRelation[];
}

export interface PolyWorldSelectionElementRelationExpansionOptions extends PolyWorldElementRelationExpansionOptions {
  resolutionOptions?: PolyWorldElementResolutionOptions;
  reasonLabel?: string;
  reasonKind?: string;
}

export interface PolyWorldElementMatch {
  kind: PolyWorldElementMatchKind;
  value: string;
}

export interface PolyWorldResolvedElement {
  element: PolyWorldElement;
  elementId: string;
  matches: readonly PolyWorldElementMatch[];
}

export interface PolyWorldUnresolvedSelection {
  regionIds: readonly string[];
  linkIds: readonly string[];
  selectionKeys: readonly string[];
  elementIds: readonly string[];
  sourceIds: readonly string[];
  aliases: readonly string[];
}

export interface PolyWorldElementResolution {
  elements: readonly PolyWorldElement[];
  elementIds: readonly string[];
  resolved: readonly PolyWorldResolvedElement[];
  unresolved: PolyWorldUnresolvedSelection;
  selectedRegionIds: readonly string[];
  selectedLinkIds: readonly string[];
  selectedSelectionKeys: readonly string[];
  selectedElementIds: readonly string[];
  selectedSourceIds: readonly string[];
  selectedAliases: readonly string[];
}

export interface PolyWorldRegionResolution {
  region: PolyWorldRegion;
  regionId: string;
  reason: "bounds" | "nearest";
  distanceSq?: number;
}

export interface PolyWorldRegionResolverOptions {
  regionIds?: readonly string[];
  nearest?: boolean;
}
