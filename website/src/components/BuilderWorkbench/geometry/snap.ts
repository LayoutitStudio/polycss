export function resolveGridStep(gridResolution: number, fallback = 10): number {
  return Number.isFinite(gridResolution) && gridResolution > 0 ? gridResolution : fallback;
}

export function worldToGridCell(worldX: number, worldY: number, gridResolution: number): [number, number] {
  const step = resolveGridStep(gridResolution);
  return [Math.floor(worldX / step), Math.floor(worldY / step)];
}

export function gridCellCenter(cellX: number, cellY: number, gridResolution: number): [number, number] {
  const step = resolveGridStep(gridResolution);
  return [cellX * step + step / 2, cellY * step + step / 2];
}

export function snapWorldToCellCenter(
  worldX: number,
  worldY: number,
  gridResolution: number,
): [number, number] {
  const [cellX, cellY] = worldToGridCell(worldX, worldY, gridResolution);
  return gridCellCenter(cellX, cellY, gridResolution);
}
