# Animation

Skeletal animation from glTF/GLB is the **one renderer exception** to the
"no JS in the render loop" rule. Skinning changes each polygon independently, so
the clip is sampled in JS, the leaf set stays mounted, and baked transform
frames are cached.

Everything else — camera motion, mesh motion, light changes, autorotate — is a
single-ancestor CSS update. Do not write a per-frame loop over polygons for
those.

## How it works

When `loadMesh()` or `parseGltf()` finds usable clips, `ParseResult.animation`
exposes clip metadata and a `sample()` function. Sampling evaluates the source
animation at a time, applies the pose, and returns `Polygon[]` for that moment.
`createPolyAnimationMixer` (core) and `usePolyAnimation` (React/Vue) sit on top
and manage actions, looping, speed, fades, and cross-fades.

## Mesh setup matters

Animated meshes need **stable triangle topology**:

- Vanilla: `scene.add(result, { merge: false, stableDom: true })`
- React/Vue: `meshResolution="lossless"` and/or `merge={false}` — there is
  **no `stableDom` prop**; leaf identity across same-topology frames is handled
  internally.

## Vanilla

The mesh handle returned by `scene.add()` satisfies `PolyAnimationTarget`. You
own the loop.

```ts
import { createPolyAnimationMixer, loadMesh } from "@layoutit/polycss";

const result = await loadMesh("/character.glb", { meshResolution: "lossless" });
const mesh = scene.add(result, { merge: false, stableDom: true });

if (result.animation?.clips.length) {
  const mixer = createPolyAnimationMixer(mesh, result.animation);
  mixer.clipAction(result.animation.clips[0].name).reset().play();

  let last = performance.now();
  const tick = (now: number) => {
    mixer.update((now - last) / 1000);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
```

## React

`usePolyAnimation` mirrors drei's `useAnimations` and **owns its own rAF loop**.
It returns `clips`, `names`, `actions`, `mixer`, and a `ref`. Load the mesh
yourself when you need both `polygons` and the animation controller.

```tsx
const [result, setResult] = useState<ParseResult | null>(null);
const meshRef = useRef<PolyMeshHandle | null>(null);
const { actions, names } = usePolyAnimation(
  result?.animation?.clips,
  result?.animation,
  meshRef,
);

useEffect(() => {
  const first = names[0];
  if (first) actions[first]?.reset().play();
}, [actions, names]);

return (
  <PolyScene>
    {result && (
      <PolyMesh ref={meshRef} polygons={result.polygons} meshResolution="lossless" />
    )}
  </PolyScene>
);
```

Dispose the `ParseResult` on unmount — `loadMesh` created blob URLs.

## Vue

Same shape; `clips`, `names`, `actions`, and `mixer` are computed refs, and the
arguments are passed as refs:

```ts
const clips = computed(() => result.value?.animation?.clips);
const controller = computed(() => result.value?.animation);
const { actions, names } = usePolyAnimation(clips, controller, meshRef);

watchEffect(() => {
  const first = names.value[0];
  if (first) actions.value[first]?.reset().play();
});
```

## Actions

Both the hook and the core mixer expose the familiar three.js-shaped methods:
`play`, `stop`, `reset`, `fadeIn`, `fadeOut`, `crossFadeTo`, `setLoop`,
`setEffectiveTimeScale`, `setEffectiveWeight`.

`LoopOnce`, `LoopRepeat`, and `LoopPingPong` match the three.js numeric
constants.

Cross-fading assumes the sampled clips share matching polygon counts and vertex
order — true for clips from the same parsed mesh.

## Shadows during animation

An animated caster's shadow **freezes** by default. Set
`shadow.followAnimation: true` to track the pose, and pair it with a low
parametric `definition` — see [shadows.md](shadows.md).

## Browser note

On WebKit/Safari, stable CSS triangles fall through to atlas `<s>` leaves.
Same-topology updates keep the existing elements and bitmap URLs mounted and
cache transform frames once warmed. This optimized path is the default; there is
no "baseline vs optimized" toggle.

Color is **pinned** to the baked value while transforms animate. Recomputing
Lambert from every deformed low-poly face normal causes visible color pumping,
so color refresh is not the default.
