# Polycss API design — unified shape across all four paths

Single source of truth for what the **same scene** looks like across the four supported usage paths: vanilla JS, custom elements (HTML), React, Vue. If any path diverges from this shape, it's a bug.

**This describes the target state.** The current state has verified drift — see "Known drift" at the bottom.

---

## Goal

One mental model. A user who learns the React API can write the Vue, vanilla JS, and HTML versions without re-learning anything except idiom (camelCase vs kebab-case, function calls vs JSX).

## Tree shape

```
PolyCamera
└── PolyScene
    ├── Controls (PolyOrbitControls / PolyMapControls / PolyFirstPersonControls / PolyTransformControls) — optional
    └── Content (PolyMesh / PolyGround / PolyPolygon / helpers) — one per node
```

**Why camera wraps scene:** CSS `perspective` only applies to descendants. The scene's `transform: matrix3d(...)` is read in that perspective space, so scene must be a DOM descendant of camera. This is fixed by the rendering model — three.js can put camera + scene as siblings because it computes perspective in matrix math, not CSS.

## Camera taxonomy

Two cameras, one shared orbital state.

| Name | Projection | When to pick |
|---|---|---|
| `PolyOrthographicCamera` (alias `PolyCamera`) | `perspective: none` | **Default.** Isometric/voxel/diagrammatic scenes, 2.5D, technical drawings. Parallel projection plays nicely with DOM stacking; integer-pixel quads kill subpixel seams. |
| `PolyPerspectiveCamera` | `perspective: <N>px` | Game-like scenes that need depth foreshortening. CSS `perspective` is a sensitive knob — pick a specific value, don't auto-tune. |

Shared state: `rotX`, `rotY`, `target`, `distance`, `zoom`. Perspective also has `perspective` (px).

**Why ortho is the default:** polycss's structural advantages (no per-frame JS, DOM-as-render-tree, integer-pixel atlas slicing) are most visible in orthographic scenes. The engine's identity is closer to "voxel/iso renderer that also does perspective" than "general 3D engine that defaults to perspective." Diverges from three.js's `PerspectiveCamera`-as-default convention deliberately — see "Open questions" for the tradeoff and the implied CLAUDE.md update.

**No FPS camera, cinematic camera, etc.** "FPV" is `PolyPerspectiveCamera` + `PolyFirstPersonControls`. Camera defines projection; controls define behavior.

## Controls taxonomy

| Name | Behavior |
|---|---|
| `PolyOrbitControls` | Drag/wheel to orbit/zoom around target. |
| `PolyMapControls` | Like orbit but pan plane is horizontal (Google-Maps-style). |
| `PolyFirstPersonControls` | WASD + mouse-look. |
| `PolyTransformControls` | Gizmos for translate/rotate/scale on a target mesh. |

---

## Minimal mesh — all four paths

The same scene, every path. **If a path can't express this verbatim, it's a bug.**

### Vanilla JS

```js
import { createPolyCamera, createPolyScene, loadMesh } from "@layoutit/polycss";

const camera = createPolyCamera({ rotX: 65, rotY: 45 });
const scene  = createPolyScene(document.getElementById("app"), { camera });

scene.add(await loadMesh("https://polycss.com/gallery/obj/cottage.obj"));
```

### Custom elements (HTML)

```html
<script type="module" src="https://esm.sh/@layoutit/polycss/elements"></script>

<poly-camera rot-x="65" rot-y="45">
  <poly-scene>
    <poly-mesh src="https://polycss.com/gallery/obj/cottage.obj"></poly-mesh>
  </poly-scene>
</poly-camera>
```

### React

```tsx
import { PolyCamera, PolyScene, PolyMesh } from "@layoutit/polycss-react";

<PolyCamera rotX={65} rotY={45}>
  <PolyScene>
    <PolyMesh src="https://polycss.com/gallery/obj/cottage.obj" />
  </PolyScene>
</PolyCamera>
```

### Vue 3

```vue
<script setup>
import { PolyCamera, PolyScene, PolyMesh } from "@layoutit/polycss-vue";
</script>

<template>
  <PolyCamera :rot-x="65" :rot-y="45">
    <PolyScene>
      <PolyMesh src="https://polycss.com/gallery/obj/cottage.obj" />
    </PolyScene>
  </PolyCamera>
</template>
```

---

## Minimal interactive scene (orbit controls)

### Vanilla JS

