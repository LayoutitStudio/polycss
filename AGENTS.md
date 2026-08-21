# PolyCSS — agent guide

This file is the single source of truth for AI coding agents (Claude Code, Cursor, etc.). `CLAUDE.md` is a symlink to this file — **always edit `AGENTS.md`, never `CLAUDE.md`**. The constraints below describe the current design and the rules we work under; if a request conflicts with one of them, push back before doing it.

## What this repo is

PolyCSS is a CSS-based polygon mesh rendering engine. It paints 3D meshes by emitting one DOM element per polygon, transforming it with `matrix3d`, and letting the browser composite the result. No WebGL, no canvas-per-frame. Rasterisation only happens once, into a texture atlas; everything after that is pure DOM + CSS.

Monorepo layout (pnpm workspaces):

| Package | npm name | Role |
|---|---|---|
| `packages/core` | `@layoutit/polycss-core` | Pure math: Vec3, Polygon, scene, camera, mesh ops, atlas planning. Zero browser globals (lib: ES2020 only). |
| `packages/polycss` | `@layoutit/polycss` | Vanilla renderer + custom elements (`<poly-scene>`, etc.). Owns DOM emission, CSS injection, its own copy of atlas rasterisation. Depends on `core` only. |
| `packages/react` | `@layoutit/polycss-react` | React components + hooks. Owns its own copy of atlas rasterisation. Depends on `core` only — **NOT on `polycss`.** |
| `packages/vue` | `@layoutit/polycss-vue` | Vue 3 mirror of the React package. Owns its own copy of atlas rasterisation. Depends on `core` only. |
| `packages/fonts` | `@layoutit/polycss-fonts` | Fonts + text → extruded 3D `Polygon[]`. Hand-written TrueType (`glyf`) reader + extruder (flat/round/bevel profiles) + Google Fonts loader. Framework-agnostic (returns `Polygon[]`, no React/Vue mirror needed). Depends on `core` + `earcut`. |
| `packages/morph` | `@layoutit/polycss-morph` | Framework-agnostic prepared-model contracts, deterministic Node preparation, browser loading, retained DOM mounting, sparse deformation, controls, springs, animation, joint skinning, and prepared playback. The browser entry uses public `@layoutit/polycss` APIs; Node-only preparation lives at `@layoutit/polycss-morph/prepare`. No React/Vue mirrors. |
| `packages/domformat` | `@layoutit/polycss-domformat` | Private strict-TypeScript `domformat@0` writer, reader, validator, CLI, and browser mount with repository-side conformance. Its closed retained-DOM runtime includes sparse playback/surface/variants, typed atlas positions, responsive prepared presentation/layout/timeline profiles, host-selected prepared-bank handoff, fixed orbit input, one bounded digest-bound page lifecycle shared by paged transform/visibility playback and paged variants, and compositor-owned linear transform timing. It owns the producer-neutral wire contract; producer lowering and product input policy stay in producer/host packages. Runtime installs contain code-split ESM and declarations but exclude certification material. Not published. |
| `packages/skills` | `@layoutit/polycss-skills` | Zero-dependency `npx` installer for the PolyCSS agent skill. Owns `skill/SKILL.md` + `skill/docs/*.md` — the source of truth for what agents are told about PolyCSS. No renderer code, no runtime dependency on any other package. |
| `website` | `@layoutit/polycss-website` | Astro + Starlight docs site. Not published. |
| `examples/{html,vanilla,react,vue,fontcss}` | private | Per-framework Vite apps demonstrating the minimal usage for each renderer (`fontcss` demos `@layoutit/polycss-fonts`). Workspace members so they resolve to local `workspace:^` packages. Not published. |

Public API is **mirrored** across React and Vue. Adding a hook on one side without adding the matching composable on the other is not acceptable (see "Cross-package discipline" below).

### Three-like parity surface

The native PolyCSS API keeps PolyCSS world and camera conventions. For agent-friendly Three.js ports, the monorepo also exposes explicit `*/three` subpaths:

- `@layoutit/polycss-core/three` — pure Three-like math wrappers, camera conversion, lights, and transforms.
- `@layoutit/polycss/three` — the core Three-like surface plus vanilla scene helpers.
- `@layoutit/polycss-react/three` and `@layoutit/polycss-vue/three` — mirrored framework components: `PolyThreePerspectiveCamera`, `PolyThreeOrthographicCamera`, and `PolyThreeMesh`.

These subpaths intentionally use Three-compatible public names and units: `Vector3`, `Euler`, `Object3D`, `PerspectiveCamera`, `OrthographicCamera`, `DirectionalLight`, `PointLight`, `AmbientLight`, radians for object rotations, Y-up authoring coordinates, and `camera.position` + `camera.lookAt(...)` framing. They are adapters over PolyCSS, not a Three.js runtime dependency. Geometry authored in that surface is converted to native PolyCSS coordinates with `transformPolygonsToPoly`; the Y-up → Z-up axis map is `[x, -z, y]` so winding and Lambert lighting stay right-handed. The vanilla `mountPolyThreeScene` helper defaults `textureLighting` to `"baked"` because baked Lambert is the Three-parity baseline. Dynamic lighting remains available as an explicit opt-in for live CSS light changes, but it is not the exact conformance mode.

## Rendering model — the mental model

**One visible `Polygon` → one leaf DOM element.** Leaves use canonical CSS primitives where possible and move scale into `matrix3d`; clipped solids use fixed primitives because their paint geometry becomes unstable when collapsed to 1px. Atlas-backed textured polygons pack their local-2D bounding rect (`canvasW × canvasH`) into atlas pages; source-exact textured polygons may instead carry `textureImageSource` + `texturePresentation.backend="image"` and render as direct image leaves without atlas rasterisation. The HTML tag *is* the render strategy — the renderer picks one tag per polygon based on its shape and material.

Raw MagicaVoxel `.vox` sources have a narrower baked-mode fast path: `parseVox` still returns the polygon mesh for bounds, fallback rendering, and public handles, but also preserves a `PolyVoxelSource` marker. Eligible vanilla, React, and Vue meshes render visible voxel quads as `<b>` leaves inside persistent signed-face wrappers (`t`, `b`, `fl`, `br`, `fr`, `bl`), with canonical `matrix3d(...)` transforms and projected tile4 scanline order inside each mounted face. Camera-facing culling mounts/removes those face wrappers instead of removing thousands of live brush children from the mesh root. `.vox` normalization snaps to the nearest integer CSS cell size so direct voxel matrices use integer pixel coordinates without any scale wrapper; same-color shared voxel edges get a tiny matrix-space overscan to hide compositor seams without fattening exterior silhouette edges. Brush colors still receive baked Lambert shading from the scene lights. Callers may opt into lossy `.vox` palette merging and small local face-region cleanup before greedy meshing when authored palettes contain visually redundant colors; gallery and builder route this through Mesh resolution so `Lossy` may simplify palettes while `Lossless` keeps palette colors exact. Dynamic lighting, shadows, stable DOM animation, non-exact voxel geometry, and geometry replaced via `setPolygons` fall back to the polygon renderer.

Voxel-shaped meshes are the exception to "all polygons stay mounted": meshes with at most the six axis-aligned face normals, excluding helpers/auto-center-exempt meshes, automatically mount only camera-facing leaves and patch the mounted set when the camera or mesh rotation crosses a visible-normal boundary. Non-voxel meshes keep the full leaf DOM mounted; broad camera-dependent DOM culling is not worth the mutation cost.

### Tag-as-strategy table

| Tag | Strategy | When chosen | Paint mechanism | Atlas memory |
|---|---|---|---|---|
| `<b>` | **Quads** | Axis-aligned rectangle, or untextured convex quad when the homography passes stability guards on non-Safari engines | `background: currentColor` on a fixed 64px rectangle; affine and projective quads normalize their `matrix3d` to that primitive, with tiny solid bleed on projective quads to overlap antialias seams. Safari-family browsers skip the projective quad path and fall through because transformed projective rectangles composite incorrectly there. | None |
| `<i>` | **Border-shape clipped solid** | Untextured non-rect not caught by the exact corner-shape solid path, on browsers with CSS `border-shape` (Chromium + `pointer:fine` + `hover:hover`) | `border-color: currentColor` on a fixed 16px border-shape primitive, clipped by `border-shape: polygon(...)`; polygon bbox scale and tiny solid bleed are folded into `matrix3d` | None |
| `<s>` | **Texture slice / atlas fallback** | Atlas-backed textured polygons, direct `textureImageSource` polygons, or untextured non-rect on browsers without `border-shape` | Atlas leaves use a packed bitmap slice on an auto-budgeted primitive (128px for desktop-class `textureQuality="auto"`, 64px for mobile-class `auto` and explicit numeric quality by default; `textureLeafSizing` can switch to local or raster dimensions). Direct image leaves use the caller's source URL and source rect directly, keep source lighting, and may use guarded affine or projective matrices for exact quad mapping. Atlas position/size, image position/size, filtering (`textureImageRendering`), readiness, projection, and source rect are emitted as PolyCSS-owned metadata so callers do not parse private style strings. | Atlas: bounding-rect area; direct image: none |
| `<u>` | **Stable solid triangle / corner-shape solid** | Triangles on non-WebKit engines; or untextured non-triangle polygons whose normalized outline is exactly a rectangle with one or more beveled corners on browsers with CSS `corner-shape` | Triangles use a 32px box with two beveled top corners and `background: currentColor` when CSS `corner-shape` support is present, progressively falling back to the CSS border-color triangle trick. Firefox uses a 96px border-triangle primitive to avoid large-perspective compositor banding. Exact corner-shape solids use a fixed 16px classed box with inline per-corner radii + `corner-*-shape: bevel` and `background: currentColor`. Tiny solid bleed is folded into `matrix3d`. WebKit/Safari falls through to `<s>` for border triangles because transformed CSS border triangles composite incorrectly there. | None |

