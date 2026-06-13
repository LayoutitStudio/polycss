import {
  filterAtlasPlans as filterAtlasPlansCore,
} from "@layoutit/polycss-core";
import type {
  TextureAtlasPlan,
  PolyRenderStrategy,
  PolyTextureBackend,
  PolyTextureImageRendering,
  PolyTextureProjection,
} from "@layoutit/polycss-core";
import type { PolyTextureLightingMode } from "@layoutit/polycss-core";
import { cornerShapeSupported, isBorderShapeSupported, isSolidTriangleSupported } from "./detection";
import { projectiveQuadSupported } from "./detection";

/**
 * Filter a plan array to the subset that needs atlas packing, given the active
 * render strategies and texture-lighting mode. Plans excluded from the atlas
 * will be rendered via `<b>`, `<i>`, or `<u>` by the framework components.
 */
export function filterAtlasPlans(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  disabled: ReadonlySet<PolyRenderStrategy>,
  doc?: Document | null,
  textureBackend?: PolyTextureBackend,
  textureImageRendering?: PolyTextureImageRendering,
  textureProjection?: PolyTextureProjection,
): Array<TextureAtlasPlan | null> {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  return filterAtlasPlansCore(plans, textureLighting, disabled, {
    solidTriangleSupported: isSolidTriangleSupported(doc),
    projectiveQuadSupported: doc ? projectiveQuadSupported(doc) : true,
    borderShapeSupported: isBorderShapeSupported(doc),
    cornerShapeSupported: d ? cornerShapeSupported(d) : false,
    textureBackend,
    textureImageRendering,
    textureProjection,
  });
}
