import {
  BASIS_EPS,
  SOLID_TRIANGLE_BLEED,
  SOLID_TRIANGLE_CANONICAL_SIZE,
  SOLID_TRIANGLE_LARGE_BORDER_CANONICAL_SIZE,
  cssPoints,
  computeSurfaceNormal,
  crossVec,
  dotVec,
  isSolidTrianglePlan,
  offsetConvexPolygonPointsByEdgeAmounts,
  offsetStableTrianglePoints,
  parseHex,
  resolveSeamBleed,
  rgbKey,
  safePlanSeamBleedAmount,
} from "@layoutit/polycss-core";
import type {
  TextureAtlasPlan,
  PolyTextureLightingMode,
  PolyRenderStrategiesOption,
  SolidPaintDefaults,
  SolidTrianglePrimitive,
  Vec2,
  Vec3,
} from "@layoutit/polycss-core";
import type { CSSProperties } from "react";
import { resolveSolidTrianglePrimitive } from "./detection";

// ---------------------------------------------------------------------------
// Internal helpers used by solidTriangleStyle and updateStableTriangleDom
// ---------------------------------------------------------------------------

const SOLID_TRIANGLE_LARGE_BORDER_WIDTH = "0 48px 96px 48px";

export function solidTriangleCanonicalSize(primitive: SolidTrianglePrimitive): number {
  return primitive === "border-large"
    ? SOLID_TRIANGLE_LARGE_BORDER_CANONICAL_SIZE
    : SOLID_TRIANGLE_CANONICAL_SIZE;
}

export function solidTriangleBorderWidth(primitive: SolidTrianglePrimitive): string | undefined {
  return primitive === "border-large"
    ? SOLID_TRIANGLE_LARGE_BORDER_WIDTH
    : undefined;
}

export function solidTrianglePaintStyle(primitive: SolidTrianglePrimitive): CSSProperties | undefined {
  if (primitive === "corner-bevel") return undefined;
  const borderWidth = primitive === "border-large" ? SOLID_TRIANGLE_LARGE_BORDER_WIDTH : undefined;
  return borderWidth ? { borderWidth } : undefined;
}

export function applySolidTrianglePaintStyle(el: HTMLElement, primitive: SolidTrianglePrimitive): void {
  if (primitive === "corner-bevel") {
    el.style.width = "";
    el.style.height = "";
    el.style.backgroundColor = "";
    el.style.borderWidth = "";
    el.style.borderTopLeftRadius = "";
    el.style.borderTopRightRadius = "";
    el.style.removeProperty("corner-top-left-shape");
    el.style.removeProperty("corner-top-right-shape");
  } else {
    el.style.width = "";
    el.style.height = "";
    el.style.backgroundColor = "";
    el.style.borderTopLeftRadius = "";
    el.style.borderTopRightRadius = "";
    el.style.removeProperty("corner-top-left-shape");
    el.style.removeProperty("corner-top-right-shape");
    el.style.borderWidth = primitive === "border-large" ? SOLID_TRIANGLE_LARGE_BORDER_WIDTH : "";
  }
}

function triangleEdgeIndexForPair(a: number, b: number): number | undefined {
  if ((a + 1) % 3 === b) return a;
  if ((b + 1) % 3 === a) return b;
  return undefined;
}

function stableTriangleEdgeAmounts(
  entry: TextureAtlasPlan,
  a: number,
  b: number,
  c: number,
  screenPts: number[],
): number[] | null {
  const seamEdges = entry.seamBleedEdges;
  if (!seamEdges?.size) return null;
  // entry.bleedRatio scales the SOLID_TRIANGLE_BLEED fallback so
  // options.seamBleed=0 disables it (mirrors core solidTrianglePlan).
  const triangleBleed = SOLID_TRIANGLE_BLEED * (entry.bleedRatio ?? 1);
  const seamAmount = entry.seamBleed === undefined
    ? triangleBleed
    : entry.seamBleed;
  const edgePairs: Array<[number, number]> = [[c, a], [a, b], [b, c]];
  return edgePairs.map(([from, to], localEdgeIndex) => {
    const edgeIndex = triangleEdgeIndexForPair(from, to);
    const requested = edgeIndex !== undefined && seamEdges.has(edgeIndex)
      ? entry.seamBleedEdgeAmounts?.get(edgeIndex) ?? resolveSeamBleed(seamAmount, triangleBleed)
      : 0;
    return safePlanSeamBleedAmount(screenPts, localEdgeIndex, requested);
  });
}

