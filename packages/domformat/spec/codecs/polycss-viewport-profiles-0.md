# polycss-viewport-profiles-packed@0 / polycss-viewport-profiles@0

Status: experimental executable codec/interpreter pair for `domformat@0` and
`polycss-3d@0`.

## Purpose

This codec selects bounded prepared transform and visibility state for the
existing playback leaf topology. A profile may also carry sparse visibility
changes indexed by source frame and a closed responsive affine row evaluated
only when the viewport changes. It covers retained layout and visibility
profiles without evaluating media queries, arbitrary expressions, producer
code, or topology at runtime. Version 0 does not vary classes, atlas addresses,
resources, shapes, or node identity.

## Binding and ownership

The executable binding consumes exactly the un-defaulted float inputs
`viewport.height` and `viewport.width`, in that order. It has no parameters,
targets the exact ordered playback `leaves` array, and declares exactly
`style.transform` and `style.visibility`.

Viewport profiles require executable playback and static presentation. They
are a composed modifier inside playback, not a competing sink writer. The
current playback transform remains the base row; a profile transform index may
override it. Prepared surface visibility and profile visibility are combined
with logical AND. Interaction-forced visibility remains an explicit override.

## Packet

State is `{ "packet": ... }`. Packet `version` is 0 and the packet has exactly
`version`, `selection`, `transforms`, and `profiles`.

`transforms` is a strictly lexicographically sorted dictionary of unique
finite 12-component affine `matrix3d` rows. It has at most 65,534 entries and
is bounded by the profile's prepared-transform limit. Every dictionary row is
referenced.

Every profile has a stable unique `id`, one little-endian uint16 transform
index per playback leaf in `transformIndicesBase64`, and one visibility bit per
playback leaf in `visibleBitsBase64`. Transform index `65535` selects the
current base playback transform. Unused high visibility bits are zero.
Profiles are limited to 256, and profile-count times leaf-count shares the
prepared visibility-cell ceiling.

A profile may contain `visibilityChanges` with little-endian uint32
`offsetsBase64` and uint16 `leafIndicesBase64`. The offsets have exactly
`frameCount + 1` entries, start at zero, are nondecreasing, and end at the leaf
column length. Segment `f - 1` contains the strictly increasing leaves toggled
when entering one-based source frame `f`; segment zero is the wrap into frame
1. Applying frames 2 through `frameCount` and then segment zero must reproduce
`visibleBitsBase64`. The document-wide prepared-change limit bounds the sparse
columns. A profile without this object keeps its initial visibility row for
every frame.

A profile may contain `responsiveAffine` with:

- `scale`: positive finite `baseWidth`, `baseHeight`, and `multiplier`, plus an
  optional positive finite `max`, all no greater than 1,000,000. The shared
  value is `min(max, multiplier * min(width/baseWidth, height/baseHeight))`,
  with the outer minimum omitted when `max` is absent.
- `presentBitsBase64`: one bit per playback leaf. Only present rows override
  the profile's static/base transform.
- `coefficientsBase64`: 16 little-endian IEEE-754 binary64 values for every
  present leaf, in target order. Values are finite canonical non-negative-zero
  numbers with magnitude at most 1,000,000,000. For coefficients `c0..c15`,
  the emitted CSS `matrix(a,b,c,d,e,f)` is:
  `a=c0+c1*s`, `b=c2+c3*s`, `c=c4+c5*s`, `d=c6+c7*s`,
  `e=c8+c9*w+c10*h+c11*s`, and
  `f=c12+c13*w+c14*h+c15*s`. Each result is rounded to six decimal places;
  negative zero is emitted as zero. The prepared-state limit bounds the total
  coefficient count.

## Selection

`selection.mode` is one of:

- `presentation-profile`: profile ids and order exactly match the responsive
  static-presentation bank. Profile rows omit width and height. The row whose
  id is selected by static presentation is selected here.
- `smallest-covering`: every row has positive integer `width` and `height` no
  greater than 1,000,000. Rows are uniquely sorted by area, then width-plus-
  height, width, and height. The viewer selects the first row whose width and
  height both cover the current viewport. If no row covers it, base playback
  transforms and visible profile bits are used.

Selection uses layout viewport numbers only. Arbitrary media predicates,
orientation APIs, user-agent tests, and script callbacks are outside the
contract. A `presentation-profile` row may nevertheless follow static
presentation's closed `landscape-first-portrait-width` numeric comparison.

## Publication

Changing the selected row scans the bounded playback leaf list once. An
unchanged static selection performs no leaf work; an unchanged responsive row
is recomputed only when width or height changes. Leaves becoming hidden are
hidden before their underlying transform changes. Leaves becoming visible
receive the selected prepared or responsive transform, then their current
prepared surface address, then `visibility:visible`. Interaction-owned physical
transforms are not overwritten; their prepared base/override state is updated
for the next restore.

Sequential playback applies only the selected profile's sparse visibility
segment. Seek, wrap, skipped publication, responsive profile changes, and
same-frame interaction restoration reconstruct the exact selected profile row.
Playback transforms and class/address state are committed before a profile
change can reveal a leaf. Profile selection preserves the current source frame.

Initial profile publication occurs while the retained tree is detached and
before the mount surface is attached. Resize publication preserves every node
identity and never rebuilds topology. A profile switch does not advance source
time or change variant/surface logical state.

## Rejection

Unknown fields or modes, missing dependencies, target-order mismatch,
noncanonical or unreferenced transform rows, malformed/truncated packed rows,
nonzero unused bits, unsorted or open visibility cycles, malformed scales or
binary64 coefficients, empty responsive target sets, excessive tables,
presentation-profile disagreement, or noncanonical smallest-covering order is
fatal before DOM construction.
