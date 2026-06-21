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
  computeCoverageShadowSilhouette,
  computeMergedReceiverShadows,
  computeParametricShadowSilhouette,
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
import { ensureShadowRoot } from "./shadowSvg";
import { meshShadowId } from "./shadowCache";
import type { SceneContext } from "./sceneContext";
import type { MeshEntry } from "./internalTypes";

const SVG_NS = "http://www.w3.org/2000/svg";

/** True when every caster vertex lies in a single plane (a ground quad, a
 *  billboard, etc.). Such casters have no coverage volume for the parametric
 *  proxy and are routed through the exact path instead. */
function isFlatCaster(polysWv: ReadonlyArray<ReadonlyArray<Vec3>>): boolean {
  let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0, ox = 0, oy = 0, oz = 0;
  let haveBasis = false;
  for (const poly of polysWv) {
    if (poly.length >= 3 && !haveBasis) {
      const p0 = poly[0]!, p1 = poly[1]!, p2 = poly[2]!;
      ax = p1[0] - p0[0]; ay = p1[1] - p0[1]; az = p1[2] - p0[2];
      bx = p2[0] - p0[0]; by = p2[1] - p0[1]; bz = p2[2] - p0[2];
      ox = p0[0]; oy = p0[1]; oz = p0[2];
      haveBasis = true;
    }
  }
  if (!haveBasis) return true;
  // plane normal = a × b
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-9) return true;
  nx /= nl; ny /= nl; nz /= nl;
  // span sets the coplanarity tolerance so it scales with the caster size.
  let span = 0;
  for (const poly of polysWv) for (const p of poly) {
    span = Math.max(span, Math.abs(p[0] - ox) + Math.abs(p[1] - oy) + Math.abs(p[2] - oz));
  }
  const tol = Math.max(1e-3, span * 1e-3);
  for (const poly of polysWv) for (const p of poly) {
    const d = (p[0] - ox) * nx + (p[1] - oy) * ny + (p[2] - oz) * nz;
    if (Math.abs(d) > tol) return false;
  }
  return true;
}

/** Rubric: a CONVEX caster self-shadows nothing (no point on a convex surface
 *  is occluded from the light by another part of the same surface). The
 *  depth-band proxy still leaks a little false self-shadow on convex meshes
 *  (its flat slices poke above the real faces), so detect convexity and skip
 *  self-shadow entirely for these casters. Capped at `maxPolys` because the
 *  test is O(faces × verts) and large meshes are essentially never convex —
 *  they early-exit on the first concave face anyway. */
