---
name: polycss
description: Build PolyCSS scenes that render 3D meshes, primitive shapes, or custom polygons as DOM/CSS polygon elements. Use when asked to create, port, debug, or explain PolyCSS code in vanilla JavaScript, React, or Vue.
---

# PolyCSS — DOM 3D Rendering

PolyCSS renders 3D polygon meshes as real DOM elements transformed with CSS
`matrix3d(...)`. It supports OBJ/MTL, STL, glTF/GLB, VOX, generated primitives,
colors, textures, dynamic lighting, shadows, controls, selection, animation, and
per-polygon interaction.

Use native PolyCSS when authoring PolyCSS-first scenes. Use the Three.js parity
API when porting Three.js code or generating code from Three-shaped examples.

## Native Imports

```ts
import {
  createPolyCamera,
  createPolyPerspectiveCamera,
  createPolyScene,
  createPolyOrbitControls,
  createPolyBox,
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
} from "@layoutit/polycss-react";
```

```ts
import {
  PolyCamera,
  PolyPerspectiveCamera,
  PolyScene,
  PolyMesh,
  PolyGround,
  PolyOrbitControls,
  Poly,
} from "@layoutit/polycss-vue";
```

## Native Conventions

- Coordinates are PolyCSS world space: `[x, y, z]`, **+X right, +Y forward,
  +Z up**.
- Camera rotations are degrees: `rotX`, `rotY`.
- `zoom` is on-screen CSS pixels per world unit (default `0.65`; orbit controls
  clamp to `0.1`–`10`). `BASE_TILE` (50) is the internal world-unit
  → CSS px factor, and matters only for APIs that take world units directly,
  like `<poly-iframe width>`.
- `PolyCamera` / `createPolyCamera` are orthographic by default.
- Use `PolyPerspectiveCamera` / `createPolyPerspectiveCamera` for perspective.

## Authoring Polygons — read before generating geometry

A `Polygon` is a plain object. `vertices` is the only required field.

```ts
interface Polygon {
  vertices: [number, number, number][];  // 3+ points, CCW seen from outside
  color?: string;                        // hex or rgb()/rgba() ONLY
  texture?: string;                      // image URL
  uvs?: [number, number][];              // one per vertex
  material?: PolyMaterial;               // shared material; material.texture wins over `texture`
  textureImageSource?: PolyTextureImageSource;    // source-exact image leaf (advanced)
  texturePresentation?: PolyTexturePresentation;  // per-polygon texture overrides (advanced)
  data?: Record<string, string | number | boolean>;  // → data-* attributes
}
```

Fields not listed here (`textureWrap`, `textureTriangles`, `doubleSided`, …) are
parser-internal — do not author them.

How much cleanup you get for free varies by parser and by entry point:

- **Winding:** STL repairs it from connectivity; `.vox` is correct by
  construction; **OBJ and glTF preserve source winding as-is**. All parsers
  fit to target size and normalize into PolyCSS Z-up coordinates. The axis
  transform is per-format: OBJ and glTF apply a cyclic `(x,y,z) → (z,x,y)`
  permutation (never a y↔z swap, so handedness is preserved); STL defaults to
  identity axes; `.vox` is already Z-up.
- **Validation:** only React/Vue `<PolyScene polygons>` runs
  `normalizePolygons` (drops degenerates, strips mismatched `uvs`, replaces bad
  colors with `#cccccc`, fan-triangulates non-coplanar n-gons) — and its
  warnings are never surfaced. `scene.add(...)`, `<PolyMesh polygons>`,
  `<Poly>`, and `<poly-polygon>` do **not** normalize.

So for hand-authored polygons these constraints fail *silently* — no throw, no
console warning:

