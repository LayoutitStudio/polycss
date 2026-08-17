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
`time.source-frame`, targets a nonempty unique ordered `nodes` array, declares
exactly the `class.prepared` sink, and has no parameters. It requires executable
playback and has the same `frameCount`, but its targets may be any retained
nodes; overlap with playback or surface is safe because the sink is disjoint.

The state is `{ "packet": ... }`. Packet `version` is 0. Class and target
indices are little-endian uint16. Index `65535` means that a target has no
prepared class.

## Class table and initial state

`packet.classes` is a nonempty, strictly ascending table of unique safe class
tokens. A target may own at most one token from this table at a time.

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

Jumps are validation-bound accelerators. A viewer may instead compare the
materialized canonical rows and publish the same sparse difference.

## Publication

For every changed target, the interpreter removes the previously selected
packet class when present and adds the target class when present. It never
assigns `className`, removes structural classes, or changes topology. Identical
states produce no class mutation.

Variant state is published before prepared surface visibility for the same
source frame. A reveal therefore cannot expose the prior frame's material.
Automatic catch-up may simulate multiple logical frames and publish only the
final class difference, matching the playback final-paint rule. Public
`seek(frame)` synchronously publishes the exact canonical row before returning.

## Limits and rejection

Targets are limited to 65,535 because indices are uint16. Classes are limited
to 65,534 because the final uint16 value is the sentinel. Prepared change
columns use the profile's prepared-change ceiling, and `targets * frameCount`
shares the profile's bounded prepared-cell ceiling.

Malformed base64, unsorted classes/targets, unsafe class tokens, invalid or
no-op indices, incomplete wrap closure, contradictory jumps, initial TREE
mismatch, excessive tables, a missing playback channel, or any binding
contract mismatch is fatal before DOM construction.
