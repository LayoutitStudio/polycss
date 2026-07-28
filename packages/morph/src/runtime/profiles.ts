import type { PolyMorphProfile } from "../contracts/index.js";

export const POLY_MORPH_EXECUTABLE_PROFILES = Object.freeze([
  "joint-skin",
  "morph-regions",
  "prepared-playback",
  "static-prepared",
] as const satisfies readonly PolyMorphProfile[]);