```js
import {
  createPolyCamera, createPolyScene, createPolyOrbitControls, loadMesh,
} from "@layoutit/polycss";

const camera = createPolyCamera({ rotX: 65, rotY: 45 });
const scene  = createPolyScene(host, { camera });
createPolyOrbitControls(scene, { drag: true, wheel: true });

scene.add(await loadMesh("https://polycss.com/gallery/obj/cottage.obj"));
```

### Custom elements

```html
<poly-camera rot-x="65" rot-y="45">
  <poly-scene>
    <poly-orbit-controls drag wheel></poly-orbit-controls>
    <poly-mesh src="https://polycss.com/gallery/obj/cottage.obj"></poly-mesh>
  </poly-scene>
</poly-camera>
```

### React

```tsx
<PolyCamera rotX={65} rotY={45}>
  <PolyScene>
    <PolyOrbitControls drag wheel />
    <PolyMesh src="https://polycss.com/gallery/obj/cottage.obj" />
  </PolyScene>
</PolyCamera>
```

### Vue

```vue
<PolyCamera :rot-x="65" :rot-y="45">
  <PolyScene>
    <PolyOrbitControls drag wheel />
    <PolyMesh src="https://polycss.com/gallery/obj/cottage.obj" />
  </PolyScene>
</PolyCamera>
```

---

## Manual polygons (no file)

A mesh where geometry is defined inline as `Polygon[]` rather than loaded from a URL. The `Polygon` type lives in `@layoutit/polycss-core`:

```ts
interface Polygon {
  vertices: Vec3[];           // N coplanar vertices, CCW from outside
  color?: string;
  texture?: string;           // URL
  material?: PolyMaterial;
  uvs?: Vec2[];
  data?: Record<string, string | number | boolean>;
}
```

### Vanilla JS

```js
import { createPolyCamera, createPolyScene } from "@layoutit/polycss";

const camera = createPolyCamera({ rotX: 65, rotY: 45 });
const scene  = createPolyScene(host, { camera });

scene.add({
  polygons: [
    { vertices: [[0, 0, 0], [100, 0, 0], [50, 100, 0]], color: "#ff6644" },
  ],
});
```

### Custom elements

`<poly-polygon>` is a child of `<poly-mesh>`. `vertices` is a JSON-stringified array.

```html
<poly-camera rot-x="65" rot-y="45">
  <poly-scene>
    <poly-mesh>
      <poly-polygon
        vertices="[[0,0,0],[100,0,0],[50,100,0]]"
        color="#ff6644"
      ></poly-polygon>
    </poly-mesh>
  </poly-scene>
</poly-camera>
```

### React

`polygons` prop is mutually exclusive with `src`.

```tsx
const polygons = [
  { vertices: [[0, 0, 0], [100, 0, 0], [50, 100, 0]], color: "#ff6644" },
];

<PolyCamera rotX={65} rotY={45}>
  <PolyScene>
    <PolyMesh polygons={polygons} />
  </PolyScene>
</PolyCamera>
```

### Vue

```vue
<script setup>
const polygons = [
  { vertices: [[0, 0, 0], [100, 0, 0], [50, 100, 0]], color: "#ff6644" },
];
</script>

<template>
  <PolyCamera :rot-x="65" :rot-y="45">
    <PolyScene>
      <PolyMesh :polygons="polygons" />
    </PolyScene>
  </PolyCamera>
</template>
```

### Built-in shape generators

`@layoutit/polycss-core` (re-exported from every wrapper package) ships polygon factories for common primitives: `boxPolygons`, `arrowPolygons`, `ringPolygons`, `ringQuadPolygons`, `planePolygons`, `octahedronPolygons`, `axesHelperPolygons`. Each returns `Polygon[]` and slots into the same `polygons` field as raw construction:

```js
import { boxPolygons } from "@layoutit/polycss";
scene.add({ polygons: boxPolygons({ size: 100, color: "#ff6644" }) });
```

---

## Primitive shape components

Sugar over the polygon generators. `<PolyBox size={100} />` is one-liner ergonomics for `<PolyMesh polygons={boxPolygons({ size: 100 })} />` — same DOM output, less typing. Discoverable via autocomplete.

**polycss-specific cost framing:** each segment is a DOM node, not a vertex on a GPU buffer. Cranking `radialSegments` from 12 to 32 *quadruples* paint cost in a way three.js users don't have to think about. Defaults are deliberately lower than three.js's.

### Fixed-geometry primitives (no segment count)

