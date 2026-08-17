# domformat@0 conformance

The conformance area is repository-side certification material, not package
runtime and not a public producer API.

`producer.py` is an independent Python producer. It imports no domformat
implementation, fixture, or source module. It emits one executable
`domformat@0` / `polycss-3d@0` JSON document and deterministic external sibling
resources.

`reader.py` is an independent Python reader. It imports no production
JavaScript and validates bounded JSON, the closed six-member envelope, safe
sibling paths, SHA-256 and media identity, retained-tree closure, CSS closure,
prepared state, bindings, and cross-section invariants.

`nversion/` is a production-free JavaScript browser reader. It independently
implements JSON parsing, deep schema and prepared-codec checks,
sibling-resource and media verification, and CSS validation. It imports
neither `src/` nor `conformance/viewer/`. Browser proof passes its validated
result to the alternate mount shell below; it is not a second runtime.
N-version evidence is format-level; executable codec output semantics remain
covered by the reference interpreters and fixed transcript/oracle tests.

`viewer/` is an alternate mount shell. It independently constructs the tree,
binds resources, materializes CSS, captures snapshots, and owns transactional
teardown, while importing the compiled reference lifecycle, input adapter, and
profile interpreters from `dist/`. Comparing it with the public browser mount
tests shell composition, stable retained DOM, ordered writes, animation,
interaction, CSS materialization, and rollback without maintaining copied
state machines. It independently owns eager/deferred resource identity checks,
bounded page decoding, initial-before-attach readiness, rational/explicit
deadline scheduling and declared catch-up policy,
and transactional shell cleanup.

## Commands

From `packages/domformat`:

```sh
mkdir -p /tmp/domformat-independent
python3 -B conformance/producer.py /tmp/domformat-independent/model.json
python3 -B conformance/reader.py validate /tmp/domformat-independent/model.json
python3 -B conformance/reader.py inspect /tmp/domformat-independent/model.json
python3 -B conformance/run_corpus.py
python3 -B conformance/check_canonical.py
python3 -B conformance/check_css.py
```

`producer.py --ordinary` deliberately emits noncanonical but valid JSON to
prove that readers accept normal JSON whitespace, key order, and numeric
spellings while the reference writer remains deterministic.

## Shared corpus

`corpus/cases.json` drives the Python, production Node/browser, and N-version
readers from the same positive JSON document and sibling resources. It covers:

- valid canonical JSON and verified resources;
- explicit rejection of gzip transport;
- malformed UTF-8/JSON, duplicate keys, negative zero, and unknown fields;
- unsupported format/profile/capabilities and invalid initial experience;
- rejected embedded payload and legacy storage fields;
- unsafe, case-aliased, duplicate, or file/directory-colliding sibling paths;
- terminal visual nodes missing the required `aria-hidden="true"` contract;
- missing resources and digest corruption.

Targeted cross-reader matrices additionally cover responsive presentation and
profile-selected playback timelines, same-topology viewport profiles, typed orbit input, closed compositor timing,
inline and paged variants, exact artifacts versus inert claims, C0 style
controls, boolean packet-version confusion, and state-page encoded/decoded
identity, canonical payload, and decompression failures. The paged-limit matrix
admits a descriptor-only 64,000-frame/500-page closure without page loading and
rejects excessive total pages, total frames, per-page frames, aggregate encoded
bytes, and resident materialized-byte products before resource loading in the
production, N-version, and Python readers.

The canonical JSON and binary32 corpora pin writer-form encoding and prepared
arithmetic. The CSS security corpus pins the fail-closed selector, declaration,
function, URL, token, and scope rules. Seeded and targeted differential
mutations compare Node, Python, and N-version decisions across cross-field,
deep prepared-codec, and media invariants.

## Release evidence

The release gate verifies:

- byte-identical repeated JSON and sibling writes from both producers;
- canonical writer-form JSON and ordinary-reader form;
- identical decoded contracts across Node, browser, Python, and N-version
  implementations;
- exact stable-tree and DOM-write transcripts across public and alternate mount
  shells that share the reference interpreters;
- real Chromium runs from a clean-installed tarball and proves ordered
  class/address/reveal publication, deferred page fetch plus eviction/refetch,
  combined paged playback/variant lazy seeks, width and landscape-first
  portrait-band roots, playback-timeline, and per-leaf profiles, including
  playback-initial page residency after disjoint lookahead; typed orbit input, compositor logical
  timing, and `animate: false` across reference, alternate-shell, and
  N-version-reader paths; it also mounts the independently produced animation
  at a noninitial source frame;
- a retained `<i>` strategy leaf in the reference-writer Chromium fixture,
  complementing Gallery strategy counts from its pinned feature profile;
- separately captured zero model-pixel deltas for public versus alternate
  mount-shell paths and production-reader versus N-version-reader paths;
- exact runtime tarball allowlisting and a clean-installed runtime/CLI smoke.

No package mode, embedded payload path, archive, gzip document transport, or
`.dom` extension is part of this conformance contract. Bounded gzip is tested
only for the fixed typed state-page resource.