export function formatStableTriangleTransformScalars(
  x0: number, x1: number, x2: number,
  y0: number, y1: number, y2: number,
  z0: number, z1: number, z2: number,
  tx0: number, tx1: number, tx2: number,
): string {
  const rx0 = Math.round(x0 * 1000) / 1000 || 0;
  const rx1 = Math.round(x1 * 1000) / 1000 || 0;
  const rx2 = Math.round(x2 * 1000) / 1000 || 0;
  const ry0 = Math.round(y0 * 1000) / 1000 || 0;
  const ry1 = Math.round(y1 * 1000) / 1000 || 0;
  const ry2 = Math.round(y2 * 1000) / 1000 || 0;
  const rz0 = Math.round(z0 * 1000) / 1000 || 0;
  const rz1 = Math.round(z1 * 1000) / 1000 || 0;
  const rz2 = Math.round(z2 * 1000) / 1000 || 0;
  const rtx0 = Math.round(tx0 * 1000) / 1000 || 0;
  const rtx1 = Math.round(tx1 * 1000) / 1000 || 0;
  const rtx2 = Math.round(tx2 * 1000) / 1000 || 0;
  return `matrix3d(${rx0},${rx1},${rx2},0,${ry0},${ry1},${ry2},0,${rz0},${rz1},${rz2},0,${rtx0},${rtx1},${rtx2},1)`;
}