**1. Winding decides visibility.** Vertex order sets the face normal by the
right-hand rule (`(v1-v0) × (v2-v0)`), and PolyCSS backface-culls every leaf. A
reversed face is invisible from the side you meant to show, and shades from the
flipped normal — typically ambient-only, since the directional term clamps at
zero (it darkens, it does not invert). It still casts — onto `receiveShadow`
meshes, or React/Vue's ground fallback — because shadow projection ignores
winding. Wind counter-clockwise as seen from the side you want to look at.

```ts
// Faces +Z (up) — visible from above.
{ vertices: [[0,0,0], [1,0,0], [1,1,0], [0,1,0]], color: "#d8d2c7" }
// Same quad reversed — faces -Z, invisible from above.
{ vertices: [[0,0,0], [0,1,0], [1,1,0], [1,0,0]], color: "#d8d2c7" }
```

Corollaries: solids wind outward but rooms/interiors wind inward; mirroring or
negative scale reverses handedness and requires reversing winding; reversing
vertices requires reversing `uvs` in the same order. `doubleSided` is
importer-internal and is **not** a render-time flag — it will not make a face
visible from behind.

*Diagnostic rule:* a single-sided face disappearing when the camera moves behind
it is correct behavior, not a bug. The winding symptom is a surface missing or
flickering **from the viewpoint it was built to be seen from** — it exists in
the data, its neighbours render, but it only shows from the opposite side. Then
inspect winding and normal before touching culling, lighting, or camera code.

**2. `color` is not a full CSS color.** Only `#rgb`, `#rrggbb`, `rgb()`, and
`rgba()` parse. Named colors (`"tomato"`), `hsl()`, and `color()` fail silently
— rendering **white**, or `#cccccc` on the normalizing `<PolyScene polygons>`
path.

**3. Non-triangular polygons must be coplanar.** On every path except
`<PolyScene polygons>`, a non-planar n-gon is flattened onto its average plane,
opening cracks against its neighbours; `<PolyScene polygons>` instead
fan-triangulates it, silently changing topology. Triangles are always safe.

**4. The optimizer rewrites geometry by default.** `merge` defaults to `true`
and `meshResolution` to `"lossy"`: coincident faces within `0.05` world units
are deduped, interior faces culled, and lossy merging starts at `0.35` world
units of plane displacement / `0.04` boundary / `15°` — but that is not the
ceiling: the optimizer also tries aggressive `30°`, `45°`, and `60°` variants
(the widest at `0.06` boundary), accepted on a material render-cost win. The
degree values are angular thresholds; the displacement budgets are absolute
world units. None are configurable. Dedupe and interior culling count as exact
reductions and still run under `meshResolution: "lossless"` — with one
parse-time exception: STL parse results force the lossless optimizer *and* pass
`skipInteriorCull`, but that protection does not survive into the renderer's own
pass, which culls again unless you set `merge: false`. `merge: false` renders
the array you pass
untouched, but only on `scene.add(...)` and `<PolyMesh polygons>` — it does not
exist on `<PolyScene polygons>` (always normalized + merged) or `<poly-mesh>`,
and it cannot undo `loadMesh`'s own parse-time optimization. There is no
exact-as-authored path for file geometry — the parsers normalize (fit to
`targetSize` `60`, origin reposition, per-format axis normalization, rounding,
fan-triangulation; STL repairs winding; `.vox` greedy-meshes quads). To preserve
the *direct parser output* from renderer optimization, call
`parseObj`/`parseStl`/`parseGltf`/`parseVox` directly and add with
`merge: false`.

**5. Degenerate polygons vanish silently** — under 3 vertices, zero-length edge,
or zero area produces no leaf and no console output.

## Building a Scene

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
```

React (Vue mirrors this with kebab-case props):

```tsx
<PolyCamera rotX={65} rotY={45}>
  <PolyOrbitControls drag wheel />
  <PolyScene textureLighting="dynamic" ambientLight={{ intensity: 0.35 }}>
    <PolyMesh src="/model.glb" autoCenter castShadow />
    <PolyGround size={8} />
    {polygons.map((p, i) => <Poly key={i} {...p} onClick={() => select(i)} />)}
  </PolyScene>
