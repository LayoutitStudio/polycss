# Shapes and Primitives

Three layers, same geometry:

| Layer | Form | Returns |
|---|---|---|
| Core generators | `boxPolygons(opts)` | `Polygon[]` |
| Vanilla factories | `createPolyBox(opts)` | `ParseResult` for `scene.add(...)` |
| Components | `<PolyBox …>` / `<poly-box …>` | Mounted mesh |

Core generators are exported from every package (`@layoutit/polycss`, `-react`,
`-vue`, `-core`) with two exceptions: **`spherePolygons` and `ringQuadPolygons`
are not re-exported by React or Vue** — import those from
`@layoutit/polycss-core`, which both framework packages already depend on. Use
generators when you want raw arrays to post-process.

## Options and defaults

Defaults below are the generator defaults. The default `color` is **not
uniform**: `boxPolygons`, `planePolygons`, `ringPolygons`, and
`octahedronPolygons` default to `#ffffff`; every other generator defaults to
`#cccccc`. Pass `color` explicitly rather than relying on either.

### `boxPolygons` / `createPolyBox` / `PolyBox`

```ts
{
  size?: number | Vec3;        // default 1×1×1
  center?: Vec3;               // default origin
  min?: Vec3; max?: Vec3;      // explicit bounds — win over size/center
  // BoxFaceOptions, applied to every face: color | texture | material | uvs | data
  color?: string;
  texture?: string;
  material?: PolyMaterial;
  uvs?: [number, number][];
  data?: Record<string, string | number | boolean>;
  // Per-face override. BoxFace = "right" | "left" | "front" | "back" | "top" | "bottom".
  faces?: Partial<Record<BoxFace, BoxFaceOptions | false>>;  // false omits the face
}
```

```ts
const polygons = boxPolygons({
  min: [0, 0, 0],
  max: [2, 1, 0.5],
  color: "#d8d2c7",
  data: { tileId: "tile-1" },
  faces: { top: { texture: "/tile.png", data: { face: "top" } }, bottom: false },
});
```

### `planePolygons` / `createPolyPlane` / `PolyPlane`

`axis` is **required**.

```ts
{
  axis: 0 | 1 | 2;             // perpendicular axis: 0=YZ, 1=XZ, 2=XY plane
  size?: number;               // HALF-extent along each in-plane axis, default 0.4
  offset?: number | [number, number];  // in-plane center, default `size * 2`
  along?: number;              // position along the perpendicular axis, default 0
  color?: string;
}
```

Two traps: `size` is a **half-extent**, and `offset` defaults to `size * 2`, so
a plane you expected at the origin lands in the `+A/+B` corner. For a centered
ground plane pass `offset: 0` explicitly:

```ts
createPolyPlane({ axis: 2, size: 60, offset: 0, color: "#7d848e" });
```

### `spherePolygons` / `createPolySphere` / `PolySphere`

```ts
{ radius?: number;        // default 50
  subdivisions?: number;  // default 1 (80 triangles); clamped to 0..3
  color?: string; }
```

Subdivision 0 = 20 triangles, each level quadruples: 1 → 80, 2 → 320, 3 → 1280.
The cap at 3 is deliberate — DOM cost.

### `cylinderPolygons` / `conePolygons`

```ts
// cylinder
{ radius?: number;         // bottom cap, default 50
  radiusTop?: number;      // defaults to `radius`; 0 makes a cone
  height?: number;         // along Z, default 100
  radialSegments?: number; // default 12
  color?: string; }

// cone === cylinder with radiusTop: 0
{ radius?: number; height?: number; radialSegments?: number; color?: string; }
```

### `torusPolygons`

```ts
{ radius?: number;           // center-to-tube-center, default 50
  tube?: number;             // tube radius, default 15
  radialSegments?: number;   // around the ring, default 12
  tubularSegments?: number;  // around the cross-section, default 16
  color?: string; }
```

### `ringPolygons`

`axis` and `radius` are **required**.

```ts
{ axis: 0 | 1 | 2;         // perpendicular axis
  radius: number;          // mid-radius of the annulus band
  halfThickness?: number;  // band spans radius ± halfThickness
  segments?: number;
  color?: string; }
```

### Platonic solids

`tetrahedronPolygons`, `icosahedronPolygons`, `dodecahedronPolygons`:

```ts
{ size?: number;   // circumradius, default 100
  color?: string; }
```

`octahedronPolygons` differs — `center` and `size` are both **required**:

```ts
{ center: Vec3; size: number; color?: string; }   // size = half-extent
```

### Other generators

`axesHelperPolygons`, `arrowPolygons`, and `ringQuadPolygons` (core and
`@layoutit/polycss` only — see the note at the top).

## Usage

```ts
// Vanilla
scene.add(createPolyBox({ size: 100, color: "#ffd166" }), { position: [0, 0, 50] });
scene.add(createPolySphere({ radius: 40, subdivisions: 2, color: "#7dd3fc" }));
scene.add(createPolyTorus({ radius: 60, tube: 18, color: "#4ecdc4" }));
```

```tsx
// React / Vue — geometry options plus the common mesh props
<PolyScene>
  <PolyBox size={80} color="#ffd166" />
  <PolySphere radius={40} subdivisions={2} color="#7dd3fc" position={[120, 0, 0]} />
  <PolyTorus radius={60} tube={18} color="#4ecdc4" position={[-120, 0, 0]} />
</PolyScene>
```

```html
<!-- Custom elements -->
<poly-scene>
  <poly-box size="100" color="#ffd166"></poly-box>
  <poly-icosahedron size="100" color="#ff6644"></poly-icosahedron>
</poly-scene>
```

Shape components accept their geometry options plus the common mesh props
(`position`, `scale`, `rotation`, `autoCenter`, `id`, and event props where
supported).

## The single-polygon primitive

`<poly-polygon>` (vanilla) and `<Poly>` (React/Vue) render one polygon as one
leaf. They forward standard DOM props (`onclick`, `class`, `style`, `aria-*`).
Neither normalizes its input — see [authoring-polygons.md](authoring-polygons.md).

```html
<poly-polygon vertices='[[0,0,0],[1,0,0],[0,1,0]]' color="#ff0000"></poly-polygon>
```

```tsx
<Poly vertices={[[0,0,0],[1,0,0],[0,1,0]]} color="#ff0000" />
<Poly vertices={tri} texture="/wood.png" uvs={[[0,0],[1,0],[0,1]]} />
```

## Shared materials

Use `material` when several polygons share one texture identity. React and Vue
export `usePolyMaterial` to keep that object stable across rerenders:

```tsx
const material = usePolyMaterial({ texture: "/stone.png", key: "stone" });
<Poly vertices={vertices} material={material} uvs={uvs} />;
```

`material.texture` wins over a polygon's own `texture`.

## Text

`@layoutit/polycss-fonts` turns text into extruded 3D `Polygon[]`:
`textPolygons(font, text, { depth, profile })` for basic extrusion,
`composeText(...)` for the multi-line/warp composer, plus `loadGoogleFont` and
`listGoogleFonts`. Framework-agnostic — feed the result to `scene.add(...)` or
`<PolyScene polygons>`.
