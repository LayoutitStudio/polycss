---
title: Per-polygon Interaction
description: Using the Poly component for per-polygon click handlers, hover states, and CSS styling.
---

import { Tabs, TabItem } from '@astrojs/starlight/components';
import PolyDemo from '../../../components/PolyDemo.astro';

Every polygon rendered by PolyCSS is a real DOM element. You can attach standard event handlers, apply CSS classes, and inspect them in DevTools: that's true regardless of which entry point you use. The single-polygon primitive is `<poly-polygon>` (vanilla custom element) / `<Poly>` (React, Vue).

## Live demo: interactive scene

<PolyDemo
  id="shapes-mesh-demo"
  model="/gallery/glb/apocalypse/barrel.glb"
  controls='["zoom","rotX","rotY","perspective","animate"]'
  defaults='{"rotX":65,"rotY":45,"zoom":0.08}'
/>

## Box helper

Use `boxPolygons()` when your shape is an axis-aligned box or cuboid. It returns ordinary `Polygon[]`, so the result renders through the same `<PolyMesh>` / `createPolyScene()` path as parsed OBJ, STL, GLB, and VOX meshes.

```ts
import { boxPolygons } from "@layoutit/polycss-react";

const polygons = boxPolygons({
  min: [0, 0, 0],
  max: [2, 1, 0.5],
  color: "#d8d2c7",
  data: { tileId: "tile-1" },
  faces: {
    top: { texture: "/tile.png", data: { face: "top" } },
    bottom: false,
  },
});
```

## Primitive shape exports

PolyCSS ships built-in shape components for common primitives. React and Vue export `PolyBox`, `PolyPlane`, `PolyRing`, `PolyOctahedron`, `PolySphere`, `PolyTetrahedron`, `PolyIcosahedron`, `PolyDodecahedron`, `PolyCylinder`, `PolyCone`, and `PolyTorus`. The vanilla package exports matching ParseResult factories: `createPolyBox`, `createPolyPlane`, `createPolyRing`, `createPolyOctahedron`, `createPolySphere`, `createPolyTetrahedron`, `createPolyIcosahedron`, `createPolyDodecahedron`, `createPolyCylinder`, `createPolyCone`, and `createPolyTorus`.

Shape components accept their geometry options plus the common mesh props (`position`, `scale`, `rotation`, `autoCenter`, `id`, and event props where supported).

When you need raw polygon arrays, use the core generators directly: `boxPolygons`, `planePolygons`, `ringPolygons`, `octahedronPolygons`, `spherePolygons`, `tetrahedronPolygons`, `icosahedronPolygons`, `dodecahedronPolygons`, `cylinderPolygons`, `conePolygons`, `torusPolygons`, `axesHelperPolygons`, and `arrowPolygons`.

```tsx
import { PolyCamera, PolyScene, PolyBox, PolySphere, PolyTorus } from "@layoutit/polycss-react";

<PolyCamera rotX={65} rotY={45}>
  <PolyScene>
    <PolyBox size={80} color="#ffd166" />
    <PolySphere radius={0.9} color="#7dd3fc" position={[120, 0, 0]} />
    <PolyTorus radius={1.2} tube={0.35} color="#4ecdc4" position={[-120, 0, 0]} />
  </PolyScene>
</PolyCamera>
```

## The polygon primitive

`<poly-polygon>` (vanilla) and `<Poly>` (React / Vue) render a single polygon as one internal leaf element. The renderer picks the cheapest strategy for that polygon: solid CSS primitives where possible, atlas slices for textured or irregular faces. They forward standard DOM props (`onclick`, `class`, `style`, `aria-*`, etc.).

<Tabs syncKey="fw">
<TabItem label="Vanilla JS">
```html
<script type="module" src="https://esm.sh/@layoutit/polycss/elements"></script>

<poly-camera rot-x="65" rot-y="45">
  <poly-scene>
    <!-- Vertices are JSON arrays in the `vertices` attribute. -->
    <poly-polygon vertices='[[0,0,0],[1,0,0],[0,1,0]]' color="#ff0000"></poly-polygon>
    <poly-polygon
      vertices='[[0,0,0],[1,0,0],[0,1,0]]'
      color="#0000ff"
      texture="/wood.png"
      uvs='[[0,0],[1,0],[0,1]]'></poly-polygon>
  </poly-scene>
</poly-camera>
```
</TabItem>
<TabItem label="React">
```tsx
import { PolyCamera, PolyScene, Poly } from "@layoutit/polycss-react";
import type { Vec3 } from "@layoutit/polycss-react";

const triangle: Vec3[] = [[0,0,0], [1,0,0], [0,1,0]];

<PolyCamera rotX={65} rotY={45}>
  <PolyScene>
    <Poly vertices={triangle} color="#ff0000" />
    <Poly vertices={triangle} color="#0000ff" texture="/wood.png" uvs={[...]} />
  </PolyScene>
</PolyCamera>
```
</TabItem>
</Tabs>

