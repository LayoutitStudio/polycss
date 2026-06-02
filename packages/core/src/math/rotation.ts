import type { Vec3 } from "../types";

/**
 * Apply CSS-style chained `rotateX(rx) rotateY(ry) rotateZ(rz)` rotation
 * to a 3D vector. Matches the matrix composition used by PolyCSS mesh
 * wrapper transforms (see `buildTransform` in each PolyMesh implementation).
 *
 * CSS composes `transform: rotateX(rx) rotateY(ry) rotateZ(rz)` as the
 * matrix `M = Rx · Ry · Rz`, applied to a point as `M · p` — so Rz acts
 * first on the point, then Ry, then Rx. Compound rotations only commute
 * when axes coincide; getting the order wrong silently corrupts results
 * for any two-axis combination.
 *
 * Angles in degrees.
 */
export function rotateVec3(v: Vec3, rxDeg: number, ryDeg: number, rzDeg: number): Vec3 {
  const dx = (rxDeg * Math.PI) / 180;
  const dy = (ryDeg * Math.PI) / 180;
  const dz = (rzDeg * Math.PI) / 180;
  let [x, y, z] = v;
  if (dz !== 0) {
    const c = Math.cos(dz), s = Math.sin(dz);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  if (dy !== 0) {
    const c = Math.cos(dy), s = Math.sin(dy);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  if (dx !== 0) {
    const c = Math.cos(dx), s = Math.sin(dx);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  return [x, y, z];
}

/**
 * Inverse of `rotateVec3` for the same rotation tuple — transforms a
 * world-space vector into the mesh's local frame. Used by the baked
 * atlas pipeline to inverse-rotate the directional light so the
 * pre-multiplied Lambert shading stays correct after the mesh rotates,
 * and by the dynamic-mode CSS-var override for the same reason.
 *
 * The inverse of `M = Rx · Ry · Rz` is `M⁻¹ = Rz⁻¹ · Ry⁻¹ · Rx⁻¹`, so
 * Rx⁻¹ acts first on the vector, then Ry⁻¹, then Rz⁻¹.
 *
 * `rot` is `[rxDeg, ryDeg, rzDeg]` matching the mesh's CSS rotation prop.
 */
export function inverseRotateVec3(v: Vec3, rot: Vec3): Vec3 {
  const dx = (-rot[0] * Math.PI) / 180;
  const dy = (-rot[1] * Math.PI) / 180;
  const dz = (-rot[2] * Math.PI) / 180;
  let [x, y, z] = v;
  if (dx !== 0) {
    const c = Math.cos(dx), s = Math.sin(dx);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  if (dy !== 0) {
    const c = Math.cos(dy), s = Math.sin(dy);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  if (dz !== 0) {
    const c = Math.cos(dz), s = Math.sin(dz);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  return [x, y, z];
}

/**
 * Apply the wrapper's actual CSS rotation matrix to a CSS-frame vector,
 * given the user-supplied world rotation tuple `[rx_w, ry_w, rz_w]`.
 *
 * The wrapper emits `rotateY(-rx_w) rotateX(-ry_w) rotateZ(-rz_w)` (the
 * world↔CSS reflection conjugation of three.js XYZ Euler). That matrix
 * is `Ry(-rx_w) · Rx(-ry_w) · Rz(-rz_w) · v` applied to a vector. Use
 * this anywhere downstream code needs to transform a CSS-frame normal or
 * point through the same rotation the wrapper applies — e.g. back-face
 * culling, voxel item ordering. NOT for inverse-rotating a world light
 * direction into mesh-local frame — that still uses `inverseRotateVec3`
 * with the user's world rotation, since it operates in world frame.
 */
export function rotateVec3InWrapperCssFrame(v: Vec3, worldRot: Vec3): Vec3 {
  let [x, y, z] = v;
  const rz = (-(worldRot[2] ?? 0) * Math.PI) / 180;
  if (rz !== 0) {
    const c = Math.cos(rz), s = Math.sin(rz);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  const rx = (-(worldRot[1] ?? 0) * Math.PI) / 180; // CSS rotateX = -ry_w
  if (rx !== 0) {
    const c = Math.cos(rx), s = Math.sin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  const ry = (-(worldRot[0] ?? 0) * Math.PI) / 180; // CSS rotateY = -rx_w
  if (ry !== 0) {
    const c = Math.cos(ry), s = Math.sin(ry);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  return [x, y, z];
}
