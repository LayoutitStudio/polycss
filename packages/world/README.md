# @layoutit/polycss-world

Topology, state, planning, and DOM-apply helpers for authored PolyCSS worlds. Framework-agnostic: no renderer imports, no React/Vue wrappers, no browser globals.

```bash
pnpm add @layoutit/polycss-world @layoutit/polycss
```

## Capability Contract

Use `createPolyWorldTopologyCapabilityContract` when docs, debug UIs, examples, or tests need to show what PolyCSS World owns. The contract is data-only: it maps reference lessons to package-owned topology behavior and app-owned runtime behavior without importing those formats or engines.

```ts
import { createPolyWorldTopologyCapabilityContract } from "@layoutit/polycss-world";

const contract = createPolyWorldTopologyCapabilityContract();

console.log(contract.capabilities.map((capability) => capability.id));
// [
//   "world-ir",
//   "compiled-bsp-pvs",
//   "area-portals",
//   "chunk-hierarchy",
//   "resource-readiness",
//   "dom-planning",
//   "debug-proof",
// ]
console.log(contract.references.find((reference) => reference.id === "quake-bsp-pvs")?.compatibilityClaim);
// Implements Quake-like BSP/PVS topology concepts, not Quake BSP format compatibility.
console.log(contract.references.find((reference) => reference.id === "quake-bsp-pvs")?.claimLevel);
// "topology-proof"
```

Each reference also carries `claimLevel` and `sourceUrls` so debug panels and docs can show provenance without upgrading the claim. The reference split is explicit:

| Reference | Claim level | PolyCSS World uses it for | Still app-owned or out of scope |
|---|---|---|---|
| X3D | `structure-reference` | Authored grouping, bounds, transform/collision/inline boundaries, and LOD as scene-structure concepts. | X3D parsing, X3D runtime, browser plugin semantics, visibility proof from grouping alone. |
| OpenUSD | `structure-reference` | Stable element identity, payload/readiness separation, and purpose-like traversal gates. | USD composition, layering, payload loading, scenegraph runtime. |
| Quake BSP/PVS | `topology-proof` | Camera leaf lookup, baked broad PVS, view-clipped PVS, solid/outside/detail separation, and topology proof. | Quake BSP loading, full `qbsp`/`vis` parity, player controls. |
| Quake QBSP/VIS | `compiler-boundary` | Offline compiler/proof separation and provenance vocabulary. | Full compiler or VIS solver parity. |
| 3D Tiles | `working-set-reference` | Chunk hierarchy, availability, content availability, refinement, geometric error, and traversal budgets. | Fetch scheduling, cache eviction, mesh replacement, renderer LOD swaps. |
| glTF LOD | `asset-boundary` | A cautionary asset-level LOD reference for what not to make chunk traversal depend on. | glTF loading or vendor extension behavior. |

Profile debug snapshots expose a shared proof envelope so apps can show what a frame actually proves without overclaiming:

```ts
console.log(bspDebug.artifact.profile); // "bsp-pvs"
console.log(portalDebug.proof.profile); // "area-portals"
console.log(portalFlowDebug.proof.profile); // "portal-flow"
console.log(chunkDebug.proof.knownWeaknesses); // no fetch/cache/render ownership
```

BSP/PVS proof is the strongest profile and includes BSP-specific tree, leaf, portal, and PVS fields. Authored area portals, portal flow, and chunk traversal intentionally expose weaker proof envelopes: they are useful topology/planning evidence, not compiled occlusion or loader proof. Area portals prove authored region/link selection and link-state reporting; portal flow adds camera-frustum portal clipping.

Frame helpers expose the same proof boundary as `frame.artifact` even when verbose debug snapshots are disabled. Use debug snapshots for capped lists and panels; use frame artifacts for stable assertions and logs that only need the profile, guarantees, weaknesses, counts, and coverage.

Use `auditPolyWorldProfileArtifactProof` when imported, serialized, or debug-forwarded proof envelopes need to be checked before a panel or test trusts them. The audit validates the final proof fields, so a canonicalized proof can carry diagnostics about stripped input claims and still be valid, while a forged portal/chunk proof that currently claims BSP/PVS guarantees fails:

```ts
import {
  auditPolyWorldProfileArtifactProof,
  createPolyWorldProfileArtifactBundle,
} from "@layoutit/polycss-world";

const audit = auditPolyWorldProfileArtifactProof(frame.artifact);

if (!audit.valid) {
  console.warn(audit.diagnostics);
}

const artifactRef = document.profileArtifactsById.get("gallery-bsp");

if (artifactRef) {
  const bundle = createPolyWorldProfileArtifactBundle({
    entries: [{ ref: artifactRef, proof: frame.artifact }],
  });

  console.log(bundle.entriesById.get("gallery-bsp")?.valid);
}
```

Use artifact bundles when a frame proof needs to be tied back to a document artifact ref before a debug panel, regression test, or app-level frame runner trusts it. Bundle audits catch profile, artifact kind, source kind, producer, duplicate-id, and proof-audit mismatches without loading files or touching renderer DOM.

## World Document

Use `createPolyWorldDocument` when an authored world needs one validated data boundary for topology plus profile refs, resource declarations, and named plan policies. The document layer is still data-only: it normalizes `createPolyWorldTopology`, indexes references, and exposes summary counts without loading formats, creating BSPs, fetching resources, creating DOM, or choosing renderer meshes.

```ts
import { createPolyWorldDocument } from "@layoutit/polycss-world";

const document = createPolyWorldDocument({
  id: "gallery-world",
  topology: {
    regions: [
      { id: "gallery", bounds: { min: [0, 0, 0], max: [8, 8, 3] } },
    ],
    elements: [
      {
        id: "gallery-shell",
        path: "/World/Gallery/Shell",
        regionIds: ["gallery"],
        resourceIds: ["mesh:gallery-shell"],
        layers: ["world"],
      },
    ],
  },
  capabilityIds: ["world-ir", "compiled-bsp-pvs", "resource-readiness"],
  profileArtifacts: [
    {
      id: "gallery-bsp",
      profile: "bsp-pvs",
      artifactKind: "compiled-bsp-pvs",
      sourceKind: "compiled",
      producedBy: "brush-bsp",
      elementIds: ["gallery-shell"],
    },
  ],
  resources: [
    { id: "mesh:gallery-shell", state: "ready", elementIds: ["gallery-shell"] },
  ],
  planPolicies: [
    { id: "render-world", layer: "world", elementLayers: ["world"] },
  ],
});

console.log(document.topology.elementsByPath.get("/World/Gallery/Shell")?.id);
console.log(document.profileArtifactsById.get("gallery-bsp")?.profile);
console.log(document.summary.capabilityIds);
```

