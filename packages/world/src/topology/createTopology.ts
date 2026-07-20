import type {
  PolyWorldBounds,
  PolyWorldLink,
  PolyWorldElement,
  PolyWorldElementPurpose,
  PolyWorldRegion,
  PolyWorldSelectionKeyOwner,
  PolyWorldSpatialElement,
  PolyWorldSpatialElementRole,
  PolyWorldSpatialElementVisibility,
  PolyWorldTopology,
  PolyWorldTopologyInput,
  PolyWorldValidationDiagnostic,
} from "./types";

export class PolyWorldTopologyError extends Error {
  readonly diagnostics: readonly PolyWorldValidationDiagnostic[];

  constructor(diagnostics: readonly PolyWorldValidationDiagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
    this.name = "PolyWorldTopologyError";
    this.diagnostics = diagnostics;
  }
}

export function validatePolyWorldTopology(input: PolyWorldTopologyInput): PolyWorldValidationDiagnostic[] {
  const diagnostics: PolyWorldValidationDiagnostic[] = [];
  const regions = input.regions ?? [];
  const links = input.links ?? [];
  const elements = input.elements ?? [];
  const spatialElements = input.spatialElements ?? [];
  const regionIds = new Set<string>();
  const linkIds = new Set<string>();
  const elementIds = new Set<string>();
  const elementPaths = new Set<string>();
  const spatialElementIds = new Set<string>();

  if (regions.length === 0) {
    diagnostics.push({
      code: "poly-world-empty-regions",
      message: "PolyWorld topology requires at least one region.",
      field: "regions",
      kind: "topology",
    });
  }

  for (const region of regions) {
    validateId("region", region.id, diagnostics);
    if (region.id && regionIds.has(region.id)) {
      diagnostics.push({
        code: "poly-world-duplicate-region-id",
        message: `Duplicate PolyWorld region id "${region.id}".`,
        id: region.id,
        field: "id",
        kind: "region",
      });
    }
    if (region.id) regionIds.add(region.id);
    validateStringArray("region", region.id, "selectionKeys", region.selectionKeys, diagnostics);
    validateStringArray("region", region.id, "aliases", region.aliases, diagnostics);
    validateStringArray("region", region.id, "tags", region.tags, diagnostics);
    validateVec3("region", region.id, "center", region.center, diagnostics);
    validateBounds("region", region.id, region.bounds, diagnostics);
  }

  for (const link of links) {
    validateId("link", link.id, diagnostics);
    if (link.id && linkIds.has(link.id)) {
      diagnostics.push({
        code: "poly-world-duplicate-link-id",
        message: `Duplicate PolyWorld link id "${link.id}".`,
        id: link.id,
        field: "id",
        kind: "link",
      });
    }
    if (link.id) linkIds.add(link.id);
    validateLinkEndpoint(link, "fromRegionId", regionIds, diagnostics);
    validateLinkEndpoint(link, "toRegionId", regionIds, diagnostics);
    if (link.direction !== undefined && link.direction !== "bidirectional" && link.direction !== "forward") {
      diagnostics.push({
        code: "poly-world-invalid-link-direction",
        message: `PolyWorld link "${link.id}" has invalid direction "${String(link.direction)}".`,
        id: link.id,
        field: "direction",
        kind: "link",
      });
    }
    validateStringArray("link", link.id, "selectionKeys", link.selectionKeys, diagnostics);
    validateStringArray("link", link.id, "aliases", link.aliases, diagnostics);
    validateStringArray("link", link.id, "tags", link.tags, diagnostics);
  }

  for (const element of elements) {
    validateId("element", element.id, diagnostics);
    if (element.id && elementIds.has(element.id)) {
      diagnostics.push({
        code: "poly-world-duplicate-element-id",
        message: `Duplicate PolyWorld element id "${element.id}".`,
        id: element.id,
        field: "id",
        kind: "element",
      });
    }
    if (element.id) elementIds.add(element.id);
    validateElementPath(element, elementPaths, diagnostics);
  }

  for (const spatialElement of spatialElements) {
    validateId("spatialElement", spatialElement.id, diagnostics);
    if (spatialElement.id && spatialElementIds.has(spatialElement.id)) {
      diagnostics.push({
        code: "poly-world-duplicate-spatial-element-id",
        message: `Duplicate PolyWorld spatial element id "${spatialElement.id}".`,
        id: spatialElement.id,
        field: "id",
        kind: "spatialElement",
      });
    }
    if (spatialElement.id) spatialElementIds.add(spatialElement.id);
  }

  for (const element of elements) {
    validateElementReferences(element, regionIds, diagnostics);
    validateElementGraph(element, diagnostics);
    validateElementRelation(element, "parentId", elementIds, diagnostics);
    validateElementRelation(element, "containerId", elementIds, diagnostics);
    validateStringArray("element", element.id, "selectionKeys", element.selectionKeys, diagnostics);
    validateStringArray("element", element.id, "sourceIds", element.sourceIds, diagnostics);
    validateStringArray("element", element.id, "aliases", element.aliases, diagnostics);
    validateStringArray("element", element.id, "resourceIds", element.resourceIds, diagnostics);
    validateStringArray("element", element.id, "layers", element.layers, diagnostics);
    validateStringArray("element", element.id, "tags", element.tags, diagnostics);
  }

  for (const spatialElement of spatialElements) {
    validateSpatialElementReferences(spatialElement, regionIds, elementIds, diagnostics);
    validateSpatialElementGeometry(spatialElement, diagnostics);
    validateStringArray("spatialElement", spatialElement.id, "resourceIds", spatialElement.resourceIds, diagnostics);
    validateStringArray("spatialElement", spatialElement.id, "aliases", spatialElement.aliases, diagnostics);
    validateStringArray("spatialElement", spatialElement.id, "tags", spatialElement.tags, diagnostics);
  }

  validateElementRelationCycles(elements, "parentId", diagnostics);
  validateElementRelationCycles(elements, "containerId", diagnostics);
  validateStrictTopology(input, regionIds, diagnostics);

  return diagnostics;
}

