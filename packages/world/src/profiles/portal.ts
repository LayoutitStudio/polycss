import type {
  PolyWorldLink,
  PolyWorldSelection,
  PolyWorldSelectionReason,
  PolyWorldTopology,
} from "../topology";

export interface PolyWorldRegionSelectionKeysContext {
  regionId: string;
  topology: PolyWorldTopology;
}

export type PolyWorldRegionSelectionKeys =
  | Record<string, readonly string[]>
  | ((context: PolyWorldRegionSelectionKeysContext) => readonly string[] | undefined);

export interface PolyWorldPortalReasonLabels {
  current?: string;
  linked?: string;
  visible?: string;
  visibilitySelection?: string;
  link?: string;
  facing?: string;
  closed?: string;
  blocked?: string;
  selectionKey?: string;
}

export type PolyWorldPortalLinkStateValue = "open" | "closed" | "blocked" | boolean;

export interface PolyWorldPortalLinkStateContext {
  link: PolyWorldLink;
  fromRegionId: string;
  toRegionId: string;
  depth: number;
  topology: PolyWorldTopology;
}

export type PolyWorldPortalLinkState =
  | Record<string, PolyWorldPortalLinkStateValue | undefined>
  | ((context: PolyWorldPortalLinkStateContext) => PolyWorldPortalLinkStateValue | undefined);

export type PolyWorldPortalActivityTargetState = "preloaded" | "loaded" | "resident" | "active" | "rendered" | "inactive";

export interface PolyWorldPortalActivityOptions {
  selectedRegionIds?: readonly string[];
  selectedTargetState?: PolyWorldPortalActivityTargetState;
  loadedRegionIds?: readonly string[];
  residentRegionIds?: readonly string[];
  activeRegionIds?: readonly string[];
  renderedRegionIds?: readonly string[];
  preloadedRegionIds?: readonly string[];
}

export interface PolyWorldPortalActivityState {
  selectedRegionIds: readonly string[];
  hiddenRegionIds: readonly string[];
  loadedRegionIds: readonly string[];
  residentRegionIds: readonly string[];
  activeRegionIds: readonly string[];
  renderedRegionIds: readonly string[];
  preloadedRegionIds: readonly string[];
  inactiveRegionIds: readonly string[];
}

export interface PolyWorldPortalSelectionOptions {
  currentRegionId?: string;
  includeCurrent?: boolean;
  includeLinked?: boolean;
  linkedDepth?: number;
  visibleRegionIds?: readonly string[];
  visibilitySelection?: PolyWorldSelection;
  linkIds?: readonly string[];
  facingLinkIds?: readonly string[];
  linkState?: PolyWorldPortalLinkState;
  includeClosedLinks?: boolean;
  selectionKeys?: readonly string[];
  regionSelectionKeys?: PolyWorldRegionSelectionKeys;
  reasonLabels?: PolyWorldPortalReasonLabels;
  reasons?: readonly PolyWorldSelectionReason[];
  data?: Record<string, unknown>;
}

