# Shadows

Cast shadows are **CPU-projected SVG surfaces**, not render-strategy leaves.
Casting polygons are projected onto scene-level receiver surfaces and emitted as
`<svg>`/`<path>` nodes. They work in both lighting modes; dynamic-mode shadows
are directional-only.

```ts
scene.add(model, { castShadow: true });
scene.add(floor, { receiveShadow: true });
scene.setOptions({
  shadow: { color: "#000000", opacity: 0.3, parametric: true, definition: 32 },
});
```

## Receivers differ by renderer — this is the #1 shadow gotcha

- **Vanilla has no ground fallback.** A `castShadow` mesh draws *nothing* until
  some mesh in the scene has `receiveShadow: true`. This was dropped for
  Three.js parity. You must add a receiver:

  ```ts
  scene.add(createPolyPlane({ axis: 2, size: 60, offset: 0, color: "#7d848e" }),
            { receiveShadow: true });
  ```

- **React/Vue additionally project onto a per-mesh ground plane** when a caster
  has no receiver, and drop that fallback as soon as any receiver exists. It
  also needs a real `directionalLight` with nonzero `intensity` — the same gate
  as the receiver path, so a scene with no lights draws no phantom shadow. This
  is what `<PolyGround>` relies on — `PolyGround` has **no** `receiveShadow`
  prop.

Reconciling the two is an open decision; write code that works under both by
adding an explicit receiver.

## Known limitation: shadows vanish at low camera zoom

`shadow.lift` is expressed in **world units**, but the depth conflict it has to
win against the receiver is resolved in **device pixels**. The scene transform
scales the lift along with everything else, so below roughly `zoom: 1` the
shadow plane and the receiver collapse into the same pixel and the receiver
paints over the shadow. Paths are still emitted — nothing errors, nothing warns,
and the shadow is simply invisible.

The default camera zoom is `0.65`, which is inside that range. Measured on a
cube over a plane with the default `lift`:

| `zoom` | shadow |
|---|---|
| 0.5 | none |
| 0.65 (default) | none |
| 1.0 | visible |
| 2.0 | visible |

Until this is fixed, a scene that keeps the default zoom needs a larger lift —
`shadow: { lift: 0.2 }` is enough at `zoom: 0.65` — or a camera at `zoom: 1` or
above.

## `shadow` options

| Key | Default | Meaning |
|---|---|---|
| `color` | `"#000000"` | |
| `opacity` | `0.25` | |
| `lift` | `0.05` | Offset above the receiver plane to avoid z-fighting. |
| `maxExtend` | `2000` | SVG extent cap. |
| `parametric` | `false` | Swap exact projection for a cheap low-resolution silhouette. |
| `definition` | `16` | Parametric detail. Higher = sharper + more DOM. |
| `style` | `"vector"` | `"vector"` traces a smooth contour; `"pixel"` greedy-meshes the coverage mask into blocky rectangles. |
| `followAnimation` | `false` | Track an animated caster's pose instead of freezing its shadow. |
| `dragDefinition` | none | **Vanilla only.** Progressive refinement during a light drag. |

Per-mesh `shadowDefinition` overrides `shadow.definition` for one mesh (vanilla
`PolyMeshTransform` field, React `shadowDefinition` prop, Vue
`shadow-definition` prop).

## Parametric shadows

Opt in with `shadow.parametric: true`. Per caster, the light-perpendicular
coverage is rasterised into a mask (resolution scales with `definition`), traced
with marching squares, simplified, and lifted back to 3D. A complex caster then
emits far fewer shadow-path vertices.

`definition` is the knob for resolving fine concave holes; higher trades DOM
weight for fidelity. `style: "pixel"` makes holes fall out for free as absent
cells and turns `definition` into the pixel-grid resolution (lower = chunkier —
the block size is the aesthetic).

Point lights are supported: each shadow-casting point light gets its own radial
override silhouette.

Parametric is an approximation with named correction terms: flat casters route
to the exact path, convex casters skip self-shadow, self-shadow bands are
depth-biased, and coverage holes are emitted with opposite winding so they
subtract. It does not change the exact path, which remains the default.

## Colored shadows

Shadows are **shaded, not flat black**. Each light's shadow is filled with the
receiver lit by every *other* light (the blocked light removed), so a region
shadowed from one colored light still shows the remaining lights' color — three.js
colored-shadow semantics. A lone directional light reduces this to the
ambient-only fill.

All of a receiver face's lights are merged into one SVG per face so overlapping
shadows composite correctly.

## Point-light shadows

Each `pointLights` entry with `castShadow: true` casts an additional **radial**
shadow (each vertex projected along its own ray from the light position). Point
shadows are **baked mode only**, like point-light shading.

## Cost

- Cross-mesh and floor shadows are cheap: one outline, ~1 receiver face. They
  follow a moving light at 60fps+.
- Camera orbit is **free** — shadows ride the scene transform. Only light or
  geometry changes re-emit.
- **Self-shadow is the expensive case** (caster = receiver): it projects every
  depth band onto every coplanar face of the same mesh. Reduce quality during
  motion rather than looking for a faster projector.

Levers for smooth interaction:

- Per-mesh `shadowDefinition` — a detailed caster stays sharp while a simple
  prop runs cheap in the same scene.
- `shadow.dragDefinition` (vanilla) — emits at `min(definition, dragDefinition)`
  while the light *direction* changes, then a debounced pass re-emits at full
  `definition` once the light settles. Auto-detected in `setOptions`: a
  direction change counts as motion; an appearance edit renders full
  immediately.
- React/Vue get the same effect idiomatically: lower `shadow.definition` in your
  own state during the drag and restore it at rest.

## Animated casters

A caster's shadow **freezes** during a same-topology deform by default —
re-projecting every frame is expensive. `shadow.followAnimation: true` opts into
tracking the pose; pair it with a low parametric `definition`. All three
renderers throttle the follow re-emit to the same 80 ms window (~12fps, leading
+ trailing edge, so a paused animation still lands its final pose). Topology
changes (different polygon count) always re-emit regardless.

## Notes

- Every polygon casts. Casters are *not* filtered to the camera-rendered set —
  a polygon casts regardless of whether it is painted for the camera.
- Coincident/back-to-back duplicate faces are pre-dropped.
- Light-back-facing caster polygons are normally culled (correct for clean
  closed meshes). Self-shadow casters and unreliable-silhouette cross-mesh
  casters cast double-sided so badly-wound interior walls don't leave holes.
- Moving a light or changing geometry re-emits the shadow SVGs. This is DOM/SVG
  work only and does **not** redraw texture atlases.