export function createPolyWorldTopology(input: PolyWorldTopologyInput): PolyWorldTopology {
  const diagnostics = validatePolyWorldTopology(input);
  if (diagnostics.length > 0) {
    throw new PolyWorldTopologyError(diagnostics);
  }

  const regions = input.regions.map((region) => normalizeRegion(region));
  const links = (input.links ?? []).map((link) => ({ ...link }));
  const elements = (input.elements ?? []).map((element) => normalizeElement(element));
  const spatialElements = (input.spatialElements ?? []).map((spatialElement) => normalizeSpatialElement(spatialElement));
  const regionsById = new Map<string, PolyWorldRegion>();
  const linksById = new Map<string, PolyWorldLink>();
  const elementsById = new Map<string, PolyWorldElement>();
  const elementsByPath = new Map<string, PolyWorldElement>();
  const spatialElementsById = new Map<string, PolyWorldSpatialElement>();
  const spatialElementsByElementId = new Map<string, PolyWorldSpatialElement[]>();
  const spatialElementsByRegionId = new Map<string, PolyWorldSpatialElement[]>();
  const spatialElementsByLeafId = new Map<string, PolyWorldSpatialElement[]>();
  const spatialElementsByRole = new Map<PolyWorldSpatialElementRole, PolyWorldSpatialElement[]>();
  const spatialElementsByVisibility = new Map<PolyWorldSpatialElementVisibility, PolyWorldSpatialElement[]>();
  const spatialElementsByResourceId = new Map<string, PolyWorldSpatialElement[]>();
  const linksByRegionId = new Map<string, PolyWorldLink[]>();
  const elementsByRegionId = new Map<string, PolyWorldElement[]>();
  const elementsBySelectionKey = new Map<string, PolyWorldElement[]>();
  const selectionKeyOwnersByKey = new Map<string, PolyWorldSelectionKeyOwner[]>();
  const elementsBySourceId = new Map<string, PolyWorldElement[]>();
  const elementsByAlias = new Map<string, PolyWorldElement[]>();
  const elementsByPurpose = new Map<PolyWorldElementPurpose, PolyWorldElement[]>();
  const elementsByResourceId = new Map<string, PolyWorldElement[]>();
  const elementsByLayer = new Map<string, PolyWorldElement[]>();
  const elementsByTag = new Map<string, PolyWorldElement[]>();
  const elementsByParentId = new Map<string, PolyWorldElement[]>();
  const elementsByContainerId = new Map<string, PolyWorldElement[]>();

  for (const region of regions) {
    regionsById.set(region.id, region);
    for (const key of region.selectionKeys ?? []) {
      pushMap(selectionKeyOwnersByKey, key, { kind: "region", id: region.id });
    }
  }

  for (const link of links) {
    linksById.set(link.id, link);
    pushMap(linksByRegionId, link.fromRegionId, link);
    pushMap(linksByRegionId, link.toRegionId, link);
    for (const key of link.selectionKeys ?? []) {
      pushMap(selectionKeyOwnersByKey, key, { kind: "link", id: link.id });
    }
  }

  for (const element of elements) {
    elementsById.set(element.id, element);
    if (element.path !== undefined) elementsByPath.set(element.path, element);
    for (const regionId of element.regionIds ?? []) pushMap(elementsByRegionId, regionId, element);
    for (const key of element.selectionKeys ?? []) {
      pushMap(elementsBySelectionKey, key, element);
      pushMap(selectionKeyOwnersByKey, key, { kind: "element", id: element.id });
    }
    for (const sourceId of element.sourceIds ?? []) pushMap(elementsBySourceId, sourceId, element);
    for (const alias of element.aliases ?? []) pushMap(elementsByAlias, alias, element);
    for (const purpose of element.purposes ?? []) pushMap(elementsByPurpose, purpose, element);
    for (const resourceId of element.resourceIds ?? []) pushMap(elementsByResourceId, resourceId, element);
    for (const layer of element.layers ?? []) pushMap(elementsByLayer, layer, element);
    for (const tag of element.tags ?? []) pushMap(elementsByTag, tag, element);
    if (element.parentId !== undefined) pushMap(elementsByParentId, element.parentId, element);
    if (element.containerId !== undefined) pushMap(elementsByContainerId, element.containerId, element);
  }

  for (const spatialElement of spatialElements) {
    spatialElementsById.set(spatialElement.id, spatialElement);
    if (spatialElement.elementId !== undefined) {
      pushMap(spatialElementsByElementId, spatialElement.elementId, spatialElement);
    }
    if (spatialElement.regionId !== undefined) {
      pushMap(spatialElementsByRegionId, spatialElement.regionId, spatialElement);
    }
    if (spatialElement.leafId !== undefined) {
      pushMap(spatialElementsByLeafId, spatialElement.leafId, spatialElement);
    }
    if (spatialElement.role !== undefined) {
      pushMap(spatialElementsByRole, spatialElement.role, spatialElement);
    }
    if (spatialElement.visibility !== undefined) {
      pushMap(spatialElementsByVisibility, spatialElement.visibility, spatialElement);
    }
    for (const resourceId of spatialElement.resourceIds ?? []) {
      pushMap(spatialElementsByResourceId, resourceId, spatialElement);
    }
  }

  return {
    regions,
    links,
    elements,
    spatialElements,
    data: input.data,
    regionsById,
    linksById,
    elementsById,
    elementsByPath,
    spatialElementsById,
    spatialElementsByElementId,
    spatialElementsByRegionId,
    spatialElementsByLeafId,
    spatialElementsByRole,
    spatialElementsByVisibility,
    spatialElementsByResourceId,
    linksByRegionId,
    elementsByRegionId,
    elementsBySelectionKey,
    selectionKeyOwnersByKey,
    elementsBySourceId,
    elementsByAlias,
    elementsByPurpose,
    elementsByResourceId,
    elementsByLayer,
    elementsByTag,
    elementsByParentId,
    elementsByContainerId,
  };
}

