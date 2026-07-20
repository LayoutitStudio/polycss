import type {
  PolyWorldBspChild,
  PolyWorldBspDiagnostic,
  PolyWorldBspTree,
  PolyWorldBspTreeInput,
} from "./bsp";
import { decodePolyWorldBspPvsLeafIds } from "./bsp";
import { validatePolyWorldBspTree } from "./bsp";
import {
  createPolyWorldProfileArtifactProof,
  type PolyWorldProfileArtifactProof,
} from "./artifact";

export type PolyWorldBspTopologyProofProfile = "bsp-pvs";

export type PolyWorldBspPvsMethod =
  | "none"
  | "exact-baked"
  | "portal-clipped-baked"
  | "authored-baked"
  | "authored-loose"
  | "debug-loose";

export type PolyWorldBspPvsCompleteness = "none" | "partial" | "complete";

export type PolyWorldBspPvsProofLevel =
  | "uncertified"
  | "certified-tree-only"
  | "portal-clipped-baked-pvs"
  | "exact-baked-pvs"
  | "authored-baked-pvs"
  | "partial-baked-pvs"
  | "authored-loose-pvs"
  | "debug-loose-pvs";

export type PolyWorldBspTopologyProofGuarantee =
  | "validated-tree-root-references"
  | "validated-portal-endpoints"
  | "validated-portal-leaf-adjacency"
  | "validated-pvs-bitset-widths"
  | "validated-pvs-direct-adjacency"
  | "validated-pvs-metadata";

export interface PolyWorldBspTopologyProof {
  schemaVersion: 1;
  profile: PolyWorldBspTopologyProofProfile;
  artifact: PolyWorldProfileArtifactProof;
  compiler: {
    id: string;
    compiled: boolean;
    partition?: string;
    leafBuilder?: string;
    portalBuilder?: string;
  };
  tree: {
    leafCount: number;
    portalCount: number;
    nodeCount: number;
    maxDepth: number;
    rootLeafRefCount: number;
    uniqueRootLeafRefCount: number;
    referencesEveryLeafOnce: boolean;
  };
  leaves: {
    solidCount?: number;
    emptyCount?: number;
    outsideCount?: number;
    renderableCount: number;
    bakedPvsCount: number;
    bakedPvsCoverage: number;
  };
  portals: {
    generatedCount: number;
    candidateCount?: number;
    rejectedCandidateCount?: number;
  };
  pvs: {
    level: PolyWorldBspPvsProofLevel;
    method: PolyWorldBspPvsMethod;
    source: string;
    completeness: PolyWorldBspPvsCompleteness;
    indexed: boolean;
    indexLeafCount: number;
    indexPortalCount: number;
    indexLeafCoverage: number;
    indexPortalCoverage: number;
    bakedLeafCount: number;
    bakedLeafCoverage: number;
    pvsDensity?: number;
    complete: boolean;
  };
  evidence: {
    validatedBy: "createPolyWorldBspTree";
    guarantees: readonly PolyWorldBspTopologyProofGuarantee[];
  };
}

export interface PolyWorldBspTopologyCertification {
  schemaVersion: 1;
  profile: PolyWorldBspTopologyProofProfile;
  certified: boolean;
  proof: PolyWorldBspTopologyProof;
  diagnostics: readonly PolyWorldBspDiagnostic[];
}

export function certifyPolyWorldBspTopology(
  tree: PolyWorldBspTree,
): PolyWorldBspTopologyCertification {
  const diagnostics = validatePolyWorldBspTree(treeInputFromTree(tree));
  return {
    schemaVersion: 1,
    profile: "bsp-pvs",
    certified: diagnostics.length === 0,
    proof: summarizePolyWorldBspTopologyProof(tree),
    diagnostics,
  };
}

