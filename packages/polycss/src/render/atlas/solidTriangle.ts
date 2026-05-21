// All exports from this module have moved to core — re-exported here for
// backwards-compatibility with polycss-internal callers.
export {
  cssPoints,
  computeSurfaceNormal,
  isConvexPolygonPoints,
  signedArea2D,
  intersect2DLines,
  intersect2DLinesRaw,
  expandClipPoints,
  offsetConvexPolygonPoints,
  offsetTrianglePoints,
  offsetStableTrianglePoints,
  stableBasisFromPlan,
  stableTriangleMatrixDecimals,
} from "@layoutit/polycss-core";
