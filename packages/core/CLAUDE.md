# @layoutit/voxcss-core

Pure-math voxel rendering engine. **Zero browser globals** — no `document`, `window`, `getComputedStyle`, `requestAnimationFrame`, `Blob`, `Image`, `HTMLElement`, `Element`, `Option`.

## Structure

```
src/
  types.ts              # All shared type definitions and constants
  index.ts              # Barrel re-exports
  scene/
    context.ts          # Grid computation, voxel lookups, wall mask
    visibility.ts       # Face occlusion culling
  camera/
    camera.ts           # Isometric camera state machine
  color/
    color.ts            # Pure hex/rgb color parsing (no DOM)
    lighting.ts         # Directional lighting, face shading
    faceAppearance.ts   # Per-face color/texture resolution
  merge/
    mergeVoxels.ts      # 2D voxel merge algorithm
    mergeVoxelsOption.ts # Merge option normalization
    slicePlanner.ts     # 3D slice planning (face buffers, brush rects)
  parser/
    parseMagicaVoxel.ts # .vox binary file parser
  encoding/
    png.ts              # Zero-dependency PNG encoder
  controller/
    sceneController.ts  # Central state manager (camera + scene)
```

## Key Rules

- **No browser globals.** ESLint enforces `no-restricted-globals` for DOM APIs.
- All color parsing uses `parsePureColor()` from `color/color.ts` (regex-based hex/rgb).
- Coordinates: `x` = row, `y` = column, `z` = layer. Ranges are half-open: `[x, x2)`.
- Tile size is always 50px (`BASE_TILE`). Colors default to `#cccccc`.

## Testing

Tests are co-located next to source files. Run from root:

```bash
npx vitest run --reporter=verbose
```

## Cross-Package Imports

HTML package imports from core using the `@voxcss-core/` path alias:
```ts
import { Voxel } from "@voxcss-core/types";
import { buildSceneContext } from "@voxcss-core/scene/context";
```
