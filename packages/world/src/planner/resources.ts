import type { PolyWorldData, PolyWorldTopology } from "../topology";
import type {
  PolyWorldPlanAction,
  PolyWorldPlanCheckInput,
  PolyWorldPlanCheckResult,
  PolyWorldPlanEntryCheckContext,
} from "./types";

export type PolyWorldResourceReadinessState = "missing" | "requested" | "loading" | "ready" | "failed" | "stale";

export interface PolyWorldResourceReadinessRecord {
  state: PolyWorldResourceReadinessState;
  renderBlocking?: boolean;
  preloadOnly?: boolean;
  label?: string;
  message?: string;
  data?: PolyWorldData;
}

export type PolyWorldResourceReadinessMap = Readonly<Record<
  string,
  PolyWorldResourceReadinessState | PolyWorldResourceReadinessRecord
>>;

export interface PolyWorldResourceReadinessGuardOptions {
  id?: string;
  label?: string;
  actions?: readonly PolyWorldPlanAction[];
  readyStates?: readonly PolyWorldResourceReadinessState[];
  resourceDeclarations?: readonly PolyWorldResourceReadinessDeclaration[];
}

export interface PolyWorldResourceReadinessSummaryOptions {
  readyStates?: readonly PolyWorldResourceReadinessState[];
  resourceDeclarations?: readonly PolyWorldResourceReadinessDeclaration[];
}

export interface PolyWorldResourceLoadSetOptions extends PolyWorldResourceReadinessSummaryOptions {
  previousElementIds?: readonly string[];
  nextElementIds: readonly string[];
  resources: PolyWorldResourceReadinessMap;
}

export interface PolyWorldResourceReadinessDeclaration {
  id: string;
  state?: PolyWorldResourceReadinessState;
  renderBlocking?: boolean;
  preloadOnly?: boolean;
  elementIds?: readonly string[];
  spatialElementIds?: readonly string[];
  label?: string;
  message?: string;
  data?: PolyWorldData;
}

export interface PolyWorldResourceReadinessSummaryRecord {
  resourceId: string;
  state: PolyWorldResourceReadinessState;
  elementIds: readonly string[];
  spatialElementIds: readonly string[];
  renderBlocking: boolean;
  preloadOnly: boolean;
  label?: string;
  message?: string;
  data?: PolyWorldData;
}

export interface PolyWorldResourceReadinessSummary {
  records: readonly PolyWorldResourceReadinessSummaryRecord[];
  resourceIds: readonly string[];
  readyResourceIds: readonly string[];
  missingResourceIds: readonly string[];
  requestedResourceIds: readonly string[];
  loadingResourceIds: readonly string[];
  failedResourceIds: readonly string[];
  staleResourceIds: readonly string[];
  renderBlockingResourceIds: readonly string[];
  preloadOnlyResourceIds: readonly string[];
  nonBlockingResourceIds: readonly string[];
  blockedResourceIds: readonly string[];
  blockedElementIds: readonly string[];
  elementIdsByResourceState: Readonly<Record<PolyWorldResourceReadinessState, readonly string[]>>;
}

export interface PolyWorldResourceLoadSetSummary {
  previousReadiness: PolyWorldResourceReadinessSummary;
  nextReadiness: PolyWorldResourceReadinessSummary;
  previousResourceIds: readonly string[];
  nextResourceIds: readonly string[];
  requestResourceIds: readonly string[];
  retainResourceIds: readonly string[];
  releaseCandidateResourceIds: readonly string[];
  readyButNotVisibleResourceIds: readonly string[];
  preloadOnlyResourceIds: readonly string[];
  renderBlockingResourceIds: readonly string[];
  staleAllowedResourceIds: readonly string[];
  nonBlockingResourceIds: readonly string[];
  blockedResourceIds: readonly string[];
  blockedElementIds: readonly string[];
}

export function createPolyWorldResourceReadinessGuards(
  topology: PolyWorldTopology,
  resources: PolyWorldResourceReadinessMap,
  options: PolyWorldResourceReadinessGuardOptions = {},
): PolyWorldPlanCheckInput {
  const id = options.id ?? "resource-ready";
  const label = options.label ?? "resource-ready";
  const actions = new Set(options.actions ?? ["show", "retain"]);
  const readyStates = new Set(options.readyStates ?? ["ready"]);

  return (context: PolyWorldPlanEntryCheckContext): readonly PolyWorldPlanCheckResult[] => {
    if (!actions.has(context.action) || context.elementId === undefined) return [];
    const elementId = context.elementId;
    const summary = summarizePolyWorldResourceReadiness(topology, [elementId], resources, {
      readyStates: options.readyStates,
      resourceDeclarations: options.resourceDeclarations,
    });
    if (summary.records.length === 0) return [];

    return summary.records.map((record) => {
      const ok = readyStates.has(record.state) || !isResourceBlocking(record);
      return {
        id: `${id}:${record.resourceId}`,
        ok,
        label,
        message: ok ? record.message : record.message ?? `Resource "${record.resourceId}" is ${record.state}.`,
        data: {
          resourceId: record.resourceId,
          state: record.state,
          renderBlocking: record.renderBlocking,
          preloadOnly: record.preloadOnly,
          elementId,
          elementIds: record.elementIds,
          spatialElementIds: record.spatialElementIds,
          ...(record.data ?? {}),
        },
      };
    });
  };
}

