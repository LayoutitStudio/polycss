import type {
  PolyWorldBounds,
  PolyWorldRegion,
  PolyWorldRegionResolution,
  PolyWorldRegionResolverOptions,
  PolyWorldTopology,
} from "./types";
import type { Vec3 } from "@layoutit/polycss-core";

export function resolvePolyWorldRegionByPoint(
  topology: PolyWorldTopology,
  point: Vec3,
  options: PolyWorldRegionResolverOptions = {},
): PolyWorldRegionResolution | undefined {
  const regions = resolveCandidateRegions(topology, options.regionIds);
  let containing: PolyWorldRegion | undefined;
  let containingVolume = Infinity;

  for (const region of regions) {
    if (region.bounds === undefined || !containsPoint(region.bounds, point)) continue;
    const volume = boundsVolume(region.bounds);
    if (volume < containingVolume) {
      containing = region;
      containingVolume = volume;
    }
  }

  if (containing !== undefined) {
    return {
      region: containing,
      regionId: containing.id,
      reason: "bounds",
    };
  }

  if (options.nearest !== true) return undefined;

  let nearestRegion: PolyWorldRegion | undefined;
  let nearestDistanceSq = Infinity;
  for (const region of regions) {
    const center = region.center ?? centerFromBounds(region.bounds);
    if (center === undefined) continue;
    const distanceSq = squaredDistance(point, center);
    if (distanceSq < nearestDistanceSq) {
      nearestRegion = region;
      nearestDistanceSq = distanceSq;
    }
  }

  if (nearestRegion === undefined) return undefined;
  return {
    region: nearestRegion,
    regionId: nearestRegion.id,
    reason: "nearest",
    distanceSq: nearestDistanceSq,
  };
}

function resolveCandidateRegions(
  topology: PolyWorldTopology,
  regionIds: readonly string[] | undefined,
): readonly PolyWorldRegion[] {
  if (regionIds === undefined) return topology.regions;
  return regionIds.flatMap((regionId) => {
    const region = topology.regionsById.get(regionId);
    return region === undefined ? [] : [region];
  });
}

function containsPoint(bounds: PolyWorldBounds, point: Vec3): boolean {
  return (
    point[0] >= bounds.min[0] &&
    point[0] <= bounds.max[0] &&
    point[1] >= bounds.min[1] &&
    point[1] <= bounds.max[1] &&
    point[2] >= bounds.min[2] &&
    point[2] <= bounds.max[2]
  );
}

function boundsVolume(bounds: PolyWorldBounds): number {
  return (
    (bounds.max[0] - bounds.min[0]) *
    (bounds.max[1] - bounds.min[1]) *
    (bounds.max[2] - bounds.min[2])
  );
}

function centerFromBounds(bounds: PolyWorldBounds | undefined): Vec3 | undefined {
  if (bounds === undefined) return undefined;
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

function squaredDistance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}
