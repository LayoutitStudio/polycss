# domformat@0 security requirements and default limits

Status: normative for the experimental `domformat@0` / `polycss-3d@0` alpha.

## 1. Trust boundary

A domformat `.json` document and all sibling files are untrusted data.
Transport, schemas, cross-table references, CSS, and eager stylesheet/image
bytes MUST validate before DOM construction, stylesheet insertion, or
object-URL creation. A deferred state page MUST validate completely before it
becomes resident or affects prepared-state execution. Viewer-supplied
fixed interpreters execute declared tables; package bytes never become
JavaScript, WebAssembly, HTML parsing input, custom-element names, event
handlers, a CSS expression language, or arbitrary network targets.

Validation is fail-closed. A reader MUST NOT repair malformed input, apply
last-key-wins duplicate JSON semantics, skip unknown schema fields, or mount a
partially validated document.

The Node `readDom` API MAY be used in document-inspection mode by leaving
`requireResources` false. In that mode it validates the JSON contract and every
supplied sibling, reports every absent resource id in `externalMissing`, and
  MUST NOT describe the result as a verified package. Missing CSS, image, or
  state-page bytes leave their byte-level or payload boundary unverified. A
  complete Node package read MUST require and verify every declared sibling.
  Browser readers eagerly verify every stylesheet/image sibling, retain
  state-page loading authority privately, and verify pages before use under the
  lifecycle in sections 4 and 5.

## 2. Mandatory rejection boundary

A reader rejects at least:

- a file/response over limit, malformed UTF-8/JSON, duplicate keys, non-NFC or
  invalid Unicode, negative zero, numeric overflow, excessive nesting,
  excessive array/object structure, trailing data, unknown envelope fields, or
  missing required members;
- gzip or any non-JSON transport, or JSON bytes beyond the active limit;
- unsupported format/profile/schema/codec/interpreter, duplicate or unsorted
  ids, unknown or inaccurate required capabilities, invalid parent/sibling/depth, forbidden elements/attributes/styles,
  unsafe local style values, malformed/empty/excessive target graphs, missing
  targets, excessive target nesting, cross-channel target ownership conflicts,
  unsupported or resource-capable sinks, unbound
  state, and inaccurate declared counts;
- invalid resource counts, lengths, digests, media signatures, dimensions, or
  semantic roles; unused resources; legacy storage or embedded payload fields;
  missing siblings during complete-package reads; unsafe relative paths;
  origin escape, redirects, credentials, or responses outside exact lengths;
  state-page gaps/overlaps/duplicates, unsupported codec or encoding, encoded
  or decoded identity mismatch, noncanonical payloads, coverage disagreement,
  invalid sparse columns, noncanonical/aliased/unreferenced page-local
  transforms, incomplete boundary/wrap deltas, decompression failure, or decompression beyond the
  declared decoded length;
- CSS escapes/comments/at-rules/nesting, selector scope or sibling escape,
  properties outside the profile vocabulary, unknown/network-capable
  functions, remote/data/file/javascript URLs, undeclared/unused asset tokens,
  and executable legacy constructs;
- codec table/cardinality/range errors, malformed codec base64, invalid
  binary32 values, non-finite derived binary32 operations, out-of-range direct
  frame indices, unsafe prepared atlas positions, contradictory prepared
  surface/variant transition or jump accelerators, or
  allocations beyond limits.

Disk readers inspect regular-file metadata and limits before allocation, read
exactly the recorded size, reject growth/truncation/metadata change, and only
then parse. A file loader resolves the validated path beneath the real document
directory, rejects symlinked path components and final symlinks, and verifies
that the opened device/inode still names the in-bound path after reading.
Deployments SHOULD keep document
directories non-writable during validation because portable runtimes lack a
common directory-handle API that eliminates every directory-replacement race.

Selector prefixing alone is not a paint/input boundary. An embedded viewer MUST
use an isolated document or viewer-owned mount surface with the clipping,
containment, isolation, size, positioning, stacking, visibility, opacity,
transform, overflow, and pointer-event boundary required by
`polycss-3d@0`. Package attributes/CSS apply to that surface, never the
embedding application's outer container.

## 3. Default limits

Implementations MAY expose stricter limits. The reference alpha defaults are:

