/**
 * Vanilla DOM glue around core's pure receiver-shadow algorithm. Maintains
 * the per-mesh caches (face planes + caster items) and renders/syncs the
 * SVG elements emitted by `computeReceiverShadowFaces`.
 *
 * The algorithm itself — coplanar face grouping, per-tri 3D clip,
 * Sutherland-Hodgman against the face outline, fill/opacity resolution —
 * lives in `@layoutit/polycss-core/shadow/computeReceiverShadows.ts` so
 * React and Vue can share it without duplicating ~500 LOC of geometry.
 */
import {
  computeReceiverShadowFaces,
  meshScaleVec3,
  prepareCasterPolyItems,
  prepareReceiverFacePlanes,
  type CasterPolyItem,
  type CameraCullRotation,
  type ReceiverCasterInput,
  type ReceiverFacePlane,
  type Vec3,
} from "@layoutit/polycss-core";
import { syncShadowPaths } from "./shadowSvg";
import { meshShadowId } from "./shadowCache";
import type { SceneContext } from "./sceneContext";
import type { MeshEntry } from "./internalTypes";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Mounted SVG state per receiver face. Kept in a separate WeakMap so the
 *  core ReceiverFacePlane stays pure data. */
interface MountedFace {
  svg: SVGSVGElement | null;
  visible: boolean;
}
const mountedFacesByMesh = new WeakMap<MeshEntry, Map<number, MountedFace>>();

function mountedFacesFor(entry: MeshEntry): Map<number, MountedFace> {
  let m = mountedFacesByMesh.get(entry);
  if (!m) { m = new Map(); mountedFacesByMesh.set(entry, m); }
  return m;
}