## Interactive per-polygon example

<Tabs syncKey="fw">
<TabItem label="Vanilla JS">
```html
<script type="module" src="https://esm.sh/@layoutit/polycss/elements"></script>

<style>
  .highlight { filter: brightness(1.5); }
  poly-polygon { transition: filter 0.2s; }
</style>

<poly-camera rot-x="65" rot-y="45">
  <poly-scene id="scene">
    <!-- Polygons are appended programmatically. -->
  </poly-scene>
</poly-camera>

<script type="module">
  const scene = document.getElementById("scene");
  const polygons = /* Polygon[] from your data source */ [];

  for (let i = 0; i < polygons.length; i++) {
    const p = polygons[i];
    const el = document.createElement("poly-polygon");
    el.setAttribute("vertices", JSON.stringify(p.vertices));
    if (p.color) el.setAttribute("color", p.color);
    el.addEventListener("click", () => alert(`clicked polygon ${i}`));
    el.addEventListener("mouseenter", () => el.classList.add("highlight"));
    el.addEventListener("mouseleave", () => el.classList.remove("highlight"));
    scene.appendChild(el);
  }
</script>
```
</TabItem>
<TabItem label="React">
```tsx
import { useState } from "react";
import { PolyCamera, PolyScene, Poly } from "@layoutit/polycss-react";
import type { Polygon } from "@layoutit/polycss-react";

export function InteractiveMesh({ polygons }: { polygons: Polygon[] }) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  return (
    <PolyCamera rotX={65} rotY={45}>
      <PolyScene>
        {polygons.map((p, i) => (
          <Poly
            key={i}
            {...p}
            onClick={() => alert(`clicked polygon ${i}`)}
            onMouseEnter={() => setHoveredId(i)}
            onMouseLeave={() => setHoveredId(null)}
            className={hoveredId === i ? "highlight" : ""}
            style={{ transition: "filter 0.2s" }}
          />
        ))}
      </PolyScene>
    </PolyCamera>
  );
}
```
```css
/* highlight.css */
.highlight { filter: brightness(1.5); }
```
</TabItem>
<TabItem label="Vue">
```vue
<template>
  <PolyCamera :rot-x="65" :rot-y="45">
    <PolyScene>
      <Poly
        v-for="(p, i) in polygons"
        :key="i"
        v-bind="p"
        @click="onClickPoly(i)"
        @mouseenter="hoveredId = i"
        @mouseleave="hoveredId = null"
        :class="{ highlight: hoveredId === i }"
      />
    </PolyScene>
  </PolyCamera>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { PolyCamera, PolyScene, Poly } from "@layoutit/polycss-vue";
import type { Polygon } from "@layoutit/polycss-vue";

defineProps<{ polygons: Polygon[] }>();
const hoveredId = ref<number | null>(null);
const onClickPoly = (i: number) => alert(`clicked polygon ${i}`);
</script>

<style>
.highlight { filter: brightness(1.5); }
</style>
```
</TabItem>
</Tabs>

## Shared materials

Use `material` when multiple polygons share the same texture identity. React and Vue export `usePolyMaterial` to keep that material object stable across rerenders, which is useful with memoized polygon lists or `<Poly>` children.

```tsx
import { usePolyMaterial, Poly } from "@layoutit/polycss-react";

const material = usePolyMaterial({ texture: "/stone.png", key: "stone" });

<Poly vertices={vertices} material={material} uvs={uvs} />;
```

```vue
<script setup lang="ts">
import { usePolyMaterial } from "@layoutit/polycss-vue";

const material = usePolyMaterial({ texture: "/stone.png", key: "stone" });
</script>
```

## Per-polygon override (mesh + custom render)

To customize specific polygons inside a loaded mesh, use:

- **Vanilla:** load with `loadMesh`, then add one mesh handle per polygon. You stay in full control of which polygons get special handling.
- **React:** the `<PolyMesh>` render-prop child.
- **Vue:** the `<PolyMesh>` scoped slot.

