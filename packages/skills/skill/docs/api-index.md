# API Index

Use this to check whether a name exists before writing it. If a symbol is not
here and not in your editor's completions, do not invent it.

## Where things live

- `@layoutit/polycss` does `export * from "@layoutit/polycss-core"`, so every
  core name is available from it, plus the imperative API, custom elements, and
  the renderer's atlas internals.
- `@layoutit/polycss-react` and `@layoutit/polycss-vue` re-export a **curated
  list** of core — parsers, generators, math, and the common types — not all of
  it. A core name missing from their index (for example `PolyPointLight`, or the
  `resolvePolyTexture*` helpers, `spherePolygons`) is imported from
  `@layoutit/polycss-core` directly, which React and Vue already depend on.
  Do not take renderer or component APIs from `@layoutit/polycss` in a React or
  Vue app — the one exception is `exportPolySceneSnapshot`, which exists only
  there (see "Names that do NOT exist" below).
- The React and Vue public surfaces are **mirrored**. The only value exports
  that differ are the idiomatic context handles: React has `PolyCameraContext`
  and `useCameraContext`; Vue has `PolyCameraContextKey` and
  `PolySelectionContextKey`.

## Components (React / Vue)

`Poly`, `PolyScene`, `PolyMesh`, `PolyIframe`, `PolyGround`,
`PolyCamera`, `PolyPerspectiveCamera`, `PolyOrthographicCamera`,
`PolyOrbitControls`, `PolyMapControls`, `PolyFirstPersonControls`,
`PolyTransformControls`, `PolySelect`,
`PolyAxesHelper`, `PolyDirectionalLightHelper`,
and the shapes: `PolyBox`, `PolyPlane`, `PolyRing`, `PolySphere`,
`PolyCylinder`, `PolyCone`, `PolyTorus`, `PolyTetrahedron`, `PolyOctahedron`,
`PolyIcosahedron`, `PolyDodecahedron`.

## Hooks / composables (React / Vue)

`usePolyCamera`, `usePolyMesh`, `usePolyMaterial`, `usePolySceneContext`,
`usePolySelect`, `usePolySelectionApi`, `usePolyAnimation`.

## Vanilla-only (`@layoutit/polycss`)

Factories: `createPolyScene`, `createPolyCamera`, `createPolyPerspectiveCamera`,
`createPolyOrthographicCamera`, `createPolyOrbitControls`,
`createPolyMapControls`, `createPolyFirstPersonControls`,
`createTransformControls`, `createSelect`, and the shape factories
`createPolyBox`, `createPolyPlane`, `createPolyRing`, `createPolySphere`,
`createPolyCylinder`, `createPolyCone`, `createPolyTorus`,
`createPolyTetrahedron`, `createPolyOctahedron`, `createPolyIcosahedron`,
`createPolyDodecahedron`.

Note the two `create*` names without a `Poly` infix: `createSelect` and
`createTransformControls`.

Snapshot: `exportPolySceneSnapshot`, `PolySceneSnapshotError`.

Element classes: `PolySceneElement`, `PolyMeshElement`, `PolyPolygonElement`,
`PolyIframeElement`, `PolyCameraElement`, `PolyPerspectiveCameraElement`,
`PolyOrthographicCameraElement`, `PolyOrbitControlsElement`,
`PolyMapControlsElement`, `PolyFirstPersonControlsElement`,
`PolyTransformControlsElement`, `PolySelectElement`, and the shape element
classes. Importing `@layoutit/polycss` does **not** register them — import
`@layoutit/polycss/elements` for that side effect.

## Custom element tags

`<poly-scene>`, `<poly-mesh>`, `<poly-iframe>`, `<poly-polygon>`,
`<poly-camera>`, `<poly-perspective-camera>`, `<poly-orthographic-camera>`,
`<poly-orbit-controls>`, `<poly-map-controls>`, `<poly-first-person-controls>`,
`<poly-transform-controls>`, `<poly-select>`, `<poly-axes-helper>`,
`<poly-directional-light-helper>`, and the shapes `<poly-box>`, `<poly-plane>`,
`<poly-ring>`, `<poly-sphere>`, `<poly-cylinder>`, `<poly-cone>`,
`<poly-torus>`, `<poly-tetrahedron>`, `<poly-octahedron>`,
`<poly-icosahedron>`, `<poly-dodecahedron>`.

