# polycss-orbit-input-prepared@0 / polycss-orbit-input@0

Status: experimental executable codec/interpreter pair for `domformat@0` and
`polycss-3d@0`.

## Purpose

This codec exposes one fixed host-driven orbit operation for a retained model.
Pitch, yaw, and zoom update one model transform; quantized yaw also selects a
prepared cyclic atlas-address row. Gesture mapping, pointer buttons, wheel
policy, inertia, and camera-control UI remain embedding-application concerns.
The interpreter evaluates no package expression and has no Morph dependency.

## Binding

The executable binding consumes exactly `orbit.pitch`, `orbit.yaw`, and
`orbit.zoom`, in that order. Each is a float input whose package default equals
the packet's initial value. The binding has no parameters, targets one retained
`model` plus a nonempty unique ordered `leaves` array, and declares exactly
`style.backgroundPosition` and `style.transform`.

Version 0 requires static presentation and is mutually exclusive with prepared
playback. This prevents independent time and external-input interpreters from
racing the same model/address sinks. Pointer/wheel handlers are never installed
by this codec.

## Model input

The packet has version 0 and exact `initial`, `ranges`, `model`, and `surface`
members. Pitch is bounded within -90 through 90 degrees, yaw within -360
through 360 degrees, and zoom is positive and no greater than 16. Initial
values lie inside their ranges. Host values must be finite and are clamped to
the declared ranges.

`model.translation` and `model.scale` are finite three-component rows. Scale
components are positive and bounded. Publication uses this fixed transform:

```text
translate3d(tx, ty, tz) rotateX(pitch) rotateY(yaw)
scale3d(sx * zoom, sy * zoom, sz * zoom)
```

The packet's initial transform exactly matches the retained TREE model style.

## Prepared yaw surface

`surface.stateCount` is 2 through 360. State zero is selected by initial yaw.
`positionDictionary` is a nonempty, strictly sorted dictionary of unique
signed-integer-pixel `[x,y]` rows. `initialPositionIndicesBase64` contains one
little-endian uint16 dictionary index per leaf and exactly matches TREE
`backgroundPosition`.

Transitions use one little-endian uint32 CSR offsets column of
`stateCount + 1` entries and parallel uint16 leaf, forward-position, and
backward-position columns. Segment `n` describes the edge between state `n-1`
and state `n`, modulo the state count. Forward values are the state-`n` row;
backward values are the state-`n-1` row. Leaf indices in each segment are
strictly increasing and every entry changes its leaf.

Validation reconstructs the complete bounded cycle once. Forward edges must
close exactly to state zero and every backward edge must reconstruct its prior
canonical row. Every position dictionary row is referenced.

## Runtime operation

The public mounted runtime accepts only:

```text
setInput("orbit.pitch" | "orbit.yaw" | "orbit.zoom", finiteNumber)
```

Unknown ids and nonfinite values fail. Yaw is normalized for state selection
and quantized with nearest-step rounding. Publication takes the shorter cyclic
forward/backward route, choosing forward on a tie. It coalesces all traversed
edges into one final position per touched leaf and writes touched leaves once
in ascending target order. Repeating the same clamped input performs no work.
Model and leaf identities remain stable.

## Rejection

Unknown fields, missing presentation, concurrent playback, bad input defaults,
unsafe ranges, TREE mismatch, malformed/truncated columns, unsorted or
out-of-range indices, no-op rows, nonclosing cycles, contradictory backward
edges, unreferenced positions, and excessive states/changes are fatal before
DOM construction.
