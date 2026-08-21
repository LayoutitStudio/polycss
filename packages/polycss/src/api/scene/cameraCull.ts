/**
 * Camera-facing DOM culling for voxel-shaped meshes: normal grouping, the
 * cull signature, and the incremental mount/unmount patch that adds or
 * removes leaves when the camera or mesh rotation crosses a visible-normal
 * boundary.
 *
 * Extracted verbatim from createPolyScene.ts; closure-captured scene state
 * comes in through the SceneContext.
 */
import type {
  CameraCullNormalGroup,
  CameraCullRotation,
  Vec3,
} from "@layoutit/polycss-core";
import {
  CAMERA_BACKFACE_CULL_EPS,
  VOXEL_CAMERA_CULL_NORMAL_LIMIT,
  cameraCullNormalKey,
  cameraCullVisibleSignature,
  isAxisAlignedSurfaceNormal,
  isVoxelCameraCullableNormalGroups,
  normalFacesCamera,
  polygonCssSurfaceNormal,
} from "@layoutit/polycss-core";
import type { RenderedPoly } from "../../render/textureAtlas";
import { firstPreservedChild, mountRenderedFragment } from "./mountLifecycle";
import type { SceneContext } from "./sceneContext";
import type { MeshEntry } from "./internalTypes";

// Sentinel that keeps broad camera DOM culling disabled once a mesh proves
// it has non-voxel normals; callers never inspect group contents directly.
const NON_CULLABLE_CAMERA_GROUP: CameraCullNormalGroup = {
  key: "non-cullable",
  normal: [1, 1, 0],
};

export function nonCullableCameraGroups(): CameraCullNormalGroup[] {
  return [NON_CULLABLE_CAMERA_GROUP];
}

export function normalForRendered(entry: MeshEntry, item: RenderedPoly): Vec3 | null {
  const poly = entry.polygons[item.polygonIndex];
  if (entry.stableDom && poly) return polygonCssSurfaceNormal(poly);
  return item.plan?.normal ?? (poly ? polygonCssSurfaceNormal(poly) : null);
}

export function renderedItemsForCamera(ctx: SceneContext, entry: MeshEntry): RenderedPoly[] {
  if (!canDomCullCamera(entry)) return entry.rendered;
  const rotation = cameraCullRotation(ctx, entry);
  return entry.rendered.filter((item) =>
    renderedItemFacesCamera(entry, item, CAMERA_BACKFACE_CULL_EPS, rotation)
  );
}

export function cameraCullRotation(ctx: SceneContext, entry: MeshEntry): CameraCullRotation {
  return {
    rotX: ctx.camera.state.rotX,
    rotY: ctx.camera.state.rotY,
    meshRotation: entry.handle.transform.rotation,
  };
}

export function renderedItemFacesCamera(
  entry: MeshEntry,
  item: RenderedPoly,
  depthThreshold: number,
  rotation: CameraCullRotation,
): boolean {
  const normal = normalForRendered(entry, item);
  return normal === null || normalFacesCamera(normal, rotation, depthThreshold);
}

export function recomputeCameraCullGroups(entry: MeshEntry): void {
  if (entry.excludeFromAutoCenter) {
    entry.cameraCullGroups = [];
    return;
  }
  const groups = new Map<string, Vec3>();
  for (const item of entry.rendered) {
    const normal = normalForRendered(entry, item);
    if (!normal) continue;
    if (!isAxisAlignedSurfaceNormal(normal)) {
      entry.cameraCullGroups = nonCullableCameraGroups();
      return;
    }
    const key = cameraCullNormalKey(normal);
    if (!groups.has(key)) {
      groups.set(key, normal);
      if (groups.size > VOXEL_CAMERA_CULL_NORMAL_LIMIT) {
        entry.cameraCullGroups = nonCullableCameraGroups();
        return;
      }
    }
  }
  entry.cameraCullGroups = Array.from(groups, ([key, normal]) => ({ key, normal }));
}

