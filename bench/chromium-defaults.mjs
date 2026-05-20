export const BENCH_GPU_CHROMIUM_ARGS = [
  ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
  "--enable-gpu-rasterization",
];

export function chromiumArgsWithGpuDefault(extraArgs = [], { softwareBackend = false } = {}) {
  return [
    ...(softwareBackend ? [] : BENCH_GPU_CHROMIUM_ARGS),
    ...extraArgs,
  ];
}
