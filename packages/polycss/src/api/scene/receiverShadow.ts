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
  parseHexColor,
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
import { ensureShadowRoot } from "./shadowSvg";
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
  /** Every light's shadow pass for this receiver. All of a face's passes are
   *  merged into ONE SVG so overlapping shadows composite correctly (the base
   *  is the full-lit face color, each pass a multiply layer). */
  passes: {
    /** Run the directional pass (mount namespace aside, always merged). */
    runDirectional: boolean;
    /** One entry per shadow-casting point light: its CSS position + index
     *  into `allPointLights`. */
    points: ReadonlyArray<{ lightPos: Vec3; index: number }>;
    /** All scene point lights (CSS positions) for the shaded shadow color. */
    allPointLights?: ReadonlyArray<{ position: Vec3; color?: string; intensity?: number }>;
  },
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
    if (caster !== receiverEntry && (caster.polygons.length >= 40 || passes.points.length > 0)) {
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

  // Plane basis lookup by faceIndex (cachedPlanes is occlusion-filtered).
  const planeByFace = new Map<number, ReceiverFacePlane>();
  for (const pl of cachedPlanes) planeByFace.set(pl.faceIndex, pl);

  // Aggregate every light pass per receiver FACE, so a face's coplanar shadows
  // share one SVG and overlaps composite correctly. Solid receivers paint a
  // base = full-lit color C, then each pass as a `multiply` layer with factor
  // (remaining/C) — overlaps become C·fA·fB (both lights removed). Textured
  // receivers (per-pixel base, no uniform multiply) fall back to per-pass dark
  // alpha layers, which cumulatively darken.
  // `fill` is the per-pass remaining-light color (receiver lit by all OTHER
  // lights). Single-layer faces paint it directly (one path, like before);
  // multi-layer faces multiply it against the base as `fill/base`.
  type Layer = { polys: Array<Array<[number, number]>>; fill: string; opacity: number };
  type FaceAgg = { memberPolyIndices: number[]; base: string; solid: boolean; layers: Layer[] };
  const perFace = new Map<number, FaceAgg>();

  const runPass = (lightPos: Vec3 | undefined, thisPointIndex: number | undefined): void => {
    const specs = computeReceiverShadowFaces<MeshEntry>({
      receiverPlanes: cachedPlanes,
      receiverPolygons: receiverEntry.polygons,
      receiverHasTexture: hasTexture,
      casters: casterInputs,
      lightDir,
      lightPos,
      allPointLights: passes.allPointLights,
      thisPointIndex,
      cameraRot,
      ambientLight: options.ambientLight,
      directionalLight: options.directionalLight,
      shadow: { color: options.shadow?.color, opacity, maxExtend: options.shadow?.maxExtend },
    });
    for (const spec of specs) {
      if (spec.facePolysUv.length === 0) continue;
      const solid = spec.fullLitFill !== "";
      let agg = perFace.get(spec.faceIndex);
      if (!agg) {
        agg = { memberPolyIndices: spec.memberPolyIndices, base: spec.fullLitFill, solid, layers: [] };
        perFace.set(spec.faceIndex, agg);
      }
      agg.layers.push({ polys: spec.facePolysUv, fill: spec.fill, opacity: spec.opacity });
    }
  };
  if (passes.runDirectional) runPass(undefined, undefined);
  for (const p of passes.points) runPass(p.lightPos, p.index);

  const mounted = mountedFacesFor(receiverEntry, "m");
  const seen = new Set<number>();
  const wantDebug = !!options.debugShadowAttrs;
  const shadowRoot = ensureShadowRoot(ctx.shadowSvgState, ctx.doc, ctx.sceneEl);

  for (const [faceIndex, agg] of perFace) {
    const plane = planeByFace.get(faceIndex);
    if (!plane || agg.layers.length === 0) continue;
    // Union bbox over every pass's polys (absolute face-(u,v)).
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const layer of agg.layers) for (const poly of layer.polys) for (const pt of poly) {
      if (pt[0] < minU) minU = pt[0];
      if (pt[0] > maxU) maxU = pt[0];
      if (pt[1] < minV) minV = pt[1];
      if (pt[1] > maxV) maxV = pt[1];
    }
    if (!Number.isFinite(minU)) continue;
    minU = Math.floor(minU - 1); minV = Math.floor(minV - 1);
    maxU = Math.ceil(maxU + 1); maxV = Math.ceil(maxV + 1);
    const w = maxU - minU, h = maxV - minV;
    if (!(w > 0) || !(h > 0)) continue;

    const { O, u, v, n, lift } = plane;
    const tx = O[0] + minU * u[0] + minV * v[0] + lift * n[0];
    const ty = O[1] + minU * u[1] + minV * v[1] + lift * n[1];
    const tz = O[2] + minU * u[2] + minV * v[2] + lift * n[2];
    const m = [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, n[0], n[1], n[2], 0, tx, ty, tz, 1];
    const matrixCss = `matrix3d(${m.map((x) => x.toFixed(4)).join(",")})`;

    seen.add(faceIndex);
    let face = mounted.get(faceIndex);
    if (!face) {
      face = { svg: null, visible: false, width: -1, height: -1, matrixCss: "" };
      mounted.set(faceIndex, face);
    }
    let svg = face.svg;
    if (!svg) {
      svg = ctx.doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "polycss-shadow polycss-shadow-svg polycss-shadow-receiver");
      shadowRoot.appendChild(svg);
      face.svg = svg;
    }
    if (!face.visible) svg.style.display = "block";
    face.visible = true;
    if (face.width !== w || face.height !== h) {
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      face.width = w;
      face.height = h;
    }
    // A single-light face paints its remaining color directly (one path); only
    // multi-light SOLID faces need the base + per-pass `multiply` layers for
    // correct overlap. Solid multi-light carries shadow strength at the SVG
    // level (layers stay opaque so multiply is exact); everything else keeps
    // per-path alpha.
    const merged = agg.solid && agg.layers.length > 1;
    const svgOpacity = merged ? opacity : 1;
    const style =
      `position:absolute;top:0;left:0;display:block;overflow:hidden;` +
      `transform-origin:0 0;pointer-events:none;will-change:transform;` +
      `opacity:${svgOpacity.toFixed(4)};transform:${matrixCss}`;
    if (face.matrixCss !== style) { svg.setAttribute("style", style); face.matrixCss = style; }
    if (wantDebug) {
      svg.setAttribute("data-poly-shadow-type", "receiver");
      svg.setAttribute("data-poly-shadow-receiver", meshShadowId(receiverEntry));
      svg.setAttribute("data-poly-shadow-receiver-face", String(faceIndex));
      svg.setAttribute("data-poly-shadow-receiver-polys", JSON.stringify(agg.memberPolyIndices));
      svg.setAttribute("data-poly-shadow-layers", String(agg.layers.length));
    }

    // Rebuild children. Each layer is ONE path (all its polys, nonzero union)
    // so within-light overlaps don't double-multiply; cross-light overlaps are
    // separate paths that compose.
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (merged) {
      // base = full-lit color over the shadow union; each pass multiplies it.
      // No stroke: a stroked multiply layer would darken its own outer edge,
      // drawing a visible outline. Each layer is already a nonzero union so
      // there are no internal seams to feather.
      let baseD = "";
      for (const layer of agg.layers) baseD += polysToD(layer.polys, minU, minV);
      svg.appendChild(makePath(ctx.doc, baseD, agg.base, false, 1, false));
      for (const layer of agg.layers) {
        const factor = multiplyFactor(layer.fill, agg.base);
        svg.appendChild(makePath(ctx.doc, polysToD(layer.polys, minU, minV), factor, true, 1, false));
      }
    } else {
      // One path per pass at its own alpha (single light, or textured).
      for (const layer of agg.layers) {
        svg.appendChild(makePath(ctx.doc, polysToD(layer.polys, minU, minV), layer.fill, false, layer.opacity, false));
      }
    }
  }
  // Hide faces with no current content.
  for (const [idx, face] of mounted) {
    if (seen.has(idx)) continue;
    if (face.svg && face.visible) {
      face.svg.style.display = "none";
      face.visible = false;
    }
  }
}

