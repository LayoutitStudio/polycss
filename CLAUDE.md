# CLAUDE.md — VoxCSS

## What is VoxCSS?

`@layoutit/voxcss` is a **CSS-based voxel rendering engine for the browser**. It renders 3D voxel scenes entirely using DOM elements and CSS 3D transforms — no WebGL, no canvas. Each voxel becomes a set of `<div>` elements with CSS transforms to position them in 3D space. The library is framework-agnostic at its core, with thin wrappers for Vue 3, React 18, and Svelte 4.

**Package:** `@layoutit/voxcss` v0.1.8
**License:** MIT
**Repository:** https://github.com/LayoutitStudio/voxcss
**Website:** https://voxcss.com

---

## Project Structure

```
voxcss/
├── src/                          # Core engine (framework-agnostic)
│   ├── index.ts                  # Public API re-exports
│   ├── core/                     # Rendering engine
│   │   ├── types.ts              # All type definitions and constants
│   │   ├── context.ts            # Scene context building + voxel lookups
│   │   ├── camera.ts             # Isometric camera state machine
│   │   ├── domRenderer.ts        # Main DOM renderer (creates/updates DOM)
│   │   ├── sliceRenderer.ts      # Volumetric "3D merge" renderer
│   │   ├── visibility.ts         # Face occlusion culling
│   │   ├── faceAppearance.ts     # Per-face color/texture resolution
│   │   ├── lighting.ts           # Directional lighting simulation
│   │   ├── styles.ts             # Base CSS stylesheet injection
│   │   ├── headless.ts           # Framework-free imperative API
│   │   ├── png.ts                # Pure-JS PNG encoder (no dependencies)
│   │   └── shapes/               # Shape renderers
│   │       ├── index.ts
│   │       ├── cube.ts           # Default cube shape
│   │       ├── ramp.ts           # Sloped ramp shape
│   │       ├── wedge.ts          # Wedge (two-slope) shape
│   │       ├── spike.ts          # Spike (pointed) shape
│   │       └── shapeUtils.ts     # Shared shape helpers (SVG slopes, orientation)
│   ├── controller/               # State management layer
│   │   ├── sceneController.ts    # Central controller (camera + scene state)
│   │   ├── sceneBindings.ts      # Scene DOM mounting + update loop
│   │   └── domBindings.ts        # Camera DOM mounting + pointer events
│   └── utils/                    # Utilities
│       ├── parseMagicaVoxel.ts   # .vox file parser
│       ├── mergeVoxels.ts        # 2D voxel merge algorithm
│       └── mergeVoxelsOption.ts  # Merge option normalization
├── react/                        # React 18 wrapper
│   ├── index.ts
│   ├── VoxCamera.tsx
│   ├── VoxScene.tsx
│   └── useBindings.ts
├── vue/                          # Vue 3 wrapper
│   ├── index.ts
│   ├── VoxCamera.ts
│   ├── VoxScene.ts
│   └── context.ts
├── svelte/                       # Svelte 4 wrapper
│   ├── index.ts / index.d.ts
│   ├── VoxCamera.svelte / .d.ts
│   ├── VoxScene.svelte / .d.ts
│   └── context.ts
├── examples/                     # Usage examples
│   ├── headless/                 # Plain JS examples
│   ├── react/
│   ├── vue/
│   └── models/                   # Sample .vox files
├── tsup.config.ts                # Build configuration
├── tsconfig.json                 # TypeScript configuration
└── package.json
```

---

## Build System

- **Bundler:** tsup (esbuild-based)
- **Output formats:** ESM (`dist/index.js`) + CJS (`dist/index.cjs`), with `.d.ts` declarations
- **Target:** ES2020
- **Entries:** 4 separate entry points: `index`, `react/index`, `vue/index`, `svelte/index`
- **External:** `vue`, `react`, `react-dom`, `svelte` are all peer dependencies (all optional)
- **Build command:** `npm run build` (runs tsup + copies Svelte files to dist)
- **Watch mode:** `npm run watch`
- **Path aliases:** `@voxcss/*` maps to `src/*` (via tsconfig `paths`)

---

## Architecture Overview

### Data Flow

```
Voxel[] (user data)
  → SceneController (state management)
    → buildSceneContext() (grid computation + layer splitting)
      → DomRenderer (DOM creation)
        → ShapeRenderer per voxel (cube/ramp/wedge/spike)
          → visibility culling → face appearance → DOM elements
```

### Key Architectural Layers

