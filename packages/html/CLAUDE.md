# @layoutit/voxcss (HTML renderer)

CSS-based voxel rendering engine for the browser. Renders 3D voxel scenes using DOM elements and CSS 3D transforms. Depends on `@layoutit/voxcss-core` for all math/data.

## Structure

```
src/
  index.ts              # Barrel re-exports (core types + html exports)
  headless.ts           # Framework-free imperative API
  styles.ts             # Base CSS stylesheet injection
  renderer/
    domRenderer.ts      # Main DOM renderer (creates/updates DOM tree)
    sliceRenderer.ts    # Volumetric "3D merge" DOM renderer
  shapes/
    index.ts            # Shape renderer re-exports
    cube.ts             # Cube shape renderer
    ramp.ts             # Sloped ramp shape
    wedge.ts            # Wedge (two-slope) shape
    spike.ts            # Spike (pointed) shape
    shapeUtils.ts       # Shared shape helpers (SVG, orientation)
  bindings/
    sceneBindings.ts    # Scene DOM mounting + update loop
    domBindings.ts      # Camera DOM mounting + pointer events
tests/
  e2e/                  # End-to-end render tests (Layer 1)
```

## Key Rules

- Imports from core use the `@voxcss-core/` alias (e.g., `@voxcss-core/types`).
- Within-package imports use relative paths.
- DOM structure: camera > scene > floor > layers > voxels > cube > faces.
- Each visible face = 1 DOM element. Visibility culling comes from core.
- CSS custom properties control grid dimensions and layer elevation.

## Testing

Tests co-located next to source files. E2E tests in `tests/e2e/` import from the barrel `src/index.ts`. Run from root:

```bash
npx vitest run --reporter=verbose
```
