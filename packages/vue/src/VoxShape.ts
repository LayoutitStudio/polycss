import { defineComponent, h } from "vue";
import type { PropType } from "vue";
import type { GridContext, Voxel, ShapeType, ShapeSurfaceLighting } from "@layoutit/voxcss-core";
import { getVoxelBounds, computeShapeLighting } from "@layoutit/voxcss-core";

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

let _patternIdCounter = 0;
function nextPatternId(): string {
  return `vox-pat-${++_patternIdCounter}`;
}

function renderSvgSlope(
  className: string,
  path: string,
  fill: string,
  viewBox = "0 0 480 480",
  width = "56",
  height = "50",
  textureUrl?: string,
  brightnessDelta = 0,
) {
  const patternId = textureUrl ? nextPatternId() : "";
  const effectiveFill = textureUrl ? `url(#${patternId})` : fill;
  const filter = textureUrl ? textureBrightnessFilter(brightnessDelta) : undefined;

  const defs = textureUrl
    ? h("defs", null, [
        h("pattern", {
          id: patternId,
          patternUnits: "objectBoundingBox",
          patternContentUnits: "objectBoundingBox",
          width: "1",
          height: "1",
        }, [
          h("image", {
            width: "1",
            height: "1",
            preserveAspectRatio: "xMidYMid slice",
            href: textureUrl,
          }),
        ]),
      ])
    : null;

  return h("div", { class: className, style: { filter } }, [
    h(
      "svg",
      {
        viewBox,
        width,
        height,
        preserveAspectRatio: "none",
        xmlns: "http://www.w3.org/2000/svg",
        "aria-hidden": "true",
        focusable: "false",
        style: {
          position: "absolute",
          inset: "0",
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "none",
        },
      },
      [
        defs,
        h("path", {
          d: path,
          fill: effectiveFill,
          stroke: "rgba(0, 0, 0, 0.1)",
          "stroke-width": "1",
          "vector-effect": "non-scaling-stroke",
        }),
      ]
    ),
  ]);
}

function renderRamp(
  voxel: Voxel,
  context: GridContext,
  baseColor: string,
  lighting: ShapeSurfaceLighting[],
  showBottom: boolean,
) {
  const slopeColor = getSurfaceColor(lighting, "slope", baseColor);
  const slopeDelta = getSurfaceDelta(lighting, "slope");
  const slopeTexture = resolveSurfaceTexture(voxel, "slope", context);
  const bottomTexture = resolveSurfaceTexture(voxel, "bottom", context);

  const children = [];
  if (showBottom) {
    children.push(
      h("div", {
        class: "voxcss-ramp-bottom",
        style: {
          backgroundColor: bottomTexture ? undefined : baseColor,
          backgroundImage: bottomTexture ? `url(${bottomTexture})` : undefined,
          filter: bottomTexture ? textureBrightnessFilter(0) : undefined,
        },
      })
    );
  }
  children.push(
    h("div", {
      class: "voxcss-ramp-slope",
      style: {
        backgroundColor: slopeTexture ? undefined : slopeColor,
        backgroundImage: slopeTexture ? `url(${slopeTexture})` : undefined,
        backgroundSize: "70px 50px",
        filter: slopeTexture ? textureBrightnessFilter(slopeDelta) : undefined,
      },
    })
  );

  return children;
}

function renderWedge(
  voxel: Voxel,
  context: GridContext,
  baseColor: string,
  lighting: ShapeSurfaceLighting[],
  showBottom: boolean,
) {
  const primaryColor = getSurfaceColor(lighting, "primary", baseColor);
  const secondaryColor = getSurfaceColor(lighting, "secondary", baseColor);
  const primaryDelta = getSurfaceDelta(lighting, "primary");
  const secondaryDelta = getSurfaceDelta(lighting, "secondary");
  const primaryTexture = resolveSurfaceTexture(voxel, "primary", context);
  const secondaryTexture = resolveSurfaceTexture(voxel, "secondary", context);
  const bottomTexture = resolveSurfaceTexture(voxel, "bottom", context);

  const children = [];
  if (showBottom) {
    children.push(
      h("div", {
        class: "voxcss-wedge-bottom",
        style: {
          backgroundColor: bottomTexture ? undefined : baseColor,
          backgroundImage: bottomTexture ? `url(${bottomTexture})` : undefined,
          filter: bottomTexture ? textureBrightnessFilter(0) : undefined,
        },
      })
    );
  }
  children.push(
    renderSvgSlope(
      "voxcss-wedge-slope voxcss-wedge-slope--primary",
      "M0 0 L480 0 L0 480 Z",
      primaryColor,
      undefined,
      undefined,
      undefined,
      primaryTexture,
      primaryDelta,
    )
  );
  children.push(
    renderSvgSlope(
      "voxcss-wedge-slope voxcss-wedge-slope--secondary",
      "M480 480 L0 480 L480 0 Z",
      secondaryColor,
      undefined,
      "50",
      "56",
      secondaryTexture,
      secondaryDelta,
    )
  );

  return children;
}

