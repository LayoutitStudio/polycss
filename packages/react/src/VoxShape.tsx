import { memo, useId } from "react";
import type { GridContext, Voxel } from "@layoutit/voxcss-core";
import { getVoxelBounds } from "@layoutit/voxcss-core";
import { computeShapeLighting } from "@layoutit/voxcss-core";
import type { ShapeType, ShapeSurfaceLighting } from "@layoutit/voxcss-core";

interface VoxShapeProps {
  voxel: Voxel;
  context: GridContext;
}

const ORIENTATION_MAP: Record<number, string> = {
  0: "east",
  90: "south",
  180: "west",
  270: "north",
};

function normalizeRotation(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  const snapped = Math.round((value as number) / 90) * 90;
  return ((snapped % 360) + 360) % 360;
}

function isCovered(voxel: Voxel, context: GridContext): boolean {
  const { x2, y2 } = getVoxelBounds(voxel);
  const layerAbove = Math.max(0, Math.floor((voxel.z ?? 0) + 1));
  for (let row = voxel.x; row < x2; row += 1) {
    for (let col = voxel.y; col < y2; col += 1) {
      if (context.getVoxel(row, col, layerAbove)) return true;
    }
  }
  return false;
}

function isBottomOccluded(voxel: Voxel, context: GridContext): boolean {
  const targetZ = Math.floor((voxel.z ?? 0) - 1);
  if (targetZ < 0) return false;
  const { x2, y2 } = getVoxelBounds(voxel);
  for (let x = voxel.x; x < x2; x += 1) {
    for (let y = voxel.y; y < y2; y += 1) {
      if (!context.getVoxel(x, y, targetZ)) return false;
    }
  }
  return true;
}

function shouldRenderBottom(voxel: Voxel, context: GridContext): boolean {
  if (context.walls?.b) return false;
  return !isBottomOccluded(voxel, context);
}

function getSurfaceColor(lighting: ShapeSurfaceLighting[], surfaceId: string, fallback: string): string {
  return lighting.find((s) => s.id === surfaceId)?.color ?? fallback;
}

function getSurfaceDelta(lighting: ShapeSurfaceLighting[], surfaceId: string): number {
  return lighting.find((s) => s.id === surfaceId)?.delta ?? 0;
}

function resolveSurfaceTexture(
  voxel: Voxel,
  surfaceId: string,
  context: GridContext
): string | undefined {
  const textureKey = voxel.texture;
  if (!textureKey || textureKey.startsWith("#")) return undefined;
  const resolved = context.resolveTexture?.(textureKey, surfaceId);
  if (resolved) return resolved;
  if (
    textureKey.startsWith("/") ||
    textureKey.startsWith("./") ||
    textureKey.startsWith("../") ||
    textureKey.startsWith("http://") ||
    textureKey.startsWith("https://") ||
    textureKey.startsWith("data:") ||
    textureKey.includes(".")
  ) {
    return textureKey;
  }
  return undefined;
}

function textureBrightnessFilter(delta: number): string | undefined {
  const brightness = Math.max(0, 1 + delta / 200);
  if (Math.abs(brightness - 1) < 0.001) return undefined;
  const rounded = Math.round(brightness * 1000) / 1000;
  return `brightness(${rounded})`;
}

function VoxShapeInner({ voxel, context }: VoxShapeProps) {
  const shapeKey = voxel.shape ?? "cube";
  if (shapeKey === "cube") return null;
  const shape = shapeKey as ShapeType;

  if (isCovered(voxel, context)) return null;

  const { x2, y2 } = getVoxelBounds(voxel);
  const rawRotation = Number.isFinite(voxel.rot as number) ? Number(voxel.rot) : 0;
  const rotation = normalizeRotation(rawRotation);
  const orientation = ORIENTATION_MAP[rotation] ?? "east";
  const baseColor = voxel.color ?? "#cccccc";
  const lighting = computeShapeLighting(shape, rawRotation, baseColor);
  const showBottom = shouldRenderBottom(voxel, context);

  const shapeClass = shape === "ramp" ? "voxcss-ramp" : shape === "wedge" ? "voxcss-wedge" : "voxcss-spike";

  return (
    <div
      className={`voxcss-${orientation} ${shapeClass}`}
      style={{ gridArea: `${voxel.x} / ${voxel.y} / ${x2} / ${y2}` }}
    >
      {shape === "ramp" && (
        <RampShapeInner voxel={voxel} context={context} baseColor={baseColor} lighting={lighting} showBottom={showBottom} />
      )}
      {shape === "wedge" && (
        <WedgeShapeInner voxel={voxel} context={context} baseColor={baseColor} lighting={lighting} showBottom={showBottom} />
      )}
      {shape === "spike" && (
        <SpikeShapeInner voxel={voxel} context={context} baseColor={baseColor} lighting={lighting} showBottom={showBottom} />
      )}
    </div>
  );
}

export const VoxShape = memo(VoxShapeInner);

interface ShapeInnerProps {
  voxel: Voxel;
  context: GridContext;
  baseColor: string;
  lighting: ShapeSurfaceLighting[];
  showBottom: boolean;
}