// Generates React CSSProperties for a solid-triangle (<u>) leaf.
// Uses canonical SOLID_TRIANGLE_BLEED = 0.75 to match the polycss renderer.
export function solidTriangleStyle(
  entry: TextureAtlasPlan,
  textureLighting: PolyTextureLightingMode,
  pointerEvents: "auto" | "none",
  solidPaintDefaults?: SolidPaintDefaults,
  doc?: Document | null,
  strategies?: PolyRenderStrategiesOption,
): CSSProperties | null {
  if (!isSolidTrianglePlan(entry)) return null;
  // Vanilla resolves the primitive from the owning document (correct inside
  // iframes / second documents) once per render; gating on a disabled or
  // unsupported "u" strategy already happened in plan filtering, so a leaf
  // that reaches this builder falls back to the border primitive when no
  // document is available (mirrors vanilla's `?? "border"` call sites).
  const resolvedDoc = doc ?? (typeof document !== "undefined" ? document : null);
  const primitive = resolvedDoc
    ? resolveSolidTrianglePrimitive(resolvedDoc, strategies) ?? "border"
    : "border";

  const tile = entry.tileSize;
  const elev = entry.layerElevation;
  const pts = cssPoints(entry.polygon.vertices, tile, elev);
  const normal = computeSurfaceNormal(pts);
  if (!normal) return null;

  const edges = [
    { a: 0, b: 1, c: 2 },
    { a: 1, b: 2, c: 0 },
    { a: 2, b: 0, c: 1 },
  ].map((edge) => {
    const av = pts[edge.a];
    const bv = pts[edge.b];
    return {
      ...edge,
      length: Math.hypot(bv[0] - av[0], bv[1] - av[1], bv[2] - av[2]),
    };
  }).sort((a, b) => b.length - a.length);

  let a = edges[0].a;
  let b = edges[0].b;
  const c = edges[0].c;
  let av = pts[a];
  let bv = pts[b];
  const cv = pts[c];
  let baseLength = edges[0].length;
  if (baseLength <= BASIS_EPS) return null;

  let xAxis: Vec3 = [
    (bv[0] - av[0]) / baseLength,
    (bv[1] - av[1]) / baseLength,
    (bv[2] - av[2]) / baseLength,
  ];
  const ac: Vec3 = [cv[0] - av[0], cv[1] - av[1], cv[2] - av[2]];
  let apexX = dotVec(ac, xAxis);
  let foot: Vec3 = [
    av[0] + xAxis[0] * apexX,
    av[1] + xAxis[1] * apexX,
    av[2] + xAxis[2] * apexX,
  ];
  let yAxisRaw: Vec3 = [foot[0] - cv[0], foot[1] - cv[1], foot[2] - cv[2]];
  const height = Math.hypot(yAxisRaw[0], yAxisRaw[1], yAxisRaw[2]);
  if (height <= BASIS_EPS) return null;
  let yAxis: Vec3 = [yAxisRaw[0] / height, yAxisRaw[1] / height, yAxisRaw[2] / height];

  if (dotVec(crossVec(xAxis, yAxis), normal) < 0) {
    const nextA = b;
    b = a;
    a = nextA;
    av = pts[a];
    bv = pts[b];
    baseLength = Math.hypot(bv[0] - av[0], bv[1] - av[1], bv[2] - av[2]);
    if (baseLength <= BASIS_EPS) return null;
    xAxis = [
      (bv[0] - av[0]) / baseLength,
      (bv[1] - av[1]) / baseLength,
      (bv[2] - av[2]) / baseLength,
    ];
    const nextAc: Vec3 = [cv[0] - av[0], cv[1] - av[1], cv[2] - av[2]];
    apexX = dotVec(nextAc, xAxis);
    foot = [
      av[0] + xAxis[0] * apexX,
      av[1] + xAxis[1] * apexX,
      av[2] + xAxis[2] * apexX,
    ];
    yAxisRaw = [foot[0] - cv[0], foot[1] - cv[1], foot[2] - cv[2]];
    const nextHeight = Math.hypot(yAxisRaw[0], yAxisRaw[1], yAxisRaw[2]);
    if (nextHeight <= BASIS_EPS) return null;
    yAxis = [yAxisRaw[0] / nextHeight, yAxisRaw[1] / nextHeight, yAxisRaw[2] / nextHeight];
  }

  const canonicalSize = solidTriangleCanonicalSize(primitive);
  const left = Math.max(0, Math.min(baseLength, apexX));
  const right = Math.max(0, baseLength - left);
  const screenPts = [left, 0, 0, height, left + right, height];
  const edgeAmounts = stableTriangleEdgeAmounts(entry, a, b, c, screenPts);
  const expanded = edgeAmounts
    ? offsetConvexPolygonPointsByEdgeAmounts(screenPts, edgeAmounts)
    : offsetStableTrianglePoints(
        left,
        right,
        height,
        resolveSeamBleed(entry.seamBleed, SOLID_TRIANGLE_BLEED * (entry.bleedRatio ?? 1)),
      );
  const apex2: Vec2 = [expanded[0], expanded[1]];
  const baseLeft2: Vec2 = [expanded[2], expanded[3]];
  const baseRight2: Vec2 = [expanded[4], expanded[5]];
  const baseY = (baseLeft2[1] + baseRight2[1]) / 2;
  const leftPx = apex2[0] - baseLeft2[0];
  const rightPx = baseRight2[0] - apex2[0];
  const heightPx = baseY - apex2[1];
  if (
    leftPx <= BASIS_EPS ||
    rightPx <= BASIS_EPS ||
    heightPx <= BASIS_EPS ||
    !Number.isFinite(leftPx + rightPx + heightPx)
  ) {
    return null;
  }
  const dynamic = textureLighting === "dynamic";
  const base = parseHex(entry.polygon.color ?? "#cccccc");
  const useDefaultDynamicColor = dynamic && rgbKey(base) === solidPaintDefaults?.dynamicColorKey;
  const sharedStyle = {
    color: dynamic || entry.shadedColor === solidPaintDefaults?.paintColor
      ? undefined
      : entry.shadedColor,
    pointerEvents: pointerEvents === "none" ? "none" as const : undefined,
    ...(dynamic && !useDefaultDynamicColor
      ? {
          ["--pnx" as string]: normal[0].toFixed(4),
          ["--pny" as string]: normal[1].toFixed(4),
          ["--pnz" as string]: normal[2].toFixed(4),
          ["--psr" as string]: (base.r / 255).toFixed(4),
          ["--psg" as string]: (base.g / 255).toFixed(4),
          ["--psb" as string]: (base.b / 255).toFixed(4),
        }
      : dynamic
        ? {
            ["--pnx" as string]: normal[0].toFixed(4),
            ["--pny" as string]: normal[1].toFixed(4),
            ["--pnz" as string]: normal[2].toFixed(4),
          }
        : null),
  };

  const worldPoint = ([x, y]: Vec2): Vec3 => [
    cv[0] + (x - left) * xAxis[0] + y * yAxis[0],
    cv[1] + (x - left) * xAxis[1] + y * yAxis[1],
    cv[2] + (x - left) * xAxis[2] + y * yAxis[2],
  ];
  const apex = worldPoint(apex2);
  const baseLeft = worldPoint([baseLeft2[0], baseY]);
  const baseRight = worldPoint([baseRight2[0], baseY]);

  const halfBase = canonicalSize / 2;
  const xCol: Vec3 = [
    (baseRight[0] - baseLeft[0]) / canonicalSize,
    (baseRight[1] - baseLeft[1]) / canonicalSize,
    (baseRight[2] - baseLeft[2]) / canonicalSize,
  ];
  const txCol: Vec3 = [
    apex[0] - xCol[0] * halfBase,
    apex[1] - xCol[1] * halfBase,
    apex[2] - xCol[2] * halfBase,
  ];
  const yCol: Vec3 = [
    (baseLeft[0] - txCol[0]) / canonicalSize,
    (baseLeft[1] - txCol[1]) / canonicalSize,
    (baseLeft[2] - txCol[2]) / canonicalSize,
  ];
  const canonicalMatrix = [
    xCol[0], xCol[1], xCol[2], 0,
    yCol[0], yCol[1], yCol[2], 0,
    normal[0], normal[1], normal[2], 0,
    txCol[0], txCol[1], txCol[2], 1,
  ].map((v) => (Math.round(v * 1000) / 1000 || 0).toString()).join(",");
  const primitiveStyle = solidTrianglePaintStyle(primitive);
  return {
    transform: `matrix3d(${canonicalMatrix})`,
    ...(primitiveStyle ?? {}),
    ...sharedStyle,
  };
}