| Component | Faces | Core generator |
|---|---|---|
| `PolyBox` | 6 quads (axis-aligned → `<b>` fast path) | `boxPolygons` ✅ |
| `PolyPlane` | 1 quad | `planePolygons` ✅ |
| `PolyTetrahedron` | 4 triangles | `tetrahedronPolygons` ❌ — add |
| `PolyOctahedron` | 8 triangles | `octahedronPolygons` ✅ |
| `PolyIcosahedron` | 20 triangles | `icosahedronPolygons` ❌ — add |
| `PolyDodecahedron` | 12 pentagons (`<i>` on Chromium, `<s>` elsewhere) | `dodecahedronPolygons` ❌ — add |

### Parametric primitives (segment count controls cost)

| Component | Default | Polygon count at default | Core generator |
|---|---|---|---|
| `PolyRing` (disc) | `segments: 32` | 32 triangles | `ringPolygons` ✅ |
| `PolyCylinder` | `radialSegments: 12` | ≈48 (24 side quads + 24 cap triangles) | `cylinderPolygons` ❌ — add |
| `PolyCone` | `radialSegments: 12` | 24 (12 side + 12 cap) | `conePolygons` ❌ — add. Could share `cylinderPolygons` impl with `radiusTop: 0`. |
| `PolyTorus` | `radialSegments: 12, tubularSegments: 16` | 192 quads | `torusPolygons` ❌ — add. Heaviest of the set; document. |

### Deferred

- **`PolySphere`** — three.js's default (`32×16`) is **1024 DOM nodes per sphere**. Even conservative `16×8` is 256. A sphere in polycss is a DOM-cost problem, not a math one. Hold off until either (a) a geodesic-subdivision generator with reasonable poly count, or (b) clear user demand. Workaround: subdivided icosahedron, or `boxPolygons` for "ball-ish."

### Same scene across all four paths — `PolyBox` as the reference

**Vanilla JS:**

```js
import { createPolyCamera, createPolyScene, boxPolygons } from "@layoutit/polycss";

const camera = createPolyCamera({ rotX: 65, rotY: 45 });
const scene  = createPolyScene(host, { camera });
scene.add({ polygons: boxPolygons({ size: 100, color: "#ff6644" }) });
```

`PolyBox` factory (if shipped) wraps it:

```js
import { createPolyCamera, createPolyScene, createPolyBox } from "@layoutit/polycss";

const camera = createPolyCamera({ rotX: 65, rotY: 45 });
const scene  = createPolyScene(host, { camera });
scene.add(createPolyBox({ size: 100, color: "#ff6644" }));
```

**Custom elements:**

```html
<poly-camera rot-x="65" rot-y="45">
  <poly-scene>
    <poly-box size="100" color="#ff6644"></poly-box>
  </poly-scene>
</poly-camera>
```

**React:**

```tsx
<PolyCamera rotX={65} rotY={45}>
  <PolyScene>
    <PolyBox size={100} color="#ff6644" />
  </PolyScene>
</PolyCamera>
```

**Vue:**

```vue
<PolyCamera :rot-x="65" :rot-y="45">
  <PolyScene>
    <PolyBox :size="100" color="#ff6644" />
  </PolyScene>
</PolyCamera>
```

### Implementation rule

**Don't add a `PolyX` component without the matching `xPolygons` generator in `@layoutit/polycss-core` first.** Every primitive component must be a thin wrapper around a pure-math core function. No shape-specific logic in the framework layers.

Concrete order:

1. **Core:** add `tetrahedronPolygons`, `icosahedronPolygons`, `dodecahedronPolygons`, `cylinderPolygons`, `conePolygons` (or just `cylinderPolygons` with `radiusTop: 0`), `torusPolygons`.
2. **React + Vue:** wire `<PolyBox>`, `<PolyPlane>`, `<PolyRing>`, `<PolyOctahedron>` (existing helpers) + the new ones. Mirror props and defaults between bindings.
3. **Custom elements:** mirror as `<poly-box>`, …, `<poly-torus>`. Same prop set, kebab-case attributes.
4. **Vanilla JS:** add `createPolyBox(opts)` factories. Each returns `{ polygons: Polygon[] }` so it composes with `scene.add(...)` verbatim.

### Deliberate non-mirror with three.js

three.js splits a primitive into `<Geometry />` + `<Material />` so they're independently swappable. **polycss doesn't replicate that.** A `Polygon` carries its own `color` / `texture` / `material`, so the geometry-vs-material split has no place to land here. Shape components take a flat prop set (size, segments, color, texture, material) and emit a polygon array directly.

---

## First-person scene