export function selectPolyWorldPortalRegions(
  topology: PolyWorldTopology,
  options: PolyWorldPortalSelectionOptions,
): PolyWorldSelection {
  const labels = {
    current: "current",
    linked: "linked",
    visible: "visible",
    visibilitySelection: "visibility-selection",
    link: "link",
    facing: "facing",
    closed: "closed",
    blocked: "blocked",
    selectionKey: "selection-key",
    ...options.reasonLabels,
  };
  const regionIds: string[] = [];
  const linkIds: string[] = [];
  const selectionKeys: string[] = [];
  const elementIds: string[] = [];
  const sourceIds: string[] = [];
  const aliases: string[] = [];
  const reasons: PolyWorldSelectionReason[] = [...(options.reasons ?? [])];

  if (options.currentRegionId !== undefined && options.includeCurrent !== false) {
    add(regionIds, options.currentRegionId);
    reasons.push({
      id: "poly-world-portal-current",
      kind: "current",
      label: labels.current,
      regionIds: [options.currentRegionId],
    });
  }

  if (options.currentRegionId !== undefined && options.includeLinked !== false) {
    const linked = linkedRegions(topology, options.currentRegionId, options.linkedDepth ?? 1, {
      linkState: options.linkState,
      includeClosedLinks: options.includeClosedLinks === true,
    });
    for (const linkedRegionId of linked.regionIds) add(regionIds, linkedRegionId);
    for (const linkedLinkId of linked.linkIds) add(linkIds, linkedLinkId);
    for (const linkedLinkId of linked.linkIds) {
      const link = topology.linksById.get(linkedLinkId);
      for (const selectionKey of link?.selectionKeys ?? []) add(selectionKeys, selectionKey);
    }
    if (linked.regionIds.length > 0 || linked.linkIds.length > 0) {
      reasons.push({
        id: "poly-world-portal-linked",
        kind: "linked",
        label: labels.linked,
        regionIds: linked.regionIds,
        linkIds: linked.linkIds,
      });
    }
    if (linked.closedLinkIds.length > 0) {
      reasons.push({
        id: "poly-world-portal-closed",
        kind: "closed",
        label: labels.closed,
        linkIds: linked.closedLinkIds,
      });
    }
    if (linked.blockedLinkIds.length > 0) {
      reasons.push({
        id: "poly-world-portal-blocked",
        kind: "blocked",
        label: labels.blocked,
        linkIds: linked.blockedLinkIds,
      });
    }
  }

  for (const visibleRegionId of options.visibleRegionIds ?? []) add(regionIds, visibleRegionId);
  if ((options.visibleRegionIds?.length ?? 0) > 0) {
    reasons.push({
      id: "poly-world-portal-visible",
      kind: "visible",
      label: labels.visible,
      regionIds: unique(options.visibleRegionIds),
    });
  }

  if (options.visibilitySelection !== undefined) {
    mergePortalVisibilitySelection(options.visibilitySelection, {
      regionIds,
      linkIds,
      selectionKeys,
      elementIds,
      sourceIds,
      aliases,
    });
    reasons.push(...(options.visibilitySelection.reasons ?? []));
    if (hasPortalVisibilitySelectionEntries(options.visibilitySelection)) {
      reasons.push({
        id: "poly-world-portal-visibility-selection",
        kind: "visibilitySelection",
        label: labels.visibilitySelection,
        regionIds: unique(options.visibilitySelection.regionIds),
        linkIds: unique(options.visibilitySelection.linkIds),
        selectionKeys: unique(options.visibilitySelection.selectionKeys),
        elementIds: unique(options.visibilitySelection.elementIds),
        sourceIds: unique(options.visibilitySelection.sourceIds),
        aliases: unique(options.visibilitySelection.aliases),
        data: options.visibilitySelection.data,
      });
    }
  }

  const explicitLinkIds = unique([...(options.linkIds ?? []), ...(options.facingLinkIds ?? [])]);
  for (const linkId of explicitLinkIds) {
    const link = topology.linksById.get(linkId);
    add(linkIds, linkId);
    if (link === undefined) continue;
    add(regionIds, link.fromRegionId);
    add(regionIds, link.toRegionId);
    for (const selectionKey of link.selectionKeys ?? []) add(selectionKeys, selectionKey);
  }

  if ((options.linkIds?.length ?? 0) > 0) {
    reasons.push({
      id: "poly-world-portal-link",
      kind: "link",
      label: labels.link,
      linkIds: unique(options.linkIds),
    });
  }
  if ((options.facingLinkIds?.length ?? 0) > 0) {
    reasons.push({
      id: "poly-world-portal-facing",
      kind: "facing",
      label: labels.facing,
      linkIds: unique(options.facingLinkIds),
    });
  }

  for (const regionId of regionIds) {
    const region = topology.regionsById.get(regionId);
    for (const selectionKey of region?.selectionKeys ?? []) add(selectionKeys, selectionKey);
    for (const selectionKey of resolveRegionSelectionKeys(options.regionSelectionKeys, regionId, topology)) {
      add(selectionKeys, selectionKey);
    }
  }

  for (const selectionKey of options.selectionKeys ?? []) add(selectionKeys, selectionKey);
  if (selectionKeys.length > 0) {
    reasons.push({
      id: "poly-world-portal-selection-key",
      kind: "selectionKey",
      label: labels.selectionKey,
      selectionKeys,
    });
  }

  return {
    regionIds,
    linkIds,
    selectionKeys,
    ...(elementIds.length === 0 ? {} : { elementIds }),
    ...(sourceIds.length === 0 ? {} : { sourceIds }),
    ...(aliases.length === 0 ? {} : { aliases }),
    reasons,
    data: options.data,
  };
}