Strategies are ordered cheapest → most expensive. The mesher's job is to maximise `<b>` / `<u>` / `<i>` and minimise `<s>` (see "Meshing implications" below).

Callers can opt out of specific strategies via `strategies: { disable: ["b" | "i" | "u"] }` on `RenderTextureAtlasOptions`. Disabled or unsupported strategies fall through the chain (`b → i → s`, `u → i → s`, `i → s`). Disabling `"i"` also disables the exact corner-shape solid branch even though that branch emits a bare `<u>`, because it belongs to the non-triangle clipped-solid family. `<s>` is the universal fallback and cannot be disabled. Solid seam bleed gives detected shared solid edges a per-edge overscan, fitted to the polygon plan, rather than inflating every side of each participating polygon. It IS exposed: `seamBleed` is a scene option in all three renderers plus a React/Vue per-mesh prop, though not a custom-element attribute. Semantics are unified and owned by core (`resolveSeamBleedPx` / `seamBleedPrimitiveRatio` in `packages/core/src/atlas/constants.ts`; renderers pass the raw option through): `undefined`/`"auto"` → the `1.5` px default (`DEFAULT_SEAM_BLEED`); a finite number ≥ 0 is the requested overscan in CSS px with no upper clamp (the per-edge geometric fit still bounds each edge); negative/non-finite values fall back to the default. The same option scales the per-strategy primitive bleeds (`SOLID_TRIANGLE_BLEED`, `BORDER_SHAPE_BLEED`, `TEXTURE_TRIANGLE_BLEED`, and the projective-quad guard bleed) by `clamp(px / 1.5, 0, 1)` — so `0` disables every bleed, sub-`1.5` values shrink primitives proportionally, and larger values keep primitives at full strength while the seam overscan uses the raw px. All three renderers also honor the `window.__polycssProjectiveQuadGuards` debug override for projective-quad guards, merged over the seam-scaled default.

Cast shadows are not a render-strategy leaf tag. Meshes with `castShadow: true` project casting polygons on the CPU into SVG shadow surfaces onto scene-level receiver surfaces where `receiveShadow` is enabled. **Renderer divergence on the no-receiver case:** vanilla dropped its legacy virtual ground-shadow fallback for Three.js parity — a caster with no receiver in the scene draws nothing; the dead `emitGroundShadow` emitter has been removed entirely, and `hideGroundShadow()` suppresses any legacy leftovers every tick. React/Vue still emit a per-mesh ground-plane shadow when a caster has no receiver — but only when a real, nonzero-intensity directional light exists (same gate as the receiver path; no implicit default-sun shadow) — and drop it as soon as any receiver exists. Reconciling the two is an open decision. EVERY polygon casts — shadow casters are NOT filtered to the camera-rendered set (atlas plan), because a polygon casts a shadow regardless of whether it's painted for the camera; filtering left camera-dependent holes in imported-mesh shadows. Coincident/back-to-back duplicate faces ARE pre-dropped, via `findOverlappingPolygonDuplicates` in all three renderers (vanilla `dedupByCaster`, React/Vue `dedupDrop`). Remaining overlapping projections are merged into one compound path per caster under `fill-rule: nonzero` so they don't alpha-stack, rather than being dropped. The directional light projects in parallel; each `pointLights` entry with `castShadow: true` casts an additional **radial** shadow (each vertex projected along its own ray from the light position), and point-light passes always project the caster *silhouette* — projecting individual back-faces leaves the contact footprint unshadowed under radial divergence. Shadows are **shaded, not flat black**: each light's shadow is filled with the receiver lit by every OTHER light (the blocked light removed), so a region shadowed from one colored light still shows the remaining lights' color (Three.js colored shadows). A lone directional light reduces this to the ambient-only fill (unchanged). All of a receiver FACE's lights are merged into **one SVG per face** so overlapping shadows composite correctly: a single-light SOLID face normally paints one path filled with the remaining-light color at `shadow.opacity`, and switches to the PRE-BLENDED color `blend(fullLitFill, remaining, shadow.opacity)` at alpha 1 only when that face actually bled a crease (see below) — the identical pixel over the lit receiver (the blend is exact at antialiased coverage too), but idempotent under overlap, which is what makes the crease bleed safe. The opaque form is NOT free elsewhere: `shadow.lift` floats the SVG above its face, and at grazing camera angles that parallax hangs part of the card past the receiver's silhouette, where opaque paint deviates from the backdrop about 4× as much as 25% alpha did (measured headlessly: mean Δ 54 → 209 of 255 over ~580 off-surface px on a lit cube; `lift=0` removes 99% of those px, confirming parallax as the cause). So the pre-blend is paid only where it buys the seam fix. `MergedShadowFace.layers[].opacity` therefore carries `shadow.opacity` for an ordinary single-light solid face and `1` for a crease-bled one — callers must read the field, never assume either; a multi-light solid face paints a base = full-lit color `C` then each light as a `mix-blend-mode: multiply` layer with factor `remaining/C`, so the both-blocked overlap becomes `C·∏factor` (ambient only). `mix-blend-mode` works *within* one SVG but NOT across SVGs (`preserve-3d` isolates each SVG against a transparent backdrop — verified), which is why the merge is per-face rather than per-light. Textured receivers (per-pixel base, no uniform multiply) fall back to per-pass alpha layers that cumulatively darken. The per-face color uses the face CENTROID direction (matching the baked per-polygon shading) so the base leaves no visible color box. The per-face merge is the shared core helper `computeMergedReceiverShadows` (runs every light pass + aggregates each face into one SVG descriptor); all three renderers call it and only emit the `<svg>`/`<path>` nodes, so multi-light overlap is identical everywhere. Moving a light or changing caster/receiver geometry re-emits the shadow SVGs; this is DOM/SVG work only and does not redraw texture atlases.

**Receiver-clip seam bleed (the pale-hairline classes).** Each receiver face group clips its shadow to the union of its member polygons, and two abutting antialiased clip edges do not sum to full coverage — so every receiver edge that a shadow crosses can show as a pale hairline. `prepareReceiverFacePlanes` therefore carries two per-member edge sets, and `computeReceiverShadowFaces` unions them into ONE outward clip expansion of `SHADOW_CLIP_SEAM_BLEED`: `memberSharedEdges` (neighbour is another member of the SAME coplanar group — the subpaths land in one nonzero compound path, so this is always on) and `memberCreaseEdges` (neighbour is a member of a DIFFERENT, non-coplanar group — a crease, and by far the dominant class on imported architecture). Crease adjacency is matched in WORLD space, since crease neighbours are not coplanar and the 2D `planarEdgesShareLine` predicate does not apply: matching runs on `memberPolysWorld` — each member's TRUE world vertices, carried alongside the (u, v) outline — via an exact quantized endpoint-pair hash, then `spatialEdgesShareLine` (the world-space sibling of the 2D predicate, same tolerances) over a uniform spatial hash restricted to edges the exact pass left unmatched. It must NOT lift the (u, v) outline back to 3D: that lift is exact only for members perfectly coplanar with their group plane, and imported architecture routinely is not (the castle has quads whose vertices sit ~0.3 CSS px off their own plane). Projecting drops that offset, so two groups snap the SAME shared vertex to two different points and push an exactly-shared crease past `RECEIVER_EDGE_PERP_EPS` (0.25) — which silently hid 272 of the castle's creases and left exactly the hairlines the pass exists to close. Edges already in `memberSharedEdges` stay in the candidate pool AND record their crease neighbours like any other edge. The mark cannot change their own clip expansion (an edge gets one bleed amount whether it is shared, crease, or both), but it is what flips the face to its opaque pre-blend, and it is the direction `qualifiesCrease`'s reciprocity condition reads. Suppressing it was a real bug: on a floor grouped from two coplanar quads with a wall standing on their shared edge — tessellated/greedy-merged architecture, the castle's dominant interior-partition shape — the exact hash recorded wall→floor but never floor→wall, so BOTH sides refused to bleed and the hairline came back. It also left the wall's opaque strip lying over a floor still painting at alpha, which composites by SVG paint order. True mesh-boundary edges have no neighbour in either set and are never bled, so shadow can never be pushed off the model's silhouette. Crease bleed makes two SVGs' shadow regions OVERLAP, which only composites correctly under the opaque pre-blend, so it is enabled only where that pre-blend is BOTH available and exact — and that is decided from the resolved colors BEFORE any clip is expanded, because expanded clips painted at fractional alpha are precisely the double-darkening the design exists to avoid. Three conditions, all checked per face per pass: a solid receiver; exactly ONE light pass; and every member of the group painting exactly `fullLitFill` — verified by re-shading each member from its OWN normal and centroid (`groupMembersShareLitColor`), not assumed from a shared base color. Those make a face ELIGIBLE; they say nothing about the neighbour it would bleed into, and eligibility alone is not licence to expand. `memberCreaseEdges` therefore stores the neighbouring PLANE INDICES (not bare normals), and `qualifiesCrease` requires four things of the neighbour across a given edge: it faces the camera (otherwise the crease is the camera silhouette and the expansion hangs in free space past the model outline); it EMITS a layer in this same pass (a camera-facing neighbour need not be a shadowed one — under a vertical light a side face fails `L·n` and emits no SVG, and bleeding into it paints shadow onto lit surface with nothing to fuse with); its resolved opaque pre-blend is the SAME colour (each face's pre-blend derives from its own lit colour, and crease neighbours are non-coplanar by construction, so the two usually differ — overlapping two different opaque fills is not idempotent, it just paints one over the other, a seam of the wrong colour, measured `rgb(79,79,79)` over `rgb(69,69,69)` on the standard L fixture); and it bleeds BACK toward this face, so neither side is left painting at alpha under the other's opaque strip. Answering "does the neighbour emit?" needs emission before expansion, so `computeReceiverShadowFaces` runs in two phases: phase 1 computes every face with crease bleed off (emission is crease-independent — a bleed only ever GROWS a member clip), phase 2 re-runs only the planes that end up with a qualifying neighbour. Where nothing qualifies — the common case, since differing lit colours are the norm at a crease — phase 2 does no work and the face keeps the alpha form and unexpanded clips. A group is formed by plane + adjacency, so neither one material nor one normal follows from membership: `RECEIVER_NORMAL_TOL` admits members ~2.5° apart, and over that spread the residual `(leaf − fullLitFill)·(1 − opacity)` was measured up to 11/255 at the default opacity 0.25 (bright base, low ambient, grazing light) — visible, so those groups keep the alpha form. On the castle the check costs 7 of 2286 groups and zero mounted shadow faces. The pre-blend must also be REPRESENTABLE: `blendShadowOverLitBase` returns null for a non-opaque-hex color, which a translucent receiver always produces (`shadePolygon` preserves alpha as `rgba(...)`), and such a face keeps unexpanded clips at its own alpha. Textured receivers, multi-light merged faces, multi-colored coplanar groups, groups with non-uniform member shading, and translucent receivers all keep the alpha form and get no crease bleed. `ReceiverFacePlane` carries `memberPolysWorld`, `memberSharedEdges`, and `memberCreaseEdges` as OPTIONAL fields — `prepareReceiverFacePlanes` always fills them, and a hand-built plane passed straight to `computeReceiverShadowFaces` still type-checks and simply gets no seam bleed, no crease bleed, and no pre-blend (its members' shading cannot be verified). That degradation is deliberate: it is the safe answer, not a silent approximation. The shadow clip applies the group's convex outline BEFORE the per-member clips, so the stored `RECEIVER_OUTLINE_EXPAND` (0.5) would cap the per-edge amount wherever a crease sits on the hull — 91% of the castle's crease edges, held to 0.5 px of the 0.75 px they were granted. `computeReceiverShadowFaces` therefore widens its own COPY of the hull by the shortfall (`CLIP_OUTLINE_EXTRA`), and only where crease bleed is already active. The stored outline keeps its 0.5, because it also sizes each face plane's `minU/minV/width/height/matrixCss`: widening it unconditionally shifts emitted geometry on multi-light and textured receivers, which get no crease bleed at all (measured — it moved 40 SVGs on a multi-light castle). The hull is not the surface boundary, the member clips are, and they still bound every edge, so widening the clip copy cannot push shadow past a member outline.