/** Build an `M…L…Z` path string from face-(u,v) polygons, offset to the SVG's
 *  tight bbox origin. */
function polysToD(
  polys: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  minU: number,
  minV: number,
): string {
  let d = "";
  for (const poly of polys) {
    if (poly.length < 3) continue;
    d += `M${(poly[0]![0] - minU).toFixed(1)},${(poly[0]![1] - minV).toFixed(1)}`;
    for (let j = 1; j < poly.length; j++) {
      d += `L${(poly[j]![0] - minU).toFixed(1)},${(poly[j]![1] - minV).toFixed(1)}`;
    }
    d += "Z";
  }
  return d;
}

function makePath(
  doc: Document,
  d: string,
  fill: string,
  blendMultiply: boolean,
  opacity: number,
  stroke: boolean,
): SVGPathElement {
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", fill);
  // Overlapping same-light subpaths union (don't alpha/multiply-stack).
  path.setAttribute("fill-rule", "nonzero");
  if (stroke) {
    // A 1px stroke of the same color closes sub-pixel seams between adjacent
    // projected polygons (a single path's nonzero fill already merges them,
    // so this only feathers the outer antialiased edge).
    path.setAttribute("stroke", fill);
    path.setAttribute("stroke-width", "1");
    path.setAttribute("stroke-linejoin", "round");
  }
  if (opacity !== 1) path.setAttribute("opacity", opacity.toFixed(4));
  if (blendMultiply) path.style.mixBlendMode = "multiply";
  return path;
}

/** Per-channel multiply factor `remaining / full` (both sRGB hex) as `rgb(...)`.
 *  Painting the base = `full` and this factor with `mix-blend-mode: multiply`
 *  reproduces `remaining`; overlapping factors multiply to the both-removed
 *  color. */
function multiplyFactor(remaining: string, full: string): string {
  const a = parseHexColor(remaining)?.rgb ?? [0, 0, 0];
  const b = parseHexColor(full)?.rgb ?? [255, 255, 255];
  const f = (i: number): number => {
    const c = b[i] ?? 0;
    if (c <= 0) return 255;
    return Math.max(0, Math.min(255, Math.round((a[i]! / c) * 255)));
  };
  return `rgb(${f(0)},${f(1)},${f(2)})`;
}
