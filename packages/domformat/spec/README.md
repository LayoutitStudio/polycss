# domformat@0 specification set

Status: experimental private-alpha contract. The `@0` identifiers are
deliberately unstable; incompatible changes are allowed until a later version
is declared stable.

The normative documents are:

- [`domformat-0.md`](./domformat-0.md): JSON transport, deterministic writer
  form, semantic sections, sibling resources, and resource integrity;
- [`polycss-3d-0.md`](./polycss-3d-0.md): retained XHTML construction plan,
  scoped CSS closure, prepared state channels, bindings, and DOM sinks;
- [`security.md`](./security.md): mandatory rejection rules and default resource
  limits;
- [`cssgraphics-compatibility.md`](./cssgraphics-compatibility.md): source-cited
  regression evidence for the stable browser demos at the pinned cssGraphics
  revision;
- [`codecs/`](./codecs/): executable prepared-state codec/interpreter contracts.

The conformance corpus, independent Python producer and reader,
production-free N-version JavaScript reader, and alternate executable mount
shell are described in `conformance/README.md`.

`TREE`, `CSSB`, `STAT`, `BIND`, and logical `RCRD` identities express the
retained-DOM execution contract. The only physical form is a `.json` document
plus digest-bound external sibling resource files. The document transport is
never compressed. A fixed typed state-page sibling may be identity or bounded
gzip and carries both encoded and decoded length/SHA-256; it is verified before
use and is not a generic chunk or binary-codec extension.

`domformat@0` permits data and fixed, trusted interpreters only. A package never
supplies JavaScript, WebAssembly, custom elements, event handlers,
package-declared network URLs, or a general expression language. Hosted sibling
files remain same-origin, document-relative, digest-bound closure resources. The
profile lifecycle is strictly `validate → construct → bind → initialize →
publish → destroy`.

The prepared adapter-technique intake and scoped compatibility evidence are
labelled with and audited against `LayoutitStudio/cssGraphics` commit
`bb2d0b030b9a5b15f2268d8221b57b56fb61be30`. DOMFORMAT remains an experimental
private-alpha contract; the evidence promises closed execution compatibility,
not producer lowering or original-product visual parity.