export function summarizePolyWorldResourceReadiness(
  topology: PolyWorldTopology,
  elementIds: readonly string[],
  resources: PolyWorldResourceReadinessMap,
  options: PolyWorldResourceReadinessSummaryOptions = {},
): PolyWorldResourceReadinessSummary {
  const readyStates = new Set(options.readyStates ?? ["ready"]);
  const ownershipByResourceId = new Map<string, { elementIds: Set<string>; spatialElementIds: Set<string> }>();
  const selectedElementIds = new Set(elementIds);
  const declarationsByResourceId = new Map(
    (options.resourceDeclarations ?? []).map((resource) => [resource.id, resource]),
  );

  for (const elementId of elementIds) {
    const element = topology.elementsById.get(elementId);
    if (element === undefined) continue;

    for (const resourceId of element.resourceIds ?? []) {
      const ownership = resolveResourceOwnership(ownershipByResourceId, resourceId);
      ownership.elementIds.add(elementId);
    }

    for (const spatialElement of topology.spatialElementsByElementId.get(elementId) ?? []) {
      for (const resourceId of spatialElement.resourceIds ?? []) {
        const ownership = resolveResourceOwnership(ownershipByResourceId, resourceId);
        ownership.elementIds.add(elementId);
        ownership.spatialElementIds.add(spatialElement.id);
      }
    }
  }
  for (const declaration of options.resourceDeclarations ?? []) {
    for (const elementId of declaration.elementIds ?? []) {
      if (!selectedElementIds.has(elementId)) continue;
      const ownership = resolveResourceOwnership(ownershipByResourceId, declaration.id);
      ownership.elementIds.add(elementId);
    }
    for (const spatialElementId of declaration.spatialElementIds ?? []) {
      const spatialElement = topology.spatialElementsById.get(spatialElementId);
      const ownerElementId = spatialElement?.elementId;
      if (ownerElementId === undefined || !selectedElementIds.has(ownerElementId)) continue;
      const ownership = resolveResourceOwnership(ownershipByResourceId, declaration.id);
      ownership.elementIds.add(ownerElementId);
      ownership.spatialElementIds.add(spatialElementId);
    }
  }

  const records: PolyWorldResourceReadinessSummaryRecord[] = [];
  const resourceIdsByState: Record<PolyWorldResourceReadinessState, string[]> = {
    missing: [],
    requested: [],
    loading: [],
    ready: [],
    failed: [],
    stale: [],
  };
  const elementIdsByResourceState: Record<PolyWorldResourceReadinessState, string[]> = {
    missing: [],
    requested: [],
    loading: [],
    ready: [],
    failed: [],
    stale: [],
  };
  const renderBlockingResourceIds: string[] = [];
  const preloadOnlyResourceIds: string[] = [];
  const nonBlockingResourceIds: string[] = [];
  const blockedResourceIds: string[] = [];
  const blockedElementIds: string[] = [];

  for (const [resourceId, ownership] of ownershipByResourceId) {
    const resource = normalizeResourceRecord(resources[resourceId], declarationsByResourceId.get(resourceId));
    const elementOwnerIds = [...ownership.elementIds];
    const spatialElementIds = [...ownership.spatialElementIds];
    const preloadOnly = resource.preloadOnly === true;
    const renderBlocking = isResourceBlocking(resource);
    if (renderBlocking) renderBlockingResourceIds.push(resourceId);
    if (preloadOnly) preloadOnlyResourceIds.push(resourceId);
    if (!renderBlocking) nonBlockingResourceIds.push(resourceId);
    const record: PolyWorldResourceReadinessSummaryRecord = {
      resourceId,
      state: resource.state,
      elementIds: elementOwnerIds,
      spatialElementIds,
      renderBlocking,
      preloadOnly,
      ...(resource.label === undefined ? {} : { label: resource.label }),
      ...(resource.message === undefined ? {} : { message: resource.message }),
      ...(resource.data === undefined ? {} : { data: resource.data }),
    };
    records.push(record);
    resourceIdsByState[resource.state].push(resourceId);
    for (const elementId of elementOwnerIds) addUnique(elementIdsByResourceState[resource.state], elementId);
    if (!readyStates.has(resource.state) && isResourceBlocking(resource)) {
      blockedResourceIds.push(resourceId);
      for (const elementId of elementOwnerIds) addUnique(blockedElementIds, elementId);
    }
  }

  return {
    records,
    resourceIds: records.map((record) => record.resourceId),
    readyResourceIds: resourceIdsByState.ready,
    missingResourceIds: resourceIdsByState.missing,
    requestedResourceIds: resourceIdsByState.requested,
    loadingResourceIds: resourceIdsByState.loading,
    failedResourceIds: resourceIdsByState.failed,
    staleResourceIds: resourceIdsByState.stale,
    renderBlockingResourceIds,
    preloadOnlyResourceIds,
    nonBlockingResourceIds,
    blockedResourceIds,
    blockedElementIds,
    elementIdsByResourceState,
  };
}

