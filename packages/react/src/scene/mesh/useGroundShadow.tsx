/**
 * useGroundShadow — the per-mesh ground-plane shadow fallback SVG (only
 * when no receiveShadow mesh exists in the scene). Extracted verbatim from
 * PolyMesh.tsx.
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
import {
  BASE_TILE,
  ensureCcw2D,
  parseHexColor,
  projectCssVertexToGround,
  worldDirectionToCss,
} from "@layoutit/polycss-core";
import type { PolySceneContextValue } from "../sceneContext";
import type { TextureAtlasPlan } from "../atlas";
import { cachedOverlappingPolygonDuplicates } from "./useReceiverShadows";

export interface UseGroundShadowOptions {
  castShadow?: boolean;
  renderPolygon: ((polygon: Polygon, index: number) => ReactNode) | null;
  polygons: Polygon[];
  atlasPlans: Array<TextureAtlasPlan | null>;
  position?: Vec3;
  sceneCtx: PolySceneContextValue | null;
}

export function useGroundShadow({
  castShadow,
  renderPolygon,
  polygons,
  atlasPlans,
  position,
  sceneCtx,
}: UseGroundShadowOptions): ReactNode {
  // Per-mesh shadow `<svg>` — same path for both lighting modes. Every
  // casting polygon is projected to the ground on the CPU and
  // concatenated into one compound <path d="M…L…Z M…L…Z …"> under
  // fill-rule=nonzero, so overlapping CCW outlines composite as one
  // filled silhouette without alpha stacking; gaps between subpaths
  // remain as gaps (the shadow preserves the silhouette's holes for
  // free); back-facing polys are dropped up front.
  const bakedShadowGroundCssZ = sceneCtx?.groundCssZ ?? null;
  const sceneShadow = sceneCtx?.shadow;
  const sceneHasReceiver = sceneCtx?.hasShadowReceiver ?? false;
  const sceneDirectionalLight = sceneCtx?.directionalLight;
  const shadowSvgNode = useMemo<ReactNode>(() => {
    if (!castShadow || renderPolygon) return null;
    // Three.js parity: when a receiveShadow mesh exists, casters drop their
    // ground-shadow fallback so the receiver paints the only shadow pass.
    if (sceneHasReceiver) return null;
    if (bakedShadowGroundCssZ === null) return null;
    // Three.js parity (same gate as the receiver-face path): only a real,
    // nonzero-intensity directional light casts a ground shadow. A scene with
    // no lights must not draw a phantom shadow from an implicit default sun.
    if (!sceneDirectionalLight?.direction || (sceneDirectionalLight.intensity ?? 1) <= 0) {
      return null;
    }

    // World→CSS axis swap so the light direction matches the CSS-frame
    // vertex projection below (vertices are × BASE_TILE with v[1]→x, v[0]→y).
    const lightDir = worldDirectionToCss(sceneDirectionalLight.direction);

    // Project shadows into the MESH WRAPPER's local frame so that the
    // SVG, which is rendered as a child of `.polycss-mesh` and inherits
    // its `translate3d(position * BASE_TILE)`, lands on the absolute
    // scene ground (cssZ = bakedShadowGroundCssZ) — not lifted by the
    // mesh's own world position. Vanilla's groundShadow.ts handles this
    // by adding `worldPositionToCss(position)` to every vertex and
    // mounting the SVG directly on the scene root; we keep the SVG in
    // the wrapper and compensate by subtracting the wrapper's Z
    // translation from the projection plane instead.
    const meshPosZ = position?.[2] ?? 0;
    const localGroundCssZ = bakedShadowGroundCssZ - meshPosZ * BASE_TILE;
    const shadowDedupDrop = cachedOverlappingPolygonDuplicates(polygons, {
      normalTolerance: 0.1,
      distanceTolerance: 0.5,
      overlapFraction: 0.95,
      preserveDoubleSidedBackfaces: false,
    });

    const projections: Array<Array<[number, number]>> = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    // Footprint = the mesh's straight-down (no-shear) silhouette bbox,
    // used by the cap below as the anchor the shadow must always fully
    // contain.
    let fpMinX = Infinity, fpMinY = Infinity, fpMaxX = -Infinity, fpMaxY = -Infinity;
    // Iterate every casting polygon — no Lambert cull. Closed convex
    // meshes don't need the back side, but thin/open meshes (bat wings,
    // cloth, single quad) need both sides projected or the silhouette
    // gets real holes.
    for (let i = 0; i < polygons.length; i++) {
      const polygon = polygons[i]!;
      if (shadowDedupDrop.has(i)) continue;
      const plan = atlasPlans[i];
      if (!plan) continue;
      const projected: Array<[number, number]> = [];
      for (const v of polygon.vertices) {
        const cssVertex: Vec3 = [
          v[1] * BASE_TILE,
          v[0] * BASE_TILE,
          v[2] * BASE_TILE,
        ];
        if (cssVertex[0] < fpMinX) fpMinX = cssVertex[0];
        if (cssVertex[1] < fpMinY) fpMinY = cssVertex[1];
        if (cssVertex[0] > fpMaxX) fpMaxX = cssVertex[0];
        if (cssVertex[1] > fpMaxY) fpMaxY = cssVertex[1];
        const p = projectCssVertexToGround(cssVertex, lightDir, localGroundCssZ);
        projected.push(p);
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
      }
      projections.push(projected);
    }
    if (projections.length === 0) return null;
    // Cap how far the shadow can extend BEYOND THE MESH FOOTPRINT.
    // Low-elevation lights shear projections across the ground so far
    // that the bbox can exceed tens of thousands of pixels each side,
    // which forces the browser to rasterize a >100M-pixel backing store
    // on every repaint (visible as scene-wide flicker when the camera
    // or light moves). The footprint (no-shear silhouette) stays fully
    // inside the SVG so the shadow under/next to the mesh is preserved
    // — we only truncate the sheared end that's off-screen anyway.
    // overflow:hidden does the actual clipping. Callers can disable
    // the cap by passing shadow.maxExtend=Infinity on PolyScene.
    const maxExtend = sceneShadow?.maxExtend ?? 2000;
    const bx0 = Math.max(minX, fpMinX - maxExtend);
    const by0 = Math.max(minY, fpMinY - maxExtend);
    const bx1 = Math.min(maxX, fpMaxX + maxExtend);
    const by1 = Math.min(maxY, fpMaxY + maxExtend);
    const width = bx1 - bx0;
    const height = by1 - by0;
    if (!(width > 0) || !(height > 0)) return null;

    const shadowColor = sceneShadow?.color ?? "#000000";
    const shadowOpacity = sceneShadow?.opacity ?? 0.25;
    const parsed = parseHexColor(shadowColor)?.rgb ?? [0, 0, 0];

    // Concatenate every projection into ONE compound `d` string. Each
    // polygon becomes its own M…L…Z subpath, normalized to CCW so all
    // windings agree and fill-rule=nonzero paints overlapping outlines
    // as one filled silhouette without alpha stacking. Gaps between
    // subpaths remain as gaps (the shadow preserves the silhouette's
    // holes for free).
    let d = "";
    for (const verts of projections) {
      const ccw = ensureCcw2D(verts);
      d += `M${(ccw[0]![0] - bx0).toFixed(3)},${(ccw[0]![1] - by0).toFixed(3)}`;
      for (let j = 1; j < ccw.length; j++) {
        d += `L${(ccw[j]![0] - bx0).toFixed(3)},${(ccw[j]![1] - by0).toFixed(3)}`;
      }
      d += "Z";
    }

    return (
      <svg
        key="shadow-svg"
        className="polycss-shadow polycss-shadow-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          display: "block",
          overflow: "hidden",
          transformOrigin: "0 0",
          pointerEvents: "none",
          willChange: "transform",
          transform: `translate3d(${bx0.toFixed(3)}px,${by0.toFixed(3)}px,${localGroundCssZ.toFixed(3)}px)`,
        }}
      >
        <path
          d={d}
          fill={`rgb(${parsed[0]},${parsed[1]},${parsed[2]})`}
          fillRule="nonzero"
          stroke={`rgb(${parsed[0]},${parsed[1]},${parsed[2]})`}
          strokeWidth="3"
          strokeLinejoin="round"
          opacity={shadowOpacity.toFixed(4)}
        />
      </svg>
    );
  }, [castShadow, renderPolygon, polygons, atlasPlans, sceneDirectionalLight, bakedShadowGroundCssZ, sceneShadow, sceneHasReceiver]);

  return shadowSvgNode;
}
