import { useMemo } from "react";
import type { PolyDirectionalLight, Vec3 } from "@layoutit/polycss-core";
import { octahedronPolygons } from "@layoutit/polycss-core";
import { PolyMesh } from "../scene";

export interface PolyDirectionalLightHelperProps {
  /** Light to visualize. */
  light: PolyDirectionalLight;
  /**
   * Point the marker orbits around, in world coords. Mirrors three.js's
   * `DirectionalLight.target.position` — usually the mesh's bbox center.
   * Defaults to the world origin.
   */
  target?: Vec3;
  /** Distance from `target` to render the source marker, in world units. */
  distance?: number;
  /** Marker half-extent in world units. */
  size?: number;
  /** Marker color override. Defaults to `light.color`. */
  color?: string;
}

/**
 * PolyDirectionalLightHelper — small octahedron placed along the light's
 * direction vector. Mirrors three.js's `DirectionalLightHelper`.
 *
 * Post-parity: both `light.direction` and `target` are in WORLD coords
 * (`+X right, +Y forward, +Z up`), and `<PolyMesh>`'s `position` prop is
 * also world units (the renderer applies the world→CSS axis swap +
 * ×BASE_TILE internally). The helper just adds `dir × distance` to
 * `target` and passes the result through.
 *
 * The octahedron is built at LOCAL origin once; the world position is
 * applied via PolyMesh's `position` prop (a CSS transform on the wrapper).
 * That keeps the polygons array reference-stable across light-direction
 * changes — the atlas does not rebuild and the marker glides smoothly.
 */
export function PolyDirectionalLightHelper({
  light,
  target,
  distance = 5,
  size = 0.35,
  color,
}: PolyDirectionalLightHelperProps) {
  const swatch = color ?? light.color ?? "#ffd54a";

  const polygons = useMemo(
    () => octahedronPolygons({ center: [0, 0, 0], size, color: swatch }),
    [size, swatch],
  );

  const meshPosition = useMemo<Vec3>(() => {
    const [dx, dy, dz] = light.direction;
    const len = Math.hypot(dx, dy, dz) || 1;
    const tx = target?.[0] ?? 0;
    const ty = target?.[1] ?? 0;
    const tz = target?.[2] ?? 0;
    return [
      tx + (dx / len) * distance,
      ty + (dy / len) * distance,
      tz + (dz / len) * distance,
    ];
  }, [light.direction, target, distance]);

  return <PolyMesh polygons={polygons} position={meshPosition} merge={false} />;
}
