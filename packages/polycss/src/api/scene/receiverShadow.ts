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
  prepareReceiverFacePlanes,
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
// Mounts are namespaced per light so a directional pass and one pass per
// shadow-casting point light can coexist on the same receiver mesh without
// colliding on faceIndex. Outer key: a per-light identity ("" = directional,
// "p0".."pN" = point lights). Inner key: faceIndex.
const mountedFacesByMesh = new WeakMap<MeshEntry, Map<string, Map<number, MountedFace>>>();

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

function lightMapFor(entry: MeshEntry): Map<string, Map<number, MountedFace>> {
  let m = mountedFacesByMesh.get(entry);
  if (!m) { m = new Map(); mountedFacesByMesh.set(entry, m); }
  return m;
}

function mountedFacesFor(entry: MeshEntry, lightKey: string): Map<number, MountedFace> {
  const byLight = lightMapFor(entry);
  let m = byLight.get(lightKey);
  if (!m) { m = new Map(); byLight.set(lightKey, m); }
  return m;
}

/** Detach + clear every mounted face across every light namespace for a mesh. */
function detachAllFaces(entry: MeshEntry): void {
  const byLight = mountedFacesByMesh.get(entry);
  if (!byLight) return;
  for (const faces of byLight.values()) {
    for (const face of faces.values()) {
      if (face.svg && face.svg.parentNode) face.svg.parentNode.removeChild(face.svg);
    }
    faces.clear();
  }
  byLight.clear();
}

/**
 * Detach every receiver-shadow SVG previously mounted for this mesh and
 * clear the local mount bookkeeping. Call when a mesh stops being a
 * receiver (`receiveShadow` flips false) — the per-frame emitter would
 * otherwise never run for that mesh and the stale SVGs from when it WAS
 * a receiver would linger in the DOM.
 */
export function disposeReceiverShadowMounts(entry: MeshEntry): void {
  detachAllFaces(entry);
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
  /** When set, the light is a point light at this CSS-frame position; the
   *  projection becomes radial. */
  lightPos?: Vec3,
  /** Per-light SVG-mount namespace ("" = directional). */
  lightKey = "",
): void {
  const options = ctx.options.current;
  const { receiverShadowCache, receiverShadowCacheKey, casterItemsCache, casterItemsCacheKey } = ctx;

  const rpos = receiverEntry.handle.transform.position ?? [0, 0, 0];
  const rrot = receiverEntry.handle.transform.rotation ?? [0, 0, 0];
  const hasTexture = receiverEntry.polygons.some((p) => p.texture !== undefined);
  const receiverScale = meshScaleVec3(receiverEntry.handle.transform.scale);
  const rbboxCss = receiverEntry.bboxCenterCss;
  const cacheShadowLift = options.shadow?.lift ?? 0.001;
  const cacheKey = `${receiverEntry.polygons.length}|${receiverDedupDrop.size}|${rpos.join(",")}|${rrot.join(",")}|${receiverScale.join(",")}|${rbboxCss ? rbboxCss.join(",") : "n"}|${cacheShadowLift}`;
  let cachedPlanes = receiverShadowCache.get(receiverEntry) as ReceiverFacePlane[] | undefined;
  if (cachedPlanes === undefined || receiverShadowCacheKey.get(receiverEntry) !== cacheKey) {
    cachedPlanes = prepareReceiverFacePlanes(
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
    // have shifted). Detach any orphan SVGs across every light namespace.
    detachAllFaces(receiverEntry);
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
      // Cast from EVERY polygon. Geometry casts a shadow regardless of
      // whether it's painted for the camera (atlas plan) or whether the
      // render-dedup dropped it as an overlapping/back face — both filters
      // left camera-dependent holes in the floor shadow of imported meshes
      // (a poly facing the light but not the camera, or a back face whose
      // coincident twin faces away from the light, simply vanished). The
      // per-mesh `fill-rule: nonzero` path merges coincident projections,
      // so duplicates don't alpha-stack — no dedup needed here.
      cached = prepareCasterPolyItems(
        caster.polygons,
        cpos,
        caster.handle.transform.scale,
        () => true,
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
    // path. Skip on self-shadow (caster IS receiver — the per-poly path
    // is geometrically required there) and on tiny meshes (silhouette
    // overhead exceeds the per-poly cost below ~40 polys).
    // Point-light passes always need edgeOwners: the radial shadow projects
    // the caster silhouette (not per-face back-faces), so even small meshes
    // (a 6-quad cube) require the outline. Directional keeps the ≥40-poly
    // gate where the per-poly path is cheaper.
    let edgeOwners: ReadonlyMap<string, EdgeOwners> | undefined;
    if (caster !== receiverEntry && (caster.polygons.length >= 40 || lightPos)) {
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
    lightPos,
    cameraRot,
    ambientLight: options.ambientLight,
    directionalLight: options.directionalLight,
    shadow: { color: options.shadow?.color, opacity, maxExtend: options.shadow?.maxExtend },
  });

  // Mount/update SVGs from specs. Faces NOT in specs (back-facing, no
  // shadow content, etc.) get hidden.
  const mounted = mountedFacesFor(receiverEntry, lightKey);
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
        if (lightKey) svg.setAttribute("data-poly-shadow-light", lightKey);
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