function validateId(
  kind: "region" | "link" | "element" | "spatialElement",
  id: string,
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  if (typeof id !== "string" || id.length === 0) {
    diagnostics.push({
      code: `poly-world-empty-${kind}-id`,
      message: `PolyWorld ${kind} requires a non-empty id.`,
      field: "id",
      kind,
    });
  }
}

function validateSpatialElementReferences(
  spatialElement: PolyWorldSpatialElement,
  regionIds: ReadonlySet<string>,
  elementIds: ReadonlySet<string>,
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  if (
    spatialElement.elementId === undefined &&
    spatialElement.regionId === undefined &&
    spatialElement.leafId === undefined
  ) {
    diagnostics.push({
      code: "poly-world-missing-spatial-element-reference",
      message: `PolyWorld spatial element "${spatialElement.id}" requires elementId, regionId, or leafId.`,
      id: spatialElement.id,
      kind: "spatialElement",
    });
  }

  if (
    spatialElement.elementId !== undefined &&
    (typeof spatialElement.elementId !== "string" || spatialElement.elementId.length === 0)
  ) {
    diagnostics.push({
      code: "poly-world-empty-spatial-element-reference",
      message: `PolyWorld spatial element "${spatialElement.id}" has an empty elementId.`,
      id: spatialElement.id,
      field: "elementId",
      kind: "spatialElement",
    });
  } else if (spatialElement.elementId !== undefined && !elementIds.has(spatialElement.elementId)) {
    diagnostics.push({
      code: "poly-world-missing-spatial-element-element",
      message: `PolyWorld spatial element "${spatialElement.id}" references missing element "${spatialElement.elementId}".`,
      id: spatialElement.id,
      field: "elementId",
      kind: "spatialElement",
    });
  }

  if (
    spatialElement.regionId !== undefined &&
    (typeof spatialElement.regionId !== "string" || spatialElement.regionId.length === 0)
  ) {
    diagnostics.push({
      code: "poly-world-empty-spatial-element-reference",
      message: `PolyWorld spatial element "${spatialElement.id}" has an empty regionId.`,
      id: spatialElement.id,
      field: "regionId",
      kind: "spatialElement",
    });
  } else if (spatialElement.regionId !== undefined && !regionIds.has(spatialElement.regionId)) {
    diagnostics.push({
      code: "poly-world-missing-spatial-element-region",
      message: `PolyWorld spatial element "${spatialElement.id}" references missing region "${spatialElement.regionId}".`,
      id: spatialElement.id,
      field: "regionId",
      kind: "spatialElement",
    });
  }

  if (
    spatialElement.leafId !== undefined &&
    (typeof spatialElement.leafId !== "string" || spatialElement.leafId.length === 0)
  ) {
    diagnostics.push({
      code: "poly-world-empty-spatial-element-reference",
      message: `PolyWorld spatial element "${spatialElement.id}" has an empty leafId.`,
      id: spatialElement.id,
      field: "leafId",
      kind: "spatialElement",
    });
  }

  if (
    spatialElement.role !== undefined &&
    spatialElement.role !== "root" &&
    spatialElement.role !== "shell" &&
    spatialElement.role !== "opening" &&
    spatialElement.role !== "detail" &&
    spatialElement.role !== "prop"
  ) {
    diagnostics.push({
      code: "poly-world-invalid-spatial-element-role",
      message: `PolyWorld spatial element "${spatialElement.id}" has invalid role "${String(spatialElement.role)}".`,
      id: spatialElement.id,
      field: "role",
      kind: "spatialElement",
    });
  }

  if (
    spatialElement.visibility !== undefined &&
    spatialElement.visibility !== "structural" &&
    spatialElement.visibility !== "detail"
  ) {
    diagnostics.push({
      code: "poly-world-invalid-spatial-element-visibility",
      message: `PolyWorld spatial element "${spatialElement.id}" has invalid visibility "${String(spatialElement.visibility)}".`,
      id: spatialElement.id,
      field: "visibility",
      kind: "spatialElement",
    });
  }
}

