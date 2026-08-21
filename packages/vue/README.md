# @layoutit/polycss-vue

Vue 3 bindings for [PolyCSS](https://polycss.com) — a 3D engine for the DOM.
Renders OBJ/MTL, STL, glTF/GLB, and VOX meshes as real HTML elements
transformed with CSS `matrix3d(...)`. No WebGL, no canvas-per-frame.

<!-- polycss:shared:links:start -->
Visit [polycss.com](https://polycss.com) for docs and model examples.

Join [chat.polycss.com](https://chat.polycss.com) for support and community discussions.

<img width="1600" height="300" alt="PolyCSS primitives banner" src="https://github.com/user-attachments/assets/b05e2204-9323-4f83-8d1b-01ea0dd000db" />
<!-- polycss:shared:links:end -->

## Installation

```bash
npm install @layoutit/polycss-vue
```

## Quick start

`<PolyCamera>` owns the viewpoint, `<PolyScene>` owns lighting and options, and
`<PolyMesh>` loads or receives polygon data.

```vue
<template>
  <div class="scene-host">
    <PolyCamera :rot-x="65" :rot-y="45">
      <PolyOrbitControls drag wheel />
      <PolyScene texture-lighting="dynamic">
        <PolyMesh
          src="/gallery/obj/cottage.obj"
          mtl="/gallery/obj/cottage.mtl"
          :auto-center="true"
        />
      </PolyScene>
    </PolyCamera>
  </div>
</template>

<script setup lang="ts">
import { PolyCamera, PolyScene, PolyOrbitControls, PolyMesh } from "@layoutit/polycss-vue";
</script>

<style>
.scene-host { width: 100%; height: 100vh; }
.scene-host .polycss-camera { width: 100%; height: 100%; }
</style>
```

<img width="2500" height="1145" alt="PolyCSS intro" src="https://github.com/user-attachments/assets/0e5df0d8-04a8-4e50-8e3a-1097a96ce42f" />

## Components

Props are listed in their template (kebab-case) form.

### `<PolyCamera>`

- `rot-x`, `rot-y` control the orbit angle in degrees.
- `zoom` is on-screen CSS pixels per world unit (default `0.65`; orbit controls clamp to `0.1`–`10`).
- `target` pans the camera target in world coordinates.
- `distance` adds dolly pull-back.
- `PolyCamera` is the orthographic default. Use `<PolyPerspectiveCamera>` for
  perspective depth, or `<PolyOrthographicCamera>` for the explicit name.

### `<PolyScene>`

- `polygons` renders a static `Polygon[]` directly.
- `directional-light`, `point-lights` (direction-only, baked mode; optional
  per-light `castShadow`), and `ambient-light` control scene lighting.
- `texture-lighting` chooses `"baked"` or `"dynamic"`.
- `texture-quality` controls atlas raster budget.
- `shadow` configures cast-shadow color, opacity, and the parametric shadow
  knobs (`parametric`, `definition`, `style`, `followAnimation`).
- `strategies` can disable selected render strategies for diagnostics.
- `auto-center` rotates around the bbox of the scene's own `polygons` prop (or
  `center-polygons` when given) instead of world origin. It does **not** see
  geometry inside child `<PolyMesh>` components — with
  `<PolyScene auto-center><PolyMesh src="…" /></PolyScene>` the bbox is empty
  and nothing shifts. Pass the mesh's polygons as `center-polygons`, or use
  `<PolyMesh auto-center>` to recenter the mesh itself. (Vanilla
  `createPolyScene` differs — it unions every added mesh, minus any marked
  `excludeFromAutoCenter`.)

Unlike the vanilla renderer, Vue re-renders on prop change, so a light change
**auto-rebakes** the lit surface in baked mode. For live or animated lights,
prefer `texture-lighting="dynamic"`.

### `<PolyMesh>`

- `src` loads `.obj`, `.stl`, `.gltf`, `.glb`, or `.vox` files.
- `mtl` loads companion OBJ materials.
- `polygons` accepts pre-parsed geometry.
- `position`, `scale`, and `rotation` transform the mesh wrapper.
- `auto-center` shifts the mesh bbox center to local origin. Note this rewrites
  vertex data, so `getPolygons()` returns the shifted coordinates.
- `mesh-resolution` chooses `"lossy"` (default) or `"lossless"` optimization.
  `.stl` **parsing** is conservative — the loader always uses the lossless
  optimizer and skips interior culling — but rendering re-optimizes the loaded
  polygons: the second pass follows `mesh-resolution` and interior-culls even at
  `"lossless"`.
- `merge` (default `true`) runs the polygon optimizer. Set `false` to render the
  polygons you passed exactly as given. It cannot undo `loadMesh`'s own
  parse-time optimization, so `src`-loaded geometry is already optimized before
  this switch is consulted.
- `cast-shadow` / `receive-shadow` opt the mesh into CPU-projected SVG shadows.
- `shadow-definition` overrides the scene parametric shadow resolution for this
  mesh.

### `<PolyIframe>`

Renders a live document as a flat quad in the scene, with the same
`position` / `rotation` / `scale` conventions as a mesh. Content is centered on
the wrapper's local origin, so rotation and scale pivot at the visible center.

`width` and `height` are **world units**, not pixels — the mounted document is
`width × 50` by `height × 50` CSS px (`BASE_TILE`), so `16 × 9` yields an
800 × 450 px page.

```vue
<PolyIframe src="https://example.com" :width="16" :height="9" :position="[0, 0, 5]" />
```

### Controls

- `<PolyOrbitControls>` adds drag orbit, shift-drag pan, wheel zoom, and
  optional auto-rotate.
- `<PolyMapControls>` uses pan-first map-style input.
- `<PolyFirstPersonControls>` provides keyboard and pointer-look navigation.
- `<PolyTransformControls>` adds translate/rotate gizmos for selected mesh
  handles.
- `<PolySelect>` adds pointer picking; pair with `usePolySelect` /
  `usePolySelectionApi`.

### Helpers

`<PolyGround>`, `<PolyAxesHelper>`, `<PolyDirectionalLightHelper>`, and the
`<Poly>` shape component for one-off polygons.

## Composables

- `usePolyCamera(options)` — create and drive the scene camera store from camera
  options; returns the camera store plus scene/camera element refs.
- `usePolySceneContext(polygons)` — run the scene pipeline (normalize + merge)
  over a reactive polygon list; returns a ref of `{ polygons, sceneBbox }`.
- `usePolyMesh` — load a mesh imperatively; exposes polygons, voxel source,
  loading, error, and warnings as reactive state.
- `usePolyMaterial` — resolve material state for a mesh.
- `usePolySelect`, `usePolySelectionApi` — selection state and imperative API.
- `usePolyAnimation` — drive imported skeletal/morph clips.

Injection keys (`PolyCameraContextKey`, `PolySelectionContextKey`) are exported
for components that provide their own context.

## Polygon data model

Each polygon describes one renderable face:

```ts
const polygons = [
  {
    vertices: [[0, 0, 0], [60, 0, 0], [0, 60, 0]],
    color: "#f97316",
  },
  {
    vertices: [[0, 0, 0], [60, 0, 0], [60, 60, 0], [0, 60, 0]],
    texture: "/texture.png",
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
  },
];
```

Render polygons directly when you need per-face DOM events or custom styling:

```vue
<template>
  <PolyCamera>
    <PolyScene>
      <Poly
        v-for="(polygon, index) in polygons"
        :key="index"
        v-bind="polygon"
        class="my-polygon"
        @click="() => console.log('clicked polygon', index)"
      />
    </PolyScene>
  </PolyCamera>
</template>
```

Authoring `Polygon[]` by hand has real constraints — vertex winding decides
whether a face is visible at all, `color` does not accept CSS named colors, and
non-triangular polygons must be coplanar. Read
[Authoring Polygons](https://polycss.com/core-concepts#authoring-polygons)
before generating geometry.

## Three.js parity API

When porting Three.js scenes or generating code with an agent, use the explicit
`@layoutit/polycss-vue/three` subpath. It exposes `PolyThreePerspectiveCamera`,
`PolyThreeOrthographicCamera`, `PolyThreeMesh`, and the Three-like light classes,
with radians for object rotations and Y-up authoring coordinates.

```vue
<template>
  <PolyThreePerspectiveCamera
    :fov="50"
    :aspect="16 / 9"
    :position="[3, 2, 5]"
    :look-at="[0, 0, 0]"
  >
    <PolyScene :directional-light="sun.toPolyDirectionalLight()">
      <PolyThreeMesh src="/models/cube.glb" :rotation="[0, Math.PI / 4, 0]" />
    </PolyScene>
  </PolyThreePerspectiveCamera>
</template>

<script setup lang="ts">
import { PolyScene } from "@layoutit/polycss-vue";
import {
  DirectionalLight,
  PolyThreeMesh,
  PolyThreePerspectiveCamera,
} from "@layoutit/polycss-vue/three";

const sun = new DirectionalLight("#ffffff", 1);
sun.position.set(3, 5, 4);
sun.target.position.set(0, 0, 0);
</script>
```

Full reference: [polycss.com/api/three-parity](https://polycss.com/api/three-parity).

## Performance

Each visible polygon is emitted as one leaf element; the renderer chooses the
least expensive CSS primitive that can represent it, then uses `matrix3d(...)`
to place that primitive in 3D space. Polygon count is the dominant cost.

- `<b>` uses `background: currentColor` for solid rectangles and stable quads.
- `<u>` uses `corner-shape` for stable triangles and beveled-corner solids.
- `<i>` clips solid polygons with `border-shape: polygon(...)` where supported.
- `<s>` maps a packed texture-atlas slice, and is the fallback for textured or
  unsupported shapes.

<!-- polycss:shared:license:start -->
## License

MIT.
<!-- polycss:shared:license:end -->
