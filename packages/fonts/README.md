# @layoutit/polycss-fonts

Turn **fonts + text into extruded 3D polygon meshes** for [PolyCSS](https://github.com/LayoutitStudio/polycss). Framework-agnostic: it returns plain `Polygon[]`, so the same call works in the vanilla, React, and Vue renderers — no per-framework wrappers.

```bash
pnpm add @layoutit/polycss-fonts @layoutit/polycss
```

```ts
import { loadGoogleFont, textPolygons } from "@layoutit/polycss-fonts";
import { createPolyScene, createPolyOrthographicCamera } from "@layoutit/polycss";

const font = await loadGoogleFont({ /* FontEntry from listGoogleFonts() */ }, 700);
const polygons = textPolygons(font, "Hello", { depth: 24, profile: "bevel" });

const scene = createPolyScene(host, { camera: createPolyOrthographicCamera({ rotX: 28, zoom: 0.06 }) });
scene.add({ polygons, objectUrls: [], warnings: [], dispose() {} });
```

## Two layers

**Pure** (no browser globals — runs in Node too):

- `parseFont(bytes)` → `ParsedFont` — a small, dependency-free TrueType (`glyf`) reader: sfnt tables → glyph outlines + advance widths.
- `textPolygons(font, text, options)` → `Polygon[]` — triangulates caps (holes included), builds the depth profile, extrudes, and lays glyphs out by advance width.
- `composeText(font, text, options)` → `Polygon[]` — the full WordArt composer on top of `textPolygons`: multi-line text, alignment, line height, glyph scale, underline / strike bars, envelope warps, and a layered two-color look.

**Browser** (uses `fetch`):

- `listGoogleFonts()` → every Google font (via the Fontsource API).
- `googleFontUrl(entry, weight)` / `loadFont(url)` / `loadGoogleFont(entry, weight)`.

## `textPolygons` options

| Option | Default | Notes |
|---|---|---|
| `size` | `100` | Cap-em size in world units. |
| `depth` | `size * 0.2` | Extrusion depth along world Z. |
| `profile` | `"flat"` | `"flat"` slab · `"round"` bullnose · `"bevel"` chamfered edge. |
| `curveSteps` | `6` | Bézier flattening — higher is smoother, more polygons. |
| `letterSpacing` | `0` | Extra space between glyphs. |
| `color` / `sideColor` | gold | Cap and wall colors (sideColor defaults to a darker shade). |
| `profileSegments` | `6` | Ring count for round/bevel edges. |

## `composeText` — WordArt composer

`composeText` accepts every `textPolygons` option plus the layout, decoration, and warp controls below. `\n` in `text` starts a new line.

```ts
import { composeText } from "@layoutit/polycss-fonts";

const polygons = composeText(font, "Poly\nCSS", {
  size: 100,
  depth: 24,
  align: "center",
  warp: { shape: "arch", amount: 0.6 },
  backColor: "#3a86ff",          // layered: distinct back-cap color…
  oblique: [14, -14],            // …shifted for the retro front-A / back-B leaning block
});
```

| Option | Default | Notes |
|---|---|---|
| `lineHeight` | `1.25` | Line advance as a multiple of `size`. |
| `align` | `"center"` | `"left"` · `"center"` · `"right"`. |
| `scaleX` / `scaleY` | `1` | Horizontal / vertical glyph scale (Photoshop ↔ / ↕). |
| `underline` / `strike` | `false` | Decoration bars; they follow the active warp. |
| `warp` | — | `{ shape, amount }`. `shape`: `none`, `arch`, `archDown`, `arc`, `wave`, `bulge`, `cone`, `slantUp`, `slantDown`. `amount` is `0..1`. |
| `simplify` | `0` | Outline simplification tolerance (world units). Hole-less glyphs only — holed glyphs (`O`, `P`, `a`…) stay full-detail so counters never collapse. |
| `merge` | `false` | Merge coplanar same-color cap triangles into larger polygons (~⅓ fewer DOM nodes). Has a CPU cost, so off by default. |
| `backColor` | `color` | Back-cap color — set it apart from `color` for a layered two-tone look. |
| `oblique` | `[0, 0]` | `[rightward, upward]` shift of the back cap relative to the front (world units). |
| `faceTexture` | — | Master fill (data URL / URL) UV-mapped across the whole word's front face — one shared, browser-cached texture flows over every glyph. Build it with `makeFillTexture`. |
| `outline` | — | `{ color, width }` — a colored stroke halo around the front face. |
| `layered` | `false` | Flat two-layer shadow: front face + `oblique`-offset back copy, no connecting side walls (classic WordArt drop shadow). |

## Fills — gradients, rainbow, image (`makeFillTexture`)

`makeFillTexture` (browser-only — uses `<canvas>`) paints a **`FillSpec`** to a data URL you pass as `faceTexture`. Because the face UV-maps to the whole word, the fill flows continuously across every letter, not per-glyph.

```ts
import { composeText, makeFillTexture } from "@layoutit/polycss-fonts";

const faceTexture = makeFillTexture({ type: "gradient", from: "#ffe14d", to: "#ff7a1a", angle: 270 });
const polygons = composeText(font, "WordArt", { faceTexture, profile: "bevel", depth: 22 });
```

`FillSpec` is one of:

- `{ type: "solid" }` — no texture (the face stays the flat `color`); returns `undefined`.
- `{ type: "gradient", from, to, angle? }` — two-stop linear gradient. `angle` in degrees, CCW from +x (default `270` = top→bottom).
- `{ type: "rainbow", angle? }` — full-spectrum sweep (default `0` = left→right).
- `{ type: "image", src }` — any image URL / data URL, stretched across the word.

## Scope / limitations

This is a focused reader, not a full font library:

- **TrueType (`.ttf`, `glyf`) only.** CFF/OpenType (`.otf`, "OTTO") is rejected with a clear error. Google Fonts ship TrueType, so this covers the common case.
- **Uncompressed sfnt only** — woff/woff2 are not unpacked (the Google Fonts loader fetches raw `.ttf`).
- No shaping, kerning, ligatures, or variable-font axes — each character maps to one glyph plus its advance width.
- Script fonts with heavily self-overlapping contours can leave minor triangulation artifacts.