function validateSpatialElementGeometry(
  spatialElement: PolyWorldSpatialElement,
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  validateBounds("spatialElement", spatialElement.id, spatialElement.bounds, diagnostics);
  if (spatialElement.vertices === undefined) return;
  if (spatialElement.vertices.length < 3) {
    diagnostics.push({
      code: "poly-world-invalid-spatial-element-polygon",
      message: `PolyWorld spatial element "${spatialElement.id}" vertices must contain at least three points.`,
      id: spatialElement.id,
      field: "vertices",
      kind: "spatialElement",
    });
    return;
  }
  for (let index = 0; index < spatialElement.vertices.length; index += 1) {
    validateVec3("spatialElement", spatialElement.id, `vertices.${index}`, spatialElement.vertices[index], diagnostics);
  }
  if (!spatialElement.vertices.every(isFiniteVec3)) return;
  const plane = polygonPlane(spatialElement.vertices);
  if (plane === undefined) {
    diagnostics.push({
      code: "poly-world-degenerate-spatial-element-polygon",
      message: `PolyWorld spatial element "${spatialElement.id}" vertices must form a non-degenerate polygon.`,
      id: spatialElement.id,
      field: "vertices",
      kind: "spatialElement",
    });
    return;
  }
  if (!spatialElement.vertices.every((vertex) => Math.abs(dot(plane.normal, vertex) - plane.distance) <= 0.0001)) {
    diagnostics.push({
      code: "poly-world-non-coplanar-spatial-element-polygon",
      message: `PolyWorld spatial element "${spatialElement.id}" vertices must be coplanar.`,
      id: spatialElement.id,
      field: "vertices",
      kind: "spatialElement",
    });
  }
}

