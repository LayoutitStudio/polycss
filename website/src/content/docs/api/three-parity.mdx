---
title: Three.js Parity API
description: Three-like cameras, transforms, and framework components for porting Three.js scenes to PolyCSS.
---

The `*/three` subpaths expose a Three-like authoring surface on top of PolyCSS.
Use them when you are porting a Three.js scene, writing docs for coding agents,
or want familiar `PerspectiveCamera`, `Object3D`, `Vector3`, `lookAt`, and
radian-based mesh transforms.

This is still PolyCSS: it renders DOM polygon leaves with CSS transforms. It does
not run Three.js at runtime, and it does not use WebGL. The parity API matches
Three's parameter surface closely enough that the same scene math frames the same
object with the same projection, orientation, depth ordering, and light
direction.

## Imports

| Package | Import | Use |
|---|---|---|
| Core math | `@layoutit/polycss-core/three` | Three-like classes and coordinate transforms |
| Vanilla | `@layoutit/polycss/three` | Core parity surface plus scene mounting, mesh loading, and geometry helpers |
| React | `@layoutit/polycss-react/three` | React components and parity classes |
| Vue | `@layoutit/polycss-vue/three` | Vue components and parity classes |

## Conventions

The native PolyCSS API uses PolyCSS conventions: Z-up scene math, camera rotations
in degrees, and `zoom` as CSS pixels per world unit.

The `*/three` subpaths intentionally use Three-style conventions:

| Value | `*/three` convention |
|---|---|
| Coordinates | Y-up authoring space |
| Mesh rotations | Radians, XYZ Euler |
| Cameras | Three-like `PerspectiveCamera(fov, aspect, near, far)` and `OrthographicCamera(left, right, top, bottom, near, far)` |
| Camera targeting | `camera.position.set(...)` + `camera.lookAt(...)` |
| Directional lights | Three.js source vector: `light.target.position` → `light.position` |
| Point lights | `light.position` in Three/Y-up space |
| Vanilla lighting default | `mountPolyThreeScene(...)` defaults to `textureLighting: "baked"` |

Internally, geometry is converted into PolyCSS space with
`transformPolygonsToPoly`. The axis conversion is right-handed, so polygon
winding and Lambert lighting stay correct.

Polygon arrays passed to `transformPolygonsToPoly` or `<PolyThreeMesh>` are
interpreted as Three/Y-up coordinates. If you already have native PolyCSS
polygons with their own native transform, render them with the native API instead
of converting them again.

For Three parity, use baked lighting as the baseline. It computes the final
Lambert face color through the same directional/ambient intensity surface used
by the Three-like light adapters. Dynamic lighting is still available by passing
`textureLighting: "dynamic"`, but it is a live CSS-lighting path for interactive
light changes, not the strict conformance mode.

## Vanilla example

`@layoutit/polycss/three` is the smallest path for plain JavaScript demos, tests,
CLIs, and agent-generated snippets. The scene below is authored with Three-like
camera and transform objects, then mounted into a DOM host by PolyCSS.

```ts
import {
  AmbientLight,
  DirectionalLight,
  Object3D,
  PerspectiveCamera,
  boxPolygons,
  mountPolyThreeScene,
  transformPolygonsToPoly,
} from "@layoutit/polycss/three";

const host = document.querySelector("#scene")!;

const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
camera.position.set(3, 2, 5);
camera.lookAt(0, 0, 0);

const object = new Object3D();
object.position.set(0, 0.5, 0);
object.rotation.set(0, Math.PI / 4, 0);
object.scale.set(1, 1, 1);

const sun = new DirectionalLight("#ffffff", 1);
sun.position.set(3, 5, 4);
sun.target.position.set(0, 0, 0);

const polygons = transformPolygonsToPoly(
  boxPolygons({ size: 1, color: "#66aaff" }),
  object,
);

mountPolyThreeScene(host, {
  camera,
  cameraOptions: { viewportHeight: 420 },
  polygons,
  ambientLight: new AmbientLight("#ffffff", 0.35).toPolyAmbientLight(),
  directionalLight: sun.toPolyDirectionalLight(),
});
```

## React example

The React parity components wrap the normal `<PolyScene>`. Keep the scene and
controls from `@layoutit/polycss-react`, and import the Three-like cameras /
meshes from `@layoutit/polycss-react/three`.

```tsx
import { PolyOrbitControls, PolyScene } from "@layoutit/polycss-react";
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
        <PolyOrbitControls drag wheel />
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

`<PolyThreeMesh>` accepts `polygons` or `src` like the native `<PolyMesh>`.
It also supports scene mesh options such as `castShadow`, `receiveShadow`,
texture options, `meshResolution`, and `merge`.

## Vue example

Vue mirrors the React parity surface.

```vue
<script setup lang="ts">
import { PolyOrbitControls, PolyScene } from "@layoutit/polycss-vue";
import {
  DirectionalLight,
  PolyThreeMesh,
  PolyThreePerspectiveCamera,
} from "@layoutit/polycss-vue/three";

const sun = new DirectionalLight("#ffffff", 1);
sun.position.set(3, 5, 4);
sun.target.position.set(0, 0, 0);
</script>

<template>
  <PolyThreePerspectiveCamera
    :fov="50"
    :aspect="16 / 9"
    :position="[3, 2, 5]"
    :look-at="[0, 0, 0]"
  >
    <PolyScene
      :ambient-light="{ intensity: 0.35 }"
      :directional-light="sun.toPolyDirectionalLight()"
    >
      <PolyOrbitControls drag wheel />
      <PolyThreeMesh
        src="/models/cube.glb"
        :position="[0, 0.5, 0]"
        :rotation="[0, Math.PI / 4, 0]"
      />
    </PolyScene>
  </PolyThreePerspectiveCamera>
</template>
```

## Core exports

All `*/three` subpaths share these core exports:

| Export | Purpose |
|---|---|
| `Vector3` | Minimal Three-like vector class used by cameras, objects, and lights |
| `Euler` | XYZ Euler rotation in radians |
| `Object3D` | `position`, `rotation`, `scale`, `up`, `lookAt`, and `localToWorld` |
| `PerspectiveCamera` | Three-like perspective camera that PolyCSS can render with |
| `OrthographicCamera` | Three-like orthographic camera that PolyCSS can render with |
| `DirectionalLight` | Three-like positioned light with `target`, convertible to PolyCSS light options |
| `PointLight` | Three-like point light, convertible to PolyCSS point-light options |
| `AmbientLight` | Ambient light helper, convertible to PolyCSS light options |
| `threeToPolyPoint` / `polyToThreePoint` | Convert individual points between coordinate spaces |
| `threeToPolyDirection` / `polyToThreeDirection` | Convert direction vectors between coordinate spaces |
| `transformPointToPoly` | Apply an `Object3D` transform to one point and convert it |
| `transformPolygonsToPoly` | Apply an `Object3D` transform to a `Polygon[]` and convert it |

## When not to use it

Use the native API when you are building PolyCSS-first scenes, DOM inspection
demos, builder output, or examples where degree-based `rotX` / `rotY` camera
controls are more direct. The parity API is for Three-shaped scene authoring and
ports; it is not a replacement for native PolyCSS controls or custom elements.