export function cameraCullSignature(ctx: SceneContext, entry: MeshEntry): string {
  return canDomCullCamera(entry)
    ? cameraCullVisibleSignature(entry.cameraCullGroups, cameraCullRotation(ctx, entry))
    : "all";
}

export function canDomCullCamera(entry: MeshEntry): boolean {
  return !entry.excludeFromAutoCenter &&
    isVoxelCameraCullableNormalGroups(entry.cameraCullGroups);
}

export function syncCameraCullSignature(ctx: SceneContext, entry: MeshEntry): void {
  entry.cameraCullSignature = canDomCullCamera(entry)
    ? cameraCullSignature(ctx, entry)
    : "all";
}

export function patchMountedRenderedForCamera(
  ctx: SceneContext,
  entry: MeshEntry,
  depthThreshold: number,
): boolean {
  const doc = ctx.doc;
  const visible = new Array<boolean>(entry.rendered.length);
  let changed = false;
  const rotation = cameraCullRotation(ctx, entry);

  for (let i = 0; i < entry.rendered.length; i += 1) {
    const item = entry.rendered[i];
    const shouldMount = renderedItemFacesCamera(entry, item, depthThreshold, rotation);
    visible[i] = shouldMount;
  }

  let removeStart: HTMLElement | null = null;
  let removeEnd: HTMLElement | null = null;
  const flushRemove = () => {
    if (!removeStart || !removeEnd) return;
    if (removeStart === removeEnd) {
      removeStart.remove();
    } else {
      const range = doc.createRange();
      range.setStartBefore(removeStart);
      range.setEndAfter(removeEnd);
      range.deleteContents();
      range.detach();
    }
    removeStart = null;
    removeEnd = null;
    changed = true;
  };

  for (let i = 0; i < entry.rendered.length; i += 1) {
    const item = entry.rendered[i];
    if (!visible[i] && item.element.parentNode === entry.wrapper) {
      if (removeEnd && removeEnd.nextSibling === item.element) {
        removeEnd = item.element;
      } else {
        flushRemove();
        removeStart = item.element;
        removeEnd = item.element;
      }
    } else {
      flushRemove();
    }
  }
  flushRemove();

  const insertionPointAfter = (index: number): ChildNode | null => {
    for (let i = index; i < entry.rendered.length; i += 1) {
      const next = entry.rendered[i].element;
      if (next.parentNode === entry.wrapper) return next;
    }
    return firstPreservedChild(entry);
  };

  let addStart = -1;
  const flushAdd = (endExclusive: number) => {
    if (addStart < 0) return;
    const fragment = doc.createDocumentFragment();
    for (let i = addStart; i < endExclusive; i += 1) {
      const item = entry.rendered[i];
      restoreInlineDynamicNormalVars(ctx, entry, item);
      fragment.appendChild(item.element);
    }
    mountRenderedFragment(entry, fragment, insertionPointAfter(endExclusive));
    addStart = -1;
    changed = true;
  };

  for (let i = 0; i < entry.rendered.length; i += 1) {
    const item = entry.rendered[i];
    if (visible[i] && item.element.parentNode !== entry.wrapper) {
      if (addStart < 0) addStart = i;
    } else {
      flushAdd(i);
    }
  }
  flushAdd(entry.rendered.length);

  return changed;
}

function dynamicNormalForRendered(entry: MeshEntry, item: RenderedPoly): Vec3 | null {
  return normalForRendered(entry, item);
}

export function restoreInlineDynamicNormalVars(
  ctx: SceneContext,
  entry: MeshEntry,
  item: RenderedPoly,
): void {
  if (ctx.options.current.textureLighting !== "dynamic") return;
  const normal = dynamicNormalForRendered(entry, item);
  if (!normal) return;
  item.element.style.setProperty("--pnx", normal[0].toFixed(4));
  item.element.style.setProperty("--pny", normal[1].toFixed(4));
  item.element.style.setProperty("--pnz", normal[2].toFixed(4));
}
