# polycss-surface-packed@0 / polycss-surface@0

Status: experimental executable codec/interpreter pair for `domformat@0` and
`polycss-3d@0`.

## Purpose

This codec publishes prepared texture-atlas positions and composed leaf
visibility for each playback source frame. It does not discover materials,
sample lighting, pack atlases, scan topology, or create nodes at runtime.

## Binding and coupling

The binding is executable, consumes exactly the `uint` input
`time.source-frame`, targets a unique ordered `leaves` array, and declares
one of two exact sink pairs: `style.backgroundPositionY` plus
`style.visibility` for derived vertical strips, or `style.backgroundPosition`
plus `style.visibility` for prepared two-axis addresses. It has no parameters.
Its targets exactly equal the playback leaf targets in the same order.

The state is `{ "packet": ... }`. Packet `version` is 0 and `frameCount`
equals playback's binding frame count.

## Surface state packing

`packet.surface.faces` contains one target-indexed record:

```text
faceId       unique stable source face identity
sourceOrder  exact zero-based array index
stateOffset  contiguous offset into sourceFrameDeltas
stateCount   positive number of states
leafWidth    positive fitted leaf width
leafHeight   positive fitted leaf height
```

The state ranges partition `surface.statePacking.sourceFrameDeltas`, whose
length is exactly `stateCount`. For each face, begin with zero-based
source-frame offset `0` (the public source frame minus one); its first
delta is exactly zero and each later delta is positive. Cumulative frames stay
within `0..frameCount-1`. A face's local state index is the last state whose
cumulative source-frame offset is at most the requested public source frame
minus one.

When `surface.statePacking.positionDictionary` and
`positionIndicesBase64` are absent, the prepared CSS Y
position for a state is `0` when its cumulative source-frame offset is zero,
otherwise `-(sourceFrameOffset * leafHeight)px`. The binding uses
`style.backgroundPositionY`.

Prepared two-axis mode declares both fields. `positionDictionary` is a nonempty,
strictly lexicographically sorted array of unique `[x,y]` signed 32-bit integer
pixel coordinates with at most 65,535 rows. `positionIndicesBase64` is canonical
little-endian uint16 with exactly one in-range dictionary index per prepared
state, parallel to `sourceFrameDeltas`; every dictionary row is referenced.
The binding uses `style.backgroundPosition`. Materialization formats each
dictionary coordinate once: zero is `0`, every nonzero value is `<integer>px`,
and the two axes are separated by one ASCII space. It retains the packed state
indices instead of expanding repeated strings. This mode admits arbitrary
prepared atlas coordinates while making identifiers, functions, missing axes,
extra axes, and alternate zero spellings structurally impossible. Paired
prepared-variant classes may also select another atlas image.

## Sequential lighting transitions

`packet.transitions.initialFrame` is exactly frame 1 and equals playback's
initial source frame.
`transitions.sequential` contains parallel `faceIndexDeltas` and
`stateIndexDeltas`, plus canonical base64 little-endian uint32 offsets.
Offsets has `frameCount + 1` entries, begins at zero, is nondecreasing, and ends
at the parallel-column length.

For each segment in offset order, reset `face = 0`; cumulatively add face deltas
to obtain a strictly increasing target list. Maintain a zero-initialized local
state index per face and cumulatively add the corresponding state delta. Every
result stays within that face's `stateCount`. Segment `n` represents the
sequential publication whose target frame is `n + 1`; segment zero therefore
represents the wrap to frame 1.

Materialization converts these deltas to parallel little-endian uint16 face and
state index tables while retaining the uint32 offsets.

Every sequential segment is semantic, not trusted acceleration data. For each
transition `fromFrame -> toFrame` (including `frameCount -> 1`), its visibility
faces exactly equal the XOR of the two canonical visibility rows. Its lighting
faces exactly equal the target-visible faces that were hidden in the source row
or whose scheduled local state changed, and each state entry is the canonical
target local state. Extra, omitted, or contradictory rows are invalid.

## Visibility schedule

