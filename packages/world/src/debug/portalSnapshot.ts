import type { PolyWorldSelection, PolyWorldSelectionReason, PolyWorldTopology } from "../topology";
import {
  createPolyWorldProfileArtifactProof,
  type PolyWorldProfileArtifactProof,
} from "../profiles/artifact";
import type { PolyWorldPortalActivityState } from "../profiles/portal";
import { limitPolyWorldDebugList } from "./limits";

export interface PolyWorldPortalDebugSnapshotOptions {
  currentRegionId?: string;
  activity?: PolyWorldPortalActivityState;
  listLimit?: number;
  metadata?: Record<string, unknown>;
}

export interface PolyWorldPortalDebugListSummary {
  values: readonly string[];
  count: number;
  omitted: number;
}

export interface PolyWorldPortalDebugSnapshot {
  schemaVersion: 1;
  proof: PolyWorldProfileArtifactProof;
  topology: {
    regionCount: number;
    linkCount: number;
    profile: "area-portals";
  };
  current: {
    regionId?: string;
  };
  regions: {
    selectedRegionIds: PolyWorldPortalDebugListSummary;
    hiddenRegionIds: PolyWorldPortalDebugListSummary;
  };
  activity?: {
    loadedRegionIds: PolyWorldPortalDebugListSummary;
    residentRegionIds: PolyWorldPortalDebugListSummary;
    activeRegionIds: PolyWorldPortalDebugListSummary;
    renderedRegionIds: PolyWorldPortalDebugListSummary;
    preloadedRegionIds: PolyWorldPortalDebugListSummary;
    inactiveRegionIds: PolyWorldPortalDebugListSummary;
  };
  links: {
    selectedLinkIds: PolyWorldPortalDebugListSummary;
    hiddenLinkIds: PolyWorldPortalDebugListSummary;
    closedLinkIds: PolyWorldPortalDebugListSummary;
    blockedLinkIds: PolyWorldPortalDebugListSummary;
    facingLinkIds: PolyWorldPortalDebugListSummary;
  };
  selection: {
    selectionKeys: PolyWorldPortalDebugListSummary;
    reasonLabels: PolyWorldPortalDebugListSummary;
    reasonKinds: Readonly<Record<string, number>>;
  };
  metadata?: Record<string, unknown>;
}

export function createPolyWorldPortalDebugSnapshot(
  topology: PolyWorldTopology,
  selection: PolyWorldSelection,
  options: PolyWorldPortalDebugSnapshotOptions = {},
): PolyWorldPortalDebugSnapshot {
  const selectedRegionIds = unique(selection.regionIds);
  const selectedLinkIds = unique(selection.linkIds);
  const selectedRegionSet = new Set(selectedRegionIds);
  const selectedLinkSet = new Set(selectedLinkIds);
  const hiddenRegionIds = topology.regions
    .map((region) => region.id)
    .filter((regionId) => !selectedRegionSet.has(regionId));
  const hiddenLinkIds = topology.links
    .map((link) => link.id)
    .filter((linkId) => !selectedLinkSet.has(linkId));
  const reasons = selection.reasons ?? [];

  return {
    schemaVersion: 1,
    proof: createPolyWorldPortalArtifactProof(topology, selection),
    topology: {
      regionCount: topology.regions.length,
      linkCount: topology.links.length,
      profile: "area-portals",
    },
    current: {
      ...(options.currentRegionId === undefined ? {} : { regionId: options.currentRegionId }),
    },
    regions: {
      selectedRegionIds: summarizeList(selectedRegionIds, options.listLimit),
      hiddenRegionIds: summarizeList(hiddenRegionIds, options.listLimit),
    },
    ...(options.activity === undefined ? {} : {
      activity: summarizeActivity(options.activity, options.listLimit),
    }),
    links: {
      selectedLinkIds: summarizeList(selectedLinkIds, options.listLimit),
      hiddenLinkIds: summarizeList(hiddenLinkIds, options.listLimit),
      closedLinkIds: summarizeList(reasonLinkIds(reasons, "closed"), options.listLimit),
      blockedLinkIds: summarizeList(reasonLinkIds(reasons, "blocked"), options.listLimit),
      facingLinkIds: summarizeList(reasonLinkIds(reasons, "facing"), options.listLimit),
    },
    selection: {
      selectionKeys: summarizeList(unique(selection.selectionKeys), options.listLimit),
      reasonLabels: summarizeList(unique(reasons.map((reason) => reason.label)), options.listLimit),
      reasonKinds: countReasonKinds(reasons),
    },
    metadata: options.metadata,
  };
}