</PolyCamera>
```

**Primitives.** Vanilla `createPolyBox`, `createPolyPlane`, `createPolySphere`,
`createPolyCylinder`, `createPolyCone`, `createPolyTorus`, `createPolyRing`, and
the Platonic solids (`createPolyTetrahedron`, `createPolyOctahedron`,
`createPolyIcosahedron`, `createPolyDodecahedron`). Core exports the matching
`*Polygons` generators (`boxPolygons`, `spherePolygons`, …) that return raw
`Polygon[]`.

**Loading.** `loadMesh(url, opts)` handles `.obj` (+ `mtlUrl`), `.stl`, `.gltf`,
`.glb`, and `.vox`, and returns a `ParseResult` you pass to `scene.add(...)`.
In React/Vue use `<PolyMesh src>` or the `usePolyMesh` hook/composable.

**Controls.** Vanilla `createPolyOrbitControls`, `createPolyMapControls`,
`createPolyFirstPersonControls`, `createTransformControls`, `createSelect`.
React/Vue: `<PolyOrbitControls>`, `<PolyMapControls>`,
`<PolyFirstPersonControls>`, `<PolyTransformControls>`, `<PolySelect>` with
`usePolySelect` / `usePolySelectionApi`.

**Animation.** `usePolyAnimation` (React/Vue) drives imported skeletal clips.
Animated meshes need stable triangle topology: vanilla passes
`scene.add(mesh, { merge: false, stableDom: true })`; React/Vue pass
`merge={false}` — there is no `stableDom` prop, leaf identity across
same-topology frames is handled internally.

## Lighting

The scene takes one `directionalLight`, one `ambientLight`, and optional
`pointLights`. Directional `direction` is the vector from the surface *toward*
the light; it is normalized internally, so it need not be unit length. Point
lights are direction-only (no distance falloff) and shade flat per face.

Two modes, set via `textureLighting`:

- **`"baked"`** (default) — Lambert is computed on the CPU and multiplied into
  inline colors and atlas pixels. Best fidelity; supports point lights. Moving a
  light needs a rebake. **Vanilla does not auto-rebake** on a
  `setOptions({ directionalLight })` — call `mesh.rebakeAtlas()` explicitly
  (typically debounced to drag-end). React/Vue re-render and *do* auto-rebake.
- **`"dynamic"`** — lighting resolves in CSS `calc()` from scene-root custom
  properties. Moving a light is a few CSS variable writes, zero JS, no atlas
  redraw. **Point lights are ignored entirely in dynamic mode** — not for
  shading, not for shadows.

Prefer `"dynamic"` for live/animated lights; prefer `"baked"` for point lights,
maximum fidelity, and Three.js parity.

## Shadows

Cast shadows are CPU-projected SVG surfaces, not render-strategy leaves. Mark
casters with `castShadow` and receivers with `receiveShadow`; they work in both
lighting modes (dynamic mode is directional-only).

```ts
scene.add(model, { castShadow: true });
scene.add(floor, { receiveShadow: true });
scene.setOptions({ shadow: { color: "#000000", opacity: 0.3, parametric: true, definition: 32 } });
```

- **Receivers differ by renderer.** Vanilla has no ground fallback: a
  `castShadow` mesh draws nothing until some mesh has `receiveShadow: true`, so
  `scene.add(floor, { receiveShadow: true })` is required (the snippet above
  does this). React/Vue additionally project onto the scene ground plane
  automatically when no receiver exists — that is what `<PolyGround>` relies on
  (it has **no** `receiveShadow` prop) — and drop that fallback as soon as any
  receiver exists.
- `shadow.parametric: true` casts a low-resolution coverage silhouette per
  caster instead of full geometry — far cheaper. `definition` (default `16`)
  is the detail knob; `<PolyMesh shadowDefinition>` overrides it per mesh.
- `shadow.style: "vector" | "pixel"` — `"pixel"` gives blocky/voxel shadows.
- `shadow.followAnimation` — animated casters freeze their shadow by default;
  opt in to track the pose.
- `shadow.dragDefinition` is **vanilla only** (progressive refinement during a
  light drag). React/Vue get the same effect by lowering `definition` in state.

## Other Packages

- **`@layoutit/polycss-fonts`** — text → extruded 3D `Polygon[]`.
  `textPolygons(font, text, { depth, profile })` for basic extrusion,
  `composeText(...)` for the full multi-line/warp composer, plus
  `loadGoogleFont` / `listGoogleFonts`. Framework-agnostic.
- **`@layoutit/polycss-morph`** — prepared models with retained DOM.
  `@layoutit/polycss-morph/prepare` is Node-only authoring;
  `loadPolyMorphPackage` + `mountPolyMorphModel` run in the browser. The caller
  owns timing; morph does not schedule frames.
- **`@layoutit/polycss-core`** — pure math/parsers with zero browser globals,
  for Node build steps and workers.

## Three.js Parity Imports

Use these when the scene is described in Three.js terms:

```ts
import {
  PerspectiveCamera,
  OrthographicCamera,
  Object3D,
  Vector3,
  DirectionalLight,
  PointLight,
  AmbientLight,
  transformPolygonsToPoly,
  mountPolyThreeScene,
} from "@layoutit/polycss/three";
```

React:

```tsx
import {
  PolyThreePerspectiveCamera,
  PolyThreeOrthographicCamera,
  PolyThreeMesh,
  DirectionalLight,
} from "@layoutit/polycss-react/three";
```

Vue:

```ts
import {
  PolyThreePerspectiveCamera,
  PolyThreeOrthographicCamera,
  PolyThreeMesh,
  DirectionalLight,
} from "@layoutit/polycss-vue/three";
```

## Three.js Parity Conventions

- Coordinates are Three/Y-up authoring space.
- Object rotations are radians, XYZ Euler.
- Cameras are `PerspectiveCamera(fov, aspect, near, far)` or
  `OrthographicCamera(left, right, top, bottom, near, far)`.
- Frame with `camera.position.set(...)` and `camera.lookAt(...)`.
- Directional lights use the Three.js source vector, `light.target.position` → `light.position`.
- Geometry converts internally with the right-handed axis map `[x, -z, y]`, so
  winding and Lambert lighting stay correct.
- `mountPolyThreeScene(...)` defaults to baked lighting for Three parity.
  Use `textureLighting: "dynamic"` only when live CSS light changes matter more
  than strict conformance.

## React Parity Example

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
      <PolyScene
        ambientLight={{ intensity: 0.35 }}
        directionalLight={sun.toPolyDirectionalLight()}
      >
        <PolyThreeMesh
          src="/models/cube.glb"
          position={[0, 0.5, 0]}
          rotation={[0, Math.PI / 4, 0]}
        />
      </PolyScene>
    </PolyThreePerspectiveCamera>
  );
}
```

## Vanilla Parity Example

```ts
import {
  Object3D,
  PerspectiveCamera,
  boxPolygons,
  mountPolyThreeScene,
  transformPolygonsToPoly,
} from "@layoutit/polycss/three";

const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
camera.position.set(3, 2, 5);
camera.lookAt(0, 0, 0);

const object = new Object3D();
object.rotation.set(0, Math.PI / 4, 0);

mountPolyThreeScene(document.querySelector("#scene")!, {
  camera,
  cameraOptions: { viewportHeight: 420 },
  polygons: transformPolygonsToPoly(
    boxPolygons({ size: 1, color: "#66aaff" }),
    object,
  ),
});
```

Full docs: https://polycss.com/api/three-parity
Authoring reference: https://polycss.com/core-concepts#authoring-polygons
