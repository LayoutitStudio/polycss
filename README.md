# PolyCSS

A CSS polygon mesh library. A 3D engine for the DOM. Renders OBJ, glTF, GLB and VOX as real HTML elements transformed with CSS `matrix3d(...)`. Supports colors, textures, lighting, shadows, controls, shapes and animations. Works with React, Vue, custom elements, or plain JavaScript.

Visit [polycss.com](https://polycss.com) for docs and model examples.

<img width="1600" height="300" alt="polycss-primitives-banner" src="https://github.com/user-attachments/assets/b05e2204-9323-4f83-8d1b-01ea0dd000db" />

## Installation

```bash

# Vanilla
npm install @layoutit/polycss

# React
npm install @layoutit/polycss-react

# Vue
npm install @layoutit/polycss-vue

```

<img width="2500" height="1145" alt="polycss-intro" src="https://github.com/user-attachments/assets/0e5df0d8-04a8-4e50-8e3a-1097a96ce42f" />

You can also load PolyCSS directly from a CDN. Here is a minimal custom-element scene:

```html
<script type="module" src="https://esm.sh/@layoutit/polycss/elements"></script>

<poly-camera rot-x="65" rot-y="45">
  <poly-scene>
    <poly-orbit-controls drag wheel></poly-orbit-controls>
    <poly-box size="100" color="#ffd166"></poly-box>
  </poly-scene>
</poly-camera>
```

## Framework Components

React and Vue expose the same component model. `<PolyCamera>` owns the viewpoint, `<PolyScene>` owns lighting and atlas options, and `<PolyMesh>` loads or receives polygon data.

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

## API Reference

### PolyCamera

- `rotX`, `rotY` control the orbit angle in degrees.
- `zoom` scales the projected scene.
- `target` pans the camera target in world coordinates.
- `distance` adds dolly pull-back.
- `PolyCamera` is the orthographic default. Use `PolyPerspectiveCamera` when you want perspective depth.

### PolyScene

- `polygons` renders a static `Polygon[]` directly.
- `directionalLight` and `ambientLight` control scene lighting.
- `textureLighting` chooses `"baked"` or `"dynamic"`.
- `textureQuality` controls atlas raster budget.
- Seam bleed defaults to `1.5` CSS px on detected shared solid edges; `seamBleed="auto"` fits the amount from each polygon plan.
- `strategies` can disable selected render strategies for diagnostics.
- `autoCenter` rotates around the rendered mesh bounds instead of world origin.

### PolyMesh

- `src` loads `.obj`, `.gltf`, `.glb`, or `.vox` files.
- `mtl` loads companion OBJ materials.
- `polygons` accepts pre-parsed geometry.
- `position`, `scale`, and `rotation` transform the mesh wrapper.
- `autoCenter` shifts the mesh bbox center to local origin.
- `meshResolution` chooses `"lossy"` (default) or `"lossless"` optimization.
- `castShadow` emits CSS-projected shadows in dynamic lighting mode.

### Controls

- `<PolyOrbitControls>` adds drag orbit, shift-drag pan, wheel zoom, and optional auto-rotate.
- `<PolyMapControls>` uses pan-first map-style input.
- `<PolyFirstPersonControls>` provides keyboard and pointer-look navigation.
- `<PolyTransformControls>` adds translate/rotate gizmos for selected mesh handles.

### Polygon Data Model

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

## Loading Mesh Files

Use `loadMesh()` to parse supported model formats:

```ts
import { createPolyCamera, createPolyScene, loadMesh } from "@layoutit/polycss";

const host = document.getElementById("polycss")!;
const camera = createPolyCamera({ rotX: 65, rotY: 45 });
const scene = createPolyScene(host, { camera });

const mesh = await loadMesh("https://polycss.com/gallery/obj/cottage.obj", {
  mtlUrl: "https://polycss.com/gallery/obj/cottage.mtl",
});

scene.add(mesh);
```

Supported formats:

- OBJ + MTL, including `map_Kd` textures and UV coordinates.
- glTF / GLB, including embedded images and `TEXCOORD_0`.
- MagicaVoxel `.vox`, with direct voxel fast paths when eligible.
- Generated primitives: box, plane, ring, sphere, torus, cylinder, cone, and Platonic solids.

## Performance

PolyCSS renders in the DOM, so performance is mostly determined by how many polygons are mounted and how much texture atlas area they consume. The renderer uses several CSS strategies so simple surfaces stay cheap and textured or irregular surfaces fall back to atlas slices.

- One visible polygon becomes one leaf DOM element.
- Flat rectangles and stable quads use solid CSS leaves.
- Textured polygons are packed into generated texture atlases.
- Dynamic lighting runs through CSS custom properties instead of per-frame JavaScript.
- Voxel-shaped meshes mount only camera-facing leaves when the mesh is eligible.
- `meshResolution: "lossy"` merges compatible polygons, then may spend a small split budget to repair high-risk seams.

## Packages

| Package | Description |
|---|---|
| `@layoutit/polycss-core` | Pure math, parsers, lighting, camera helpers, mesh optimization. Zero browser globals. |
| `@layoutit/polycss` | Vanilla custom elements and imperative `createPolyScene` API. |
| `@layoutit/polycss-react` | React components, hooks, controls, and core re-exports. |
| `@layoutit/polycss-vue` | Vue 3 components, composables, controls, and core re-exports. |

## Made with PolyCSS

[Layoutit Voxels](https://voxels.layoutit.com)
-> A CSS Voxel editor

<img width="1000" height="600" alt="layoutit-voxels" src="https://polycss.com/layoutit-voxels.png" />

[Layoutit Terra](https://terra.layoutit.com)
-> A CSS Terrain Generator

<img width="1000" height="601" alt="layoutit-terra" src="https://polycss.com/layoutit-terra.png" />

## License

MIT.