function validateLinkEndpoint(
  link: PolyWorldLink,
  field: "fromRegionId" | "toRegionId",
  regionIds: ReadonlySet<string>,
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  const regionId = link[field];
  if (typeof regionId !== "string" || regionId.length === 0) {
    diagnostics.push({
      code: "poly-world-empty-link-endpoint",
      message: `PolyWorld link "${link.id}" requires a non-empty ${field}.`,
      id: link.id,
      field,
      kind: "link",
    });
    return;
  }
  if (!regionIds.has(regionId)) {
    diagnostics.push({
      code: "poly-world-missing-link-region",
      message: `PolyWorld link "${link.id}" references missing region "${regionId}".`,
      id: link.id,
      field,
      kind: "link",
    });
  }
}

function validateElementPath(
  element: PolyWorldElement,
  elementPaths: Set<string>,
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  if (element.path === undefined) return;
  if (typeof element.path !== "string" || element.path.length === 0) {
    diagnostics.push({
      code: "poly-world-empty-element-path",
      message: `PolyWorld element "${element.id}" has an empty path.`,
      id: element.id,
      field: "path",
      kind: "element",
    });
    return;
  }
  if (!element.path.startsWith("/")) {
    diagnostics.push({
      code: "poly-world-invalid-element-path",
      message: `PolyWorld element "${element.id}" path must start with "/".`,
      id: element.id,
      field: "path",
      kind: "element",
    });
  }
  if (elementPaths.has(element.path)) {
    diagnostics.push({
      code: "poly-world-duplicate-element-path",
      message: `Duplicate PolyWorld element path "${element.path}".`,
      id: element.id,
      field: "path",
      kind: "element",
    });
  }
  elementPaths.add(element.path);
}

function validateElementGraph(
  element: PolyWorldElement,
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  validateBounds("element", element.id, element.bounds, diagnostics);
  validateElementTransform(element, diagnostics);
  validateElementPurposes(element, diagnostics);
}

function validateElementTransform(
  element: PolyWorldElement,
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  if (element.transform === undefined) return;
  validateVec3("element", element.id, "transform.position", element.transform.position, diagnostics);
  validateVec3("element", element.id, "transform.rotation", element.transform.rotation, diagnostics);
  validateVec3("element", element.id, "transform.scale", element.transform.scale, diagnostics);
  if (element.transform.matrix === undefined) return;
  if (element.transform.matrix.length !== 16 || element.transform.matrix.some((value) => !Number.isFinite(value))) {
    diagnostics.push({
      code: "poly-world-invalid-element-transform-matrix",
      message: `PolyWorld element "${element.id}" transform.matrix must contain 16 finite numbers.`,
      id: element.id,
      field: "transform.matrix",
      kind: "element",
    });
  }
}