Invalid profile refs, disabled profile capabilities, duplicate resource ids, unknown element/spatial-element references, invalid capability ids, and malformed plan policies fail at document creation. If `capabilityIds` is narrowed, profile artifact refs must match the enabled capability: `bsp-pvs` requires `compiled-bsp-pvs`, portal profiles require `area-portals`, and chunk traversal requires `chunk-hierarchy`. Use the lower-level topology/profile/planner APIs when the app already has those records split across its own authoring pipeline.

Topology validation has a baseline mode and an opt-in authored-world strict mode. Baseline validation catches broken ids, missing endpoints, malformed bounds, invalid element references, and parent/container cycles. Strict mode adds authoring checks such as spatially referenced regions, connected region graphs, and element layers, while still allowing individual checks to be disabled for imported or partial data:

```ts
const world = createPolyWorldTopology({
  validation: {
    strict: true,
    requireRegionBounds: true,
  },
  regions: [
    { id: "studio", bounds: { min: [0, 0, 0], max: [8, 8, 3] } },
    { id: "gallery", bounds: { min: [8, 0, 0], max: [16, 8, 3] } },
  ],
  links: [
    { id: "studio-gallery", fromRegionId: "studio", toRegionId: "gallery" },
  ],
  elements: [
    { id: "studio-shell", regionIds: ["studio"], layers: ["world"] },
    { id: "gallery-shell", regionIds: ["gallery"], layers: ["world"] },
  ],
});
```

Elements can also describe authored-world graph metadata without becoming renderer nodes. Use `path` for a stable scene path, `parentId` / `containerId` for graph relationships, `bounds` and `transform` for app-authored spatial metadata, `purposes` for traversal gates, and `resourceIds` for app-owned readiness checks. PolyCSS World validates and indexes these fields, but it does not compute renderer transforms or create DOM:

```ts
const world = createPolyWorldTopology({
  regions: [{ id: "gallery", bounds: { min: [0, 0, 0], max: [8, 8, 3] } }],
  elements: [
    {
      id: "gallery-root",
      path: "/World/Gallery",
      selectionKeys: ["root:gallery"],
      purposes: ["render"],
      layers: ["resident"],
    },
    {
      id: "gallery-wall",
      path: "/World/Gallery/Wall",
      parentId: "gallery-root",
      containerId: "gallery-root",
      regionIds: ["gallery"],
      bounds: { min: [0, 0, 0], max: [8, 0.2, 3] },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      purposes: ["render", "occluder"],
      resourceIds: ["mesh:gallery-wall"],
      layers: ["world"],
    },
  ],
});
```

Use `resolvePolyWorldElementSubtree` for X3D/OpenUSD-style graph traversal over prepared identities, and `selectPolyWorldElementsByPurpose` when a planner needs a purpose-gated selection:

```ts
const subtree = resolvePolyWorldElementSubtree(world, ["gallery-root"], {
  purposes: ["render"],
});

const renderSelection = selectPolyWorldElementsByPurpose(world, ["render"], {
  includeDescendants: true,
  reasonLabel: "render-purpose",
});
```

The graph layer is still data-only. It does not load resources, choose LOD meshes, evaluate animation, create elements, or inspect the browser DOM.

Spatial element catalogs let authors describe topology-relevant surfaces and roots without turning PolyCSS World into a renderer. A spatial element can point at an app element, region, BSP leaf, bounds, polygon vertices, resource ids, and a role such as `root`, `shell`, `opening`, `detail`, or `prop`. The package validates those records and indexes them for portal/BSP/chunk profiles and debug panels:

```ts
const world = createPolyWorldTopology({
  regions: [{ id: "gallery", bounds: { min: [0, 0, 0], max: [8, 8, 3] } }],
  elements: [{ id: "gallery-shell", regionIds: ["gallery"], layers: ["world"] }],
  spatialElements: [
    {
      id: "gallery-floor",
      elementId: "gallery-shell",
      regionId: "gallery",
      role: "shell",
      visibility: "structural",
      resourceIds: ["texture:gallery-floor"],
      vertices: [
        [0, 0, 0],
        [8, 0, 0],
        [8, 8, 0],
        [0, 8, 0],
      ],
    },
  ],
});

console.log(world.spatialElementsByRole.get("shell"));
```

## Portal Example

Use connected regions when the world is made of rooms, areas, or zones linked by passages.

```ts
import {
  createPolyWorldTopology,
  planPolyWorldPortalFrame,
  resolvePolyWorldElements,
  resolvePolyWorldPortalFlow,
  selectPolyWorldPortalRegions,
} from "@layoutit/polycss-world";

const world = createPolyWorldTopology({
  regions: [
    { id: "studio", selectionKeys: ["faces:studio"] },
    { id: "gallery", selectionKeys: ["faces:gallery"] },
  ],
  links: [
    { id: "studio-gallery", fromRegionId: "studio", toRegionId: "gallery" },
  ],
  elements: [
    { id: "studio-shell", regionIds: ["studio"], layers: ["world"] },
    { id: "gallery-shell", regionIds: ["gallery"], layers: ["world"] },
    {
      id: "shared-door",
      regionIds: ["studio", "gallery"],
      regionMatch: "all",
      layers: ["world"],
    },
  ],
});

const selection = selectPolyWorldPortalRegions(world, {
  currentRegionId: "studio",
});

const elements = resolvePolyWorldElements(world, selection);
```

Portal selections can also carry door/area-portal state. Closed or blocked links are not traversed by linked-room selection unless the caller opts into `includeClosedLinks`:

```ts
const selection = selectPolyWorldPortalRegions(world, {
  currentRegionId: "studio",
  linkedDepth: 2,
  linkState: {
    "studio-gallery": "open",
    "gallery-vault": "closed",
  },
});
```

Closed and blocked links are reported as selection reasons so debug panels can explain why a room is not linked without rendering that room by accident.

Use `planPolyWorldPortalFrame` when authored region/link selection should directly produce state, diff, layer plan, readiness, and debug output:

