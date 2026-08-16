---
name: polycss
description: Build PolyCSS scenes that render 3D meshes, primitive shapes, or custom polygons as DOM/CSS polygon elements. Use when asked to create, port, debug, or explain PolyCSS code in vanilla JavaScript, React, or Vue.
---

# PolyCSS — DOM 3D Rendering

PolyCSS renders 3D polygon meshes as real DOM elements transformed with CSS
`matrix3d(...)`. No WebGL, no canvas-per-frame. It supports OBJ/MTL, STL,
glTF/GLB, VOX, generated primitives, colors, textures, dynamic lighting,
shadows, controls, selection, animation, and per-polygon interaction.

Use native PolyCSS when authoring PolyCSS-first scenes. Use the Three.js parity
API when porting Three.js code or generating code from Three-shaped examples.

## Reference docs

Read the file that matches the task before writing non-trivial code.

| File | Read it when |
|---|---|
| [docs/authoring-polygons.md](/skill/docs/authoring-polygons.md) | **Generating `Polygon[]` by hand.** Winding, color format, coplanarity, the optimizer. Silent-failure rules. |
| [docs/scenes-and-cameras.md](/skill/docs/scenes-and-cameras.md) | Setting up a scene, camera props, scene options, custom elements, coordinates. |
| [docs/shapes-and-primitives.md](/skill/docs/shapes-and-primitives.md) | Boxes, spheres, planes, Platonic solids, raw polygon generators. |
| [docs/loading-models.md](/skill/docs/loading-models.md) | `loadMesh`, `<PolyMesh src>`, OBJ/MTL/STL/glTF/GLB/VOX, parse options. |
| [docs/lighting.md](/skill/docs/lighting.md) | Directional/ambient/point lights, baked vs dynamic, rebaking. |
| [docs/shadows.md](/skill/docs/shadows.md) | `castShadow`, `receiveShadow`, parametric shadows, renderer differences. |
| [docs/textures.md](/skill/docs/textures.md) | UV textures, the atlas pipeline, texture quality, presentation options. |
| [docs/controls-and-interaction.md](/skill/docs/controls-and-interaction.md) | Orbit/map/first-person controls, selection, transform gizmos, click handlers. |
| [docs/animation.md](/skill/docs/animation.md) | Skeletal clips from glTF/GLB, `usePolyAnimation`, stable DOM. |
| [docs/performance.md](/skill/docs/performance.md) | Leaf counts, render strategies, atlas memory, voxel fast paths. |
| [docs/three-parity.md](/skill/docs/three-parity.md) | Porting Three.js scenes through the `*/three` subpaths. |
| [docs/troubleshooting.md](/skill/docs/troubleshooting.md) | **Something renders wrong.** Symptom → cause table. |
| [docs/api-index.md](/skill/docs/api-index.md) | "Does this export exist?" Package-by-package export inventory. |

## Packages

| Package | Use |
|---|---|
| `@layoutit/polycss` | Vanilla + custom elements. Re-exports all of core. |
| `@layoutit/polycss-react` | React components and hooks. Re-exports core. |
| `@layoutit/polycss-vue` | Vue 3 mirror of React. Re-exports core. |
| `@layoutit/polycss-core` | Pure math and parsers, zero browser globals (Node, workers). |
| `@layoutit/polycss-fonts` | Text → extruded 3D `Polygon[]`. |
| `@layoutit/polycss-morph` | Prepared models with retained DOM, morphs, skinning, playback. |

React and Vue depend on `core` only, so **do not import renderer or component
APIs from `@layoutit/polycss` in a React or Vue app** — use the framework
package, and take anything it does not re-export from `@layoutit/polycss-core`.

The one documented exception is `exportPolySceneSnapshot`, which lives only in
`@layoutit/polycss` because it is browser DOM serialization rather than
component API; React and Vue callers import it from there and pass the rendered
element. See [docs/api-index.md](/skill/docs/api-index.md).

The public API is mirrored between React and Vue: same names, same defaults,
idiomatic differences only (refs vs reactives).

## Imports

```ts
import {
  createPolyCamera,
  createPolyPerspectiveCamera,
  createPolyScene,
  createPolyOrbitControls,
  createPolyBox,
  createPolyPlane,
  loadMesh,
} from "@layoutit/polycss";
```

```tsx
import {
  PolyCamera,
  PolyPerspectiveCamera,
  PolyScene,
  PolyMesh,
  PolyGround,
  PolyOrbitControls,
  Poly,
} from "@layoutit/polycss-react"; // or "@layoutit/polycss-vue"
```

## Conventions

- Coordinates are PolyCSS world space `[x, y, z]` with **+Z up**. World Y maps
  to CSS X (screen-right at identity rotation) and world X to CSS Y
  (screen-down); the default camera (`rotX: 65, rotY: 45`) presents that as an
  isometric view.
- Camera rotations are degrees: `rotX`, `rotY`.
- `zoom` is on-screen CSS pixels per world unit (default `0.65`; orbit controls
  clamp to `0.1`–`10` by default). `BASE_TILE` (50) is the world-unit → CSS px
  factor; you need it when converting world units to raw CSS pixels yourself —
  e.g. `<poly-iframe width>` mounts a document `width × 50` px wide.