function validateElementPurposes(
  element: PolyWorldElement,
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  validateStringArray("element", element.id, "purposes", element.purposes, diagnostics);
  const purposes = element.purposes ?? [];
  const validPurposes = new Set(["render", "collision", "occluder", "portal", "chunk", "debug", "proxy"]);
  for (const purpose of purposes) {
    if (!validPurposes.has(purpose)) {
      diagnostics.push({
        code: "poly-world-invalid-element-purpose",
        message: `PolyWorld element "${element.id}" has invalid purpose "${String(purpose)}".`,
        id: element.id,
        field: "purposes",
        kind: "element",
      });
    }
  }
  if (purposes.includes("proxy") && purposes.includes("render")) {
    diagnostics.push({
      code: "poly-world-conflicting-element-purposes",
      message: `PolyWorld element "${element.id}" cannot be both proxy and render purpose; use separate elements so traversal gates stay explicit.`,
      id: element.id,
      field: "purposes",
      kind: "element",
    });
  }
}

function validateElementReferences(
  element: PolyWorldElement,
  regionIds: ReadonlySet<string>,
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  const hasRegionIds = element.regionIds !== undefined;
  const hasSelectionKeys = element.selectionKeys !== undefined;
  const hasSourceIds = element.sourceIds !== undefined;
  const hasAliases = element.aliases !== undefined;

  if (!hasRegionIds && !hasSelectionKeys && !hasSourceIds && !hasAliases) {
    diagnostics.push({
      code: "poly-world-missing-element-reference",
      message: `PolyWorld element "${element.id}" requires regionIds, selectionKeys, sourceIds, or aliases.`,
      id: element.id,
      kind: "element",
    });
  }

  validateStringArray("element", element.id, "regionIds", element.regionIds, diagnostics);
  for (const regionId of element.regionIds ?? []) {
    if (!regionIds.has(regionId)) {
      diagnostics.push({
        code: "poly-world-missing-element-region",
        message: `PolyWorld element "${element.id}" references missing region "${regionId}".`,
        id: element.id,
        field: "regionIds",
        kind: "element",
      });
    }
  }

  if (
    element.regionMatch !== undefined &&
    element.regionMatch !== "any" &&
    element.regionMatch !== "all"
  ) {
    diagnostics.push({
      code: "poly-world-invalid-region-match",
      message: `PolyWorld element "${element.id}" has invalid regionMatch "${String(element.regionMatch)}".`,
      id: element.id,
      field: "regionMatch",
      kind: "element",
    });
  }

  if ((element.regionIds?.length ?? 0) > 1 && element.regionMatch === undefined) {
    diagnostics.push({
      code: "poly-world-ambiguous-region-match",
      message: `PolyWorld element "${element.id}" spans multiple regions and must declare regionMatch.`,
      id: element.id,
      field: "regionMatch",
      kind: "element",
    });
  }
}

function validateElementRelation(
  element: PolyWorldElement,
  field: "parentId" | "containerId",
  elementIds: ReadonlySet<string>,
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  const relatedElementId = element[field];
  if (relatedElementId === undefined) return;
  if (typeof relatedElementId !== "string" || relatedElementId.length === 0) {
    diagnostics.push({
      code: "poly-world-empty-element-relation",
      message: `PolyWorld element "${element.id}" has an empty ${field}.`,
      id: element.id,
      field,
      kind: "element",
    });
    return;
  }
  if (relatedElementId === element.id) {
    diagnostics.push({
      code: "poly-world-self-element-relation",
      message: `PolyWorld element "${element.id}" cannot reference itself as ${field}.`,
      id: element.id,
      field,
      kind: "element",
    });
    return;
  }
  if (!elementIds.has(relatedElementId)) {
    diagnostics.push({
      code: "poly-world-missing-element-relation",
      message: `PolyWorld element "${element.id}" ${field} references missing element "${relatedElementId}".`,
      id: element.id,
      field,
      kind: "element",
    });
  }
}

function validateElementRelationCycles(
  elements: readonly PolyWorldElement[],
  field: "parentId" | "containerId",
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  const elementsById = new Map(elements.map((element) => [element.id, element]));

  for (const element of elements) {
    const path: string[] = [];
    let current: PolyWorldElement | undefined = element;

    while (current !== undefined) {
      if (path.includes(current.id)) {
        const cycle = [...path.slice(path.indexOf(current.id)), current.id];
        diagnostics.push({
          code: "poly-world-element-relation-cycle",
          message: `PolyWorld element "${element.id}" has a ${field} cycle: ${cycle.join(" -> ")}.`,
          id: element.id,
          field,
          kind: "element",
        });
        break;
      }

      path.push(current.id);
      const nextId = current[field];
      if (nextId === undefined || nextId === current.id) break;
      current = elementsById.get(nextId);
    }
  }
}