FPV needs perspective foreshortening to feel right, so this example uses the explicit `PolyPerspectiveCamera` rather than the default `PolyCamera` (which is orthographic).

### Vanilla JS

```js
import {
  createPolyPerspectiveCamera, createPolyScene, createPolyFirstPersonControls, loadMesh,
} from "@layoutit/polycss";

const camera = createPolyPerspectiveCamera({ rotX: 0, rotY: 0 });
const scene  = createPolyScene(host, { camera });
createPolyFirstPersonControls(scene);
scene.add(await loadMesh("/world.glb"));
```

### Custom elements

```html
<poly-perspective-camera>
  <poly-scene>
    <poly-first-person-controls></poly-first-person-controls>
    <poly-mesh src="/world.glb"></poly-mesh>
  </poly-scene>
</poly-perspective-camera>
```

### React / Vue

```tsx
<PolyPerspectiveCamera>
  <PolyScene>
    <PolyFirstPersonControls />
    <PolyMesh src="/world.glb" />
  </PolyScene>
</PolyPerspectiveCamera>
```

---

## Scene & mesh features

The features below all exist today in some form. Listed here so the design covers them and any open question about their shape is locked before implementation.

### Feature placement (where does it live?)

| Feature | Camera | Scene | Mesh | Controls |
|---|---|---|---|---|
| `rotX` / `rotY` / `zoom` / `distance` / `target` (Vec3) | ✅ | — | — | — |
| `perspective` (px) | ✅ (perspective camera only) | — | — | — |
| `directionalLight` / `ambientLight` | — | ✅ | — | — |
| `textureLighting` (`"baked"` \| `"dynamic"`) | — | ✅ (inherited by meshes) | ✅ (override) | — |
| `textureQuality` (`number` \| `"auto"`) | — | ✅ (default) | ✅ (override) | — |
| `strategies` (`{ disable: [...] }`) | — | ✅ | ✅ | — |
| `autoCenter` (boolean) | — | ✅ (translates the world) | ✅ (recenters polygons into mesh-local space) | — |
| `shadow` (`{ color, opacity, lift }`) | — | ✅ (appearance config) | — | — |
| `castShadow` (boolean) | — | — | ✅ (per-mesh opt-in) | — |
| `meshResolution` (`"lossless"` \| `"lossy"`) | — | — | ⚠️ via `parseOptions` only (see open question) | — |
| `animate` (`{ speed, axis }` \| `false`) — i.e. "auto-rotate" | — | — | — | ✅ (orbit only) |

### Lights

**Currently:** lights are typed values passed as **props** on the scene, not components.

```ts
type PolyDirectionalLight = { direction: Vec3; color?: string; intensity?: number };
type PolyAmbientLight = { color?: string; intensity?: number };
```

Across paths:

```js
// Vanilla JS
const scene = createPolyScene(host, {
  camera,
  directionalLight: { direction: [0.4, -0.7, 0.59], color: "#ffffff", intensity: 1 },
  ambientLight:     { color: "#ffffff", intensity: 0.4 },
});
```

```html
<!-- Custom elements (today): JSON-stringified attribute values -->
<poly-scene
  directional-light='{"direction":[0.4,-0.7,0.59],"color":"#ffffff","intensity":1}'
  ambient-light='{"color":"#ffffff","intensity":0.4}'>
  …
</poly-scene>
```

```tsx
// React / Vue
<PolyScene
  directionalLight={{ direction: [0.4, -0.7, 0.59], color: "#ffffff", intensity: 1 }}
  ambientLight={{ color: "#ffffff", intensity: 0.4 }}
>…</PolyScene>
```

> **Open question — Lights as components?** three.js / R3F use `<directionalLight />` and `<ambientLight />` as scene-tree children, not props. polycss could mirror that as `<PolyDirectionalLight />` and `<PolyAmbientLight />` siblings of `<PolyMesh>` inside `<PolyScene>`. Pros: matches three.js mental model, makes multi-light scenes natural (today we only have one of each). Cons: lights aren't really "scene objects" in polycss — they're inputs to the rasterizer (baked) or CSS variables (dynamic), not transformable nodes. **Recommendation: defer.** Stick with object-shaped props for now. Reconsider if multi-light is added.

### Shadows

Dynamic-lighting feature only — baked mode does not emit shadow leaves. Two pieces:

- `shadow?: { color?: string; opacity?: number; lift?: number }` on **scene** — appearance config. Defaults: `{ color: "#000000", opacity: 0.25, lift: 0.05 }`.
- `castShadow?: boolean` on **mesh** — per-mesh opt-in.

