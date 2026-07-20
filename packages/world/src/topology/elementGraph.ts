import type {
  PolyWorldElement,
  PolyWorldElementPurpose,
  PolyWorldSelection,
  PolyWorldTopology,
} from "./types";

export type PolyWorldElementGraphRelation = "parent" | "container";
export type PolyWorldElementPurposeMatch = "any" | "all";

export interface PolyWorldElementSubtreeOptions {
  relation?: PolyWorldElementGraphRelation;
  recursive?: boolean;
  includeSeeds?: boolean;
  purposes?: readonly PolyWorldElementPurpose[];
  purposeMatch?: PolyWorldElementPurposeMatch;
  layers?: readonly string[];
  tags?: readonly string[];
}

export interface PolyWorldElementSubtree {
  seedElementIds: readonly string[];
  relation: PolyWorldElementGraphRelation;
  elementIds: readonly string[];
  descendantElementIds: readonly string[];
  missingElementIds: readonly string[];
}

export interface PolyWorldElementPurposeSelectionOptions {
  match?: PolyWorldElementPurposeMatch;
  layers?: readonly string[];
  tags?: readonly string[];
  includeDescendants?: boolean;
  relation?: PolyWorldElementGraphRelation;
  recursive?: boolean;
  reasonLabel?: string;
  reasonKind?: string;
}

export function resolvePolyWorldElementSubtree(
  topology: PolyWorldTopology,
  seedElementIds: readonly string[],
  options: PolyWorldElementSubtreeOptions = {},
): PolyWorldElementSubtree {
  const relation = options.relation ?? "parent";
  const recursive = options.recursive ?? true;
  const includeSeeds = options.includeSeeds ?? true;
  const seedIds = unique(seedElementIds);
  const missingElementIds: string[] = [];
  const descendantElementIds: string[] = [];
  const purposeSet = options.purposes === undefined ? undefined : new Set(options.purposes);
  const layerSet = options.layers === undefined ? undefined : new Set(options.layers);
  const tagSet = options.tags === undefined ? undefined : new Set(options.tags);

  for (const seedElementId of seedIds) {
    const seed = topology.elementsById.get(seedElementId);
    if (seed === undefined) {
      add(missingElementIds, seedElementId);
      continue;
    }
    const children = relation === "parent"
      ? topology.elementsByParentId.get(seedElementId) ?? []
      : topology.elementsByContainerId.get(seedElementId) ?? [];
    collectDescendants(topology, children, relation, recursive, descendantElementIds);
  }

  const filteredDescendantIds = topologyOrderedElementIds(
    topology,
    descendantElementIds.filter((elementId) => {
      const element = topology.elementsById.get(elementId);
      return element !== undefined && matchesElementFilters(
        element,
        purposeSet,
        options.purposeMatch ?? "any",
        layerSet,
        tagSet,
      );
    }),
  );
  const seedElementIdsForResult = includeSeeds
    ? seedIds.filter((elementId) => topology.elementsById.has(elementId))
    : [];

  return {
    seedElementIds: seedIds,
    relation,
    elementIds: topologyOrderedElementIds(topology, [...seedElementIdsForResult, ...filteredDescendantIds]),
    descendantElementIds: filteredDescendantIds,
    missingElementIds,
  };
}

export function selectPolyWorldElementsByPurpose(
  topology: PolyWorldTopology,
  purposes: readonly PolyWorldElementPurpose[],
  options: PolyWorldElementPurposeSelectionOptions = {},
): PolyWorldSelection {
  const purposeSet = new Set(purposes);
  const layerSet = options.layers === undefined ? undefined : new Set(options.layers);
  const tagSet = options.tags === undefined ? undefined : new Set(options.tags);
  const seedElementIds = topologyOrderedElementIds(
    topology,
    topology.elements
      .filter((element) => matchesElementFilters(element, purposeSet, options.match ?? "any", layerSet, tagSet))
      .map((element) => element.id),
  );
  const subtree = options.includeDescendants === true
    ? resolvePolyWorldElementSubtree(topology, seedElementIds, {
      relation: options.relation,
      recursive: options.recursive,
      includeSeeds: true,
      purposes,
      purposeMatch: options.match,
      layers: options.layers,
      tags: options.tags,
    })
    : undefined;
  const elementIds = subtree?.elementIds ?? seedElementIds;

  return {
    elementIds,
    reasons: [
      {
        id: "poly-world-element-purpose",
        kind: options.reasonKind ?? "element-purpose",
        label: options.reasonLabel ?? "element-purpose",
        elementIds,
        data: {
          purposes: [...purposes],
          match: options.match ?? "any",
          ...(subtree === undefined ? {} : {
            relation: subtree.relation,
            descendantElementIds: subtree.descendantElementIds,
          }),
        },
      },
    ],
  };
}

function collectDescendants(
  topology: PolyWorldTopology,
  elements: readonly PolyWorldElement[],
  relation: PolyWorldElementGraphRelation,
  recursive: boolean,
  descendantElementIds: string[],
): void {
  for (const element of elements) {
    if (descendantElementIds.includes(element.id)) continue;
    descendantElementIds.push(element.id);
    if (!recursive) continue;
    const children = relation === "parent"
      ? topology.elementsByParentId.get(element.id) ?? []
      : topology.elementsByContainerId.get(element.id) ?? [];
    collectDescendants(topology, children, relation, recursive, descendantElementIds);
  }
}

function matchesElementFilters(
  element: PolyWorldElement,
  purposes: ReadonlySet<PolyWorldElementPurpose> | undefined,
  purposeMatch: PolyWorldElementPurposeMatch,
  layers: ReadonlySet<string> | undefined,
  tags: ReadonlySet<string> | undefined,
): boolean {
  if (!matchesPurpose(element.purposes, purposes, purposeMatch)) return false;
  if (!matchesAny(element.layers, layers)) return false;
  if (!matchesAny(element.tags, tags)) return false;
  return true;
}

function matchesPurpose(
  values: readonly PolyWorldElementPurpose[] | undefined,
  filter: ReadonlySet<PolyWorldElementPurpose> | undefined,
  match: PolyWorldElementPurposeMatch,
): boolean {
  if (filter === undefined || filter.size === 0) return true;
  if (values === undefined) return false;
  return match === "all"
    ? [...filter].every((value) => values.includes(value))
    : values.some((value) => filter.has(value));
}

function matchesAny(values: readonly string[] | undefined, filter: ReadonlySet<string> | undefined): boolean {
  if (filter === undefined || filter.size === 0) return true;
  if (values === undefined) return false;
  return values.some((value) => filter.has(value));
}

function topologyOrderedElementIds(topology: PolyWorldTopology, elementIds: readonly string[]): string[] {
  const elementIdSet = new Set(elementIds);
  const ordered = topology.elements
    .map((element) => element.id)
    .filter((elementId) => elementIdSet.has(elementId));
  const missingOrder = elementIds.filter((elementId) => !topology.elementsById.has(elementId));
  return unique([...ordered, ...missingOrder]);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function add(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}
