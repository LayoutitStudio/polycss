# Three.js Parity

Use the explicit `*/three` subpaths when porting a Three.js scene or generating
code from Three-shaped examples. They are **adapters over PolyCSS**, not a
Three.js runtime dependency — `three` is not installed.

| Subpath | Contents |
|---|---|
| `@layoutit/polycss-core/three` | Pure math wrappers, camera conversion, lights, transforms. |
| `@layoutit/polycss/three` | The core surface plus vanilla scene helpers (`mountPolyThreeScene`). |
| `@layoutit/polycss-react/three` | `PolyThreePerspectiveCamera`, `PolyThreeOrthographicCamera`, `PolyThreeMesh`. |
| `@layoutit/polycss-vue/three` | Same three components. |

Three-compatible names are the point here, so these subpaths deliberately break
the `Poly` prefix rule — except the React/Vue components, which keep a
`PolyThree` prefix.

## Conventions inside the parity surface

- Coordinates are **Y-up** Three authoring space.
- Object rotations are **radians**, XYZ Euler.
- Cameras are `PerspectiveCamera(fov, aspect, near, far)` or
  `OrthographicCamera(left, right, top, bottom, near, far)`.
- Frame with `camera.position.set(...)` and `camera.lookAt(...)`.
- Directional lights use the Three source vector,
  `light.target.position` → `light.position`.
- Geometry converts to native PolyCSS coordinates with
  `transformPolygonsToPoly`; the Y-up → Z-up axis map is `[x, -z, y]`, so
  winding and Lambert lighting stay right-handed.

Do **not** mix conventions. Inside a parity scene, keep radians and Y-up; the
adapter handles the conversion once.

## Lighting mode

`mountPolyThreeScene(...)` defaults `textureLighting` to `"baked"` because baked
Lambert is the Three-parity baseline. Dynamic lighting remains available as an
explicit opt-in for live CSS light changes, but it is not the exact conformance
mode.

## Imports

```ts
import {
  PerspectiveCamera,
  OrthographicCamera,
  Object3D,
  Vector3,
  Euler,
  DirectionalLight,
  PointLight,
  AmbientLight,
  transformPolygonsToPoly,
  mountPolyThreeScene,
} from "@layoutit/polycss/three";
```

```tsx
import {
  PolyThreePerspectiveCamera,
  PolyThreeOrthographicCamera,
  PolyThreeMesh,
  DirectionalLight,
} from "@layoutit/polycss-react/three"; // or "@layoutit/polycss-vue/three"
```

## Vanilla example

```ts
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

## React example

The parity camera wraps a normal `PolyScene`; lights convert with
`toPolyDirectionalLight()`.

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
      <PolyScene
        ambientLight={{ intensity: 0.35 }}
        directionalLight={sun.toPolyDirectionalLight()}
      >
        <PolyThreeMesh src="/models/cube.glb" position={[0, 0.5, 0]} rotation={[0, Math.PI / 4, 0]} />
      </PolyScene>
    </PolyThreePerspectiveCamera>
  );
}
```

## What does not carry over

The parity surface covers cameras, transforms, lights, and geometry conversion.
It is not a Three.js runtime: materials, shaders, post-processing, raycasting
semantics, and scene-graph traversal are PolyCSS's, not Three's. When a Three
feature has no PolyCSS equivalent, express the intent in native PolyCSS terms
rather than reaching for a missing shim.

Full reference: https://polycss.com/api/three-parity