export function summarizePolyWorldBspTopologyProof(
  tree: PolyWorldBspTree,
): PolyWorldBspTopologyProof {
  const diagnostics = validatePolyWorldBspTree(treeInputFromTree(tree));
  const certified = diagnostics.length === 0;
  const shape = summarizeBspTreeShape(tree.root);
  const rootLeafIds = collectRootLeafIds(tree.root);
  const uniqueRootLeafIds = uniqueStrings(rootLeafIds);
  const solidLeafIdsFromData = leafIdsFromData(tree, "solidLeafIds");
  const outsideLeafIdsFromData = leafIdsFromData(tree, "outsideLeafIds");
  const emptyLeafIdsFromData = leafIdsFromData(tree, "emptyLeafIds");
  const hasSolidLeafFlags = tree.leaves.some((leaf) => typeof leaf.data?.solid === "boolean");
  const hasOutsideLeafFlags = tree.leaves.some((leaf) => leaf.data?.outside === true);
  const solidLeafIds = solidLeafIdsFromData
    ?? tree.leaves.filter((leaf) => leaf.data?.solid === true).map((leaf) => leaf.id);
  const outsideLeafIds = outsideLeafIdsFromData
    ?? tree.leaves.filter((leaf) => leaf.data?.outside === true).map((leaf) => leaf.id);
  const emptyLeafIds = emptyLeafIdsFromData
    ?? (tree.leaves.some((leaf) => typeof leaf.data?.solid === "boolean")
      ? tree.leaves.filter((leaf) => leaf.data?.solid === false).map((leaf) => leaf.id)
      : undefined);
  const solidLeafIdSet = new Set(solidLeafIds);
  const outsideLeafIdSet = new Set(outsideLeafIds);
  const bakedPvsCount = tree.leaves.filter((leaf) => leaf.pvs !== undefined).length;
  const pvsDensity = calculateBspPvsDensity(tree);
  const indexLeafCount = tree.pvsIndex?.leafIds.length ?? 0;
  const indexPortalCount = tree.pvsIndex?.portalIds.length ?? 0;
  const compilerId = stringData(tree.data, "compiler") ?? "authored";
  const compiled = tree.data?.compiled === true;
  const referencesEveryLeafOnce = rootLeafIds.length === tree.leaves.length && uniqueRootLeafIds.length === tree.leaves.length;
  const bakedPvsCoverage = coverage(bakedPvsCount, tree.leaves.length);
  const indexLeafCoverage = coverage(indexLeafCount, tree.leaves.length);
  const indexPortalCoverage = coverage(indexPortalCount, tree.portals.length);
  const pvsComplete = tree.pvsIndex !== undefined && bakedPvsCount === tree.leaves.length;
  const pvsCompleteness = resolveBspPvsCompleteness(tree, bakedPvsCount, pvsComplete);
  const pvsMethod = resolveBspPvsMethod(tree, bakedPvsCount, pvsComplete);
  const pvsSource = resolveBspPvsSource(tree, compilerId, pvsMethod);
  const pvsLevel = resolveBspPvsProofLevel(certified, pvsMethod, pvsCompleteness);
  const hasPvsData = tree.pvsIndex !== undefined && bakedPvsCount > 0;
  const artifactGuarantees = certified
    ? artifactGuaranteesForBspProof({ compiled, hasPvsData, pvsComplete, pvsMethod })
    : [];
  const evidenceGuarantees = certified
    ? evidenceGuaranteesForBspProof(hasPvsData)
    : [];

  return {
    schemaVersion: 1,
    profile: "bsp-pvs",
    artifact: createPolyWorldProfileArtifactProof({
      profile: "bsp-pvs",
      artifactKind: "compiled-bsp-pvs",
      sourceKind: compiled ? "compiled" : "authored",
      producedBy: compilerId,
      guarantees: artifactGuarantees,
      knownWeaknesses: [
        ...(certified ? [] : ["bsp-certification-failed"]),
        ...(pvsMethod === "none" ? ["pvs-unavailable"] : []),
        ...(pvsMethod === "authored-loose" || pvsMethod === "debug-loose" ? ["loose-pvs-not-full-vis"] : []),
        ...(pvsCompleteness === "partial" ? ["partial-pvs-coverage"] : []),
        "not-quake-bsp-format",
        "not-full-qbsp-vis-parity",
        "not-a-renderer",
        "not-gameplay-collision",
      ],
      counts: {
        leafCount: tree.leaves.length,
        portalCount: tree.portals.length,
        nodeCount: shape.nodeCount,
        rootLeafRefCount: rootLeafIds.length,
        uniqueRootLeafRefCount: uniqueRootLeafIds.length,
        bakedPvsCount,
        indexLeafCount,
        indexPortalCount,
        pvsCompleteCount: pvsComplete ? bakedPvsCount : 0,
        renderableLeafCount: tree.leaves.filter((leaf) => !solidLeafIdSet.has(leaf.id) && !outsideLeafIdSet.has(leaf.id)).length,
      },
      coverage: {
        rootLeafReferenceCoverage: coverage(uniqueRootLeafIds.length, tree.leaves.length),
        bakedPvsCoverage,
        indexLeafCoverage,
        indexPortalCoverage,
        ...(pvsDensity === undefined ? {} : { pvsDensity }),
      },
      diagnostics,
    }),
    compiler: {
      id: compilerId,
      compiled,
      ...optionalString("partition", stringData(tree.data, "partition")),
      ...optionalString("leafBuilder", stringData(tree.data, "leafBuilder")),
      ...optionalString("portalBuilder", stringData(tree.data, "portalBuilder")),
    },
    tree: {
      leafCount: tree.leaves.length,
      portalCount: tree.portals.length,
      nodeCount: shape.nodeCount,
      maxDepth: shape.maxDepth,
      rootLeafRefCount: rootLeafIds.length,
      uniqueRootLeafRefCount: uniqueRootLeafIds.length,
      referencesEveryLeafOnce,
    },
    leaves: {
      ...optionalCount("solidCount", solidLeafIdsFromData !== undefined || hasSolidLeafFlags ? solidLeafIds.length : undefined),
      ...optionalCount("emptyCount", emptyLeafIds?.length),
      ...optionalCount("outsideCount", outsideLeafIdsFromData !== undefined || hasOutsideLeafFlags ? outsideLeafIds.length : undefined),
      renderableCount: tree.leaves.filter((leaf) => !solidLeafIdSet.has(leaf.id) && !outsideLeafIdSet.has(leaf.id)).length,
      bakedPvsCount,
      bakedPvsCoverage,
    },
    portals: {
      generatedCount: tree.portals.length,
      ...optionalCount("candidateCount", numberData(tree.data, "portalCandidateCount")),
      ...optionalCount("rejectedCandidateCount", numberData(tree.data, "rejectedPortalCandidateCount")),
    },
    pvs: {
      level: pvsLevel,
      method: pvsMethod,
      source: pvsSource,
      completeness: pvsCompleteness,
      indexed: tree.pvsIndex !== undefined,
      indexLeafCount,
      indexPortalCount,
      indexLeafCoverage,
      indexPortalCoverage,
      bakedLeafCount: bakedPvsCount,
      bakedLeafCoverage: bakedPvsCoverage,
      ...optionalCount("pvsDensity", pvsDensity),
      complete: pvsComplete,
    },
    evidence: {
      validatedBy: "createPolyWorldBspTree",
      guarantees: evidenceGuarantees,
    },
  };
}

