import { resolvePolyWorldElements } from "./resolveElements";
import type {
  PolyWorldMissingElementRelation,
  PolyWorldElement,
  PolyWorldElementRelation,
  PolyWorldElementRelationExpansion,
  PolyWorldElementRelationExpansionOptions,
  PolyWorldElementRelationKind,
  PolyWorldSelection,
  PolyWorldSelectionElementRelationExpansionOptions,
  PolyWorldTopology,
} from "./types";

const defaultRelationExpansionOptions: Required<PolyWorldElementRelationExpansionOptions> = {
  includeParents: true,
  includeContainers: true,
  recursive: true,
};

export function resolvePolyWorldElementRelations(
  topology: PolyWorldTopology,
  elementIds: readonly string[],
  options: PolyWorldElementRelationExpansionOptions = {},
): PolyWorldElementRelationExpansion {
  const resolvedOptions = { ...defaultRelationExpansionOptions, ...options };
  const seedElementIds = unique(elementIds);
  const relatedElementIds: string[] = [];
  const parentElementIds: string[] = [];
  const containerElementIds: string[] = [];
  const missingElementIds: string[] = [];
  const missingRelations: PolyWorldMissingElementRelation[] = [];
  const relations: PolyWorldElementRelation[] = [];

  for (const elementId of seedElementIds) {
    const element = topology.elementsById.get(elementId);
    if (element === undefined) {
      add(missingElementIds, elementId);
      continue;
    }

    if (resolvedOptions.includeParents) {
      walkElementRelation(
        topology,
        element,
        "parent",
        resolvedOptions.recursive,
        parentElementIds,
        relatedElementIds,
        missingRelations,
        relations,
      );
    }

    if (resolvedOptions.includeContainers) {
      walkElementRelation(
        topology,
        element,
        "container",
        resolvedOptions.recursive,
        containerElementIds,
        relatedElementIds,
        missingRelations,
        relations,
      );
    }
  }

  return {
    seedElementIds,
    elementIds: topologyOrderedElementIds(topology, [...seedElementIds, ...relatedElementIds]),
    relatedElementIds: topologyOrderedElementIds(topology, relatedElementIds),
    parentElementIds: topologyOrderedElementIds(topology, parentElementIds),
    containerElementIds: topologyOrderedElementIds(topology, containerElementIds),
    missingElementIds,
    missingRelations,
    relations,
  };
}

export function expandPolyWorldSelectionElementRelations(
  topology: PolyWorldTopology,
  selection: PolyWorldSelection,
  options: PolyWorldSelectionElementRelationExpansionOptions = {},
): PolyWorldSelection {
  const resolution = resolvePolyWorldElements(topology, selection, options.resolutionOptions);
  const expansion = resolvePolyWorldElementRelations(topology, resolution.elementIds, options);
  if (expansion.relatedElementIds.length === 0) return selection;

  return {
    ...selection,
    elementIds: unique([...(selection.elementIds ?? []), ...expansion.relatedElementIds]),
    reasons: [
      ...(selection.reasons ?? []),
      {
        label: options.reasonLabel ?? "element-relations",
        kind: options.reasonKind ?? "element-relations",
        elementIds: expansion.relatedElementIds,
        data: {
          parentElementIds: expansion.parentElementIds,
          containerElementIds: expansion.containerElementIds,
        },
      },
    ],
  };
}

function walkElementRelation(
  topology: PolyWorldTopology,
  element: PolyWorldElement,
  kind: PolyWorldElementRelationKind,
  recursive: boolean,
  kindElementIds: string[],
  relatedElementIds: string[],
  missingRelations: PolyWorldMissingElementRelation[],
  relations: PolyWorldElementRelation[],
): void {
  const field = kind === "parent" ? "parentId" : "containerId";
  const visited = new Set<string>([element.id]);
  let current = element;
  let depth = 0;

  while (true) {
    const relatedElementId = current[field];
    if (relatedElementId === undefined) return;
    depth += 1;

    const relation: PolyWorldElementRelation = {
      kind,
      elementId: current.id,
      relatedElementId,
      depth,
    };
    relations.push(relation);

    const relatedElement = topology.elementsById.get(relatedElementId);
    if (relatedElement === undefined) {
      missingRelations.push(relation);
      return;
    }

    add(kindElementIds, relatedElementId);
    add(relatedElementIds, relatedElementId);
    if (!recursive || visited.has(relatedElementId)) return;
    visited.add(relatedElementId);
    current = relatedElement;
  }
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
