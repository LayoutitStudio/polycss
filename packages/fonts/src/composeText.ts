/**
 * Compose styled, multi-line text into a 3D polygon mesh.
 *
 * Builds on the same type-plane → extrude pipeline as `textPolygons`, adding
 * line breaks (`\n`), per-line alignment, line height, underline /
 * strikethrough bars, and classic WordArt-style **warps** (arch / arc / wave /
 * bulge / slant). The warp deforms every point in the flat type plane before
 * extrusion, so the 3D walls follow the curve too. Bold/italic are chosen by
 * the caller by passing the appropriate weight/style `ParsedFont`.
 */
import { mergePolygons, type Polygon } from "@layoutit/polycss-core";
import type { ParsedFont } from "./parseFont";
import {
  dedupeContour,
  extrudeContours,
  groupShapes,
  shade,
  simplifyContour,
  type Contour,
  type Pt,
  type Shape,
} from "./extrude";
import type { TextPolygonsOptions } from "./textPolygons";

/** Classic WordArt envelope shapes. */
export type WarpShape =
  | "none"
  | "arch"
  | "archDown"
  | "arc"
  | "wave"
  | "bulge"
  | "cone"
  | "slantUp"
  | "slantDown";

export interface WarpOptions {
  shape: WarpShape;
  /** Warp strength, 0..1. Defaults to 0.5. */
  amount?: number;
}

export interface ComposeTextOptions extends TextPolygonsOptions {
  /** Line advance as a multiple of `size`. Defaults to 1.25. */
  lineHeight?: number;
  /** Horizontal alignment of each line within the block. Defaults to "center". */
  align?: "left" | "center" | "right";
  /** Horizontal glyph scale (Photoshop ↔). Defaults to 1. */
  scaleX?: number;
  /** Vertical glyph scale (Photoshop ↕). Defaults to 1. */
  scaleY?: number;
  /** Draw an underline bar under each line. */
  underline?: boolean;
  /** Draw a strikethrough bar across each line. */
  strike?: boolean;
  /** WordArt envelope warp applied to the whole block. */
  warp?: WarpOptions;
  /**
   * Outline simplification tolerance in world units (0 = exact). Drops points
   * within this distance of their neighbours — fewer polygons, blockier glyphs.
   */
  simplify?: number;
  /**
   * Merge coplanar same-color adjacent triangles into larger convex polygons
   * (fewer DOM elements). Collapses the triangulated caps; ~⅓ fewer polygons
   * on flat text. Has a CPU cost, so it's off by default.
   */
  merge?: boolean;
  /** Back cap color. Set differently from `color` for a layered look. */
  backColor?: string;
  /**
   * Oblique shift of the back relative to the front ([rightward, upward], world
   * units). Non-zero + a distinct `backColor` gives the retro front-A / back-B
   * leaning block.
   */
  oblique?: [number, number];
}

type WarpFn = (p: Pt) => Pt;

