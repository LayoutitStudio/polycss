import { memo, useMemo, useRef } from "react";
import {
  computeSceneBbox,
} from "@layoutit/polycss-core";
import type {
  LoadMeshOptions,
  Polygon,
  Vec3,
} from "@layoutit/polycss-core";
import {
  Object3D,
  transformPolygonsToPoly,
} from "@layoutit/polycss-core/three";
import type { Vector3Tuple } from "@layoutit/polycss-core/three";
import { PolyMesh } from "../scene/PolyMesh";
import type { PolyMeshProps } from "../scene/PolyMesh";
import { usePolyMesh } from "../scene/useMesh";

export interface PolyThreeMeshProps extends Omit<
  PolyMeshProps,
  "polygons" | "src" | "mtl" | "position" | "rotation" | "scale" | "autoCenter" | "parseOptions" | "meshResolution"
> {
  object?: Object3D;
  polygons?: Polygon[];
  src?: string;
  mtl?: string;
  position?: Vector3Tuple;
  rotation?: Vector3Tuple;
  scale?: number | Vector3Tuple;
  autoCenter?: boolean;
  parseOptions?: LoadMeshOptions;
  meshResolution?: PolyMeshProps["meshResolution"];
}

function applyObjectProps(
  object: Object3D,
  {
    position,
    rotation,
    scale,
  }: Pick<PolyThreeMeshProps, "position" | "rotation" | "scale">,
): Object3D {
  if (position) object.position.set(position[0], position[1], position[2]);
  if (rotation) object.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (typeof scale === "number") object.scale.set(scale, scale, scale);
  else if (scale) object.scale.set(scale[0], scale[1], scale[2]);
  return object;
}

function recenterPolygons(polygons: Polygon[]): Polygon[] {
  if (polygons.length === 0) return polygons;
  const bbox = computeSceneBbox(polygons);
  const center: Vec3 = [
    (bbox.min[0] + bbox.max[0]) / 2,
    (bbox.min[1] + bbox.max[1]) / 2,
    (bbox.min[2] + bbox.max[2]) / 2,
  ];
  if (center[0] === 0 && center[1] === 0 && center[2] === 0) return polygons;
  const shift = (v: Vec3): Vec3 => [v[0] - center[0], v[1] - center[1], v[2] - center[2]];
  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map(shift),
    ...(polygon.textureTriangles?.length
      ? {
          textureTriangles: polygon.textureTriangles.map((triangle) => ({
            ...triangle,
            vertices: triangle.vertices.map(shift) as typeof triangle.vertices,
          })),
        }
      : null),
  }));
}

function PolyThreeMeshInner({
  object: objectProp,
  polygons: polygonsProp,
  src,
  mtl,
  position,
  rotation,
  scale,
  autoCenter = false,
  parseOptions,
  meshResolution,
  fallback,
  errorFallback,
  ...meshProps
}: PolyThreeMeshProps) {
  const objectRef = useRef<Object3D>(objectProp ?? new Object3D());
  const mergedOptions = useMemo<LoadMeshOptions | undefined>(() => {
    if (!mtl && !parseOptions && meshResolution === undefined) return undefined;
    return {
      ...(parseOptions ?? {}),
      ...(mtl ? { mtlUrl: mtl } : {}),
      ...(meshResolution !== undefined ? { meshResolution } : {}),
    };
  }, [mtl, parseOptions, meshResolution]);
  const fetched = usePolyMesh(src ?? "", mergedOptions);
  const rawPolygons = polygonsProp ?? (src ? fetched.polygons : []);

  const sourcePolygons = useMemo(
    () => (autoCenter ? recenterPolygons(rawPolygons) : rawPolygons),
    [rawPolygons, autoCenter],
  );
  const polyPolygons = useMemo(() => {
    const object = objectProp ?? objectRef.current;
    return transformPolygonsToPoly(
      sourcePolygons,
      applyObjectProps(object, { position, rotation, scale }),
    );
  }, [sourcePolygons, objectProp, position, rotation, scale]);

  if (src && fetched.loading && polyPolygons.length === 0 && fallback !== undefined) {
    return <>{fallback}</>;
  }
  if (src && fetched.error && errorFallback) {
    return <>{errorFallback(fetched.error)}</>;
  }

  return (
    <PolyMesh
      {...meshProps}
      polygons={polyPolygons}
      autoCenter={false}
      meshResolution={meshResolution}
    />
  );
}

export const PolyThreeMesh = memo(PolyThreeMeshInner);