Each polygon on a shadow-casting mesh emits a paired `<q>` leaf (the cast-shadow leaf in the tag table, AGENTS.md).

```tsx
// React
<PolyScene textureLighting="dynamic" shadow={{ opacity: 0.4, lift: 0.1 }}>
  <PolyMesh src="https://polycss.com/gallery/obj/cottage.obj" castShadow />
</PolyScene>
```

```html
<!-- Custom elements -->
<poly-scene texture-lighting="dynamic" shadow='{"opacity":0.4,"lift":0.1}'>
  <poly-mesh src="https://polycss.com/gallery/obj/cottage.obj" cast-shadow></poly-mesh>
</poly-scene>
```

```js
// Vanilla JS
const scene = createPolyScene(host, {
  camera,
  textureLighting: "dynamic",
  shadow: { opacity: 0.4, lift: 0.1 },
});
const mesh = await loadMesh("https://polycss.com/gallery/obj/cottage.obj");
scene.add(mesh, { castShadow: true });   // ← second arg is mesh transform + flags
```

### Texture lighting modes

`textureLighting: "baked" | "dynamic"` (default `"baked"`).

- **Baked.** Lambert computed once per polygon on CPU; multiplied into atlas pixels (`<s>`) or inline `color` (`<b>` / `<i>` / `<u>`). Moving a light requires re-rasterising.
- **Dynamic.** Scene root carries lights as CSS custom properties (`--plx/y/z`, `--plr/g/b`, etc.). Each leaf embeds its normal + base color inline. Lambert resolves at paint time via `calc()`. Moving a light mutates one var → no JS, no atlas redraw. Required for `castShadow`.

Scene-level sets the default; mesh-level overrides per-mesh.

### Texture quality

`textureQuality?: number | "auto"` (default `"auto"`).

- `"auto"` — device-appropriate budget: ~4 MB atlas + 64px sprite on mobile, ~16 MB + 128px on desktop.
- numeric `0.1..1` — explicit raster scale, forces 64px sprite.

Set scene-level for the whole scene; override per mesh when one mesh needs more (or less) detail.

### Mesh resolution