export function composeText(font: ParsedFont, text: string, options: ComposeTextOptions = {}): Polygon[] {
  const size = options.size ?? 100;
  const depth = options.depth ?? size * 0.2;
  const curveSteps = Math.max(1, Math.round(options.curveSteps ?? 6));
  const letterSpacing = options.letterSpacing ?? 0;
  const color = options.color ?? "#d4a82a";
  const sideColor = options.sideColor ?? shade(color, 0.72);
  const profile = options.profile ?? "flat";
  const profileSegments = Math.max(1, Math.round(options.profileSegments ?? 6));
  const lineHeight = (options.lineHeight ?? 1.25) * size;
  const align = options.align ?? "center";
  const simplify = Math.max(0, options.simplify ?? 0);
  const scaleX = options.scaleX ?? 1;
  const scaleY = options.scaleY ?? 1;

  const scale = size / font.unitsPerEm;
  const barThickness = size * 0.06;
  const underlineY = -size * 0.14;
  const strikeY = size * 0.26;

  const lines = text.split("\n");
  const measured = lines.map((line) => {
    const glyphs = [...line].map((ch) => font.glyph(ch.codePointAt(0) ?? 0, curveSteps));
    let width = 0;
    for (const g of glyphs) width += g.advanceWidth * scale * scaleX + letterSpacing;
    width = Math.max(0, width - letterSpacing);
    return { glyphs, width };
  });
  const blockWidth = Math.max(1, ...measured.map((m) => m.width));
  const n = measured.length;

  const warp = makeWarp(options.warp, -blockWidth / 2, blockWidth, size);
  const shapes: Shape[] = [];

  measured.forEach((line, lineIndex) => {
    const baselineY = ((n - 1) / 2 - lineIndex) * lineHeight - size * 0.34;
    let startX = -blockWidth / 2;
    if (align === "center") startX += (blockWidth - line.width) / 2;
    else if (align === "right") startX += blockWidth - line.width;

    let cursor = startX;
    for (const g of line.glyphs) {
      if (g.contours.length) {
        const placed = g.contours.map((c) =>
          dedupeContour(c.map(([x, y]): Pt => [x * scale * scaleX + cursor, y * scale * scaleY + baselineY])),
        );
        // Group on the accurate contours, then simplify — but ONLY glyphs with
        // no holes. Simplifying a holed glyph (P, o, e, a…) can move the outer
        // enough that the counter collapses or the offset cap overruns it,
        // filling the hole. Holed glyphs stay full-detail so holes never break.
        for (const shape of groupShapes(placed)) {
          const simplified: Shape = simplify > 0 && shape.holes.length === 0
            ? { outer: simplifyContour(shape.outer, simplify), holes: shape.holes }
            : shape;
          shapes.push(warpShape(simplified, warp));
        }
      }
      cursor += g.advanceWidth * scale * scaleX + letterSpacing;
    }

    if (line.width > 0) {
      const x0 = startX;
      const x1 = startX + line.width;
      if (options.underline) {
        shapes.push(warpShape(barShape(x0, x1, baselineY + underlineY - barThickness, baselineY + underlineY), warp));
      }
      if (options.strike) {
        shapes.push(warpShape(barShape(x0, x1, baselineY + strikeY - barThickness / 2, baselineY + strikeY + barThickness / 2), warp));
      }
    }
  });

  const polygons = extrudeContours(shapes, {
    depth,
    profile,
    profileSegments,
    maxInset: size * 0.045,
    color,
    sideColor,
    backColor: options.backColor,
    oblique: options.oblique,
  });
  return options.merge ? mergePolygons(polygons) : polygons;
}

function warpShape(shape: Shape, warp: WarpFn | null): Shape {
  if (!warp) return shape;
  return { outer: shape.outer.map(warp), holes: shape.holes.map((h) => h.map(warp)) };
}

/** A subdivided bar rectangle so decoration bars can curve under a warp. */
function barShape(x0: number, x1: number, yBot: number, yTop: number, segs = 24): Shape {
  const outer: Contour = [];
  for (let i = 0; i <= segs; i++) outer.push([x0 + ((x1 - x0) * i) / segs, yBot]);
  for (let i = segs; i >= 0; i--) outer.push([x0 + ((x1 - x0) * i) / segs, yTop]);
  return { outer, holes: [] };
}

/**
 * Build a point-warp for the type plane. `u` is the normalized position along
 * the block (0 at left, 1 at right); most shapes offset or scale y by a
 * function of u, while "arc" wraps the baseline around a circle (rotating the
 * letters with it). Returns null for "none".
 */
function makeWarp(opts: WarpOptions | undefined, left: number, width: number, size: number): WarpFn | null {
  if (!opts || opts.shape === "none") return null;
  const k = Math.max(0, Math.min(1, opts.amount ?? 0.5));
  if (k === 0) return null;
  const u = (x: number) => (x - left) / width;
  const bump = (t: number) => 1 - (2 * t - 1) * (2 * t - 1); // 0 at ends, 1 at center

  switch (opts.shape) {
    case "arch":
      return (p) => [p[0], p[1] + k * size * 0.7 * bump(u(p[0]))];
    case "archDown":
      return (p) => [p[0], p[1] - k * size * 0.7 * bump(u(p[0]))];
    case "wave":
      return (p) => [p[0], p[1] + k * size * 0.4 * Math.sin(2 * Math.PI * u(p[0]))];
    case "bulge":
      return (p) => [p[0], p[1] * (1 + k * bump(u(p[0])))];
    case "cone":
      return (p) => [p[0], p[1] * (1 - k * 0.75 * u(p[0]))];
    case "slantUp":
      return (p) => [p[0], p[1] + k * size * 0.6 * (u(p[0]) - 0.5)];
    case "slantDown":
      return (p) => [p[0], p[1] - k * size * 0.6 * (u(p[0]) - 0.5)];
    case "arc": {
      const span = Math.max(0.08, k) * Math.PI; // up to 180°
      const r = width / span;
      const cx = left + width / 2;
      return (p) => {
        const theta = (u(p[0]) - 0.5) * span;
        const rad = r + p[1];
        return [cx + rad * Math.sin(theta), -r + rad * Math.cos(theta)];
      };
    }
    default:
      return null;
  }
}