```ts
const frame = planPolyWorldPortalFrame(world, {
  previousState,
  currentRegionId: "studio",
  linkedDepth: 2,
  activity: {
    selectedTargetState: "resident",
    renderedRegionIds: ["studio", "gallery"],
  },
  planRegionState: "rendered",
  policies: [{ id: "render", layer: "render", elementLayers: ["world"] }],
  debug: { listLimit: 20 },
});

console.log(frame.portalSets.selectedRegionIds);
console.log(frame.portalSets.plannedElementIds);
console.log(frame.artifact.profile); // "area-portals"
```

Portal frames expose `portalSets`, a compact truth-ladder summary of current region, selected regions/links/elements/selection keys, visible/external/closed/blocked/facing link buckets, optional activity buckets, and planned element ids. Use authored portal frames for explicit region/link topology; use portal flow when camera-clipped authored portal polygons matter, and use BSP/PVS when the world has a compiled partition and baked broad visibility.

When authored portals have bounds or polygon vertices, `resolvePolyWorldPortalFlow` can evaluate camera-clipped area visibility without requiring a compiled BSP/PVS artifact. It starts from the current region, clips portal polygons through the camera frustum and through prior visible portals, reports trace statuses, and returns an ordinary topology selection:

```ts
const flow = resolvePolyWorldPortalFlow(world, {
  point: cameraPosition,
  currentRegionId: "studio",
  forward: cameraForward,
  up: [0, 0, 1],
  fovDegrees: 80,
  portals: [
    {
      id: "studio-gallery-opening",
      linkId: "studio-gallery",
      bounds: { min: [8, 2, 0], max: [8, 4, 2] },
      selectionKeys: ["portal:studio-gallery"],
    },
  ],
  includeTrace: true,
});

const visibleElements = resolvePolyWorldElements(world, flow.selection);
```

Portal flow is authored-area visibility, not BSP. Use BSP/PVS when the world has a compiled partition and baked broad visibility; use portal flow when the author already knows the room links/openings and wants a data-only visible-area selection.

Use `planPolyWorldPortalFlowFrame` when authored area-portal visibility should directly drive world state, layer planning, plan debug, and portal-flow debug. The frame can keep the full flow selection for visibility/debug while narrowing the rendered plan through portal activity:

```ts
const frame = planPolyWorldPortalFlowFrame(world, {
  previousState,
  point: cameraPosition,
  currentRegionId: "studio",
  forward: cameraForward,
  up: [0, 0, 1],
  fovDegrees: 80,
  portals,
  activity: {
    selectedTargetState: "resident",
    renderedRegionIds: ["studio", "gallery"],
  },
  planRegionState: "rendered",
  policies: [{ id: "render", layer: "render", elementLayers: ["world"] }],
  debug: { includeTraceEntries: true, entryLimit: 20 },
  planDebug: { includeEntries: false },
});

console.log(frame.flow.regionIds);
console.log(frame.flowSets.visiblePortalIds);
console.log(frame.artifact.profile); // "portal-flow"
console.log(frame.portalFlowDebug?.topology.profile); // "portal-flow"
```

Portal-flow frames expose `flowSets`, a compact truth-ladder summary of current region, selected regions/links/portals, traced/rejected/visible/clipped portals, trace status counts, optional activity buckets, and planned element ids. Use it for debug panels and assertions that need the authored-area visibility result without parsing trace entries or DOM records.

`createPolyWorldPortalFlowDebugSnapshot` summarizes selected and hidden regions, selected and rejected portals, trace status counts, and optional capped trace entries. Its debug profile is `portal-flow` on purpose: it is useful authored area-portal evidence, not compiled BSP/PVS proof.

Portal selection can also consume a package-owned or app-owned visibility selection. This is the bridge for BSP/PVS-driven room visibility: pass the BSP/PVS selection as `visibilitySelection`, and the portal profile preserves its region ids, element ids, selection keys, and source reasons while still adding authored current/link diagnostics:

```ts
const bspFrame = planPolyWorldBspVisibilityFrame(world, bsp, {
  previousState,
  policies,
  point: cameraPosition,
  forward: cameraForward,
  fovDegrees: 90,
});

const portalFrame = planPolyWorldPortalFrame(world, {
  previousState,
  currentRegionId: bspFrame.visibility.leaf?.leaf.regionId,
  visibilitySelection: bspFrame.visibility.selection,
  activity: {
    selectedTargetState: "resident",
    renderedRegionIds: bspFrame.visibility.selection.regionIds,
  },
  planRegionState: "rendered",
  policies,
});
```

When `planRegionState` narrows a portal frame to `rendered`, `resident`, or another activity state, direct element/source/alias selectors from the broader visibility selection are not allowed to leak into the narrowed plan. Use `planRegionState: "selected"` when the whole visibility selection should drive element resolution directly.

Use `resolvePolyWorldPortalActivity` when a portal selection should drive room lifecycle state without making visibility and activity the same thing. Selected rooms can be treated as loaded or resident while only caller-chosen rooms are active or rendered:

```ts
const activity = resolvePolyWorldPortalActivity(world, selection, {
  selectedTargetState: "resident",
  activeRegionIds: ["studio"],
  renderedRegionIds: ["gallery"],
  preloadedRegionIds: ["vault"],
});

const portalDebug = createPolyWorldPortalDebugSnapshot(world, selection, {
  currentRegionId: "studio",
  activity,
});
```

Use `planPolyWorldPortalFrame` when an authored room/portal update should produce selection, optional activity, next state, layer plan, plan debug, and portal debug in one package-owned step:

```ts
const frame = planPolyWorldPortalFrame(world, {
  previousState,
  currentRegionId: "studio",
  linkedDepth: 2,
  activity: {
    selectedTargetState: "resident",
    renderedRegionIds: ["studio", "gallery"],
  },
  planRegionState: "rendered",
  policies: [{ id: "render", layer: "render", elementLayers: ["world"] }],
});
```

`planRegionState` lets activity drive planning without making selected, resident, active, and rendered rooms the same thing.

## BSP/PVS Example

Use BSP leaves when a portal world has spatial partitions and portal faces. The package validates the BSP graph, bakes broad portal PVS into indexed leaf/portal bitsets, and can either select that broad set from the camera point or further clip it through a 3D camera/portal frustum before rendering.

