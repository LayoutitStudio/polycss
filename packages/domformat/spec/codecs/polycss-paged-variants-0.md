# `polycss-paged-variants@0`

Status: fixed executable DOMFORMAT profile contract.

## Purpose and binding

This channel is the external-page form of prepared variants. It preserves the
same retained-node class/effect contract as `polycss-variants@0` while keeping
large sequential schedules outside the canonical document and retaining only a
bounded verified page window. It is not a generic resource codec, streaming
API, or package-code hook.

The state codec and interpreter are both `polycss-paged-variants@0`. The binding
consumes only un-defaulted `time.source-frame`, has no parameters, and declares
the same nonempty ordered `nodes`, optional ordered `effectNodes`,
`class.prepared`, and exact sorted effect sinks as the inline variant contract.
It requires playback with the same `frameCount`. Inline and paged variant
channels are mutually exclusive.

## Document packet

The state data contains only `packet`. Its packet contains exactly:

```text
version             0
frameCount          playback frame count
classes             sorted prepared class-token table
effects             sorted declared class effect table
initial             {frame,classIndicesBase64}
pages               ordered page descriptors
lookaheadPages      1 through 4
maxResidentPages    shared document-wide protected-window requirement through 16
```

`classes`, `effects`, and `initial` have the exact closure defined by
`polycss-variants@0`: class indices are little-endian uint16, `65535` is the
no-class sentinel, initial frame is 1 and matches playback, TREE owns exactly
that initial prepared class row, every class has a validated effect, package
CSS cannot mention the class tokens, and effect targets/properties are fully
declared and sink-safe.

Each page descriptor has exactly `resource`, `startFrame`, `endFrame`,
`changeCount`, and `materializedByteLength`.
Descriptors are in increasing frame order, resource ids are unique, the first
page starts at frame 1, every next page starts at the prior end plus one, and the
last page ends at `frameCount`. Empty, overlapping, gapped, duplicated, or
out-of-range page sets are invalid. Each resource is a reachable `state-page`
record whose codec is exactly `polycss-paged-variants-page@0`.

## Page resource and payload

A page record uses media type
`application/vnd.layoutit.domformat-state-page+json`, an `identity` or `gzip`
encoding, exact encoded `byteLength`/SHA-256, and exact
`decodedByteLength`/SHA-256. An identity page has equal encoded and decoded
identities. Gzip decoding stops and fails as soon as output would exceed the
declared decoded length. The decoded bytes MUST be canonical UTF-8 JSON and
contain exactly:

```text
version                       0
codec                         polycss-paged-variants-page@0
channel                       owning STAT channel id
startFrame                    descriptor startFrame
endFrame                      descriptor endFrame
keyframeClassIndicesBase64    one uint16 per variant target
sequential                    packed sparse local transitions
```

The keyframe is the complete canonical class row for `startFrame` and every
entry references `classes` or the sentinel. `sequential` contains canonical
little-endian uint32 `offsetsBase64` and parallel uint16
`targetIndicesBase64`/`classIndicesBase64`. For a page spanning `N` frames,
offsets has `N + 1` entries, begins with two zeroes, is nondecreasing, and ends
at the equal parallel-column length. Local frame `k` for `1 <= k < N` applies
the range `offsets[k]..offsets[k + 1]` to the preceding row. Targets within one
range are strictly increasing and in bounds; class indices are in bounds or the
sentinel; every entry changes the current row. A page-local no-op, malformed
base64, noncanonical JSON, identity/range disagreement, or excessive column is
fatal.

The page keyframe deliberately makes random reconstruction independent of the
preceding page. Validation does not require or allocate a target-by-global-frame
matrix. Descriptor change and materialized-byte counts must exactly equal the
validated typed payload.

## Loading and publication lifecycle

The browser reader validates the document, eager stylesheet/image closure, all
page descriptors, aggregate encoded/decoded bounds, and page loading authority
without fetching state pages. During mount, the page containing frame 1 is
fetched, encoded-identity checked, bounded-decoded, decoded-identity checked,
and payload-validated while the mount surface remains detached. The page that
contains playback's initial source frame remains pinned so a responsive
timeline restart stays synchronous after a disjoint lookahead window. If the document
declares `polycss-pointer-grab@0`, the page containing its fixed `initialFrame`
is also verified while detached and remains pinned, regardless of the initial
experience. This keeps synchronous `setMode("interaction")`
resource-independent after publication.