Receiver shadows re-emit on camera motion only when the camera crosses a receiver-face VISIBILITY BOUNDARY, in all three renderers. Shadow output genuinely depends on the camera in two places — `computeReceiverShadowFaces` culls back-facing receiver faces, and a crease bleeds only toward a camera-facing neighbour (which also flips that face between the opaque pre-blend and the alpha form) — so a frozen orbit shows stale geometry that then pops on the next unrelated light or geometry change. Re-emitting per frame is the other failure. The gate between them is `receiverShadowCameraSignature`: one `normalFacesCamera` bit per receiver face plane, packed base-32 behind the count of contributing planes, which is the complete camera dependence because both decisions reduce to that same per-plane boolean. The count is not decoration — the final bit group is zero-padded to five, so without it every all-back-facing receiver of one to five planes packs to the same `"0"` and a plane-set change between two such states reads as "camera unchanged". Planes no light can reach are omitted — they emit nothing at any camera angle, so their bits would invent crossings; all three renderers pass the pass lights (`ReceiverShadowSignatureLights`), and omitting them (as React and Vue did) re-ran the whole pipeline on every horizon crossing of an unlit wall. Mesh rotation is deliberately NOT in the signature, because `plane.n` is already in world frame — which makes the key meaningless against planes built at a different mesh rotation, so every renderer must rebuild its planes and re-emit on a transform change BEFORE comparing keys (vanilla's `setTransform` gate therefore covers rotation alongside position and scale; React/Vue get it from `receiverPlanes` depending on `rotation`). Vanilla folds the signature into the emit short-circuit next to the light key and calls `syncShadowsForCameraChange` from `applyCamera`; React and Vue subscribe to the camera store, mirror the signature into state (`cameraShadowKey`, seeded from the store so the first render already holds the true key), and let the shadow memo/computed depend on it — a signature-gated subscription, never a per-frame recompute. An unchanged signature costs one per-plane facing sweep and returns. Measured on the bench castle (self-shadow + floor, parametric def 48): a full 360° orbit in 1° steps re-emits 71 times, ~one per 5° of azimuth, median step 0 ms and mean 2.2 ms; before this it re-emitted 0 times and the output was stale for the whole sweep. Projection (`merge`) is ~98% of each re-emit, so making crossings cheaper would mean caching specs per plane and recomputing only flipped planes — not done. All three renderers also share the same per-caster memoization: cached caster world-space items (vanilla `casterItemsCache`, React/Vue module WeakMaps keyed on polygon-array identity + transform), a per-caster parametric-override cache (at most two variants — self/cross — reused across every receiver), and a shared O(n²) overlap-dedup cache keyed on polygon-array identity + option set.

Receiver-shadow geometry has two caster paths. The default per-mesh **silhouette fast path** (caster ≠ receiver, ≥40 polys) projects one outline per caster instead of every front-facing triangle — but only when the caster's silhouette under the current light is a clean union of simple closed loops (every silhouette vertex shared by exactly two silhouette edges). Meshes whose silhouette has non-manifold / T-junction / open-boundary vertices (imported architecture like the castle) fall back to the **per-polygon union**, which is gap-free for any topology. Light-back-facing caster polygons are normally culled (single-sided casting, correct for clean closed meshes); the per-poly path casts **double-sided** (skips that cull) for two cases — cross-mesh casters whose silhouette is unreliable, and ALL self-shadow casters (caster = receiver) — so badly-wound / single-sided interior walls don't leave holes. Closed meshes are unaffected by double-siding: their far back-faces sit below each lit receiver plane and get above-plane-culled, adding no spurious shadow.

**Parametric shadows (all three renderers, opt-in via `shadow.parametric` + `shadow.definition`).** A lightweight approximation that replaces a caster's per-poly/silhouette projection with low-resolution coverage-contour loops, so a complex caster emits far fewer shadow-path vertices. Per caster the light-perpendicular coverage is rasterised into a mask (resolution scales with `definition`), traced with marching squares, simplified, and lifted back to 3D for the normal receiver projector. Cross-mesh casting uses ONE flat proxy outline slid toward the light so it clears receivers below the caster (footprint is depth-invariant under directional projection); self-shadow uses depth-stratified bands, each biased to its far-from-light edge so a face is only shadowed by geometry genuinely in front of it. The approximation is governed by named **rubrics** measured parametric-vs-exact in `bench/shadow-rubric.mjs`; the current correction terms are: **flat casters route to the exact path** (their tilted proxy would project garbage onto a coplanar receiver), **convex casters skip self-shadow** (a convex surface self-shadows nothing), **self-shadow depth-bias** (flat band proxies otherwise over-darken), and **hole subtraction** (coverage holes — courtyards, the coliseum arena — are emitted with opposite winding by nesting depth and the override path preserves that relative winding so they subtract under the receiver's `fill-rule: nonzero`; the exact path keeps per-loop CCW). Higher `definition` trades DOM weight for fidelity and is the knob for resolving fine concave holes. **Point lights** are supported: each shadow-casting point light gets its own RADIAL override silhouette built from the caster-centroid → light direction (the small-object approximation point shading already uses), stored per-light in `overridePointSilhouettes` and selected per pass; the directional override is the wrong outline for a finite-distance light, so point passes never reuse it. Parametric does not change the exact path, which remains the default. **Render style** is selectable via `shadow.style`: `"vector"` (default) traces the smooth concave contour; `"pixel"` greedy-meshes the coverage mask into axis-aligned rectangles for a blocky/voxel shadow — holes (courtyards, the coliseum arena) fall out for free as absent cells (no winding/`fill-rule` work), and `definition` becomes the pixel-grid resolution (lower → chunkier; the block size is the aesthetic). Both styles share the per-mesh def, point-light, and progressive machinery. The override builder (`buildParametricCasterOverride` + `isFlatCaster`/`isConvexCaster`) lives in **core** so all three renderers produce byte-identical loops — vanilla `receiverShadow.ts`, React `PolyMesh.tsx`, and Vue `PolyMesh.ts` each just call it in their caster loop and drop the result on the `ReceiverCasterInput`. Per-mesh `shadowDefinition` is a `PolyMeshTransform` field (vanilla), a `<PolyMesh shadowDefinition>` prop (React), and a `shadow-definition` prop (Vue). The ONE intentional asymmetry: **progressive `dragDefinition` is vanilla-only**, because it's a `createPolyScene` orchestration concern (auto-detect a light-direction change → emit at the drag def → debounced full-def refine). React/Vue are declarative and re-render on prop change, so an app gets the same effect idiomatically by lowering `shadow.definition` in its own state during a drag and restoring it at rest. **Animated shadows** (`shadow.followAnimation`, all three renderers): a caster's shadow normally FREEZES during a same-topology deform — re-projecting every frame is expensive — so the default is frozen and `followAnimation` opts into tracking the pose (pair with a low parametric `definition`). All three renderers throttle the follow re-emit to the same 80ms window (~12fps, leading + trailing edge so a paused animation still lands its final pose): vanilla in `setPolygons` (`maybeEmitAnimationShadow`), React/Vue by gating + throttling the caster re-registration (a same-topology polygon change is skipped unless `followAnimation`, so the receiver re-emits only when following). Topology changes (different polygon count) always re-emit regardless.

