// @layoutit/polycss-fonts — fonts + text → extruded 3D Polygon[] for PolyCSS.
//
// Two layers:
//   pure    — parseFont(bytes), textPolygons(font, text, config). No browser
//             globals; runs anywhere, returns plain Polygon[].
//   browser — listGoogleFonts(), googleFontUrl(), loadFont(url),
//             loadGoogleFont(). The only part that uses fetch.

export { parseFont } from "./parseFont";
export type { ParsedFont, FontGlyph } from "./parseFont";

export { textPolygons } from "./textPolygons";
export type { TextPolygonsOptions } from "./textPolygons";
export type { ExtrudeProfile } from "./extrude";

export { composeText } from "./composeText";
export type { ComposeTextOptions, WarpShape, WarpOptions } from "./composeText";

export {
  listGoogleFonts,
  pickWeight,
  googleFontUrl,
  loadFont,
  loadGoogleFont,
} from "./googleFonts";
export type { FontEntry, FontStyle } from "./googleFonts";
