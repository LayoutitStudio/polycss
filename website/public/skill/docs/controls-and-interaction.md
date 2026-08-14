# Controls and Interaction

Controls are **additive layers**, following the three.js split. They attach
their own pointer/wheel listeners; only `animate` runs a `requestAnimationFrame`
loop, and it updates one ancestor transform, not per-polygon state.

| Control | Purpose |
|---|---|
| `PolyOrbitControls` / `createPolyOrbitControls` | Drag orbit + wheel zoom + autorotate. Default pick. |
| `PolyMapControls` / `createPolyMapControls` | Drag **pans** instead of orbiting. Top-down / flat layouts. |
| `PolyFirstPersonControls` / `createPolyFirstPersonControls` | Pointer-lock mouselook + WASD, jump, crouch. |
| `PolyTransformControls` / `createTransformControls` | Translate/rotate gizmo on a selected mesh handle. |
| `PolySelect` / `createSelect` | Pointer picking over mesh handles. |

Camera controls mutate the wrapping camera state.

Transform controls differ by renderer, and this catches people:

- **Vanilla** mesh handles expose `setTransform`, so the gizmo moves the mesh
  directly.
- **React and Vue** handles deliberately have **no** `setTransform`. The gizmo
  only *reports* — it emits `onObjectChange`, and you must commit the new
  position/rotation to your own state. A gizmo wired without that callback drags
  visibly but the mesh never moves.

## Orbit / Map options

| Prop | Type | Default | Notes |
|---|---|---|---|
| `drag` | `boolean` | `true` | Pointer-drag rotation (orbit) or pan (map). |
| `wheel` | `boolean` | `true` | Wheel / pinch zoom. Mac trackpad pinch arrives as `wheel` with `ctrlKey`, so this covers both. |
| `invert` | `boolean \| number` | `false` | `true` reverses; a number scales sensitivity (negative inverts). |
| `minZoom` / `maxZoom` | `number` | `0.1` / `10` | Zoom clamps. |
| `dolly` | `boolean` | `false` | Wheel drives `distance` instead of `zoom`. |
| `minDistance` / `maxDistance` | `number` | `0` / see note | Dolly clamps. **`maxDistance` defaults differ:** vanilla is `Infinity`, React/Vue is `5000`. Set it explicitly if it matters. |
| `animate` | `false \| { speed?, axis?, pauseOnInteraction? }` | `false` | Autorotate. |

`animate` fields: `speed` (default `0.3`, degrees per 60 Hz-equivalent frame ≈
18 deg/sec), `axis` (`"y"` default, `"x"` tilts), `pauseOnInteraction` (default
`true`). The tick is `dt`-clamped at 50 ms so speed is refresh-rate independent
and a refocused tab does not jump.

**Zoom vs dolly:** the default wheel behaviour scales the whole scene (good for
isometric/map-style). `dolly` moves the viewpoint back along the view axis,
mirroring three.js `OrbitControls` changing the spherical radius — better for
perspective scenes where foreshortening should stay consistent.

On custom elements, the presence of any `animate-*` attribute
(`animate-speed`, `animate-axis`, `animate-pause-on-interaction`) implies
`animate` is enabled; removing them all turns it off.

## Imperative handle

```ts
const controls = createPolyOrbitControls(scene, {
  drag: true,
  wheel: true,
  animate: { speed: 0.3, axis: "y", pauseOnInteraction: true },
});

controls.update({ animate: false });   // live partial update
controls.pause();                      // detach listeners + cancel rAF
controls.resume();
controls.destroy();

controls.addEventListener("change", (e) => console.log(e.camera));
controls.addEventListener("start", () => {});   // interaction begin
controls.addEventListener("end", () => {});     // interaction end
```

## First-person controls

Click the scene to acquire pointer lock; Escape releases it.