**Cost + the laggless levers.** Cross-mesh/floor cast shadows are cheap (one outline, ~1 receiver face) and follow a moving light at 60fps+; camera orbit is nearly free (shadows ride the scene transform; a re-emit happens only when the camera crosses a receiver-face visibility boundary — see the signature gate above). SELF-shadow is the expensive case: it projects every depth band onto every one of the mesh's own coplanar faces, so the recompute is O(faces × bands × points) and that work is irreducible by spatial culling (the depth-band proxies span the whole mesh, so their AABBs overlap nearly every face — a broad-phase cull was measured to reject nothing). The lever for smooth interaction is therefore reducing *quality during motion*, not a faster projector. Two knobs make this configurable:
- **Per-mesh `PolyMeshTransform.shadowDefinition`** overrides the scene `shadow.definition` for one mesh's cast/self shadow — a detailed caster stays sharp while a simple prop runs cheap in the same scene.
- **`shadow.dragDefinition`** is the library's built-in progressive refinement: when set (and `parametric`), a light-DIRECTION change emits at `min(definition, dragDefinition)` for a laggless drag (castle ~100fps at 16 vs 36fps at 96), then a debounced pass re-emits at full `definition` once the light settles — the same atlas-rebake-at-rest escape hatch. It's auto-detected in `setOptions` (direction change = motion; an appearance edit like the `definition` slider renders full immediately). Per-mesh def composes: motion caps each mesh at `min(its def, dragDefinition)`.

The fps↔definition curve and per-phase breakdown are measured with `bench/shadow-trace.html` + the chrome-trace skill; `bench/shadow-parametric.html` exposes both knobs (`definition`, `dragDef` sliders; `?def=`, `?dragdef=`).

The `.vox` fast path emits plain `<b>` elements inside `.polycss-voxel-face` wrappers. They intentionally reuse the cheap quad tag; each visible quad has one `matrix3d(...)`, with same-color shared-edge overscan folded into the local left/top/width/height before matrix generation. The face wrappers are grouping nodes for cheap add/remove and are not render-strategy leaves. Desktop-class documents use a canonical 1px primitive for the cheapest transform shape; mobile-class documents (`pointer: coarse` or `hover: none`) use an 8px primitive and divide the in-plane matrix scale by 8 to preserve identical CSS-space geometry while avoiding large GPU filtering gaps.

### Lights

