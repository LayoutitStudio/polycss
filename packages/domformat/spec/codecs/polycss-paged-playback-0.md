# `polycss-paged-playback@0`

Status: fixed executable DOMFORMAT profile contract.

## Purpose and ownership

This is the external-page form of prepared playback. It carries final
canonical model, shape, and leaf transforms plus shape visibility without
requiring a document-wide transform table. It is producer-neutral prepared
state, not a generic streaming protocol or a product scheduler.

The STAT codec and BIND interpreter are both `polycss-paged-playback@0`.
Binding inputs, targets, sinks, `baseSceneTransform`, `frameCount`, exact
cadence, timeline deadlines, and catch-up policy are identical to
`polycss-playback@0`. Inline and paged playback
are mutually exclusive. Surface, effects, interaction, presentation timelines,
and viewport profiles may consume the same playback frame contract. Version-0
compositor timing is rejected because its transform indices cannot outlive a
page-local dictionary.

## Shell packet

State data contains only `packet`, with exactly:

```text
version             0
shapeCount          exact playback shape target count
leafCount           exact playback leaf target count
appearances         closed presentation appearance table
timeline            fixed bounded playback timeline
profileTimelines    optional fixed presentation-profile timelines
initialBankId       optional selected prepared-bank id
banks               optional fixed prepared-bank entries and timelines
initial             {sourceFrame,appearance}
pages               contiguous ordered page descriptors
lookaheadPages      1 through 4
maxResidentPages    shared document-wide ceiling through 16
```

The optional `initialBankId`/`banks` pair has the exact identity, ordering,
entry-frame, timeline, profile-timeline, and host-policy boundary defined by
`polycss-playback-packed@0`. Inline and paged playback expose the same
`selectBank` and `selectBankAsync` semantics.

Each descriptor contains exactly `resource`, `startFrame`, `endFrame`,
`transformCount`, `shapeChangeCount`, `leafChangeCount`, and
`materializedByteLength`. Pages uniquely and contiguously cover frames 1
through `frameCount`. The resource is a reachable state page whose codec is
exactly `polycss-paged-playback-page@0`. Descriptor counts and retained bytes
must equal the validated payload rather than estimates.

## Page payload

Decoded bytes are canonical UTF-8 JSON with exactly:

```text
version       0
codec         polycss-paged-playback-page@0
channel       owning STAT id
startFrame    descriptor startFrame
endFrame      descriptor endFrame
transforms    page-local (null | canonical matrix3d string) dictionary
keyframe      complete page-start playback row
sequential    dense appearances plus sparse model/shape/leaf deltas
```

`null` is the only identity transform. A string has exactly sixteen
comma-separated canonical CSS numbers, fixed affine slots 3/7/11 equal to 0
and slot 15 equal to 1, and every variable component round-trips through the
profile's binary32-to-CSS formatter. Explicit identity, excess precision,
nonfinite values, CSS functions other than `matrix3d`, and non-affine rows are
invalid.

The keyframe has `appearance`, `modelTransform`, packed uint32 shape transform
indices, a shape visibility bitset, and packed uint32 leaf transform indices.
Sequential columns contain one uint16 appearance and uint32 model index per
local frame (`0xffffffff` means unchanged), uint32 shape/leaf offsets, strictly
increasing uint32 target indices, uint32 transform indices, and uint8 shape
visibility. All integers are canonical little-endian base64 and decode
directly into typed arrays.

Transform ownership is closed. Model transforms use one owner domain; shape
transforms use one shared/deduplicated domain; each leaf has its own owner
domain. An index cannot cross domains. First reference order across the
keyframe, boundary row, then local rows must introduce dictionary indices in
ascending order. Equal transforms inside a domain reuse one index, every row
is referenced, and no sparse entry is a no-op.

Local row 0 is the sparse predecessor-end to page-start transition. Random
reconstruction ignores row 0 and begins from the complete keyframe. Sequential
boundary and final-to-first wrap publication applies row 0 without scanning a
target keyframe. Validation reconstructs every predecessor end, applies the
target row 0, and requires exact keyframe appearance/model/shape/visibility/
leaf equality with no missing, excess, or no-op changes. In-page simulation
starts at local row 1.

## One document-wide lifecycle

Paged playback and paged variants, when both present, have one equal
`maxResidentPages`, generation, resident map, recency order, loader authority,
and byte ceiling. For every page position validation takes the distinct union
of each channel's current and cyclic lookahead pages plus playback-initial and
interaction-entry pins. The largest union must fit the declared ceiling.
When prepared banks exist, validation also admits the worst transfer from one
active bank-entry pin to another target entry. Only the currently active entry
is pinned after a successful handoff; declared inactive banks do not occupy the
resident window.

Before requesting a decoded page, the viewer reserves capacity, evicts only
the unprotected LRU pages needed for that capacity, and checks the validation
peak. The currently published page remains protected until replacement state
commits. Validation decodes integer
columns directly to typed arrays and accounts loader/canonical bytes, bounded
UTF-16 JSON representations, parsed/final reference slots, final typed/string
materialization, resident pages, and canonical live rows. A failure restores
the previous resource ids and LRU order under the same ceiling without
retaining evicted page objects. A superseding generation owns and verifies its
new desired window while preserving the published page; the stale generation
rejects without publication.

Mount verifies only the pages containing the initial row and every fixed pin
while detached. Playback initial appearance and page row must exactly equal
the shell and TREE model/shape/leaf sinks; paged variants must equal their
shell/TREE class row. Lookahead begins only after the retained tree is
published and attached. Publication stages both
channels and commits only when both target pages are resident and valid.
Prepared classes publish before transform, atlas address, and visibility
writes. Page-local indices never escape eviction; current playback retains only
canonical transform strings, visibility bytes, appearance, and frame.

Synchronous seek fails without mutation if the entire target union is not
resident. Async seek, random reconstruction, adjacent in-page advance,
cross-page boundary, wrap, interaction restore, and profile restart all use
the same staged transaction. `bounded` automatic catch-up advances every
logical row in ready prefixes, including every effects frame, while coalescing
physical playback/variant/surface writes to the final row. `single-step` needs
only its one target row. Collapsed `elapsed` catch-up stages only its final
resolved frame and does not fetch or simulate intermediate rows. Missing
readiness pauses and resumes the selected operation; it is not corruption.
Prepared-bank synchronous and asynchronous selection use the same readiness,
staging, commit, rollback, and stale-generation rules as seek. A failed or
superseded handoff retains the prior bank and active entry pin.

When a responsive schedule change or animation re-entry supersedes an active
page wait, the viewer cancels that wait generation and resets its deadline
before starting the restart window preload. A late completion from the stale
generation cannot cancel or publish over the replacement preload. The selected
viewport profile is revealed only after restart state and replacement loading
have been initiated in that order.

## Descriptor limits

Typed pages have a separate 512-page ceiling and do not consume the eager
stylesheet/image resource count. Paged playback may cover at most 64,000 source
frames, while each descriptor and decoded payload remains subject to the
smaller per-page frame ceiling. Encoded pages retain per-page and aggregate
encoded-page byte limits; decoded bytes, materialized columns, resident pages,
live rows, and publication workspaces remain within the document-wide decoded
state ceiling. These descriptor and byte products validate before any page
request.

## Scope

This codec represents prepared playback model/shape/leaf transforms and shape
visibility. It does not add a profile-dependent leaf-visibility dimension,
arbitrary animation CSS, producer provenance authority, code execution, or
product-specific preparation policy.