| Limit | Value |
|---|---:|
| JSON document bytes | 128 MiB |
| decoded JSON bytes | 128 MiB |
| JSON items in one array | 16,000,000 |
| JSON members in one object | 2,048 |
| JSON object-key length | 256 UTF-16 code units |
| manifest bytes (writer input) | 1 MiB |
| decoded referenced input bytes | 64 MiB each |
| retained nodes | 250,000 |
| tree depth | 64 |
| attributes per node | 32 |
| classes per node | 32 |
| local styles per node | 64 |
| eager stylesheet/image resources | 2,048 |
| typed state-page resources | 512 |
| bytes per resource | 64 MiB |
| aggregate eager resource bytes | 128 MiB |
| aggregate encoded state-page bytes | 128 MiB |
| aggregate decoded state-page bytes | 128 MiB |
| stylesheet bytes | 16 MiB |
| stylesheet rules | 8,192 |
| stylesheet selectors | 32,768 |
| UTF-8 bytes per selector | 4,096 |
| stylesheet declarations | 131,072 |
| stylesheet functions | 131,072 |
| logical CSS asset tokens per binding | 2,048 |
| image width / height | 16,384 / 16,384 |
| image decoded pixels | 64 Mi pixels |
| aggregate decoded image pixels | 128 Mi pixels |
| state channels | 128 |
| binding channels | 128 |
| binding inputs | 256 |
| targets per binding | retained node count plus `$host` |
| target containers / structural entries | `4 * target limit + tree depth` each |
| eager source frames | 10,000 |
| paged source frames | 64,000 |
| source frames per state page | 10,000 |
| timeline ticks | 1,000,000 |
| prepared transforms | 2,000,000 |
| prepared surface states | 2,000,000 |
| prepared changes | 4,000,000 per bounded column |
| visibility cells (`leaves * frames`) | 8 Mi |
| prepared variant cells (`targets * frames`) | shared 8 Mi cell ceiling |
| effect particles | 10,000 |
| effect spawn tuples | 1,000,000 |
| interaction controls | 256 |
| interaction objects | 65,536 |
| interaction vertices | 2,000,000 |
| interaction weights | 4,000,000 |
| interaction weight references | 8,000,000 |
| interaction leaf rows | 4,000,000 |

MiB means `1024 * 1024` bytes; Mi means `1024 * 1024` entries.

Lengths and cardinalities are checked before multiplication, allocation,
slicing, codec-table base64 decoding, or typed-array conversion. Aggregate counters are
checked after every addition. Codec-table base64 decoded sizes are derived
with a linear bounded scanner before decoding. Canonical base64 requires the
standard padded alphabet and zero unused trailing bits; alternate spellings of
the same decoded bytes are rejected. Validators
MUST avoid regex strategies whose stack or runtime grows unsafely on
multi-megabyte payloads. JSON array/object counts are scanned before the host
JSON parser materializes them. Binding target graphs are traversed iteratively
under depth, target, container, and structural-entry limits; empty containers
cannot evade the target cardinality budget.
The visibility-cell limit is also a validation CPU budget because semantic
transition closure revisits the bounded matrix.

Writers enforce the same document/resource/whole-file ceilings. Manifest
references use portable paths confined to the real manifest directory and the
same final-symlink/no-follow/opened-inode checks as sibling resources. Writers
reject case-folded aliases, file/directory prefix collisions, Windows device
names, and trailing-dot segments; validate every existing output path component; reject symlinked output
directories, preflight all targets, and publish the `.json` document only after
all resources have been written successfully.

## 4. Browser fetching

The model URL uses HTTP(S), has no username/password, and resolves against a
caller-trusted base. Fetch omits credentials, rejects redirects, and accepts an
optional caller `AbortSignal`. Model streaming stops beyond the file limit.
Each sibling resource resolves from a validated relative path against the model
URL, retains the same origin, and streams under its exact declared length.

`Content-Length` is only an early check. Transfer encoding does not weaken the
limit on bytes delivered to the reader. Digest, media structure, dimensions,
and CSS policy are verified after stream completion. Every image is
additionally decoded by the browser before publication.
Responses must expose a readable byte stream so limits are enforced before
allocation. The reader does not fall back to an unbounded
`Response.arrayBuffer()`.

The browser reader deeply freezes its validated document and retains a private
copy of every eagerly verified resource plus a private state-page loader.
Public inspection bytes are separate copies and exclude deferred pages. The
mount implementation MUST consume only that private snapshot/loader across
asynchronous digest/decode phases; caller mutation of the returned object
cannot alter constructed or published semantics.

PNG and WebP resources are single static images. Animated PNG control/frame
chunks and animated WebP features/chunks are rejected; time-varying package
state must use declared prepared channels. The aggregate pixel ceiling is
checked from declared dimensions before image decoding.