## Parsing and loading (all packages)

`loadMesh`, `parseObj`, `parseMtl`, `parseStl`, `parseGltf`, `parseVox`,
`normalizePolygons`.

## Geometry generators

From every package: `boxPolygons`, `planePolygons`, `ringPolygons`,
`cylinderPolygons`, `conePolygons`, `torusPolygons`, `tetrahedronPolygons`,
`octahedronPolygons`, `icosahedronPolygons`, `dodecahedronPolygons`,
`axesHelperPolygons`, `arrowPolygons`.

**`spherePolygons` and `ringQuadPolygons` are the exceptions:** they are
exported from `@layoutit/polycss-core` and `@layoutit/polycss` but **not** from
the React or Vue indexes, even though the `<PolySphere>` component exists. In a
React or Vue app import them from `@layoutit/polycss-core`.

## Optimizer and mesh ops (all packages)

`optimizeMeshPolygons`, `optimizeMeshParseResult`,
`optimizeAnimatedMeshPolygons`, `mergePolygons`, `cullInteriorPolygons`,
`simplifyTriangleMeshPolygons`, `coverPlanarPolygons`, `repairMeshSeams`,
`bakeSolidTextureSamples`, `bakeSolidTextureSampledPolygons`,
`seamOverlapDiagnostics`, `seamOverlapPolygons`, `seamFacetSplitPolygons`.

## Camera and coordinate math (all packages)

`buildPolyCameraSceneTransform`, `buildPolyMeshTransform`,
`buildPolySceneTransform`, `capturePolyCameraSnapshot`,
`polyCameraTargetToCss`, `resolvePolyCameraAppliedPerspectiveStyle`,
`worldPositionToCss` / `worldPositionToPolyCss`,
`cssPositionToWorld` / `polyCssPositionToWorld`,
`worldDistanceToCss` / `worldDistanceToPolyCss`,
`cssDistanceToWorld` / `polyCssDistanceToWorld`,
`worldDirectionToCss` / `worldDirectionToPolyCss`,
`worldDirectionalLightToCss` / `worldDirectionalLightToPolyCss`.

Constants: `BASE_TILE` (50) and `POLY_DEFAULT_SHADOW_LIFT` (0.05, the default
clearance between a receiver face and the shadow painted on it).

## Diagnostics and DOM helpers

`collectPolyRenderStats`, `collectPolyTextureReadiness`, and `queryPolyLeaves`
live in `@layoutit/polycss-core` — they read a DOM subtree structurally, with no
browser globals — and are re-exported by all three renderers. Only
`injectPolyBaseStyles` is renderer-only.

From `@layoutit/polycss-core`, `@layoutit/polycss`, `-react` and `-vue`:
`collectPolyRenderStats`, `collectPolyTextureReadiness`, `queryPolyLeaves`.
From the renderer packages only: `injectPolyBaseStyles`.

React and Vue only: `findPolyMeshHandle`, `pointInMeshElement`,
`findMeshUnderPoint`. Vanilla has no exported equivalent.

Texture resolution (from `@layoutit/polycss-core` or `@layoutit/polycss`, **not**
the React/Vue indexes): `resolvePolyTextureLeafGeometry`,
`resolvePolyTextureImageSource`, `resolvePolyTexturePresentation`,
`resolvePolyTextureImageRendering`.

## Animation

`createPolyAnimationMixer`, `usePolyAnimation` (React/Vue), and the loop
constants `LoopOnce`, `LoopRepeat`, `LoopPingPong`.

## Key types

Geometry: `Vec2`, `Vec3`, `Polygon`, `PolyMaterial`, `ParseResult`,
`MeshResolution`.

