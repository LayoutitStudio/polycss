# Scenes and Cameras

## Structure

The camera is the **outer** node and the scene nests inside it. This is not a
style choice: CSS `perspective` only applies to descendants, so the scene's
`transform: matrix3d(...)` must be a child of the element carrying the
projection.

- React/Vue: `PolyScene` **throws** outside a camera component.
- Vanilla: `createPolyScene(host, opts)` takes a **required** `camera` handle.
- `<poly-scene>` is the one exception: with no ancestor camera element it builds
  an *implicit* camera from its own `perspective`, `rot-x`, `rot-y`, `zoom`,
  `distance`, and `target` attributes.

## Coordinates

World space is `[x, y, z]` with **+Z up**. World Y maps to CSS X (screen-right
at identity rotation) and world X to CSS Y (screen-down). The default camera
(`rotX: 65, rotY: 45`) presents that as an isometric view.

`BASE_TILE` is `50` — the world-unit → CSS pixel factor you need when converting
world units to raw CSS pixels yourself.

## Cameras

`PolyCamera` is an alias for `PolyOrthographicCamera` — identical, and the
**default**. This deliberately diverges from three.js, because PolyCSS's
strengths (integer-pixel atlas, no per-frame JS, DOM stacking) show best in
orthographic scenes. Use `PolyPerspectiveCamera` when you need depth
foreshortening (first-person, game-like).

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `zoom` | `number` | `0.65` | On-screen CSS pixels per world unit. Higher zooms in. Orbit controls clamp to `0.1`–`10` (`minZoom` / `maxZoom`). |
| `rotX` | `number` | `65` | Rotation around X in degrees. |
| `rotY` | `number` | `45` | Rotation around Y in degrees (0–360). |
| `distance` | `number` | `0` | Dolly pull-back in pixels; adds `translateZ(-distance)px`. Equivalent to increasing the orbit radius in three.js. Driven by `dolly` mode on orbit controls. |
| `target` | `Vec3` | `[0,0,0]` | Point in scene space the camera orbits. |
| `perspective` | `number` | `32000` | **`PolyPerspectiveCamera` only.** CSS perspective depth in px. Higher is flatter. |

`zoom` scales; `distance` moves the viewpoint back along the view axis. They are
not interchangeable.

## Scene options

Set on `createPolyScene(host, opts)`, `<PolyScene>` props, or `<poly-scene>`
attributes (kebab-case).

| Option | Type | Default | Notes |
|---|---|---|---|
| `camera` | camera handle | — | Vanilla only, required. |
| `directionalLight` | `PolyDirectionalLight` | none | See [lighting.md](lighting.md). |
| `pointLights` | `PolyPointLight[]` | none | Baked mode only. |
| `ambientLight` | `PolyAmbientLight` | none | |
| `textureLighting` | `"baked" \| "dynamic"` | `"baked"` | |
| `textureQuality` | `number \| "auto"` | `"auto"` | Atlas bitmap budget + sprite size. |
| `textureLeafSizing` | `"canonical" \| "local" \| "raster"` | `"canonical"` | Scene/atlas-wide; **no per-polygon override**. |
| `textureImageRendering` | `"auto" \| "pixelated"` | `"auto"` | |
| `textureBackend` | `"auto" \| "atlas" \| "image"` | `"auto"` | `"auto"` always resolves to the atlas today; direct image leaves need explicit `"image"`. |
| `textureProjection` | `"affine" \| "projective"` | `"affine"` | |
| `seamBleed` | `number \| "auto"` | `1.5` | Overscan on shared solid seams. **Semantics differ by renderer** — see below. |
| `strategies` | `{ disable?: ("b"\|"i"\|"u")[] }` | none | Diagnostics. `<s>` cannot be disabled. |
| `autoCenter` | `boolean` | `false` | Rotate around content bbox center instead of world origin. Polygon data is not mutated. Meshes opt out with `excludeFromAutoCenter`. |
| `centerPolygons` | `Polygon[]` | none | **Framework only.** bbox source for `autoCenter` when polygons live in child meshes. |
| `shadow` | object | see [shadows.md](shadows.md) | |
| `polygons` | `Polygon[]` | none | **Framework only.** Composes with children. Note: this is the only path that runs `normalizePolygons`. |

`seamBleed` caveat: only the numeric default `1.5` behaves identically across
renderers. Vanilla clamps a number to `0..1` and multiplies the `1.5` px
default; React/Vue pass the raw number through. `"auto"` resolves to the full
`1.5` px in vanilla but produces **no** shared-edge overscan in React/Vue.
Prefer leaving it alone.

## Mesh transforms

`scene.add(result, transform)` / `<PolyMesh>` props:

