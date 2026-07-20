export type PolyWorldTopologyCapabilityId =
  | "world-ir"
  | "compiled-bsp-pvs"
  | "area-portals"
  | "chunk-hierarchy"
  | "resource-readiness"
  | "dom-planning"
  | "debug-proof";

export type PolyWorldTopologyCapabilityReference =
  | "polycss"
  | "x3d"
  | "openusd"
  | "quake-bsp-pvs"
  | "quake-qbsp"
  | "3d-tiles"
  | "gltf-lod";

export type PolyWorldTopologyReferenceClaimLevel =
  | "renderer-target"
  | "structure-reference"
  | "topology-proof"
  | "compiler-boundary"
  | "working-set-reference"
  | "asset-boundary";

export interface PolyWorldTopologyCapability {
  id: PolyWorldTopologyCapabilityId;
  label: string;
  packageOwns: readonly string[];
  appOwns: readonly string[];
  references: readonly PolyWorldTopologyCapabilityReference[];
  publicExports: readonly string[];
}

export interface PolyWorldTopologyReferenceContract {
  id: PolyWorldTopologyCapabilityReference;
  label: string;
  claimLevel: PolyWorldTopologyReferenceClaimLevel;
  sourceUrls: readonly string[];
  packageUses: readonly string[];
  outOfScope: readonly string[];
  compatibilityClaim: string;
}

export interface PolyWorldTopologyCapabilityContract {
  schemaVersion: 1;
  packageName: "@layoutit/polycss-world";
  references: readonly PolyWorldTopologyReferenceContract[];
  capabilities: readonly PolyWorldTopologyCapability[];
  nonGoals: readonly string[];
}

const references: readonly PolyWorldTopologyReferenceContract[] = [
  {
    id: "polycss",
    label: "PolyCSS DOM Renderer",
    claimLevel: "renderer-target",
    sourceUrls: [
      "https://github.com/LayoutitStudio/polycss",
    ],
    packageUses: [
      "prepared DOM element identity",
      "layer planning for DOM apply",
      "debug surfaces for browser examples",
    ],
    outOfScope: [
      "renderer imports",
      "custom element ownership",
      "framework bindings",
    ],
    compatibilityClaim: "PolyCSS World plans topology for PolyCSS DOM scenes, but does not render polygons.",
  },
  {
    id: "x3d",
    label: "X3D Grouping",
    claimLevel: "structure-reference",
    sourceUrls: [
      "https://www.web3d.org/specifications/X3Dv4/ISO-IEC19775-1v4-IS/Part01/concepts.html",
      "https://www.web3d.org/documents/specifications/19775-1/V3.3/Part01/components/navigation.html",
    ],
    packageUses: [
      "stable hierarchy concepts",
      "bounds as traversal hints",
      "switch-like authored selection",
    ],
    outOfScope: [
      "X3D file loading",
      "X3D node model compatibility",
      "visibility proof from grouping bounds alone",
    ],
    compatibilityClaim: "Inspired by X3D grouping behavior, not an X3D runtime or loader.",
  },
  {
    id: "openusd",
    label: "OpenUSD Scene Organization",
    claimLevel: "structure-reference",
    sourceUrls: [
      "https://openusd.org/release/glossary.html",
      "https://openusd.org/24.08/api/class_usd_payloads.html",
      "https://docs.nvidia.com/learn-openusd/latest/stage-setting/prim-property-paths.html",
    ],
    packageUses: [
      "stable element paths",
      "purpose-like traversal gates",
      "payload/load-set separation",
    ],
    outOfScope: [
      "USD composition arcs",
      "USD layer stacks",
      "USD payload loading",
    ],
    compatibilityClaim: "Uses USD-like organization lessons without claiming USD scene compatibility.",
  },
  {
    id: "quake-bsp-pvs",
    label: "Quake BSP/PVS",
    claimLevel: "topology-proof",
    sourceUrls: [
      "https://github.com/id-Software/Quake",
    ],
    packageUses: [
      "camera leaf lookup",
      "baked broad PVS",
      "view-clipped PVS traversal",
      "BSP/PVS proof diagnostics",
    ],
    outOfScope: [
      "Quake BSP file parsing",
      "Quake renderer parity",
      "gameplay movement or collision",
    ],
    compatibilityClaim: "Implements Quake-like BSP/PVS topology concepts, not Quake BSP format compatibility.",
  },
  {
    id: "quake-qbsp",
    label: "Quake QBSP/VIS Toolchain",
    claimLevel: "compiler-boundary",
    sourceUrls: [
      "https://github.com/id-Software/Quake-Tools",
    ],
    packageUses: [
      "offline compiler/proof separation",
      "PVS provenance vocabulary",
      "weakness labeling for non-VIS artifacts",
    ],
    outOfScope: [
      "full qbsp compiler parity",
      "full vis solver parity",
      "map editor CSG pipeline",
    ],
    compatibilityClaim: "Keeps compiler/proof boundaries explicit without claiming qbsp/vis equivalence.",
  },
  {
    id: "3d-tiles",
    label: "3D Tiles",
    claimLevel: "working-set-reference",
    sourceUrls: [
      "https://github.com/CesiumGS/3d-tiles/blob/main/specification/README.adoc",
      "https://docs.ogc.org/cs/22-025r4/22-025r4.html",
    ],
    packageUses: [
      "chunk hierarchy",
      "bounding-volume and availability metadata",
      "refinement and geometric-error planning",
    ],
    outOfScope: [
      "3D Tiles loading",
      "network scheduling",
      "renderer LOD replacement",
    ],
    compatibilityClaim: "Uses 3D Tiles selection ideas, not 3D Tiles streaming runtime compatibility.",
  },
  {
    id: "gltf-lod",
    label: "glTF LOD",
    claimLevel: "asset-boundary",
    sourceUrls: [
      "https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html",
    ],
    packageUses: [
      "asset-level LOD caution",
      "separation of chunk topology from concrete mesh choice",
    ],
    outOfScope: [
      "glTF loading",
      "vendor extension behavior",
      "mesh selection or replacement",
    ],
    compatibilityClaim: "References LOD concepts only to keep chunk planning independent from asset formats.",
  },
];