- `PolyCamera` / `createPolyCamera` are **orthographic** by default (this
  deliberately diverges from three.js). Use `PolyPerspectiveCamera` /
  `createPolyPerspectiveCamera` for depth foreshortening.
- The camera is the **outer** node; the scene nests inside it. CSS `perspective`
  only applies to descendants.
- **Do not infer names from a prefix rule.** `Poly` prefixing is a convention
  for newer renderer-facing components, hooks and types — not a description of
  the export inventory. Plenty of public names have no prefix: `loadMesh`,
  `parseObj` / `parseStl` / `parseGltf` / `parseVox`, every `*Polygons`
  generator, `BASE_TILE`, `LoopOnce` / `LoopRepeat` / `LoopPingPong`, the
  generic math types (`Vec2`, `Vec3`, `Polygon`), and the vanilla factories
  `createSelect` and `createTransformControls`. The `*/three` subpaths use
  Three-compatible names deliberately. Check
  [docs/api-index.md](/skill/docs/api-index.md) rather than guessing.

## Authoring polygons — the five silent failures

A `Polygon` is a plain object; `vertices` is the only required field.

```ts
interface Polygon {
  vertices: [number, number, number][];  // 3+ points, CCW seen from outside
  color?: string;                        // hex or rgb()/rgba() ONLY
  texture?: string;                      // image URL
  uvs?: [number, number][];              // one per vertex
  material?: PolyMaterial;               // shared material; material.texture wins over `texture`
  data?: Record<string, string | number | boolean>;  // → data-* attributes
}
```

These constraints fail with **no throw and no console warning**:

1. **Winding decides visibility.** Vertex order sets the normal by the
   right-hand rule (`(v1-v0) × (v2-v0)`), and PolyCSS backface-culls every leaf.
   Wind counter-clockwise as seen from the side you want to look at.
2. **`color` is not a full CSS color.** Only `#rgb`, `#rrggbb`, `rgb()`, and
   `rgba()` parse. `"tomato"`, `hsl()`, and `color()` render **white**.
3. **Non-triangular polygons must be coplanar**, or they are flattened onto
   their average plane and crack against their neighbours. Triangles are safe.
4. **The optimizer rewrites geometry by default** (`merge: true`,
   `meshResolution: "lossy"`). Pass `{ merge: false }` to render your array
   as authored.
5. **Degenerate polygons vanish silently** — under 3 vertices, zero area, or a
   degenerate first edge.

Read [docs/authoring-polygons.md](/skill/docs/authoring-polygons.md) in full before
generating geometry — it covers per-parser winding behaviour, which entry points
normalize, and the exact optimizer thresholds.

## Minimal scene

Vanilla:

```ts
const camera = createPolyCamera({ rotX: 65, rotY: 45 });
const scene = createPolyScene(document.getElementById("host")!, {
  camera,
  textureLighting: "dynamic",
  directionalLight: { direction: [0.5, -0.6, 0.7], color: "#ffffff", intensity: 1 },
  ambientLight: { color: "#ffffff", intensity: 0.35 },
});

createPolyOrbitControls(scene, { drag: true, wheel: true });

scene.add(createPolyBox({ size: 100, color: "#ffd166" }), { position: [0, 0, 50] });
scene.add(await loadMesh("/model.glb"), { castShadow: true });
// Vanilla has no ground fallback — a caster needs an explicit receiver.
scene.add(createPolyPlane({ axis: 2, size: 60, offset: 0, color: "#7d848e" }), { receiveShadow: true });
```

React (Vue mirrors this with kebab-case props):

```tsx
<PolyCamera rotX={65} rotY={45}>
  <PolyScene textureLighting="dynamic" ambientLight={{ intensity: 0.35 }}>
    <PolyOrbitControls drag wheel />
    <PolyMesh src="/model.glb" autoCenter castShadow />
    <PolyGround size={8} />
    {polygons.map((p, i) => <Poly key={i} {...p} onClick={() => select(i)} />)}
  </PolyScene>
</PolyCamera>
```

Custom elements (no build step):

```html
<script type="module" src="https://esm.sh/@layoutit/polycss/elements"></script>

<poly-camera rot-x="65" rot-y="45">
  <poly-scene>
    <poly-orbit-controls drag wheel></poly-orbit-controls>
    <poly-mesh src="/model.glb"></poly-mesh>
  </poly-scene>
</poly-camera>
```

## Rules of thumb

- **Polygon count is the dominant cost.** One visible polygon = one DOM leaf,
  one `matrix3d`, one paint. Halving polygon count beats every other
  optimisation.
- **Never run a `requestAnimationFrame` loop to update many leaves.** Camera,
  mesh, and light motion are single-ancestor CSS updates. If you find yourself
  writing a per-frame loop over polygons, you are fighting the engine.
- **Prefer `textureLighting: "dynamic"`** for live or animated lights (zero JS
  per light change). Prefer `"baked"` for point lights and maximum fidelity.
- **`scene.destroy()` and `result.dispose()`** release atlas blob URLs. The mesh
  element and `usePolyMesh` do it for you.

Full documentation: https://polycss.com