1. **Types** (`types.ts`) — Central type definitions shared everywhere
2. **Context** (`context.ts`) — Transforms raw voxel arrays into renderable structures
3. **Controller** (`sceneController.ts`) — Manages camera + scene state, emits snapshots
4. **Renderer** (`domRenderer.ts`) — Creates and updates the actual DOM tree
5. **Framework wrappers** — Thin bindings that connect the controller to framework reactivity

---

## Core Types (`src/core/types.ts`)

### Voxel

```ts
interface Voxel {
  x: number;        // Grid column (1-indexed in output)
  y: number;        // Grid row (1-indexed in output)
  z: number;        // Layer/depth index (0-indexed)
  x2?: number;      // End column for area voxels (exclusive)
  y2?: number;      // End row for area voxels (exclusive)
  z2?: number;      // End layer for tall voxels (exclusive)
  color?: string;   // CSS color (default: "#cccccc")
  texture?: string; // Image URL or texture key
  shape?: string;   // "cube" (default), "ramp", "wedge", "spike"
  data?: Record<string, unknown>; // Arbitrary user metadata
  rot?: number;     // Rotation in degrees (snapped to 90° increments)
}
```

### GridContext

The runtime context passed through the rendering pipeline:

```ts
interface GridContext {
  rows: number;              // Grid X extent
  cols: number;              // Grid Y extent
  depth: number;             // Grid Z extent (number of layers)
  tileSize: number;          // Pixel size per grid cell (always 50px = BASE_TILE)
  layerElevation: number;    // Z height per layer (50px cubic, 25px dimetric)
  projection?: "cubic" | "dimetric";
  walls: WallsMask;          // Which boundary faces are hidden
  offsets: OffsetMap;         // Neighbor offset vectors for each face
  showWalls: boolean;
  showFloor: boolean;
  rotX?: number;
  rotY?: number;
  wallColor: string;         // Default: "#3e3e4d"
  getVoxel(x, y, z): Voxel | null;   // O(1) lookup in flat arrays
  resolveTexture?(name, face): string | undefined;
  lighting?(voxel, face): Partial<CSSStyleDeclaration> | undefined;
}
```

### Cube Faces

Six faces identified by string codes:
- `t` — top
- `b` — bottom
- `fr` — front-right
- `fl` — front-left
- `br` — back-right
- `bl` — back-left

### WallsMask

Controls which faces are hidden (face the "back" of the camera). When `true`, the face is hidden — used for back-face culling against boundary walls:

```ts
interface WallsMask {
  t: boolean;   // top hidden
  b: boolean;   // bottom hidden
  bl: boolean;  // back-left hidden
  br: boolean;  // back-right hidden
  fl: boolean;  // front-left hidden
  fr: boolean;  // front-right hidden
}
```

Default walls (isometric default angle rotX=65, rotY=45): `{ t: false, b: true, bl: true, br: true, fl: false, fr: false }`

---

## How Cube Rendering Works

This is the heart of the engine. The rendering pipeline works as follows:

### Step 1: Context Building (`context.ts` → `buildSceneContext`)

1. **Infer grid dimensions** from the voxel array by scanning for max x, y, z values. Falls back to 16x16x12.
2. **Build voxel layers**: Splits the flat `Voxel[]` into per-Z-layer arrays (`Voxel[][]`). Also builds flat lookup arrays (`(Voxel | null)[]`) per layer for O(1) neighbor access. Each lookup is a 1D array of size `rows * cols`, indexed by `x * cols + y`.
3. **Compute wall mask** from camera rotation angles if not explicitly provided.
4. **Return** `{ context, dimensions, layers }` with the fully populated `GridContext`.

### Step 2: DOM Structure (`domRenderer.ts` → `renderScene`)

The DOM tree looks like this:

```
<div class="voxcss-camera">          ← Camera element (perspective, transforms)
  <div class="voxcss-scene">         ← Scene host
    <div class="voxcss-floor-z">     ← Floor plane (z=0)
      <div class="voxcss-layer">     ← Layer 0 (translateZ: 0px)
        <div>                        ← Voxel container (grid-area positioned)
          <div class="voxcss-cube">  ← Cube wrapper
            <div class="voxcss-cube-face voxcss-cube-face--t">  ← Top face
            <div class="voxcss-cube-face voxcss-cube-face--fl"> ← Front-left face
            ...
          </div>
        </div>
        ...more voxels...
      </div>
      <div class="voxcss-layer">     ← Layer 1 (translateZ: 50px)
        ...
      </div>
    </div>
    <div class="voxcss-wall voxcss-wall--backLeft">   ← Optional wall
    <div class="voxcss-wall voxcss-wall--backRight">  ← Optional wall
    ...
  </div>
</div>
```

