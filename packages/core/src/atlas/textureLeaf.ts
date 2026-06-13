import type {
  PolyTextureImageLighting,
  PolyTextureImageSource,
} from "../types";
import type {
  PolyTextureLeafGeometry,
  PolyTextureLeafResolverOptions,
  PolyTextureLeafSourceRect,
  TextureAtlasPlan,
} from "./types";
import { formatAtlasMatrix, formatMatrix3dValues } from "./matrix";
import { computeProjectiveQuadMatrix, resolveProjectiveQuadGuards, stableBasisFromPlan } from "./plan";
import { SOLID_QUAD_CANONICAL_SIZE } from "./constants";
import {
  resolvePolyTextureImageSource,
  resolvePolyTexturePresentation,
} from "./textureSource";

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validSource(source: PolyTextureImageSource | undefined): source is PolyTextureImageSource {
  return !!source &&
    typeof source.url === "string" &&
    source.url.length > 0 &&
    finitePositive(source.width) &&
    finitePositive(source.height);
}

function sourceRectFor(source: PolyTextureImageSource): PolyTextureLeafSourceRect | null {
  const rect = source.sourceRect;
  if (!rect) {
    return { x: 0, y: 0, width: source.width, height: source.height };
  }
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !finitePositive(rect.width) ||
    !finitePositive(rect.height)
  ) {
    return null;
  }
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function rescaleProjectiveMatrixForPrimitive(
  matrix: string,
  width: number,
  height: number,
): string | null {
  const values = matrix.split(",").map(Number);
  if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) return null;
  const scaleX = SOLID_QUAD_CANONICAL_SIZE / width;
  const scaleY = SOLID_QUAD_CANONICAL_SIZE / height;
  for (let i = 0; i < 4; i += 1) values[i] *= scaleX;
  for (let i = 4; i < 8; i += 1) values[i] *= scaleY;
  return formatMatrix3dValues(values, 6);
}

export function resolvePolyTextureLeafGeometry(
  plan: TextureAtlasPlan,
  options: PolyTextureLeafResolverOptions = {},
): PolyTextureLeafGeometry | null {
  const source = resolvePolyTextureImageSource(plan.polygon);
  if (!validSource(source)) return null;
  const presentation = resolvePolyTexturePresentation(plan.polygon, {
    imageRendering: options.imageRendering,
    backend: options.backend,
    lighting: options.lighting,
    projection: options.projection,
  });
  if (presentation.backend !== "image") return null;

  const lighting: PolyTextureImageLighting = presentation.lighting ?? "source";
  if (lighting !== "source") return null;

  const sourceRect = sourceRectFor(source);
  if (!sourceRect) return null;

  const leafWidth = Math.max(1, sourceRect.width);
  const leafHeight = Math.max(1, sourceRect.height);
  const requestedProjection = presentation.projection ?? "affine";
  let projection = requestedProjection;
  let matrix: string | null = null;

  if (requestedProjection === "projective") {
    if (options.allowProjective === false || plan.screenPts.length !== 8 || plan.polygon.vertices.length !== 4) {
      return null;
    }
    const guards = options.projectiveQuadGuards ?? resolveProjectiveQuadGuards(undefined);
    const basis = stableBasisFromPlan(plan, plan.polygon);
    if (!basis) return null;
    const projective = computeProjectiveQuadMatrix(
      plan.screenPts,
      basis.xAxis,
      basis.yAxis,
      basis.normal,
      basis.tx,
      basis.ty,
      basis.tz,
      guards,
      plan.seamBleedEdgeAmounts,
    );
    matrix = projective ? rescaleProjectiveMatrixForPrimitive(projective, leafWidth, leafHeight) : null;
    if (!matrix) return null;
  } else {
    projection = "affine";
    matrix = formatAtlasMatrix(plan, leafWidth, leafHeight);
  }

  return {
    source,
    url: source.url,
    sourceRect,
    leafWidth,
    leafHeight,
    matrix,
    backgroundPosition: [-sourceRect.x, -sourceRect.y],
    backgroundSize: [source.width, source.height],
    imageRendering: presentation.imageRendering ?? "auto",
    lighting,
    projection,
  };
}
