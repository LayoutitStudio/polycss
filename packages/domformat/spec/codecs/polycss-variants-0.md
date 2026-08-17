# polycss-variants-packed@0 / polycss-variants@0

Status: experimental executable codec/interpreter pair for `domformat@0` and
`polycss-3d@0`.

## Purpose

This codec publishes prepared material, palette, face, bank, or other visual
variants as one controlled class token on each declared retained node. It does
not evaluate selectors, discover materials, rebuild nodes, or execute producer
logic at runtime.

## Binding and coupling

The executable binding consumes exactly the un-defaulted `uint` input
`time.source-frame`, targets a nonempty unique ordered `nodes` owner array plus
an ordered `effectNodes` array, and has no parameters. Owner and effect targets
are exact retained node ids and are mutually unique. Every effect node is a
strict descendant of its declared owner. It requires executable playback and
has the same `frameCount`, but its class owners may overlap playback targets.

The binding declares `class.prepared` plus the strictly sorted union of the
effect-table sinks. Version 0 effect sinks are `style.backgroundColor`,
`style.backgroundPositionX`, `style.color`, `style.display`, and
`style.outlineColor`. They do not grant transform, visibility, opacity, or
general style authority. A background-position-x effect may not overlap a
full `style.backgroundPosition` surface sink.

The state is `{ "packet": ... }`. Packet `version` is 0. Class and target
indices are little-endian uint16. Index `65535` means that a target has no
prepared class.

## Class table and initial state

`packet.classes` is a nonempty, strictly ascending table of unique safe class
tokens. A target may own at most one token from this table at a time.

`packet.effects` is a nonempty table sorted uniquely by
`classIndex,ownerIndex,targetIndex`. Every entry has exactly those three uint16
indices plus a nonempty `styles` map. `targetIndex: 65535` addresses the owner;
other values address `effectNodes`. Every class has at least one effect. The
allowed style keys and sinks are:

```text
backgroundColor     style.backgroundColor
backgroundPositionX style.backgroundPositionX
color               style.color
display             style.display
outlineColor        style.outlineColor
```

Values use the closed inline style-value grammar. `display` is exactly `block`
or `none`; `backgroundPositionX` is canonical `0` or a nonzero signed integer
pixel value. An effect is invalid when TREE inline state would shadow the same
property, or when two independent owners can control the same target/sink.

Package stylesheets MUST NOT mention a prepared class token in any selector.
After validation, the viewer assigns each retained node a viewer-owned numeric
`data-domformat-node` attribute and emits exact instance-scoped selectors from
the effect table. This preserves class-cascade updates to declared descendants
without accepting package-authored dynamic selectors. Stylesheet priority
annotations are forbidden, so generated effects cannot override or be
overridden through `!important`.

`packet.initial.frame` is exactly frame 1 and equals playback's initial source
frame. `initial.classIndicesBase64` contains exactly one uint16 per target. The
TREE class list for each target contains exactly the selected initial token, or
none of the packet tokens for the sentinel. Other TREE classes are structural
and remain outside this interpreter's ownership.

## Sparse sequential transitions

`packet.sequential` contains canonical little-endian uint32 `offsetsBase64`
with `frameCount + 1` entries, plus parallel uint16 target and class tables.
Offsets begins at zero, is nondecreasing, and ends at the parallel table
length. Targets within every segment are strictly increasing. Class indices
reference the class table or the sentinel, and every row changes its target;
no-op rows are invalid.

Segment `n` publishes target frame `n + 1`. Segment zero is therefore the wrap
from the last frame to frame 1. Starting from the initial row, applying segments
1 through `frameCount - 1` reconstructs every canonical frame. Applying segment
zero to the last row MUST reproduce the initial row exactly.

## Noninteractive jumps

Each optional jump declares unique, distinct, in-range `fromFrame` and
`toFrame` values plus parallel uint16 target/class tables. Targets are strictly
increasing. A jump contains exactly the targets whose canonical class differs
between its two frames, and each class is the canonical target-frame value.
Extra, omitted, no-op, or contradictory rows are invalid.

Jumps are validation-bound accelerators. Validation reconstructs one mutable
canonical row and retains snapshots only for frames named by declared jumps;
an empty jump table does not allocate a target-by-frame matrix. A viewer may
instead simulate bounded sparse segments and publish the same difference.

Materialization retains exactly the initial uint16 target row, the decoded CSR
offset/target/class columns, and decoded declared jumps. It MUST NOT expand a
target-by-frame matrix. Adjacent publication applies its one CSR segment
directly. A missing noninteractive jump is reconstructed by walking the bounded
sequential cycle and retaining only the last class for each touched target.

## Publication

For every changed target, the interpreter removes the previously selected
packet class when present and adds the target class when present. It never
assigns `className`, removes structural classes, or changes topology. Identical
states produce no class mutation.

Variant state is published before prepared surface visibility for the same
source frame. A reveal therefore cannot expose the prior frame's material.
Automatic catch-up may simulate multiple logical frames and publish only the
final class difference in ascending target order, writing each touched target
at most once, matching the playback final-paint rule. Public
`seek(frame)` synchronously publishes the exact canonical row before returning.

## Limits and rejection

Targets are limited to 65,535 because indices are uint16. Classes are limited
to 65,534 because the final uint16 value is the sentinel. Prepared change
columns use the profile's prepared-change ceiling, and `targets * frameCount`
shares the profile's bounded prepared-cell ceiling.

Initial TREE closure builds one class-membership set. Validators MUST NOT scan
the full class palette separately for every retained target or materialize all
canonical target rows merely to validate sequential closure.

Malformed base64, unsorted classes/targets/effects, unsafe class tokens,
undeclared or shadowed effect properties, non-descendant effect targets,
conflicting sink ownership, invalid or no-op indices, incomplete wrap closure,
contradictory jumps, initial TREE mismatch, excessive tables, a missing
playback channel, or any binding contract mismatch is fatal before DOM
construction.