`packet.visibility.initialFrame` equals the lighting initial frame.
`initialVisibleBitsBase64` is a canonical byte bitset of exactly
`ceil(leafCount/8)` bytes. Bit `i & 7` of byte `i >> 3` is leaf `i`; unused high
bits are zero.

Sequential visibility contains canonical base64 little-endian uint32 offsets
and uint16 face indices. Offsets has `frameCount + 1` entries and partitions the
face array. Each segment is strictly increasing. Starting from the initial
bitset, XOR each listed face to obtain the target frame row. Materialization
retains one current visibility bitset plus the decoded sparse offsets/faces; it
does not expand a leaf-by-frame visibility matrix.
Validation uses one rolling current row. When declared jumps require arbitrary
canonical endpoints, it retains only the distinct endpoint rows and rejects
their endpoint-count times leaf-count product above the visibility-cell limit.
Documents without jumps therefore use O(`leafCount`) visibility-row working
memory regardless of `frameCount`.

## Noninteractive jumps

Lighting and visibility each declare the same unique `(fromFrame,toFrame)` jump
pairs. Frames are 1-based, in range, and different.

A lighting jump stores equal-length canonical base64 little-endian uint16 face
and local-state arrays, with strictly increasing faces and in-range states. A
visibility jump stores strictly increasing uint16 face indices to toggle.

Each declared jump MUST equal the same canonical comparison rule used for a
sequential transition. Matching lengths and in-range indices are insufficient:
a syntactically valid accelerator that contradicts its target frame is invalid.

Jumps are optional accelerators. When a requested nonsequential pair is absent,
the viewer walks at most one bounded sequential cycle, XORs only listed
visibility faces, and retains only the last prepared address for each listed
surface face. The fallback is semantically identical, so jump presence is
packaging/runtime cost, not an implicit adapter rule.

## Publication and visibility composition

For target source frame `nextFrame`, a transition is sequential when it is the
current frame plus one, with `frameCount -> 1` wrapping. Use the sequential
segment or matching jump; otherwise use the fallback above.

Visibility publication toggles the prepared surface-visible bit. Final CSS
visibility for leaf `i` is:

```text
(surfaceVisible[i] OR interactionForcedVisible[i])
AND NOT interactionDegenerate[i]
```

Write `visible` or `hidden` only when the value changes. For each lighting row,
write its selected prepared background-position sink when the face is paint
visible; otherwise retain a dirty prepared-address marker. Before any later
surface or interaction-forced reveal, flush the current prepared transform and
address, in that order, before writing `visibility:visible`. A forced-visible
face remains address-current while its surface state advances, including when a
surface-hidden to surface-hidden transition has no lighting row. Multi-frame
catch-up coalesces the union of sparse visibility and address targets, then
publishes each target's final state at most once in ascending target order. This separates
prepared culling, interaction safety visibility, and triangle degeneracy
without duplicating visibility in the playback packet.

Initial surface visibility is declared on the same leaf nodes in `TREE`. In
derived vertical-strip mode, an initial zero `background-position-y` MAY be
omitted because the CSS initial value is semantically zero; if present it MUST
be `0`, `0px`, or `0%`. An initial nonzero derived value is explicit. In
prepared two-axis mode, `background-position` is always explicit and exactly
equals the materialized canonical dictionary value, including `0 0`. The
packet's initial frame and state schedules MUST agree with those styles as a
cross-section invariant.

## Validation boundary

The validator rejects unknown fields, target/frame mismatch, more than 65,536
leaves, noncontiguous face/state ranges, invalid source-frame deltas, malformed
or noncanonical base64, truncated/wrong-width integer tables, bad offsets,
unsorted or out-of-range faces/states, mismatched jump pairs, nonzero unused
visibility bits, semantically incomplete or contradictory sequential/jump rows,
and configured state/change/visibility allocation excess.
Prepared two-axis mode additionally rejects a missing dictionary/index mate,
negative zero, noninteger or out-of-range coordinates, unsorted/duplicate or
unreferenced dictionary rows, and truncated or out-of-range packed indices.
