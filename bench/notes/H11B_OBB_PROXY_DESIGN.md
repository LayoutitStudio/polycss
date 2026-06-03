# H11b — silhouette projection onto OBB / averaged-plane proxy receiver

## The leftover problem after H9b + H11 negative

Post-H9b state: teapot-self drag emits 242 receiver SVGs at az50, 143 at
az130, 104 at az220. Each SVG is a small silhouette path. compositorMain
is ~358 ms/frame, ~proportional to receiver-SVG count.

H11 tried to reduce SVG count by relaxing `RECEIVER_NORMAL_TOL` so
adjacent near-coplanar receiver faces merge. NEGATIVE: the actual gate
is `RECEIVER_OFFSET_TOL = 0.5`, which on a curved mesh is overshot by
tens of px between any two adjacent triangles. Loosening OFFSET_TOL
breaks unrelated-plane-merging (floor and ceiling collapse).

## H11b: instead of merging receiver FACES, replace them with a proxy

For the caster=receiver (self-shadow) case specifically:

1. **Don't decompose the receiver mesh into per-face planes.** That's
   what produces 242 SVGs on the teapot.

2. **Instead, choose ONE-TO-FEW receiver-PROXY planes per mesh, region.**
   Options:
   - **OBB (oriented bounding box):** 6 axis-aligned faces of the
     mesh's oriented bounding box. The silhouette projects onto each
     OBB face that the light could cast onto. Typically 3 OBB faces are
     visible to the camera + receive light at a given pose.
   - **Mean-plane per camera-facing cluster:** k-means cluster the
     mesh polygons by face normal (k=4 or 6), one plane per cluster.

3. **Per proxy plane, project the H9b silhouette loop, clip to mesh
   member-poly union of polys mapped to that proxy.** So the shadow
   still appears only where the real mesh sits — no shadows in
   thin air.

## Expected effect

| count | now (per-face) | H11b OBB | H11b mean-plane k=4 |
| --- | ---: | ---: | ---: |
| receiver SVGs for teapot-self | 138-242 | 3-6 | 2-4 |

If receiver-SVG count drops 40-80×, compositorMain should drop the same
proportion (it's roughly per-SVG-layer). teapot-self frame_p50 ~342 ms
would drop to perhaps ~50-80 ms — competitive with the floor-only case.

## Risk: visual

The silhouette projects onto an AVERAGED plane. For mesh regions whose
real normals differ from the proxy normal, the projected shadow
position differs from the "true" per-face shadow. Pixel-space error:
~`depth_offset × tan(angle_to_proxy)`. For a teapot at typical zoom
and ~10° proxy-to-real normal cone, error is ~3-5 px.

Mitigation: clip each proxy projection to the convex hull of the
polygons that map to that proxy. The shadow only appears on real mesh
regions — visible drift happens only inside those regions.

## Risk: light visibility / occlusion semantics

Currently per-face receiver decomposition gives each face an
INDIVIDUAL Lambert + ambient calculation. With proxy planes, the
proxy gets ONE Lambert factor based on the proxy normal, applied to
all member polys. Lighting accuracy could shift on mesh regions whose
real normals differ from the proxy.

For dynamic mode: leaf colors come from the per-leaf `--pnx/y/z` CSS
vars (per-polygon normals), NOT the receiver-plane Lambert. So
dynamic-mode lighting is unaffected. Only the SHADOW tint on each
receiver leaf might shift if it's computed from receiver-face Lambert.

Need to check: does the receiver-plane Lambert affect the per-leaf
SHADOW color in `computeReceiverShadowFaces` (line ~600+)? Looking at
the source:
```
const groupColor = receiverPolygons[groupPolyIdx]?.color ?? "#cccccc";
const fillColor = receiverHasTexture
  ? userShadowColor
  : shadePolygon(groupColor, 0, "#000000", ambColor, ambIntensity);
```
The shadow fill is `shadePolygon(baseColor, 0, ...)` — directScale is
0, so it's ambient-only. Independent of receiver normal. Good.

But the OPACITY calc (~line 595-605):
```
if (receiverHasTexture) {
  const direct = dirIntensity * Math.max(0, Ldotn);
  ...
}
```
Uses `Ldotn` where n is receiver-face normal. For a proxy plane Ldotn
differs from the real per-face value. Shadows on textured receivers
would have slightly wrong opacity per region. For non-textured
receivers (the typical case for self-shadow on solid GLBs), shadow
opacity is constant — no impact.

## Implementation plan

1. Detect when `caster === receiver` AND `receiverEntry.polygons.length
   >= PROXY_MIN_POLYS` (e.g. 60). Otherwise per-face path stays.
2. Compute proxy planes per mesh ONCE (cached, invalidates on mesh
   transform change):
   - Cluster polygons by normal direction (k=4 or k=6, axis-aligned k=6
     for OBB).
   - For each cluster: compute centroid + averaged normal + the union
     of member polygons projected to the proxy plane (for clipping).
3. In `computeReceiverShadowFaces`, when self-shadow proxy path is
   active, skip the per-face loop and emit one ReceiverShadowFaceSpec
   per visible proxy plane.
4. Visual diff acceptance: shadows on teapot self-shadow should not
   visibly detach from the surface. If 3-5 px max drift is too much,
   bump to k=8 or k=12.

## Effort estimate

Bigger than H9/H9b. Touches:
- Core: new proxy-plane generation function
- Core: dispatch in computeReceiverShadowFaces
- Vanilla/React/Vue: cache plumbing for proxy planes
- Tests: silhouette-onto-proxy unit tests

Worth dispatching as a separate iteration. Not blocking other H.

## Alternative: simpler, less ambitious — opacity of the per-face SVG

Instead of replacing per-face with proxy, give the existing receiver
SVGs CSS contain:strict so the browser can compositor-cull off-screen
ones cheaply. Won't reduce JS work but might reduce compositor cost.
File as H12 if H11b is too complex.