```ts
import {
  compilePolyWorldBsp,
  createPolyWorldState,
  createPolyWorldTopology,
  planPolyWorldBspVisibilityFrame,
} from "@layoutit/polycss-world";

const world = createPolyWorldTopology({
  regions: [{ id: "studio" }, { id: "gallery" }],
  links: [
    { id: "studio-gallery", fromRegionId: "studio", toRegionId: "gallery" },
  ],
  elements: [
    { id: "studio-shell", regionIds: ["studio"], layers: ["world"] },
    { id: "gallery-shell", regionIds: ["gallery"], layers: ["world"] },
  ],
});

const bsp = compilePolyWorldBsp({
  regions: [
    {
      id: "studio",
      regionId: "studio",
      bounds: { min: [-4, -4, 0], max: [0, 4, 3] },
    },
    {
      id: "gallery",
      regionId: "gallery",
      bounds: { min: [0, -4, 0], max: [4, 4, 3] },
    },
  ],
  portals: [
    {
      id: "studio-gallery-portal",
      fromRegionId: "studio",
      toRegionId: "gallery",
      linkId: "studio-gallery",
      bounds: { min: [0, -1, 0], max: [0, 1, 2] },
    },
  ],
  pvs: { projection: "xy", sampleInset: 1 },
});

const previousState = createPolyWorldState(world, {
  selection: { regionIds: ["studio"] },
});

const frame = planPolyWorldBspVisibilityFrame(world, bsp, {
  previousState,
  policies: [{ id: "render", layer: "render", elementLayers: ["world"] }],
  point: cameraPosition,
  forward: cameraForward,
  up: [0, 0, 1],
  aspect: viewportWidth / viewportHeight,
  fovDegrees: 90,
  includeTrace: true,
  debug: { listLimit: 20 },
  planDebug: { includeEntries: false, listLimit: 20 },
  surfaces: [
    {
      id: "studio-wall-0",
      elementId: "studio-wall-0",
      regionId: "studio",
      vertices: [[-4, -4, 0], [-4, 4, 0], [-4, 4, 3], [-4, -4, 3]],
    },
  ],
});

const visibleElementIds = frame.nextState.resolvedElementIds;
const plan = frame.plan;
const bspDebug = frame.visibility.debug;
const planDebug = frame.debug;
```

`compilePolyWorldBsp` generates the split tree and portal vertices from region bounds and portal-opening bounds. `createPolyWorldBspTree` and `bakePolyWorldBspPvs` remain available when an app already has compiled BSP nodes and portal polygons from another pipeline. Manual portal vertices are canonicalized into a stable coplanar convex winding before traversal. Baked visibility is stored on `leaf.pvs`, while authored leaf contents such as `elementIds` stay on the leaf itself. The tree-level `pvsIndex` maps leaf and portal ids to the typed bitsets in each baked PVS record. Baked PVS metadata (`regionIds`, `linkIds`, `selectionKeys`, and `elementIds`) is validated against the decoded leaf and portal bits so stale summaries fail at tree creation. Baked broad PVS must also include directly adjacent portal leaves and portal bits, so an imported artifact cannot hide a neighboring open room while still claiming BSP/PVS proof. Use `resolvePolyWorldBspBakedPvs`, `decodePolyWorldBspPvsLeafIds`, or `decodePolyWorldBspPvsPortalIds` instead of reading the bitsets directly.

BSP leaves can also carry optional `clusterId` metadata. PVS and view-PVS results expose `clusterIds` alongside `leafIds`, so apps can debug Quake-style leaf-versus-cluster visibility without asking PolyCSS World to parse Quake BSP files.

Use `planPolyWorldBspVisibilityFrame` for ordinary camera updates that should produce a next world state, state diff, layer plan, optional plan debug snapshot, and BSP visibility data in one call. Use `resolvePolyWorldBspVisibility` when an app only needs the current BSP leaf, broad baked PVS, camera-clipped view PVS, topology selection, optional portal trace, and optional BSP debug snapshot.

Use `summarizePolyWorldBspTopologyProof` when a debug panel, test, or example needs to prove which BSP/PVS path is active. The proof element has `profile: "bsp-pvs"`, compiler metadata (`authored`, `bounds-bsp`, `brush-bsp`, or `polygon-bsp`), root/leaf reference counts, solid/empty/outside leaf counts when known, generated/candidate/rejected portal counts, PVS index coverage, baked-PVS coverage, density, and validation guarantees. Check `pvs.level` first for the coarse proof tier: `certified-tree-only`, `portal-clipped-baked-pvs`, `exact-baked-pvs`, `authored-baked-pvs`, `partial-baked-pvs`, `authored-loose-pvs`, `debug-loose-pvs`, or `uncertified`. The proof also reports `pvs.method`, `pvs.source`, and `pvs.completeness` so callers can distinguish exact baked PVS, PolyCSS World's package-generated portal-clipped baked PVS, authored baked PVS, authored loose PVS, debug loose PVS, and unavailable PVS. Generated portal-clipped PVS is labeled with `portal-clipped-baked-pvs`; it is useful for broad visibility but is still not presented as Quake BSP format support or full `qbsp`/`vis` parity. `createPolyWorldBspDebugSnapshot` includes this same proof as `snapshot.proof`.

Pass `surfaces` when renderable elements are surface-level instead of region-level. These records use the same spatial-element role and visibility vocabulary as the topology catalog. The frame tests each surface polygon against the same portal-clipped BSP view traversal and adds only surviving `elementId`s to the transition selection. This avoids the common mistake of mounting a whole room element just because one BSP leaf or region is visible.

BSP view surfaces can declare both a semantic `role` and an optional `visibility` override. Use `role: "root"` for resident containers, `role: "shell"` for floors, ceilings, and walls, `role: "opening"` for portal or door frames that should stay stable with the visible leaf/region, and `role: "detail"` or `role: "prop"` for incidental geometry that should be clipped by the portal/view footprint. If `visibility` is omitted, `root`, `shell`, and `opening` resolve to structural visibility, while `detail` and `prop` resolve to clipped detail visibility. Existing callers can still pass `visibility: "structural"` or `visibility: "detail"` directly. Resolved surface elements include role summaries plus explicit `structuralSurfaceIds`, `structuralElementIds`, `detailSurfaceIds`, and `detailElementIds`, so debug panels can prove shell/opening surfaces stayed mounted while props were clipped.

BSP visibility frames also expose `visibilitySets`, a compact truth-ladder summary for the current frame: current leaf, broad-PVS leaves, view-PVS leaves, structural surface ids, detail surface ids, and planned element ids. It intentionally does not include DOM-mounted ids; those remain in the caller-owned DOM/apply debug layer.

Use `tracePolyWorldBspViewPvs` when a debug panel or minimap needs to explain why a portal was accepted or rejected. Trace entries report the source leaf, target leaf, portal id, depth, status (`visible`, `clipped`, `closed`, `blocked`, `depth-capped`, `outside-broad-phase`, `missing-target-leaf`, or `degenerate-clip`), vertex counts, and clip-plane count for visible portals.

