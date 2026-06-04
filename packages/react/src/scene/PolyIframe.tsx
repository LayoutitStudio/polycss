/**
 * <PolyIframe> — React counterpart to vanilla's <poly-iframe>. A flat
 * textured "quad" whose texture is a live document instead of an atlas
 * slice. Mounts an <iframe> inside the scene's preserve-3d context so the
 * camera transform composes naturally with surrounding polygons.
 *
 * Conventions mirror post-parity <PolyMesh>:
 *   - `position` (Vec3, world units, world-axis order)
 *   - `rotation` (Vec3, Euler degrees, world XYZ)
 *   - `scale`    (number or Vec3, defaults to 1)
 *   - `width` / `height` (numbers, world units)
 *
 * The iframe is centered at the wrapper's local origin (the trailing
 * `translate(-w/2, -h/2)` in the transform string), so rotation/scale
 * pivot at the visible center — same shape as `<PolyIcosahedron size>`
 * whose vertices straddle the origin.
 */
import type { CSSProperties, IframeHTMLAttributes } from "react";
import { BASE_TILE, type Vec3 } from "@layoutit/polycss-core";

export interface PolyIframeProps {
  /** Iframe URL — forwarded to the underlying <iframe>'s `src` attribute. */
  src: string;
  /** Width in world units (multiplied by BASE_TILE for CSS px). */
  width: number;
  /** Height in world units (multiplied by BASE_TILE for CSS px). */
  height: number;
  /** World-units position (+X right, +Y forward, +Z up). */
  position?: Vec3;
  /** World Euler XYZ in degrees. */
  rotation?: Vec3;
  /** Uniform scale (number) or per-axis Vec3. */
  scale?: number | Vec3;
  /** Forwarded to the underlying <iframe>'s `allow`. */
  allow?: string;
  /** Forwarded to the underlying <iframe>'s `sandbox`. */
  sandbox?: string;
  /** Forwarded to the underlying <iframe>'s `loading`. */
  loading?: IframeHTMLAttributes<HTMLIFrameElement>["loading"];
  /** Forwarded to the underlying <iframe>'s `referrerpolicy`. */
  referrerPolicy?: IframeHTMLAttributes<HTMLIFrameElement>["referrerPolicy"];
  /** Forwarded to the underlying <iframe>'s `title` (a11y label). */
  title?: string;
  className?: string;
  /** Style overrides on the wrapper div (NOT on the iframe). */
  style?: CSSProperties;
}

/**
 * Build the wrapper transform string. Mirrors vanilla's
 * `buildIframeTransform` exactly — world→CSS axis swap on position,
 * rotation conjugation (`rotateY(-rx) rotateX(-ry) rotateZ(-rz)` because
 * the swap reflects axes, det=-1), scale at the end. The trailing
 * `translate(-w/2, -h/2)` centers the iframe content at the wrapper's
 * local origin so rotation/scale pivot at the visible center.
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

export function PolyIframe({
  src,
  width,
  height,
  position,
  rotation,
  scale,
  allow,
  sandbox,
  loading,
  referrerPolicy,
  title,
  className,
  style,
}: PolyIframeProps) {
  const cssW = width * BASE_TILE;
  const cssH = height * BASE_TILE;
  const transform = buildIframeTransform(position, rotation, scale, cssW, cssH);
  const wrapperStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    transformOrigin: "0 0",
    transformStyle: "preserve-3d",
    transform,
    ...style,
  };
  return (
    <div
      className={`polycss-iframe${className ? ` ${className}` : ""}`}
      style={wrapperStyle}
    >
      <iframe
        src={src}
        allow={allow}
        sandbox={sandbox}
        loading={loading}
        referrerPolicy={referrerPolicy}
        title={title}
        style={{
          width: cssW,
          height: cssH,
          border: 0,
          display: "block",
          background: "#000",
        }}
      />
    </div>
  );
}
