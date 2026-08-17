# @layoutit/polycss-domformat

`@layoutit/polycss-domformat` is PolyCSS's private, producer-neutral reference
implementation of the experimental `domformat@0` retained-DOM contract. It
stores one canonical UTF-8 JSON document plus integrity-bound sibling resource
files. There is no `.dom` packet, archive, gzip document transport, embedded
payload, or alternate packaging mode. A fixed typed state-page sibling may use
bounded gzip with exact encoded and decoded identity.

The package is authored in strict TypeScript and builds code-split ESM plus
declarations. It has no runtime dependencies and does not depend on
Morph or PolyCSS renderer internals. It is `private: true` and MIT-licensed; it
is tested and built in the workspace but excluded from public versioning and
publication.

## CLI

```sh
domformat encode manifest.json --output model.json
domformat inspect model.json --json
domformat validate model.json
domformat decode model.json --output decoded
```

`encode` writes every declared resource beneath the output document directory,
then publishes `model.json` last. Existing targets and symlinked path
components are rejected. `decode` writes the six semantic sections and verified
resources into a new directory.

## Node API

```js
import {
  buildDom,
  readDom,
  readDomFile,
  validateDocument,
  DomFormatError,
} from "@layoutit/polycss-domformat";
```

These are the complete Node exports. `buildDom` consumes the closed writer
manifest and returns canonical JSON bytes plus sibling-resource bytes keyed by
their relative paths. `readDom` validates supplied bytes and a logical-id
resource map. `readDomFile` loads and verifies paths relative to the JSON
document directory.

`readDom` may be used for document-only inspection: when sibling bytes are not
supplied it reports their ids in `externalMissing`. Every supplied resource is
still digest- and policy-validated. Set `requireResources: true` to require a
complete package; only complete browser-reader results can be mounted.

Producers must emit the writer manifest natively. Parsing, preparation,
lowering, source provenance, and product adapters remain in producer packages;
domformat contains no producer-specific or legacy conversion layer.

## Browser API

```js
import {
  readDomBrowser,
  readDomBrowserUrl,
  mountDom,
} from "@layoutit/polycss-domformat/browser";

const result = await readDomBrowserUrl("/models/example.json", { signal });
const runtime = await mountDom(result, host, { signal });
```

These are the complete browser exports. URL loading fetches the JSON document
and its digest-bound, document-relative, same-origin sibling files with
credentials omitted and redirects rejected. Direct byte loading requires a
logical-id `externalResources` map or a trusted `loadExternalResource` callback.

Mounting follows:

```text
validate → construct → bind → initialize → publish → destroy
```

Partial failures roll back DOM, style elements, listeners, observers, object
URLs, and host mutations. `destroy()` is idempotent. The runtime controller is
closed to `lifecycle`, `mode`, `sourceFrame`, optional `bankId`, `seek`,
`seekAsync`, `selectBank`, `selectBankAsync`, `setMode`, the fixed `setInput`
operation, and `destroy`.
Automatic playback may defer transforms and atlas addresses for paint-hidden
leaves; every reveal flushes transform then address before visibility.
`seek(frame)` is the synchronous barrier that restores transforms plus the
canonical variant/surface row before returning, including for a same-frame
seek after interaction changed only surface state.

Large prepared playback and class schedules may use fixed typed state pages.
One document-wide coordinator verifies entry pages before attach, enforces
encoded, decoded, resident, lookahead, and request-generation ceilings, and
commits cross-channel seeks atomically. Prepared bank selection changes state
on the same retained topology; random/catalog policy remains host-owned.

Playback accepts bounded rational or explicit cadence, declared catch-up, and a
closed transform-only compositor strategy. Presentation supports bounded
responsive roots and same-topology leaf profiles. Surface addresses, sparse
classes, transforms, and visibility always publish in the validated order
before reveal. The fixed orbit input exposes prepared data semantics but leaves
pointer, wheel, inertia, and widget policy to the host. Exact wire contracts,
limits, and lifecycle rules live in the repository specifications.

## Contract and security

The top-level JSON object has exactly six members: `meta`, `tree`,
`cssBinding`, `state`, `bindings`, and `resources`. Resource records declare a
safe relative `path`, exact byte length, SHA-256 digest, media type, and image
dimensions where applicable. Paths are case-portable and cannot alias or form
file/directory prefixes. Unknown fields and undeclared files fail closed.

The format excludes executable package code, generic expressions, arbitrary
network resources, custom interpreters, arbitrary HTML, ZIP/container formats,
compatibility aliases, and browser-generated identity. CSS is parsed against a
closed semantic subset, scoped to a viewer-owned instance, and rewritten only
for validated asset tokens. Prepared class effects use a separate exact
owner/descendant/property table materialized by the viewer; package CSS cannot
attach rules to dynamic class tokens or use priority annotations.

The normative specifications, independent Python producer/reader and N-version
JavaScript reader, fixtures, alternate mount shell, and certification tests
remain repository-side and are intentionally absent from the install tarball. See the
[domformat source directory](https://github.com/LayoutitStudio/polycss/tree/main/packages/domformat)
for that material. The repository also carries
[pinned cssGraphics compatibility evidence](https://github.com/LayoutitStudio/polycss/blob/main/packages/domformat/spec/cssgraphics-compatibility.md)
for the complete stable browser-demo technique mapping at the audited source
revision.

## Release gate

From the PolyCSS workspace:

```sh
pnpm --filter @layoutit/polycss-domformat test:release
```

The gate runs strict type checking, Node tests, independent reader/producer
conformance corpora, real-browser noninitial-frame mount and visual
comparisons, exact tarball allowlisting, two byte-identical packs in one
toolchain, clean-install
API/CLI/declaration checks, and deterministic independent-producer checks.
