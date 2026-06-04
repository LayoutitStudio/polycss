/**
 * `<PolyIframe>` (Vue) — flat textured "quad" whose texture is a live
 * document instead of an atlas slice. Mounts an `<iframe>` inside the
 * scene's preserve-3d context so `matrix3d` transforms compose with
 * surrounding polygons.
 *
 * Mirrors the React + vanilla counterparts 1:1. Conventions match
 * post-parity `<PolyMesh>`:
 *   - `position` (Vec3, world units, world-axis order +X right +Y forward +Z up)
 *   - `rotation` (Vec3, Euler degrees, world XYZ)
 *   - `scale`    (number or Vec3, defaults to 1)
 *   - `width` / `height` (numbers, world units)
 *
 * The iframe is centered at the wrapper's local origin (trailing
 * `translate(-w/2, -h/2)` in the transform string), so rotation/scale
 * pivot at the visible center — same shape as `<PolyIcosahedron size>`.
 */
import { defineComponent, h, computed } from "vue";
import type { PropType, CSSProperties } from "vue";
import { BASE_TILE, type Vec3 } from "@layoutit/polycss-core";

export interface PolyIframeProps {
  src: string;
  width: number;
  height: number;
  position?: Vec3;
  rotation?: Vec3;
  scale?: number | Vec3;
  allow?: string;
  sandbox?: string;
  loading?: "lazy" | "eager";
  referrerpolicy?: string;
  title?: string;
  class?: string;
  style?: CSSProperties;
}

/**
 * Build the wrapper transform string. Mirrors vanilla's
 * `buildIframeTransform` and React's exactly — world→CSS axis swap on
 * position, rotation conjugation (`rotateY(-rx) rotateX(-ry)
 * rotateZ(-rz)`), scale at the end, trailing `translate(-w/2, -h/2)` to
 * center the iframe content at the wrapper's local origin.
 */
function buildIframeTransform(
  position: Vec3 | undefined,
  rotation: Vec3 | undefined,
  scale: number | Vec3 | undefined,
  cssWidth: number,
  cssHeight: number,
): string {
  const sx = typeof scale === "number" ? scale : (scale?.[0] ?? 1);
  const sy = typeof scale === "number" ? scale : (scale?.[1] ?? 1);
  const sz = typeof scale === "number" ? scale : (scale?.[2] ?? 1);
  const hasScale = sx !== 1 || sy !== 1 || sz !== 1;
  const hasRotation = !!rotation && (!!rotation[0] || !!rotation[1] || !!rotation[2]);
  const cssX = (position?.[1] ?? 0) * BASE_TILE;
  const cssY = (position?.[0] ?? 0) * BASE_TILE;
  const cssZ = (position?.[2] ?? 0) * BASE_TILE;
  const parts: string[] = [];
  parts.push(`translate3d(${cssX}px, ${cssY}px, ${cssZ}px)`);
  if (hasRotation) {
    if (rotation![0]) parts.push(`rotateY(${-rotation![0]}deg)`);
    if (rotation![1]) parts.push(`rotateX(${-rotation![1]}deg)`);
    if (rotation![2]) parts.push(`rotateZ(${-rotation![2]}deg)`);
  }
  if (hasScale) parts.push(`scale3d(${sx}, ${sy}, ${sz})`);
  parts.push(`translate(${-cssWidth / 2}px, ${-cssHeight / 2}px)`);
  return parts.join(" ");
}

export const PolyIframe = defineComponent({
  name: "PolyIframe",
  props: {
    src: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    allow: { type: String, default: undefined },
    sandbox: { type: String, default: undefined },
    loading: { type: String as PropType<"lazy" | "eager">, default: undefined },
    referrerpolicy: { type: String, default: undefined },
    title: { type: String, default: undefined },
    class: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props) {
    const cssW = computed(() => props.width * BASE_TILE);
    const cssH = computed(() => props.height * BASE_TILE);
    const transform = computed(() =>
      buildIframeTransform(props.position, props.rotation, props.scale, cssW.value, cssH.value),
    );
    return () => {
      const wrapperStyle: CSSProperties = {
        position: "absolute",
        left: "0",
        top: "0",
        transformOrigin: "0 0",
        transformStyle: "preserve-3d",
        transform: transform.value,
        ...(props.style ?? {}),
      };
      const iframeAttrs: Record<string, unknown> = {
        src: props.src,
        style: {
          width: `${cssW.value}px`,
          height: `${cssH.value}px`,
          border: "0",
          display: "block",
          background: "#000",
        },
      };
      if (props.allow) iframeAttrs.allow = props.allow;
      if (props.sandbox) iframeAttrs.sandbox = props.sandbox;
      if (props.loading) iframeAttrs.loading = props.loading;
      if (props.referrerpolicy) iframeAttrs.referrerpolicy = props.referrerpolicy;
      if (props.title) iframeAttrs.title = props.title;
      return h(
        "div",
        {
          class: props.class ? `polycss-iframe ${props.class}` : "polycss-iframe",
          style: wrapperStyle,
        },
        [h("iframe", iframeAttrs)],
      );
    };
  },
});
