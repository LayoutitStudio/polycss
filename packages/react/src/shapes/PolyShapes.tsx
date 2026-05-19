/**
 * Primitive shape components — thin wrappers over the polygon generators in
 * @layoutit/polycss-core. Each component calls the matching `xPolygons()`
 * generator and passes the result to `<PolyMesh polygons={...}>`.
 *
 * Props are flat (shape geometry + common PolyMesh props). No geometry/material
 * split — a Polygon carries its own color/texture.
 */
import { useMemo } from "react";
import {
  boxPolygons,
  planePolygons,
  ringPolygons,
  octahedronPolygons,
  tetrahedronPolygons,
  icosahedronPolygons,
  dodecahedronPolygons,
  cylinderPolygons,
  conePolygons,
  torusPolygons,
  type BoxPolygonsOptions,
  type PlanePolygonsOptions,
  type RingPolygonsOptions,
  type OctahedronPolygonsOptions,
  type TetrahedronPolygonsOptions,
  type IcosahedronPolygonsOptions,
  type DodecahedronPolygonsOptions,
  type CylinderPolygonsOptions,
  type ConePolygonsOptions,
  type TorusPolygonsOptions,
} from "@layoutit/polycss-core";
import { PolyMesh } from "../scene/PolyMesh";
import type { PolyMeshProps } from "../scene/PolyMesh";

// Shared mesh props — strip the polygon-source props so shapes control them.
type ShapeMeshProps = Omit<PolyMeshProps, "polygons" | "src" | "mtl">;

// ── Fixed-geometry primitives ─────────────────────────────────────────────────

export interface PolyBoxProps extends ShapeMeshProps, BoxPolygonsOptions {}

export function PolyBox({
  size,
  center,
  min,
  max,
  color,
  texture,
  material,
  uvs,
  data,
  faces,
  ...meshProps
}: PolyBoxProps) {
  const polygons = useMemo(
    () => boxPolygons({ size, center, min, max, color, texture, material, uvs, data, faces }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [size, center, min, max, color, texture, material, uvs, data, faces],
  );
  return <PolyMesh polygons={polygons} {...meshProps} />;
}

export interface PolyPlaneProps extends ShapeMeshProps, PlanePolygonsOptions {}

export function PolyPlane({
  axis,
  size,
  offset,
  along,
  color,
  ...meshProps
}: PolyPlaneProps) {
  const polygons = useMemo(
    () => planePolygons({ axis, size, offset, along, color }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [axis, size, offset, along, color],
  );
  return <PolyMesh polygons={polygons} {...meshProps} />;
}

export interface PolyRingProps extends ShapeMeshProps, RingPolygonsOptions {}

export function PolyRing({
  axis,
  radius,
  halfThickness,
  segments,
  color,
  ...meshProps
}: PolyRingProps) {
  const polygons = useMemo(
    () => ringPolygons({ axis, radius, halfThickness, segments, color }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [axis, radius, halfThickness, segments, color],
  );
  return <PolyMesh polygons={polygons} {...meshProps} />;
}

export interface PolyOctahedronProps extends ShapeMeshProps, OctahedronPolygonsOptions {}

export function PolyOctahedron({
  center,
  size,
  color,
  ...meshProps
}: PolyOctahedronProps) {
  const polygons = useMemo(
    () => octahedronPolygons({ center, size, color }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [center, size, color],
  );
  return <PolyMesh polygons={polygons} {...meshProps} />;
}

export interface PolyTetrahedronProps extends ShapeMeshProps, TetrahedronPolygonsOptions {}

export function PolyTetrahedron({
  size,
  color,
  ...meshProps
}: PolyTetrahedronProps) {
  const polygons = useMemo(
    () => tetrahedronPolygons({ size, color }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [size, color],
  );
  return <PolyMesh polygons={polygons} {...meshProps} />;
}

export interface PolyIcosahedronProps extends ShapeMeshProps, IcosahedronPolygonsOptions {}

export function PolyIcosahedron({
  size,
  color,
  ...meshProps
}: PolyIcosahedronProps) {
  const polygons = useMemo(
    () => icosahedronPolygons({ size, color }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [size, color],
  );
  return <PolyMesh polygons={polygons} {...meshProps} />;
}

export interface PolyDodecahedronProps extends ShapeMeshProps, DodecahedronPolygonsOptions {}

export function PolyDodecahedron({
  size,
  color,
  ...meshProps
}: PolyDodecahedronProps) {
  const polygons = useMemo(
    () => dodecahedronPolygons({ size, color }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [size, color],
  );
  return <PolyMesh polygons={polygons} {...meshProps} />;
}

// ── Parametric primitives ─────────────────────────────────────────────────────

export interface PolyCylinderProps extends ShapeMeshProps, CylinderPolygonsOptions {}

export function PolyCylinder({
  radius,
  radiusTop,
  height,
  radialSegments,
  color,
  ...meshProps
}: PolyCylinderProps) {
  const polygons = useMemo(
    () => cylinderPolygons({ radius, radiusTop, height, radialSegments, color }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [radius, radiusTop, height, radialSegments, color],
  );
  return <PolyMesh polygons={polygons} {...meshProps} />;
}

export interface PolyConeProps extends ShapeMeshProps, ConePolygonsOptions {}

export function PolyCone({
  radius,
  height,
  radialSegments,
  color,
  ...meshProps
}: PolyConeProps) {
  const polygons = useMemo(
    () => conePolygons({ radius, height, radialSegments, color }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [radius, height, radialSegments, color],
  );
  return <PolyMesh polygons={polygons} {...meshProps} />;
}

export interface PolyTorusProps extends ShapeMeshProps, TorusPolygonsOptions {}

export function PolyTorus({
  radius,
  tube,
  radialSegments,
  tubularSegments,
  color,
  ...meshProps
}: PolyTorusProps) {
  const polygons = useMemo(
    () => torusPolygons({ radius, tube, radialSegments, tubularSegments, color }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [radius, tube, radialSegments, tubularSegments, color],
  );
  return <PolyMesh polygons={polygons} {...meshProps} />;
}
