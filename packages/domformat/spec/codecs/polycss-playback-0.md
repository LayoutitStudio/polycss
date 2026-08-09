# polycss-playback-packed@0 / polycss-playback@0

Status: experimental executable codec/interpreter pair for `domformat@0` and
`polycss-3d@0`.

## Purpose

This codec publishes a prepared model transform, shape transforms/visibility,
leaf transforms, and presentation appearance to an already-created retained
tree. Surface visibility and texture-lighting state are deliberately a separate
`polycss-surface@0` contract. Playback with one or more leaf targets requires
that surface contract; leafless playback does not.

The version-0 packet has no implicit lighting-row column or duplicate playback
leaf visibility. Source frame is the explicit surface input, and leaf visibility
is owned only by the surface/interaction visibility composition.

## Binding

The binding is executable, consumes exactly `time.tick`, and declares targets:

```text
model   one stable scene node
shapes  shapeCount stable nodes in source order
leaves  leafCount stable nodes in source order
```

Its sinks are exactly `style.transform` and `style.visibility`. Parameters are
`frameCount`, fixed `tickRateHz: 30`, and the safe CSS
`baseSceneTransform`. `time.tick` has type `uint`.

## State data

The state data has `packet` and `leafFit`. `leafFit` contains exactly one
`{canonicalSize}` positive-integer record per leaf.

The packet fields are:

```text
version       0
layout        delta-component-streams@0
shapeCount    target cardinality
leafCount     target cardinality, at most 65,536
appearances   [id, scale, translateY][]
timeline      {introTicks, loopTicks, frames}
initial       initial source/model/shape/leaf state
frameRows     one directly indexed row per source frame
shapeChanges  delta-coded shape/transform columns plus visibility
leafChanges   delta-coded leaf/transform columns
transforms    grouped 12-component affine transform streams
```

An appearance id is unique. Scale is positive and translation is finite.

## Delta tables

An initial transform column contains deltas. Starting at zero, add each delta
to obtain one transform-table index per target. Initial shape visibility is a
parallel zero/one column. Initial leaf state has transforms only.

Every frame row is the seven-integer tuple:

```text
[sourceFrame, appearance, modelTransform,
 shapeOffset, shapeCount, leafOffset, leafCount]
```

`sourceFrame` is its 1-based array index. `modelTransform` is `-1` for no
change, otherwise a transform-table index. Shape and leaf ranges partition
their complete change tables contiguously; no row may be skipped or referenced
twice.

Within each frame's shape range, reset `shape = 0` and add each `sources` delta.
Within each frame's leaf range, reset `leaf = 0` and add each `sources` delta.
The transform accumulator is separate for shapes and leaves, begins at zero,
and continues across all frames. Shape `visibility` is a parallel zero/one
column. Every expanded target and transform index is bounds-checked.

## Transform streams

`transforms.count` is the exact transform-table length. Every transform index
is owned by at least one model, shape, or leaf reference. Ownership is inferred
from initial state and then frame rows in order. A transform may be shared by
shapes; a fitted leaf transform cannot alias another ownership kind.

Scan transform indices from zero upward and group equal inferred owners in
first-owner order. `transforms.groups` has exactly one entry per resulting
owner. Each group contains:

```text
encoding  decimal-component-streams | source-milli-fitted-leaf
empty     strictly sorted group-row indices whose transform is the empty string
scales    12 nonnegative integer scales
columns   12 parallel columns, each with groupRows - empty.length values
```

For a zero scale, a column value is the component directly. For a positive
scale, cumulatively add integer deltas and divide each result by the scale.

For `decimal-component-streams`, the 12 decoded values become:

```text
matrix3d(v0,v1,v2,0,v3,v4,v5,0,v6,v7,v8,0,v9,v10,v11,1)
```

using the canonical decimal string of each decoded number.

`source-milli-fitted-leaf` is allowed only for a leaf owner and all scales are
exactly 1000. After delta expansion, each component is recovered as an integer
source milli-unit by `round(value * 1000)`. Divide the first nine components by
1000. Multiply components 0..2 by `canonicalSize / leafWidth` and components
3..5 by `canonicalSize / leafHeight`. Round those first six fitted components
with `cssNumber`; format components 6..11 as signed source milli-units without
redundant trailing zeros. Insert the same affine zero/one positions shown above.

