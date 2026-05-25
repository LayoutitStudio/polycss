---
title: Controls
description: "Camera and object controls: orbit, map, first-person, and transform gizmos."
---

import { Tabs, TabItem } from '@astrojs/starlight/components';

PolyCSS ships additive controls that follow the three.js split:

- **`PolyOrbitControls`**: orbit-style drag (pointer drag rotates around the scene center) + wheel zoom + autorotate. This is the default pick for most scenes.
- **`PolyMapControls`**: map/pan-style drag (pointer drag pans the camera across the surface). Use for top-down or flat layouts.
- **`PolyFirstPersonControls`**: pointer-lock mouselook plus WASD / arrow movement, jump, and crouch.
- **`PolyTransformControls`**: translate / rotate gizmo for a selected mesh handle.

Camera controls mutate the wrapping `<poly-camera>` / `PolyCamera` state. Transform controls mutate the attached mesh handle via `setTransform`.

They are available as custom elements, imperative APIs, and React / Vue components.

## Orbit / Map Props

(React / Vue prop names use camelCase; the `<poly-orbit-controls>` / `<poly-map-controls>` custom elements accept the kebab-case form, e.g. `animate.speed` → `animate-speed`.)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `drag` | `boolean` | `true` | Pointer-drag rotation. Drag-right turns the front of the scene rightward, drag-down tilts the top toward the user: the visible object tracks the pointer. |
| `wheel` | `boolean` | `true` | Wheel / pinch zoom. Trackpad pinch is delivered as `wheel` with `ctrlKey=true`, so this covers desktop scroll + Mac pinch in one path. |
| `invert` | `boolean \| number` | `false` | Drag-direction inversion. `true` reverses; a number scales sensitivity in the default direction (negative = invert). |
| `minZoom` | `number` | `0.1` | Minimum zoom scale clamp. |
| `maxZoom` | `number` | `10` | Maximum zoom scale clamp. |
| `dolly` | `boolean` | `false` | When `true`, the wheel drives `distance` (dolly pull-back) instead of `zoom` scale. See **Dolly mode** below. |
| `minDistance` | `number` | `0` | Minimum distance clamp when `dolly` is enabled. |
| `maxDistance` | `number` | `5000` | Maximum distance clamp when `dolly` is enabled. |
| `animate` | `false \| { speed?, axis?, pauseOnInteraction? }` | `false` | Auto-rotate. Pass `false` (or omit) to disable. See **Animate options** below. |

### Animate options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `speed` | `number` | `0.3` | Degrees per 60 Hz-equivalent frame. The tick is `dt`-clamped (max 50 ms per frame), so `0.3` ≈ 18 deg/sec on every refresh rate. |
| `axis` | `"x" \| "y"` | `"y"` | Rotation axis. `"y"` orbits the camera horizontally; `"x"` tilts vertically. |
| `pauseOnInteraction` | `boolean` | `true` | Halt the animate loop while a pointer drag is in progress; resume on pointer-up. |

## Usage

### Basic: drag + wheel + slow autorotate

<Tabs syncKey="fw">
<TabItem label="Vanilla JS">
```html
<script type="module" src="https://esm.sh/@layoutit/polycss/elements"></script>

<poly-camera rot-x="65" rot-y="45">
  <poly-scene>
    <poly-orbit-controls drag wheel animate-speed="0.3"></poly-orbit-controls>
    <poly-torus color="#4ecdc4"></poly-torus>
  </poly-scene>
</poly-camera>
```

The presence of any `animate-*` attribute (`animate-speed`, `animate-axis`, `animate-pause-on-interaction`) implies `animate` is enabled. Removing them all turns animate off.
</TabItem>
<TabItem label="React">
```tsx
import { PolyCamera, PolyScene, PolyOrbitControls, PolyTorus } from "@layoutit/polycss-react";

export function App() {
  return (
    <PolyCamera rotX={65} rotY={45}>
      <PolyScene>
        <PolyOrbitControls drag wheel animate={{ speed: 0.3 }} />
        <PolyTorus color="#4ecdc4" />
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
      <PolyOrbitControls drag wheel :animate="{ speed: 0.3 }" />
      <PolyTorus color="#4ecdc4" />
    </PolyScene>
  </PolyCamera>
</template>

<script setup lang="ts">
import { PolyCamera, PolyScene, PolyOrbitControls, PolyTorus } from "@layoutit/polycss-vue";
</script>
```
</TabItem>
</Tabs>

