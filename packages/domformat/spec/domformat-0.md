# domformat@0 JSON package specification

Status: experimental private alpha. Normative words such as MUST, MUST NOT,
SHOULD, and MAY have their usual requirements meaning.

## 1. Identity and scope

A conforming document declares `meta.format` as `domformat@0`. The first
implemented profile is `polycss-3d@0`, specified separately. The only
conventional extension is `.json`.

The format identity is the retained-DOM execution contract in `tree`,
`cssBinding`, `state`, `bindings`, and `resources`. Its only serialization and
transport is a UTF-8 JSON document. Logical resources are external sibling
files; there is no archive, packet, or embedded-resource mode.

## 2. Transport

A reader accepts one UTF-8 JSON document. Bytes beginning with gzip magic
`1f 8b` MUST be rejected as `UNSUPPORTED_TRANSPORT`; a reader MUST NOT silently
decompress them. Format/profile identity is confirmed only after bounded JSON
decoding and schema validation of `meta`.

The physical input length is the JSON document length. Version 0 has no second
document length field, custom transport framing, compression layer, or
container. Typed sibling state pages described in section 7 are resources, not
document transport chunks. File or response length, JSON structure ceilings,
semantic limits, and resource declarations provide the relevant bounds.

## 3. JSON rules

### 3.1 Reader form

Readers accept insignificant JSON whitespace, any object-key order, and any
JSON number spelling that represents an allowed value. They MUST reject:

- malformed UTF-8 or JSON, a byte-order mark, or trailing non-whitespace data;
- duplicate object keys;
- strings or keys that contain non-scalar Unicode or are not NFC;
- negative zero, non-finite/overflowing numbers, or excessive nesting;
- values outside the safe-integer range where a schema field is an integer.

The reference nesting limit is 256 JSON levels. Implementations MUST detect
duplicates before constructing an ordinary last-key-wins object. Readers MUST
also bound array items and object members during a lexical structure pass,
before materializing the JSON graph. The reference bounds are derived from the
active semantic and decoded-byte ceilings; with the default limits they are
16,000,000 items in one array and 2,048 members in one object. These generic
bounds do not relax any smaller field-specific cardinality. Object keys are at
most 256 UTF-16 code units; profile keys are normally much shorter fixed names.

### 3.2 Deterministic writer form

The reference writer emits canonical JSON:

1. strings and keys contain Unicode scalar values and are normalized to NFC;
2. object keys are sorted lexicographically by UTF-16 code units;
3. arrays preserve declared order;
4. finite binary64 numbers use ECMAScript's shortest round-trippable JSON
   spelling, with negative zero emitted as `0`;
5. strings use ECMAScript JSON escaping;
6. there is no insignificant whitespace or byte-order mark.

Normalization occurs before key sorting.
Two input keys that normalize to the same key are invalid. Canonical JSON
vectors in `conformance/corpus/canonical-json-cases.json` fix the writer form.
Canonical writing is required for deterministic reference output, not as a
barrier to independent readers or producers.

## 4. Document envelope

The decoded top-level object contains exactly these required members:

```text
meta
tree
cssBinding
state
bindings
resources
```

Unknown top-level fields, including `payloads`, are invalid in `domformat@0`;
an incompatible extension requires a new format identifier.

Conceptually, the six required values are the `META`, `TREE`, `CSSB`, `STAT`,
`BIND`, and `RCRD` sections. They are ordinary object members, not binary
chunks. Schema version fields in `tree`, `cssBinding`, `state`, `bindings`, and
`resources` are exactly `0`.

## 5. META

`meta` requires:

- `format`: exactly `domformat@0`;
- `profile`: exactly `polycss-3d@0` for this profile;
- `title`: nonempty display text, at most 256 Unicode scalar values;
- `generator`: `{ "name": string, "version": string }`, where `name` matches
  `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` and `version` matches
  `[0-9A-Za-z][0-9A-Za-z.+-]{0,63}`;
- `capabilities`: a nonempty unique array of required capability identifiers;
- `conformance`: `{ "executable": string[], "declaredOnly": [] }`, exactly
  describing the fixed profile roles present in the document.

