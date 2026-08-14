# Troubleshooting

Most PolyCSS failures are **silent**. Nothing throws, nothing logs, the geometry
is simply wrong or absent. Work the symptom table before adding instrumentation.

## Symptom → cause

| Symptom | Most likely cause |
|---|---|
| A face is missing from the viewpoint it was built for, but shows from behind | **Winding.** Reverse the vertex order (and `uvs` with it). |
| A face disappears when the camera moves behind it | Correct behavior. Backface culling is per-leaf and there is no double-sided flag. Emit two polygons if you need both sides. |
| Everything renders **white** | `color` is not `#rgb` / `#rrggbb` / `rgb()` / `rgba()`. Named colors and `hsl()` fail silently. |
| Everything renders `#cccccc` | Same cause, but on the `<PolyScene polygons>` path, which substitutes a fallback color. |
| A polygon you authored is simply absent from the DOM | Degenerate: <3 vertices, zero area, or a duplicate first edge. |
| Cracks or gaps between neighbouring quads | A non-coplanar n-gon was flattened onto its average plane. Use triangles, or snap shared vertices and propagate. |
| Geometry looks different from what you passed in | The optimizer ran (`merge` defaults `true`, `meshResolution` `"lossy"`). Pass `{ merge: false }`. |
| `merge: false` still changes the mesh | `loadMesh` already optimized at parse time. Call `parseObj`/`parseStl`/`parseGltf`/`parseVox` directly, then add with `merge: false`. |
| **No shadow appears at all** in vanilla | Vanilla has no ground fallback. Add a mesh with `receiveShadow: true`. |
| Shadow still absent with a caster, a receiver and a light | Camera `zoom` below ~1 (the default is `0.65`). `shadow.lift` is in world units and scales with the camera, so it stops clearing the receiver. Raise `shadow.lift` to `0.2`, or the zoom to `1`. |
| Shadow is hidden behind the object casting it | The light is nearly parallel to the view direction. Move it to one side so the shadow falls where the camera can see it. |
| Shadow works in React but not vanilla | Same cause — React/Vue have the ground-plane fallback, vanilla does not. |
| Shadow vanished when you added a floor in React/Vue | Adding any receiver disables the ground fallback. Set `receiveShadow` on that floor. |
| Point lights do nothing | `textureLighting: "dynamic"` ignores `pointLights` entirely — shading and shadows. Switch to `"baked"`. |
| Moving the light doesn't change the surface (vanilla) | Baked mode does not auto-rebake on a `directionalLight` change. Call `mesh.rebakeAtlas()`, typically at drag-end. Shadows still move; the lit surface does not. |
| Shadows move but the surface stays lit the old way | Same as above — expected, and the reason the escape hatch exists. |
| Shadow doesn't follow an animated mesh | Shadows freeze during a same-topology deform. Set `shadow.followAnimation: true` and lower `definition`. |
| A texture renders blurry when it should be crisp | Set `textureImageRendering: "pixelated"`. |
| Textures look missing right after mount | The atlas has not painted yet. `collectPolyTextureReadiness(root)` narrows the window but does not prove decode — direct-image leaves report ready once their URL is assigned. Give textured scenes real settle time before a screenshot. |
| `textureBackend: "auto"` didn't give a direct image leaf | `"auto"` always resolves to the atlas today. Request `"image"` explicitly. |
| A direct image leaf ignores scene lighting | By design — direct image leaves are source-lit. Use the atlas backend for scene lighting. |
| `PolyScene` throws | It must be nested inside a camera component. |
| The scene is invisible / flat / wrong scale | Check camera nesting (camera outer, scene inner), then `zoom` (CSS px per world unit, default `0.65`) and `targetSize`. |
| `<poly-scene distance>` or `target` changes do nothing | Only `perspective`, `rot-x`, `rot-y`, `zoom` are observed on the implicit camera. Change one of those, or use the imperative API. |
| `<poly-mesh auto-center>` change does nothing | Read at load only. |
| Per-polygon click handlers stopped firing after a change | Polygons got merged into one leaf. Use `merge: false`. |
| Animation plays but the mesh flickers or re-mounts | Topology is not stable. Vanilla needs `{ merge: false, stableDom: true }`; React/Vue need `meshResolution="lossless"` / `merge={false}`. |
| Animated colors "pump" between frames | Expected — color is pinned to the baked value during animation on purpose. |
| Frame rate collapses on orbit | Too many mounted leaves. Reduce polygon count first; camera motion itself is a single-ancestor transform and should be free. |
| Frame rate collapses when dragging a light | Self-shadow recompute. Use `shadow.parametric` with a lower `definition`, `dragDefinition` (vanilla), or lower `definition` in state during the drag. |
| Blob URL / broken texture after a remount | A revoked atlas URL was held across remounts. Never cache them; let `dispose()` run. |
| Import fails to resolve in a React/Vue app | Do not import `@layoutit/polycss` there. Core names come from the framework package; anything missing comes from `@layoutit/polycss-core`. |
| `exportPolySceneSnapshot` not found in React/Vue | It only exists in `@layoutit/polycss`. Import it there and pass the rendered element. |
| `PolySceneSnapshotError` with `ASSET_INLINE_FAILED` | An asset referenced by the snapshot could not be inlined (usually CORS). |

## Debug checklist

1. **Is the leaf in the DOM?** Inspect with devtools or `queryPolyLeaves(root)`.
   Absent → degenerate polygon or culling. Present but invisible → winding,
   color, or transform.
2. **What strategy did it get?** `collectPolyRenderStats(root)`. An unexpected
   `<s>` count means solid polygons are falling through — check
   `strategies.disable` and browser support.
3. **Does it render with `strategies={{ disable: ["b","i","u"] }}`?** If yes, the
   bug is in a solid strategy or its browser support, not your geometry.
4. **Does it render with `merge: false`?** If yes, the optimizer changed it.
5. **Does it render with a flat ambient light only?** If yes, the problem is a
   normal — which means winding.

## Browser-specific behaviour

Some strategies are engine-gated, so the leaf mix legitimately differs across
browsers:

- Projective quads and border triangles fall through to `<s>` on
  WebKit/Safari — transformed projective rectangles and CSS border triangles
  composite incorrectly there.
- `<i>` (`border-shape`) requires Chromium with a fine pointer and hover.
- Firefox uses a larger border-triangle primitive to avoid compositor banding.

A leaf-count difference between Chrome and Safari is expected. A *visual*
difference is not.

## Things that are not bugs

- Backface culling hiding a single-sided face from behind.
- Vanilla's baked surface not updating on a light drag.
- Vanilla drawing no shadow without a `receiveShadow` mesh.
- Voxel meshes mounting only camera-facing leaves.
- Merged regions losing per-polygon DOM addressing.