export function createPolyWorldResourceLoadSet(
  topology: PolyWorldTopology,
  options: PolyWorldResourceLoadSetOptions,
): PolyWorldResourceLoadSetSummary {
  const readyStates = new Set(options.readyStates ?? ["ready"]);
  const previousReadiness = summarizePolyWorldResourceReadiness(
    topology,
    options.previousElementIds ?? [],
    options.resources,
    {
      readyStates: options.readyStates,
      resourceDeclarations: options.resourceDeclarations,
    },
  );
  const nextReadiness = summarizePolyWorldResourceReadiness(
    topology,
    options.nextElementIds,
    options.resources,
    {
      readyStates: options.readyStates,
      resourceDeclarations: options.resourceDeclarations,
    },
  );
  const nextResourceIds = new Set(nextReadiness.resourceIds);
  const previousResourceIds = new Set(previousReadiness.resourceIds);
  const previousRecordsById = new Map(previousReadiness.records.map((record) => [record.resourceId, record]));

  return {
    previousReadiness,
    nextReadiness,
    previousResourceIds: previousReadiness.resourceIds,
    nextResourceIds: nextReadiness.resourceIds,
    requestResourceIds: nextReadiness.records
      .filter((record) => !readyStates.has(record.state))
      .map((record) => record.resourceId),
    retainResourceIds: nextReadiness.resourceIds.filter((resourceId) => previousResourceIds.has(resourceId)),
    releaseCandidateResourceIds: previousReadiness.resourceIds.filter((resourceId) => !nextResourceIds.has(resourceId)),
    readyButNotVisibleResourceIds: previousReadiness.resourceIds.filter((resourceId) => {
      if (nextResourceIds.has(resourceId)) return false;
      const record = previousRecordsById.get(resourceId);
      return record !== undefined && readyStates.has(record.state);
    }),
    preloadOnlyResourceIds: nextReadiness.preloadOnlyResourceIds,
    renderBlockingResourceIds: nextReadiness.renderBlockingResourceIds,
    staleAllowedResourceIds: nextReadiness.records
      .filter((record) => record.state === "stale" && readyStates.has(record.state))
      .map((record) => record.resourceId),
    nonBlockingResourceIds: nextReadiness.nonBlockingResourceIds,
    blockedResourceIds: nextReadiness.blockedResourceIds,
    blockedElementIds: nextReadiness.blockedElementIds,
  };
}

function resolveResourceOwnership(
  ownershipByResourceId: Map<string, { elementIds: Set<string>; spatialElementIds: Set<string> }>,
  resourceId: string,
): { elementIds: Set<string>; spatialElementIds: Set<string> } {
  let ownership = ownershipByResourceId.get(resourceId);
  if (ownership === undefined) {
    ownership = { elementIds: new Set(), spatialElementIds: new Set() };
    ownershipByResourceId.set(resourceId, ownership);
  }
  return ownership;
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function normalizeResourceRecord(
  value: PolyWorldResourceReadinessState | PolyWorldResourceReadinessRecord | undefined,
  declaration?: PolyWorldResourceReadinessDeclaration,
): PolyWorldResourceReadinessRecord {
  const fallback: PolyWorldResourceReadinessRecord = {
    state: declaration?.state ?? "missing",
    renderBlocking: declaration?.renderBlocking ?? (declaration?.preloadOnly === true ? false : true),
    preloadOnly: declaration?.preloadOnly ?? false,
    ...(declaration?.label === undefined ? {} : { label: declaration.label }),
    ...(declaration?.message === undefined ? {} : { message: declaration.message }),
    ...(declaration?.data === undefined ? {} : { data: declaration.data }),
  };
  if (value === undefined) return fallback;
  if (typeof value === "string") return { ...fallback, state: value };
  return {
    ...fallback,
    ...value,
    renderBlocking: value.renderBlocking ?? fallback.renderBlocking,
    preloadOnly: value.preloadOnly ?? fallback.preloadOnly,
  };
}

function isResourceBlocking(resource: Pick<PolyWorldResourceReadinessRecord, "renderBlocking" | "preloadOnly">): boolean {
  return resource.renderBlocking !== false && resource.preloadOnly !== true;
}