### Imperative: vanilla JS

When you mount a scene through the `createPolyScene` imperative API, pair it with `createPolyOrbitControls(scene, options)`. The controls handle returns a small lifecycle interface for live updates.

```ts
import { createPolyCamera, createPolyScene, createPolyOrbitControls, createPolyTorus } from "@layoutit/polycss";

const camera = createPolyCamera({ rotX: 65, rotY: 45 });
const scene = createPolyScene(host, { camera });
scene.add(createPolyTorus({ color: "#4ecdc4" }));

const controls = createPolyOrbitControls(scene, {
  drag: true,
  wheel: true,
  animate: { speed: 0.3, axis: "y", pauseOnInteraction: true },
});

// Later: toggle features live without re-creating:
controls.update({ animate: false });    // stop auto-rotate
controls.update({ drag: false });        // also disable pointer drag

// Pause everything (detaches listeners + cancels rAF): reversible:
controls.pause();
controls.resume();

// Hard teardown:
controls.destroy();

// Three.js OrbitControls-style event subscription:
controls.addEventListener("change", (e) => console.log(e.camera));
controls.addEventListener("start", () => console.log("interaction begin"));
controls.addEventListener("end", () => console.log("interaction end"));
```

### Map / pan mode

Use `<poly-map-controls>` (or `createPolyMapControls`) when you want drag to pan the camera across a flat surface rather than orbit around the scene center.

<Tabs syncKey="fw">
<TabItem label="Vanilla JS">
```html
<poly-camera rot-x="90" rot-y="0">
  <poly-scene>
    <poly-map-controls drag wheel></poly-map-controls>
    <poly-mesh src="/terrain.glb"></poly-mesh>
  </poly-scene>
</poly-camera>
```
</TabItem>
<TabItem label="React">
```tsx
import { PolyCamera, PolyScene, PolyMapControls, PolyMesh } from "@layoutit/polycss-react";

export function App() {
  return (
    <PolyCamera rotX={90} rotY={0}>
      <PolyScene>
        <PolyMapControls drag wheel />
        <PolyMesh src="/terrain.glb" />
      </PolyScene>
    </PolyCamera>
  );
}
```
</TabItem>
</Tabs>

### Read-only / tour mode

Disable input but keep autorotate running:

<Tabs syncKey="fw">
<TabItem label="Vanilla JS">
```html
<poly-camera rot-x="65" rot-y="45">
  <poly-scene>
    <poly-orbit-controls drag="false" wheel="false" animate-speed="0.5"></poly-orbit-controls>
    <poly-dodecahedron size="100" color="#a78bfa"></poly-dodecahedron>
  </poly-scene>
</poly-camera>
```
</TabItem>
<TabItem label="React">
```tsx
<PolyOrbitControls drag={false} wheel={false} animate={{ speed: 0.5 }} />
```
</TabItem>
<TabItem label="Vue">
```vue
<PolyOrbitControls :drag="false" :wheel="false" :animate="{ speed: 0.5 }" />
```
</TabItem>
</Tabs>

### Inverted / sensitive drag

<Tabs syncKey="fw">
<TabItem label="Vanilla JS">
```html
<!-- 2× drag sensitivity -->
<poly-orbit-controls invert="2"></poly-orbit-controls>

<!-- Reverse direction -->
<poly-orbit-controls invert></poly-orbit-controls>
```
</TabItem>
<TabItem label="React">
```tsx
<PolyOrbitControls invert={2} />          {/* 2× sensitivity */}
<PolyOrbitControls invert />              {/* reverse */}
```
</TabItem>
</Tabs>

## Dolly mode

By default, the wheel adjusts `zoom`: a scale transform on the entire scene. Enable `dolly` to have the wheel adjust `distance` (a `translateZ` pull-back) instead. This mirrors three.js `OrbitControls` where the wheel changes the spherical radius around the target rather than scaling the projection.

When to use each:
- **Scale-zoom (default):** Good for 2D-map-style or isometric scenes where you want the scene to grow/shrink in place.
- **Dolly (`dolly={true}`):** Good for perspective scenes where depth foreshortening should stay consistent: the camera moves back rather than the scene shrinking.