function mergePortalVisibilitySelection(
  selection: PolyWorldSelection,
  target: {
    regionIds: string[];
    linkIds: string[];
    selectionKeys: string[];
    elementIds: string[];
    sourceIds: string[];
    aliases: string[];
  },
): void {
  for (const regionId of selection.regionIds ?? []) add(target.regionIds, regionId);
  for (const linkId of selection.linkIds ?? []) add(target.linkIds, linkId);
  for (const selectionKey of selection.selectionKeys ?? []) add(target.selectionKeys, selectionKey);
  for (const elementId of selection.elementIds ?? []) add(target.elementIds, elementId);
  for (const sourceId of selection.sourceIds ?? []) add(target.sourceIds, sourceId);
  for (const alias of selection.aliases ?? []) add(target.aliases, alias);
}

function hasPortalVisibilitySelectionEntries(selection: PolyWorldSelection): boolean {
  return (selection.regionIds?.length ?? 0) > 0 ||
    (selection.linkIds?.length ?? 0) > 0 ||
    (selection.selectionKeys?.length ?? 0) > 0 ||
    (selection.elementIds?.length ?? 0) > 0 ||
    (selection.sourceIds?.length ?? 0) > 0 ||
    (selection.aliases?.length ?? 0) > 0;
}

export function resolvePolyWorldPortalActivity(
  topology: PolyWorldTopology,
  selection: Pick<PolyWorldSelection, "regionIds">,
  options: PolyWorldPortalActivityOptions = {},
): PolyWorldPortalActivityState {
  const selectedRegionIds = unique(options.selectedRegionIds ?? selection.regionIds);
  const selectedRegionSet = new Set(selectedRegionIds);
  const loadedRegionIds = new Set(options.loadedRegionIds ?? []);
  const residentRegionIds = new Set(options.residentRegionIds ?? []);
  const activeRegionIds = new Set(options.activeRegionIds ?? []);
  const renderedRegionIds = new Set(options.renderedRegionIds ?? []);
  const preloadedRegionIds = new Set(options.preloadedRegionIds ?? []);
  const selectedTargetState = options.selectedTargetState ?? "rendered";

  for (const regionId of selectedRegionIds) {
    addPortalActivityTargetState(regionId, selectedTargetState, {
      loadedRegionIds,
      residentRegionIds,
      activeRegionIds,
      renderedRegionIds,
      preloadedRegionIds,
    });
  }
  for (const regionId of options.loadedRegionIds ?? []) {
    addPortalActivityTargetState(regionId, "loaded", {
      loadedRegionIds,
      residentRegionIds,
      activeRegionIds,
      renderedRegionIds,
      preloadedRegionIds,
    });
  }
  for (const regionId of options.residentRegionIds ?? []) {
    addPortalActivityTargetState(regionId, "resident", {
      loadedRegionIds,
      residentRegionIds,
      activeRegionIds,
      renderedRegionIds,
      preloadedRegionIds,
    });
  }
  for (const regionId of options.activeRegionIds ?? []) {
    addPortalActivityTargetState(regionId, "active", {
      loadedRegionIds,
      residentRegionIds,
      activeRegionIds,
      renderedRegionIds,
      preloadedRegionIds,
    });
  }
  for (const regionId of options.renderedRegionIds ?? []) {
    addPortalActivityTargetState(regionId, "rendered", {
      loadedRegionIds,
      residentRegionIds,
      activeRegionIds,
      renderedRegionIds,
      preloadedRegionIds,
    });
  }
  for (const regionId of options.preloadedRegionIds ?? []) {
    addPortalActivityTargetState(regionId, "preloaded", {
      loadedRegionIds,
      residentRegionIds,
      activeRegionIds,
      renderedRegionIds,
      preloadedRegionIds,
    });
  }

  return {
    selectedRegionIds,
    hiddenRegionIds: topology.regions.map((region) => region.id).filter((regionId) => !selectedRegionSet.has(regionId)),
    loadedRegionIds: orderPortalActivityRegionIds(topology, loadedRegionIds),
    residentRegionIds: orderPortalActivityRegionIds(topology, residentRegionIds),
    activeRegionIds: orderPortalActivityRegionIds(topology, activeRegionIds),
    renderedRegionIds: orderPortalActivityRegionIds(topology, renderedRegionIds),
    preloadedRegionIds: orderPortalActivityRegionIds(topology, preloadedRegionIds),
    inactiveRegionIds: topology.regions.map((region) => region.id).filter((regionId) => !activeRegionIds.has(regionId)),
  };
}