export function createPolyWorldPortalArtifactProof(
  topology: PolyWorldTopology,
  selection: PolyWorldSelection,
): PolyWorldProfileArtifactProof {
  const selectedRegionIds = unique(selection.regionIds);
  const selectedRegionSet = new Set(selectedRegionIds);
  const selectedLinkIds = unique(selection.linkIds);
  const selectedLinkSet = new Set(selectedLinkIds);
  const reasons = selection.reasons ?? [];
  const hiddenRegionIds = topology.regions
    .map((region) => region.id)
    .filter((regionId) => !selectedRegionSet.has(regionId));
  const hiddenLinkIds = topology.links
    .map((link) => link.id)
    .filter((linkId) => !selectedLinkSet.has(linkId));
  const closedLinkIds = reasonLinkIds(reasons, "closed");
  const blockedLinkIds = reasonLinkIds(reasons, "blocked");
  const facingLinkIds = reasonLinkIds(reasons, "facing");
  return createPolyWorldProfileArtifactProof({
    profile: "area-portals",
    artifactKind: "authored-area-portals",
    sourceKind: "authored-runtime-selection",
    producedBy: "selectPolyWorldPortalRegions",
    guarantees: [
      "authored-region-link-traversal",
      "closed-blocked-link-state",
      "activity-state-reporting",
      "selection-reason-counts",
    ],
    knownWeaknesses: [
      "not-compiled-bsp-pvs",
      "not-camera-frustum-portal-clipping",
      "not-occlusion-proof",
      "not-resource-loader",
      "not-a-renderer",
    ],
    counts: {
      regionCount: topology.regions.length,
      linkCount: topology.links.length,
      selectedRegionCount: selectedRegionIds.length,
      hiddenRegionCount: hiddenRegionIds.length,
      selectedLinkCount: selectedLinkIds.length,
      hiddenLinkCount: hiddenLinkIds.length,
      closedLinkCount: closedLinkIds.length,
      blockedLinkCount: blockedLinkIds.length,
      facingLinkCount: facingLinkIds.length,
      selectionKeyCount: unique(selection.selectionKeys).length,
    },
    coverage: {
      selectedRegionCoverage: coverage(selectedRegionIds.length, topology.regions.length),
      selectedLinkCoverage: coverage(selectedLinkIds.length, topology.links.length),
    },
  });
}

export function adaptPolyWorldPortalDebugSnapshot<T>(
  snapshot: PolyWorldPortalDebugSnapshot,
  adapter: (snapshot: PolyWorldPortalDebugSnapshot) => T,
): T {
  return adapter(snapshot);
}

function summarizeActivity(
  activity: PolyWorldPortalActivityState,
  listLimit: number | undefined,
): NonNullable<PolyWorldPortalDebugSnapshot["activity"]> {
  return {
    loadedRegionIds: summarizeList(activity.loadedRegionIds, listLimit),
    residentRegionIds: summarizeList(activity.residentRegionIds, listLimit),
    activeRegionIds: summarizeList(activity.activeRegionIds, listLimit),
    renderedRegionIds: summarizeList(activity.renderedRegionIds, listLimit),
    preloadedRegionIds: summarizeList(activity.preloadedRegionIds, listLimit),
    inactiveRegionIds: summarizeList(activity.inactiveRegionIds, listLimit),
  };
}

function reasonLinkIds(
  reasons: readonly PolyWorldSelectionReason[],
  kind: string,
): string[] {
  return unique(reasons.flatMap((reason) => reason.kind === kind ? [...(reason.linkIds ?? [])] : []));
}

function countReasonKinds(reasons: readonly PolyWorldSelectionReason[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const reason of reasons) {
    const kind = reason.kind ?? "unknown";
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => compareStrings(a, b)));
}

function summarizeList(
  values: readonly string[],
  limit: number | undefined,
): PolyWorldPortalDebugListSummary {
  const limited = limitPolyWorldDebugList(values, limit);
  return {
    values: limited.values,
    count: values.length,
    omitted: limited.omitted,
  };
}

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])];
}

function coverage(value: number, total: number): number {
  if (total <= 0) return 1;
  return value / total;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