The scene takes one `directionalLight`, one `ambientLight`, and zero or more `pointLights` (`PolyPointLight[]`). Directional light `direction` is the unit source vector from the surface toward the distant light. Point lights are **direction-only** — no distance falloff. Per polygon the contribution is `color · intensity · max(0, n · L̂)`, where `L̂` is the unit direction from the surface to the light position; multiple colored lights accumulate per-channel alongside the directional + ambient terms. This deliberately omits CSS gradients: point lights shade flat-per-face (an accepted approximation vs three.js's per-fragment `PointLight(distance:0, decay:0)`; exact for small faces / distant lights). Point lights are **baked-mode only** — the dynamic mode's zero-JS light move can't express a per-face direction that varies with position, so dynamic scenes ignore `pointLights` entirely: not for surface shading, and not for shadows. (A point light casting a shadow onto a floor those same lights never lit would read as broken, so dynamic shadows are directional-only — see the lighting modes below.)

### Lighting modes (`PolyTextureLightingMode = "baked" | "dynamic"`)

- **Baked.** Lambert (directional + each point light + ambient) is computed once on the CPU per polygon, multiplied into the inline `color` (for `<b>`/`<i>`/`<u>`) or into the rasterised atlas pixels (for atlas-backed `<s>`). Direct image `<s>` leaves preserve source pixels and use `texturePresentation.lighting="source"`; scene-lit direct images fall back to the atlas path. Moving a light requires explicit re-rasterising of affected lit atlas polys via `mesh.rebakeAtlas()` — the atlas bake (canvas raster + async `toBlob`) is the one expensive step, so the vanilla imperative API does NOT auto-rebake the lit surface on a `setOptions({directionalLight})` change; that keeps high-frequency light drags fast (the caller rebakes, typically debounced to drag-end). Cast shadows ARE cheap (CPU-projected SVG paths) so they re-emit automatically on any light change — direction, intensity, or color (intensity 0 removes the shadow) — and follow the light interactively even while the baked lit side stays frozen. **Renderer asymmetry:** the declarative React/Vue components re-render → auto-rebake the lit surface on any light prop change; vanilla freezes it until an explicit `rebakeAtlas()`. This is intentional (vanilla keeps the fast-drag escape hatch); for live/animated lights prefer dynamic mode. Left as-is by design — do not "fix" the asymmetry by making vanilla auto-rebake without explicit approval. **Exception:** a `setOptions({pointLights})` change DOES re-render every mesh in vanilla (`createPolyScene.ts` `pointLightsChanged` → `renderEntry`), so the freeze applies to the directional light only.
- **Dynamic.** Scene root carries the directional + ambient setup as custom properties (`--plx/y/z`, `--plr/g/b`, `--pli`, `--par/g/b`, `--pai`). Each leaf embeds its surface normal (`--pnx/y/z`) and base color (`--psr/g/b`) inline. CSS `calc()` resolves the Lambert dot product and per-channel tint at paint time. Moving a light mutates scene-root vars for surface lighting — zero JS, no atlas redraw. Point lights are not represented in dynamic mode at all — neither surface shading nor shadows (see above). Cast shadows are **directional-only** in dynamic mode (CPU-projected SVG paths, ambient fill) and re-emit when the directional light changes.

All solid and atlas-backed tags work in both modes. Direct image `<s>` leaves are source-lit only; callers that need scene lighting use the atlas backend. The `.vox` direct-matrix fast path is baked-only for now; dynamic mode uses the polygon path so lighting semantics stay correct. The full coverage matrix is in `packages/polycss/src/styles/styles.ts`.

### Meshing implications (what generators must respect)

- **Polygon count is the dominant cost.** Each polygon is one DOM node, one `matrix3d`, one paint. Halving the polygon count is almost always worth a more complex mesher.
- **Lossy optimization favors low DOM render cost.** The default `"lossy"` `loadMesh` / core import path first bakes solid texture swatches, merges visually redundant baked swatch colors, and tries endpoint-preserving static triangle simplification for eligible non-animated meshes. It then scores exact and approximate merge candidates by estimated render cost and keeps the cheapest direct candidate. Static simplification has a relaxed seam-key pass plus a stricter source-vertex fallback, and is accepted only when the final optimized DOM leaf count is lower than the baseline optimizer result. The polygon optimizer can also try a more aggressive triangle-pair merge candidate inside the same boundary displacement budget, but accepts it only when the render-cost win is material and whole-mesh seam diagnostics do not get worse. STL parse results are the conservative exception: they keep the lossless optimizer path and skip ray-based interior culling because public CAD/STL corpora frequently contain shell, winding, or topology quirks where false-positive culling is a visible data-loss bug. It avoids per-candidate seam-repair passes in the import path; targeted seam repair remains a lower-level helper for explicit repair workflows.
- **Fill ratio matters.** An atlas-backed textured polygon's atlas slice equals its local-2D bounding rect. Empty space inside that slice is wasted bitmap pixels. Direct image leaves avoid atlas memory, but only for source-exact surfaces with preserved source metadata and source lighting. Prefer atlas shapes with high `area / boundingRect.area`:
  - axis-aligned rectangle = 1.0 (and hits the fastest path)
  - right-isosceles triangle = 0.5
  - skinny/long triangle ≪ 0.5 (worst case — many such triangles balloon atlas memory)
- **Regular grids are not a constraint.** Vertices may sit anywhere on the surface. Any planar tiling whose edges match across neighbours (no T-junctions, no cracks) is valid. Break the grid where it lets you fit larger axis-aligned rects to flat regions.
- **Coplanarity is a hard requirement at render time, but the mesher can engineer it.** A non-triangular polygon must have all vertices on a common plane within a small epsilon, or the renderer snaps the offending vertex in isolation and opens a visible seam with adjacent polygons. The mesher avoids this either by (a) only merging when natural coplanarity holds, or (b) deliberately snapping shared vertices to a common plane and propagating the new position to *every* polygon that references them. Snap-and-propagate is preferred when it widens the merge opportunity, subject to the budget below.
- **Vertex displacement budget.** Every snap consumes budget on the moved vertex and on all polygons that reference it. Track cumulative displacement from the original DEM-sampled position per vertex; reject any merge that would push a vertex past the user's height tolerance. Errors compound across merges, so the bound is per-vertex cumulative drift, not per-merge.

## The "no JS in the render loop" principle

This is the load-bearing constraint behind the whole engine. **JavaScript should not run per-frame to paint polygons when the motion can be expressed as a scene, mesh, camera, or light update.** Once the scene is built and the atlas is rasterised, the browser drives most rendering through CSS — `matrix3d` transforms, `calc()`-driven custom properties, `background-blend-mode`, `border-shape`, etc.

The renderer exception is imported skeletal animation. glTF/GLB skinning changes each polygon independently, so the vanilla stable-DOM animation path samples the active clip in JS, keeps the leaf set mounted, caches baked stable-triangle transform frames, and pins each mounted triangle's baked color while transforms animate. Recomputing Lambert from every deformed low-poly face normal creates visible color pumping, so color refresh is internal opt-in rather than the default animation behavior. On WebKit/Safari, where stable CSS triangles fall through to solid atlas `<s>` leaves, same-topology animation updates keep the existing atlas elements and bitmap URLs mounted, cache transform frames once warmed, and hide briefly degenerate atlas triangles only until the next valid frame. That optimized path is the default; do not add a user-facing "baseline vs optimized" toggle or maintain a legacy slow path in product UI.

The domformat reference mount has one separate, closed exception: it may schedule validated prepared playback and interaction tables. The scheduler sleeps on a deadline timer and requests one paint-aligned animation frame only when a bounded-rate, exact rational-microsecond, or prepared timeline deadline is due; it does not poll display frames continuously. It may write only declared sinks on retained targets, never reconstruct topology or evaluate producer code, expressions, renderer internals, or arbitrary network resources, and is disabled by `animate: false`. The binding selects bounded catch-up (up to eight ordered ticks, then one suspension tick), single-step deadline reset, or animation-only collapsed elapsed reconstruction. Prepared effects and interaction simulate every admitted tick because their state is history-dependent, so they cannot use collapsed elapsed catch-up. Closed compositor timing may instead give a retained model cycle to viewer-owned WAAPI or add viewer-owned linear transform transitions for fixed cadence only; seek, catch-up, restart, pause, and wrap synchronously snap prepared state. This is a reference implementation of an already-lowered wire profile, not a PolyCSS renderer loop.

| Where JS runs | Where JS does NOT run |
|---|---|
| Scene construction (`createPolyScene`, mesh ops, vertex snapping) | Per-frame polygon paint |
| OBJ/STL/glTF/GLB import, mesh optimisation, coplanar merging | Per-frame Lambert evaluation (dynamic mode is pure CSS) |
| Atlas planning + rasterisation (one-shot to `<canvas>`, then `toBlob`) | Per-frame atlas redraw (only on baked-mode light changes) |
| Control input handling (`PolyOrbitControls`, `PolyMapControls`, `PolyTransformControls`) | Per-frame transform recomputation of every polygon for camera/mesh motion — only the scene-root or mesh-root transform changes |
| Camera math (matrix4 product → scene-root `transform` CSS var) | Per-polygon JS in any hot path |
| Hover/selection raycasting (only on pointer events, not per frame) | Continuous renderer re-rendering "ticks" |

If you find yourself wanting a `requestAnimationFrame` loop to update many renderer DOM nodes outside skeletal animation or the closed domformat prepared-runtime exception, stop. Find the CSS variable that should be carrying the change, and update that single variable on a single ancestor. Cascading + `@property`-registered custom properties do the rest.

### PolyCSS Morph boundary

`@layoutit/polycss-morph` is an imperative, framework-agnostic prepared-model
layer. It does not replace ordinary `Polygon[]` loading and it does not add
React or Vue wrappers.

- `@layoutit/polycss-morph/prepare` is the Node-only authoring boundary. It
  reads strict config plus glTF/GLB input and writes a deterministic,
  content-addressed package with `manifest.json` last. The generic preparer
  directly authors `static-prepared` and `morph-regions` with canonical solid
  CSS triangle leaves for base-color materials plus packed prepared alpha-atlas
  pages for browsers without the corner-shape triangle primitive. Every
  polygon owns a slice sized to its local-2D bounding rect and a precomputed
  transform relation; there is no shared canonical triangle mask. The pages
  are generated with Node built-ins, add no native image dependency, and are
  selected once at mount without runtime rasterization. Product adapters or
  dedicated tooling may author other validated image-backed, `joint-skin`, and
  `prepared-playback` packages.
- `@layoutit/polycss-morph` is the browser-safe boundary. It validates and loads
  prepared packages, mounts one retained PolyCSS graph, and exposes
  caller-driven runtimes for morphs, controls, springs, animation, skinning,
  and prepared playback.
- Sparse deformation supports retained solid triangles and affine solid quads.
  Browsers where PolyCSS enables projective quad compositing also accept planar
  projective solid quads. Quad updates recompute one CSS `matrix3d(...)` per
  dirty leaf; deformation rejects non-coplanar, non-convex, or
  compositor-unstable geometry, and the retained mount rejects projective quad
  matrices on unsupported Safari-family browsers before DOM writes.
- `createPolyMorphPreparedDomTarget` adopts a caller-owned retained graph as
  source-ordered model, shape, and leaf targets. It tracks requested values for
  sparse write deduplication, preserves element identity, invalidates writers
  when destroyed, and leaves DOM teardown to the caller.
- A mount uses PolyCSS's public solid-triangle support check, so Firefox keeps
  its border-triangle path while WebKit/Safari selects each leaf's prepared
  polygon-sized atlas slice. Image paint comes only from loader-verified bytes:
  mount creates object URLs once and revokes them at teardown, with no resource
  refetch or arbitrary prepared CSS injection. It creates topology and leaves
  once. Runtime samples may update only declared model, shape, or leaf state.
  They must preserve leaf identity, must not rebuild topology or redraw atlases,
  and must not own a scheduler. Prepared playback commits a sample only after
  the caller's retained apply succeeds. The caller owns input and timing.
- Morph does not copy renderer feature detection or maintain a fourth visual
  browser harness. Package certification exercises native and fallback retained
  DOM resolution; actual engine-specific triangle painting remains covered by
  the renderer-owned browser paths that define `isSolidTriangleSupported`.
- The four executable profiles are `static-prepared`, `morph-regions`,
  `joint-skin`, and `prepared-playback`.
- Product-specific source cadence, schemas, preparation provenance, mounting
  paths, product behavior, and oracle evidence stay in the consuming product.

### domformat boundary

`@layoutit/polycss-domformat` is the private, producer-neutral reference package
for the experimental `domformat@0` wire contract. It is not a serialization
alias for Morph packages and does not depend on Morph or renderer internals.

- Node exposes only `buildDom`, `readDom`, `readDomFile`, `validateDocument`,
  and `DomFormatError`; the CLI exposes only `encode`, `decode`, `inspect`, and
  `validate`; the browser subpath exposes only `readDomBrowser`,
  `readDomBrowserUrl`, and `mountDom`.
- Producers emit the closed writer manifest natively. Source parsing,
  preparation, lowering, and product adapters remain in producer packages.
- The only physical form is canonical `.json` plus digest-bound external
  sibling resource files. There is no `.dom` packet, gzip document transport,
  embedded payload, archive, or alternate packaging mode. One fixed typed
  state-page resource kind may use bounded gzip with exact encoded and decoded
  identities; this is not a generic binary/custom-codec facility.
- Mounting follows `validate → construct → bind → initialize → publish →
  destroy`, with rollback on partial failure and idempotent teardown. Eager
  CSS/images verify before construction; initial and fixed-interaction state
  pages verify before attachment; playback-initial, interaction-entry, and the
  current prepared-bank entry remain pinned beside deferred current/lookahead
  pages under an exact hard resident window. Inactive bank entries are not all
  retained. Sync
  nonresident seek fails without mutation and
  `seekAsync` cancels stale generations before exact publication.
- Runtime publication preserves sparse prepared tables and retained identity.
  Variant class/effect ownership is explicit, packed full atlas positions are
  typed signed-pixel dictionary entries, catch-up coalesces only touched
  targets, and class/transform/address writes complete before reveal.
- Root presentation profiles are bounded numeric width breakpoints or one
  landscape-first row followed by portrait width bands, with prepared
  contain/cover bounds and optional quarter-turns. Same-topology
  viewport profiles may override leaf transform/visibility, carry sparse
  profile-by-source-frame visibility, and evaluate the closed prepared
  viewport-affine coefficient form only on resize/profile change. Playback keeps a
  required baseline timeline and may select ordered bounded overrides by those
  root profile ids; all use the binding's bounded rate, exact rational interval,
  or prepared deadline schedule. Selection precedes initial
  publication. Only an animation schedule identity change restarts logical
  tick zero and the initial one-based source frame before viewport reveal;
  presentation-only band changes preserve the current deadline. Interaction state survives profile changes until
  animation re-entry restarts the selected schedule. The typed orbit
  operation exposes only finite clamped pitch/yaw/zoom and prepared cyclic
  address rows; pointer/wheel/inertia/camera-widget policy stays in the host.
- An optional finite prepared-bank table maps host-selected stable ids to
  canonical entry frames and schedules over the same retained topology. Sync
  selection requires residency; async selection verifies the complete
  cross-channel window before atomic publication. Random, shuffle, catalog,
  playlist, and fetch-choice policy stay in the host.
- META may bind multiple exact byte-identity artifacts. Separately inert,
  bounded claims never grant fetching, execution, trust, authenticity, or
  rights authority.
- The package is authored in strict TypeScript, built as code-split ESM plus
  declarations with tsup, `private`, and MIT-licensed. Workspace test/build
  commands include it; public version-bump and npm-publish automation must not.
  Public Node and browser signatures describe the closed document, resource,
  options, lifecycle, and controller contracts.
- Domformat's repository-side tests intentionally remain one certification
  suite under `test/` using `node:test`. In-process contract tests share the
  same corpora and helpers as the raw-ESM, CLI-subprocess, independent Python,
  and real-browser harnesses, with one package-level coverage gate. Tests
  execute the authored TypeScript through `tsx`; the release gate separately
  exercises the clean-installed compiled package. This is the package's
  explicit exception to sibling Vitest/co-location conventions, not an
  exception to strict typing, declarations, coverage, or the mandatory build
  gate.
- Install tarballs contain only package metadata, README, CLI, compiled runtime,
  and declarations. Specifications, independent readers/producers, fixtures, the
  alternate mount shell, scripts, and tests remain repository-side
  certification material. The alternate shell shares the single reference
  lifecycle, input adapter, and profile interpreters rather than copying them.
- The first concrete producer is website-owned:
  `website/scripts/generate-gallery-domformat.mjs` lowers all Gallery presets
  through shared Gallery preset/loader/presentation/animation behavior into
  canonical documents under
  `website/gallery-domformat-corpus/`. The generated 304-model corpus and its
  digest-bound CSS/image siblings are website assets, never package payload or
  runtime code. Its catalog pins the exact Chromium strategy environment and
  per-model strategy counts; the corpus does not claim browser-neutral leaf
  topology. Static documents are presentation-only; animated documents add
  one Gallery-selected preferred clip at 30 Hz. Adding this producer does not
  move source parsing or renderer internals into domformat.

## Naming (three.js parity)

- Brand text is **PolyCSS**. Keep lowercase `polycss` only for literal package names, import paths, CSS classes, domains, and other code identifiers.
- The `Poly` prefix marks USER-FACING surface: components, hooks/composables, custom elements, vanilla factory option/handle types, scene/mesh option types, and light/camera/texture option vocabulary (`PolyDirectionalLight`, `PolyShadowOptions`, `PolyTextureLightingMode`, …). Core's internal-domain vocabulary is intentionally unprefixed — math (`Vec2`, `Vec3`, `Polygon`), atlas planning (`TextureAtlasPlan`, `PackedAtlas`), camera state (`CameraState`), parsing (`ParseResult`), mesh ops (`OptimizeMeshPolygonsOptions`) — because those names read as the domain they model, not as brand surface. The closed domformat API and the `*/three` compatibility subpaths keep their own naming (Three-compatible names are the point there); React/Vue components in the three subpaths still use the `PolyThree` prefix. Known gap pending an explicit rename decision: `@layoutit/polycss-fonts` exports generic names (`Face`, `Profile`, `WarpOptions`, …) into the shared namespace.
- **Hooks/composables:** `usePolyCamera`, `usePolyMesh`, `usePolySceneContext`, `usePolySelect`, `usePolySelectionApi`, `usePolyAnimation`.
- **Components:** `PolyPerspectiveCamera`, `PolyOrthographicCamera`, `PolyOrbitControls`, `PolyMapControls`, `PolyTransformControls`, `PolySelect`, `PolyAxesHelper`, `PolyDirectionalLightHelper`, `PolyIframe`, `PolyThreePerspectiveCamera`, `PolyThreeOrthographicCamera`, `PolyThreeMesh`.
- **Types:** `PolyDirectionalLight`, `PolyPointLight`, `PolyAmbientLight`, `PolyTextureLightingMode`, `PolyTextureLeafSizing`, `PolyTextureBackend`, `PolyTextureImageRendering`, `PolyTextureImageLighting`, `PolyTextureProjection`, `PolyTexturePresentation`, `PolyTextureImageSource`, `PolyCameraProjection`, `PolyCameraSnapshot`, `PolyCameraSnapshotStats`, `PolyMeshTransformInput`, `PolySceneTransformInput`, `PolyAnimationMixer`, `PolyRenderStats`.
- **Functions:** `findPolyMeshHandle`, `injectPolyBaseStyles`, `collectPolyRenderStats`, `collectPolyTextureReadiness`, `queryPolyLeaves`, `resolvePolyTextureLeafGeometry`, `resolvePolyTextureImageSource`, `resolvePolyTexturePresentation`, `resolvePolyTextureImageRendering`, `buildPolyCameraSceneTransform`, `buildPolyMeshTransform`, `buildPolySceneTransform`, `capturePolyCameraSnapshot`, `polyCameraTargetToCss`, `resolvePolyCameraAppliedPerspectiveStyle`, `worldPositionToCss`, `worldPositionToPolyCss`, `cssPositionToWorld`, `polyCssPositionToWorld`, `worldDistanceToCss`, `worldDistanceToPolyCss`, `cssDistanceToWorld`, `polyCssDistanceToWorld`, `worldDirectionToCss`, `worldDirectionToPolyCss`, `worldDirectionalLightToCss`, `worldDirectionalLightToPolyCss`, `exportPolySceneSnapshot`.
- **Vanilla factories:** `create*` names stay as-is (`createPolyScene`, `createTransformControls`, `createSelect`).
- **HTML custom elements:** `poly-` prefix + kebab-case. Registered tags (see `packages/polycss/src/elements/index.ts`): `<poly-scene>`, `<poly-mesh>`, `<poly-iframe>`, `<poly-polygon>`, `<poly-camera>`, `<poly-perspective-camera>`, `<poly-orthographic-camera>`, `<poly-orbit-controls>`, `<poly-map-controls>`, `<poly-first-person-controls>`, `<poly-transform-controls>`, `<poly-select>`, `<poly-axes-helper>`, `<poly-directional-light-helper>`, and the shape elements (`<poly-box>`, `<poly-plane>`, `<poly-ring>`, `<poly-sphere>`, `<poly-cylinder>`, `<poly-cone>`, `<poly-torus>`, and the Platonic solids). Any new element follows the same shape.
- **`<poly-iframe>`:** flat textured "quad" whose "texture" is a live document (an `<iframe>`) instead of an atlas slice. NOT a render-strategy leaf — same transform conventions as `<poly-mesh>` (`position`/`rotation`/`scale` post-parity; iframe content centered at the wrapper's local origin so rotation/scale pivot at the visible center). Mounted as a child of `.polycss-scene` and inherits the camera transform.
- **Leaf DOM tags (`<b>`, `<i>`, `<s>`, `<u>`):** internal render-strategy tags. Not part of the public API and not user-facing — do not document them as such.
- `PolyCamera` is a kept alias for `PolyOrthographicCamera` — the ergonomic default, optimised for iso/voxel/diagrammatic scenes which is PolyCSS's structural strength. **Not deprecated.**

## Cross-package discipline

The React and Vue packages are mirror images. **Any public API change in one must land in the other in the same PR.** Same names, same arguments, same defaults, same return shapes (allowing for idiomatic differences — refs vs reactives, `useEffect` vs `watchEffect`).

When you change `packages/polycss` or `packages/core` in a way that affects the public surface (new option, renamed export, changed default), the React and Vue bindings update in the same PR. Don't ship a PolyCSS change that leaves the bindings stale.

The DOM snapshot exporter is the current exception to mirrored React/Vue public exports: `exportPolySceneSnapshot` lives in `@layoutit/polycss` because it is browser DOM serialization, not component API. React/Vue callers import it from `@layoutit/polycss` and pass the rendered `.polycss-camera` / `.polycss-scene` element.

**Renderer-owned browser glue.** The canvas atlas pipeline (`buildAtlasPages` + helpers), browser-feature detection (`isBorderShapeSupported`, `isSolidTriangleSupported`, `resolveSolidTrianglePrimitive`), direct voxel renderer (`voxelRenderer.ts`), and injected `.polycss-scene` / `.polycss-camera` base styles exist as **independent copies** across the three renderers. This includes `packages/polycss/src/render/atlas/`, `packages/react/src/scene/atlas/`, `packages/vue/src/scene/atlas/`, the three renderer-local `voxelRenderer.ts` files, and the three sibling `styles.ts` files. This is deliberate — each renderer is self-contained on its dep graph (React/Vue do not import from the `polycss` package). The trade-off is that a bug fix in any of these files MUST be mirrored into the other two. Coverage is pinned per copy by the co-located test files.

**CI enforces this and the package boundaries.** `pnpm check:boundaries` (`.github/scripts/check-boundaries.mjs`) fails on any import that violates the dependency table above, on deep imports into another package's `src`, and on node builtins outside the Node-only surfaces. It scans `.ts`/`.tsx`/`.mts`/`.cts` **and** `.mjs`/`.cjs`/`.js` sources (so the `packages/skills` CLI is covered). Specifiers are read by a single-pass **lexer**, not a regex over raw source, because pattern-matching is wrong in both directions: it misses valid imports (a comment between the keyword and the specifier, `import(\`x\`)`, a statement split across lines) and matches text that is not code (a commented-out import, an import-shaped string). The lexer skips comments, tracks single/double-quoted strings, template literals including `${}` nesting, and regex literals, and yields `import`/`export … from`, bare `import "x"`, `import()` and `require()` specifiers; a template WITH a substitution is not a static specifier and is ignored rather than crashed on. Quoted strings and regex literals may never span a newline, so a mis-lex in TSX (JSX apostrophes, `</div>`) recovers on the next line instead of swallowing code. The same allow-list is applied to each package's manifest: a `dependencies`, `optionalDependencies`, or `peerDependencies` entry outside the package's allow-list fails even when nothing imports it yet. `devDependencies` are tooling and are not constrained. The allow-list is applied to the RESOLVED dependency, not the manifest key, because the key is not what gets installed. Resolved forms: `npm:<name>[@range]` aliases; `link:`/`file:`/`portal:` local paths and `workspace:<path>` targets (both read through the target directory's own `package.json` name); and `workspace:<name>[@range]` aliases, versioned or not. So `"@layoutit/polycss-core": "npm:@layoutit/polycss@0.2.0"`, `"workspace:@layoutit/polycss"` and `"workspace:../polycss"` all fail in React under the allowed key. Only bare ranges and dist-tags (`^0.2.0`, `*`, `latest`, `workspace:^`, `workspace:*`, `workspace:1.2.3`) leave the key standing. Everything else is a **violation, not a pass**: a local or workspace target whose manifest cannot be read, an empty or non-string specifier, and every form whose install target is not determinable from the repo — `catalog:` (the target lives in `pnpm-workspace.yaml`), git specs (`github:`/`gitlab:`/`bitbucket:`/`git+…`/the bare `owner/repo` shorthand), remote tarball URLs, `jsr:` (which installs under a rewritten `@jsr/…` name), and any unrecognised `protocol:`. Falling back to the key for an unresolvable specifier is exactly the bypass, so a package that needs one of those forms must declare it in a shape the checker can see through. `pnpm check:mirrors` (`.github/scripts/check-mirrors.mjs`) keeps the copy discipline honest in three ways: react↔vue clones must stay byte-identical; the structurally-divergent mirrors (atlas pipeline, `voxelRenderer.ts`, `styles.ts`, and the react↔vue `scene/mesh/` hook/composable pairs) are hash-pinned in `.github/mirror-lock.json`, so editing any of them fails CI until you re-pin with `pnpm check:mirrors --update`; and — the check that actually enforces mirroring — each mirror set is diffed against a base ref (`--base`, else `origin/$GITHUB_BASE_REF`, else the merge-base with `origin/main`) at two granularities. Per mirrored **pair**: same-named files across the lanes the set declares in `pairLanes` (`useReceiverShadows.tsx` ↔ `useReceiverShadows.ts`), each validated independently — if one member moved, its counterpart must move in the same diff. Per renderer **lane** (`packages/polycss`, `packages/react`, `packages/vue`), for the members that have no counterpart. The lane check alone is not sufficient and is not the primary gate: it collapses each lane to a single "touched" boolean, so editing React `useReceiverShadows` and, separately, Vue `useMeshEvents` marks both lanes touched and passes though nothing was mirrored. Re-pinning the lock launders neither check, because the lock is never consulted here.

Pairing is **declared per set**, not inferred across every lane, because a shared file name is not proof of a counterpart. `mesh-modules` and `atlas-pipeline` pair react↔vue only; `voxel-renderer` and `base-styles` pair all three. The vanilla lane is unpaired in `atlas-pipeline` because it splits the same work into different files (`plan.ts`, `strategy.ts`, `renderPolygons.ts` have no React/Vue file), and the two names it does share are not reliable counterparts — the projective-quad guard default lives in vanilla's `plan.ts` but in React/Vue's `paintDefaults.ts`, so pairing that lane by name reports correctly mirrored work as a divergence. `mesh-modules` is react↔vue for the same reason: the vanilla `packages/polycss/src/api/scene/*` modules are an imperative orchestration split, not per-file copies.

The vanilla↔framework direction is **not** left to the coarse lane check. `atlas-pipeline` declares an explicit correspondence table, `crossLaneGroups`: each entry names one semantic unit of the pipeline and, per lane, the file(s) that implement it, at whatever cardinality the code actually has. If any file in a group changed, **every lane represented in that group must have changed** — so a vanilla-only atlas fix now fails even when other vanilla-lane files moved in the same diff (the bypass it closes). The current groups are `rasterisation` (vanilla `rasterise.ts` ↔ framework `buildAtlasPages.ts`), `capability-detection-and-plan-filtering` (vanilla `strategy.ts` ↔ `detection.ts` + `filterPlans.ts`), `packing`, `plan-construction-and-orchestration` (vanilla `plan.ts` + `renderPolygons.ts` ↔ `paintDefaults.ts` + `useTextureAtlas.ts`), `leaf-emission-and-solid-paint` (vanilla `emit.ts` + `paintDefaults.ts` ↔ `atlasPoly` + `borderShape` + `cornerShapeSolid` + `projectiveSolid`), `solid-triangle-leaf` (vanilla `solidTrianglePlan.ts` + `stableTriangle.ts` ↔ `solidTriangleStyle.ts` + `stableTriangleDom.ts` + `triangle`), and `barrel`. Two same-name pairs are **false friends** and the table says so: framework `paintDefaults.ts` mirrors vanilla `plan.ts`/`renderPolygons.ts`, not vanilla `paintDefaults.ts`; only `packing.ts` is a genuine same-name counterpart across all three. Groups are merged rather than split where the lanes' file boundaries genuinely cross (plan construction sits inside vanilla's `renderPolygons.ts`; the triangle border-width constant sits in vanilla's `stableTriangle.ts` against the framework's `solidTriangleStyle.ts`), because a finer split would fail correctly-mirrored work. The table is validated against the filesystem on every run: every declared file must exist and be a set member, each group must span at least two lanes, no file may sit in two groups, and a set that declares groups must place **every** member in exactly one of them — so it cannot silently rot or go partial. A file with no counterpart is declared in `unmirrored` with a reason instead (today: vanilla `atlas/types.ts`, the imperative render contract React/Vue have no equivalent of). Because a group divergence is narrower than a lane divergence, a waiver's `expectedLanes` is matched against the lanes of the diverging **unit**, not the set-wide lane summary.

