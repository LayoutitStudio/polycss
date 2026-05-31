/**
 * Scene-level per-receiver-surface shadow emission. For each coplanar face
 * group on a `receiveShadow: true` mesh, project EVERY caster polygon onto
 * that group's plane along the directional-light vector, Sutherland-Hodgman-
 * clip against the face outline, and emit one mounted SVG per group whose
 * `<path>` children carry the union of every clipped caster shadow.
 *
 * Aggregating all casters into one SVG per surface is the whole point of the
 * scene-level shadow refactor: overlapping shadows from different casters
 * share one alpha pass instead of stacking under multiply/screen.
 *
 * Extracted from createPolyScene.ts so it can be unit-evolved without
 * scrolling past 600 lines of unrelated factory wiring. Takes a SceneContext
 * as its first arg; reads scene options + caches + DOM handles from it.
 *
 * NOTE: assumes casters and receivers have identity rotation/scale beyond
 * what `worldCssForMesh` applies (positions + axis-aligned scale). Full
 * rotation support requires extending worldCss to apply the wrapper's full
 * transform; deferred.
 */
import {
  clipPolygonToConvex2D,
  ensureCcw2D,
  normalFacesCamera,
  shadePolygon,
} from "@layoutit/polycss-core";
import type { CameraCullRotation, Vec3 } from "@layoutit/polycss-core";
import { DEFAULT_TILE } from "./transforms";
import {
  groupReceiverFaceGroups,
  meshScaleVec3,
  worldCssForMesh,
} from "./shadowGeometry";
import { syncShadowPaths } from "./shadowSvg";
import { meshShadowId } from "./shadowCache";
import type { SceneContext } from "./sceneContext";
import type {
  CasterPolyItem,
  MeshEntry,
  ReceiverFacePlane,
} from "./internalTypes";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Per-receiver shadow emit. Iterates every coplanar face group on
 * `receiverEntry`, builds (or reuses) cached plane geometry, projects every
 * caster polygon onto each group plane, and writes the resulting SVG path
 * data into a mounted-once SVG element per group.
 *
 * The trailing `_r/_g/_b` parameters are reserved for future per-light color
 * use; today the fill color is resolved from `currentOptions.shadow.color`
 * (textured receivers) or via the receiver's own ambient-only `shadePolygon`
 * (solid receivers) for byte-exact Three.js parity.
 */
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

  const llen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const Lx = lightDir[0] / llen;
  const Ly = lightDir[1] / llen;
  const Lz = lightDir[2] / llen;
  const rpos = receiverEntry.handle.transform.position ?? [0, 0, 0];
  // Solid vs textured receivers need different shadow treatments:
  //  - Solid: paint the receiver's "ambient only" lit color at full opacity →
  //    byte-exact "no direct light" Three.js parity.
  //  - Textured: paint semi-transparent so texture stays visible underneath,
  //    just darkened. effectiveOpacity per group inside the loop.
  const hasTexture = receiverEntry.polygons.some((p) => p.texture !== undefined);
  const ambColor = options.ambientLight?.color ?? "#ffffff";
  const ambIntensity = options.ambientLight?.intensity ?? 0.4;
  const dirIntensity = options.directionalLight?.intensity ?? 1;
  const userShadowColor = options.shadow?.color ?? "#000000";
  // worldCssForMesh pivots scale from mesh origin (matches buildMeshTransform);
  // rotation is intentionally not applied here because shadow geometry is
  // computed once per mesh-transform change and already lives in world coords
  // after the per-vertex transform.
  const worldCss = worldCssForMesh(receiverEntry.handle.transform.scale);

  // Cache key for receiver face groups. Includes shadow.lift so a caller that
  // scales lift dynamically (e.g. with camera zoom) busts the cache.
  const receiverScale = meshScaleVec3(receiverEntry.handle.transform.scale);
  const rbboxCss = receiverEntry.bboxCenterCss;
  const cacheShadowLift = options.shadow?.lift ?? 0.001;
  const cacheKey = `${receiverEntry.polygons.length}|${receiverDedupDrop.size}|${rpos.join(",")}|${receiverScale.join(",")}|${rbboxCss ? rbboxCss.join(",") : "n"}|${cacheShadowLift}`;
  let cachedPlanes = receiverShadowCache.get(receiverEntry);
  if (cachedPlanes === undefined || receiverShadowCacheKey.get(receiverEntry) !== cacheKey) {
    const surfaces = groupReceiverFaceGroups(receiverEntry.polygons, rpos, worldCss, receiverDedupDrop);
    cachedPlanes = surfaces.map((group, faceIndex): ReceiverFacePlane => {
      const { O, n, u, v, outlineUv, memberPolysUv, memberPolyIndices } = group;
      let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
      for (const pt of outlineUv) {
        if (pt[0] < minU) minU = pt[0];
        if (pt[1] < minV) minV = pt[1];
        if (pt[0] > maxU) maxU = pt[0];
        if (pt[1] > maxV) maxV = pt[1];
      }
      const width = maxU - minU;
      const height = maxV - minV;
      // Push the receiver-shadow SVG plane slightly OFF the receiver
      // surface along the face normal so it composites above without
      // z-fighting. Respect the same `shadow.lift` (world units) the
      // ground-shadow path uses, converted to CSS px.
      const lift = (options.shadow?.lift ?? 0.001) * DEFAULT_TILE;
      const Ox = O[0] + minU * u[0] + minV * v[0] + lift * n[0];
      const Oy = O[1] + minU * u[1] + minV * v[1] + lift * n[1];
      const Oz = O[2] + minU * u[2] + minV * v[2] + lift * n[2];
      const m = [
        u[0], u[1], u[2], 0,
        v[0], v[1], v[2], 0,
        n[0], n[1], n[2], 0,
        Ox,   Oy,   Oz,   1,
      ];
      const matrixCss = `matrix3d(${m.map((x) => x.toFixed(4)).join(",")})`;
      return {
        O, n, u, v, outlineUv, memberPolysUv, memberPolyIndices,
        minU, minV, width, height, matrixCss,
        faceIndex,
        svg: null, visible: false,
      };
    });
    // Occlusion cull: drop receiver face planes that sit BEHIND another
    // parallel face plane along the outward normal (interior wall layers
    // inside imported building meshes). Without z-buffer occlusion the
    // interior wall's shadow SVG paints in 3D where the user can't see it
    // — appearing as floating shadows that don't exist in Three.js.
    const OCCL_NORMAL_TOL = 0.015;
    const OCCL_OFFSET_TOL = 0.5;
    // Max gap for "occlusion" — wall thickness is typically 1-10 CSS px.
    // Beyond that the planes are separated by air, not nested geometry.
    const OCCL_MAX_GAP = 20;       // CSS px (= 0.4 world units)
    const occluded = new Set<number>();
    for (let i = 0; i < cachedPlanes.length; i++) {
      if (occluded.has(i)) continue;
      const pi = cachedPlanes[i]!;
      const offsetI = pi.n[0] * pi.O[0] + pi.n[1] * pi.O[1] + pi.n[2] * pi.O[2];
      const iMinU = pi.minU, iMinV = pi.minV;
      const iMaxU = pi.minU + pi.width, iMaxV = pi.minV + pi.height;
      for (let j = 0; j < cachedPlanes.length; j++) {
        if (j === i || occluded.has(j)) continue;
        const pj = cachedPlanes[j]!;
        const dotN = pi.n[0] * pj.n[0] + pi.n[1] * pj.n[1] + pi.n[2] * pj.n[2];
        if (dotN < 1 - OCCL_NORMAL_TOL) continue;
        const offsetJ = pi.n[0] * pj.O[0] + pi.n[1] * pj.O[1] + pi.n[2] * pj.O[2];
        if (offsetJ <= offsetI + OCCL_OFFSET_TOL) continue;
        if (offsetJ - offsetI > OCCL_MAX_GAP) continue;
        let jMinU = Infinity, jMinV = Infinity, jMaxU = -Infinity, jMaxV = -Infinity;
        for (const pt of pj.outlineUv) {
          const wx = pj.O[0] + pt[0] * pj.u[0] + pt[1] * pj.v[0];
          const wy = pj.O[1] + pt[0] * pj.u[1] + pt[1] * pj.v[1];
          const wz = pj.O[2] + pt[0] * pj.u[2] + pt[1] * pj.v[2];
          const dx = wx - pi.O[0], dy = wy - pi.O[1], dz = wz - pi.O[2];
          const iu = dx * pi.u[0] + dy * pi.u[1] + dz * pi.u[2];
          const iv = dx * pi.v[0] + dy * pi.v[1] + dz * pi.v[2];
          if (iu < jMinU) jMinU = iu;
          if (iu > jMaxU) jMaxU = iu;
          if (iv < jMinV) jMinV = iv;
          if (iv > jMaxV) jMaxV = iv;
        }
        if (jMinU <= iMinU && jMaxU >= iMaxU && jMinV <= iMinV && jMaxV >= iMaxV) {
          // Don't cull when j is much LARGER than i — small surface
          // feature (door frame, recess) sitting inside a broader wall.
          const iArea = Math.max(0, iMaxU - iMinU) * Math.max(0, iMaxV - iMinV);
          const jArea = Math.max(0, jMaxU - jMinU) * Math.max(0, jMaxV - jMinV);
          const OCCL_AREA_RATIO = 2.0;
          if (jArea > iArea * OCCL_AREA_RATIO) continue;
          occluded.add(i);
          break;
        }
      }
    }
    cachedPlanes = cachedPlanes.filter((_, i) => !occluded.has(i));
    receiverShadowCache.set(receiverEntry, cachedPlanes);
    receiverShadowCacheKey.set(receiverEntry, cacheKey);
  }

  // Per-caster cached items: world-vertices + 3D AABB per polygon.
  // Geometry is invariant under light direction, so once cached every
  // receiver-face SH-clip across every drag tick reads from the cache.
  const casterItems: Array<{ caster: MeshEntry; item: CasterPolyItem }> = [];
  for (const caster of casters) {
    const cpos = caster.handle.transform.position ?? [0, 0, 0];
    const casterScale = meshScaleVec3(caster.handle.transform.scale);
    // Cache key includes scale + bbox so a transform change busts the
    // cached world-vertex list.
    const cbboxCss = caster.bboxCenterCss;
    const ckey = `${caster.polygons.length}|${cpos.join(",")}|${casterScale.join(",")}|${cbboxCss ? cbboxCss.join(",") : "n"}`;
    let cached = casterItemsCache.get(caster);
    if (cached === undefined || casterItemsCacheKey.get(caster) !== ckey) {
      const dedupDrop = dedupByCaster.get(caster)!;
      cached = [];
      const casterWorldCss = worldCssForMesh(caster.handle.transform.scale);
      for (const item of caster.rendered) {
        if (dedupDrop.has(item.polygonIndex)) continue;
        const plan = item.plan;
        if (!plan) continue;
        const polygon = caster.polygons[item.polygonIndex];
        if (!polygon) continue;
        const wv = polygon.vertices.map((vert) => casterWorldCss(vert, cpos));
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const w of wv) {
          if (w[0] < minX) minX = w[0]; if (w[0] > maxX) maxX = w[0];
          if (w[1] < minY) minY = w[1]; if (w[1] > maxY) maxY = w[1];
          if (w[2] < minZ) minZ = w[2]; if (w[2] > maxZ) maxZ = w[2];
        }
        const bboxCorners: Vec3[] = [
          [minX, minY, minZ], [maxX, minY, minZ],
          [minX, maxY, minZ], [maxX, maxY, minZ],
          [minX, minY, maxZ], [maxX, minY, maxZ],
          [minX, maxY, maxZ], [maxX, maxY, maxZ],
        ];
        // Caster plane in CSS world coords, e2 × e1 convention to match
        // polygonCssSurfaceNormal + receiver face normal.
        let planeN: Vec3 | null = null;
        let planeOffset = 0;
        if (wv.length >= 3) {
          const O = wv[0]!, w1 = wv[1]!, w2 = wv[2]!;
          const e1: Vec3 = [w1[0] - O[0], w1[1] - O[1], w1[2] - O[2]];
          const e2: Vec3 = [w2[0] - O[0], w2[1] - O[1], w2[2] - O[2]];
          const nx = e2[1] * e1[2] - e2[2] * e1[1];
          const ny = e2[2] * e1[0] - e2[0] * e1[2];
          const nz = e2[0] * e1[1] - e2[1] * e1[0];
          const nLen = Math.hypot(nx, ny, nz);
          if (nLen > 1e-9) {
            planeN = [nx / nLen, ny / nLen, nz / nLen];
            planeOffset = planeN[0] * O[0] + planeN[1] * O[1] + planeN[2] * O[2];
          }
        }
        cached.push({ wv, bboxCorners, planeN, planeOffset, polygonIndex: item.polygonIndex });
      }
      casterItemsCache.set(caster, cached);
      casterItemsCacheKey.set(caster, ckey);
    }
    for (const it of cached) casterItems.push({ caster, item: it });
  }

  // Camera back-face cull for receiver face planes. SVGs don't honor CSS
  // `backface-visibility` reliably, so a receiver-face SVG on a wall facing
  // away from the camera would still paint — producing "floating" shadow
  // silhouettes that match no visible surface. `n` is in the same axis
  // convention as polygonCssSurfaceNormal, so normalFacesCamera works
  // directly with the receiver's mesh rotation.
  const receiverCameraRot: CameraCullRotation = {
    rotX: ctx.camera.state.rotX,
    rotY: ctx.camera.state.rotY,
    meshRotation: receiverEntry.handle.transform.rotation,
  };
  // Per-light raytrace receiver-skip stays disabled. Using lightOcclusion-
  // Cache to skip whole polys here loses the cast-shadow SHAPES that other
  // casters project onto them — the centroid-only raytrace is a coarse
  // binary (fully occluded vs not), but pixels across the polygon's face
  // may legitimately receive direct light AND a separate cast-shadow
  // silhouette from a neighbouring tower. Skipping the SVG for those
  // polys produces "missing shadow" regressions. The slight double-
  // darkening from baked-ambient + receiver-shadow is the lesser evil.
  const receiverOccluded = undefined as unknown as ReadonlySet<number> | undefined;

  for (const group of cachedPlanes) {
    const { O, n, u, v, outlineUv, minU, minV, width, height, matrixCss } = group;
    // Back-facing receiver face → can't receive light → skip.
    const Ldotn = Lx * n[0] + Ly * n[1] + Lz * n[2];
    if (Ldotn <= 1e-6) continue;
    // Fully-occluded face short-circuit (placeholder; raytrace disabled).
    if (receiverOccluded && receiverOccluded.size > 0 && group.memberPolyIndices.length > 0) {
      let allOccluded = true;
      for (const pi of group.memberPolyIndices) {
        if (!receiverOccluded.has(pi)) { allOccluded = false; break; }
      }
      if (allOccluded) {
        if (group.svg && group.visible) {
          group.svg.style.display = "none";
          group.visible = false;
        }
        continue;
      }
    }
    // Camera back-face cull.
    if (!normalFacesCamera(n, receiverCameraRot)) {
      if (group.svg && group.visible) {
        group.svg.style.display = "none";
        group.visible = false;
      }
      continue;
    }

    // Per-triangle 3D-clip then project. For each caster polygon (fan-
    // triangulated), 3D-clip the tri against the receiver plane half-space
    // (keeping only the above-plane part), project the surviving 3D polygon
    // onto the face's 2D plane along the light, then SH-clip against the
    // face outline. Matches a true raytracer's per-tri occlusion test.
    const planeDist = (w: Vec3): number =>
      (w[0] - O[0]) * n[0] + (w[1] - O[1]) * n[1] + (w[2] - O[2]) * n[2];
    const planeCross = (a: Vec3, b: Vec3, da: number, db: number): Vec3 => {
      const s = da / (da - db);
      return [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1]), a[2] + s * (b[2] - a[2])];
    };
    const projectOntoPlane = (w: Vec3): [number, number] => {
      const VmOx = w[0] - O[0];
      const VmOy = w[1] - O[1];
      const VmOz = w[2] - O[2];
      const t = (VmOx * n[0] + VmOy * n[1] + VmOz * n[2]) / Ldotn;
      const Px = w[0] - t * Lx;
      const Py = w[1] - t * Ly;
      const Pz = w[2] - t * Lz;
      const dx = Px - O[0];
      const dy = Py - O[1];
      const dz = Pz - O[2];
      return [dx * u[0] + dy * u[1] + dz * u[2], dx * v[0] + dy * v[1] + dz * v[2]];
    };
    // Per-caster clipped polygons. Each entry becomes ONE <path> in the
    // face SVG so subpaths from the same caster mesh stay in one path and
    // overlap correctly under fill-rule="nonzero".
    type PerCasterClip = {
      caster: MeshEntry;
      verts: Array<Array<[number, number]>>;
      subPolygonIndices: number[];
    };
    const clippedByCaster = new Map<MeshEntry, PerCasterClip>();
    let totalClipped = 0;
    const fMinU = minU, fMinV = minV;
    const fMaxU = group.minU + width;
    const fMaxV = group.minV + height;
    // Half-space test epsilon in CSS pixels. Shared edges (cube neighbours,
    // wall junctions) land at planeDist == 0 and stay excluded. Must clear
    // floating-point noise on coplanar mesh geometry; 0.05 sits at the
    // float-noise floor and keeps the half-space test stable.
    const SELF_SHADOW_EPS = 0.05;
    // Skip casters essentially on the SAME SURFACE as the receiver,
    // including parallel walls within wall thickness — see receiverPlaneOffset
    // comment in the original code.
    const receiverPlaneOffset = n[0] * O[0] + n[1] * O[1] + n[2] * O[2];
    const COPLANAR_NORMAL_TOL = 0.0025;
    const COPLANAR_OFFSET_TOL = 5.0;
    for (const entry of casterItems) {
      const item = entry.item;
      const caster = entry.caster;
      // Coplanar caster skip.
      if (item.planeN) {
        const cn = item.planeN;
        const dot = cn[0] * n[0] + cn[1] * n[1] + cn[2] * n[2];
        if (Math.abs(dot) > 1 - COPLANAR_NORMAL_TOL) {
          const sign = dot > 0 ? 1 : -1;
          if (Math.abs(item.planeOffset - sign * receiverPlaneOffset) < COPLANAR_OFFSET_TOL) {
            continue;
          }
        }
      }
      // 8-projection bbox prefilter, also confirms ≥ 1 corner ABOVE plane.
      const corners = item.bboxCorners;
      let anyAbove = false;
      let pMinU = Infinity, pMinV = Infinity, pMaxU = -Infinity, pMaxV = -Infinity;
      for (let ci = 0; ci < 8; ci++) {
        const c = corners[ci]!;
        if (planeDist(c) > SELF_SHADOW_EPS) anyAbove = true;
        const pr = projectOntoPlane(c);
        if (pr[0] < pMinU) pMinU = pr[0];
        if (pr[0] > pMaxU) pMaxU = pr[0];
        if (pr[1] < pMinV) pMinV = pr[1];
        if (pr[1] > pMaxV) pMaxV = pr[1];
      }
      if (!anyAbove) continue;
      if (pMaxU < fMinU || pMinU > fMaxU || pMaxV < fMinV || pMinV > fMaxV) continue;
      const wv = item.wv;
      // Fan-triangulate.
      for (let triIdx = 1; triIdx < wv.length - 1; triIdx++) {
        const tA = wv[0]!, tB = wv[triIdx]!, tC = wv[triIdx + 1]!;
        const dA = planeDist(tA), dB = planeDist(tB), dC = planeDist(tC);
        const above: Vec3[] = [];
        const cycle: Array<[Vec3, number]> = [[tA, dA], [tB, dB], [tC, dC]];
        for (let k = 0; k < 3; k++) {
          const [p, dp] = cycle[k]!;
          const [q, dq] = cycle[(k + 1) % 3]!;
          const pAbove = dp > SELF_SHADOW_EPS;
          const qAbove = dq > SELF_SHADOW_EPS;
          if (pAbove) above.push(p);
          if (pAbove !== qAbove) above.push(planeCross(p, q, dp, dq));
        }
        if (above.length < 3) continue;
        const projected = above.map(projectOntoPlane);
        const subjectCcw = ensureCcw2D(projected);
        const clip = clipPolygonToConvex2D(subjectCcw, outlineUv);
        if (clip.length < 3) continue;
        // Drop sub-shadows whose centroid lands inside the convex hull but
        // OUTSIDE the actual polygon union (concave bridging regions of
        // L-shaped face groups). PIP test against member polys.
        let ccx = 0, ccy = 0;
        for (const pt of clip) { ccx += pt[0]; ccy += pt[1]; }
        ccx /= clip.length; ccy /= clip.length;
        let insideUnion = false;
        for (const memberPoly of group.memberPolysUv) {
          let inside = false;
          for (let mi = 0, mj = memberPoly.length - 1; mi < memberPoly.length; mj = mi++) {
            const xi = memberPoly[mi]![0], yi = memberPoly[mi]![1];
            const xj = memberPoly[mj]![0], yj = memberPoly[mj]![1];
            const intersects = ((yi > ccy) !== (yj > ccy)) &&
              (ccx < ((xj - xi) * (ccy - yi)) / (yj - yi || 1e-12) + xi);
            if (intersects) inside = !inside;
          }
          if (inside) { insideUnion = true; break; }
        }
        if (!insideUnion) continue;
        let bucket = clippedByCaster.get(caster);
        if (!bucket) {
          bucket = { caster, verts: [], subPolygonIndices: [] };
          clippedByCaster.set(caster, bucket);
        }
        bucket.verts.push(clip);
        bucket.subPolygonIndices.push(item.polygonIndex);
        totalClipped++;
      }
    }

    if (totalClipped === 0 || !(width > 0) || !(height > 0)) continue;

    // Mount-once SVG.
    let svg = group.svg;
    if (!svg) {
      svg = ctx.doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "polycss-shadow polycss-shadow-svg polycss-shadow-receiver");
      svg.setAttribute("data-poly-shadow-type", "receiver");
      svg.setAttribute("data-poly-shadow-receiver", meshShadowId(receiverEntry));
      svg.setAttribute("data-poly-shadow-receiver-face", String(group.faceIndex));
      // Member polygon indices for this receiver face group. Exposed for
      // the shadow-oracle bench to answer "is polygon N actually being
      // considered as a shadow receiver, or did the engine drop it?" —
      // critical to distinguish missing-shadow bugs (no SVG attempted)
      // from path-doesn't-cover-pixel bugs (SVG attempted but projection
      // misses the area).
      svg.setAttribute("data-poly-shadow-receiver-polys", JSON.stringify(group.memberPolyIndices));
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute(
        "style",
        `position:absolute;top:0;left:0;display:block;overflow:hidden;` +
        `transform-origin:0 0;pointer-events:none;will-change:transform;` +
        `transform:${matrixCss}`,
      );
      ctx.sceneEl.insertBefore(svg, ctx.sceneEl.firstChild);
      group.svg = svg;
    } else if (!group.visible) {
      svg.style.display = "block";
    }
    group.visible = true;

    // Per-group opacity for textured receivers. Three.js darkens linearly:
    // shadow_linear = lit_linear × ambient/(direct + ambient). CSS opacity
    // blends in sRGB, so we apply a gamma-2.4 approximation to match.
    let effOp = opacity;
    if (hasTexture) {
      const direct = dirIntensity * Math.max(0, Ldotn);
      const total = direct + Math.max(0, ambIntensity);
      if (total > 0) {
        const ratioLinear = Math.max(0, ambIntensity) / total;
        const ratioSrgb = Math.pow(ratioLinear, 1 / 2.4);
        effOp = opacity * (1 - ratioSrgb);
      } else {
        effOp = 0;
      }
    }
    const opStr = effOp.toFixed(4);

    // Per-face shadow tint: each receiver face uses ITS OWN polygon color
    // for the ambient-only fill. Previously the whole mesh fell back to
    // polygons[0].color, which painted brown shadows on the castle's grey
    // walls because polygon 0 was the wooden door material. `group.memberPolyIndices`
    // groups coplanar polygons that share the same surface; in practice
    // they also share a material, so picking the first one is correct
    // (and degrades to a single-material lookup for the common case).
    const groupPolyIdx = group.memberPolyIndices[0] ?? 0;
    const groupColor = receiverEntry.polygons[groupPolyIdx]?.color ?? "#cccccc";
    const fillColor = hasTexture
      ? userShadowColor
      : shadePolygon(groupColor, 0, "#000000", ambColor, ambIntensity);

    // One <path> per contributing caster mesh, fill-rule=nonzero handles
    // intra-mesh overlap. `data-poly-shadow-caster-polys` is a JSON array
    // of source polygon indices so DevTools can map subpath N back to
    // polygon `subPolygonIndices[N]`.
    // withStroke:true + same-color stroke composites seamlessly with the
    // fill (no visible boundary, just a 1-px outward bleed). Closes the
    // hairline gaps between adjacent receiver-face shadow paths that the
    // Sutherland-Hodgman clip leaves due to float-precision at shared
    // edges. The "visible outlines on degenerate slivers" the original
    // syncShadowPaths comment warned about only happened with a
    // contrasting stroke color — when stroke matches fill, slivers
    // become invisible 1-px-wider versions of themselves.
    const contributingCasters = [...clippedByCaster.values()];
    const paths = syncShadowPaths(svg, ctx.doc, contributingCasters.length, /*withStroke*/ true);
    const casterIds = contributingCasters.map((c) => meshShadowId(c.caster));
    for (let i = 0; i < contributingCasters.length; i++) {
      const entry = contributingCasters[i]!;
      let d = "";
      for (const v of entry.verts) {
        d += `M${(v[0]![0] - minU).toFixed(1)},${(v[0]![1] - minV).toFixed(1)}`;
        for (let j = 1; j < v.length; j++) {
          d += `L${(v[j]![0] - minU).toFixed(1)},${(v[j]![1] - minV).toFixed(1)}`;
        }
        d += "Z";
      }
      const path = paths[i]!;
      path.setAttribute("d", d);
      if (path.getAttribute("fill") !== fillColor) path.setAttribute("fill", fillColor);
      // Match stroke to fill so the seam-closing bleed is invisible.
      if (path.getAttribute("stroke") !== fillColor) path.setAttribute("stroke", fillColor);
      if (path.getAttribute("opacity") !== opStr) path.setAttribute("opacity", opStr);
      const casterId = casterIds[i]!;
      if (path.getAttribute("data-poly-shadow-caster") !== casterId) {
        path.setAttribute("data-poly-shadow-caster", casterId);
      }
      const polysAttr = JSON.stringify(entry.subPolygonIndices);
      if (path.getAttribute("data-poly-shadow-caster-polys") !== polysAttr) {
        path.setAttribute("data-poly-shadow-caster-polys", polysAttr);
      }
    }
    const castersAttr = casterIds.join(" ");
    if (svg.getAttribute("data-poly-shadow-casters") !== castersAttr) {
      svg.setAttribute("data-poly-shadow-casters", castersAttr);
    }
  }
}
