/**
 * Browser-only helpers that paint a WordArt "master fill" onto a `<canvas>` and
 * return it as a data URL. `composeText` then UV-maps the whole word's front
 * face to this single texture, so a gradient / rainbow / image flows
 * continuously across every glyph (not per-letter).
 *
 * Pure-layer code (`composeText`, `extrudeContours`) never imports this — it
 * only receives the resulting string — so the Node-testable path stays free of
 * browser globals.
 */

/** A WordArt face fill. `solid` means "no texture, use the flat color". */
export type FillSpec =
  | { type: "solid" }
  | { type: "gradient"; from: string; to: string; angle?: number }
  | { type: "rainbow"; angle?: number }
  | { type: "image"; src: string };

const RAINBOW = [
  "#ff3b30", "#ff9500", "#ffcc00", "#34c759",
  "#00c7be", "#007aff", "#5856d6", "#af52de",
];

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/**
 * Paint a linear gradient covering the whole canvas at `angleDeg` (measured
 * CCW from +x in word space, so 90° points up). Canvas y is down while word v
 * is up, so the direction's y is negated.
 */
function paintLinear(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  angleDeg: number,
  stops: Array<[number, string]>,
): void {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = -Math.sin(a);
  const cx = w / 2;
  const cy = h / 2;
  const half = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
  const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Build the master fill texture for a face. Returns a data URL, or `undefined`
 * for `solid` (no texture). For `image`, the source is returned as-is — the
 * renderer can use any `background-image` URL directly.
 */
export function makeFillTexture(spec: FillSpec): string | undefined {
  if (spec.type === "solid") return undefined;
  if (spec.type === "image") return spec.src || undefined;

  const size = 256;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  if (spec.type === "rainbow") {
    const angle = spec.angle ?? 0;
    const stops = RAINBOW.map((c, i): [number, string] => [i / (RAINBOW.length - 1), c]);
    paintLinear(ctx, size, size, angle, stops);
  } else {
    // Default 270° = straight down, so `from` is at the top of the word.
    const angle = spec.angle ?? 270;
    paintLinear(ctx, size, size, angle, [[0, spec.from], [1, spec.to]]);
  }

  return canvas.toDataURL("image/png");
}
