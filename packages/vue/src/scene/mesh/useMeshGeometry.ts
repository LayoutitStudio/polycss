/**
 * useMeshGeometry — src loading / parse-options merge, polygon
 * normalization (imperative-override reset, merge optimization, autoCenter
 * recentering). Extracted verbatim from PolyMesh.ts.
 */
import { computed, ref, watch } from "vue";
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

export interface MeshGeometryProps {
  src?: string;
  mtl?: string;
  parseOptions?: UseMeshOptions;
  meshResolution?: MeshResolution;
  polygons?: Polygon[];
  voxelSource?: ParseResult["voxelSource"];
  merge: boolean;
  autoCenter: boolean;
}

export function useMeshGeometry(props: MeshGeometryProps) {
  // useMesh requires a Ref<string>. Computed ref wraps the src prop.
  const srcRef = computed(() => props.src ?? "");
  // Merge parseOptions + mtl + meshResolution into the options passed to
  // usePolyMesh. Top-level meshResolution wins over parseOptions.meshResolution.
  const meshOptions = computed(() => {
    const opts: UseMeshOptions = { ...(props.parseOptions ?? {}) };
    if (props.mtl) opts.mtlUrl = props.mtl;
    if (props.meshResolution !== undefined) opts.meshResolution = props.meshResolution;
    return Object.keys(opts).length > 0 ? opts : undefined;
  });
  const fetched = usePolyMesh(srcRef, meshOptions.value);

  const propPolygons = computed<Polygon[]>(() =>
    props.src ? fetched.polygons.value : (props.polygons ?? [])
  );

  // Holds a locally-mutated copy of the polygon array after updatePolygon()
  // is called. Reset to null whenever the upstream polygon source changes so
  // a fresh prop assignment or a completed src-fetch wins over stale edits.
  const polygonOverride = ref<Polygon[] | null>(null);
  const imperativePolygons: { current: Polygon[] | null } = { current: null };
  watch(propPolygons, () => {
    polygonOverride.value = null;
    imperativePolygons.current = null;
  });

  const rawSourcePolygons = computed<Polygon[]>(() =>
    polygonOverride.value ?? propPolygons.value
  );

  // Apply mesh optimization (coplanar merge + interior cull) — mirrors
  // vanilla's scene.add path which always runs optimizeMeshPolygons. Skip
  // when `merge={false}` (helpers, imperative-edit callers that need
  // stable polygon refs).
  const sourcePolygons = computed<Polygon[]>(() =>
    props.merge
      ? optimizeMeshPolygons(
          rawSourcePolygons.value,
          props.meshResolution !== undefined ? { meshResolution: props.meshResolution } : undefined,
        )
      : rawSourcePolygons.value,
  );

  const polygons = computed<Polygon[]>(() =>
    props.autoCenter ? recenterPolygons(sourcePolygons.value) : sourcePolygons.value
  );

  // voxelSource comes from useMesh (when src is set) OR from the prop
  // (when polygons array is provided directly). Vanilla scene.add receives
  // the full parseResult so it always knows voxelSource; React/Vue allow
  // the polygons-only call shape, so expose voxelSource as a prop.
  const externalVoxelSource = computed(() =>
    props.src ? fetched.voxelSource.value : props.voxelSource ?? undefined,
  );

  return { fetched, externalVoxelSource, polygonOverride, imperativePolygons, polygons };
}
