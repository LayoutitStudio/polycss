/**
 * Scene-level ground shadow emit. Projects every caster polygon onto the
 * ground plane (z = `groundCssZ`) along the light direction and emits one
 * SVG `<path>` per casting mesh — overlapping projections within a mesh
 * compose via `fill-rule: nonzero` as a single silhouette.
 *
 * Extracted from createPolyScene.ts. Takes a SceneContext as its first arg
 * so it can read scene options and operate on the shared ground SVG /
 * caches.
 */
import {
  clipPolygonToConvex2D,
  convexHull2D,
  ensureCcw2D,
  projectCssVertexToGround,
} from "@layoutit/polycss-core";
import type { Vec3 } from "@layoutit/polycss-core";
import { DEFAULT_TILE, worldPositionToCss } from "./transforms";
import { ensureGroundShadow, syncShadowPaths } from "./shadowSvg";
import { meshShadowId } from "./shadowCache";
import type { SceneContext } from "./sceneContext";
import type { MeshEntry } from "./internalTypes";

/**
 * Emit (or update) the scene's single ground-shadow SVG, projecting every
 * caster's polygons onto the ground plane and merging projections per mesh
 * into one fill. Returns false when no projection survives (caller will
 * tear down the SVG).
 *
 * Caller passes the directional light + ground plane + composite color/
 * opacity already resolved from scene options; this function does no
 * lighting math of its own beyond the geometric projection.
 */
export function emitGroundShadow(
  ctx: SceneContext,
  casters: MeshEntry[],
  dedupByCaster: Map<MeshEntry, Set<number>>,
  lightDir: Vec3,
  groundCssZ: number,
  r: number, g: number, b: number,
  opacity: number,
): boolean {
  type PerCasterProj = {
    caster: MeshEntry;
    verts: Array<Array<[number, number]>>;
    subPolygonIndices: number[];
  };
  const projectionsByCaster = new Map<MeshEntry, PerCasterProj>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let fpMinX = Infinity, fpMinY = Infinity, fpMaxX = -Infinity, fpMaxY = -Infinity;
  let totalCount = 0;
  for (const caster of casters) {
    const cpos = caster.handle.transform.position ?? [0, 0, 0];
    const dedupDrop = dedupByCaster.get(caster)!;
    for (const item of caster.rendered) {
      if (dedupDrop.has(item.polygonIndex)) continue;
      const plan = item.plan;
      if (!plan) continue;
      const polygon = caster.polygons[item.polygonIndex];
      if (!polygon) continue;

      const projected: Array<[number, number]> = [];
      const cssPos = worldPositionToCss(cpos);
      for (const v of polygon.vertices) {
        // World vertex (mesh-local) → CSS frame via same axis swap +
        // tile scale the atlas builder applies per leaf, then add the
        // wrapper's translate3d offset.
        const cssVertex: Vec3 = [
          v[1] * DEFAULT_TILE + cssPos[0],
          v[0] * DEFAULT_TILE + cssPos[1],
          v[2] * DEFAULT_TILE + cssPos[2],
        ];
        if (cssVertex[0] < fpMinX) fpMinX = cssVertex[0];
        if (cssVertex[1] < fpMinY) fpMinY = cssVertex[1];
        if (cssVertex[0] > fpMaxX) fpMaxX = cssVertex[0];
        if (cssVertex[1] > fpMaxY) fpMaxY = cssVertex[1];
        const p = projectCssVertexToGround(cssVertex, lightDir, groundCssZ);
        projected.push(p);
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
      }
      // Per-polygon convex hull for projected N-gons: imported glTF
      // N-gons aren't always perfectly planar, and projecting a non-
      // planar N-gon yields a SELF-INTERSECTING 2D polygon whose
      // signed-area winding check can disagree with the visual winding
      // — one rogue subpath under fill-rule=nonzero then SUBTRACTS from
      // neighbouring CCW shadows (visible as wedge holes). Triangles
      // are simple by construction; only N-gons get hulled.
      const simplified = projected.length > 3 ? convexHull2D(projected) : projected;
      if (simplified.length >= 3) {
        let bucket = projectionsByCaster.get(caster);
        if (!bucket) {
          bucket = { caster, verts: [], subPolygonIndices: [] };
          projectionsByCaster.set(caster, bucket);
        }
        bucket.verts.push(simplified);
        bucket.subPolygonIndices.push(item.polygonIndex);
        totalCount++;
      }
    }
  }

  if (totalCount === 0) return false;
  const maxExtend = ctx.options.current.shadow?.maxExtend ?? 2000;
  const bx0 = Math.max(minX, fpMinX - maxExtend);
  const by0 = Math.max(minY, fpMinY - maxExtend);
  const bx1 = Math.min(maxX, fpMaxX + maxExtend);
  const by1 = Math.min(maxY, fpMaxY + maxExtend);
  const width = bx1 - bx0;
  const height = by1 - by0;
  if (!(width > 0) || !(height > 0)) return false;

  // Receiver-footprint subtraction is intentionally absent — see git
  // history (commit history note in original location). Tracked as a
  // volumetric-occlusion follow-up rather than a 2D cut.

  const { svg } = ensureGroundShadow(ctx.shadowSvgState, ctx.doc, ctx.sceneEl);
  const widthStr = String(width);
  const heightStr = String(height);
  const viewBox = `0 0 ${width} ${height}`;
  if (svg.getAttribute("width") !== widthStr) svg.setAttribute("width", widthStr);
  if (svg.getAttribute("height") !== heightStr) svg.setAttribute("height", heightStr);
  if (svg.getAttribute("viewBox") !== viewBox) svg.setAttribute("viewBox", viewBox);
  const transform = `translate3d(${bx0.toFixed(3)}px,${by0.toFixed(3)}px,${groundCssZ.toFixed(3)}px)`;
  if (svg.style.transform !== transform) svg.style.transform = transform;

  const fillColor = `rgb(${r},${g},${b})`;
  const opStr = opacity.toFixed(4);
  const contributingCasters = [...projectionsByCaster.values()];
  const paths = syncShadowPaths(svg, ctx.doc, contributingCasters.length, /*withStroke*/ true);
  const casterIds = contributingCasters.map((c) => meshShadowId(c.caster));
  // Clip every projected polygon to the SVG box so low-angle lights with
  // a finite shadow.maxExtend don't emit path coordinates outside the
  // viewport. Per-polygon SH against the rectangular bounds preserves
  // per-caster attribution + subpath order.
  const clipBounds: Array<[number, number]> = [
    [bx0, by0],
    [bx1, by0],
    [bx1, by1],
    [bx0, by1],
  ];
  for (let i = 0; i < contributingCasters.length; i++) {
    const entry = contributingCasters[i]!;
    let d = "";
    for (const v of entry.verts) {
      const clipped = clipPolygonToConvex2D(ensureCcw2D(v), clipBounds);
      if (clipped.length < 3) continue;
      const ccw = ensureCcw2D(clipped);
      d += `M${(ccw[0]![0] - bx0).toFixed(3)},${(ccw[0]![1] - by0).toFixed(3)}`;
      for (let j = 1; j < ccw.length; j++) {
        d += `L${(ccw[j]![0] - bx0).toFixed(3)},${(ccw[j]![1] - by0).toFixed(3)}`;
      }
      d += "Z";
    }
    const path = paths[i]!;
    path.setAttribute("d", d);
    if (path.getAttribute("fill") !== fillColor) path.setAttribute("fill", fillColor);
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
  return true;
}