Use `createPolyWorldBspDebugSnapshot` when an app needs compact BSP inspection data for a debug panel or minimap. It summarizes tree shape, compiler metadata, solid/empty/outside leaf counts when available, baked-PVS density, current broad/view PVS lists, trace status counts, and the topology proof. Detailed trace entries are opt-in and can be capped with `entryLimit`.

Detailed BSP trace entries preserve portal ids, leaf ids, status, depth, vertex counts, clip-plane counts, and link/selection-key metadata when present, so a debug UI can explain culling decisions without reading private traversal state.

Pass `portalState` to `selectPolyWorldBspPvs`, `selectPolyWorldBspViewPvs`, `resolvePolyWorldBspPvs`, or `resolvePolyWorldBspViewPvs` when doors or area portals can close at runtime:

```ts
const selection = selectPolyWorldBspViewPvs(world, bsp, {
  point: cameraPosition,
  forward: cameraForward,
  fovDegrees: 90,
  portalState: {
    "studio-gallery": "closed",
  },
});

console.log(frame.artifact.profile); // "bsp-pvs"
```

`portalState` records are resolved by portal id first, then by `linkId`, so generated brush portals can still be controlled by authored topology link ids.

Use `compilePolyWorldBrushBsp` when the source is authored solid space. Bounds brushes are converted into six halfspace planes, explicit plane brushes are normalized, and the compiler builds a recursive BSP tree by splitting the active convex cell with brush and region planes. Leaves are emitted from that recursion, then marked solid or empty; face-overlap portals are generated only between adjacent empty leaves, and outside space can be classified:

```ts
import { compilePolyWorldBrushBsp } from "@layoutit/polycss-world";

const brushBsp = compilePolyWorldBrushBsp({
  worldBounds: { min: [-8, -8, 0], max: [8, 8, 3] },
  brushes: [
    { id: "wall", bounds: { min: [0, -8, 0], max: [0.25, 8, 3] } },
  ],
  regions: [
    { id: "left", bounds: { min: [-8, -8, 0], max: [0, 8, 3] } },
    { id: "right", bounds: { min: [0.25, -8, 0], max: [8, 8, 3] } },
  ],
  outside: "solid",
  pvs: { projection: "xy" },
});
```

`outside: "solid"` treats leaves without an authored region as solid. `outside: "flood-fill"` instead starts from empty leaves touching `worldBounds`, walks the generated empty-leaf portal graph, and marks every reachable leaf as outside solid space. A sealed room stays empty; a leaked room becomes outside.

Brushes can also provide explicit BSP planes. Plane normals point to the front side; brush solid space defaults to the back side of each plane unless `side: "front"` is set. When `bounds` and `planes` are both provided, the bounds clip the plane brush:

```ts
const slopedBrushBsp = compilePolyWorldBrushBsp({
  worldBounds: { min: [0, 0, 0], max: [2, 2, 1] },
  brushes: [
    {
      id: "diagonal-solid",
      bounds: { min: [0, 0, 0], max: [2, 2, 1] },
      planes: [{ normal: [-1, -1, 0], distance: -2 }],
    },
  ],
  regions: [
    { id: "walkable", bounds: { min: [0, 0, 0], max: [2, 2, 1] } },
  ],
});
```

Use `compilePolyWorldPolygonBsp` when the source is actual surface geometry and you need plane-based BSP splitting:

```ts
import { compilePolyWorldPolygonBsp } from "@layoutit/polycss-world";

const polygonBsp = compilePolyWorldPolygonBsp({
  surfaces: [
    {
      id: "divider",
      vertices: [[0, -1, 0], [0, 1, 0], [0, 1, 2], [0, -1, 2]],
    },
    {
      id: "floor",
      vertices: [[-2, -1, 0], [2, -1, 0], [2, 1, 0], [-2, 1, 0]],
    },
  ],
});

console.log(polygonBsp.tree, polygonBsp.fragments);
```

## State And Planning Example

Turn selections into explicit state, diff states, and produce caller-defined layer intent.

```ts
import {
  applyPolyWorldDomPlan,
  createPolyWorldDomApplyDebugSnapshot,
  createPolyWorldDomRegistry,
  createPolyWorldPlanDebugSnapshot,
  createPolyWorldResourceReadinessGuards,
  createPolyWorldState,
  diffPolyWorldState,
  planPolyWorldElementSet,
  planPolyWorldLayers,
  planPolyWorldTransition,
  summarizePolyWorldResourceReadiness,
} from "@layoutit/polycss-world";

const previous = createPolyWorldState(world, {
  selection: { regionIds: ["studio"] },
});
const next = createPolyWorldState(world, {
  selection: { regionIds: ["studio", "gallery"] },
});
const diff = diffPolyWorldState(previous, next);

const plan = planPolyWorldLayers(world, diff, [
  { id: "render", layer: "render", elementLayers: ["world"] },
  {
    id: "preload",
    layer: "preload",
    elementLayers: ["world"],
    actions: { added: "preload", retained: "noop" },
  },
]);

const debug = createPolyWorldPlanDebugSnapshot(diff, plan);
```

Each plan entry keeps the action vocabulary small, but also carries explicit target state. For example, `show` defaults to `{ visible: true, rendered: true }`, `hide` defaults to `{ visible: false, rendered: false }`, and `preload` defaults to `{ preloaded: true }`. Policies can override `targetStates` and `phase` when an app needs loaded/resident/active/rendered planning without inventing new DOM actions.

When an app already has a resolved element set from an external visibility system, use `planPolyWorldElementSet` instead of constructing a topology state just to diff ids. This is the intended bridge for source engines that already compile BSP/PVS, portal sets, or chunk working sets and only need PolyCSS World to produce stable plan entries:

```ts
const plan = planPolyWorldElementSet({
  previousElementIds: previousVisibleFaceLeafIds,
  nextElementIds: nextVisibleFaceLeafIds,
  layer: "render",
  policyId: "source-pvs",
  reasonLabels: ["source-pvs:leaf-42"],
});
```

`planPolyWorldElementSet` still uses the same `show`/`hide`/`retain`/`preload` vocabulary and `targetStates` overrides as topology-backed plans, so a caller can plan residency or preloading from the same external set diff without making visibility and residency the same thing.

