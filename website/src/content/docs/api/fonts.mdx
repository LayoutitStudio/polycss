---
title: Fonts API
description: TypeScript API for turning TrueType fonts and text into PolyCSS polygon meshes.
---

`@layoutit/polycss-fonts` turns font outlines and text strings into plain `Polygon[]` meshes. The pure path (`parseFont`, `textPolygons`, `composeText`) has no browser globals; browser helpers handle Google font loading and canvas-backed fill textures.

## `parseFont(data, defaultCurveSteps?)`

Parses an uncompressed TrueType font (`.ttf`, `glyf` outlines) into a `ParsedFont`.

```ts
import { parseFont } from "@layoutit/polycss-fonts";

const bytes = await fetch("/fonts/display.ttf").then((r) => r.arrayBuffer());
const font = parseFont(bytes);
```

Unsupported formats throw clear errors: CFF/OpenType (`.otf`) and `woff` / `woff2` wrappers are not unpacked.

```ts
interface FontGlyph {
  contours: Vec2[][];
  advanceWidth: number;
}

interface ParsedFont {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  lineGap: number;
  glyph(codePoint: number, curveSteps?: number): FontGlyph;
}
```

## `textPolygons(font, text, options?)`

Extrudes a single line of text into a PolyCSS mesh.

```ts
import { textPolygons } from "@layoutit/polycss-fonts";

const polygons = textPolygons(font, "PolyCSS", {
  size: 100,
  depth: 24,
  profile: "bevel",
  color: "#ffd166",
  sideColor: "#b7791f",
});
```

```ts
interface TextPolygonsOptions {
  size?: number;
  depth?: number;
  curveSteps?: number;
  letterSpacing?: number;
  color?: string;
  sideColor?: string;
  profile?: "flat" | "round" | "bevel" | "custom";
  profileSegments?: number;
}
```

## `composeText(font, text, options?)`

Composes styled, multi-line WordArt-style text. It adds alignment, line height, underline/strike bars, envelope warps, custom profiles, face materials, and optional outlines.

```ts
import { composeText, resolveFace } from "@layoutit/polycss-fonts";

const polygons = composeText(font, "Poly\nCSS", {
  size: 90,
  depth: 28,
  align: "center",
  lineHeight: 1.1,
  warp: { shape: "arch", amount: 0.4 },
  profile: { edge: "round", raised: true },
  faces: {
    front: resolveFace({ kind: "gradient", from: "#fef08a", to: "#f97316" }),
    sides: { color: "#92400e" },
    back: { color: "#451a03", offset: [8, -8] },
  },
  outline: { color: "#111827", width: 4 },
});
```

```ts
type WarpShape =
  | "none"
  | "arch"
  | "archDown"
  | "arc"
  | "wave"
  | "bulge"
  | "cone"
  | "slantUp"
  | "slantDown";

interface WarpOptions {
  shape: WarpShape;
  amount?: number;
}

interface Face {
  color?: string;
  texture?: string;
  tile?: number;
}

interface BackFace extends Face {
  offset?: [number, number];
}

interface FaceStop extends Face {
  at: number;
}

type Profile =
  | "flat"
  | { edge: "bevel" | "round"; raised?: boolean; segments?: number }
  | { curve: CubicBezier; segments?: number };
```

## Fills

`composeText` stays pure by accepting already-resolved face textures. Browser helpers convert higher-level fill specs into `Face` objects.

```ts
import { makeFillTexture, resolveFace } from "@layoutit/polycss-fonts";

const gradientUrl = makeFillTexture({
  type: "gradient",
  from: "#22d3ee",
  to: "#2563eb",
  angle: 90,
});

const face = resolveFace({
  kind: "texture",
  color: "#ffffff",
  url: "/textures/bricks.svg",
  tile: 24,
});
```

```ts
type FillSpec =
  | { type: "solid" }
  | { type: "gradient"; from: string; to: string; angle?: number }
  | { type: "rainbow"; angle?: number }
  | { type: "image"; src: string };

type FaceFillSpec =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; color?: string; from: string; to: string; angle?: number }
  | { kind: "rainbow"; color?: string; angle?: number }
  | { kind: "texture"; color?: string; url: string; tile?: number }
  | { kind: "image"; color?: string; src: string };
```

## Google Font Helpers

These browser helpers use the Fontsource API/CDN to fetch plain `.ttf` files with open CORS.

```ts
import {
  listGoogleFonts,
  pickWeight,
  googleFontUrl,
  loadFont,
  loadGoogleFont,
} from "@layoutit/polycss-fonts";

const fonts = await listGoogleFonts();
const entry = fonts.find((font) => font.family === "Bungee")!;
const weight = pickWeight(entry, 700);
const url = googleFontUrl(entry, weight);
const font = await loadGoogleFont(entry, weight);
const sameFont = await loadFont(url);
```

```ts
interface FontEntry {
  id: string;
  family: string;
  weights: number[];
  styles: string[];
  subsets: string[];
  defSubset: string;
  category: string;
  type: string;
}

type FontStyle = "normal" | "italic";
```

## Utility Exports

`cssCubicBezier([x1, y1, x2, y2])` returns an easing function for custom edge profiles. Related exported types are `CubicBezier`, `ExtrudeProfile`, `MaterialStop`, `ComposeTextOptions`, `Profile`, `Face`, `BackFace`, `FaceStop`, `WarpShape`, `WarpOptions`, `FillSpec`, `FaceFillSpec`, `ParsedFont`, `FontGlyph`, `TextPolygonsOptions`, `FontEntry`, and `FontStyle`.