For nonempty leaf targets, `leafWidth` and `leafHeight` come from the
same-index surface face, making the playback/surface cardinality and ordering a
required cross-contract invariant. A playback packet with `leafCount: 0` has
an empty `leafFit` array and MAY omit `polycss-surface@0` entirely.

## Timeline

`frames.length` is exactly `introTicks + loopTicks`, `loopTicks` is positive,
and every entry is in `1..frameCount`. `frames[0]` equals the initial source
frame. For nonnegative tick:

```text
index = tick < frames.length
  ? tick
  : introTicks + ((tick - introTicks) mod loopTicks)
sourceFrame = frames[index]
```

The controller begins at tick 0. `advance()` increments tick, resolves the
target source frame, and performs a sequential update or seek. The reference
mount scheduler accounts for one logical tick every `1000 / tickRateHz`
milliseconds and carries its deadline forward by that fixed interval, so a
dropped browser animation frame does not permanently slow playback. A callback
with one due tick publishes synchronously. Up to eight overdue ticks are normal
catch-up: animation evaluates every tick and every distinct prepared-effects
source frame in order but MAY publish only the final retained state, while
interaction steps and publishes each tick separately. More than eight overdue
ticks is a suspension: the scheduler discards the stale backlog, advances one
tick, and resets its next deadline from the current callback timestamp.

## Publication

Initial shape/leaf transform tables and shape visibility are expanded into
fixed logical arrays. Each logical leaf transform is distinct from the last
transform physically published to its retained DOM target. Initial DOM styles
come from `TREE`; mount publication synchronously writes every logical leaf
transform, the initial appearance, surface state, and downstream effects.

For a sequential frame row, in order:

1. If appearance changed, publish the selected appearance to
   `static-presentation@0`. That interpreter alone writes the declared camera
   fit sinks.
2. If model transform is not `-1`, write the model transform. The empty
   transform means exactly `baseSceneTransform`; otherwise write
   `baseSceneTransform + " " + preparedTransform`. If the retained model's
   inline transform already equals that exact string, preserve it without a
   redundant assignment.
3. Apply shape changes in row order, writing transform and visible/hidden.
4. Apply leaf changes in row order. If the leaf is currently paint-visible,
   write its transform. Otherwise update only its logical transform and mark
   its physical transform dirty.
5. When `polycss-surface@0` is present, publish the same 1-based source frame
   to it. Before any surface or interaction transition makes a leaf
   paint-visible, write that leaf's latest dirty transform and then write
   `visibility: visible`.

A leaf is paint-visible when surface visibility or forced interaction
visibility is active and interaction has not marked the leaf degenerate.
Deferred state is bounded by one dirty bit per leaf; the logical transform
array always contains the latest prepared state. A reveal publishes only that
latest transform, never the superseded hidden intermediates. Stable target
identity and row ordering are unchanged.

Appearance camera fit, viewport fallback, CSS number formatting, and identity
transform clearing are defined once by `static-presentation@0`. Playback owns
only the selected appearance index and never writes presentation sinks.

An automatic timeline jump advances frame rows forward with `frameCount -> 1`
wrapping until the target, without intermediate DOM writes; it then publishes
the final model, appearance, changed shapes/leaves in ascending target order,
and surface frame. Hidden leaf transforms remain eligible for deferral.

Public `seek(frame)` is a synchronous publication barrier, including when
`frame` already equals the current source frame. It performs the same bounded
forward simulation when needed, publishes changed targets in ascending target
order, and then writes every dirty leaf transform in ascending leaf order
before returning. Its postcondition is that every retained leaf's physical
transform equals its current logical prepared transform. A repeated same-frame
seek performs no transform write once that postcondition already holds.

Interaction may temporarily replace declared shape/leaf transforms and force
leaf visibility. Entering interaction uses the public seek barrier. Forced
visibility flushes a dirty prepared transform before revealing its leaf.
Restart seeks to the initial source frame, restores only the declared modified
target indices from the playback arrays, clears their dirty transform state,
clears interaction visibility state through the surface controller, and resets
tick to zero.

## Validation boundary

The validator rejects unknown fields, bad versions/layouts, noncanonical input
or sink sets, target/count mismatch, invalid appearances/timeline, nonpartitioned
frame ranges, malformed delta references, transform aliases across incompatible
owners, unowned transforms, group/column/scale mismatch, unsafe CSS values, and
all configured allocation excess before transform materialization.