These optional fields are defined:

- `optionalCapabilities`: unique, strictly ascending short capability
  identifiers which do not overlap `capabilities`;
- `initialExperience`: `animation` or `interaction`; omission means
  `animation`;
- `counts`: optional nonnegative integer counts that MUST match the
  corresponding tree or executable playback cardinality;
- `artifacts`: one to 64 strictly id-sorted source identities. Each record has a
  stable short `id`, structural `role`, encoded and decoded byte lengths, and
  SHA-256. These fields establish exact byte identity only; qualification belongs
  in an inert claim.
- `claims`: one to 128 optional inert statements, strictly sorted by artifact id
  then kind. A claim references an artifact and has one of `license`, `locator`,
  `qualification`, `redistribution`, or `revision`. Locators are credential-free
  fragment-free HTTPS URLs. Claims cannot contain control characters or local
  absolute paths and never authorize loading, execution, trust, or rights.

The `@0` suffix in `format` and `profile`, together with each semantic section's
`version: 0`, is the complete version declaration; META has no redundant numeric
version. The known required capability vocabulary is:

```text
css-semantic-closure deterministic-json explicit-retained-tree logical-assets
prepared-particle-effects prepared-compositor-timing prepared-orbit-input
prepared-paged-state prepared-pointer-grab-interaction prepared-playback
prepared-surface-lighting prepared-variants prepared-viewport-profiles
```

An unknown required capability is fatal. Unknown optional capabilities are
ignored and MUST NOT change construction, binding, initialization, or
publication. Required capabilities and executable conformance roles MUST
exactly match the fixed interpreter closure. Required capabilities begin with
the four base capabilities shown above, in that order, then append the
capability for each present interpreter in this order:

```text
polycss-effects@0 polycss-compositor-timing@0 polycss-orbit-input@0
polycss-paged-playback@0 polycss-paged-variants@0 polycss-pointer-grab@0 polycss-playback@0
polycss-surface@0 polycss-variants@0 polycss-viewport-profiles@0
```

`conformance.executable` begins with `retained-tree`, then appends the role for
each present interpreter in this order:

```text
particle-effects compositor-timing orbit-input paged-variants paged-playback playback
pointer-grab-interaction presentation surface-lighting variants viewport-profiles
```

The corresponding role order is `polycss-effects@0`,
`polycss-compositor-timing@0`, `polycss-orbit-input@0`,
`polycss-paged-variants@0`, `polycss-paged-playback@0`, `polycss-playback@0`,
`polycss-pointer-grab@0`, `static-presentation@0`, `polycss-surface@0`,
`polycss-variants@0`, then `polycss-viewport-profiles@0`. Omitted interpreters
omit their capability or role without reordering the remaining entries.
`declaredOnly` MUST be empty.
`initialExperience: "interaction"` requires the
`prepared-pointer-grab-interaction` capability and an executable matching
binding. Codec packets carry their own fixed initial state/frame declarations;
META does not duplicate them.

Unknown fields are invalid. There are no self-digests for JSON sections: the
document transport already binds them as one byte stream, while every logical
resource has its own digest.

## 6. Semantic sections

- `tree` gives the exact parent-before-child construction plan, stable ids,
  mount operation, and initial safe local attributes/styles/resource sinks.
- `cssBinding` binds digest-identified stylesheets to an exact validated scope
  and maps `dom-asset:*` tokens to image resource ids.
- `state` contains sorted prepared-state channels using approved data codecs,
  never package-supplied code.
- `bindings` declares sorted inputs and binds every state channel exactly once
  to a fixed viewer interpreter, stable targets, and whitelisted DOM sinks.
- `resources` contains sorted logical resources with kind, media type, exact
  encoded byte length, SHA-256, image dimensions or decoded state-page identity
  where applicable, and sibling path.

`spec/polycss-3d-0.md` and `spec/codecs/` define the closed schemas and
cross-section invariants.

## 7. External sibling resources

A resource record has:

