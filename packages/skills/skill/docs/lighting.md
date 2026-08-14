# Lighting

The scene takes one `directionalLight`, one `ambientLight`, and zero or more
`pointLights`.

```ts
interface PolyDirectionalLight {
  direction: [number, number, number];  // surface → light source
  color?: string;                       // default "#ffffff"
  intensity?: number;                   // default 1
}

interface PolyAmbientLight {
  color?: string;                       // default "#ffffff"
  intensity?: number;                   // default 0.4
}
```

`direction` is the vector from the surface *toward* the light. It is normalized
internally, so it need not be unit length.

## Point lights

`pointLights: PolyPointLight[]` are **direction-only** — no distance falloff.
Per polygon the contribution is `color · intensity · max(0, n · L̂)`, where `L̂`
is the unit direction from the surface to the light position. Multiple colored
lights accumulate per-channel alongside the directional and ambient terms.

They shade **flat per face** (an accepted approximation vs three.js's
per-fragment `PointLight(distance: 0, decay: 0)`; exact for small faces and
distant lights).

Point lights are **baked mode only**. Dynamic mode ignores them entirely — not
for surface shading and not for shadows.

## Lighting modes

Set with `textureLighting`.

### `"baked"` (default)

Lambert (directional + each point light + ambient) is computed once on the CPU
per polygon and multiplied into the inline `color` for solid leaves, or into the
rasterised atlas pixels for textured leaves.

Best fidelity; the only mode that supports point lights; the Three.js parity
baseline.

**Moving a light requires a rebake**, and the two renderer families differ:

- **Vanilla does not auto-rebake** on `setOptions({ directionalLight })`. Call
  `mesh.rebakeAtlas()` explicitly, typically debounced to drag-end. This is
  deliberate: it keeps high-frequency light drags fast.
- **React/Vue re-render and do auto-rebake** on any light prop change.
- **Vanilla `setOptions({ pointLights })` *does* re-render** every mesh.
- **Vanilla `setOptions({ ambientLight })` changes nothing on its own.** There
  is no ambient branch in the change detection at all, so the baked surface
  stays stale *and* the shadow fill — which is derived from ambient — is not
  re-emitted. Change the directional light in the same call, or call
  `mesh.rebakeAtlas()`, to make an ambient edit take effect.

So the vanilla freeze covers the directional **and** ambient lights, not the
directional light alone.

Cast shadows are cheap (CPU-projected SVG) and re-emit on a *directional* or
*point* light change in both renderer families — so a scene can show a live
shadow over a frozen baked surface until you rebake. An ambient-only change in
vanilla re-emits nothing.

### `"dynamic"`

The scene root carries the directional + ambient setup as custom properties
(`--plx/y/z`, `--plr/g/b`, `--pli`, `--par/g/b`, `--pai`). Each leaf embeds its
surface normal (`--pnx/y/z`) and base color (`--psr/g/b`) inline. CSS `calc()`
resolves the Lambert dot product and per-channel tint at paint time.

Moving a light is a handful of CSS variable writes on one ancestor — zero JS, no
atlas redraw.

Trade-offs: no point lights at all, and cast shadows are directional-only.

### Choosing

- Live or animated lights → `"dynamic"`.
- Point lights, maximum fidelity, Three.js parity → `"baked"`.

`mountPolyThreeScene(...)` defaults to `"baked"` because baked Lambert is the
Three-parity baseline.

## Per-mesh override

React/Vue expose `textureLighting` as a `<PolyMesh>` prop. Vanilla meshes
inherit the scene value.

## Example

```ts
const scene = createPolyScene(host, {
  camera,
  textureLighting: "dynamic",
  directionalLight: { direction: [0.5, -0.6, 0.7], color: "#ffe4a8", intensity: 1 },
  ambientLight: { color: "#ffffff", intensity: 0.35 },
});

// Dynamic mode: free.
scene.setOptions({ directionalLight: { direction: [-0.3, -0.8, 0.5] } });
```

```ts
// Baked mode: cheap during the drag, rebake once at the end.
onDrag((direction) => scene.setOptions({ directionalLight: { direction } }));
onDragEnd(() => meshHandles.forEach((m) => m.rebakeAtlas()));
```

```tsx
<PolyScene
  directionalLight={{ direction: [0.5, -0.7, 0.6], color: "#ffe4a8" }}
  ambientLight={{ intensity: 0.4 }}
  pointLights={[{ position: [10, 10, 20], color: "#ff8866", intensity: 0.8 }]}
>
```

Point lights only take effect in the default `"baked"` mode — the snippet above
would silently ignore them under `textureLighting="dynamic"`.