Top-level `meshResolution?: "lossless" | "lossy"` prop on `<PolyMesh>` (Decision #6).

- `"lossy"` (default) — bounded geometric approximation when it reduces polygon count.
- `"lossless"` — preserve the authored surface; only apply exact merges.

```js
// Vanilla JS
scene.add(mesh, { meshResolution: "lossless" });
```

```html
<!-- Custom elements -->
<poly-mesh src="https://polycss.com/gallery/obj/cottage.obj" mesh-resolution="lossless"></poly-mesh>
```

```tsx
// React
<PolyMesh src="https://polycss.com/gallery/obj/cottage.obj" meshResolution="lossless" />
```

```vue
<!-- Vue -->
<PolyMesh src="https://polycss.com/gallery/obj/cottage.obj" mesh-resolution="lossless" />
```

`parseOptions` stays available for niche parser flags but is no longer the route for `meshResolution`.

### Auto center

`autoCenter?: boolean` exists at **two** levels:

- **Scene level.** Translates the *world* so the bbox of all live meshes sits at origin. Camera orbits the model's visible center without shifting the mesh DOM.
- **Mesh level.** Re-centers a mesh's polygons into mesh-local space. Useful for OBJ/GLB assets whose origin is at a corner / feet / arbitrary point.

These are independent — both can be `true`. Default: both `false`.

### Auto rotation

**There is no `autoRotate` prop.** Auto-rotation is the `animate` option on `PolyOrbitControls`:

```ts
animate?: { speed: number; axis?: "x" | "y" } | false
```

```tsx
// React
<PolyOrbitControls drag wheel animate={{ speed: 0.3 }} />
<PolyOrbitControls animate={{ speed: 1, axis: "x" }} />
<PolyOrbitControls animate={false} />    // explicit off
```

```html
<!-- Custom elements: flat attributes -->
<poly-orbit-controls drag wheel animate-speed="0.3"></poly-orbit-controls>
<poly-orbit-controls animate-speed="1" animate-axis="x"></poly-orbit-controls>
```

```js
// Vanilla JS
createPolyOrbitControls(scene, { animate: { speed: 0.3 } });
```

### Camera target

`target?: Vec3` on the camera (`<PolyCamera>` / `<PolyPerspectiveCamera>`). The orbital state rotates around this point. Default `[0, 0, 0]`.

```tsx
// React
<PolyCamera rotX={65} rotY={45} target={[10, 0, 0]}>…</PolyCamera>
```

```html
<!-- Custom elements: comma-separated -->
<poly-camera rot-x="65" rot-y="45" target="10,0,0">…</poly-camera>
```

```js
// Vanilla JS
const camera = createPolyCamera({ rotX: 65, rotY: 45, target: [10, 0, 0] });
```

Combined with scene-level `autoCenter`, the effective orbit pivot is `target + autoCenterOffset`. Users typically set either, not both.

### Cross-path consistency matrix

Every feature in one place — confirm at a glance that the four paths agree on shape, field names, and defaults. Per-path syntactic differences (camelCase vs kebab-case, JSX vs HTML) are expected; what must match is the **field name root, the value shape, and the default**.

| Feature | Lives on | Field root | Value shape | Default | Vanilla JS | Custom elements | React / Vue |
|---|---|---|---|---|---|---|---|
| Camera rotation | Camera | `rotX`, `rotY` | `number` (degrees) | `65`, `45` | `{ rotX: 65, rotY: 45 }` | `rot-x="65" rot-y="45"` | `rotX={65}` / `:rot-x="65"` |
| Camera target | Camera | `target` | `Vec3` (`[x,y,z]`) | `[0,0,0]` | `{ target: [10,0,0] }` | `target="10,0,0"` | `target={[10,0,0]}` |
| Camera zoom | Camera | `zoom` | `number` | `1` | `{ zoom: 1.5 }` | `zoom="1.5"` | `zoom={1.5}` |
| Camera distance | Camera | `distance` | `number` (CSS px) | (none) | `{ distance: 1200 }` | `distance="1200"` | `distance={1200}` |
| Perspective | Perspective camera | `perspective` | `number` (CSS px) | `8000` | `{ perspective: 4000 }` | `perspective="4000"` | `perspective={4000}` |
| Directional light | Scene | `directionalLight` | `{ direction: Vec3; color?: string; intensity?: number }` | (none) | object option | JSON attr `directional-light='{…}'` | object prop |
| Ambient light | Scene | `ambientLight` | `{ color?: string; intensity?: number }` | (none) | object option | JSON attr `ambient-light='{…}'` | object prop |
| Texture lighting | Scene (inheritable on mesh) | `textureLighting` | `"baked" \| "dynamic"` | `"baked"` | `{ textureLighting: "dynamic" }` | `texture-lighting="dynamic"` | `textureLighting="dynamic"` |
| Texture quality | Scene + mesh | `textureQuality` | `number \| "auto"` | `"auto"` | `{ textureQuality: 0.5 }` | `texture-quality="0.5"` | `textureQuality={0.5}` |
| Strategies | Scene + mesh | `strategies` | `{ disable?: ("b"\|"i"\|"u")[] }` | (none) | object option | JSON attr `strategies='{…}'` | object prop |
| Auto center (scene) | Scene | `autoCenter` | `boolean` | `false` | `{ autoCenter: true }` | bare attr `auto-center` | bare prop / `auto-center` |
| Auto center (mesh) | Mesh | `autoCenter` | `boolean` | `false` | `scene.add(m, { autoCenter: true })` | bare attr `auto-center` | bare prop |
| Shadow appearance | Scene | `shadow` | `{ color?: string; opacity?: number; lift?: number }` | `{ color: "#000000", opacity: 0.25, lift: 0.05 }` | object option | JSON attr `shadow='{…}'` | object prop |
| Cast shadow | Mesh | `castShadow` | `boolean` | `false` | `scene.add(m, { castShadow: true })` | bare attr `cast-shadow` | bare prop / `cast-shadow` |
| Mesh resolution | Mesh | `meshResolution` | `"lossless" \| "lossy"` | `"lossy"` | `scene.add(m, { meshResolution: "lossless" })` | `mesh-resolution="lossless"` | `meshResolution="lossless"` |
| Auto-rotate (orbit) | Orbit controls | `animate` | `{ speed: number; axis?: "x"\|"y" } \| false` | (off) | `{ animate: { speed: 0.3 } }` | flat attrs `animate-speed="0.3"` `animate-axis="x"` | object prop |

**Known divergence — nested object props on custom elements.** HTML attributes can't carry structured objects directly. The doc uses **two conventions** depending on the object's character:

- **Settings-shaped objects** (lights, shadow, strategies) → **JSON-stringified attribute**: `directional-light='{"direction":[…],"color":"…"}'`. One field, one value, parsed once at connect time.
- **Behavior-shaped objects with a "boolean + tuning"** quality (`animate`) → **flat attributes**: `animate-speed`, `animate-axis`. Reads naturally in HTML where the user toggles + tunes.

This split is the price of supporting raw HTML and matches how React/Vue would naturally fall out via prop spread — `animate-speed` reads like a typical HTML attr; `directional-light='{…}'` is uglier but doesn't proliferate `directional-light-direction-x` etc. **No further nesting conventions** — if a new feature comes in with a nested object, pick one of these two patterns to match its character.

---

## Per-path naming conventions

| Concept | Vanilla JS | Custom elements | React | Vue (template) |
|---|---|---|---|---|
| Camera | `createPolyCamera(opts)` | `<poly-camera>` | `<PolyCamera>` | `<PolyCamera>` |
| Scene | `createPolyScene(host, opts)` | `<poly-scene>` | `<PolyScene>` | `<PolyScene>` |
| Mesh | `scene.add(await loadMesh(url))` | `<poly-mesh src="url">` | `<PolyMesh src="url" />` | `<PolyMesh src="url" />` |
| Prop casing | camelCase (`rotX`) | kebab-case (`rot-x`) | camelCase (`rotX`) | kebab-case in template (`:rot-x`), camelCase in `<script>` |
| Boolean prop | `{ drag: true }` | bare attribute (`drag`) | bare JSX prop (`drag`) | bare JSX prop (`drag`) |
| Nested object prop | `{ animate: { speed: 0.3 } }` | flat attrs (`animate-speed="0.3"`) | nested object (`animate={{ speed: 0.3 }}`) | nested object (`:animate="{ speed: 0.3 }"`) |

---

## Three.js comparison

Names mirror three.js where possible (CLAUDE.md "three.js parity" rule, all prefixed `Poly`). Composition trees diverge because of CSS perspective inheritance.

| three.js | polycss | Status |
|---|---|---|
| `new THREE.Scene()` + `scene.add(mesh)` | `createPolyScene(host)` + `scene.add(mesh)` | ✅ same verb |
| `new THREE.PerspectiveCamera()` | `createPolyPerspectiveCamera()` | ✅ name mirrors |
| `new THREE.OrthographicCamera()` | `createPolyOrthographicCamera()` / `createPolyCamera()` | ✅ name mirrors; default alias diverges from three.js (see below) |
| **Default camera** = perspective | **Default camera (`PolyCamera`)** = orthographic | ❌ deliberate divergence — polycss optimizes for iso/voxel scenes |
| Camera + scene as siblings under renderer | Camera wraps scene | ❌ forced by CSS perspective |
| `new WebGLRenderer()` + `.render(scene, camera)` | None — scene mounts directly | ❌ no renderer; browser is the renderer |
| `requestAnimationFrame` draw loop | None | ❌ no per-frame JS; CSS does paint |
| `new GLTFLoader().load(url, cb)` | `await loadMesh(url)` | ⚠️ different — polycss is one async function for all formats |

---

## Known drift (must fix to reach target)

### Verified bugs

1. **`<poly-first-person-controls>` is not registered.** `createPolyFirstPersonControls` is exported; React/Vue have `PolyFirstPersonControls`. The custom element class doesn't exist and no `customElements.define()` call wires the tag. The HTML tag silently no-ops.
   - **Fix:** write `PolyFirstPersonControlsElement` (~80 lines, follow `PolyOrbitControlsElement`) + register it in `packages/polycss/src/elements/index.ts`.

2. **`<poly-camera>` and `createPolyCamera()` aliases don't exist on the vanilla side, and the alias points to the wrong projection.** React and Vue currently alias `PolyCamera` → `PolyPerspectiveCamera` (per current CLAUDE.md). Vanilla JS and custom elements have no alias at all. The unified target is `PolyCamera` → `PolyOrthographicCamera` everywhere — see "Camera taxonomy" for why.
   - **Fix:** `export const createPolyCamera = createPolyOrthographicCamera`. `customElements.define("poly-camera", PolyOrthographicCameraElement)`. Repoint React and Vue `PolyCamera` aliases from perspective to orthographic. Update CLAUDE.md (the line "PolyCamera is a kept alias for PolyPerspectiveCamera — the ergonomic default. Not deprecated.") in the same PR.

3. **Vue README uses `atlas-scale`; actual API is `textureQuality`.** Three occurrences in `packages/vue/README.md`. React README is correct.
   - **Fix:** rename in Vue README.

### Architectural divergence

4. **Vanilla scene owns its camera; React/Vue have an external camera provider.** `<poly-scene>` and `createPolyScene` accept `rotX`/`rotY` directly and do not consume a wrapping `<poly-camera>` element or a camera handle option. React/Vue `<PolyScene>` reads camera state from a parent `<PolyCamera>` context. Same visual output, two incompatible trees.
   - **Fix (breaking):** require a wrapping camera on every path. **Drop** `rotX` / `rotY` / `zoom` / `target` / `distance` / `perspective` from `PolySceneOptions` and from `<poly-scene>` observed attributes — there is no longer a single-tag shortcut. **Add** a required `camera: PolyPerspectiveCameraHandle | PolyOrthographicCameraHandle` field to `PolySceneOptions`. Update `<poly-scene>` to walk up its `parentElement` chain for a `<poly-camera>` / `<poly-perspective-camera>` / `<poly-orthographic-camera>` ancestor at `connectedCallback` and adopt its handle via the existing `polycss:camera-ready` event; throw a clear error if no camera ancestor is present. Migration: every existing `<poly-scene rot-x="X" rot-y="Y">…</poly-scene>` becomes `<poly-camera rot-x="X" rot-y="Y"><poly-scene>…</poly-scene></poly-camera>`. Every `createPolyScene(host, { rotX, rotY })` becomes `createPolyScene(host, { camera: createPolyCamera({ rotX, rotY }) })`.

---

## Open questions

Need a decision before implementation.

## Decisions (locked)

1. **Camera-wraps-scene is the only shape.** No camera-on-scene shortcut. `<poly-scene>` drops its camera attributes; `createPolyScene` drops its camera options. Every path requires an explicit wrapping camera. Breaking change to existing vanilla code — migration is mechanical (one extra wrapper). See "Known drift" #4 for the exact transformation.

2. **Default camera = orthographic.** `PolyCamera` aliases `PolyOrthographicCamera`, not `PolyPerspectiveCamera`. Diverges from three.js convention. Rationale: polycss optimizes for iso/voxel/diagrammatic scenes, which is its differentiator over WebGL engines. Requires a CLAUDE.md update in the same PR that lands the alias change.

3. **No `<PolyCanvas>` wrapper.** We won't introduce an R3F-style canvas root that papers over the camera→scene nesting. The tree shape stays `PolyCamera > PolyScene > content` and that's what users learn.

4. **No `PolyControls` / `<poly-controls>` alias.** Only the named controls exist: `PolyOrbitControls`, `PolyMapControls`, `PolyFirstPersonControls`, `PolyTransformControls` (and their `<poly-…>` / `createPoly…()` equivalents). There is no generic `<poly-controls>` or `<PolyControls>` shorthand — users always pick a specific behavior. If `PolyControls` is currently exported from any path, it gets removed in the implementation PR. Requires a CLAUDE.md update in the same PR (the current components list mentions `PolyControls` and `<poly-controls>`).

5. **Lights stay as object-shaped props on `<PolyScene>`.** Not separate `<PolyDirectionalLight>` / `<PolyAmbientLight>` components. Same object shape across all four paths (`{ direction, color, intensity }` for directional; `{ color, intensity }` for ambient). Revisit if multi-light support is added.

6. **`meshResolution` is promoted to a top-level `<PolyMesh>` prop on every path.** Not buried inside `parseOptions`. Same `"lossless" | "lossy"` enum, same default (`"lossy"`), same field name (`meshResolution` camelCase, `mesh-resolution` kebab) across all four paths. `parseOptions` keeps existing for niche parser flags but is no longer the route for `meshResolution`.

## Open questions

None — all open decisions are now locked above.

---

## Test surface

For each path, `tests/public-api.test.ts` in the package:

- Import only from the **published entry point** (`@layoutit/polycss`, `-react`, `-vue`) — never from internal paths.
- Mount every example above into a `happy-dom` host.
- Assert leaf DOM is produced (`<b>` / `<i>` / `<s>` / `<u>` / `<q>` count > 0 after mount).
- Assert no console errors during mount.

**Doc-extraction CI step:** parse code fences from `website/src/content/docs/**/*.mdx` and the four package READMEs, transpile JSX/Vue, run through the same mount harness. A snippet that doesn't compile or doesn't produce leaf DOM is a drift bug. This is the gate that would have caught the current `atlas-scale` and `<poly-first-person-controls>` drift before publish.