Lights: `PolyDirectionalLight`, `PolyAmbientLight` (all packages).
`PolyPointLight` is narrower: `@layoutit/polycss-core`, `@layoutit/polycss`, and
`@layoutit/polycss/three` only. It is **not** re-exported by
`@layoutit/polycss-core/three`, `@layoutit/polycss-react/three`, or
`@layoutit/polycss-vue/three`, and React and Vue accept the `pointLights` prop
without exporting the type — take it from `@layoutit/polycss-core`.

Texture: `PolyTextureLightingMode`, `PolyTextureLeafSizing`,
`PolyTextureBackend`, `PolyTextureImageRendering`, `PolyTextureImageLighting`,
`PolyTextureProjection`, `PolyTexturePresentation`, `PolyTextureImageSource`.

Camera: `PolyCameraProjection`, `PolyCameraSnapshot`, `PolyCameraSnapshotStats`.

Scene/mesh: `PolyMeshTransformInput`, `PolySceneTransformInput` (all packages);
`PolyShadowOptions` (the `shadow` option/prop type — renderer packages only);
`PolyMeshHandle` (renderer packages only — not in `core`); `PolySceneOptions`,
`PolySceneHandle`, `PolyMeshTransform` (vanilla — React/Vue use component prop
types such as `PolySceneProps` and `PolyMeshProps` instead).

Render: `PolyRenderStrategy`, `PolyRenderStrategiesOption` (all packages);
`PolyRenderStats` and `PolyLeafInfo` (all packages, including `core`);
`TextureQuality` (core and `@layoutit/polycss`).

Parse options: `LoadMeshOptions`, `ObjParseOptions`, `StlParseOptions`,
`GltfParseOptions`, `VoxParseOptions`, `UseMeshOptions`.

Animation: `PolyAnimationMixer`, `PolyAnimationAction`, `PolyAnimationClip`,
`PolyAnimationTarget`, `ParseAnimationController`, `ParseAnimationClip`,
`LoopMode`.

Controls (vanilla): `PolyOrbitControlsOptions`, `PolyMapControlsOptions`,
`PolySelectOptions`, `PolySelectionHandle`, `PolyTransformControlsOptions`
(+ matching `*Handle` types). React/Vue use `PolyOrbitControlsProps`,
`PolyMapControlsProps`, `PolySelectProps`, `PolyTransformControlsProps`.

`PolyFirstPersonControlsOptions` and `PolyFirstPersonControlsHandle` are
exported by **all three** renderers, not vanilla only.

## Three parity subpaths

`@layoutit/polycss-core/three`, `@layoutit/polycss/three`,
`@layoutit/polycss-react/three`, `@layoutit/polycss-vue/three`.

Names: `Vector3`, `Euler`, `Object3D`, `PerspectiveCamera`,
`OrthographicCamera`, `DirectionalLight`, `PointLight`, `AmbientLight`,
`transformPolygonsToPoly`, `mountPolyThreeScene` (vanilla),
`PolyThreePerspectiveCamera`, `PolyThreeOrthographicCamera`, `PolyThreeMesh`
(React/Vue).

## Other packages

`@layoutit/polycss-fonts`: `textPolygons`, `composeText`, `loadGoogleFont`,
`listGoogleFonts`.

`@layoutit/polycss-morph`: `loadPolyMorphPackage`, `mountPolyMorphModel`,
`createPolyMorphPreparedDomTarget`; Node-only preparation under
`@layoutit/polycss-morph/prepare`. Profiles: `static-prepared`,
`morph-regions`, `joint-skin`, `prepared-playback`.

## Names that do NOT exist

- No `polygons` option on `createPolyScene` — use `scene.add(...)`.
- No `polygons` attribute on `<poly-mesh>` — use `<poly-polygon>` or the
  imperative API.
- No `receiveShadow` prop on `<PolyGround>`.
- No `stableDom` prop in React/Vue — vanilla `scene.add` option only.
- No `merge` option on `<PolyScene polygons>` or `<poly-mesh>`.
- No render-time `doubleSided` flag on `Polygon`.
- `exportPolySceneSnapshot` is **not** exported from React or Vue — import it
  from `@layoutit/polycss` and pass the rendered element.