```text
id                 [a-z][a-z0-9._-]{0,63}
kind               stylesheet | image | state-page
mediaType          one exact profile-approved media type
byteLength         nonnegative safe integer encoded length
digest             {algorithm:"sha256",value:<64 lowercase hex>} for encoded bytes
dimensions         {width,height}, required only for images
encoding           identity | gzip, required only for state pages
decodedByteLength  exact decoded length, required only for state pages
decodedDigest      exact decoded SHA-256, required only for state pages
codec              polycss-paged-playback-page@0 | polycss-paged-variants-page@0,
                   required only for state pages
path               validated portable relative POSIX path
```

Version 0 media types are `text/css;charset=utf-8`, `image/png`, `image/webp`,
and `application/vnd.layoutit.domformat-state-page+json`, paired with the
corresponding kind. Resource ids are unique and strictly sorted. Every resource
MUST be reachable from the tree, CSS binding, prepared presentation state, or
one of the fixed paged playback/variant channels. A state page is never a generic binary/custom
codec facility. Its decoded bytes are canonical JSON for exactly the declared
codec and page range.

Eager stylesheet/image resources and typed state-page resources have separate
count and aggregate encoded-byte ceilings. Raising the state-page descriptor
ceiling therefore does not admit additional eager assets. Paged playback has a
separate total-frame ceiling, while every descriptor and decoded page remains
subject to the smaller per-page frame ceiling.

Stylesheet and image bytes MUST match length, digest, media structure, and
dimensions before DOM construction or object-URL creation. State-page record
shape, coverage, reachability, encoded/decoded aggregate ceilings, and identity
relationships validate with the document. The initial page MUST additionally
match encoded and decoded identity and its canonical codec payload before host
attachment. A deferred page MUST pass those same checks before it can become
resident or affect publication. For `identity`, encoded and decoded length and
digest are exactly equal. Gzip is allowed only as the record's page encoding;
decoded output is capped at `decodedByteLength` during decompression.

`path` is a portable relative POSIX path of at most 240 bytes. It has one or more segments,
each matching `[A-Za-z0-9][A-Za-z0-9._-]*`. Absolute paths, backslashes, empty
segments, `.`/`..`, colon, percent, query, and fragment characters are invalid.
A segment ending in `.` or whose case-insensitive stem is `CON`, `PRN`, `AUX`,
`NUL`, `COM1` through `COM9`, or `LPT1` through `LPT9` is also invalid.
Resource paths MUST be unique after ASCII case folding, and no folded path may
be a component-wise ancestor of another path. This keeps every declared file
physically distinct on case-sensitive, case-insensitive, Windows, and POSIX
filesystems.

The resource is located relative to the `.json` document directory. Browser
URL loaders require the document origin, omit credentials, and reject redirects.
Disk loaders confine the resolved regular file beneath the real document
directory and reject every document-relative symlink component and final
symlink, even if the link resolves back inside that directory. Path is location
only; byte length and SHA-256 define identity.

## 8. Deterministic writing

For identical input bytes, semantic values, writer version, and limit policy, a
writer MUST emit identical JSON and sibling-resource bytes. It MUST NOT
insert timestamps, random values, absolute paths, hostnames, locale-dependent
formatting, filesystem enumeration order, or unstable insertion order.
Resources and named channels are sorted by their declared ids.

## 9. Explicit rejections and omissions

Version 0 does not define arbitrary extension fields, scripting, custom
interpreters, custom elements, network resources, arbitrary HTML, text nodes,
signatures, publisher authentication, media-type registration, generic binary
resources, generic compression, or a general expression language. SHA-256
records provide byte identity, not authenticity.

In particular, version 0 rejects JavaScript-like expressions including
`Math.random()`, arbitrary executable code, XPath or any general expression
language, ZIP or another archive/container, DOMSnapshot-style string tables or
columnar node encoding, browser-generated node identities, MHTML/WebArchive
page replay, and package-declared network URLs. A hosted document may fetch only
its digest-bound, document-relative, same-origin sibling files under section 7;
that is document closure, not a network-resource facility. Any future
reconsideration requires benchmark or interoperability evidence and a new
versioned contract.