export function emitReceiverShadows(
  ctx: SceneContext,
  casters: MeshEntry[],
  dedupByCaster: Map<MeshEntry, Set<number>>,
  receiverEntry: MeshEntry,
  receiverDedupDrop: Set<number>,
  lightDir: Vec3,
  _r: number, _g: number, _b: number,
  opacity: number,
): void {
  const options = ctx.options.current;
  const { receiverShadowCache, receiverShadowCacheKey, casterItemsCache, casterItemsCacheKey } = ctx;

  const rpos = receiverEntry.handle.transform.position ?? [0, 0, 0];
  const hasTexture = receiverEntry.polygons.some((p) => p.texture !== undefined);
  const receiverScale = meshScaleVec3(receiverEntry.handle.transform.scale);
  const rbboxCss = receiverEntry.bboxCenterCss;
  const cacheShadowLift = options.shadow?.lift ?? 0.001;
  const cacheKey = `${receiverEntry.polygons.length}|${receiverDedupDrop.size}|${rpos.join(",")}|${receiverScale.join(",")}|${rbboxCss ? rbboxCss.join(",") : "n"}|${cacheShadowLift}`;
  let cachedPlanes = receiverShadowCache.get(receiverEntry) as ReceiverFacePlane[] | undefined;
  if (cachedPlanes === undefined || receiverShadowCacheKey.get(receiverEntry) !== cacheKey) {
    cachedPlanes = prepareReceiverFacePlanes(
      receiverEntry.polygons,
      rpos,
      receiverEntry.handle.transform.scale,
      receiverDedupDrop,
      cacheShadowLift,
    );
    receiverShadowCache.set(receiverEntry, cachedPlanes);
    receiverShadowCacheKey.set(receiverEntry, cacheKey);
    // Reset mounted state when the plane list changes (face indices may
    // have shifted). Detach any orphan SVGs.
    const mounted = mountedFacesFor(receiverEntry);
    for (const face of mounted.values()) {
      if (face.svg && face.svg.parentNode) face.svg.parentNode.removeChild(face.svg);
    }
    mounted.clear();
  }

  // Per-caster items.
  const casterInputs: ReceiverCasterInput<MeshEntry>[] = [];
  for (const caster of casters) {
    const cpos = caster.handle.transform.position ?? [0, 0, 0];
    const casterScale = meshScaleVec3(caster.handle.transform.scale);
    const cbboxCss = caster.bboxCenterCss;
    const ckey = `${caster.polygons.length}|${cpos.join(",")}|${casterScale.join(",")}|${cbboxCss ? cbboxCss.join(",") : "n"}`;
    let cached = casterItemsCache.get(caster) as CasterPolyItem[] | undefined;
    if (cached === undefined || casterItemsCacheKey.get(caster) !== ckey) {
      const dedupDrop = dedupByCaster.get(caster)!;
      // Vanilla also filters to polygons with an atlas plan — i.e. those
      // actually rendered. Without a plan there's nothing to cast.
      const renderedIdx = new Set<number>();
      for (const item of caster.rendered) {
        if (item.plan && !dedupDrop.has(item.polygonIndex)) renderedIdx.add(item.polygonIndex);
      }
      cached = prepareCasterPolyItems(
        caster.polygons,
        cpos,
        caster.handle.transform.scale,
        (idx) => renderedIdx.has(idx),
      );
      casterItemsCache.set(caster, cached);
      casterItemsCacheKey.set(caster, ckey);
    }
    casterInputs.push({ id: caster, items: cached });
  }

  const cameraRot: CameraCullRotation = {
    rotX: ctx.camera.state.rotX,
    rotY: ctx.camera.state.rotY,
    meshRotation: receiverEntry.handle.transform.rotation,
  };

  const specs = computeReceiverShadowFaces<MeshEntry>({
    receiverPlanes: cachedPlanes,
    receiverPolygons: receiverEntry.polygons,
    receiverHasTexture: hasTexture,
    casters: casterInputs,
    lightDir,
    cameraRot,
    ambientLight: options.ambientLight,
    directionalLight: options.directionalLight,
    shadow: { color: options.shadow?.color, opacity },
  });

  // Mount/update SVGs from specs. Faces NOT in specs (back-facing, no
  // shadow content, etc.) get hidden.
  const mounted = mountedFacesFor(receiverEntry);
  const seen = new Set<number>();
  for (const spec of specs) {
    seen.add(spec.faceIndex);
    let face = mounted.get(spec.faceIndex);
    if (!face) { face = { svg: null, visible: false }; mounted.set(spec.faceIndex, face); }
    let svg = face.svg;
    if (!svg) {
      svg = ctx.doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "polycss-shadow polycss-shadow-svg polycss-shadow-receiver");
      svg.setAttribute("data-poly-shadow-type", "receiver");
      svg.setAttribute("data-poly-shadow-receiver", meshShadowId(receiverEntry));
      svg.setAttribute("data-poly-shadow-receiver-face", String(spec.faceIndex));
      svg.setAttribute("data-poly-shadow-receiver-polys", JSON.stringify(spec.memberPolyIndices));
      svg.setAttribute("width", String(spec.width));
      svg.setAttribute("height", String(spec.height));
      svg.setAttribute("viewBox", `0 0 ${spec.width} ${spec.height}`);
      svg.setAttribute(
        "style",
        `position:absolute;top:0;left:0;display:block;overflow:hidden;` +
        `transform-origin:0 0;pointer-events:none;will-change:transform;` +
        `transform:${spec.matrixCss}`,
      );
      ctx.sceneEl.insertBefore(svg, ctx.sceneEl.firstChild);
      face.svg = svg;
    } else if (!face.visible) {
      svg.style.display = "block";
    }
    face.visible = true;

    const paths = syncShadowPaths(svg, ctx.doc, spec.paths.length, /*withStroke*/ true);
    const opStr = spec.opacity.toFixed(4);
    const casterIds: string[] = [];
    for (let i = 0; i < spec.paths.length; i++) {
      const p = spec.paths[i]!;
      const casterId = meshShadowId(p.casterId);
      casterIds.push(casterId);
      const path = paths[i]!;
      path.setAttribute("d", p.d);
      if (path.getAttribute("fill") !== spec.fill) path.setAttribute("fill", spec.fill);
      if (path.getAttribute("stroke") !== spec.fill) path.setAttribute("stroke", spec.fill);
      if (path.getAttribute("opacity") !== opStr) path.setAttribute("opacity", opStr);
      if (path.getAttribute("data-poly-shadow-caster") !== casterId) {
        path.setAttribute("data-poly-shadow-caster", casterId);
      }
      const polysAttr = JSON.stringify(p.casterPolygonIndices);
      if (path.getAttribute("data-poly-shadow-caster-polys") !== polysAttr) {
        path.setAttribute("data-poly-shadow-caster-polys", polysAttr);
      }
    }
    const castersAttr = casterIds.join(" ");
    if (svg.getAttribute("data-poly-shadow-casters") !== castersAttr) {
      svg.setAttribute("data-poly-shadow-casters", castersAttr);
    }
  }
  // Hide faces with no current spec.
  for (const [idx, face] of mounted) {
    if (seen.has(idx)) continue;
    if (face.svg && face.visible) {
      face.svg.style.display = "none";
      face.visible = false;
    }
  }
}