function renderSpike(
  voxel: Voxel,
  context: GridContext,
  baseColor: string,
  lighting: ShapeSurfaceLighting[],
  showBottom: boolean,
) {
  const primaryColor = getSurfaceColor(lighting, "primary", baseColor);
  const secondaryColor = getSurfaceColor(lighting, "secondary", baseColor);
  const primaryDelta = getSurfaceDelta(lighting, "primary");
  const secondaryDelta = getSurfaceDelta(lighting, "secondary");
  const primaryTexture = resolveSurfaceTexture(voxel, "primary", context);
  const secondaryTexture = resolveSurfaceTexture(voxel, "secondary", context);
  const bottomTexture = resolveSurfaceTexture(voxel, "bottom", context);

  const children = [];
  if (showBottom) {
    children.push(
      h("div", {
        class: "voxcss-spike-bottom",
        style: {
          backgroundColor: bottomTexture ? undefined : baseColor,
          backgroundImage: bottomTexture ? `url(${bottomTexture})` : undefined,
          filter: bottomTexture ? textureBrightnessFilter(0) : undefined,
        },
      })
    );
  }
  children.push(
    renderSvgSlope(
      "voxcss-spike-slope voxcss-spike-slope--primary",
      "M480 0 L480 480 L0 480 Z",
      primaryColor,
      undefined,
      undefined,
      undefined,
      primaryTexture,
      primaryDelta,
    )
  );
  children.push(
    renderSvgSlope(
      "voxcss-spike-slope voxcss-spike-slope--secondary",
      "M0 0 L0 480 L480 0 Z",
      secondaryColor,
      undefined,
      "50",
      "56",
      secondaryTexture,
      secondaryDelta,
    )
  );

  return children;
}

export const VoxShape = defineComponent({
  name: "VoxShape",
  props: {
    voxel: { type: Object as PropType<Voxel>, required: true },
    context: { type: Object as PropType<GridContext>, required: true },
  },
  setup(props) {
    return () => {
      const shapeKey = props.voxel.shape ?? "cube";
      if (shapeKey === "cube") return null;
      const shape = shapeKey as ShapeType;

      if (isCovered(props.voxel, props.context)) return null;

      const { x2, y2 } = getVoxelBounds(props.voxel);
      const rawRotation = Number.isFinite(props.voxel.rot as number) ? Number(props.voxel.rot) : 0;
      const rotation = normalizeRotation(rawRotation);
      const orientation = ORIENTATION_MAP[rotation] ?? "east";
      const baseColor = props.voxel.color ?? "#cccccc";
      const lighting = computeShapeLighting(shape, rawRotation, baseColor);
      const showBottom = shouldRenderBottom(props.voxel, props.context);

      // Shape class + orientation on the SAME root div (matches HTML renderer's mountToRoot)
      let shapeClass: string;
      let children: any[];
      if (shape === "ramp") {
        shapeClass = "voxcss-ramp";
        children = renderRamp(props.voxel, props.context, baseColor, lighting, showBottom);
      } else if (shape === "wedge") {
        shapeClass = "voxcss-wedge";
        children = renderWedge(props.voxel, props.context, baseColor, lighting, showBottom);
      } else {
        shapeClass = "voxcss-spike";
        children = renderSpike(props.voxel, props.context, baseColor, lighting, showBottom);
      }

      return h(
        "div",
        {
          class: `voxcss-${orientation} ${shapeClass}`,
          style: { gridArea: `${props.voxel.x} / ${props.voxel.y} / ${x2} / ${y2}` },
        },
        children
      );
    };
  },
});