**Layers** are `display: grid` elements positioned via `translateZ(layerIndex * elevation)`. Each layer uses CSS Grid with `repeat(cols, 50px)` columns and `repeat(rows, 50px)` rows. Voxels are placed using `grid-area: x / y / x2 / y2`.

### Step 3: Per-Voxel Rendering

For each voxel in each layer:

1. **Compute visible faces** (`visibility.ts` → `computeVisibleFaces`):
   - For each of the 6 faces, check if a neighbor voxel exists in the offset direction.
   - For area voxels (x2/y2 spans), ALL cells along the face edge must have neighbors for occlusion.
   - Also check the `WallsMask` — faces matching a hidden wall direction are skipped.
   - Returns a `CubeFace[]` of visible faces (e.g., `["t", "fr", "fl"]`).

2. **Select shape renderer** based on `voxel.shape`:
   - `"cube"` → `cubeShapeRenderer` (default)
   - `"ramp"` → `rampShapeRenderer`
   - `"wedge"` → `wedgeShapeRenderer`
   - `"spike"` → `spikeShapeRenderer`

3. **Render faces** — the cube renderer:
   - Sets CSS custom properties for face offsets: `--voxcss-side-offset-x`, `--voxcss-side-offset-y`, `--voxcss-fr-offset`
   - Creates `<div>` elements for each visible face with class `voxcss-cube-face voxcss-cube-face--{face}`
   - Uses a `WeakMap` DOM cache to reuse face elements across renders
   - Applies appearance (color/texture/filter) via `applyCubeFaceAppearance`

### Step 4: Face Appearance (`faceAppearance.ts`)

Each face gets:
- **Background color**: The voxel's `color` (default `#cccccc`) shaded by the face's lighting delta
- **Background image**: Resolved from `voxel.texture` (URL or via `resolveTexture` callback)
- **Filter**: Brightness filter for textured faces (simulates directional light)
- **Custom overrides**: The `context.lighting()` callback can override any of these per face

### Step 5: Lighting (`lighting.ts`)

Simulates directional lighting by adjusting RGB channels:
- **Face brightness deltas**: `t: 0, b: 0, fr: -15, fl: -25, bl: -40, br: -30`
- Colors are parsed (hex or CSS), channels clamped after delta is applied
- Shape surfaces (ramp/wedge/spike slopes) use angular-distance-based brightness levels against a light source at 180°

### Step 6: CSS 3D Positioning

Each face is positioned via CSS transforms defined in the injected stylesheet (`styles.ts`):

```css
.voxcss-cube-face--t  { transform: translateZ(var(--voxcss-layer-half)); }
.voxcss-cube-face--b  { transform: translateZ(calc(-1 * var(--voxcss-layer-half))); }
.voxcss-cube-face--fr { transform: rotateY(90deg) translateZ(var(--voxcss-side-offset-y)); width: var(--voxcss-layer-elevation); }
.voxcss-cube-face--fl { transform: rotateX(90deg) translateZ(calc(-1 * var(--voxcss-side-offset-x))); height: var(--voxcss-layer-elevation); }
.voxcss-cube-face--bl { transform: rotateY(90deg) translateZ(calc(-1 * var(--voxcss-layer-half))); width: var(--voxcss-layer-elevation); }
.voxcss-cube-face--br { transform: rotateX(90deg) translateZ(var(--voxcss-layer-half)); height: var(--voxcss-layer-elevation); }
```

The cube itself is centered within the layer elevation: `transform: translateZ(var(--voxcss-layer-half))` where `--voxcss-layer-half` = half of `--voxcss-layer-elevation` (25px for cubic, 12.5px for dimetric).

All elements use `transform-style: preserve-3d` to maintain the 3D composition chain up to the camera perspective element.

---

## Non-Cube Shapes

### Ramp (`shapes/ramp.ts`)

A sloped surface on one side. Uses `rotateY(45deg)` on a wider `<div>` to create the slope effect. The bottom face is rendered separately. Orientation is controlled by `voxel.rot` (snapped to 0/90/180/270).

### Wedge (`shapes/wedge.ts`)

