import type { Vec3 } from "@layoutit/polycss-react";

/**
 * Wrapper translate (world units, world-axis order) that lands the mesh's
 * visible bbox center at `desiredWorld` (XY) and its lowest visible vertex
 * at world z = surfaceZ.
 *
 * Post-parity, `<PolyMesh position>` is `T·R·S` pivoting at the wrapper's
 * local origin (0,0,0), so for any vertex `v`:
 *   visible(v) = T + S*v   (rotation skipped here — caller applies it later)
 * For v = bbox center: visible_center = T + S*(midX, midY, midZ)
 * For v.z = minZ:      visible_bottom_z = T.z + S*minZ
 *
 * Solve for T so the visible center lands at (desiredWorldX, desiredWorldY)
 * and the visible bottom lands at surfaceZ.
 */
export function placeMeshOnFloor(
  desiredWorldX: number,
  desiredWorldY: number,
  bbox: { midX: number; midY: number; midZ: number; minZ: number },
  scale: number,
  /** Surface elevation in world units (default 0 = floor). Pass the
   *  heightmap-sampled value to land the mesh on top of an elevated
   *  cell instead of the floor. */
  surfaceZ: number = 0,
): Vec3 {
  return [
    desiredWorldX - scale * bbox.midX,
    desiredWorldY - scale * bbox.midY,
    surfaceZ - scale * bbox.minZ,
  ];
}