<Tabs syncKey="fw">
<TabItem label="Vanilla JS">
```ts
  import { loadMesh, createPolyCamera, createPolyScene } from "@layoutit/polycss";

  const host = document.getElementById("scene-host");
  const camera = createPolyCamera({ rotX: 65, rotY: 45 });
  const scene = createPolyScene(host, { camera });

  const result = await loadMesh("/character.glb");
  const handles = result.polygons.map((polygon, i) => {
    const handle = scene.add(
      { polygons: [polygon], objectUrls: [], warnings: [], dispose: () => {} },
      { id: `polygon-${i}`, merge: false },
    );
    handle.element.addEventListener("click", () => {
      handle.element.classList.toggle("outlined");
    });
    return handle;
  });

  // later:
  handles.forEach(handle => handle.remove());
  scene.destroy();
  result.dispose();
```
</TabItem>
<TabItem label="React">
```tsx
import { useState } from "react";
import { PolyCamera, PolyScene, PolyMesh, Poly } from "@layoutit/polycss-react";

export function SelectableMesh() {
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <PolyCamera rotX={65} rotY={45}>
      <PolyScene>
        <PolyMesh src="/character.glb" position={[5, 0, 0]} scale={2}>
          {(polygon, index) => (
            <Poly
              {...polygon}
              onClick={() => setSelected(index)}
              className={selected === index ? "outlined" : ""}
            />
          )}
        </PolyMesh>
      </PolyScene>
    </PolyCamera>
  );
}
```
</TabItem>
<TabItem label="Vue">
```vue
<template>
  <PolyCamera :rot-x="65" :rot-y="45">
    <PolyScene>
      <PolyMesh src="/character.glb" :position="[5, 0, 0]" :scale="2">
        <template #polygon="{ polygon, index }">
          <Poly
            v-bind="polygon"
            @click="selected = index"
            :class="{ outlined: selected === index }"
          />
        </template>
      </PolyMesh>
    </PolyScene>
  </PolyCamera>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { PolyCamera, PolyScene, PolyMesh, Poly } from "@layoutit/polycss-vue";
const selected = ref<number | null>(null);
</script>
```
</TabItem>
</Tabs>

## Mesh selection

For whole-mesh selection, use `PolySelect` / `<poly-select>` instead of wiring every polygon manually. It tracks selected `PolyMeshHandle`s, supports multi-select, and exposes an imperative selection API for sidebars and transform gizmos.

```tsx
import { useState } from "react";
import {
  PolyCamera,
  PolyScene,
  PolyMesh,
  PolySelect,
  PolyTransformControls,
  type PolyMeshHandle,
} from "@layoutit/polycss-react";

export function SelectAndMove() {
  const [selected, setSelected] = useState<PolyMeshHandle | null>(null);

  return (
    <PolyCamera rotX={65} rotY={45}>
      <PolyScene>
        <PolySelect multiple={false} onChange={(meshes) => setSelected(meshes[0] ?? null)}>
          <PolyMesh id="cottage" src="/cottage.glb" />
        </PolySelect>
        <PolyTransformControls object={selected} mode="translate" />
      </PolyScene>
    </PolyCamera>
  );
}
```

Use `usePolySelect()` to read the current selection inside a React subtree and `usePolySelectionApi()` when a nested toolbar needs to call `set`, `add`, `remove`, `toggle`, or `clear`.

For lower-level DOM tools, React and Vue also export `findPolyMeshHandle(el)`, `pointInMeshElement(meshEl, clientX, clientY)`, and `findMeshUnderPoint(clientX, clientY, filter?)`. They resolve rendered DOM hits back to `PolyMeshHandle`s and use the same bounding-rect fallback that selection and transform controls use for clipped polygon leaves.

## Imperative loading

Load a mesh programmatically when you need control over loading state. The vanilla `loadMesh` is the universal path; React adds a `usePolyMesh` hook on top that auto-disposes on unmount.

```ts
// Vanilla: works in any framework or no framework
import { loadMesh, createPolyCamera, createPolyScene } from "@layoutit/polycss";

const camera = createPolyCamera({ rotX: 65, rotY: 45 });
const scene = createPolyScene(document.getElementById("host")!, { camera });
const result = await loadMesh("/model.glb");
scene.add(result);
// ... later:
scene.destroy(); // removes the scene and disposes registered meshes
```

```tsx
// React
import { PolyCamera, PolyScene, Poly, usePolyMesh } from "@layoutit/polycss-react";

function Viewer() {
  const { polygons, loading, error } = usePolyMesh("/model.glb");

  if (loading) return <Spinner />;
  if (error) return <div>Error: {error}</div>;

  return (
    <PolyCamera>
      <PolyScene>
        {polygons.map((p, i) => <Poly key={i} {...p} />)}
      </PolyScene>
    </PolyCamera>
  );
}
```

## Related

- [PolyScene](/components/poly-scene): Scene props and polygon data reference.
- [Loading Meshes](/guides/textures): OBJ, STL, glTF, GLB, VOX, MTL loading and UV textures.
- [Performance](/guides/performance): Merge modes and DOM tuning.