Two intersecting slopes forming a ridge. Uses inline SVG with `<path>` elements for the triangular slope faces (e.g., `M0 0 L480 0 L0 480 Z`). SVG allows texture patterns via `<pattern>` + `<image>`.

### Spike (`shapes/spike.ts`)

Similar to wedge but with a pointed top. Also uses SVG paths for the slope surfaces.

### Shape Utilities (`shapes/shapeUtils.ts`)

- `prepareShapeRoot()`: Sets up orientation class (`voxcss-east/south/west/north`), checks if covered by voxel above, computes surface lighting.
- `createSvgSlopeElement()`: Builds an SVG element with a triangular path, optional texture pattern fill, and brightness filter.
- Shapes are hidden if fully covered by a voxel directly above (`isCovered` check).

---

## Camera System (`camera.ts`)

### Camera State

```ts
interface CameraState {
  zoom: number;       // Scale factor (default: 0.65)
  pan: number;        // Horizontal offset in px (default: 0)
  tilt: number;       // Vertical offset in px (default: 0)
  rotX: number;       // X-axis rotation in degrees (default: 65)
  rotY: number;       // Y-axis rotation in degrees (default: 45)
  depthOffset: number; // Vertical compensation for depth (default: 20)
}
```

### Transform Generation

The camera generates a CSS transform string:
```
scale(zoom) translateY(depthOffset) translateY(tilt) translateX(pan) rotateX(rotX) rotate(rotY)
```

The camera element uses `perspective: 8000px` by default.

### Pointer Drag Interaction

When `interactive: true`:
- `pointerdown` → start drag, capture pointer
- `pointermove` → update `rotX`/`rotY` based on delta (`speed = 5` divisor)
- `rotX` is clamped to `[0, 100]`, `rotY` wraps around `[0, 360]`
- Fallback to window-level listeners for Safari/iOS pointer capture issues

### Auto-Rotation

`animate` prop enables per-frame rotation:
- `true` → Y-axis at speed 0.3 deg/frame
- `number` → custom speed
- `{ axis, speed, pauseOnInteraction }` → full config
- Stops on pointer interaction if `pauseOnInteraction: true`

---

## Wall Mask Computation (`context.ts` → `computeWallMask`)

The wall mask determines which cube faces should be hidden (they face away from the camera):

```ts
function computeWallMask(rotX = 65, rotY = 45): WallsMask {
  const normalizedRotY = ((rotY % 360) + 360) % 360;
  return {
    t: Math.round(rotX) >= 90,        // top hidden when looking from below
    b: Math.round(rotX) < 90,         // bottom hidden when looking from above
    bl: normalizedRotY <= 180,
    fr: normalizedRotY > 180,
    br: normalizedRotY < 90 || normalizedRotY >= 270,
    fl: normalizedRotY >= 90 && normalizedRotY < 270
  };
}
```

This updates dynamically as the user drags the camera.

---

## Voxel Merging

### 2D Merge (`mergeVoxels.ts`)

When `mergeVoxels="2d"`, adjacent same-colored cube voxels within each Z layer are merged into area voxels (x2/y2 spans). This reduces DOM node count significantly.

**Algorithm:**
1. Split voxels into per-Z-layer buckets
2. For each layer, separate mergeable cubes from non-mergeable shapes
3. Expand non-mergeable shapes into a `blocked` cell set
4. Build a cell map keyed by `"x:y"` with a signature `"color|texture"`
5. Greedy rectangle expansion: for each unvisited cell, grow rightward (same signature), then grow downward (all cells in the row match)
6. Output merged voxels with `x2`/`y2` set

### 3D Merge / Slice Renderer (`sliceRenderer.ts`)

When `mergeVoxels="3d"`, the engine switches to a completely different render mode called the **slice renderer**. Instead of per-voxel cubes, it renders the scene as flat 2D planes (slices) along each axis.

**How it works:**

1. **Build occupancy grid**: A flat `Array<Voxel | null>` of size `rows * cols * depth`.

2. **Extract face data**: For each occupied cell, check each of the 6 directions. If no neighbor exists, register a face on the corresponding slice plane. Faces are grouped by `(axis, planeIndex, faceDirection)`.

3. **Face buffers**: Each group gets a `FaceBuffer` — a 2D grid with a color palette. Each cell stores a palette index (`Uint32Array`) and an occupancy mask (`Uint8Array`).

