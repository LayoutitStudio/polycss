import type {
  PolyWorldPortalFlow,
  PolyWorldPortalFlowTraceEntry,
  PolyWorldPortalFlowTraceStatus,
} from "../profiles/portalFlow";
import {
  createPolyWorldProfileArtifactProof,
  type PolyWorldProfileArtifactProof,
} from "../profiles/artifact";
import type { PolyWorldTopology } from "../topology";
import { limitPolyWorldDebugList } from "./limits";

export interface PolyWorldPortalFlowDebugSnapshotOptions {
  listLimit?: number;
  entryLimit?: number;
  includeTraceEntries?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PolyWorldPortalFlowDebugListSummary {
  values: readonly string[];
  count: number;
  omitted: number;
}

export interface PolyWorldPortalFlowDebugTraceEntry {
  portalId: string;
  linkId: string;
  fromRegionId: string;
  toRegionId: string;
  depth: number;
  status: PolyWorldPortalFlowTraceStatus;
  inputVertexCount: number;
  clippedVertexCount?: number;
  clipPlaneCount?: number;
  selectionKeys?: readonly string[];
}

export interface PolyWorldPortalFlowDebugSnapshot {
  schemaVersion: 1;
  proof: PolyWorldProfileArtifactProof;
  topology: {
    regionCount: number;
    linkCount: number;
    profile: "portal-flow";
  };
  current: {
    regionId?: string;
  };
  regions: {
    selectedRegionIds: PolyWorldPortalFlowDebugListSummary;
    hiddenRegionIds: PolyWorldPortalFlowDebugListSummary;
  };
  links: {
    selectedLinkIds: PolyWorldPortalFlowDebugListSummary;
    hiddenLinkIds: PolyWorldPortalFlowDebugListSummary;
  };
  portals: {
    selectedPortalIds: PolyWorldPortalFlowDebugListSummary;
    tracedPortalIds: PolyWorldPortalFlowDebugListSummary;
    rejectedPortalIds: PolyWorldPortalFlowDebugListSummary;
  };
  selection: {
    selectionKeys: PolyWorldPortalFlowDebugListSummary;
    reasonLabels: PolyWorldPortalFlowDebugListSummary;
    reasonKinds: Readonly<Record<string, number>>;
  };
  trace?: {
    entryCount: number;
    statusCounts: Partial<Record<PolyWorldPortalFlowTraceStatus, number>>;
    entries?: readonly PolyWorldPortalFlowDebugTraceEntry[];
    omittedEntries?: number;
  };
  metadata?: Record<string, unknown>;
}

export function createPolyWorldPortalFlowDebugSnapshot(
  topology: PolyWorldTopology,
  flow: PolyWorldPortalFlow,
  options: PolyWorldPortalFlowDebugSnapshotOptions = {},
): PolyWorldPortalFlowDebugSnapshot {
  const selectedRegionIds = unique(flow.regionIds);
  const selectedRegionSet = new Set(selectedRegionIds);
  const selectedLinkIds = unique(flow.linkIds);
  const selectedLinkSet = new Set(selectedLinkIds);
  const selectedPortalIds = unique(flow.portalIds);
  const selectedPortalSet = new Set(selectedPortalIds);
  const tracedPortalIds = unique(flow.trace?.map((entry) => entry.portalId));
  const rejectedPortalIds = tracedPortalIds.filter((portalId) => !selectedPortalSet.has(portalId));
  const reasons = flow.selection.reasons ?? [];

  return {
    schemaVersion: 1,
    proof: createPolyWorldPortalFlowArtifactProof(topology, flow),
    topology: {
      regionCount: topology.regions.length,
      linkCount: topology.links.length,
      profile: "portal-flow",
    },
    current: {
      ...(flow.currentRegionId === undefined ? {} : { regionId: flow.currentRegionId }),
    },
    regions: {
      selectedRegionIds: summarizeList(selectedRegionIds, options.listLimit),
      hiddenRegionIds: summarizeList(
        topology.regions.map((region) => region.id).filter((regionId) => !selectedRegionSet.has(regionId)),
        options.listLimit,
      ),
    },
    links: {
      selectedLinkIds: summarizeList(selectedLinkIds, options.listLimit),
      hiddenLinkIds: summarizeList(
        topology.links.map((link) => link.id).filter((linkId) => !selectedLinkSet.has(linkId)),
        options.listLimit,
      ),
    },
    portals: {
      selectedPortalIds: summarizeList(selectedPortalIds, options.listLimit),
      tracedPortalIds: summarizeList(tracedPortalIds, options.listLimit),
      rejectedPortalIds: summarizeList(rejectedPortalIds, options.listLimit),
    },
    selection: {
      selectionKeys: summarizeList(unique(flow.selectionKeys), options.listLimit),
      reasonLabels: summarizeList(unique(reasons.map((reason) => reason.label)), options.listLimit),
      reasonKinds: countReasonKinds(reasons),
    },
    ...(flow.trace === undefined ? {} : { trace: summarizeTrace(flow.trace, options) }),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };
}

export function createPolyWorldPortalFlowArtifactProof(
  topology: PolyWorldTopology,
  flow: PolyWorldPortalFlow,
): PolyWorldProfileArtifactProof {
  const selectedRegionIds = unique(flow.regionIds);
  const selectedLinkIds = unique(flow.linkIds);
  const selectedPortalIds = unique(flow.portalIds);
  const selectedPortalSet = new Set(selectedPortalIds);
  const tracedPortalIds = unique(flow.trace?.map((entry) => entry.portalId));
  const rejectedPortalIds = tracedPortalIds.filter((portalId) => !selectedPortalSet.has(portalId));
  return createPolyWorldProfileArtifactProof({
    profile: "portal-flow",
    artifactKind: "authored-area-portal-flow",
    sourceKind: "authored-runtime-selection",
    producedBy: "resolvePolyWorldPortalFlow",
    guarantees: [
      "authored-region-link-traversal",
      "camera-frustum-portal-clipping",
      "closed-blocked-link-state",
      "trace-status-counts",
    ],
    knownWeaknesses: [
      "not-compiled-bsp-pvs",
      "not-occlusion-proof",
      "not-resource-loader",
      "not-a-renderer",
    ],
    counts: {
      regionCount: topology.regions.length,
      linkCount: topology.links.length,
      selectedRegionCount: selectedRegionIds.length,
      hiddenRegionCount: topology.regions.length - selectedRegionIds.length,
      selectedLinkCount: selectedLinkIds.length,
      hiddenLinkCount: topology.links.length - selectedLinkIds.length,
      selectedPortalCount: selectedPortalIds.length,
      tracedPortalCount: tracedPortalIds.length,
      rejectedPortalCount: rejectedPortalIds.length,
      traceEntryCount: flow.trace?.length ?? 0,
    },
    coverage: {
      selectedRegionCoverage: coverage(selectedRegionIds.length, topology.regions.length),
      selectedLinkCoverage: coverage(selectedLinkIds.length, topology.links.length),
      selectedPortalCoverage: coverage(selectedPortalIds.length, tracedPortalIds.length),
    },
  });
}

export function adaptPolyWorldPortalFlowDebugSnapshot<T>(
  snapshot: PolyWorldPortalFlowDebugSnapshot,
  adapter: (snapshot: PolyWorldPortalFlowDebugSnapshot) => T,
): T {
  return adapter(snapshot);
}

function summarizeTrace(
  entries: readonly PolyWorldPortalFlowTraceEntry[],
  options: PolyWorldPortalFlowDebugSnapshotOptions,
): NonNullable<PolyWorldPortalFlowDebugSnapshot["trace"]> {
  const statusCounts: Partial<Record<PolyWorldPortalFlowTraceStatus, number>> = {};
  for (const entry of entries) {
    statusCounts[entry.status] = (statusCounts[entry.status] ?? 0) + 1;
  }
  if (options.includeTraceEntries !== true) {
    return {
      entryCount: entries.length,
      statusCounts,
    };
  }
  const limitedEntries = limitPolyWorldDebugList(entries, options.entryLimit);
  return {
    entryCount: entries.length,
    statusCounts,
    entries: limitedEntries.values.map(summarizeTraceEntry),
    omittedEntries: limitedEntries.omitted,
  };
}

function summarizeTraceEntry(entry: PolyWorldPortalFlowTraceEntry): PolyWorldPortalFlowDebugTraceEntry {
  return {
    portalId: entry.portalId,
    linkId: entry.linkId,
    fromRegionId: entry.fromRegionId,
    toRegionId: entry.toRegionId,
    depth: entry.depth,
    status: entry.status,
    inputVertexCount: entry.inputVertexCount,
    ...(entry.clippedVertexCount === undefined ? {} : { clippedVertexCount: entry.clippedVertexCount }),
    ...(entry.clipPlaneCount === undefined ? {} : { clipPlaneCount: entry.clipPlaneCount }),
    ...(entry.selectionKeys === undefined ? {} : { selectionKeys: [...entry.selectionKeys] }),
  };
}

function summarizeList(
  values: readonly string[],
  limit: number | undefined,
): PolyWorldPortalFlowDebugListSummary {
  const limited = limitPolyWorldDebugList(values, limit);
  return {
    values: limited.values,
    count: values.length,
    omitted: limited.omitted,
  };
}

function countReasonKinds(reasons: readonly { kind?: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const reason of reasons) {
    const kind = reason.kind ?? "unknown";
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => compareStrings(a, b)));
}

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])];
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function coverage(count: number, total: number): number {
  if (total === 0) return 0;
  return count / total;
}
