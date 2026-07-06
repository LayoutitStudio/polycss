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
  loadMesh,
} from "@layoutit/polycss";
```

```tsx
import {
  PolyCamera,
  PolyPerspectiveCamera,
  PolyScene,
  PolyMesh,
  PolyOrbitControls,
} from "@layoutit/polycss-react";
```

```ts
import {
  PolyCamera,
  PolyPerspectiveCamera,
  PolyScene,
  PolyMesh,
  PolyOrbitControls,
} from "@layoutit/polycss-vue";
```

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

## Native Conventions

- Coordinates are PolyCSS world space: `[x, y, z]`, with Z up.
- Camera rotations are degrees: `rotX`, `rotY`.
- `zoom` is CSS pixels per world unit.
- `PolyCamera` / `createPolyCamera` are orthographic by default.
- Use `PolyPerspectiveCamera` / `createPolyPerspectiveCamera` for perspective.

## Three.js Parity Conventions

- Coordinates are Three/Y-up authoring space.
- Object rotations are radians, XYZ Euler.
- Cameras are `PerspectiveCamera(fov, aspect, near, far)` or
  `OrthographicCamera(left, right, top, bottom, near, far)`.
- Frame with `camera.position.set(...)` and `camera.lookAt(...)`.
- Directional lights use the Three.js source vector, `light.target.position` → `light.position`.
- Geometry converts internally with the right-handed axis map `[x, -z, y]`, so
  winding and Lambert lighting stay correct.

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
