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
  buildSharedEdgeMap,
  computeReceiverShadowFaces,
  meshScaleVec3,
  prepareCasterEdgeOwners,
  prepareCasterPolyItems,
  prepareProxyReceiverPlanes,
  prepareReceiverFacePlanes,
  PROXY_MIN_POLYS,
  type CasterPolyItem,
  type CameraCullRotation,
  type EdgeOwners,
  type ReceiverCasterInput,
  type ReceiverFacePlane,
  type Vec3,
} from "@layoutit/polycss-core";
import { ensureShadowRoot, syncShadowPaths } from "./shadowSvg";
import { meshShadowId } from "./shadowCache";
import type { SceneContext } from "./sceneContext";
import type { MeshEntry } from "./internalTypes";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Mounted SVG state per receiver face. Kept in a separate WeakMap so the
 *  core ReceiverFacePlane stays pure data. */
interface MountedFace {
  svg: SVGSVGElement | null;
  visible: boolean;
  /** Last applied SVG width — only re-set on change to avoid re-layout. */
  width: number;
  /** Last applied SVG height. */
  height: number;
  /** Last applied matrix3d string — only re-set on change to dodge style work. */
  matrixCss: string;
}
const mountedFacesByMesh = new WeakMap<MeshEntry, Map<number, MountedFace>>();

/** Cached shared-edge adjacency per mesh. Invalidated when the polygon
 *  array reference changes (cheap identity check, no deep diff). */
const sharedEdgeMapCache = new WeakMap<MeshEntry, ReadonlyMap<number, ReadonlySet<number>>>();
const sharedEdgeMapCacheKey = new WeakMap<MeshEntry, readonly unknown[]>();

/** Cached silhouette edge ownership per caster mesh. Same shape as the
 *  per-frame `casterItemsCache` bust key — polygon list identity + world
 *  transform fields — so the world-frame edge owners stay coherent with
 *  the matching CasterPolyItem[] without an extra invalidation pass. */
const edgeOwnersCache = new WeakMap<MeshEntry, ReadonlyMap<string, EdgeOwners>>();
const edgeOwnersCacheKey = new WeakMap<MeshEntry, string>();

function mountedFacesFor(entry: MeshEntry): Map<number, MountedFace> {
  let m = mountedFacesByMesh.get(entry);
  if (!m) { m = new Map(); mountedFacesByMesh.set(entry, m); }
  return m;
}

/**
 * Detach every receiver-shadow SVG previously mounted for this mesh and
 * clear the local mount bookkeeping. Call when a mesh stops being a
 * receiver (`receiveShadow` flips false) — the per-frame emitter would
 * otherwise never run for that mesh and the stale SVGs from when it WAS
 * a receiver would linger in the DOM.
 */
export function disposeReceiverShadowMounts(entry: MeshEntry): void {
  const mounted = mountedFacesByMesh.get(entry);
  if (!mounted) return;
  for (const face of mounted.values()) {
    if (face.svg && face.svg.parentNode) face.svg.parentNode.removeChild(face.svg);
  }
  mounted.clear();
  mountedFacesByMesh.delete(entry);
}

/**
 * Detach every receiver-shadow SVG mounted across every mesh in the scene.
 * Called when the scene has zero casters (e.g. the only caster toggled
 * `castShadow` off) — the per-frame emitter never runs in that pass so
 * the previously-mounted SVGs would otherwise linger frozen on whatever
 * pose the light had at the last emit.
 */
