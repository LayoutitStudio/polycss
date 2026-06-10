import type { Vec3 } from "../types";
import { worldPositionToCss } from "../shadow/receiverFaceGroups";

export interface PolyMeshTransformInput {
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
}

/**
 * Build the mesh wrapper transform used by every renderer for PolyCSS's
 * world-frame mesh transform contract.
 */
export function buildPolyMeshTransform(
  t: PolyMeshTransformInput,
): string | undefined {
  const sx = typeof t.scale === "number" ? t.scale : (t.scale?.[0] ?? 1);
  const sy = typeof t.scale === "number" ? t.scale : (t.scale?.[1] ?? 1);
  const sz = typeof t.scale === "number" ? t.scale : (t.scale?.[2] ?? 1);
  const hasScale = sx !== 1 || sy !== 1 || sz !== 1;
  const hasRotation = !!t.rotation && (!!t.rotation[0] || !!t.rotation[1] || !!t.rotation[2]);
  const cssPos = t.position ? worldPositionToCss(t.position) : [0, 0, 0] as Vec3;

  const parts: string[] = [];
  if (cssPos[0] !== 0 || cssPos[1] !== 0 || cssPos[2] !== 0) {
    parts.push(`translate3d(${cssPos[0]}px, ${cssPos[1]}px, ${cssPos[2]}px)`);
  }
  if (hasRotation) {
    if (t.rotation![0]) parts.push(`rotateY(${-t.rotation![0]}deg)`);
    if (t.rotation![1]) parts.push(`rotateX(${-t.rotation![1]}deg)`);
    if (t.rotation![2]) parts.push(`rotateZ(${-t.rotation![2]}deg)`);
  }
  if (hasScale) {
    parts.push(`scale3d(${sx}, ${sy}, ${sz})`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}