Policies may also attach app-owned `guards` and `dependencies`. These are plain check results, or callbacks that return check results for each entry. PolyCSS World does not evaluate resources or schedule jobs; it only carries the results into plan/debug output. `applyPolyWorldDomPlan` blocks entries with failed checks and reports `guardFailureElementIds` and `dependencyFailureElementIds`; DOM mount failures such as a missing parent are reported separately as `mountBlockedElementIds`:

```ts
const plan = planPolyWorldLayers(world, diff, [
  {
    id: "render",
    layer: "render",
    elementLayers: ["world"],
    guards: ({ elementId }) => [
      { id: "resource-ready", ok: readyElementIds.has(elementId ?? "") },
    ],
    dependencies: [{ id: "root-mounted", ok: rootMounted }],
  },
]);
```

When topology elements, spatial elements, or document resource declarations name resources, `summarizePolyWorldResourceReadiness` can turn an app-owned resource map into a readiness summary, and `createPolyWorldResourceReadinessGuards` can turn that same data into ordinary plan guards. Readiness states are `missing`, `requested`, `loading`, `ready`, `failed`, and `stale`. Non-ready resources are render-blocking by default. Use `renderBlocking: false` for nonblocking previews or hints, and `preloadOnly: true` for resources that should be reported/requested without blocking rendered DOM. This is still data-only: PolyCSS World does not fetch, retry, cache, decode, evict, or schedule resources.

```ts
const readiness = summarizePolyWorldResourceReadiness(
  world,
  ["studio-shell", "gallery-door-frame"],
  {
    "texture:gallery-floor": "ready",
    "mesh:door-frame": "stale",
  },
  {
    resourceDeclarations: document.resources,
  },
);

console.log(readiness.blockedResourceIds, readiness.preloadOnlyResourceIds);
```

Use `createPolyWorldResourceLoadSet` when a frame also needs to explain what changed between previous and next visibility:

```ts
const loadSet = createPolyWorldResourceLoadSet(world, {
  previousElementIds: previousState.resolvedElementIds,
  nextElementIds: nextState.resolvedElementIds,
  resources: appResourceStates,
  readyStates: ["ready", "stale"],
  resourceDeclarations: document.resources,
});

console.log(loadSet.requestResourceIds);
console.log(loadSet.retainResourceIds);
console.log(loadSet.releaseCandidateResourceIds);
console.log(loadSet.readyButNotVisibleResourceIds);
```

```ts
const plan = planPolyWorldLayers(world, diff, [
  {
    id: "render",
    layer: "render",
    elementLayers: ["world"],
    guards: createPolyWorldResourceReadinessGuards(world, {
      "texture:gallery-floor": "ready",
      "mesh:door-frame": "loading",
    }, {
      resourceDeclarations: document.resources,
    }),
  },
]);
```

For the common case where an app already has the previous state and a next selection, use `planPolyWorldTransition` to create the next state, diff, layer plan, and optional plan debug snapshot together:

```ts
const transition = planPolyWorldTransition(world, {
  previousState: previous,
  selection: { regionIds: ["studio", "gallery"] },
  relations: { reasonLabel: "resident-roots" },
  readiness: {
    resources: {
      "texture:gallery-floor": "ready",
      "mesh:door-frame": "stale",
    },
  },
  policies: [
    { id: "render", layer: "render", elementLayers: ["world"] },
  ],
  debug: { includeEntries: false },
});
```

`transition.readiness` is the same readiness summary returned by `summarizePolyWorldResourceReadiness`, scoped to the transition's next resolved elements unless `readiness.elementIds` is supplied. `transition.loadSet` adds previous/next resource ids, request ids, retained ids, release candidates, preload-only ids, stale-allowed ids, nonblocking ids, and blocked ids. Plan debug snapshots expose capped `readiness` and `loadSet` sections with counts. BSP, portal, portal-flow, and chunk frame helpers pass this through the same transition path, so profile results can report visibility/working-set data separately from resource blockers.

Transition and profile-frame results expose `planningSelection`, the exact pre-normalization selection used to create `nextState`, before the diff and layer plan are produced. Plan debug snapshots also summarize that same selection when they are produced from a transition or profile frame. This keeps authored room frames, BSP visibility frames, and chunk streaming frames inspectable without inferring the planned region/element set from resolved state.

Profile-frame helpers also expose `frameSummary`, a shared truth-ladder object for tests and debug panels. It preserves profile-specific details in `visibilitySets`, `portalSets`, `flowSets`, or `streamingSets`, but gives every frame the same high-level order: `current`, `candidate`, `broad`, `view`, `retained`, `rejected`, optional `readiness`, optional `loadSet`, `planning`, `state`, `diff`, and `plan`. Use it when a UI needs one compact summary across BSP/PVS, authored portals, portal flow, and chunk traversal without treating broad visibility, view visibility, readiness, state, and DOM planning as the same thing.

Pass `relations` when the next selection resolves detail elements but the transition should also include their `parentId` or `containerId` roots before diffing and planning. This is useful for prepared DOM worlds where a resident root stays mounted while child surfaces render or hide independently. If a caller supplies a precomputed `resolution`, relation expansion is skipped; expand the selection first or provide the already-expanded resolution.

Layer plans are intent until the caller applies them. `preload` remains non-mutating: `applyPolyWorldDomPlan` reports it as unsupported instead of fetching resources.

## DOM Apply Example

Register app-owned DOM-like elements, then apply `show`, `hide`, `retain`, and `noop` plan entries while preserving prepared order.

```ts
const registry = createPolyWorldDomRegistry([
  {
    elementId: "studio-shell",
    element: studioElement,
    parent: sceneRoot,
    mounted: true,
    nextElementId: "gallery-shell",
    layers: ["world"],
  },
  {
    elementId: "gallery-shell",
    element: galleryElement,
    parent: sceneRoot,
    mounted: false,
    previousElementId: "studio-shell",
    layers: ["world"],
  },
]);

const apply = applyPolyWorldDomPlan(registry, plan);
const applyDebug = createPolyWorldDomApplyDebugSnapshot(apply);
```

By default, `hide` removes a mounted element and `show` reinserts it at its prepared order hint. Use `applyPolyWorldDomPlan(registry, plan, { hideMode: "hidden" })` when prepared elements must stay mounted and only toggle the standard `hidden` attribute.

Apply results expose both `mountedElementIds` and `hiddenElementIds`, so callers can distinguish mounted visible elements from mounted hidden elements after hidden-only apply.

The DOM layer only toggles, reinserts, and removes registered elements. It does not create elements, inspect `document`, parse renderer styles, import PolyCSS renderers, or run a scheduler.

