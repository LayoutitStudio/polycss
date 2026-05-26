---
title: Animation
description: Playing glTF and GLB animation clips with PolyCSS mesh handles.
---

import { Tabs, TabItem } from '@astrojs/starlight/components';

PolyCSS can play usable glTF / GLB animation clips by sampling them into polygon frames. The parser exposes `ParseResult.animation`; `usePolyAnimation` and `createPolyAnimationMixer` drive a mesh handle over time.

## How It Works

Animation in PolyCSS is a polygon-frame pipeline: the parser turns glTF / GLB animation data into a sampler, and the renderer receives ordinary `Polygon[]` frames.

When `loadMesh()` or `parseGltf()` finds usable animation clips, the returned `ParseResult.animation` exposes clip metadata and a `sample()` function. Sampling evaluates the source animation at a given time, applies the animated pose to the mesh, and returns polygons for that moment.

`usePolyAnimation` and `createPolyAnimationMixer` sit on top of that sampler. They manage actions, looping, playback speed, fades, and cross-fades, then apply each sampled frame to a mesh handle.

## Usage

<Tabs syncKey="fw">
<TabItem label="Vanilla JS">
Use the core mixer directly. The mesh handle returned by `scene.add()` satisfies `PolyAnimationTarget`.

```ts
import {
  createPolyCamera,
  createPolyScene,
  createPolyAnimationMixer,
  loadMesh,
} from "@layoutit/polycss";

const camera = createPolyCamera({ rotX: 65, rotY: 45 });
const scene = createPolyScene(host, { camera });
const result = await loadMesh("/character.glb", { meshResolution: "lossless" });
const mesh = scene.add(result, { merge: false, stableDom: true });

if (result.animation?.clips.length) {
  const mixer = createPolyAnimationMixer(mesh, result.animation);
  mixer.clipAction(result.animation.clips[0].name).reset().play();

  let last = performance.now();
  function tick(now: number) {
    mixer.update((now - last) / 1000);
    last = now;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
```
</TabItem>
<TabItem label="React">
`usePolyAnimation` mirrors drei's `useAnimations`: it returns `clips`, `names`, `actions`, `mixer`, and a `ref`. Load the mesh yourself when you need access to both `polygons` and the parser's animation controller.

```tsx
import { useEffect, useRef, useState } from "react";
import {
  PolyCamera,
  PolyScene,
  PolyMesh,
  PolyOrbitControls,
  loadMesh,
  usePolyAnimation,
  type ParseResult,
  type PolyMeshHandle,
} from "@layoutit/polycss-react";

export function AnimatedModel() {
  const [result, setResult] = useState<ParseResult | null>(null);
  const meshRef = useRef<PolyMeshHandle | null>(null);
  const { actions, names } = usePolyAnimation(
    result?.animation?.clips,
    result?.animation,
    meshRef,
  );

  useEffect(() => {
    let cancelled = false;
    let active: ParseResult | null = null;
    loadMesh("/character.glb").then((next) => {
      active = next;
      if (cancelled) next.dispose();
      else setResult(next);
    });
    return () => {
      cancelled = true;
      active?.dispose();
    };
  }, []);

  useEffect(() => {
    const first = names[0];
    if (!first) return;
    actions[first]?.reset().play();
  }, [actions, names]);

  return (
    <PolyCamera rotX={65} rotY={45}>
      <PolyScene>
        <PolyOrbitControls drag wheel />
        {result && (
          <PolyMesh
            ref={meshRef}
            polygons={result.polygons}
            meshResolution="lossless"
          />
        )}
      </PolyScene>
    </PolyCamera>
  );
}
```
</TabItem>
<TabItem label="Vue">

The Vue composable exposes the same concepts as the React hook, but `clips`, `names`, `actions`, and `mixer` are Vue computed refs.

```vue
<template>
  <PolyCamera :rot-x="65" :rot-y="45">
    <PolyScene>
      <PolyOrbitControls drag wheel />
      <PolyMesh
        v-if="result"
        ref="meshRef"
        :polygons="result.polygons"
        mesh-resolution="lossless"
      />
    </PolyScene>
  </PolyCamera>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watchEffect } from "vue";
import {
  PolyCamera,
  PolyScene,
  PolyMesh,
  PolyOrbitControls,
  loadMesh,
  usePolyAnimation,
  type ParseResult,
  type PolyMeshHandle,
} from "@layoutit/polycss-vue";

const result = shallowRef<ParseResult | null>(null);
const meshRef = shallowRef<PolyMeshHandle | null>(null);

let cancelled = false;
let active: ParseResult | null = null;

void loadMesh("/character.glb").then((next) => {
  active = next;
  if (cancelled) next.dispose();
  else result.value = next;
});

onBeforeUnmount(() => {
  cancelled = true;
  active?.dispose();
});

const clips = computed(() => result.value?.animation?.clips);
const controller = computed(() => result.value?.animation);
const { actions, names } = usePolyAnimation(clips, controller, meshRef);

watchEffect(() => {
  const first = names.value[0];
  if (!first) return;
  actions.value[first]?.reset().play();
});
</script>
```
</TabItem>
</Tabs>

## Practical Notes

- `usePolyAnimation` owns its `requestAnimationFrame` loop. Vanilla callers own the loop and call `mixer.update(deltaSeconds)` themselves.
- `usePolyAnimation` and the core mixer expose familiar action methods: `play`, `stop`, `reset`, `fadeIn`, `fadeOut`, `crossFadeTo`, `setLoop`, `setEffectiveTimeScale`, and `setEffectiveWeight`.
- Cross-fading assumes the sampled clips share matching polygon counts and vertex order. That is true for clips from the same parsed mesh.
- `LoopOnce`, `LoopRepeat`, and `LoopPingPong` match the three.js numeric constants.
- `dispose()` still matters: parser-created blob URLs should be revoked when the model is no longer used.

## Related

- [Loading Meshes](/guides/textures): Parser options and mesh lifecycle.
- [Core Types](/api/types): `ParseAnimationController`, `PolyAnimationMixer`, and clip types.
- [Performance](/guides/performance): Why skeletal animation is the render-loop exception.