function validateStrictTopology(
  input: PolyWorldTopologyInput,
  regionIds: ReadonlySet<string>,
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  const validation = input.validation;
  const strict = validation?.strict === true;
  const requireRegionSpatialReference = validation?.requireRegionSpatialReference ?? strict;
  const requireRegionBounds = validation?.requireRegionBounds ?? false;
  const requireConnectedRegions = validation?.requireConnectedRegions ?? strict;
  const requireElementLayers = validation?.requireElementLayers ?? strict;

  if (requireRegionSpatialReference) {
    validateRegionSpatialReferences(input.regions, diagnostics);
  }
  if (requireRegionBounds) {
    validateRegionBoundsRequired(input.regions, diagnostics);
  }
  if (requireConnectedRegions) {
    validateRegionConnectivity(input.regions, input.links ?? [], regionIds, diagnostics);
  }
  if (requireElementLayers) {
    validateElementLayersRequired(input.elements ?? [], diagnostics);
  }
}

function validateRegionSpatialReferences(
  regions: readonly PolyWorldRegion[],
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  for (const region of regions) {
    if (region.bounds !== undefined || region.center !== undefined) continue;
    diagnostics.push({
      code: "poly-world-missing-region-spatial-reference",
      message: `PolyWorld region "${region.id}" requires bounds or center in strict topology validation.`,
      id: region.id,
      field: "bounds",
      kind: "region",
    });
  }
}

function validateRegionBoundsRequired(
  regions: readonly PolyWorldRegion[],
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  for (const region of regions) {
    if (region.bounds !== undefined) continue;
    diagnostics.push({
      code: "poly-world-missing-region-bounds",
      message: `PolyWorld region "${region.id}" requires bounds when requireRegionBounds is enabled.`,
      id: region.id,
      field: "bounds",
      kind: "region",
    });
  }
}

function validateRegionConnectivity(
  regions: readonly PolyWorldRegion[],
  links: readonly PolyWorldLink[],
  regionIds: ReadonlySet<string>,
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  const firstRegionId = regions.find((region) => typeof region.id === "string" && region.id.length > 0)?.id;
  if (firstRegionId === undefined || regionIds.size <= 1) return;

  const linkedRegionIds = new Map<string, Set<string>>();
  for (const link of links) {
    if (!regionIds.has(link.fromRegionId) || !regionIds.has(link.toRegionId)) continue;
    addLinkedRegion(linkedRegionIds, link.fromRegionId, link.toRegionId);
    addLinkedRegion(linkedRegionIds, link.toRegionId, link.fromRegionId);
  }

  const visited = new Set<string>();
  const queue = [firstRegionId];
  while (queue.length > 0) {
    const regionId = queue.shift();
    if (regionId === undefined || visited.has(regionId)) continue;
    visited.add(regionId);
    for (const linkedRegionId of linkedRegionIds.get(regionId) ?? []) {
      if (!visited.has(linkedRegionId)) queue.push(linkedRegionId);
    }
  }

  for (const region of regions) {
    if (!region.id || visited.has(region.id)) continue;
    diagnostics.push({
      code: "poly-world-unreachable-region",
      message: `PolyWorld region "${region.id}" is not reachable from region "${firstRegionId}" in strict topology validation.`,
      id: region.id,
      field: "links",
      kind: "region",
    });
  }
}

function validateElementLayersRequired(
  elements: readonly PolyWorldElement[],
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  for (const element of elements) {
    if (element.layers !== undefined) continue;
    diagnostics.push({
      code: "poly-world-missing-element-layers",
      message: `PolyWorld element "${element.id}" requires layers in strict topology validation.`,
      id: element.id,
      field: "layers",
      kind: "element",
    });
  }
}

function addLinkedRegion(
  linkedRegionIds: Map<string, Set<string>>,
  regionId: string,
  linkedRegionId: string,
): void {
  const links = linkedRegionIds.get(regionId);
  if (links === undefined) {
    linkedRegionIds.set(regionId, new Set([linkedRegionId]));
    return;
  }
  links.add(linkedRegionId);
}