function RampShapeInner({ voxel, context, baseColor, lighting, showBottom }: ShapeInnerProps) {
  const slopeColor = getSurfaceColor(lighting, "slope", baseColor);
  const slopeDelta = getSurfaceDelta(lighting, "slope");
  const slopeTexture = resolveSurfaceTexture(voxel, "slope", context);
  const bottomTexture = resolveSurfaceTexture(voxel, "bottom", context);

  return (
    <>
      {showBottom && (
        <div
          className="voxcss-ramp-bottom"
          style={{
            backgroundColor: bottomTexture ? undefined : baseColor,
            backgroundImage: bottomTexture ? `url(${bottomTexture})` : undefined,
            filter: bottomTexture ? textureBrightnessFilter(0) : undefined,
          }}
        />
      )}
      <div
        className="voxcss-ramp-slope"
        style={{
          backgroundColor: slopeTexture ? undefined : slopeColor,
          backgroundImage: slopeTexture ? `url(${slopeTexture})` : undefined,
          backgroundSize: "70px 50px",
          filter: slopeTexture ? textureBrightnessFilter(slopeDelta) : undefined,
        }}
      />
    </>
  );
}

interface SvgSlopeProps {
  className: string;
  path: string;
  fill: string;
  viewBox?: string;
  width?: string;
  height?: string;
  textureUrl?: string;
  brightnessDelta?: number;
}

function SvgSlope({
  className,
  path,
  fill,
  viewBox = "0 0 480 480",
  width = "56",
  height = "50",
  textureUrl,
  brightnessDelta = 0,
}: SvgSlopeProps) {
  const patternId = useId();

  const effectiveFill = textureUrl ? `url(#${patternId})` : fill;
  const filter = textureUrl ? textureBrightnessFilter(brightnessDelta) : undefined;

  return (
    <div className={className} style={{ filter }}>
      <svg
        viewBox={viewBox}
        width={width}
        height={height}
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable={false as unknown as undefined}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "none",
        }}
      >
        {textureUrl && (
          <defs>
            <pattern
              id={patternId}
              patternUnits="objectBoundingBox"
              patternContentUnits="objectBoundingBox"
              width="1"
              height="1"
            >
              <image
                width="1"
                height="1"
                preserveAspectRatio="xMidYMid slice"
                href={textureUrl}
              />
            </pattern>
          </defs>
        )}
        <path
          d={path}
          fill={effectiveFill}
          stroke="rgba(0, 0, 0, 0.1)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function WedgeShapeInner({ voxel, context, baseColor, lighting, showBottom }: ShapeInnerProps) {
  const primaryColor = getSurfaceColor(lighting, "primary", baseColor);
  const secondaryColor = getSurfaceColor(lighting, "secondary", baseColor);
  const primaryDelta = getSurfaceDelta(lighting, "primary");
  const secondaryDelta = getSurfaceDelta(lighting, "secondary");
  const primaryTexture = resolveSurfaceTexture(voxel, "primary", context);
  const secondaryTexture = resolveSurfaceTexture(voxel, "secondary", context);
  const bottomTexture = resolveSurfaceTexture(voxel, "bottom", context);

  return (
    <>
      {showBottom && (
        <div
          className="voxcss-wedge-bottom"
          style={{
            backgroundColor: bottomTexture ? undefined : baseColor,
            backgroundImage: bottomTexture ? `url(${bottomTexture})` : undefined,
            filter: bottomTexture ? textureBrightnessFilter(0) : undefined,
          }}
        />
      )}
      <SvgSlope
        className="voxcss-wedge-slope voxcss-wedge-slope--primary"
        path="M0 0 L480 0 L0 480 Z"
        fill={primaryColor}
        textureUrl={primaryTexture}
        brightnessDelta={primaryDelta}
      />
      <SvgSlope
        className="voxcss-wedge-slope voxcss-wedge-slope--secondary"
        path="M480 480 L0 480 L480 0 Z"
        fill={secondaryColor}
        width="50"
        height="56"
        textureUrl={secondaryTexture}
        brightnessDelta={secondaryDelta}
      />
    </>
  );
}

function SpikeShapeInner({ voxel, context, baseColor, lighting, showBottom }: ShapeInnerProps) {
  const primaryColor = getSurfaceColor(lighting, "primary", baseColor);
  const secondaryColor = getSurfaceColor(lighting, "secondary", baseColor);
  const primaryDelta = getSurfaceDelta(lighting, "primary");
  const secondaryDelta = getSurfaceDelta(lighting, "secondary");
  const primaryTexture = resolveSurfaceTexture(voxel, "primary", context);
  const secondaryTexture = resolveSurfaceTexture(voxel, "secondary", context);
  const bottomTexture = resolveSurfaceTexture(voxel, "bottom", context);

  return (
    <>
      {showBottom && (
        <div
          className="voxcss-spike-bottom"
          style={{
            backgroundColor: bottomTexture ? undefined : baseColor,
            backgroundImage: bottomTexture ? `url(${bottomTexture})` : undefined,
            filter: bottomTexture ? textureBrightnessFilter(0) : undefined,
          }}
        />
      )}
      <SvgSlope
        className="voxcss-spike-slope voxcss-spike-slope--primary"
        path="M480 0 L480 480 L0 480 Z"
        fill={primaryColor}
        textureUrl={primaryTexture}
        brightnessDelta={primaryDelta}
      />
      <SvgSlope
        className="voxcss-spike-slope voxcss-spike-slope--secondary"
        path="M0 0 L0 480 L480 0 Z"
        fill={secondaryColor}
        width="50"
        height="56"
        textureUrl={secondaryTexture}
        brightnessDelta={secondaryDelta}
      />
    </>
  );
}
