import { createPolyOrthographicCamera } from "@layoutit/polycss";
import {
  createPolyMorphDeformationRuntime,
  loadPolyMorphPackage,
  mountPolyMorphModel,
} from "@layoutit/polycss-morph";

type PreparedProof = {
  readonly ready: true;
  readonly forcedFallback: boolean;
  readonly nativeCornerTriangle: boolean;
  readonly leaves: number;
  readonly resolvedStrategies: Readonly<Record<string, number>>;
  readonly resourceResolutions: number;
  readonly identityStable: boolean;
  readonly dirtyLeaves: number;
  readonly forbidden: {
    readonly domCreations: number;
    readonly domRemovals: number;
    readonly topologyConstructions: number;
    readonly atlasRedraws: number;
    readonly schedulerCallbacks: number;
  };
};

declare global {
  interface Window {
    __polyMorphPreparedProof?: PreparedProof;
  }
}

const forcedFallback = new URLSearchParams(location.search).get("fallback") === "1";
const nativeSupports = CSS.supports.bind(CSS);
const nativeCornerTriangle =
  nativeSupports("corner-top-left-shape", "bevel")
  && nativeSupports("corner-top-right-shape", "bevel");

if (forcedFallback) {
  Object.defineProperty(CSS, "supports", {
    configurable: true,
    value: (property: string, value: string) =>
      property.startsWith("corner-top-")
        ? false
        : nativeSupports(property, value),
  });
}

const loaded = await loadPolyMorphPackage("/model/");
const fallbackPaths = new Set(loaded.model.render.leaves.flatMap((leaf) =>
  leaf.fallback ? [leaf.fallback.atlas.resourcePath] : []));
let resourceResolutions = 0;
const mounted = mountPolyMorphModel(
  document.querySelector<HTMLElement>("[data-prepared-host]")!,
  loaded.model,
  {
    camera: createPolyOrthographicCamera({
      rotX: 45,
      rotY: -8,
      zoom: 72,
      target: [0, 0, 0],
    }),
    resolveResourceUrl: (path) => {
      resourceResolutions += 1;
      return new URL(`/model/package/${path}`, location.href).href;
    },
  },
);
const identities = [...mounted.leafHandles.values()].map(
  ({ element }) => element,
);
const deformation = createPolyMorphDeformationRuntime(loaded.model);
if (loaded.model.deformation.kind !== "morph-regions") {
  throw new TypeError("Prepared proof requires morph-regions");
}
const targetId = loaded.model.deformation.targets[0]?.id;
if (!targetId) throw new TypeError("Prepared proof requires a morph target");
const frame = deformation.sample({
  tick: 0,
  morphWeights: { [targetId]: 0.45 },
});
const applied = mounted.apply({ leaves: frame.leafUpdates });
mounted.assertStableDomIdentity();
const resolvedStrategies = Object.fromEntries(
  [...mounted.leafHandles.values()].reduce((counts, { element }) => {
    const strategy = element.dataset.polyMorphResolvedStrategy ?? "unknown";
    counts.set(strategy, (counts.get(strategy) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()),
);
const proof: PreparedProof = {
  ready: true,
  forcedFallback,
  nativeCornerTriangle,
  leaves: mounted.leafHandles.size,
  resolvedStrategies,
  resourceResolutions,
  identityStable: [...mounted.leafHandles.values()].every(
    ({ element }, index) => element === identities[index],
  ),
  dirtyLeaves: frame.dirtyLeafIds.length,
  forbidden: {
    domCreations: applied.domCreations,
    domRemovals: applied.domRemovals,
    topologyConstructions: applied.topologyConstructions,
    atlasRedraws: applied.atlasRedraws,
    schedulerCallbacks: applied.schedulerCallbacks,
  },
};

if (
  !proof.identityStable
  || proof.leaves !== loaded.model.render.leaves.length
  || proof.dirtyLeaves === 0
  || Object.values(proof.forbidden).some((value) => value !== 0)
  || (Object.hasOwn(proof.resolvedStrategies, "atlas-slice")
    && (fallbackPaths.size === 0 || resourceResolutions !== fallbackPaths.size))
) {
  throw new Error(`Prepared Morph proof failed: ${JSON.stringify(proof)}`);
}

window.__polyMorphPreparedProof = proof;
document.documentElement.dataset.preparedReady = "true";
document.querySelector<HTMLOutputElement>("[data-prepared-state]")!.value =
  JSON.stringify(proof);
