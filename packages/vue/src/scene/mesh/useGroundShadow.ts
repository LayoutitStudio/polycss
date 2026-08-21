/**
 * useGroundShadow — the per-mesh ground-plane shadow fallback SVG (only
 * when no receiveShadow mesh exists in the scene). Extracted verbatim from
 * PolyMesh.ts.
 */
import { computed, h } from "vue";
import type { ComputedRef, CSSProperties, VNode } from "vue";
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

export interface GroundShadowProps {
  castShadow: boolean;
  position?: Vec3;
}

export function useGroundShadow({
  props,
  slots,
  polygons,
  textureAtlasPlans,
  sceneCtx,
}: {
  props: GroundShadowProps;
  slots: { polygon?: unknown };
  polygons: ComputedRef<Polygon[]>;
  textureAtlasPlans: ComputedRef<Array<TextureAtlasPlan | null>>;
  sceneCtx: ComputedRef<PolySceneContextValue> | null;
}) {
  // Per-mesh SVG shadow — same path for both lighting modes. Every
  // casting polygon is projected to the ground on the CPU and
  // concatenated into one compound <path d="M…L…Z M…L…Z …"> under
  // fill-rule=nonzero so overlapping CCW outlines composite as one
  // filled silhouette without alpha stacking; gaps remain as gaps.
  const shadowSvg = computed<VNode | null>(() => {
    if (!props.castShadow || slots.polygon) return null;
    // Three.js parity: when at least one receiver exists, casters drop
    // the ground-shadow fallback so the receiver paints the only pass.
    if (sceneCtx?.value.receiverRegistry?.hasAny.value) return null;
    const ctx = sceneCtx?.value;
    const groundCssZ = ctx?.groundCssZ ?? null;
    if (groundCssZ === null) return null;
    const shadowOpts = ctx?.shadow;
    // Three.js parity (same gate as the receiver-face path): only a real,
    // nonzero-intensity directional light casts a ground shadow. A scene
    // with no lights must not draw a phantom shadow from an implicit
    // default sun.
    const groundDirLight = ctx?.directionalLight;
    if (!groundDirLight?.direction || (groundDirLight.intensity ?? 1) <= 0) return null;

    // World→CSS axis swap so the light direction matches the CSS-frame
    // vertex projection below (vertices are × BASE_TILE with v[1]→x, v[0]→y).
    const lightDir = worldDirectionToCss(groundDirLight.direction);

    // Project shadows into the MESH WRAPPER's local frame so that the
    // SVG, which is rendered as a child of `.polycss-mesh` and inherits
    // its `translate3d(position * BASE_TILE)`, lands on the absolute
    // scene ground (cssZ = groundCssZ) — not lifted by the mesh's own
    // world position. Mirrors the React path; vanilla handles this by
    // adding `worldPositionToCss(position)` to every vertex and mounting
    // the SVG on the scene root.
    const meshPosZ = props.position?.[2] ?? 0;
    const localGroundCssZ = groundCssZ - meshPosZ * BASE_TILE;
    const dedupDrop = cachedOverlappingPolygonDuplicates(polygons.value, {
      normalTolerance: 0.1,
      distanceTolerance: 0.5,
      overlapFraction: 0.95,
      preserveDoubleSidedBackfaces: false,
    });

    const projections: Array<Array<[number, number]>> = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let fpMinX = Infinity, fpMinY = Infinity, fpMaxX = -Infinity, fpMaxY = -Infinity;
    const polys = polygons.value;
    const plans = textureAtlasPlans.value;
    // No Lambert cull — thin/open meshes (bat wings, cloth, single
    // quad) need both sides projected or the silhouette gets holes.
    // We also track the footprint (no-shear XY bbox) so the cap below
    // keeps the area near the mesh fully inside the SVG.
    for (let i = 0; i < polys.length; i++) {
      if (dedupDrop.has(i)) continue;
      const plan = plans[i];
      if (!plan) continue;
      const polygon = polys[i]!;
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
    // which forces the browser to rasterize a >100M-pixel backing
    // store on every repaint. The footprint stays fully inside the
    // SVG so the shadow under/next to the mesh is preserved; only the
    // sheared end (off-screen anyway) gets clipped by overflow:hidden.
    // Callers can disable the cap by passing shadow.maxExtend=Infinity.
    const maxExtend = shadowOpts?.maxExtend ?? 2000;
    const bx0 = Math.max(minX, fpMinX - maxExtend);
    const by0 = Math.max(minY, fpMinY - maxExtend);
    const bx1 = Math.min(maxX, fpMaxX + maxExtend);
    const by1 = Math.min(maxY, fpMaxY + maxExtend);
    const width = bx1 - bx0;
    const height = by1 - by0;
    if (!(width > 0) || !(height > 0)) return null;

    const shadowColor = shadowOpts?.color ?? "#000000";
    const shadowOpacity = shadowOpts?.opacity ?? 0.25;
    const parsed = parseHexColor(shadowColor)?.rgb ?? [0, 0, 0];

    // Concatenate every projection into ONE compound `d` string. Each
    // polygon becomes its own M…L…Z subpath, normalized to CCW so all
    // windings agree and fill-rule=nonzero paints overlapping outlines
    // as one filled silhouette without alpha stacking. Gaps between
    // subpaths remain as holes — the shadow inherits the silhouette's
    // holes for free.
    let d = "";
    for (const verts of projections) {
      const ccw = ensureCcw2D(verts);
      d += `M${(ccw[0]![0] - bx0).toFixed(3)},${(ccw[0]![1] - by0).toFixed(3)}`;
      for (let j = 1; j < ccw.length; j++) {
        d += `L${(ccw[j]![0] - bx0).toFixed(3)},${(ccw[j]![1] - by0).toFixed(3)}`;
      }
      d += "Z";
    }

    return h(
      "svg",
      {
        class: "polycss-shadow polycss-shadow-svg",
        width: String(width),
        height: String(height),
        viewBox: `0 0 ${width} ${height}`,
        style: {
          position: "absolute",
          top: "0",
          left: "0",
          display: "block",
          overflow: "hidden",
          transformOrigin: "0 0",
          pointerEvents: "none",
          willChange: "transform",
          transform: `translate3d(${bx0.toFixed(3)}px,${by0.toFixed(3)}px,${localGroundCssZ.toFixed(3)}px)`,
        } as CSSProperties,
      },
      [
        h("path", {
          d,
          fill: `rgb(${parsed[0]},${parsed[1]},${parsed[2]})`,
          "fill-rule": "nonzero",
          stroke: `rgb(${parsed[0]},${parsed[1]},${parsed[2]})`,
          "stroke-width": "3",
          "stroke-linejoin": "round",
          opacity: shadowOpacity.toFixed(4),
        }),
      ],
    );
  });

  return { shadowSvg };
}
