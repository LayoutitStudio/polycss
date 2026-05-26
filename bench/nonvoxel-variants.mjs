export const NONVOXEL_VARIANTS = [
  {
    id: "baseline",
    label: "Baseline",
    params: {},
    hypothesis: "Current vanilla JS scene-root rotation.",
  },
  {
    id: "camera-perspective-none",
    label: "Camera Perspective None",
    params: { cameraPerspective: "none" },
    hypothesis: "Use true orthographic perspective on the camera wrapper instead of the large finite stand-in.",
  },
  {
    id: "css-keyframes",
    label: "CSS Keyframes",
    params: { rotationDriver: "css-keyframes" },
    hypothesis: "Active declarative transform animation may skip PAC during auto-rotate.",
  },
  {
    id: "order-depth",
    label: "Initial Depth Order",
    params: { domOrder: "initial-depth" },
    hypothesis: "One-time depth locality may reduce compositor sort pressure.",
  },
  {
    id: "order-tile4",
    label: "Tile4 Screen Order",
    params: { domOrder: "tile4-screen" },
    hypothesis: "Voxel tile-order lesson may transfer to static non-voxel polygon order.",
  },
  {
    id: "order-area",
    label: "Area Desc Order",
    params: { domOrder: "area-desc" },
    hypothesis: "Large projected primitives grouped earlier may improve overlap cadence.",
  },
  {
    id: "no-border-shape",
    label: "No Border Shape",
    params: { disableStrategies: "i" },
    hypothesis: "Force irregular solids to atlas slices instead of border-shape leaves.",
  },
  {
    id: "no-stable-tri",
    label: "No Stable Triangles",
    params: { disableStrategies: "u" },
    hypothesis: "Avoid CSS border-triangle compositing for solid triangles.",
  },
  {
    id: "no-stable-tri-no-border-shape",
    label: "No Stable Triangles + No Border Shape",
    params: { disableStrategies: "u,i" },
    hypothesis: "Keep cheap quads, but force triangles and irregular solids to atlas slices.",
  },
  {
    id: "force-atlas",
    label: "Force Atlas",
    params: { disableStrategies: "b,i,u" },
    hypothesis: "Fewer CSS shape strategies may beat extra atlas memory for rotation.",
  },
  {
    id: "no-will-change",
    label: "No Scene Will-Change",
    params: { sceneTransformMode: "no-will-change" },
    hypothesis: "Confirm voxel result that root will-change is not the missing path.",
  },
  {
    id: "leaf-buckets-64",
    label: "Leaf Buckets 64",
    params: { leafBucketSize: "64" },
    hypothesis: "Wrap baked leaves into fixed-size preserve-3D subtrees without changing leaf order.",
  },
  {
    id: "leaf-buckets-128",
    label: "Leaf Buckets 128",
    params: { leafBucketSize: "128" },
    hypothesis: "Test a coarser fixed-size baked subtree shape.",
  },
  {
    id: "leaf-buckets-256",
    label: "Leaf Buckets 256",
    params: { leafBucketSize: "256" },
    hypothesis: "Test a low-wrapper baked subtree shape.",
  },
  {
    id: "island-connected-128",
    label: "Connected Islands 128",
    params: { islandBucket: "brush-connected-spatial", islandBucketSize: "128" },
    hypothesis: "Split the mesh into brush-aware connected/spatial preserve-3D subtrees.",
  },
  {
    id: "island-connected-surface-128",
    label: "Connected Island Surfaces 128",
    params: { islandBucket: "brush-connected-spatial", islandBucketSize: "128", islandBucketSurface: "opacity" },
    hypothesis: "Force connected/spatial islands into render surfaces to reduce global 3D BSP pressure.",
  },
  {
    id: "island-spatial-surface-128",
    label: "Spatial Island Surfaces 128",
    params: { islandBucket: "brush-spatial", islandBucketSize: "128", islandBucketSurface: "opacity" },
    hypothesis: "Use brush-aware spatial render surfaces without connected-component detection.",
  },
  {
    id: "display-cull-negative",
    label: "Display Cull Negative Normals",
    params: { displayCull: "normal-negative" },
    hypothesis: "Actually unmount camera-backfacing leaves before Chromium builds draw quads.",
  },
  {
    id: "display-cull-positive",
    label: "Display Cull Positive Normals",
    params: { displayCull: "normal-positive" },
    hypothesis: "Opposite winding probe for display-based camera-facing leaf culling.",
  },
  {
    id: "normal-bucket-cull-positive",
    label: "Normal Bucket Cull Positive",
    params: { displayCull: "normal-bucket-positive", displayCullDecimals: "1" },
    hypothesis: "Cull camera-backfacing same-normal wrappers instead of mutating each leaf.",
  },
  {
    id: "normal-bucket-cull-d0",
    label: "Normal Bucket Cull D0",
    params: { displayCull: "normal-bucket-positive", displayCullDecimals: "0" },
    hypothesis: "Coarser normal culling with fewer wrappers.",
  },
  {
    id: "normal-bucket-cull-d1-min4",
    label: "Normal Bucket Cull D1 Min4",
    params: { displayCull: "normal-bucket-positive", displayCullDecimals: "1", displayCullMinBucketSize: "4" },
    hypothesis: "Skip tiny normal buckets to reduce wrapper churn.",
  },
  {
    id: "normal-bucket-cull-d1-min8",
    label: "Normal Bucket Cull D1 Min8",
    params: { displayCull: "normal-bucket-positive", displayCullDecimals: "1", displayCullMinBucketSize: "8" },
    hypothesis: "Cull only larger normal buckets.",
  },
  {
    id: "normal-bucket-cull-d1-min16",
    label: "Normal Bucket Cull D1 Min16",
    params: { displayCull: "normal-bucket-positive", displayCullDecimals: "1", displayCullMinBucketSize: "16" },
    hypothesis: "Cull only high-value normal buckets.",
  },
  {
    id: "scene-matrix3d",
    label: "Scene Matrix3d",
    params: { sceneTransformMode: "matrix3d" },
    hypothesis: "Use explicit matrix3d() on the scene root instead of transform functions.",
  },
  {
    id: "scene-split-target",
    label: "Split Target",
    params: { sceneTransformMode: "split-target" },
    hypothesis: "Split translate3d target compensation onto an inner shell.",
  },
  {
    id: "scene-host-perspective",
    label: "Host Perspective",
    params: { sceneTransformMode: "host-perspective" },
    hypothesis: "Move perspective off the scene root and onto the host.",
  },
  {
    id: "scene-transform-perspective",
    label: "Transform Perspective",
    params: { sceneTransformMode: "transform-perspective" },
    hypothesis: "Encode perspective in transform instead of the perspective property.",
  },
];

export function knownNonVoxelVariantIds() {
  return NONVOXEL_VARIANTS.map((variant) => variant.id);
}

export function getNonVoxelVariant(id) {
  return NONVOXEL_VARIANTS.find((variant) => variant.id === id);
}

export function getNonVoxelVariantParams(id) {
  return getNonVoxelVariant(id)?.params;
}