**Set structure is checked off the filesystem, before the lock and before the base ref.** Lane parity can only compare files that exist and are declared, which leaves it blind to the two ways a mirror is broken without a one-sided edit: a NEW module added to one lane forms no pair, and a DELETED counterpart reads as a "change" in `git diff --name-only`, so both lanes look touched. Each sync set therefore declares `laneRoots` — the directories it owns — and three rules run against the tree itself: every non-test source file under those roots must be declared; every declared member must still exist; and every pair key must be present in every one of the set's `pairLanes`. A `pairLanes` entry naming a lane the set has no files in fails loudly instead of silently pairing nothing. `--update` runs these first and refuses to re-pin a broken tree, so the lock cannot launder a missing file. Deliberately lane-local files are declared in a set's `unmirrored` map with a reason, and each entry must still point at a real file so the exemption list cannot go stale. Today the only entries are the React and Vue `src/styles/index.ts` barrels, which have no vanilla counterpart.

**What the mirror check can and cannot prove.** It proves mechanical parity: both sides of a pair or a declared cross-lane group changed in the same diff, both still exist, neither side is a pure deletion, and no module joined a mirrored directory in one lane only. It does **not** prove the two changes are the SAME change. **Touch parity is not semantic parity** — and the correspondence table does not change that. Naming vanilla `rasterise.ts` and React/Vue `buildAtlasPages.ts` as one unit forces all three to move together; it cannot tell whether they moved for the same reason, so a real fix on one side and a comment tweak on the other still passes. What the table buys is precision about WHICH files must move, not evidence about what changed inside them. Semantic equivalence is a review responsibility and is not mechanically checkable; do not read a green `check:mirrors` as "the fix was mirrored". Group granularity is a second, related limit: where a group is many:many (`leaf-emission-and-solid-paint`, `solid-triangle-leaf`, `plan-construction-and-orchestration`), ANY file per lane satisfies it, so a change to vanilla `emit.ts` is discharged by a change to any one of the four framework leaf files. That is deliberate — the lanes' file boundaries do not line up, and a finer split fails correct work — but it means those groups are weaker than the 1:1 ones. `plan-construction-and-orchestration` is also partial by construction: the framework's leaf DISPATCH half lives in `PolyMesh.tsx`, outside the set's `laneRoots`, so a dispatch-only change is not covered. Two smaller limits are accepted rather than papered over: co-located tests are excluded from discovery (their names diverge across lanes by convention, e.g. `colorResolver.behavior.test.tsx` ↔ `colorResolver.test.ts`), so a test-only file added to one lane is not caught; and discovery only sees directories a set declares as `laneRoots`, so a mirrored copy created somewhere else entirely is invisible until it is declared.