function treeInputFromTree(tree: PolyWorldBspTree): PolyWorldBspTreeInput {
  return {
    root: tree.root,
    leaves: tree.leaves,
    portals: tree.portals,
    ...(tree.pvsIndex === undefined ? {} : { pvsIndex: tree.pvsIndex }),
    ...(tree.data === undefined ? {} : { data: tree.data }),
  };
}

function summarizeBspTreeShape(child: PolyWorldBspChild, depth = 0): { nodeCount: number; maxDepth: number } {
  if ("leafId" in child) return { nodeCount: 0, maxDepth: depth };
  const front = summarizeBspTreeShape(child.front, depth + 1);
  const back = summarizeBspTreeShape(child.back, depth + 1);
  return {
    nodeCount: 1 + front.nodeCount + back.nodeCount,
    maxDepth: Math.max(front.maxDepth, back.maxDepth),
  };
}

function collectRootLeafIds(child: PolyWorldBspChild): string[] {
  if ("leafId" in child) return [child.leafId];
  return [...collectRootLeafIds(child.back), ...collectRootLeafIds(child.front)];
}

function calculateBspPvsDensity(tree: PolyWorldBspTree): number | undefined {
  const leavesWithPvs = tree.leaves.filter((leaf) => leaf.pvs !== undefined);
  if (leavesWithPvs.length === 0 || tree.leaves.length === 0) return undefined;
  let visibleLeafCount = 0;
  for (const leaf of leavesWithPvs) {
    if (leaf.pvs === undefined) continue;
    visibleLeafCount += tree.pvsIndex === undefined
      ? countBits(leaf.pvs.leafBits)
      : decodePolyWorldBspPvsLeafIds(tree.pvsIndex, leaf.pvs).length;
  }
  return visibleLeafCount / (leavesWithPvs.length * tree.leaves.length);
}

function leafIdsFromData(tree: PolyWorldBspTree, key: string): string[] | undefined {
  const value = tree.data?.[key];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? uniqueStrings(value)
    : undefined;
}

