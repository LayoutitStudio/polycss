export const NONVOXEL_VARIANTS = [
  {
    id: "baseline",
    label: "Baseline",
    params: {},
    hypothesis: "Current vanilla JS scene-root rotation.",
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