function linkedRegions(
  topology: PolyWorldTopology,
  currentRegionId: string,
  depth: number,
  options: {
    linkState?: PolyWorldPortalLinkState;
    includeClosedLinks: boolean;
  },
): { regionIds: string[]; linkIds: string[]; closedLinkIds: string[]; blockedLinkIds: string[] } {
  const visited = new Set([currentRegionId]);
  const regionIds: string[] = [];
  const linkIds: string[] = [];
  const closedLinkIds: string[] = [];
  const blockedLinkIds: string[] = [];
  let frontier = [currentRegionId];

  for (let step = 0; step < depth; step += 1) {
    const next: string[] = [];
    for (const regionId of frontier) {
      for (const link of topology.linksByRegionId.get(regionId) ?? []) {
        const linkedRegionId = otherRegionId(link, regionId);
        if (linkedRegionId === undefined) continue;
        const state = resolveLinkState(options.linkState, {
          link,
          fromRegionId: regionId,
          toRegionId: linkedRegionId,
          depth: step,
          topology,
        });
        if (!options.includeClosedLinks && state !== "open") {
          if (state === "blocked") add(blockedLinkIds, link.id);
          else add(closedLinkIds, link.id);
          continue;
        }
        add(linkIds, link.id);
        if (visited.has(linkedRegionId)) continue;
        visited.add(linkedRegionId);
        add(regionIds, linkedRegionId);
        next.push(linkedRegionId);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return { regionIds, linkIds, closedLinkIds, blockedLinkIds };
}

function otherRegionId(link: PolyWorldLink, regionId: string): string | undefined {
  if (link.fromRegionId === regionId) return link.toRegionId;
  if (link.direction !== "forward" && link.toRegionId === regionId) return link.fromRegionId;
  return undefined;
}

export function resolvePolyWorldRegionSelectionKeys(
  regionSelectionKeys: PolyWorldRegionSelectionKeys | undefined,
  regionId: string,
  topology: PolyWorldTopology,
): readonly string[] {
  return resolveRegionSelectionKeys(regionSelectionKeys, regionId, topology);
}

function resolveLinkState(
  state: PolyWorldPortalLinkState | undefined,
  context: PolyWorldPortalLinkStateContext,
): "open" | "closed" | "blocked" {
  if (state === undefined) return "open";
  const value = typeof state === "function"
    ? state(context)
    : state[context.link.id] ?? state[context.link.sourceId ?? ""] ?? undefined;
  if (value === false || value === "closed") return "closed";
  if (value === "blocked") return "blocked";
  return "open";
}

function resolveRegionSelectionKeys(
  regionSelectionKeys: PolyWorldRegionSelectionKeys | undefined,
  regionId: string,
  topology: PolyWorldTopology,
): readonly string[] {
  if (regionSelectionKeys === undefined) return [];
  if (typeof regionSelectionKeys === "function") {
    return regionSelectionKeys({ regionId, topology }) ?? [];
  }
  return regionSelectionKeys[regionId] ?? [];
}

function add(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])];
}

function addPortalActivityTargetState(
  regionId: string,
  targetState: PolyWorldPortalActivityTargetState,
  sets: {
    loadedRegionIds: Set<string>;
    residentRegionIds: Set<string>;
    activeRegionIds: Set<string>;
    renderedRegionIds: Set<string>;
    preloadedRegionIds: Set<string>;
  },
): void {
  if (targetState === "inactive") return;
  if (targetState === "preloaded") {
    sets.preloadedRegionIds.add(regionId);
    return;
  }
  sets.loadedRegionIds.add(regionId);
  if (targetState === "resident" || targetState === "active" || targetState === "rendered") {
    sets.residentRegionIds.add(regionId);
  }
  if (targetState === "active" || targetState === "rendered") {
    sets.activeRegionIds.add(regionId);
  }
  if (targetState === "rendered") {
    sets.renderedRegionIds.add(regionId);
  }
}

function orderPortalActivityRegionIds(topology: PolyWorldTopology, regionIds: ReadonlySet<string>): string[] {
  return topology.regions.map((region) => region.id).filter((regionId) => regionIds.has(regionId));
}