function validateStringArray(
  kind: "region" | "link" | "element" | "spatialElement",
  id: string,
  field: string,
  values: readonly string[] | undefined,
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  if (values === undefined) return;
  if (values.length === 0) {
    diagnostics.push({
      code: "poly-world-empty-array",
      message: `PolyWorld ${kind} "${id}" has empty ${field}.`,
      id,
      field,
      kind,
    });
    return;
  }
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      diagnostics.push({
        code: "poly-world-empty-array-value",
        message: `PolyWorld ${kind} "${id}" has an empty value in ${field}.`,
        id,
        field,
        kind,
      });
    }
  }
}

function validateBounds(
  kind: "region" | "element" | "spatialElement",
  id: string,
  bounds: PolyWorldBounds | undefined,
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  if (bounds === undefined) return;
  validateVec3(kind, id, "bounds.min", bounds.min, diagnostics);
  validateVec3(kind, id, "bounds.max", bounds.max, diagnostics);
  for (let axis = 0; axis < 3; axis += 1) {
    if (bounds.min[axis] > bounds.max[axis]) {
      diagnostics.push({
        code: "poly-world-invalid-bounds",
        message: `PolyWorld ${kind} "${id}" has bounds.min greater than bounds.max.`,
        id,
        field: "bounds",
        kind,
      });
      break;
    }
  }
}

function validateVec3(
  kind: "region" | "element" | "spatialElement",
  id: string,
  field: string,
  value: readonly number[] | undefined,
  diagnostics: PolyWorldValidationDiagnostic[],
): void {
  if (value === undefined) return;
  if (value.length !== 3 || value.some((coordinate) => !Number.isFinite(coordinate))) {
    diagnostics.push({
      code: "poly-world-invalid-vec3",
      message: `PolyWorld ${kind} "${id}" has invalid ${field}.`,
      id,
      field,
      kind,
    });
  }
}

function normalizeElement(element: PolyWorldElement): PolyWorldElement {
  return {
    ...element,
    bounds: element.bounds === undefined ? undefined : {
      min: [...element.bounds.min],
      max: [...element.bounds.max],
    },
    transform: element.transform === undefined ? undefined : {
      ...element.transform,
      position: element.transform.position === undefined ? undefined : [...element.transform.position],
      rotation: element.transform.rotation === undefined ? undefined : [...element.transform.rotation],
      scale: element.transform.scale === undefined ? undefined : [...element.transform.scale],
      matrix: element.transform.matrix === undefined ? undefined : [...element.transform.matrix],
    },
  };
}

function normalizeRegion(region: PolyWorldRegion): PolyWorldRegion {
  if (region.center !== undefined || region.bounds === undefined) return { ...region };
  const { min, max } = region.bounds;
  return {
    ...region,
    center: [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ],
  };
}

function normalizeSpatialElement(spatialElement: PolyWorldSpatialElement): PolyWorldSpatialElement {
  return {
    ...spatialElement,
    bounds: spatialElement.bounds === undefined ? undefined : {
      min: [...spatialElement.bounds.min],
      max: [...spatialElement.bounds.max],
    },
    vertices: spatialElement.vertices?.map((vertex) => [...vertex]),
  };
}

function polygonPlane(vertices: readonly (readonly number[])[]): { normal: [number, number, number]; distance: number } | undefined {
  for (let index = 1; index < vertices.length - 1; index += 1) {
    const normal = cross(subtract(vertices[index], vertices[0]), subtract(vertices[index + 1], vertices[0]));
    const length = Math.hypot(normal[0], normal[1], normal[2]);
    if (length <= 0.000001) continue;
    const unit: [number, number, number] = [normal[0] / length, normal[1] / length, normal[2] / length];
    return {
      normal: unit,
      distance: dot(unit, vertices[0]),
    };
  }
  return undefined;
}

function isFiniteVec3(value: readonly number[]): boolean {
  return value.length === 3 && value.every((coordinate) => Number.isFinite(coordinate));
}

function subtract(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function pushMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key);
  if (values === undefined) {
    map.set(key, [value]);
    return;
  }
  values.push(value);
}