export function disposeAllReceiverShadowMounts(ctx: SceneContext): void {
  for (const entry of ctx.meshes) disposeReceiverShadowMounts(entry);
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
  const rrot = receiverEntry.handle.transform.rotation ?? [0, 0, 0];
  const hasTexture = receiverEntry.polygons.some((p) => p.texture !== undefined);
  const receiverScale = meshScaleVec3(receiverEntry.handle.transform.scale);
  const rbboxCss = receiverEntry.bboxCenterCss;
  const cacheShadowLift = options.shadow?.lift ?? 0.001;
  // H11b proxy mode: when this receiver also self-shadows and has enough
  // polygons that per-face decomposition is the dominant cost, swap the
  // per-coplanar-face planes for ~6 OBB-face proxy planes. The silhouette
  // path (H9b) then projects ONE outline per proxy with per-member-poly
  // clipping — drops receiver SVG count from 100-250 to 3-6 on the
  // teapot self-shadow case.
  const selfShadowActive = casters.some((c) => c === receiverEntry);
  const useProxyPlanes = selfShadowActive && receiverEntry.polygons.length >= PROXY_MIN_POLYS;
  const planeMode = useProxyPlanes ? "p" : "f";
  const cacheKey = `${planeMode}|${receiverEntry.polygons.length}|${receiverDedupDrop.size}|${rpos.join(",")}|${rrot.join(",")}|${receiverScale.join(",")}|${rbboxCss ? rbboxCss.join(",") : "n"}|${cacheShadowLift}`;
  let cachedPlanes = receiverShadowCache.get(receiverEntry) as ReceiverFacePlane[] | undefined;
  if (cachedPlanes === undefined || receiverShadowCacheKey.get(receiverEntry) !== cacheKey) {
    cachedPlanes = useProxyPlanes
      ? prepareProxyReceiverPlanes(
          receiverEntry.polygons,
          rpos,
          receiverEntry.handle.transform.scale,
          receiverDedupDrop,
          cacheShadowLift,
          rrot,
        )
      : prepareReceiverFacePlanes(
          receiverEntry.polygons,
          rpos,
          receiverEntry.handle.transform.scale,
          receiverDedupDrop,
          cacheShadowLift,
          rrot,
        );
    receiverShadowCache.set(receiverEntry, cachedPlanes);
    receiverShadowCacheKey.set(receiverEntry, cacheKey);
    // Reset mounted state when the plane list changes (face indices may
    // have shifted, and the mode swap reuses 0..5 indices). Detach any
    // orphan SVGs.
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
    const crot = caster.handle.transform.rotation ?? [0, 0, 0];
    const casterScale = meshScaleVec3(caster.handle.transform.scale);
    const cbboxCss = caster.bboxCenterCss;
    const ckey = `${caster.polygons.length}|${cpos.join(",")}|${crot.join(",")}|${casterScale.join(",")}|${cbboxCss ? cbboxCss.join(",") : "n"}`;
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
        crot,
      );
      casterItemsCache.set(caster, cached);
      casterItemsCacheKey.set(caster, ckey);
    }
    // Self-shadow seam cull: when the caster IS the receiver mesh, pass
    // a cached shared-edge adjacency map so the algorithm skips projecting
    // any polygon onto a face that contains one of its edge-sharing
    // neighbours (kills the spiderweb seam shadows on smooth GLBs).
    let selfShadowEdgeMap: ReadonlyMap<number, ReadonlySet<number>> | undefined;
    if (caster === receiverEntry) {
      let cachedMap = sharedEdgeMapCache.get(caster);
      if (cachedMap === undefined || sharedEdgeMapCacheKey.get(caster) !== caster.polygons) {
        cachedMap = buildSharedEdgeMap(caster.polygons);
        sharedEdgeMapCache.set(caster, cachedMap);
        sharedEdgeMapCacheKey.set(caster, caster.polygons);
      }
      selfShadowEdgeMap = cachedMap;
    }
    // Silhouette edge ownership for the H9 per-caster-mesh silhouette
    // path (extended to self-shadow in H9b — the silhouette IS the
    // geometric boundary of the lit region, which subsumes the per-poly
    // seam cull). Skip only on tiny meshes (silhouette overhead exceeds
    // the per-poly cost below ~40 polys).
    let edgeOwners: ReadonlyMap<string, EdgeOwners> | undefined;
    if (caster.polygons.length >= 40) {
      let cachedOwners = edgeOwnersCache.get(caster);
      if (cachedOwners === undefined || edgeOwnersCacheKey.get(caster) !== ckey) {
        cachedOwners = prepareCasterEdgeOwners(
          caster.polygons,
          cpos,
          caster.handle.transform.scale,
          crot,
        );
        edgeOwnersCache.set(caster, cachedOwners);
        edgeOwnersCacheKey.set(caster, ckey);
      }
      edgeOwners = cachedOwners;
    }
    casterInputs.push({
      id: caster,
      items: cached,
      selfShadowEdgeMap,
      edgeOwners,
      casterPolygonCount: caster.polygons.length,
    });
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
    shadow: { color: options.shadow?.color, opacity, maxExtend: options.shadow?.maxExtend },
  });

  // Mount/update SVGs from specs. Faces NOT in specs (back-facing, no
  // shadow content, etc.) get hidden.
  const mounted = mountedFacesFor(receiverEntry);
  const seen = new Set<number>();
  for (const spec of specs) {
    seen.add(spec.faceIndex);
    let face = mounted.get(spec.faceIndex);
    if (!face) {
      face = { svg: null, visible: false, width: -1, height: -1, matrixCss: "" };
      mounted.set(spec.faceIndex, face);
    }
    let svg = face.svg;
    if (!svg) {
      svg = ctx.doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "polycss-shadow polycss-shadow-svg polycss-shadow-receiver");
      if (options.debugShadowAttrs) {
        svg.setAttribute("data-poly-shadow-type", "receiver");
        svg.setAttribute("data-poly-shadow-receiver", meshShadowId(receiverEntry));
        svg.setAttribute("data-poly-shadow-receiver-face", String(spec.faceIndex));
        svg.setAttribute("data-poly-shadow-receiver-polys", JSON.stringify(spec.memberPolyIndices));
      }
      svg.setAttribute("width", String(spec.width));
      svg.setAttribute("height", String(spec.height));
      svg.setAttribute("viewBox", `0 0 ${spec.width} ${spec.height}`);
      svg.setAttribute(
        "style",
        `position:absolute;top:0;left:0;display:block;overflow:hidden;` +
        `transform-origin:0 0;pointer-events:none;will-change:transform;` +
        `transform:${spec.matrixCss}`,
      );
      // Mount inside the shared `.polycss-shadows` wrapper at scene root.
      // The SVG's matrix3d still encodes the face plane in world frame —
      // the wrapper is a 0×0 preserve-3d container that takes no layout
      // space, so children composite at their absolute matrix3d positions
      // just like they did when mounted directly on sceneEl. Grouping
      // exists for DOM organization (clean DevTools tree) and to make
      // future "clip all shadows to a region" / "hide all shadows" toggles
      // trivial (one ancestor to flip).
      const shadowRoot = ensureShadowRoot(ctx.shadowSvgState, ctx.doc, ctx.sceneEl);
      shadowRoot.appendChild(svg);
      face.svg = svg;
      face.width = spec.width;
      face.height = spec.height;
      face.matrixCss = spec.matrixCss;
    } else {
      if (!face.visible) svg.style.display = "block";
      // Tight shadow-bbox SVGs resize/translate every frame as the shadow
      // sweeps across the receiver — re-apply width/height/viewBox/transform
      // only when they actually change.
      if (face.width !== spec.width || face.height !== spec.height) {
        svg.setAttribute("width", String(spec.width));
        svg.setAttribute("height", String(spec.height));
        svg.setAttribute("viewBox", `0 0 ${spec.width} ${spec.height}`);
        face.width = spec.width;
        face.height = spec.height;
      }
      if (face.matrixCss !== spec.matrixCss) {
        svg.style.transform = spec.matrixCss;
        face.matrixCss = spec.matrixCss;
      }
    }
    face.visible = true;

    const paths = syncShadowPaths(svg, ctx.doc, spec.paths.length, /*withStroke*/ true);
    const opStr = spec.opacity.toFixed(4);
    const casterIds: string[] = [];
    const wantDebug = !!options.debugShadowAttrs;
    for (let i = 0; i < spec.paths.length; i++) {
      const p = spec.paths[i]!;
      const casterId = wantDebug ? meshShadowId(p.casterId) : "";
      if (wantDebug) casterIds.push(casterId);
      const path = paths[i]!;
      path.setAttribute("d", p.d);
      if (path.getAttribute("fill") !== spec.fill) path.setAttribute("fill", spec.fill);
      if (path.getAttribute("stroke") !== spec.fill) path.setAttribute("stroke", spec.fill);
      if (path.getAttribute("opacity") !== opStr) path.setAttribute("opacity", opStr);
      if (wantDebug) {
        if (path.getAttribute("data-poly-shadow-caster") !== casterId) {
          path.setAttribute("data-poly-shadow-caster", casterId);
        }
        const polysAttr = JSON.stringify(p.casterPolygonIndices);
        if (path.getAttribute("data-poly-shadow-caster-polys") !== polysAttr) {
          path.setAttribute("data-poly-shadow-caster-polys", polysAttr);
        }
      }
    }
    if (wantDebug) {
      const castersAttr = casterIds.join(" ");
      if (svg.getAttribute("data-poly-shadow-casters") !== castersAttr) {
        svg.setAttribute("data-poly-shadow-casters", castersAttr);
      }
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