## Debug Detail

Debug snapshots are deterministic and adapter-friendly. By default they keep full id lists for small authored worlds. Large worlds can cap list and entry detail while preserving full counts:

```ts
const compactPlanDebug = createPolyWorldPlanDebugSnapshot(diff, plan, {
  entryLimit: 20,
  listLimit: 20,
});

const compactApplyDebug = createPolyWorldDomApplyDebugSnapshot(apply, {
  entryLimit: 20,
  listLimit: 20,
});

const compactBspDebug = createPolyWorldBspDebugSnapshot(bsp, {
  trace,
  includeTraceEntries: true,
  entryLimit: 20,
  listLimit: 20,
});
```

Use `includeEntries: false` when an app debug API only needs counts and omitted totals.

## Chunk Example

Use ordered chunk windows when the world streams through sections, blocks, tiles, or authored terrain strips.

```ts
import {
  createPolyWorldTopology,
  resolvePolyWorldElements,
  selectPolyWorldChunkWindow,
} from "@layoutit/polycss-world";

const world = createPolyWorldTopology({
  regions: [
    { id: "chunk-0" },
    { id: "chunk-1" },
    { id: "chunk-2" },
    { id: "chunk-3" },
  ],
  elements: [
    { id: "road-1", regionIds: ["chunk-1"], layers: ["world"] },
    { id: "road-2", regionIds: ["chunk-2"], layers: ["world"] },
    { id: "track-3", selectionKeys: ["track:chunk-3"], layers: ["track"] },
  ],
});

const selection = selectPolyWorldChunkWindow(world, {
  currentRegionId: "chunk-2",
  before: 1,
  after: 1,
  taggedRegionSelections: [
    {
      kind: "preload",
      label: "next-section",
      regionIds: ["chunk-3"],
      selectionKeys: ["track:chunk-3"],
    },
  ],
});

const elements = resolvePolyWorldElements(world, selection);
```

Use streaming sources when loaded, resident, active, and rendered chunks should be tracked separately. A streaming source returns a topology selection plus `selection.streaming`, but callers should derive the render selection from the state they actually want to display:

```ts
import {
  createPolyWorldChunkStreamingDebugSnapshot,
  selectPolyWorldChunkStreaming,
  selectPolyWorldChunkStreamingState,
} from "@layoutit/polycss-world";

const streaming = selectPolyWorldChunkStreaming(world, {
  orderedRegionIds: ["chunk-0", "chunk-1", "chunk-2", "chunk-3"],
  loadedRegionIds: ["chunk-1"],
  residentRegionIds: ["chunk-1"],
  sources: [
    {
      id: "player",
      regionId: "chunk-2",
      before: 1,
      after: 1,
      targetState: "rendered",
      priority: 10,
      label: "player-stream",
    },
    {
      id: "lookahead",
      regionId: "chunk-3",
      targetState: "loaded",
      label: "lookahead-load",
    },
  ],
});

const renderSelection = selectPolyWorldChunkStreamingState(world, streaming, "rendered", {
  reasonLabel: "rendered-chunks",
});

const renderElements = resolvePolyWorldElements(world, renderSelection);
const chunkDebug = createPolyWorldChunkStreamingDebugSnapshot(streaming, {
  includeSources: true,
  listLimit: 20,
});
```

This keeps residency and visibility separate: a chunk may be loaded or resident without being rendered.

Streaming sources are processed by descending `priority` and then by source id, so requested-region and reason order stays deterministic even when callers provide sources out of order. A source `loadingRange` is measured from `point`, `position`, the current region `center`, or the current region bounds center, in that order.

Chunk streams can also expand through a caller-provided chunk graph. This is still selection only: PolyCSS World does not fetch resources, choose LOD meshes, or run a scheduler.

```ts
const streaming = selectPolyWorldChunkStreaming(world, {
  chunkGraph: {
    parentRegionIds: {
      "sector-a": "world",
      "tile-a": "sector-a",
    },
    childRegionIds: {
      "sector-a": ["tile-a", "tile-b"],
    },
    relatedRegionIds: {
      "tile-a": ["tile-c"],
    },
  },
  sources: [
    {
      id: "camera",
      regionId: "tile-a",
      targetState: "rendered",
      chunkGraphExpansion: {
        includeParents: true,
        includeRelated: true,
        recursive: true,
        targetState: "resident",
      },
    },
    {
      id: "sector-render",
      regionId: "sector-a",
      targetState: "rendered",
      chunkGraphExpansion: { includeChildren: true },
    },
  ],
});
```

Graph expansion lets parent or related chunks stay loaded/resident while a narrower child set is rendered. Put `targetState` on `chunkGraphExpansion` when graph-expanded regions should use a different lifecycle state from the source chunk. Source debug summaries expose `graphRegionIds`, `graphTargetState`, and `missingRegionIds` when graph expansion adds regions or references missing ones.

For spatially organized worlds, use a chunk tree instead of hand-authored graph maps. The tree is still data-only: it validates hierarchy, availability, content presence, bounds, resource ids, and refinement metadata, then derives the graph used by streaming selection. PolyCSS World does not fetch content, choose concrete mesh LODs, or enforce screen-space error:

```ts
import {
  createPolyWorldChunkTree,
  selectPolyWorldChunkStreaming,
} from "@layoutit/polycss-world";

const chunkTree = createPolyWorldChunkTree({
  chunks: [
    {
      id: "world",
      regionId: "world",
      childIds: ["sector-a"],
      available: true,
      contentAvailable: true,
      refinement: "add",
    },
    {
      id: "sector-a",
      regionId: "sector-a",
      parentId: "world",
      childIds: ["tile-a", "tile-b"],
      available: true,
      contentAvailable: true,
      geometricError: 2,
    },
    {
      id: "tile-a",
      regionId: "tile-a",
      parentId: "sector-a",
      available: true,
      contentAvailable: true,
      resourceIds: ["mesh:tile-a"],
    },
  ],
}, { topology: world });

const streaming = selectPolyWorldChunkStreaming(world, {
  chunkTree,
  sources: [
    {
      id: "camera",
      regionId: "tile-a",
      targetState: "rendered",
      chunkGraphExpansion: {
        includeParents: true,
        recursive: true,
        targetState: "resident",
      },
    },
  ],
});

console.log(streaming.streaming.chunkTree);
```