4. **Slice planning**: For each face group, generate an optimal set of rectangles ("brushes") to cover all colored cells:
   - Try row-first and column-first rectangle decomposition
   - Try "hole fill" variants where holes between layers can be covered
   - Pick whichever variant produces fewer brushes
   - Verify correctness by reconstructing the buffer from brushes

5. **DOM output**: Brushes are rendered as `<b>` elements with `grid-area` positioning and `background-color`. Three CSS Grid hosts are used:
   - `voxcss-floor-z` — Z-axis slices (XY planes, positioned via `translateZ`)
   - `voxcss-floor-x` — X-axis slices (rotated via `rotateX(90deg)`)
   - `voxcss-floor-y` — Y-axis slices (rotated via `rotateY(-90deg)`)

6. **Caching**: Slice plans are cached by a content-based key. If the buffer hasn't changed, the cached plan is reused.

---

## Scene Controller (`controller/sceneController.ts`)

The central state manager. Not tied to any framework.

**Responsibilities:**
- Owns the camera handle
- Tracks scene state (voxels, dimensions, walls, floor, projection)
- Caches merged voxel grids
- Emits `ControllerSnapshot` to subscribers on any change
- Handles pointer drag events
- Distinguishes "camera-only" updates (rotation) from full rebuilds

**Key optimization:** Camera rotation changes only update the wall mask and re-emit a snapshot — they do NOT rebuild the voxel layers or context. The `cameraOnly: true` flag tells the scene binding to skip a full render.

---

## Scene Bindings (`controller/sceneBindings.ts`)

Connects the controller to a DOM element:

1. **Mount:** Injects base styles, creates a `DomRenderer`, does initial synchronous render
2. **Subscribe:** Listens to controller snapshots. On camera-only updates, only re-renders if walls changed. On full updates, schedules an `rAF` render.
3. **Grid suppression:** During camera drag, grid overlay images are temporarily hidden (via CSS custom property `--voxcss-floor-grid-image: none`) and restored 120ms after drag ends.
4. **Update:** Accepts new `SceneState`, diffs against previous, schedules render if changed.

---

## Camera DOM Bindings (`controller/domBindings.ts`)

Connects the camera to a DOM element:

1. Creates a `HeadlessCameraHandle` via `createCamera()`
2. Subscribes to controller snapshots, forwards to callback
3. Manages auto-rotate animation loop
4. Manages pointer event attachment/detachment
5. Exposes `update()`, `startAutoRotate()`, `stopAutoRotate()`, `destroy()`

---

## Headless API (`core/headless.ts`)

Framework-free imperative API for vanilla JS usage:

```ts
renderScene({
  element: document.getElementById("root"),
  camera: { interactive: true, zoom: 1.5 },
  scene: { voxels: [...], showFloor: true }
})
```

This internally:
1. Creates (or reuses) a camera `<div>` inside the root element
2. Creates (or reuses) a scene `<div>` inside the camera element
3. Calls `createCamera()` → `mountScene()` → initial render
4. Returns `{ setVoxels(), setScene(), destroy() }`

---

## MagicaVoxel Parser (`utils/parseMagicaVoxel.ts`)

Parses `.vox` binary files (MagicaVoxel format):

1. Validates the `VOX ` magic header
2. Reads chunks: `MAIN`, `SIZE` (dimensions), `XYZI` (voxel data), `RGBA` (palette)
3. Maps color indices to hex colors using the embedded or default 256-color palette
4. Outputs `{ voxels: VoxelGrid, rows, cols, depth }` with 1-indexed x/y coordinates
5. Max dimension: 512 per axis
6. Deduplicates voxels at the same position

---

## PNG Encoder (`core/png.ts`)

A zero-dependency PNG encoder:
- `encodeRgbaToPng(rgba, width, height)` → `Uint8Array` (RGBA PNG)
- `encodeRgbToPng(rgb, width, height)` → `Uint8Array` (RGB PNG)
- `rgbaToPngBlob()` / `rgbToPngBlob()` → `Blob`
- Uses uncompressed (stored) zlib blocks — no deflate compression
- Computes CRC32 checksums for chunk integrity
- Used for generating texture sprites

---

## Framework Wrappers

### Pattern

All three wrappers (Vue, React, Svelte) follow the same pattern:
- **`VoxCamera`** — Creates the camera element, mounts the camera binding, provides the controller to children via context/inject/stores
- **`VoxScene`** — Consumes the controller from context, mounts the scene binding, re-renders on prop changes

### React (`react/`)

