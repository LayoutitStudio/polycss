// Thin re-export barrel — all implementation has moved to ./atlas/
export {
  borderShapeSupported,
  solidTriangleSupported,
  cornerShapeSupported,
  cornerTriangleSupported,
  projectiveQuadSupported,
  getSolidPaintDefaultsForPlans,
  getSolidPaintDefaultsFromPlans,
  isBorderShapeSupported,
  isSolidTriangleSupported,
} from "./atlas/detection";

export { filterAtlasPlans } from "./atlas/filterPlans";

export { isMobileDocument, packTextureAtlasPlansWithScale } from "./atlas/packing";

export {
  TEXTURE_IMAGE_CACHE,
  loadTextureImage,
  setCssTransform,
  applyTextureTint,
  drawImageCover,
  drawImageUvSample,
  tracePolygonPath,
  traceOffsetPolygonPath,
  paintSolidAtlasEntry,
  drawTexturedAtlasEntry,
  repairTextureEdgeAlpha,
  canvasToUrl,
  buildAtlasPages,
} from "./atlas/buildAtlasPages";