| Option | Type | Notes |
|---|---|---|
| `id` | `string` | Reflected as `data-poly-mesh-id`; used by selection and gizmos. |
| `position` | `Vec3` | Offset in scene space. |
| `scale` | `number \| Vec3` | |
| `rotation` | `Vec3` | Euler **degrees** `[x, y, z]`. |
| `autoCenter` | `boolean` | **Not a vanilla `scene.add` option** — it is a `<PolyMesh>` prop and a `<poly-mesh auto-center>` attribute only. Shifts the mesh so its bbox center sits at the local origin before `position`. (The scene-level `autoCenter` above is a different, unrelated option.) |
| `castShadow` / `receiveShadow` | `boolean` | See [shadows.md](shadows.md). |
| `merge` | `boolean` | Default `true`. `false` renders the array entering the renderer exactly as given. |
| `meshResolution` | `"lossy" \| "lossless"` | Default `"lossy"`. |
| `stableDom` | `boolean` | Vanilla only; needed for skeletal animation. |
| `shadowDefinition` | `number` | Per-mesh parametric shadow detail. |
| `excludeFromAutoCenter` | `boolean` | **Vanilla only, and a `scene.add(result, transform)` option** — there is no React/Vue prop. Keeps this mesh out of the scene's auto-center bbox, for helpers and debug overlays. |

React/Vue additionally expose per-mesh `textureLighting`, `textureQuality`,
`textureLeafSizing`, `textureImageRendering`, `textureBackend`,
`textureProjection`, `seamBleed`, `atomicAtlas`, and `onFrameReady`. Vanilla
meshes inherit the scene values for those.

## Custom element caveats

`<poly-scene>` supports `directional-*`, `ambient-*`, `texture-lighting`,
`texture-quality`, `texture-leaf-sizing`, `texture-image-rendering`,
`texture-backend`, `texture-projection`, `auto-center`, and the implicit-camera
attributes. Only `perspective`, `rot-x`, `rot-y`, and `zoom` are *observed* —
mutating `distance` or `target` alone does not update the implicit camera.
`perspective` only selects the camera type at connect time. Use the imperative
API for `shadow`, `seamBleed`, and `strategies`.

`<poly-mesh>` supports `src`, `mtl`, `mesh-resolution`, `position`, `scale`,
`rotation`, `auto-center`, `cast-shadow`, `receive-shadow`, plus the OBJ-only
parse attributes `target-size`, `default-color`, `palette`, `include-objects`,
`exclude-objects`. `position`, `scale`, `rotation`, `cast-shadow`, and
`receive-shadow` update live; changing `src`, `mtl`, `mesh-resolution`, or an
OBJ parse attribute tears the mesh down and reloads it; `auto-center` is read at
load only. There is **no** `polygons` attribute — use `<poly-polygon>` or the
imperative API.

Note `mesh-resolution` threads into the **parse** only; the element's own
`scene.add` call always renders at the default resolution. Use the imperative
API when you need to control both passes.

## Lifecycle

```ts
const camera = createPolyCamera({ rotX: 65, rotY: 45 });
const scene = createPolyScene(host, { camera });
const result = await loadMesh("/model.glb");
const handle = scene.add(result, { position: [0, 0, 10] });

handle.remove();
scene.destroy();   // removes the scene and disposes registered meshes
result.dispose();  // revokes blob URLs if you kept the result yourself
```

`<poly-mesh>` / `<PolyMesh>` / `usePolyMesh` dispose automatically.

## Helpers

| Helper | Props |
|---|---|
| `<poly-axes-helper>` / `PolyAxesHelper` | `size`, `thickness`, `negative`, `xColor`, `yColor`, `zColor` |
| `<poly-directional-light-helper>` / `PolyDirectionalLightHelper` | React/Vue: `light`, `target`, `distance`, `size`, `color`. Vanilla: `direction`, `target`, `distance`, `size`, `color`. |

## `<poly-iframe>` / `<PolyIframe>`

A live document rendered as a flat quad in the scene, using the same
`position` / `rotation` / `scale` conventions as a mesh; content is centered on
the wrapper's local origin so rotation and scale pivot at the visible center.

`width` and `height` are **world units**, not pixels — the mounted document is
`width × 50` by `height × 50` CSS px, so `16 × 9` yields an 800 × 450 px page.

```html
<poly-scene>
  <poly-iframe src="https://example.com" width="16" height="9" position="0,0,5"></poly-iframe>
</poly-scene>
```

## Snapshot export

`exportPolySceneSnapshot(target)` lives in `@layoutit/polycss` only (it is
browser DOM serialization, not component API). React/Vue callers import it from
there and pass the rendered `.polycss-camera` / `.polycss-scene` element.

```ts
import { exportPolySceneSnapshot } from "@layoutit/polycss";
const html = await exportPolySceneSnapshot(scene.host);
```

It clones the rendered DOM, injects only the CSS that snapshot needs, inlines
`url(...)` images as data URIs, strips scripts and inline handlers, and returns
a standalone HTML document string with no PolyCSS runtime import. Throws
`PolySceneSnapshotError` with `code: "ASSET_INLINE_FAILED"` if an asset cannot
be inlined.