| Prop | Default | | Prop | Default |
|---|---|---|---|---|
| `enabled` | `true` | | `moveSpeed` | `5` (world units/sec) |
| `lookEnabled` | `true` | | `jumpVelocity` | `7` |
| `moveEnabled` | `true` | | `gravity` | `18` |
| `jumpEnabled` | `true` | | `eyeHeight` | `1.7` |
| `crouchEnabled` | `true` | | `crouchHeight` | `1` |
| `lookSensitivity` | `0.15` (deg/px) | | `groundZ` | `0` |
| `invertY` | `false` | | `minPitch` / `maxPitch` | `5` / `175` |

Pair it with `PolyPerspectiveCamera` — first-person scenes want
foreshortening.

Imperative handles expose `lock()`, `unlock()`, `isLocked()`, `getOrigin()`,
`setOrigin()`, `pause()`, `resume()`, `destroy()`, `update(partial)`.

## Selection

For whole-mesh selection use `PolySelect` / `<poly-select>` rather than wiring
every polygon. It tracks selected `PolyMeshHandle`s and supports multi-select.

```tsx
// React: the mesh is controlled state, and onObjectChange commits the drag.
const [selected, setSelected] = useState<PolyMeshHandle | null>(null);
const [position, setPosition] = useState<Vec3>([0, 0, 0]);

<PolySelect multiple={false} onChange={(meshes) => setSelected(meshes[0] ?? null)}>
  <PolyMesh id="cottage" src="/cottage.glb" position={position} />
</PolySelect>
<PolyTransformControls
  object={selected}
  mode="translate"
  translationSnap={10}
  // `position` and `rotation` are both optional — only the one the current
  // mode changed is present.
  onObjectChange={(e) => { if (e.position) setPosition(e.position); }}
/>
```

Drop `onObjectChange` and nothing moves — the gizmo has no way to write back.
In vanilla the equivalent needs no callback, because `createTransformControls`
calls `handle.setTransform(...)` itself.

- `usePolySelect()` reads the current selection inside a subtree.
- `usePolySelectionApi()` gives a nested toolbar `set`, `add`, `remove`,
  `toggle`, `clear`.
- Lower-level DOM helpers, **React and Vue only** — vanilla exports no
  equivalent: `findPolyMeshHandle(el)`,
  `pointInMeshElement(meshEl, clientX, clientY)`,
  `findMeshUnderPoint(clientX, clientY, filter?)`. They use the same
  bounding-rect fallback that selection and transform controls use for clipped
  polygon leaves.

Raycasting runs on pointer events only — never per frame.

## Transform controls

Translate mode gives axis arrows and plane handles; rotate mode gives axis
rings. **In vanilla** dragging updates the attached mesh directly, because
`createTransformControls` calls `handle.setTransform(...)` itself. **In React
and Vue** dragging updates nothing on its own — the gizmo emits
`onObjectChange` and your state update is what moves the mesh (and the gizmo
with it).

Key props: `object`, `mode`, `size`, `showX`, `showY`, `showZ`,
`translationSnap`, `rotationSnap`, `enabled`, `onChange`, `onObjectChange`,
`onMouseDown`, `onMouseUp`, `onDraggingChanged`.

## Per-polygon events

Every polygon is a real DOM element, so ordinary handlers, classes, and CSS
work — in every entry point.

```tsx
{polygons.map((p, i) => (
  <Poly
    key={i}
    {...p}
    onClick={() => select(i)}
    onMouseEnter={() => setHovered(i)}
    className={hovered === i ? "highlight" : ""}
    style={{ transition: "filter 0.2s" }}
  />
))}
```

```css
.highlight { filter: brightness(1.5); }
```

```js
// Vanilla custom elements
const el = document.createElement("poly-polygon");
el.setAttribute("vertices", JSON.stringify(p.vertices));
el.addEventListener("click", () => el.classList.toggle("selected"));
scene.appendChild(el);
```

Use `polygon.data` to attach `data-*` attributes for CSS selectors and event
delegation.

Merged polygons lose per-polygon addressing — pass `merge: false` when you need
one leaf per source polygon.