Intentional per-renderer divergence is declared in `.github/mirror-waivers.json` as `{ "reason", "files", "expectedLanes", "baseHashes" }` — all four mandatory. A waiver authorizes **one reviewed divergence** and is bound to the diff it was written for by two independent checks: the entry must DIFFER from the entry at the base ref (absent there counts), which makes "a waiver appears in the PR diff" literally true; and its `baseHashes` must match the sha256 of each waived file's content at that base ref, which makes the binding tamper-evident. So a merged waiver cannot silently excuse later work — the next PR to touch the same files is rejected with the hashes it needs to re-justify a fresh entry. Within the diff it does cover, a waiver still excuses only the exact files it names and only the lane pattern it recorded. Waivers are echoed loudly in the CI log, `--update` never writes them, and a stale entry that excuses nothing is reported as ignored rather than silently honored. The lane check cannot disable itself: an explicit `--base` that does not resolve, and a `git diff` that fails against a resolved base, are errors, and CI runs `pnpm check:mirrors --require-base` with `fetch-depth: 0` so "no base ref" fails the job too. The only surviving skip is a local run with no `--base`, no `GITHUB_BASE_REF` and no `origin/main`, and it prints a NOT ENFORCED banner. `pnpm typecheck` runs `tsc --noEmit` per package (after `pnpm build:packages`, which sibling type resolution needs).

