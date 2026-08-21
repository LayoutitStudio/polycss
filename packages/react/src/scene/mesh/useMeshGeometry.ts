/**
 * useMeshGeometry — src loading / parse-options merge, polygon
 * normalization (imperative-override reset, merge optimization, autoCenter
 * recentering). Extracted verbatim from PolyMesh.tsx.
 */
import { useMemo, useRef, useState } from "react";
import type { MeshResolution, ParseResult, Polygon, Vec3 } from "@layoutit/polycss-core";
import { computeSceneBbox, optimizeMeshPolygons } from "@layoutit/polycss-core";
import { usePolyMesh, type UseMeshOptions } from "../useMesh";

export function recenterPolygons(polygons: Polygon[]): Polygon[] {
  if (polygons.length === 0) return polygons;
  const bbox = computeSceneBbox(polygons);
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  const cy = (bbox.min[1] + bbox.max[1]) / 2;
  const cz = (bbox.min[2] + bbox.max[2]) / 2;
  if (cx === 0 && cy === 0 && cz === 0) return polygons;
  const shift = (v: Vec3): Vec3 => [v[0] - cx, v[1] - cy, v[2] - cz];
  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map(shift),
    ...(p.textureTriangles?.length
      ? {
          textureTriangles: p.textureTriangles.map((triangle) => ({
            ...triangle,
            vertices: triangle.vertices.map(shift) as [Vec3, Vec3, Vec3],
          })),
        }
      : null),
  }));
}

export interface UseMeshGeometryOptions {
  src?: string;
  mtl?: string;
  parseOptions?: UseMeshOptions;
  meshResolution?: MeshResolution;
  polygonsProp?: Polygon[];
  voxelSourceProp?: ParseResult["voxelSource"];
  merge: boolean;
  autoCenter?: boolean;
}

export function useMeshGeometry({
  src,
  mtl,
  parseOptions,
  meshResolution,
  polygonsProp,
  voxelSourceProp,
  merge,
  autoCenter,
}: UseMeshGeometryOptions) {
  // Compose mtl + meshResolution props into the parser options threaded to
  // useMesh. The top-level meshResolution prop wins over parseOptions.meshResolution
  // when both are present — top-level is the discoverable route; parseOptions is
  // for niche parser flags.
  const mergedOptions = useMemo<UseMeshOptions | undefined>(() => {
    if (!mtl && !parseOptions && meshResolution === undefined) return undefined;
    return {
      ...(parseOptions ?? {}),
      ...(mtl ? { mtlUrl: mtl } : {}),
      ...(meshResolution !== undefined ? { meshResolution } : {}),
    };
  }, [mtl, parseOptions, meshResolution]);

  // Either fetch via useMesh, or use the supplied polygons array.
  // useMesh tolerates an empty src (sits idle) so we always call it for
  // hook-rules consistency.
  const fetched = usePolyMesh(src ?? "", mergedOptions);

  const externalPolygons = src ? fetched.polygons : (polygonsProp ?? []);
  const externalVoxelSource = src ? fetched.voxelSource : voxelSourceProp;

  // Local override array written by updatePolygon(). Null means no
  // imperative edits have been applied — the external source is used as-is.
  // Reset whenever the external source identity changes so stale overrides
  // don't leak across prop/fetch updates.
  const [localPolygons, setLocalPolygons] = useState<Polygon[] | null>(null);
  const prevExternalRef = useRef(externalPolygons);
  if (prevExternalRef.current !== externalPolygons) {
    prevExternalRef.current = externalPolygons;
    // Synchronous state reset during render (safe in React — equivalent to
    // getDerivedStateFromProps). Avoids a stale-override flash on the next
    // paint before a useEffect would fire.
    if (localPolygons !== null) setLocalPolygons(null);
  }

  const rawSourcePolygons = localPolygons ?? externalPolygons;
  // Apply mesh optimization (coplanar merge + interior cull) — mirrors
  // vanilla's scene.add path which always runs optimizeMeshPolygons. Skip
  // when `merge={false}` (helpers, imperative-edit callers that need
  // stable polygon refs).
  const sourcePolygons = useMemo(
    () => merge
      ? optimizeMeshPolygons(rawSourcePolygons, meshResolution !== undefined ? { meshResolution } : undefined)
      : rawSourcePolygons,
    [rawSourcePolygons, merge, meshResolution],
  );

  // Re-center vertices into mesh-local space if autoCenter is set. Done
  // once per polygon-list identity — bake into vertices, not per frame.
  const polygons = useMemo(
    () => (autoCenter ? recenterPolygons(sourcePolygons) : sourcePolygons),
    [sourcePolygons, autoCenter]
  );

  return { fetched, externalVoxelSource, localPolygons, setLocalPolygons, polygons };
}
