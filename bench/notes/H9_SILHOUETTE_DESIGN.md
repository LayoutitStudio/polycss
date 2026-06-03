# H9 — caster silhouette extraction design

## Goal

Replace the per-caster-polygon SH-clip loop with a per-caster-MESH
silhouette projection. For a closed solid mesh, the projected silhouette
is the boundary between front-facing and back-facing polygons relative to
the light direction. Drawing one closed polygon per caster mesh per
receiver face instead of N triangles drops DOM mutation by ~100× for the
teapot-floor case (2182 sub-paths → ~1 closed polygon).

## Inputs (already cached per frame)

- `caster.items: CasterPolyItem[]` — each has `wv: Vec3[]` (world verts)
  + `planeN: Vec3 | null`
- `sharedEdgeMap` per caster (already built for self-shadow seam cull,
  `buildSharedEdgeMap` in core)
- Light direction `L` in CSS frame (already normalised)

## Algorithm

For each caster mesh per frame:

### Step 1 — classify polygons by light-facing

```
const facing: boolean[] = caster.items.map((item) => {
  const n = item.planeN;
  if (!n) return true; // degenerate; treat as facing so it's not lost
  return (n[0]*Lx + n[1]*Ly + n[2]*Lz) < -EPS;
});
```

(The recently-landed light-backface cull already drops back-facing polys
from the SH-clip path. For silhouette extraction we KEEP them in the
classification — they bound the silhouette.)

### Step 2 — find silhouette edges

Walk every polygon's edges. An edge is "silhouette" iff its two adjacent
polygons disagree on `facing`. For polygons with no neighbour (open mesh
boundary), the edge is always silhouette.

Use the existing edge-adjacency from `buildSharedEdgeMap` extended to
return edge → (polyA, polyB) instead of poly → set-of-adj-polys. This
needs a small change in core (new variant or extra return value).

Concretely:
```
const edgeOwners: Map<edgeKey, {polyA: number, polyB: number | null,
                                vertA: Vec3, vertB: Vec3}> = ...

const silhouetteEdges: Array<[Vec3, Vec3]> = [];
for (const [key, owners] of edgeOwners) {
  const a = facing[owners.polyA];
  const b = owners.polyB === null ? !a : facing[owners.polyB];
  if (a !== b) silhouetteEdges.push([owners.vertA, owners.vertB]);
}
```

### Step 3 — walk edges into closed loops

The silhouette edges form one or more closed loops in 3D (for a
manifold mesh). Build a vertex→edges multi-map, then traverse:
- Start at any unvisited edge.
- Walk to the next edge sharing the current vertex, prefer the edge that
  KEEPS the front-side polygon on the SAME side (orientation continuity).
- Mark each edge visited; close the loop when we return to the start.
- Repeat for remaining unvisited edges.

For closed convex meshes: 1 loop. For concave/genus>0: multiple loops.
Inner loops become SVG holes via fill-rule:evenodd.

### Step 4 — project loops into (u,v) per receiver face

For each receiver face, project each silhouette loop vertex using the
existing `projectOntoPlane` (line ~442 of `computeReceiverShadows.ts`).
SH-clip the resulting closed polygon against the receiver outline + each
member polygon (same as today's per-poly code, but on the silhouette
polygon instead of per-triangle).

### Step 5 — emit path

Each receiver face emits ONE sub-path per caster mesh per silhouette
loop. For most scenes this is 1 sub-path per caster mesh per face.

## Compatibility

- **Light-facing classification matches the recent light-backface cull**
  exactly. The cull skips back-facing-to-light polygons from the SH-clip
  loop; the silhouette extraction uses the same `facing` predicate to
  bound them. They compose: we'd remove the per-polygon loop entirely
  and replace with per-mesh silhouette loop.
- **Self-shadow seam cull** still applies — silhouette edges between
  self-shadowing adjacent polygons need the same treatment. Since the
  silhouette loop IS the boundary set, self-shadow seam culling
  essentially becomes "don't add silhouette edges where both adjacent
  polys belong to a receiver face's member set."
- **Coplanar caster cull** stays per-poly (it's a pre-step that decides
  if a polygon contributes at all).

## Risk / failure modes

1. **Open meshes (cottage windows, half-apple cutaways).** Edges with
   only one adjacent triangle ALWAYS show as silhouette. For a cottage,
   the window outline becomes a silhouette loop. That's actually
   geometrically correct — the window frame casts shadow. But it might
   produce more loops than the user expects.

2. **Non-manifold meshes (badly authored GLBs).** Edges shared by 3+
   triangles. Need to define behaviour — probably treat as "ambiguous
   silhouette" and emit anyway. Tested via the `flight-system-support`
   GLB which is known messy.

3. **Concave silhouettes from convex-hull-ish meshes.** Some meshes
   (apple, teapot) are convex but their silhouette can have small
   concavities at the spout/leaf. Loop walking has to handle figure-8
   loops correctly (don't fuse, leave as separate loops).

4. **Performance regression for very simple meshes.** For a crate
   (12 triangles), the silhouette extraction overhead (build edge map,
   walk loops) might exceed the per-poly SH-clip cost. Add a heuristic:
   skip silhouette extraction when polygon count < threshold (e.g. 40).
   Use the per-poly path for those.

5. **Receiver-face shadow opacity calculation.** Today, per-poly path
   produces N overlapping sub-shadows; the opacity is one constant per
   receiver face (computed once). Silhouette loop produces 1 shadow with
   the same constant opacity. No change.

## Implementation plan (when dispatched)

1. Extend `buildSharedEdgeMap` (or add `buildEdgeOwners`) in core to
   return edge → (polyA, polyB | null, vertA, vertB).
2. Add `extractSilhouetteLoops(items, edgeOwners, L)` in core. Returns
   `Array<Vec3[]>` (each loop is a closed vertex sequence in world coords).
3. In `computeReceiverShadowFaces`, gate per-caster: if `items.length >=
   SILHOUETTE_MIN_POLYS` AND silhouette extraction succeeded (manifold,
   ≥1 loop), use silhouette path. Otherwise fall through to the
   existing per-poly path.
4. The silhouette path is: project each loop to (u,v), SH-clip against
   outline + member polys (using existing `clipPolygonToConvex2D`), push
   into `bucket.verts` as a single sub-path per receiver.
5. Add a unit test in core with a known mesh (e.g. axis-aligned cube)
   asserting the silhouette is 4 vertices for a side-on light.

## Why not "compute polygon UNION via Boolean lib"

- Adds a heavy dependency (martinez or polygon-clipping is ~30 KB).
- Doesn't exploit the 3D structure of the mesh — works in 2D after
  projection.
- O(N log N) for N input polygons; silhouette extraction is O(E) in mesh
  edges, which is roughly O(N).
- The 3D silhouette approach is what GPU shadow-volume / stencil-shadow
  algorithms have done for 20 years.

## Test scenes

Use the existing regression fixture (teapot-self, teapot-floor,
castle-floor, crate-floor). Add: apple (closed convex GLB), cottage
(open-mesh edge cases), flight-system-support (heavy + messy).

Expected wins on path-d chars:
- teapot-floor 87,869 → ~150 (~580×)
- castle-floor 23,000 → ~500 (~46×)
- crate-floor 215 → ~80 (~2.5×; minimal due to already-simple silhouette)
- teapot-self complex; per-receiver-face still applies. Probably 5-10×
  per receiver SVG.