The browser reader uses stricter defaults than the general table: 32 MiB model
and decoded JSON, 10,000 nodes, 64 eager resources, 512 typed state pages,
8 MiB per resource, 16 MiB aggregate eager resources, 32 MiB aggregate encoded
and decoded state pages, 16 Mi per-image and aggregate decoded image pixels,
1 MiB CSS, 2,000 eager frames and frames per page, 64,000 paged frames, and
proportionally smaller prepared-table ceilings. A host may reduce or explicitly
raise known limits.
Abort is checked during streaming and between bounded synchronous validation,
materialization, and mount phases; it is not a JavaScript preemption primitive.

## 5. Runtime and teardown

Interpreter loops are bounded by validated packet cardinalities and write only
declared target/sink pairs. Bind resolves and retains every declared stable
target node before that lifecycle phase is observable; initialization does not
perform late id lookup. Fixed pools are allocated once; package data cannot grow
the DOM at runtime.

Teardown cancels deadline timers, animation frames, current/deferred state-page
requests, response readers, pointer capture, event listeners, observers, and interpreter work; removes injected styles and the
viewer-owned surface; restores prior container children/focus attributes; and
revokes every object URL. Keyboard listeners are application-container-local.

Paged playback and variants share one generation, resident map, LRU order, and
byte ceiling. Admission removes stale unprotected pages and reserves a slot
before requesting decoded bytes. The ceiling includes resident materialized
columns, canonical live rows, and the fixed JSON validation peak: loader plus
canonical bytes, four bounded UTF-16 representations, parsed/final reference
slots, and direct typed destinations. Integer columns never become boxed
number arrays; playback transforms are canonical `matrix3d(...)` strings with
identity represented only by `null`. A failed unsuperseded transaction restores
only prior resource ids under the same ceiling; it never retains evicted page
objects. Supersession owns the surviving exact window and publishes nothing
from the stale generation.
A mount follows the profile's strict `validate → construct → bind → initialize
→ publish → destroy` lifecycle. No live runtime is returned before publication.
A failure in any phase rolls back every completed phase, restores the embedding
container, and enters `destroy`. Destroy is idempotent: repeated calls are
no-ops, and operations that require a published runtime fail after it.

A failed mount performs the same cleanup for already-created resources. Hosts
SHOULD impose wall-time or worker cancellation policy for large but valid
documents.

The pages containing each paged channel's initial frame and any fixed
interaction-entry frame are verified and materialized while the mount surface
remains detached. The playback-initial page and any interaction page stay
pinned. Only after initial
publication and attachment may the viewer start current-plus-lookahead loads.
The lookahead is one to four pages and the declared resident ceiling is at most
sixteen pages and at least the maximum distinct union, over every cyclic current
page, of current plus lookahead plus the playback-initial and optional
interaction-entry pins. Before a nonresident page is fetched or decompressed, an
unprotected decoded-page slot is reserved; transient over-admission followed by
eviction is not allowed. Failed loading or payload validation restores the
prior resident order unless a superseding generation already changed it, in
which case that generation verifies its surviving desired window or fails
closed. A new async seek cancels the prior generation. Synchronous seek
to a nonresident page fails before any
logical or physical state change. Async seek verifies the target window before
publication. Any non-abort late failure transactionally destroys the mount;
stale or aborted generations publish nothing.

The document-wide decoded-state byte ceiling covers resident page
materialization, both retained paged-variant rows, the canonical paged-playback
row, validation bytes, the incoming page, and publication staging/copy arrays.
Admission uses a conservative bound derived from descriptor bytes and exact
target counts before fetch or publication. Peak counters include the incoming
page while it is validating and every staged publication workspace.

The interaction pin covers the fixed mode-entry frame, not every frame the
closed animator can reach. Automatic animation and interaction steps preflight
the page they will publish before changing logical state. Ordinary
nonresident readiness pauses the scheduler while the digest-bound window is
verified and does not itself destroy the mount; verification failure remains
fatal. `bounded` animation catch-up advances only the largest due prefix for
which every source-frame page is resident, even if a later due page is already
resident; after verifying each first missing frame it recursively drains the
original bounded due count through newly resident prefixes. `single-step`
preflights one row; collapsed `elapsed` preflights only its final resolved row.
Interaction likewise keeps one publication per original admitted tick and
replenishes lookahead after each successful captured-frame publication. Page
wait completion resets the scheduler origin so loading does not create a new
backlog.

## 6. Non-goals

SHA-256 provides byte identity/integrity, not publisher authenticity. META
artifact claims are inert producer assertions: validation checks only their
shape, bounds, ordering, references, and local-path exclusion. Document hashing
does not make license, redistribution, qualification, locator, or revision
claims true, and no claim grants fetching, execution, resource, trust, or rights
authority. Version 0 has no signatures, trust store, origin permissions, DRM,
custom media registration, or claim to native browser support. Rights and
provenance review remain release-process concerns outside byte validation.