function stringData(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberData(data: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanData(data: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = data?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function resolveBspPvsCompleteness(
  tree: PolyWorldBspTree,
  bakedPvsCount: number,
  pvsComplete: boolean,
): PolyWorldBspPvsCompleteness {
  if (tree.pvsIndex === undefined || bakedPvsCount === 0) return "none";
  return pvsComplete ? "complete" : "partial";
}

function resolveBspPvsMethod(
  tree: PolyWorldBspTree,
  bakedPvsCount: number,
  pvsComplete: boolean,
): PolyWorldBspPvsMethod {
  if (tree.pvsIndex === undefined || bakedPvsCount === 0) return "none";
  const authoredMethod = stringData(tree.data, "pvsMethod");
  if (isBspPvsMethod(authoredMethod)) return authoredMethod;
  if (booleanData(tree.data, "pvsGenerated") === true || stringData(tree.data, "pvsSource") === "polycss-world") {
    return "portal-clipped-baked";
  }
  return pvsComplete ? "authored-baked" : "authored-loose";
}

function resolveBspPvsSource(
  tree: PolyWorldBspTree,
  compilerId: string,
  pvsMethod: PolyWorldBspPvsMethod,
): string {
  const source = stringData(tree.data, "pvsSource");
  if (source !== undefined) return source;
  if (pvsMethod === "none") return "none";
  if (pvsMethod === "portal-clipped-baked") return "polycss-world";
  if (pvsMethod === "exact-baked") return compilerId;
  if (pvsMethod === "debug-loose") return "debug";
  return compilerId === "authored" ? "authored" : compilerId;
}

function resolveBspPvsProofLevel(
  certified: boolean,
  method: PolyWorldBspPvsMethod,
  completeness: PolyWorldBspPvsCompleteness,
): PolyWorldBspPvsProofLevel {
  if (!certified) return "uncertified";
  if (method === "none") return "certified-tree-only";
  if (method === "portal-clipped-baked") return "portal-clipped-baked-pvs";
  if (method === "debug-loose") return "debug-loose-pvs";
  if (method === "authored-loose") return "authored-loose-pvs";
  if (completeness !== "complete") return "partial-baked-pvs";
  if (method === "exact-baked") return "exact-baked-pvs";
  return "authored-baked-pvs";
}

function isBspPvsMethod(value: string | undefined): value is PolyWorldBspPvsMethod {
  return value === "none" ||
    value === "exact-baked" ||
    value === "portal-clipped-baked" ||
    value === "authored-baked" ||
    value === "authored-loose" ||
    value === "debug-loose";
}

function artifactGuaranteesForBspProof(options: {
  compiled: boolean;
  hasPvsData: boolean;
  pvsComplete: boolean;
  pvsMethod: PolyWorldBspPvsMethod;
}): string[] {
  const guarantees = [
    "tree-root-leaf-reference-audit",
    "portal-endpoint-audit",
    "portal-leaf-adjacency-audit",
  ];
  if (options.compiled && options.hasPvsData && options.pvsMethod !== "authored-loose" && options.pvsMethod !== "debug-loose") {
    guarantees.push("compiled-bsp-pvs");
  }
  if (!options.hasPvsData) return guarantees;
  guarantees.push(
    "pvs-bitset-width-audit",
    "pvs-direct-adjacency-audit",
    "pvs-metadata-decode-audit",
  );
  if (options.pvsMethod === "portal-clipped-baked") guarantees.push("portal-clipped-baked-pvs");
  if (
    options.pvsComplete &&
    (options.pvsMethod === "exact-baked" || options.pvsMethod === "authored-baked")
  ) {
    guarantees.push("baked-pvs-bitsets");
  }
  return guarantees;
}

function evidenceGuaranteesForBspProof(hasPvsData: boolean): PolyWorldBspTopologyProofGuarantee[] {
  const guarantees: PolyWorldBspTopologyProofGuarantee[] = [
    "validated-tree-root-references",
    "validated-portal-endpoints",
    "validated-portal-leaf-adjacency",
  ];
  if (hasPvsData) {
    guarantees.push(
      "validated-pvs-bitset-widths",
      "validated-pvs-direct-adjacency",
      "validated-pvs-metadata",
    );
  }
  return guarantees;
}

function optionalString(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

function optionalCount(key: string, value: number | undefined): Record<string, number> {
  return value === undefined ? {} : { [key]: value };
}

function coverage(count: number, total: number): number {
  if (total === 0) return 0;
  return count / total;
}

function countBits(bits: Uint32Array): number {
  let count = 0;
  for (const value of bits) count += countBits32(value);
  return count;
}

function countBits32(value: number): number {
  let remaining = value >>> 0;
  let count = 0;
  while (remaining !== 0) {
    remaining &= remaining - 1;
    count += 1;
  }
  return count;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
