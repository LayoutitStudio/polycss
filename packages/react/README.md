# @layoutit/polycss-react

React bindings for [PolyCSS](https://polycss.com) — a 3D engine for the DOM.
Renders OBJ/MTL, STL, glTF/GLB, and VOX meshes as real HTML elements
transformed with CSS `matrix3d(...)`. No WebGL, no canvas-per-frame.

<!-- polycss:shared:links:start -->
Visit [polycss.com](https://polycss.com) for docs and model examples.

Join [chat.polycss.com](https://chat.polycss.com) for support and community discussions.

<img width="1600" height="300" alt="PolyCSS primitives banner" src="https://github.com/user-attachments/assets/b05e2204-9323-4f83-8d1b-01ea0dd000db" />
<!-- polycss:shared:links:end -->

## Installation

```bash
npm install @layoutit/polycss-react
```

## Quick start

`<PolyCamera>` owns the viewpoint, `<PolyScene>` owns lighting and options, and
`<PolyMesh>` loads or receives polygon data.

```tsx
import { PolyCamera, PolyScene, PolyOrbitControls, PolyMesh } from "@layoutit/polycss-react";

export default function App() {
  return (
    <PolyCamera rotX={65} rotY={45}>
      <PolyScene textureLighting="dynamic">
        <PolyOrbitControls drag wheel />
        <PolyMesh src="/gallery/obj/cottage.obj" mtl="/gallery/obj/cottage.mtl" />
      </PolyScene>
    </PolyCamera>
  );
}
```

<img width="2500" height="1145" alt="PolyCSS intro" src="https://github.com/user-attachments/assets/0e5df0d8-04a8-4e50-8e3a-1097a96ce42f" />

## Components

### `<PolyCamera>`

- `rotX`, `rotY` control the orbit angle in degrees.
- `zoom` is on-screen CSS pixels per world unit (Three.js `OrthographicCamera.zoom` style).
- `target` pans the camera target in world coordinates.
- `distance` adds dolly pull-back.
- `PolyCamera` is the orthographic default. Use `<PolyPerspectiveCamera>` for
  perspective depth, or `<PolyOrthographicCamera>` for the explicit name.

### `<PolyScene>`

- `polygons` renders a static `Polygon[]` directly.
- `directionalLight`, `pointLights` (direction-only, baked mode; optional
  per-light `castShadow`), and `ambientLight` control scene lighting.
- `textureLighting` chooses `"baked"` or `"dynamic"`.
- `textureQuality` controls atlas raster budget.
- `shadow` configures cast-shadow color, opacity, and the parametric shadow
  knobs (`parametric`, `definition`, `style`, `followAnimation`).
- `strategies` can disable selected render strategies for diagnostics.
- `autoCenter` rotates around the bbox of the scene's own `polygons` prop (or
  `centerPolygons` when given) instead of world origin. It does **not** see
  geometry inside child `<PolyMesh>` components — with
  `<PolyScene autoCenter><PolyMesh src=… /></PolyScene>` the bbox is empty and
  nothing shifts. Pass the mesh's polygons as `centerPolygons`, or use
  `<PolyMesh autoCenter>` to recenter the mesh itself. (Vanilla
  `createPolyScene` differs — it unions every added mesh.)

Unlike the vanilla renderer, React re-renders on prop change, so a light change
**auto-rebakes** the lit surface in baked mode. For live or animated lights,
prefer `textureLighting="dynamic"`.

### `<PolyMesh>`

- `src` loads `.obj`, `.stl`, `.gltf`, `.glb`, or `.vox` files.
- `mtl` loads companion OBJ materials.
- `polygons` accepts pre-parsed geometry.
- `position`, `scale`, and `rotation` transform the mesh wrapper.
- `autoCenter` shifts the mesh bbox center to local origin. Note this rewrites
  vertex data, so `getPolygons()` returns the shifted coordinates.
- `meshResolution` chooses `"lossy"` (default) or `"lossless"` optimization.
  `.stl` **parsing** is conservative — the loader always uses the lossless
  optimizer and skips interior culling — but rendering re-optimizes the loaded
  polygons: the second pass follows `meshResolution` and interior-culls even at
  `"lossless"`.
- `merge` (default `true`) runs the polygon optimizer. Set `false` to render the
  polygons you passed exactly as given. It cannot undo `loadMesh`'s own
  parse-time optimization, so `src`-loaded geometry is already optimized before
  this switch is consulted.
- `castShadow` / `receiveShadow` opt the mesh into CPU-projected SVG shadows.
- `shadowDefinition` overrides the scene parametric shadow resolution for this
  mesh.

### `<PolyIframe>`

Renders a live document as a flat quad in the scene, with the same
`position` / `rotation` / `scale` conventions as a mesh. Content is centered on
the wrapper's local origin, so rotation and scale pivot at the visible center.

`width` and `height` are **world units**, not pixels — the mounted document is
`width × 50` by `height × 50` CSS px (`BASE_TILE`), so `16 × 9` yields an
800 × 450 px page.

```tsx
<PolyIframe src="https://example.com" width={16} height={9} position={[0, 0, 5]} />
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

## Hooks

- `usePolyCamera(options)` — create and drive the scene camera store from camera
  options; returns `{ store, cameraRef, sceneElRef, cameraElRef,
  applyTransformDirect }`.
- `usePolySceneContext(polygons, { directionalLight })` — run the scene pipeline
  (normalize + merge) over a polygon list; returns `{ polygons, sceneBbox }`.
- `usePolyMesh` — load a mesh imperatively; returns `{ polygons, voxelSource,
  loading, error, warnings, dispose }`, where `error` is an `Error | null`.
- `usePolyMaterial` — resolve material state for a mesh.
- `usePolySelect`, `usePolySelectionApi` — selection state and imperative API.
- `usePolyAnimation` — drive imported skeletal/morph clips.

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

```tsx
<PolyCamera>
  <PolyScene>
    {polygons.map((polygon, index) => (
      <Poly
        key={index}
        {...polygon}
        onClick={() => console.log("clicked polygon", index)}
        className="my-polygon"
      />
    ))}
  </PolyScene>
</PolyCamera>
```

Authoring `Polygon[]` by hand has real constraints — vertex winding decides
whether a face is visible at all, `color` does not accept CSS named colors, and
non-triangular polygons must be coplanar. Read
[Authoring Polygons](https://polycss.com/core-concepts#authoring-polygons)
before generating geometry.

## Three.js parity API

When porting Three.js scenes or generating code with an agent, use the explicit
`@layoutit/polycss-react/three` subpath. It exposes `PolyThreePerspectiveCamera`,
`PolyThreeOrthographicCamera`, `PolyThreeMesh`, and the Three-like light classes,
with radians for object rotations and Y-up authoring coordinates.

```tsx
import { PolyScene } from "@layoutit/polycss-react";
import {
  DirectionalLight,
  PolyThreeMesh,
  PolyThreePerspectiveCamera,
} from "@layoutit/polycss-react/three";

const sun = new DirectionalLight("#ffffff", 1);
sun.position.set(3, 5, 4);
sun.target.position.set(0, 0, 0);

export function App() {
  return (
    <PolyThreePerspectiveCamera fov={50} aspect={16 / 9} position={[3, 2, 5]} lookAt={[0, 0, 0]}>
      <PolyScene directionalLight={sun.toPolyDirectionalLight()}>
        <PolyThreeMesh src="/models/cube.glb" rotation={[0, Math.PI / 4, 0]} />
      </PolyScene>
    </PolyThreePerspectiveCamera>
  );
}
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

<!-- polycss:shared:packages:start -->
## Packages

| Package | Description |
|---|---|
| `@layoutit/polycss-core` | Pure math, parsers, lighting, camera helpers, mesh optimization. Zero browser globals. |
| `@layoutit/polycss` | Vanilla custom elements and imperative `createPolyScene` API. |
| `@layoutit/polycss-react` | React components, hooks, controls, and core re-exports. |
| `@layoutit/polycss-vue` | Vue 3 components, composables, controls, and core re-exports. |
| `@layoutit/polycss-morph` | Prepared-model loading, retained DOM animation, morph targets, skinning, and playback. |
<!-- polycss:shared:packages:end -->

<!-- polycss:shared:license:start -->
## License

MIT.
<!-- polycss:shared:license:end -->
