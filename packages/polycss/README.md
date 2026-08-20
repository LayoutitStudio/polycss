# PolyCSS

A CSS polygon mesh library. A 3D engine for the DOM. Renders OBJ/MTL, STL, glTF/GLB, and VOX as real HTML elements transformed with CSS `matrix3d(...)`. Supports colors, textures, lighting, shadows, shapes and animations. Works with React, Vue or plain JavaScript.

<!-- polycss:shared:links:start -->
Visit [polycss.com](https://polycss.com) for docs and model examples.

Join [chat.polycss.com](https://chat.polycss.com) for support and community discussions.

<img width="1600" height="300" alt="PolyCSS primitives banner" src="https://github.com/user-attachments/assets/b05e2204-9323-4f83-8d1b-01ea0dd000db" />
<!-- polycss:shared:links:end -->

## Installation

```bash

# Vanilla
npm install @layoutit/polycss

# React
npm install @layoutit/polycss-react

# Vue
npm install @layoutit/polycss-vue

```

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

<img width="2500" height="1145" alt="PolyCSS intro" src="https://github.com/user-attachments/assets/0e5df0d8-04a8-4e50-8e3a-1097a96ce42f" />

## Imperative API

`createPolyCamera` owns the viewpoint, `createPolyScene` owns lighting and
options, and meshes are added to the scene:

```ts
import {
  createPolyBox,
  createPolyCamera,
  createPolyOrbitControls,
  createPolyScene,
} from "@layoutit/polycss";

const host = document.getElementById("polycss")!;
const camera = createPolyCamera({ rotX: 65, rotY: 45 });
const scene = createPolyScene(host, { camera, textureLighting: "dynamic" });

createPolyOrbitControls(scene, { drag: true, wheel: true });

scene.add(createPolyBox({ size: 100, color: "#ffd166" }));
```

Using React or Vue instead? Install
[`@layoutit/polycss-react`](https://www.npmjs.com/package/@layoutit/polycss-react)
or [`@layoutit/polycss-vue`](https://www.npmjs.com/package/@layoutit/polycss-vue),
which expose the same model as components.

## Three.js Parity API

When porting Three.js scenes or generating code with an agent, use the explicit
`*/three` subpaths:

- `@layoutit/polycss-core/three`
- `@layoutit/polycss/three`
- `@layoutit/polycss-react/three`
- `@layoutit/polycss-vue/three`

They expose Three-like `PerspectiveCamera`, `OrthographicCamera`, `Object3D`,
`Vector3`, `DirectionalLight`, `PointLight`, `AmbientLight`, radians for object
rotations, Y-up authoring coordinates, and `camera.position` + `camera.lookAt(...)`
framing. The adapters convert into native PolyCSS coordinates with a right-handed
axis map, so the apparent object size, projection, orientation, depth ordering,
and light direction line up with Three.js scene math while still rendering
through the DOM.

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
    <PolyThreePerspectiveCamera
      fov={50}
      aspect={16 / 9}
      position={[3, 2, 5]}
      lookAt={[0, 0, 0]}
    >
      <PolyScene directionalLight={sun.toPolyDirectionalLight()}>
        <PolyThreeMesh src="/models/cube.glb" rotation={[0, Math.PI / 4, 0]} />
      </PolyScene>
    </PolyThreePerspectiveCamera>
  );
}
```

Full reference: [polycss.com/api/three-parity](https://polycss.com/api/three-parity).

## API Reference

### PolyCamera

- `rotX`, `rotY` control the orbit angle in degrees.
- `zoom` is on-screen CSS pixels per world unit (default `0.65`).
- `target` pans the camera target in world coordinates.
- `distance` adds dolly pull-back.
- `PolyCamera` is the orthographic default. Use `PolyPerspectiveCamera` when you want perspective depth.

### Scene options (`createPolyScene`)

- Geometry enters through `scene.add(parseResult, transform)` — there is **no** `polygons` option. In markup, use `<poly-mesh>` or `<poly-polygon>` children.
- `directionalLight`, `pointLights` (direction-only, baked mode; optional per-light `castShadow`), and `ambientLight` control scene lighting.
- `textureLighting` chooses `"baked"` or `"dynamic"`.
- `textureQuality` controls atlas raster budget. `textureImageRendering`, `textureBackend`, and `textureProjection` set per-polygon texture defaults; `textureLeafSizing` is scene/atlas-wide with no per-polygon override.
- `strategies` can disable selected render strategies for diagnostics.
- `autoCenter` rotates around the union bbox of all added meshes instead of world origin, updating as meshes are added or removed. Individual meshes opt out with `excludeFromAutoCenter`.

### Mesh options

`<poly-mesh>` attributes: `src` (loads `.obj`, `.stl`, `.gltf`, `.glb`, or `.vox`), `mtl`, `position`, `scale`, `rotation`, `auto-center`, `mesh-resolution`, `cast-shadow`, `receive-shadow`, `target-size`, `default-color`, `palette`, `include-objects`, `exclude-objects`. There is **no** `polygons` attribute — pass pre-parsed geometry to `scene.add(...)`, or use `<poly-polygon>` for inline one-off polygons.

`scene.add(result, transform)` additionally accepts `merge`, `meshResolution`, `stableDom`, `shadowDefinition`, `excludeFromAutoCenter`, and `id`. Apart from `meshResolution` — which also exists as the `mesh-resolution` attribute, affecting the parse pass only — these are imperative-only.

- `cast-shadow` / `receive-shadow` emit CPU-projected SVG shadows. They work in both `"baked"` and `"dynamic"` lighting modes; dynamic-mode shadows are directional-only.
- `mesh-resolution` chooses `"lossy"` (default) or `"lossless"`. Note it threads into the **parse** only; the element's own `scene.add` call always renders at the default resolution. Use the imperative API when you need to control both passes.

### Controls

- `createPolyOrbitControls(scene, opts)` adds drag orbit, shift-drag pan, wheel zoom, and optional auto-rotate.
- `createPolyMapControls(scene, opts)` uses pan-first map-style input.
- `createPolyFirstPersonControls(scene, opts)` provides keyboard and pointer-look navigation.
- `createTransformControls(scene, opts)` adds translate/rotate gizmos for selected mesh handles.
- `createSelect(scene, opts)` adds pointer picking over mesh handles.

### PolyIframe

The `<poly-iframe>` custom element renders a live document as a flat quad inside
the scene, using the same `position` / `rotation` / `scale` conventions as a
mesh. Its content is centered on the wrapper's local origin, so rotation and
scale pivot at the visible center. React and Vue expose it as `<PolyIframe>`.

`width` and `height` are **world units**, not pixels — the mounted document is
`width × 50` by `height × 50` CSS px (`BASE_TILE`), so `16 × 9` yields an
800 × 450 px page.
`position` is world units too.

```html
<poly-scene>
  <poly-iframe src="https://example.com" width="16" height="9" position="0,0,5"></poly-iframe>
</poly-scene>
```

### Snapshot Export

The vanilla package exports `exportPolySceneSnapshot(target)`. It clones the current rendered `.polycss-camera` / `.polycss-scene` DOM, injects only the PolyCSS CSS needed by that snapshot, inlines CSS `url(...)` image assets as `data:image/...;base64,...`, strips scripts and inline event handlers, and returns a standalone HTML document string with no PolyCSS runtime import. It works with rendered React/Vue scenes too; import it from `@layoutit/polycss` and pass the rendered camera or scene element.

```ts
import { exportPolySceneSnapshot } from "@layoutit/polycss";

const html = await exportPolySceneSnapshot(scene.host);
```

If any referenced asset cannot be inlined, the function throws `PolySceneSnapshotError` with `code: "ASSET_INLINE_FAILED"`.

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

Geometry enters the scene through `scene.add()`, which takes a `ParseResult`.
There is no `polygons` scene option — wrap a raw `Polygon[]` yourself:

```ts
scene.add({ polygons, objectUrls: [], warnings: [], dispose: () => {} });
```

`scene.add` runs the mesh optimizer by default. Pass `{ merge: false }` as the
second argument to render authored polygons exactly as given.

Authoring `Polygon[]` by hand has real constraints — winding decides visibility,
`color` does not accept CSS named colors, and non-triangular polygons must be
coplanar. Read
[Authoring Polygons](https://polycss.com/core-concepts#authoring-polygons)
before you generate geometry.

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
- STL triangle meshes, including binary Magics face colors. STL has no standard units, textures, UVs, or hierarchy, so imports skip lossy simplification and ray-based interior culling.
- glTF / GLB, including embedded images and `TEXCOORD_0`.
- MagicaVoxel `.vox`, with direct voxel fast paths when eligible.
- Generated primitives: box, plane, ring, sphere, torus, cylinder, cone, and Platonic solids.

## Performance

PolyCSS renders through the DOM, so performance is mostly shaped by two things: the number of mounted leaves, and the amount of texture atlas area the browser has to paint. The renderer tries to keep the common cases cheap. Simple surfaces stay as solid CSS elements, while textured, irregular, or high-detail geometry falls back to atlas-backed slices only when needed.

Each visible polygon is emitted as one leaf element; the renderer chooses the least expensive CSS primitive that can represent the polygon, then uses `matrix3d(...)` to place that primitive in 3D space.

- `<b>` uses `background: currentColor` on a fixed box for solid rectangles and stable quads.
- `<u>` uses `corner-shape` for stable triangles and beveled-corner solids, with a `border-width` triangle fallback when needed.
- `<i>` clips solid polygons with `border-shape: polygon(...)` when the browser supports it.
- `<s>` maps a packed texture-atlas slice with `background-image`, and is the fallback for textured or unsupported shapes.

<!-- polycss:shared:license:start -->
## License

MIT.
<!-- polycss:shared:license:end -->