Before opening a PR:

- [ ] If I touched a React component/hook, the Vue composable/component matches.
- [ ] If I touched a Vue component/composable, the React component/hook matches.
- [ ] If I added an option to a `polycss` factory, both bindings expose it.
- [ ] If I renamed a `core` export, every package that imports it is updated.
- [ ] If I touched the canvas atlas pipeline (`rasterise.ts` / `buildAtlasPages.ts`), browser-feature detection, or direct voxel renderer in ONE renderer, the same fix lands in the other two renderers (`polycss` + react + vue) in this PR.
- [ ] If I touched any of the three `styles.ts` (`packages/polycss/src/styles/styles.ts`, `packages/react/src/styles/styles.ts`, `packages/vue/src/styles/styles.ts`), the other two are consistent — CSS rules cover every emitted tag for both lighting modes, and shared properties like `will-change: transform` on `.polycss-scene` exist in all three.
- [ ] Website docs (`website/src/content/docs/**`) and READMEs reflect any user-visible change.
- [ ] If a user-visible change contradicts the agent skill, `packages/skills/skill/**` is updated and `pnpm sync:skill` has been run (see "The agent skill" below).
- [ ] If I edited a `<!-- polycss:shared:* -->` block, I edited it in the ROOT `README.md` and ran `pnpm sync:readmes` (see "Package READMEs" below).
- [ ] If I changed a render strategy, lighting mode, naming convention, or the JS-in-render-loop rules, `AGENTS.md` reflects the new state in this same PR.

## Iterating on the system

The rendering model, tag table, lighting modes, and naming conventions described in this document are the *current* design — not frozen. Render strategies can be added or removed, lighting modes can change shape, the public API will keep evolving. The rules for evolving them:

- **AGENTS.md is the canonical reference.** Edit it directly; `CLAUDE.md` is just a symlink that exists so Claude Code finds the same content.
- **Architectural changes require user approval.** Dropping a render strategy, adding a lighting mode, renaming a public-facing convention, changing what JS is allowed in the render path — propose, don't decide. The user (human) is the architect.
- **Same-PR sync.** Any PR that adds, removes, or materially changes a render strategy, lighting mode, naming rule, or cross-package contract must update `AGENTS.md` in the same PR. An API change that lands without an AGENTS.md update is an incomplete change.
- **Don't append-only.** Prune content that no longer reflects the codebase. If a strategy is dropped, remove its row from the tag table — don't leave a "deprecated" note. If a hook is renamed, update the naming section in place — don't list the old name "for reference".

## Package READMEs

Each `packages/*/README.md` is a real, hand-written, committed file that is
published to npm **as-is**. What you read in the repo is what ships — there is
no generated README.

Regions wrapped in `<!-- polycss:shared:<name>:start -->` /
`<!-- polycss:shared:<name>:end -->` are the exception: they are owned by the
root `README.md` and mirrored into every package README that contains the
matching markers. Current blocks are `links`, `packages`, `showcase`, and
`license`.

- **Edit a shared block in the root `README.md`, never in a package README.**
  Then run `pnpm sync:readmes`.
- Everything outside the markers is package-specific. Write it in the root
  README's voice, but say what that package actually does — `core` documents
  core, `vue` shows Vue code.
- `.github/scripts/sync-package-readmes.mjs` runs as `prepack` in every
  publishable package, so a stale shared block cannot reach npm.
- CI runs `pnpm check:readmes`, which fails on drift instead of writing.
- A package opts in per block simply by containing the markers. `fonts` and
  `morph` carry none today and are left entirely alone.

## The agent skill

`packages/skills/skill/` is the **single source of truth** for what coding
agents are told about PolyCSS: `SKILL.md` is the entry point (conventions, the
silent-failure invariants, minimal scenes, and the docs index) and
`skill/docs/*.md` holds the per-topic reference. `@layoutit/polycss-skills`
publishes that tree with a zero-dependency `npx` installer.

- **Edit `packages/skills/skill/`, never the website copy.** Then run
  `pnpm sync:skill`. CI runs `pnpm check:skill`, which fails on drift.
- `.github/scripts/sync-skill-docs.mjs` mirrors the tree to
  `website/public/skill/` verbatim and to `website/public/skill.md` with doc
  links rewritten site-absolute (that file is served one level above the tree).
  It also deletes website copies of docs the skill has dropped.
- Adding or removing a doc means updating the index table in `SKILL.md`; the
  package's tests fail on an unindexed doc, a link to a file that does not
  ship, and a broken cross-doc relative link.
- The skill documents the *current* behaviour, including the renderer
  divergences recorded in this file (vanilla's missing ground-shadow fallback,
  the baked-light rebake asymmetry, `seamBleed`). When one of those is
  reconciled, the skill changes in the same PR.
- The package is plain ESM with no build step. Its `bin` runs under `npx` in
  someone else's project, so it must stay dependency-free.

### Measuring the skill

`eval/skill/` answers whether an agent holding only the skill actually writes
correct PolyCSS. It hands a real coding-agent CLI a throwaway workspace
containing the installed skill and one task, then grades **what the scene
paints in Chromium** — never the agent's prose.

- `pnpm eval:skill --agent oracle --track all` — reference solutions, must be
  100%. Anything less is a harness bug, not an agent result.
- `pnpm eval:selftest` — mutates each reference solution with one mistake the
  skill warns about and asserts the matching check catches it. A grader that
  cannot fail measures nothing.
- `pnpm eval:skill --agent claude,codex,grok --track all` — the real matrix.
  Costs real agent invocations; `--reuse` re-grades existing workspaces free.

Two design rules that are load-bearing:

- **Workspaces live outside the repository** (`$TMPDIR`). Inside it, an agent
  walks up out of its workspace and reads this monorepo — measured, on a
  no-skill track.
- **Three tracks, and only one is a control.** `polycss` is the intervention;
  `polycss-noskill` is the CONTROL (same library, task, contract and prompt,
  skill withheld), so `polycss` minus `polycss-noskill` is the skill's effect;
  `three` is an EXTERNAL BASELINE, not a control — it swaps the library, API and
  authoring contract at the same time as it removes the skill, so that delta
  conflates the skill with library familiarity. It earns its place by answering
  "is this task hard for this model at all?" and by calibrating the graders, and
  it has repeatedly proved a grader wrong rather than an agent.
- **Both PolyCSS tracks get byte-identical prompts.** Whether the agent
  discovers the project-local skill IS the intervention; telling it one exists
  is not. An earlier version cued the intervention only, and measured the files
  plus the cue.
- **Track is the outer loop and skill-less tracks run first**, so no control
  executes while an installed skill exists on disk. Track order is therefore
  fixed, which confounds wall-clock comparisons — treat timing as a fixed-order
  observation, never as an effect of the skill.
- Tracks are graded independently and never diffed against each other; no
  track's output is a reference image for another.

Grade on painted pixels, not DOM boxes: every leaf except `<b>` is
`backface-visibility: hidden`, so a reversed face keeps its bounding rect while
painting nothing. Prefer tolerance bands over exact values — models frame
scenes differently and that is not a defect.

## Backward compatibility

- **No BC shims.** Clean breaks only. No re-export aliases for renamed symbols. No `@deprecated` wrappers. If the API changes, callers update.
- This applies even to the multi-package monorepo — all four packages move together.

## Commits & PRs

- Conventional commits format. Single-line subject. No body unless genuinely useful.
- **NO `Co-Authored-By: Claude` trailer.**
- **NO "🤖 Generated with Claude Code" footer in PR bodies, commit messages, issue comments, or anywhere else.**
- Never amend commits. New follow-up commits only. (Pre-commit hook failures: fix and create a new commit, don't `--amend`.)
- Branch names should not use a `codex/` prefix. Use plain descriptive branch names unless the user explicitly asks for a different naming convention.
- Never push without explicit user approval in the current conversation, even for an existing PR branch or a small follow-up fix. Commit locally and stop for review unless the user clearly asks to push.
- Don't auto-push subagent exploration branches — local commits only. The user pushes when ready.
- `main` is protected. All work lands via PR.

## Tests & build

- Refactors must keep all tests passing. Don't delete or weaken assertions to make a refactor go through.
- If a renamed export still has tests for the old name, rename the test imports — don't keep the old export as an alias just to satisfy them.
- `pnpm test` runs the full suite across all four packages.
- **`pnpm build` is mandatory before opening a PR.** Vitest doesn't catch DTS / declaration build failures (tsup runs strict type-checking that vitest's transient TS pass doesn't enforce). A green test run with a red build is a real failure mode. Run `pnpm test && pnpm build` as a unit; treat either failing as "not ready."
- **CI enforces both gates.** `.github/workflows/ci.yml` runs `pnpm test` + `pnpm build:packages` + `pnpm build:website` on every PR against `main` and on every push to `main`. Don't merge with red CI.

## Style / process

- Keep the root and package READMEs concise: installation, minimal usage, and links to the website docs. Do not duplicate package inventories, renderer internals, Morph runtime details, Gallery/domformat certification procedures, or other guide/reference material already covered by the docs.
- No time estimates in planning docs ("2 days", "1 hour" etc.). This is agentic engineering, not human team scheduling.
- Prune superseded content from long planning docs as you go — don't just append.
- No half-finished features, no speculative abstractions, no defensive code for cases that can't happen.
- No comments explaining *what* code does — the code already says that. Comments are for *why*: a non-obvious constraint, a workaround for a specific browser bug, an invariant that isn't visible locally.