When the tree should drive residency directly, opt into budgeted traversal. `resolvePolyWorldChunkTreeTraversal` walks from roots/current chunk, applies availability, content presence, refinement, geometric-error, camera/frustum, viewer request bounds, and budget inputs, and returns per-chunk reasons such as `refined`, `rendered`, `held`, `requested`, `unavailable`, `outside-request-volume`, `view-culled`, `skipped`, and `budget-clipped`:

```ts
const traversal = resolvePolyWorldChunkTreeTraversal(chunkTree, {
  currentRegionId: "tile-a",
  point: cameraPosition,
  forward: cameraForward,
  up: [0, 0, 1],
  fovDegrees: 80,
  aspect: viewportWidth / viewportHeight,
  viewportHeight,
  near: 0.1,
  far: 200,
  budget: {
    maxScreenSpaceError: 16,
    maxRenderedChunks: 4,
    maxRenderCost: 8,
  },
});

console.log(traversal.renderedRegionIds);
console.log(traversal.viewCulledChunkIds);
console.log(traversal.budgetClippedChunkIds);
console.log(traversal.entries[0]?.screenSpaceError);
```

When `viewportHeight`, camera/FOV data, and `budget.maxScreenSpaceError` are present, traversal computes per-entry `distanceToCamera` and `screenSpaceError` from each chunk's `geometricError` and uses that screen-space error to decide refinement. If those inputs are absent, traversal falls back to `budget.targetGeometricError`. This mirrors the useful 3D Tiles idea without adopting 3D Tiles loading: the result is still a data-only working-set plan.

Callers that already have culling planes can pass `frustum` instead of camera vectors. Plane normals use the same convention as the rest of the package: a chunk is inside when at least part of its bounds is on or in front of every plane. `contentBounds` can narrow view culling and screen-space distance to actual chunk content while `bounds` remains available for chunk lookup and hierarchy. `viewerRequestBounds` is a data-only eligibility gate: if the traversal point is outside that volume, a non-active chunk is skipped with `outside-request-volume`. Chunks without bounds remain eligible, and the active current/ancestor path is retained even when a sibling is view-culled or outside its request volume.

Pass `chunkTraversal` to `selectPolyWorldChunkStreaming` when that traversal should populate requested, loaded, resident, and rendered region buckets. This remains declarative: unavailable or missing content can be requested or held in debug state, but the app still owns fetch timing, cache eviction, and actual mesh replacement.

```ts
const streaming = selectPolyWorldChunkStreaming(world, {
  chunkTree,
  currentRegionId: "tile-a",
  chunkTraversal: {
    budget: {
      maxRenderedChunks: 4,
      maxLoadedChunks: 8,
    },
  },
});

console.log(streaming.streaming.chunkTraversal?.entries);
```

Use `planPolyWorldChunkStreamingFrame` for the common streaming update path. It creates the streaming selection, derives the render selection from a streaming state such as `rendered`, then produces next state, diff, layer plan, plan debug, and chunk debug:

```ts
const frame = planPolyWorldChunkStreamingFrame(world, {
  previousState,
  orderedRegionIds: ["chunk-0", "chunk-1", "chunk-2"],
  sources: [
    { id: "player", regionId: "chunk-1", before: 1, after: 1, targetState: "rendered" },
    { id: "lookahead", regionId: "chunk-2", targetState: "loaded" },
  ],
  renderSelection: { reasonLabel: "rendered-chunks" },
  policies: [{ id: "render", layer: "render", elementLayers: ["world"] }],
  debug: { includeSources: true },
});

console.log(frame.artifact.profile); // "chunk-traversal"
```

Chunk frames expose `streamingSets`, a compact truth-ladder summary of the selected/rendered/loaded/resident/requested chunk and region ids, held/unavailable/view-culled/outside-request-volume/skipped/budget-clipped chunk ids, and planned element ids. Use it for debug panels and tests that need to prove working-set state without parsing traversal entries or DOM records.

## Scope

- Regions, links, elements, selections, and selection reasons.
- Element resolution by region, selection key, element id, source id, and alias.
- Portal, portal-flow, bounds-BSP/PVS, brush-BSP/PVS, polygon-BSP, chunk-window, chunk-streaming, and chunk-tree selector helpers.
- Spatial element catalogs for topology-relevant roots, shells, openings, details, props, resource refs, bounds, and polygon surfaces.
- Structural versus detail surface selection for BSP view-surface elements using the shared spatial-element role vocabulary.
- Bounds-first region lookup with optional nearest-center fallback.
- Stable world state snapshots and state diffs.
- Caller-defined layer plans with `show`, `hide`, `retain`, `preload`, and `noop` intent plus explicit target-state metadata.
- DOM-like record registries with element/source/alias/layer/tag lookups.
- Stable-order DOM apply for registered elements, including hidden-only apply for prepared elements.
- Stable debug snapshots, capped BSP/plan/chunk/apply detail, and app-owned debug adapters.

## Selection Keys

`selectionKeys` are opaque topology keys. Regions and links can expose keys, selectors can carry them forward, and elements can opt into them. Element resolution returns only elements that match the selected regions, ids, source ids, aliases, or element-owned selection keys. Debug `unresolved.selectionKeys` reports keys unknown to the topology, not known keys that simply produce no element action.

## Element Relationships

Elements can declare `parentId` and `containerId` when a prepared world has resident roots and independently visible children. The topology indexes these relationships through `elementsByParentId` and `elementsByContainerId`, but the package does not turn them into a scene graph or renderer-owned hierarchy. Planners and DOM apply helpers still operate on caller-registered element records.

Generic debug snapshots include relation summaries for resolved elements, so debug UIs can see which parent/container roots are involved without walking app DOM records.

Use `resolvePolyWorldElementRelations` when a visibility selection resolves detail elements but the app also needs their resident roots or containers:

```ts
const relationExpansion = resolvePolyWorldElementRelations(world, ["gallery-wall"]);

console.log(relationExpansion.relatedElementIds);
```

Use `expandPolyWorldSelectionElementRelations` when a region, BSP, portal, or chunk selection should keep those roots selectable by element id while preserving the original visibility selection:

```ts
const visibleSelection = { regionIds: ["gallery"] };
const renderSelection = expandPolyWorldSelectionElementRelations(world, visibleSelection);
const renderState = createPolyWorldState(world, { selection: renderSelection });
```

The expansion is data-only. It does not mount parents, create DOM nodes, or make parent/child visibility the same thing. Cyclic `parentId` or `containerId` chains are rejected at topology creation because they cannot produce stable resident-root planning.