const capabilities: readonly PolyWorldTopologyCapability[] = [
  {
    id: "world-ir",
    label: "World IR",
    packageOwns: [
      "regions",
      "links",
      "prepared element identities",
      "element paths",
      "element hierarchy",
      "spatial element catalogs",
      "bounds",
      "purpose traversal gates",
      "resource id references",
      "selection keys",
      "source ids",
      "aliases",
      "layers",
      "tags",
      "relationship validation",
    ],
    appOwns: [
      "render element creation",
      "camera controls",
      "gameplay state",
      "asset parsing",
    ],
    references: ["polycss", "x3d", "openusd"],
    publicExports: [
      "createPolyWorldTopology",
      "resolvePolyWorldElements",
      "resolvePolyWorldElementSubtree",
      "selectPolyWorldElementsByPurpose",
      "resolvePolyWorldSpatialElementRole",
      "summarizePolyWorldSpatialElementRoles",
    ],
  },
  {
    id: "compiled-bsp-pvs",
    label: "Compiled BSP/PVS",
    packageOwns: [
      "BSP tree validation",
      "leaf lookup",
      "baked PVS bitsets",
      "broad PVS selection",
      "view-clipped PVS traversal",
      "surface role selection",
      "topology proof summaries",
    ],
    appOwns: [
      "first-person controls",
      "collision response",
      "source BSP loading",
      "Quake-compatible qbsp/vis parity",
    ],
    references: ["quake-bsp-pvs", "quake-qbsp"],
    publicExports: [
      "createPolyWorldBspTree",
      "bakePolyWorldBspPvs",
      "resolvePolyWorldBspLeaf",
      "resolvePolyWorldBspViewPvs",
      "planPolyWorldBspVisibilityFrame",
      "summarizePolyWorldBspTopologyProof",
    ],
  },
  {
    id: "area-portals",
    label: "Authored Area Portals",
    packageOwns: [
      "region-link traversal",
      "authored portal flow",
      "closed and blocked link state",
      "portal activity planning",
      "portal-flow debug traces",
    ],
    appOwns: [
      "door animation",
      "door collision",
      "room art",
      "camera controls",
    ],
    references: ["x3d", "openusd"],
    publicExports: [
      "selectPolyWorldPortalRegions",
      "resolvePolyWorldPortalFlow",
      "planPolyWorldPortalFrame",
      "planPolyWorldPortalFlowFrame",
      "createPolyWorldPortalFlowDebugSnapshot",
    ],
  },
  {
    id: "chunk-hierarchy",
    label: "Chunk Hierarchy",
    packageOwns: [
      "chunk tree validation",
      "availability",
      "content availability",
      "refinement metadata",
      "geometric error metadata",
      "budgeted traversal",
      "streaming state selection",
    ],
    appOwns: [
      "fetch scheduling",
      "cache eviction",
      "mesh replacement",
      "renderer LOD swaps",
    ],
    references: ["3d-tiles", "gltf-lod"],
    publicExports: [
      "createPolyWorldChunkTree",
      "resolvePolyWorldChunkTreeTraversal",
      "selectPolyWorldChunkStreaming",
      "planPolyWorldChunkStreamingFrame",
    ],
  },
  {
    id: "resource-readiness",
    label: "Resource Readiness",
    packageOwns: [
      "resource id references",
      "readiness load-set summaries",
      "readiness guards",
      "plan dependency reporting",
      "blocked plan debug",
    ],
    appOwns: [
      "resource fetching",
      "retry policy",
      "cache storage",
      "decode pipelines",
    ],
    references: ["openusd", "x3d"],
    publicExports: [
      "createPolyWorldResourceReadinessGuards",
      "summarizePolyWorldResourceReadiness",
      "planPolyWorldLayers",
      "planPolyWorldTransition",
    ],
  },
  {
    id: "dom-planning",
    label: "DOM Planning",
    packageOwns: [
      "state snapshots",
      "state diffs",
      "layer plans",
      "caller-record DOM apply",
      "stable apply order",
      "hidden-only apply",
    ],
    appOwns: [
      "DOM element creation",
      "renderer integration",
      "animation loops",
      "event handling",
    ],
    references: ["polycss"],
    publicExports: [
      "createPolyWorldState",
      "diffPolyWorldState",
      "planPolyWorldLayers",
      "createPolyWorldDomRegistry",
      "applyPolyWorldDomPlan",
    ],
  },
  {
    id: "debug-proof",
    label: "Debug And Proof",
    packageOwns: [
      "compact debug snapshots",
      "profile labels",
      "counts with omitted detail",
      "BSP proof metadata",
      "trace status counts",
      "plan/apply debug summaries",
    ],
    appOwns: [
      "debug UI rendering",
      "minimap drawing",
      "screenshots",
      "browser interaction harnesses",
    ],
    references: ["polycss", "quake-bsp-pvs", "3d-tiles"],
    publicExports: [
      "createPolyWorldBspDebugSnapshot",
      "createPolyWorldPortalFlowDebugSnapshot",
      "createPolyWorldChunkStreamingDebugSnapshot",
      "createPolyWorldPlanDebugSnapshot",
      "createPolyWorldDomApplyDebugSnapshot",
    ],
  },
];

const nonGoals = [
  "format loaders",
  "renderer imports",
  "framework bindings",
  "camera controls",
  "pointer lock",
  "physics",
  "gameplay systems",
  "networking",
  "fetch scheduling",
  "cache eviction",
  "source-engine parity claims without source-compatible compilers",
] as const;

export function createPolyWorldTopologyCapabilityContract(): PolyWorldTopologyCapabilityContract {
  return {
    schemaVersion: 1,
    packageName: "@layoutit/polycss-world",
    references: references.map((reference) => ({
      ...reference,
      sourceUrls: [...reference.sourceUrls],
      packageUses: [...reference.packageUses],
      outOfScope: [...reference.outOfScope],
    })),
    capabilities: capabilities.map((capability) => ({
      ...capability,
      packageOwns: [...capability.packageOwns],
      appOwns: [...capability.appOwns],
      references: [...capability.references],
      publicExports: [...capability.publicExports],
    })),
    nonGoals: [...nonGoals],
  };
}