function isConvexCaster(polysWv: ReadonlyArray<ReadonlyArray<Vec3>>, maxPolys = 300): boolean {
  if (polysWv.length === 0 || polysWv.length > maxPolys) return false;
  let span = 0, ox = 0, oy = 0, oz = 0, seeded = false;
  for (const poly of polysWv) for (const p of poly) {
    if (!seeded) { ox = p[0]; oy = p[1]; oz = p[2]; seeded = true; }
    span = Math.max(span, Math.abs(p[0] - ox) + Math.abs(p[1] - oy) + Math.abs(p[2] - oz));
  }
  const tol = Math.max(1e-3, span * 5e-3);
  for (const face of polysWv) {
    if (face.length < 3) continue;
    const a = face[0]!, b = face[1]!, c = face[2]!;
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-9) continue;
    nx /= nl; ny /= nl; nz /= nl;
    // All other vertices must lie on one side of this face plane.
    let pos = false, neg = false;
    for (const poly of polysWv) for (const p of poly) {
      const d = (p[0] - a[0]) * nx + (p[1] - a[1]) * ny + (p[2] - a[2]) * nz;
      if (d > tol) pos = true; else if (d < -tol) neg = true;
      if (pos && neg) return false;
    }
  }
  return true;
}

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
    // Parametric shadow: replace the caster's geometry with low-res coverage
    // contour loops (directional). The cast shadow on a plane is the 2D coverage
    // of every projected face, so we rasterize that from the light POV and trace
    // its concave contour (towers, gaps) at a resolution driven by `definition`.
    // The override loops project onto every receiver face through the normal
    // pipeline. Cross-mesh casting uses ONE flat layer (cheapest, exact for a
    // distant receiver). SELF-shadow uses depth-stratified layers: a flat
    // outline carries no depth and would over-darken a mesh's own interior, so
    // we slice the caster along the light and let each face's half-space clip
    // keep only the bands in front of it.
    let overrideSilhouette: Vec3[][] | undefined;
    let overridePointSilhouettes: Array<Vec3[][] | undefined> | undefined;
    if (options.shadow?.parametric) {
      // Per-mesh override beats the scene default; during a progressive
      // light-drag emit, cap it at `dragDefinition` for a cheap frame.
      const baseDef = caster.shadowDefinition ?? options.shadow.definition ?? 16;
      const def = ctx.shadowDragActive
        ? Math.min(baseDef, options.shadow.dragDefinition ?? baseDef)
        : baseDef;
      const polysWv = cached.map((item) => item.wv);
      const isSelf = caster === receiverEntry;
      // A FLAT caster (all polygons in one plane, e.g. a ground quad) has no
      // meaningful coverage volume: its proxy outline is built in the
      // light-perpendicular plane, so it becomes a tilted quad that straddles
      // a coplanar receiver and projects a huge spurious shadow. Exact casting
      // coplanar-culls such polygons; route flat casters through the exact path
      // (cheap — they have few polys) so parity is preserved.
      const flat = isFlatCaster(polysWv);
      // Convex casters self-shadow nothing — skip the parametric self pass
      // (the exact path also yields ~0 here, so cross-renderer parity holds).
      const convexSelfSkip = isSelf && isConvexCaster(polysWv);
      const layers = isSelf ? Math.max(2, Math.min(6, Math.round(def / 8))) : 1;
      const buildOverride = (dir: Vec3): Vec3[][] | undefined => {
        if (flat || convexSelfSkip) return undefined;
        const loops = computeCoverageShadowSilhouette(polysWv, dir, def, layers);
        if (loops && loops.length) return loops;
        if (!isSelf) {
          const allWv: Vec3[] = [];
          for (const item of cached) for (const w of item.wv) allWv.push(w);
          const loop = computeParametricShadowSilhouette(allWv, dir, def);
          if (loop && loop.length >= 3) return [loop];
        }
        return undefined;
      };
      overrideSilhouette = buildOverride(lightDir);
      // Point lights: a finite-distance light sees a RADIAL silhouette, not the
      // directional one. Build a per-light override from the caster-centroid →
      // light direction (the small-object approximation point shading already
      // uses); the projector then diverges it per-vertex from the light.
      if (passes.points.length > 0) {
        let cx = 0, cy = 0, cz = 0, n = 0;
        for (const item of cached) for (const w of item.wv) { cx += w[0]; cy += w[1]; cz += w[2]; n++; }
        if (n > 0) { cx /= n; cy /= n; cz /= n; }
        overridePointSilhouettes = [];
        for (const pt of passes.points) {
          const dir: Vec3 = [pt.lightPos[0] - cx, pt.lightPos[1] - cy, pt.lightPos[2] - cz];
          overridePointSilhouettes[pt.index] = buildOverride(dir);
        }
      }
    }
    casterInputs.push({
      id: caster,
      items: cached,
      selfShadowEdgeMap,
      edgeOwners,
      casterPolygonCount: caster.polygons.length,
      overrideSilhouette,
      overridePointSilhouettes,
    });
  }

  const cameraRot: CameraCullRotation = {
    rotX: ctx.camera.state.rotX,
    rotY: ctx.camera.state.rotY,
    meshRotation: receiverEntry.handle.transform.rotation,
  };

  // Shared core merge: run every light pass for this receiver and aggregate
  // each face's passes into one SVG descriptor (single light → one path;
  // multi-light solid → base + per-light multiply layers for correct overlap).
  const faces = computeMergedReceiverShadows<MeshEntry>({
    receiverPlanes: cachedPlanes,
    receiverPolygons: receiverEntry.polygons,
    receiverHasTexture: hasTexture,
    casters: casterInputs,
    lightDir,
    runDirectional: passes.runDirectional,
    pointPasses: passes.points,
    allPointLights: passes.allPointLights,
    cameraRot,
    ambientLight: options.ambientLight,
    directionalLight: options.directionalLight,
    shadow: { color: options.shadow?.color, opacity, maxExtend: options.shadow?.maxExtend },
  });

  const mounted = mountedFacesFor(receiverEntry, "m");
  const seen = new Set<number>();
  const wantDebug = !!options.debugShadowAttrs;
  const shadowRoot = ensureShadowRoot(ctx.shadowSvgState, ctx.doc, ctx.sceneEl);

  for (const fc of faces) {
    seen.add(fc.faceIndex);
    let face = mounted.get(fc.faceIndex);
    if (!face) {
      face = { svg: null, visible: false, width: -1, height: -1, matrixCss: "" };
      mounted.set(fc.faceIndex, face);
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
    if (face.width !== fc.width || face.height !== fc.height) {
      svg.setAttribute("width", String(fc.width));
      svg.setAttribute("height", String(fc.height));
      svg.setAttribute("viewBox", `0 0 ${fc.width} ${fc.height}`);
      face.width = fc.width;
      face.height = fc.height;
    }
    const style =
      `position:absolute;top:0;left:0;display:block;overflow:hidden;` +
      `transform-origin:0 0;pointer-events:none;will-change:transform;` +
      `opacity:${fc.svgOpacity.toFixed(4)};transform:${fc.matrixCss}`;
    if (face.matrixCss !== style) { svg.setAttribute("style", style); face.matrixCss = style; }
    if (wantDebug) {
      svg.setAttribute("data-poly-shadow-type", "receiver");
      svg.setAttribute("data-poly-shadow-receiver", meshShadowId(receiverEntry));
      svg.setAttribute("data-poly-shadow-receiver-face", String(fc.faceIndex));
      svg.setAttribute("data-poly-shadow-receiver-polys", JSON.stringify(fc.memberPolyIndices));
      svg.setAttribute("data-poly-shadow-layers", String(fc.layers.length));
    }

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (fc.baseFill && fc.baseD) svg.appendChild(makeShadowPath(ctx.doc, fc.baseD, fc.baseFill, false, 1));
    for (const layer of fc.layers) {
      svg.appendChild(makeShadowPath(ctx.doc, layer.d, layer.fill, layer.multiply, layer.opacity));
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

function makeShadowPath(
  doc: Document,
  d: string,
  fill: string,
  blendMultiply: boolean,
  opacity: number,
): SVGPathElement {
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", fill);
  // Overlapping same-light subpaths union (don't alpha/multiply-stack).
  path.setAttribute("fill-rule", "nonzero");
  if (opacity !== 1) path.setAttribute("opacity", opacity.toFixed(4));
  if (blendMultiply) path.style.mixBlendMode = "multiply";
  return path;
}