After attachment, the viewer maintains one document-wide resident map for
paged variants and optional paged playback. It protects each channel's current
page plus declared cyclic lookahead pages, the playback-initial pin, and the
interaction pin when present. Both channels declare the same ceiling and a
publication is ready only when their conjunction is resident.
Before fetching, decompressing, parsing, or materializing a nonresident page,
the viewer MUST evict least-recently-used unprotected pages until one
decoded-page slot is available. At no point, including decoded-byte return and
payload validation before map insertion, may decoded residency exceed
`maxResidentPages`. If loading or payload validation fails, the prior resident
set and its recency order are restored before the failure propagates. If a
superseding generation has already changed residency, that generation MUST
restore or verify its surviving desired window instead, or fail closed.
Loading a page already resident updates its recency without duplicating it.
Eviction never removes a page protected by the current desired window or either
fixed pin. If no slot can be made without evicting a protected page,
loading fails with `STATE_PAGE_RESIDENCY_LIMIT`; a viewer MUST NOT transiently
over-admit and repair the excess afterward.
Validation computes the distinct union for every possible current page of its
cyclic current-plus-lookahead window and the page containing playback's initial
source frame, plus the interaction entry page when present. `maxResidentPages`
MUST be at least the largest such union. Overlapping pins or window entries
count once.

An adjacent publication within one page applies only that frame's sparse
segment. Same-frame publication reconstructs and republishes the canonical row.
Other resident jumps reconstruct from the target page keyframe and apply its
local segments through the target frame. Class mutations follow the inline
variant rules and occur before surface reveal.

`seek(frame)` first asserts that the target page is resident. If not, it raises
`STATE_PAGE_NOT_READY` without changing playback frame, class state, surface
state, or DOM. `seekAsync(frame)` starts a new generation, cancels the prior
generation, verifies the target current/lookahead window, and only then invokes
the same synchronous publication. Stale and aborted generations publish
nothing. A non-abort deferred load, digest, decode, or payload failure destroys
the mounted runtime transactionally. Destroy cancels requests, clears pending
and resident pages, and makes later operations fail.

`setMode("interaction")` uses its already verified pinned page and therefore
does not start I/O, evict the entry state, or turn an ordinary mode change into
an asynchronous operation. The pin guarantees the fixed entry publication; it
does not pin every source frame reachable by the interaction animator. Before
each interaction step, the viewer checks the captured source frame while the
animator and DOM are still unchanged. Each successful step starts or continues
the ordinary current-plus-lookahead preload for that frame. If an automatic
step reaches a nonresident page, the viewer pauses, verifies that frame's
window, and resumes the remaining ticks from the original bounded due batch,
preserving one publication per interaction tick. After that batch it drops only
timing backlog accumulated during the wait. `STATE_PAGE_NOT_READY` alone is not
a fatal package error; a verification, digest, decode, or payload failure is.

`bounded` automatic animation catch-up preflights every due timeline frame and advances
only the largest prefix whose pages are all resident. This remains required
when the final frame's page is resident but an intermediate frame's page is
not. If the next frame is absent, the viewer publishes the ready prefix,
pauses before changing the missing frame's playback state, verifies that
frame's window, and recursively drains the remaining original due count through
new resident prefixes. It resets its deadline from completion and drops only
ticks accrued during the asynchronous wait, so load time does not become a
second catch-up backlog and the original bounded catch-up remains exact.
`single-step` preflights only its one row. Collapsed `elapsed` catch-up stages
only the final resolved playback/variant row and never fetches intermediate
variant pages.

## Rejections and limits

Typed pages have a separate 512-page ceiling and do not consume the eager
stylesheet/image resource count. Encoded pages share the per-page byte ceiling
and a separate aggregate encoded-page ceiling; decoded bytes additionally share
the aggregate decoded-state ceiling. A paged schedule may cover at most 64,000
source frames, while each descriptor and payload remains bounded by the smaller
per-page frame ceiling. Transition columns retain the prepared-change ceilings.
Targets remain limited to 65,535 and classes to 65,534 by uint16 plus sentinel.

Generic binary pages, arbitrary codecs, missing or unreachable resources,
unsupported compression, descriptor gaps/overlaps, decoded expansion beyond
the declared length, wrong encoded or decoded digest, wrong channel/range,
noncanonical page JSON, unsorted/no-op sparse transitions, excess residency,
and publication from a nonresident page are all fatal.
