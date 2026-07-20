import type {
  PolyWorldBspResolvedPvs,
  PolyWorldBspResolvedViewPvs,
  PolyWorldBspTree,
  PolyWorldBspViewPvsTrace,
  PolyWorldBspViewPvsTraceEntry,
  PolyWorldBspViewPvsTraceStatus,
} from "../profiles/bsp";
import {
  summarizePolyWorldBspTopologyProof,
  type PolyWorldBspTopologyProof,
} from "../profiles/bspProof";
import type { PolyWorldProfileArtifactProof } from "../profiles/artifact";
import { limitPolyWorldDebugList } from "./limits";

export interface PolyWorldBspDebugSnapshotOptions {
  leafId?: string;
  broadPvs?: PolyWorldBspResolvedPvs;
  viewPvs?: PolyWorldBspResolvedViewPvs;
  trace?: PolyWorldBspViewPvsTrace;
  listLimit?: number;
  entryLimit?: number;
  includeTraceEntries?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PolyWorldBspDebugListSummary {
  values: readonly string[];
  count: number;
  omitted: number;
}

export interface PolyWorldBspDebugResolvedPvsSummary {
  leafIds: PolyWorldBspDebugListSummary;
  clusterIds: PolyWorldBspDebugListSummary;
  regionIds: PolyWorldBspDebugListSummary;
  linkIds: PolyWorldBspDebugListSummary;
  portalIds: PolyWorldBspDebugListSummary;
  selectionKeys: PolyWorldBspDebugListSummary;
  elementIds: PolyWorldBspDebugListSummary;
}

export interface PolyWorldBspDebugViewPvsSummary extends PolyWorldBspDebugResolvedPvsSummary {
  broadPhaseLeafIds: PolyWorldBspDebugListSummary;
  broadPhasePortalIds: PolyWorldBspDebugListSummary;
  fovDegrees: number;
}

export interface PolyWorldBspDebugTraceEntry {
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

export interface PolyWorldBspDebugSnapshot {
  schemaVersion: 1;
  artifact: PolyWorldProfileArtifactProof;
  proof: PolyWorldBspTopologyProof;
  tree: {
    leafCount: number;
    portalCount: number;
    nodeCount: number;
    maxDepth: number;
    compiler?: string;
    partition?: string;
    leafBuilder?: string;
    portalBuilder?: string;
  };
  leaves: {
    clusterCount: number;
    solidCount?: number;
    emptyCount?: number;
    outsideCount?: number;
    bakedPvsCount: number;
    pvsDensity?: number;
  };
  portals: {
    generatedCount: number;
    candidateCount?: number;
    rejectedCandidateCount?: number;
  };
  current: {
    leafId?: string;
    broadPvs?: PolyWorldBspDebugResolvedPvsSummary;
    viewPvs?: PolyWorldBspDebugViewPvsSummary;
  };
  trace?: {
    entryCount: number;
    statusCounts: Partial<Record<PolyWorldBspViewPvsTraceStatus, number>>;
    entries?: readonly PolyWorldBspDebugTraceEntry[];
    omittedEntries?: number;
  };
  metadata?: Record<string, unknown>;
}

export function createPolyWorldBspDebugSnapshot(
  tree: PolyWorldBspTree,
  options: PolyWorldBspDebugSnapshotOptions = {},
): PolyWorldBspDebugSnapshot {
  const proof = summarizePolyWorldBspTopologyProof(tree);
  const broadPvs = options.broadPvs;
  const viewPvs = options.viewPvs ?? options.trace;
  const snapshot: PolyWorldBspDebugSnapshot = {
    schemaVersion: 1,
    artifact: proof.artifact,
    proof,
    tree: {
      leafCount: proof.tree.leafCount,
      portalCount: proof.tree.portalCount,
      nodeCount: proof.tree.nodeCount,
      maxDepth: proof.tree.maxDepth,
      ...(proof.compiler.id === "authored" ? {} : { compiler: proof.compiler.id }),
      ...(proof.compiler.partition === undefined ? {} : { partition: proof.compiler.partition }),
      ...(proof.compiler.leafBuilder === undefined ? {} : { leafBuilder: proof.compiler.leafBuilder }),
      ...(proof.compiler.portalBuilder === undefined ? {} : { portalBuilder: proof.compiler.portalBuilder }),
    },
    leaves: {
      clusterCount: uniqueStrings(tree.leaves.flatMap((leaf) => leaf.clusterId === undefined ? [] : [leaf.clusterId])).length,
      ...optionalCount("solidCount", proof.leaves.solidCount),
      ...optionalCount("emptyCount", proof.leaves.emptyCount),
      ...optionalCount("outsideCount", proof.leaves.outsideCount),
      bakedPvsCount: proof.leaves.bakedPvsCount,
      ...optionalCount("pvsDensity", proof.pvs.pvsDensity),
    },
    portals: {
      generatedCount: proof.portals.generatedCount,
      ...optionalCount("candidateCount", proof.portals.candidateCount),
      ...optionalCount("rejectedCandidateCount", proof.portals.rejectedCandidateCount),
    },
    current: {
      ...stringValue("leafId", options.leafId ?? viewPvs?.leafId ?? broadPvs?.leafId),
      ...(broadPvs === undefined ? {} : { broadPvs: summarizeResolvedPvs(broadPvs, options.listLimit) }),
      ...(viewPvs === undefined ? {} : { viewPvs: summarizeViewPvs(viewPvs, options.listLimit) }),
    },
    ...(options.trace === undefined ? {} : { trace: summarizeTrace(options.trace, options) }),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };
  return snapshot;
}

export function adaptPolyWorldBspDebugSnapshot<T>(
  snapshot: PolyWorldBspDebugSnapshot,
  adapter: (snapshot: PolyWorldBspDebugSnapshot) => T,
): T {
  return adapter(snapshot);
}

function summarizeResolvedPvs(
  pvs: PolyWorldBspResolvedPvs,
  listLimit: number | undefined,
): PolyWorldBspDebugResolvedPvsSummary {
  return {
    leafIds: summarizeList(pvs.leafIds, listLimit),
    clusterIds: summarizeList(pvs.clusterIds, listLimit),
    regionIds: summarizeList(pvs.regionIds, listLimit),
    linkIds: summarizeList(pvs.linkIds, listLimit),
    portalIds: summarizeList(pvs.portalIds, listLimit),
    selectionKeys: summarizeList(pvs.selectionKeys, listLimit),
    elementIds: summarizeList(pvs.elementIds, listLimit),
  };
}

function summarizeViewPvs(
  pvs: PolyWorldBspResolvedViewPvs,
  listLimit: number | undefined,
): PolyWorldBspDebugViewPvsSummary {
  return {
    ...summarizeResolvedPvs(pvs, listLimit),
    broadPhaseLeafIds: summarizeList(pvs.broadPhaseLeafIds, listLimit),
    broadPhasePortalIds: summarizeList(pvs.broadPhasePortalIds, listLimit),
    fovDegrees: pvs.fovDegrees,
  };
}

function summarizeTrace(
  trace: PolyWorldBspViewPvsTrace,
  options: PolyWorldBspDebugSnapshotOptions,
): PolyWorldBspDebugSnapshot["trace"] {
  const statusCounts: Partial<Record<PolyWorldBspViewPvsTraceStatus, number>> = {};
  for (const entry of trace.entries) {
    statusCounts[entry.status] = (statusCounts[entry.status] ?? 0) + 1;
  }
  if (options.includeTraceEntries !== true) {
    return {
      entryCount: trace.entries.length,
      statusCounts,
    };
  }
  const limitedEntries = limitPolyWorldDebugList(trace.entries, options.entryLimit);
  return {
    entryCount: trace.entries.length,
    statusCounts,
    entries: limitedEntries.values.map(summarizeTraceEntry),
    omittedEntries: limitedEntries.omitted,
  };
}

function summarizeTraceEntry(entry: PolyWorldBspViewPvsTraceEntry): PolyWorldBspDebugTraceEntry {
  return {
    portalId: entry.portalId,
    fromLeafId: entry.fromLeafId,
    toLeafId: entry.toLeafId,
    depth: entry.depth,
    status: entry.status,
    inputVertexCount: entry.inputVertexCount,
    ...(entry.clippedVertexCount === undefined ? {} : { clippedVertexCount: entry.clippedVertexCount }),
    ...(entry.clipPlaneCount === undefined ? {} : { clipPlaneCount: entry.clipPlaneCount }),
    ...(entry.linkId === undefined ? {} : { linkId: entry.linkId }),
    ...(entry.selectionKeys === undefined ? {} : { selectionKeys: [...entry.selectionKeys] }),
  };
}

function summarizeList(values: readonly string[], limit: number | undefined): PolyWorldBspDebugListSummary {
  const limited = limitPolyWorldDebugList(values, limit);
  return {
    values: limited.values,
    count: values.length,
    omitted: limited.omitted,
  };
}


function stringValue(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

function optionalCount(key: string, value: number | undefined): Record<string, number> {
  return value === undefined ? {} : { [key]: value };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