- `VoxCamera`: `forwardRef` component, mounts via `useLayoutEffect`, updates via `useEffect`, exposes `VoxCameraHandle` via `useImperativeHandle`
- `VoxScene`: Functional component, uses `useSceneBinding` custom hook
- Controller passed via `SceneControllerContext` (React Context)
- Shallow equality check on `SceneState` to avoid unnecessary updates

### Vue (`vue/`)

- `VoxCamera`: `defineComponent` with `setup()`, uses `ref`/`watch`/`provide`
- `VoxScene`: `defineComponent` with `setup()`, uses `inject` for controller
- Controller passed via Vue's `provide`/`inject` with `InjectionKey<Ref<SceneController>>`

### Svelte (`svelte/`)

- Uses Svelte stores (`writable`/`readable`) for controller context
- `VoxCamera.svelte` / `VoxScene.svelte` are Svelte 4 components
- `setContext`/`getContext` for component tree communication

---

## CSS Architecture

### Base Styles (injected via `styles.ts`)

A single `<style id="voxcss-base-styles">` is injected into `<head>`. Key rules:

- **`.voxcss-camera`**: The outermost container. `perspective: 8000px`, `overflow: hidden`, `contain: paint`, flex centering. All descendants get `transform-style: preserve-3d`.
- **`.voxcss-layer`**: Absolute-positioned CSS Grid. `grid-template-columns: repeat(var(--voxcss-cols), 50px)`. Positioned via `translateZ`.
- **`.voxcss-floor-z`**: Floor plane. Background color + SVG grid overlay.
- **`.voxcss-cube`**: Relative-positioned 3D container. Centered vertically within the layer via `translateZ(var(--voxcss-layer-half))`.
- **`.voxcss-cube-face`**: Absolute-positioned face. `outline: 1px solid rgba(0,0,0,0.08)` for edge lines.
- **`.voxcss-wall`**: Boundary walls, positioned via rotateX/rotateY + translateZ.

### Key CSS Custom Properties

| Property | Default | Purpose |
|---|---|---|
| `--voxcss-layer-elevation` | `50px` | Height of one Z layer |
| `--voxcss-layer-half` | `calc(elevation / 2)` | Half layer height (cube centering) |
| `--voxcss-rows` | `8` | Grid row count |
| `--voxcss-cols` | `8` | Grid column count |
| `--voxcss-side-offset-x` | `25px` | Side face X offset (adjusts for area voxels) |
| `--voxcss-side-offset-y` | `25px` | Side face Y offset |
| `--voxcss-fr-offset` | `50px` | Front-right face offset |
| `--voxcss-floor-base` | `#c2c2f3` | Floor background color |
| `--voxcss-floor-grid` | `none` | Floor grid overlay (SVG blob URL) |
| `--voxcss-wall-grid` | `none` | Wall grid overlay |
| `--voxcss-shape-rotation` | `0deg` | Shape orientation (ramp/wedge/spike) |

### Projections

- **Cubic** (default): `--voxcss-layer-elevation: 50px` — cubes are true cubes
- **Dimetric**: `--voxcss-layer-elevation: 25px` — squished vertically, closer to classic pixel-art isometric

---

## Performance Characteristics

- Every visible voxel face = 1 DOM element
- Grid lines = SVG data URLs generated as `Blob` → `ObjectURL`, cached by dimensions
- Visibility culling: O(faces * edge_cells) per voxel — only outer surfaces are rendered
- Merge strategies dramatically reduce DOM count for large models
- Camera-only updates skip voxel layer rebuilds entirely
- `rAF` batching prevents multiple renders per frame
- DOM element pools reuse elements across renders (avoids GC pressure)
- `WeakMap` caches per-element face state to avoid redundant DOM mutations

---

## Conventions

- All coordinates use a grid system where `x` = row, `y` = column, `z` = layer (depth)
- Tile size is always `50px` (`BASE_TILE` constant)
- Ranges are half-open: `[x, x2)`, `[y, y2)`, `[z, z2)`
- Colors default to `#cccccc` if unspecified
- Wall color defaults to `#3e3e4d`
- The `"f"` face key exists in `DEFAULT_OFFSETS` as `[0,0,0]` but is not in `CUBE_FACES` — it appears unused
- Error messages are prefixed with `"voxcss: "`

---

## Git Conventions

- Commit messages use conventional format: `type: short description` (e.g., `refactor:`, `test:`, `feat:`, `fix:`, `chore:`)
- One line only, no body, no attribution/co-author tags
- Do not amend existing commits — always create new ones