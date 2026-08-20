# Pinned cssGraphics compatibility evidence

This evidence is scoped to `LayoutitStudio/cssGraphics` commit
`bb2d0b030b9a5b15f2268d8221b57b56fb61be30`. It covers every stable browser
demo at that revision: 3D Pipes, ElectroPaint, Gears, Gravity Well, Maze,
Menger, and Solitaire. Experimental Flowerbox is excluded and supplied no
technique or implementation to this revision. The pin exports a Super Mario 64
browser adapter, but its custom/Morph prepared-package and product path is
outside this DOMFORMAT mechanism claim and has no top-level stable browser-demo
contract, so it is not part of this seven-browser-demo claim.

## Evidence boundary

The claim is that every DOMFORMAT-owned prepared execution mechanism used by
the seven demos has a closed representation and executes without semantic,
ordering, lifecycle, or bounded-residency regression. It does not claim that
DOMFORMAT contains the demos' content, their exact prepared schedules,
producer lowering, host randomness, catalog selection, topology choice, or a
pixel oracle for the original products.

The executable proof has four layers:

1. The pinned cssGraphics checkout passes its available source tests and every
   stable browser-demo build.
2. Adapter-labelled closed witnesses exercise the exact declared technique
   composition through the production TypeScript reader, independent
   N-version JavaScript reader, and Python reader. Undeclared executable
   mechanisms are removed, required nonchanging surface closure is treated as
   structural rather than source behavior, and exact technique equality is
   asserted.
3. The same seven documents run from the clean-installed npm tarball through
   the reference viewer, alternate conformance mount, and N-version viewer in
   real Chromium. Each of the 21 semantic transcripts checks canonical initial
   state, observable noninitial sink publication, retained model/leaf identity,
   responsive publication, typed compositor retention, and prepared-bank
   handoff where applicable. A second 21-transcript matrix stalls the actual
   declared cadence, captures and stops on the first post-stall sink
   publication, and asserts single-step or elapsed reconstruction.
4. The technique-specific browser proofs separately check atomic paged
   readiness, eviction/refetch, class/address/reveal order, exact cadence and
   catch-up, profile-frame visibility, responsive affine rows, compositor
   snapping, and bank failure/supersession. A clean-installed CDP trace uses
   valid ElectroPaint-sized 40-leaf/500-frame pages and Gravity-Well-sized
   1,984-leaf pages in all three viewers.

These witnesses are mechanism regression contracts, not copied adapter assets
or assertions that invented tiny schedules equal the source schedules. A
future producer that lowers a demo must preserve its source data; boundary and
visual parity of that lowering remain producer gates.

## Source and executable coverage

| Demo | Pinned source evidence | Exact execution represented and exercised |
|---|---|---|
| 3D Pipes | `endlessTubes.mjs:217-222`; `prebakedPlayback.mjs:165-209,226-327`; `presentation.mjs:15-50,106-147` | exact 60 Hz rational cadence, single-step lateness, paged playback and variants, responsive profiles, retained prepared banks |
| ElectroPaint | `README.md:3-12,34-39`; `preparedPlayback.mjs:61-105,117-132,176-234` | exact 60 Hz rational cadence, single-step lateness, paged transforms and palette-class color effects; descriptor-only all-reader admission for 64,000 frames/128 pages plus valid traced 40-leaf/500-frame page execution with a four-page lookahead |
| Gears | `preparedPlayback.mjs:98-126,169-208,424-443`; `stagePresentation.mjs:16-65`; `prepare-polycss-snapshot.mjs:156-161` | exact 30 ms cadence, single-step lateness, prepared variants, responsive presentation, retained prepared banks |
| Gravity Well | `preparedPlayback.mjs:131-250,253-327,359-367,571-594`; `preparedAssets.mjs:115-160,185-253,273-338,430-438` | exact 30 ms cadence, paged transforms and prepared color effects, profile-by-frame visibility and reveal catch-up, prepared banks, hard page/byte residency |
| Maze | `sceneBuilder.mjs:279-295`; `preparedPlayback.mjs:119-145`; `client.mjs:104-159` | exact 20 ms cadence, single-step lateness, typed compositor timing, retained prepared banks |
| Menger | `README.md:5-18`; `preparedPlayback.mjs:188-231,250-318,347-350` | exact 30 ms cadence, elapsed reconstruction, model playback, full atlas address state, typed compositor timing |
| Solitaire | `prepare.mjs:23-29,406-497`; `preparedPlayback.mjs:71-138,190-208,249-325,472-505` | exact 24 Hz rational cadence, nonuniform explicit-deadline and elapsed-reconstruction mechanism, aspect-first profile timelines, continuous responsive affine rows, retained prepared banks |

Source paths in this table are relative to the pinned cssGraphics repository.
The externally labelled machine-readable inventory lives in
`test/cssgraphics-contracts.js`; unknown or omitted stable demo ids fail the
fixture builder. The revision label and source citations are review evidence,
not a runtime authentication claim.

## Manually recorded pinned source baseline

During this review, a clean archive of the exact pin was installed with its
declared pnpm dependencies. The available source suites passed:

```text
test:gears
test:gravitywell
test:electropaint
test:menger
test:maze
test:solitaire
71 tests passed
```

3D Pipes has no source unit-test script at this pin. All seven browser builds
passed: `build:3dpipes`, `build:electropaint`, `build:gears`,
`build:gravitywell`, `build:maze`, `build:menger`, and `build:solitaire`.

## Reproduction

The DOMFORMAT evidence is reproducible from the PolyCSS workspace:

```sh
pnpm --filter @layoutit/polycss-domformat test:coverage
pnpm --filter @layoutit/polycss-domformat test:browser
```

The coverage gate includes all-reader adapter contracts and ElectroPaint's
outer descriptor-cardinality admission. The browser report contains
`cssGraphicsCompatibility` with one record for every `(demo, reference)`,
`(demo, conformance)`, and `(demo, nversion)` pair, labelled with the pinned
commit.
It also contains `cssGraphicsTiming` for the same 21 pairs. The source-size page
trace is reproduced separately with:

```sh
pnpm --filter @layoutit/polycss-domformat test:page-preparation
```