```tsx
// React: dolly mode with clamped range
<PolyOrbitControls dolly minDistance={100} maxDistance={3000} />
```

```ts
// Vanilla: createPolyOrbitControls
const controls = createPolyOrbitControls(scene, {
  dolly: true,
  minDistance: 100,
  maxDistance: 3000,
});
```

## How it works

`PolyOrbitControls` and `PolyMapControls` are purely additive: they attach their own pointer/wheel listeners and run their own `requestAnimationFrame` loop when `animate` is on. In vanilla, state changes flow through `scene.setOptions(...)`; in React/Vue, they mutate the shared camera context and apply the transform directly.

The animate tick is `dt`-clamped at 50 ms per frame and normalized to 60 Hz. That makes `speed: 0.3` produce the same ~18 deg/sec on every monitor refresh rate (60, 120, 144 Hz) and survives a tab regaining focus without a giant catch-up jump.

## First-person Controls

Use `PolyFirstPersonControls` for walkable scenes. Click the scene to acquire pointer lock; Escape releases it. Movement is keyboard-driven (`WASD` / arrows, Space jump, Ctrl crouch) and mouselook updates camera pitch/yaw.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Master switch. |
| `lookEnabled` | `boolean` | `true` | Pointer-lock mouselook. |
| `moveEnabled` | `boolean` | `true` | WASD / arrow-key planar movement. |
| `jumpEnabled` | `boolean` | `true` | Space-bar jump arc. |
| `crouchEnabled` | `boolean` | `true` | Ctrl crouch. |
| `lookSensitivity` | `number` | `0.15` | Degrees per pointer pixel. |
| `invertY` | `boolean` | `false` | Invert vertical look. |
| `moveSpeed` | `number` | `5` | World units per second. |
| `jumpVelocity` | `number` | `7` | Initial jump velocity. |
| `gravity` | `number` | `18` | Jump gravity. |
| `eyeHeight` | `number` | `1.7` | Standing eye height above `groundZ`. |
| `crouchHeight` | `number` | `1` | Crouched eye height. |
| `groundZ` | `number` | `0` | Walk plane height. |
| `minPitch` / `maxPitch` | `number` | `5` / `175` | Pitch clamp in degrees. |

```tsx
import {
  PolyPerspectiveCamera,
  PolyScene,
  PolyFirstPersonControls,
  PolyMesh,
} from "@layoutit/polycss-react";

<PolyPerspectiveCamera perspective={1200} rotX={90} rotY={0}>
  <PolyScene>
    <PolyFirstPersonControls moveSpeed={8} eyeHeight={1.7} />
    <PolyMesh src="/level.glb" />
  </PolyScene>
</PolyPerspectiveCamera>
```

Imperative handles expose `lock()`, `unlock()`, `isLocked()`, `getOrigin()`, `setOrigin()`, `pause()`, `resume()`, `destroy()`, and `update(partial)`.

## Transform Controls

`PolyTransformControls` attaches to a `PolyMeshHandle` and renders a PolyCSS gizmo. Translate mode provides axis arrows and plane handles; rotate mode provides axis rings. Dragging updates the attached mesh directly and emits transform-change callbacks.

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

function Editor() {
  const [selected, setSelected] = useState<PolyMeshHandle | null>(null);

  return (
    <PolyCamera rotX={65} rotY={45}>
      <PolyScene>
        <PolySelect onChange={(meshes) => setSelected(meshes[0] ?? null)}>
          <PolyMesh id="asset" src="/model.glb" />
        </PolySelect>
        <PolyTransformControls object={selected} mode="translate" translationSnap={10} />
      </PolyScene>
    </PolyCamera>
  );
}
```

Key props: `object`, `mode`, `size`, `showX`, `showY`, `showZ`, `translationSnap`, `rotationSnap`, `enabled`, `onChange`, `onObjectChange`, `onMouseDown`, `onMouseUp`, and `onDraggingChanged`.

## Related

- [PolyScene](/components/poly-scene): The render root for meshes and polygons.
- [PolyCamera](/components/poly-camera): Required camera context wrapper for React / Vue scenes and controls.
- [Headless API: `createPolyOrbitControls`](/api/headless#createpolyorbitcontrols): Full imperative API reference.
