# PolyCSS Software Renderer Bible

- Status: living engineering reference and decision record
- Last evidence refresh: 2026-08-04
- Repository baseline: PolyCSS `v0.2.11`, commit `8992048d3a8be738a1061af63531e58bed80fa08`
- DOMFormat baseline: [PR #81](https://github.com/LayoutitStudio/polycss/pull/81), commit `6ac5eadde94361e34dbcd3b678a4a95560780e01`
- Mario evidence target: standalone CodePen package with 1,213 retained leaves and 820 source frames

## Navigation

- [Purpose](#purpose)
- [One-page answer](#one-page-answer)
- [Rules for using this bible](#rules-for-using-this-bible)
- [Source trust ladder](#source-trust-ladder)
- [PolyCSS translation dictionary](#polycss-translation-dictionary)
- [Architecture truth](#architecture-truth)
- [Renderer lineage and applicability matrix](#renderer-lineage-and-applicability-matrix)
- [Detailed field guide](#detailed-field-guide)
- [Local experiment ledger](#local-experiment-ledger)
- [Rejection ledger](#rejection-ledger)
- [DOMFormat follow-up commit](#domformat-follow-up-commit)
- [Sequential experiment register](#sequential-experiment-register)
- [Performance investigation playbook](#performance-investigation-playbook)
- [Research decision template](#research-decision-template)
- [Ownership map](#ownership-map)
- [Common inference errors](#common-inference-errors)
- [Code-reading index](#code-reading-index)
- [Curated source shelf](#curated-source-shelf)
- [What is settled, what is next](#what-is-settled-what-is-next)

## Purpose

This is the durable reference for software-renderer research that can inform PolyCSS. It exists so a new optimization question does not restart forty years of renderer archaeology.

Use it to answer:

1. What problem did a historical renderer or algorithm actually solve?
2. Which part of that solution transfers to a retained-DOM renderer?
3. Does PolyCSS, DOMFormat, or prepared Mario already implement it?
4. What did local measurement support or falsify?
5. What new evidence would justify reopening a rejected direction?
6. Which package and contract should own a surviving technique?

This document is broader than provenance. It is also the vocabulary, architecture map, source index, measurement protocol, experiment ledger, rejection ledger, and implementation queue.

## One-page answer

PolyCSS is not a software framebuffer renderer. It prepares geometry, state, and paint resources, retains one DOM leaf per polygon, publishes CSS state, and delegates rasterization, paint, tiling, compositing, and presentation to the browser. Techniques that require owning pixels usually do not transfer. Techniques that reduce geometry, visibility, state changes, publication, or synchronization often do.

LOD is not an available escape hatch. PolyCSS does not switch among fidelity representations at runtime or by view; any useful renderer technique must improve the one mounted prepared representation.

Prepared Mario already has the architecture that a first-pass software-renderer survey would recommend:

- a stable retained scene graph;
- a compiled, directly indexed display stream;
- sparse shape and leaf deltas;
- exact pre-expanded affine transforms;
- prepared lighting states that act as a surface cache;
- conservative visibility preparation plus a bounded transition schedule;
- stable polygon identity;
- dirty-set publication for nonsequential `seek()`;
- explicit validate, construct, bind, initialize, publish, and destroy phases;
- a scheduler that owns source time.

The broad MAME-style submission manager was falsified for normal Mario playback. It found no repeated target/property writes to coalesce, duplicated the browser's existing rendering boundary, and increased JavaScript cost.

The strongest surviving technique is **visibility-coherent publication**:

```text
prepared frame row
        |
        v
logical retained leaf state
        |
        +-- visible ------> publish transform to DOM
        |
        +-- hidden -------> retain latest transform + dirty bit
                                  |
                                  +-- flush before reveal or sync barrier
```

The integrated SR-07 result removed 20,798 of 128,592 transform assignments over
180 Mario ticks (16.17%), preserved every visible state and retained node
identity over the complete 820-frame loop, and restored canonical hidden DOM on
a same-frame seek. Exact 320x240 pixel comparison passed for all 820 animation
frames and all 44 interaction frames after an exact baseline A/A calibration.
Three final-code Chrome trace pairs showed flat frame pacing and modestly lower
median script/compositor cost, but no resolvable FPS improvement. Therefore the
technique is adopted as an internal DOMFormat prepared-playback optimization
with explicit synchronization semantics, not as a public PolyCSS batch API.

SR-08 then found the smaller MAME-like boundary that Mario actually needed:
when one browser callback owes multiple animation ticks, simulate every logical
tick and effect transition but commit only the final retained state. Controlled
120 ms stalls cut catch-up style mutations per due tick by 63.30% and catch-up
p95 callback time by 63.23%. Normal one-tick work was unchanged, interaction
ticks remain separately published, and all 317 numbered Mario commits covering
820 logical ticks matched pixel-for-pixel with stable node identity. This is an
internal backlog path, not a generic submission manager or public batch API.

The sequential experiment register is the execution authority. SR-08 is closed;
SR-09 is the only ready row, and every later experiment remains locked.

## Rules for using this bible

### Do not start from a named renderer

Start from the measured cost:

| Cost being paid | First technique family to consult |
| --- | --- |
| Too many retained nodes | one-time geometry reduction, exact merging, cheaper leaf representation |
| Too many JS calculations | preparation, display streams, hierarchy, cached transforms |
| Too many DOM setters | dirty state, temporal coherence, visibility-coherent publication |
| Too much style work | fewer publications, inherited variables, compositor-owned animation |
| Too much paint/raster | leaf strategy, visibility, atlas locality, browser compositing |
| Too much overdraw | visibility scheduling, PVS, hierarchy, occlusion coherence |
| Missed-frame backlog | deadline policy, final-state publication, catch-up coalescing |
| Stale asynchronous commits | generations, snapshots, explicit synchronization |
| Excess package/startup size | stream encoding, columnar data, quantization, lazy materialization |

### Transfer the invariant, not the machinery

Examples:

- Transfer MAME's immutable submitted-state snapshot and explicit synchronization; do not import its scanline extents or worker framebuffer renderer.
- Transfer Quake's surface-cache principle; do not recreate its span rasterizer.
- Transfer hierarchical visibility and cost-aware traversal; do not build a DOM z-buffer.
- Transfer dirty-region accumulation as dirty logical targets; do not redraw rectangular pixels.
- Transfer display-list preparation; do not add another replay queue around an already compiled stream.

### Reopen a rejected direction only with a changed premise

A new citation is not a changed premise. Reopen only when at least one of these changes:

- the measured dominant cost moves to a different pipeline phase;
- the product no longer requires retained polygon identity or exact presentation;
- the browser gains a materially different primitive or compositor contract;
- topology, animation cardinality, or visibility statistics change substantially;
- a concrete prototype beats the recorded baseline under the same workload;
- an existing semantic blocker, such as snapshot observability, is deliberately redefined.

### Visual parity is mandatory for every win

No experiment in this register may be called `SUPPORTED` or `ADOPTED` from
state equivalence, DOM-write counts, or traces alone. Every claimed win that
can affect browser rendering requires a numbered baseline/candidate frame
sequence captured from identical input bytes, viewport, clock, and source-frame
schedule, followed by an absolute pixel diff over the raw frames.

Run baseline A/A first to establish the capture floor. Any nonzero tolerance
must come from that A/A result and be recorded; it may not be selected after
looking at the candidate. Keep the raw sequences as the source of truth, report
frame cardinality, dimensions, maximum per-channel error, mismatched pixels,
and the worst frame, and inspect the worst diff image. Stable DOM identity and
logical-state parity remain separate gates; neither substitutes for pixels.

For an optimization such as SR-07 whose skipped mutations occur only while a
leaf is paint-hidden, the expected threshold is exact: zero mismatched pixels
over the complete 820-frame Mario loop. A measured work or trace improvement
without that visual proof is `INCONCLUSIVE`, not a win.

## Source trust ladder

Every historical claim should be labeled mentally by its source class:

1. **Normative specification:** strongest evidence for an API or contract.
2. **Original paper or thesis:** strongest evidence for an algorithm's intended problem and trade-offs.
3. **Original released source:** strongest evidence for how a shipping software renderer actually worked.
4. **Maintainer documentation:** strong evidence for a living implementation such as MAME or Chromium.
5. **Community decompilation:** valuable structural evidence, but not an official original source. The SM64 decomp belongs here.
6. **Local measured evidence:** authority for this exact PolyCSS/Mario workload, with hashes, repetitions, traces, and parity checks.
7. **Secondary explanation:** useful for discovery only; replace it with one of the sources above before making a design claim.

## PolyCSS translation dictionary

Historical terms are easy to misapply because the ownership boundary is different.

| Software-renderer term | PolyCSS / DOMFormat analogue | Important difference |
| --- | --- | --- |
| Framebuffer | Browser-owned painted/composited output | PolyCSS cannot directly read or schedule pixels without becoming another renderer. |
| Primitive | Retained polygon leaf | A leaf persists across frames instead of being resubmitted for every image. |
| Draw call | A logical state publication to one or more retained targets | A CSS setter is not itself a draw; the browser may defer style and paint. |
| Display list | Prepared frame rows, transform table, state-transition streams | DOMFormat already stores a compiled stream; replay indirection alone adds no value. |
| Render state | Logical transform, visibility, lighting, material, and interaction arrays | State can be current even when hidden physical DOM publication is deferred. |
| Matrix stack | Shape-parent transforms plus leaf-local transforms | Mario's six shape roots already capture every persistent rigid grouping measured. |
| Surface cache | Prepared atlas pages and per-face lighting-state positions | The cache stores paint-ready images rather than shaded framebuffer blocks. |
| Z-buffer / span buffer | Browser depth/compositing plus prepared visibility schedule | JavaScript does not own a per-pixel depth surface. |
| PVS | Prepared frame/region visibility rows | Mario's schedule is frame-indexed; world packages may be region/cell-indexed. |
| Dirty rectangle | Dirty retained target or property | The profitable unit is usually a leaf index, not a screen rectangle. |
| Command buffer fence | Public synchronous operation, generation check, or lifecycle barrier | The browser commit is implicit; application-visible state barriers must still be explicit. |
| Buffer swap | Browser presentation after rendering update | There is no PolyCSS front/back framebuffer to swap. |
| Tile/bucket | Browser compositor tile or prepared asset locality | DOM reparenting by screen tile is not equivalent and breaks hierarchy. |
| LOD / impostor | No PolyCSS analogue | Runtime/view-dependent representation switching is outside the product contract. |

## Architecture truth

### The immutable product boundary

The current [agent guide](../AGENTS.md) defines the load-bearing constraints:

- one visible polygon maps to one retained leaf;
- no Canvas, WebGL, WebGPU, or per-frame software framebuffer;
- JavaScript should not repaint polygons every frame when ancestor CSS state can express the motion;
- skeletal/prepared animation is the accepted exception because leaves deform independently;
- preparation should own every deterministic result that does not need to remain live.

PolyCSS does not permit runtime or view-dependent LOD, progressive refinement, or impostor substitution. A model has one selected prepared representation while mounted. This does not turn a producer's one-time, explicitly chosen import optimization into LOD; the forbidden mechanism is switching among fidelity representations according to distance, load, time, or visibility.

That means the relevant optimization order is:

1. remove work at preparation time;
2. reduce retained leaf count without violating the visual contract;
3. reduce runtime logical changes;
4. reduce physical DOM publication;
5. give the browser stable, compositable primitives;
6. only then investigate scheduling.

Pixel rasterization algorithms sit outside that order unless the product boundary changes.

### Exact Mario anatomy

The measured CodePen package contains:

| Item | Count / behavior |
| --- | ---: |
| Stable shape parents | 6 |
| Stable polygon leaves | 1,213 |
| Source frames | 820 |
| Source cadence | 30 Hz |
| Prepared transform-table entries referenced by playback | 373,308 |
| Leaf-transform changes over the complete loop | 551,808 |
| Mean leaf changes per frame | 672.94 |
| Median leaf changes per frame | 721 |
| Maximum leaf changes in a frame | 849 |
| Shape changes over the complete loop | 1,115 |
| Maximum shape changes in a frame | 2 |

The runtime stream is already a compiled display program:

- `frameRows` directly index each source frame;
- `shapeChanges` and `leafChanges` are sparse delta-coded target streams;
- `transforms` hold exact prepared affine CSS values;
- lighting transitions select prepared atlas state;
- visibility transitions apply a prepared retained schedule;
- interaction temporarily overrides declared target closures;
- `seek()` simulates intermediate state and publishes the final dirty set once.

### DOMFormat PR #81 anatomy

The permanent source anchors below point to the exact reviewed commit rather than a moving branch:

- [`leafTransforms`, visibility, lighting, and playback state](https://github.com/LayoutitStudio/polycss/blob/6ac5eadde94361e34dbcd3b678a4a95560780e01/packages/domformat/src/state/polycss.js#L398-L528)
- [`applyRow()`, dirty-set `seek()`, and publication](https://github.com/LayoutitStudio/polycss/blob/6ac5eadde94361e34dbcd3b678a4a95560780e01/packages/domformat/src/state/polycss.js#L530-L666)
- [browser lifecycle and scheduler](https://github.com/LayoutitStudio/polycss/blob/6ac5eadde94361e34dbcd3b678a4a95560780e01/packages/domformat/src/browser.js#L450-L624)
- [normative prepared-playback codec](https://github.com/LayoutitStudio/polycss/blob/6ac5eadde94361e34dbcd3b678a4a95560780e01/packages/domformat/spec/codecs/polycss-playback-0.md)
- [normative retained-DOM lifecycle](https://github.com/LayoutitStudio/polycss/blob/6ac5eadde94361e34dbcd3b678a4a95560780e01/packages/domformat/spec/polycss-3d-0.md)

Important existing seams:

- `leafTransforms` is already the canonical logical transform-index array.
- `visible`, `forced`, and `degenerate` already compose paint visibility independently from transforms.
- `writeVisibility()` is already the single visibility publication point.
- `applyRow()` already separates logical mutation from optional publication.
- `seek()` already accumulates dirty shapes/leaves and publishes once in deterministic index order.
- the externally returned runtime intentionally has a closed API: lifecycle, mode, source frame, seek, mode change, and destroy.
- automatic catch-up currently loops and publishes every due tick; this is a distinct, unmeasured optimization opportunity.

The follow-up should extend these seams. It should not create a second manager beside them.

## Renderer lineage and applicability matrix

The status column is the current PolyCSS decision, not a judgment on the historical technique.

| Era / source | Technique | Problem it solved | Transferable PolyCSS principle | Current status |
| --- | --- | --- | --- | --- |
| 1963, Sketchpad | Retained display file, instances, hierarchy | Interactive editing without reconstructing the picture description | Stable identity and logical state separate from display refresh | Adopted |
| 1969–1974, Warnock/Watkins/Sutherland survey | Area subdivision, scanline coherence, hidden-surface taxonomy | Reduce per-pixel visibility work | Classify the cost before selecting machinery | Reference only |
| 1974, Catmull | Subdivision, z-buffered raster images, texture mapping | Curved surfaces and per-pixel visibility/appearance | Prepare paint resources and use a universal primitive | Atlas preparation adopted; z-buffer browser-owned |
| 1976, Clark | Hierarchical geometric models | Bound work by visible complexity and share transforms | Put rigid motion and conservative culling on retained ancestors | Adopted; no extra Mario hierarchy found |
| 1980, Fuchs/Kedem/Naylor | BSP visibility ordering | Precompute static spatial relations to reduce runtime visibility work | Spend preparation on visibility and deterministic ordering | Adopted in world/PVS work; frame schedule analogue in Mario |
| 1987, Reyes | Micropolygons, buckets, coordinate-local work, texture locality | Render complex scenes with bounded working sets | Normalize to a common leaf contract and prepare locality | Preparation principle adopted; runtime buckets rejected |
| 1991, Teller/Séquin | Visibility preprocessing / PVS | Bound interactive walkthrough visibility in static environments | Precompute conservative visible sets and cheap transitions | Adopted conceptually |
| 1993, Doom | BSP front-to-back traversal and clipped wall spans | Fast world visibility and rasterization on CPUs | Reject unseen structure early; exploit screen coherence | Visibility principle adopted; spans rejected |
| 1993, hierarchical Z | Object hierarchy plus image-space depth hierarchy | Reject occluded geometry and exploit temporal coherence | Coarse conservative visibility plus coherence | Prepare-side candidate only |
| 1996, Quake | PVS, edge/span rasterizer, surface cache | Reduce world traversal, pixel work, and repeated lightmapped shading | Prepared visibility plus paint-ready surface cache | Cache/PVS adopted; span path rejected |
| 1996, SM64/N64 | Scene graph, matrix stack, display lists | Separate object traversal from geometry/raster commands | Stable shape hierarchy and compiled leaf state | Adopted; hierarchy headroom falsified |
| 1996, progressive meshes | Continuous LOD and progressive transmission | Reduce triangle count under an appearance error budget | Historical contrast only; no runtime analogue transfers | Excluded by the PolyCSS product contract |
| Win32 retained painting | Accumulated invalid regions | Coalesce repeated repaint demand until a paint boundary | Dirty logical target sets and final-state publication | Adopted in `seek()`; extended by hidden-dirty candidate |
| OpenGL display lists | Store commands for repeated execution | Remove repeated command construction and validation | Compile immutable prepared streams once | Adopted |
| MAME `poly_manager` | Deferred primitives, state snapshots, ordered parallel spans, waits | Faithful asynchronous software rasterization | Snapshot mutable state and fence stale work | Narrow principles adopted; generic manager falsified |
| Browser rendering pipeline | Deferred style, layout, paint, and compositing | Turn DOM/CSS state into presented pixels | Treat browser rendering as the existing commit boundary | Adopted architecture |
| Web Animations | User-agent-owned timing and property sampling | Move animation execution out of application callbacks | Possible compositor-owned prepared playback | Open high-risk experiment |
| CSS Typed OM | Typed CSS values without repeated string parsing | Reduce parse/serialize overhead | Preparse transform values if support/memory win is proven | Open low-priority experiment |

## Detailed field guide

### Retained display structures: Sketchpad

**Primary source:** Ivan Sutherland, [*Sketchpad: A Man-Machine Graphical Communication System*](https://archive.computerhistory.org/resources/access/text/2017/03/102726907-05-01-acc.pdf), 1963.

**Mechanism:** Sketchpad retained picture structure, instances, constraints, and references so the system could edit and redisplay a logical drawing rather than treat every refresh as a new anonymous stream.

**Transfer:** Stable identity and logical state are more fundamental to PolyCSS than any later triangle rasterizer. DOMFormat's fixed tree, binding table, and current state arrays are the direct architectural descendants.

**Decision:** Adopted. Any proposal that rebuilds Mario's topology per frame moves backward relative to this lineage.

**Revisit gate:** None under the current product contract. Stable identity is an invariant, not an optimization toggle.

### Hierarchical models and matrix stacks: Clark and SM64

**Primary sources:** James Clark, [*Hierarchical Geometric Models for Visible Surface Algorithms*](https://doi.org/10.1145/360349.360354), 1976; community decompilation of [SM64 graph-node rendering](https://github.com/n64decomp/sm64/blob/master/src/game/rendering_graph_node.c).

**Mechanism:** A model hierarchy shares placement, motion, visibility tests, and sometimes detail selection across descendants. The SM64 code traverses graph nodes, pushes/multiplies matrices, culls objects, and appends display lists.

**Transfer:** A transform on one retained ancestor replaces many descendant publications only when those descendants share the same exact affine sequence.

**Mario evidence:** At tolerances `1e-6`, `1e-4`, and `1e-3`, 364 unchanged leaves form three groups of 200, 82, and 82 and already produce no leaf-change rows. Every one of the 849 animated leaves has a unique affine-delta sequence. There is no additional persistent rigid group to extract beyond the current six shape roots.

**Decision:** The principle is adopted; further Mario hierarchy is falsified.

**Revisit gate:** A different prepared model must show a repeated exact transform sequence across enough leaves to repay another wrapper and preserve interaction ownership.

### Display lists and compiled command streams: OpenGL and N64-style playback

**Normative source:** [OpenGL 1.1 specification](https://registry.khronos.org/OpenGL/specs/gl/glspec11.pdf), section 5.4.

**Mechanism:** Commands are compiled once and executed repeatedly. This avoids rebuilding the command description and gives execution a stable, validated input.

**Transfer:** DOMFormat's directly indexed `frameRows`, sparse change tables, grouped transform streams, and fixed target arrays are already a display-list architecture.

**Decision:** Adopted. A second submission/replay queue is redundant unless it can remove work before the existing logical interpreter.

**Revisit gate:** Demonstrate multiple logical producers writing the same target/property within one application frame, or demonstrate expensive command construction that is not already prepared.

### Scanline, edge, and span rasterizers: Watkins, Doom, Quake, MAME

**Primary sources:** Sutherland, Sproull, and Schumacker, [*A Characterization of Ten Hidden-Surface Algorithms*](https://doi.org/10.1145/356625.356626), 1974; id Software's released [Doom BSP renderer](https://github.com/id-Software/DOOM/blob/master/linuxdoom-1.10/r_bsp.c); Quake's [edge scanner](https://github.com/id-Software/Quake/blob/master/WinQuake/r_edge.c); MAME's current [`poly_manager`](https://github.com/mamedev/mame/blob/6da3195803ecb61165629230dad3fd8893c2b89f/src/devices/video/poly.h).

**Mechanism:** Transform polygons into coherent horizontal extents, interpolate attributes incrementally, and touch contiguous framebuffer memory. MAME additionally assigns ordered scanline buckets to workers.

**Transfer:** The transferable lesson is to choose a work unit natural to the output owner. For a CPU framebuffer, that unit is often a span. For retained DOM, it is a stable leaf or ancestor state field.

**Decision:** Raster machinery rejected. PolyCSS does not own framebuffer rows, and Canvas or a custom pixel buffer would be a different renderer.

**Revisit gate:** Only if the product explicitly changes to own a framebuffer. Performance evidence inside retained DOM cannot justify this by itself.

### Z-buffering and painter/order-table approaches

**Primary source:** Edwin Catmull, [*A Subdivision Algorithm for Computer Display of Curved Surfaces*](https://collections.lib.utah.edu/details?id=104071), 1974.

**Mechanism:** Z-buffering resolves visibility per sample; painter and ordering approaches resolve enough relative depth before rasterization to draw back-to-front or front-to-back.

**Transfer:** PolyCSS may prepare conservative whole-leaf visibility or stable ordering, but the browser remains responsible for sample-level depth and compositing.

**Decision:** Browser-owned. A JavaScript z-buffer is useful as an offline oracle or prepare-time visibility analyzer, not a runtime render target.

**Revisit gate:** A preparation problem needs a stronger exact visibility oracle, or a new browser primitive exposes coarse occlusion without pixel ownership.

### BSP and potentially visible sets

**Primary sources:** Fuchs, Kedem, and Naylor, [*On Visible Surface Generation by A Priori Tree Structures*](https://doi.org/10.1145/965105.807481), 1980; Teller and Séquin, [*Visibility Preprocessing for Interactive Walkthroughs*](https://people.csail.mit.edu/teller/pubs/siggraph91.pdf), 1991; Quake's released [BSP traversal](https://github.com/id-Software/Quake/blob/master/WinQuake/r_bsp.c).

**Mechanism:** Spend offline work to encode stable spatial relationships or conservative visibility sets, then make runtime traversal or selection cheap.

**Transfer:** This is one of PolyCSS's strongest matches because preparation is preferred over runtime ownership. PolyCSS World uses the spatial form; Mario's per-frame visibility schedule is the animation form.

**Decision:** Adopted as a preparation pattern. Do not confuse conservative candidate visibility with a mandate to toggle every mathematically hidden leaf.

**Revisit gate:** Improve the cost function or transition encoding, not the conceptual architecture.

### Hierarchical Z and temporal occlusion coherence

**Primary sources:** Greene, Kass, and Miller, [*Hierarchical Z-Buffer Visibility*](https://www.cs.princeton.edu/courses/archive/spring01/cs598b/papers/greene93.pdf), 1993; Bittner et al., [*Coherent Hierarchical Culling*](https://doi.org/10.1111/j.1467-8659.2004.00793.x), 2004.

**Mechanism:** Reject groups against coarse visibility data and reuse prior visibility to order or avoid expensive tests. The critical ideas are hierarchy, conservatism, and temporal coherence—not the literal depth pyramid.

**Transfer:** Prepare a conservative frontmost-leaf audit; group or schedule only when the saved transform, lighting, and paint work exceeds the visibility-transition cost.

**Mario evidence:** The raw mathematical audit hides 35.29% of leaves on average; the retained schedule hides 30.68%. Taking every raw result creates p95 124, p99 417, and maximum 821 visibility transitions in one frame, yet saves only another 2.54% of modeled property publications after hidden-dirty transforms.

**Decision:** Current schedule is directionally correct. A cost-aware rescore is open; raw per-frame visibility is rejected.

**Revisit gate:** A prepare-side optimizer must enforce a transition budget and beat the current total publication model, not merely maximize hidden count.

### Surface caches and baked shading: Quake

**Primary source:** Quake's released [`D_CacheSurface`](https://github.com/id-Software/Quake/blob/master/WinQuake/d_surf.c#L261-L350) and surrounding surface renderer.

**Mechanism:** Cache paint-ready surface results so stable texture/light combinations are not recomputed for every presentation.

**Transfer:** PolyCSS's prepared atlases and Mario's per-face lighting-state positions already apply the principle. Runtime selects a prepared state rather than rerasterizing lighting.

**Decision:** Adopted. Optimize state selection and atlas locality; do not add runtime shading work that preparation can eliminate.

**Revisit gate:** Trace evidence shows atlas selection or browser sampling, rather than publication or compositing, is dominant.

### Buckets, tiles, micropolygons, and locality: Reyes

**Primary source:** Cook, Carpenter, and Catmull, [*The Reyes Image Rendering Architecture*](https://graphics.pixar.com/library/Reyes/paper.pdf), 1987.

**Mechanism:** Convert diverse geometry to a common micropolygon representation, perform each calculation in a natural coordinate system, and bucket work to exploit geometry and texture locality with a bounded working set.

**Transfer:** PolyCSS likewise normalizes diverse inputs into renderable leaves and prepares paint resources in local coordinates. Asset preparation, atlas packing, and canonical primitives are the useful descendants.

**Decision:** Preparation/locality principle adopted. Screen-bucket DOM ownership is rejected because reparenting stable leaves by tile does not reduce leaf count and disrupts hierarchy and identity.

**Revisit gate:** A browser API exposes a stable grouping primitive that materially reduces paint/compositor work without DOM reparenting or changed transforms.

### Dirty regions and accumulated invalidation

**Maintainer source:** Microsoft, [*Invalidating and Validating the Update Region*](https://learn.microsoft.com/en-us/windows/win32/gdi/invalidating-and-validating-the-update-region).

**Mechanism:** Invalid regions accumulate while other messages run and are processed together at a later paint boundary. Repeated damage does not require immediate piecemeal repaint.

**Transfer:** Accumulate logical dirty leaf indices and publish the latest state at a defined boundary. DOMFormat `seek()` already does this for nonsequential traversal. Visibility-coherent publication extends it across hidden time.

**Decision:** Adopted and the basis of the next DOMFormat follow-up.

**Revisit gate:** New state channels should join the logical dirty model only after showing repeated hidden or intermediate publications.

### Asynchronous queues, immutable state snapshots, and waits: MAME

**Maintainer sources:** MAME's [software 3D rendering documentation](https://docs.mamedev.org/techspecs/poly_manager.html) and exact current [`poly_manager` source](https://github.com/mamedev/mame/blob/6da3195803ecb61165629230dad3fd8893c2b89f/src/devices/video/poly.h).

**Mechanism:** Submitted primitives capture immutable object state, become ordered scanline work, execute asynchronously, and synchronize through explicit `wait()` barriers before presentation, framebuffer reads, mutable resource reuse, or dependent rendering.

**Transfer:** Snapshot mutable inputs before asynchronous work, attach a generation to cancellable preparation, and define explicit read/commit barriers.

**Mario evidence:** Normal prepared playback has no asynchronous render work and no same-property overwrites. A central queue added map allocation/traversal and increased script cost. MAME's state and synchronization principles survive; its queue does not.

**Decision:** Narrow principles adopted. Generic scene submission manager rejected.

**Revisit gate:** A real asynchronous producer can otherwise commit stale state, or multiple due logical frames demonstrably publish redundant intermediate DOM state.

### Excluded techniques: LOD, progressive meshes, and impostors

**Primary sources:** Clark's hierarchical-model paper above; Hugues Hoppe, [*Progressive Meshes*](https://www.microsoft.com/en-us/research/publication/progressive-meshes/), 1996.

**Mechanism:** Replace or refine geometry under an appearance/error budget, sometimes with smooth transitions. Impostors replace geometry with prepared imagery.

**PolyCSS boundary:** None of these representation-switching mechanisms transfer. PolyCSS retains one selected polygon representation; it does not exchange that representation according to view, time, or load.

**Mario evidence:** Exact shared-edge merging has little headroom: of 1,784 same-shape shared-edge pairs, 33 are exactly coplanar/same-normal and 12 of those are static. A one-source-unit tolerance finds 44 pairs, 20 static. The absolute merge ceiling is below 3% before animation, material, atlas, seam, and identity constraints.

**Decision:** Excluded, not queued. Progressive refinement and runtime/view-dependent LOD violate the one-representation retained-DOM contract. Full-frame impostors additionally discard polygon identity and source-space interaction. Do not reopen these as PolyCSS performance proposals.

**Revisit gate:** None. This entry is retained only so the excluded technique is recognized instead of rediscovered.

### Browser rendering and compositor ownership

**Maintainer sources:** Chromium's [rendering critical path](https://www.chromium.org/developers/the-rendering-critical-path/) and [GPU-accelerated compositing design](https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/).

**Mechanism:** DOM/CSS mutations feed deferred style, layout, paint, raster, and compositing phases. Stable transformed layers may be recomposited without repainting their contents.

**Transfer:** The browser rendering lifecycle is already the physical commit boundary. Avoid forced reads between writes, keep identities stable, minimize property invalidation, and trace the actual downstream phase.

**Decision:** Adopted. A JavaScript `commit()` call cannot replace or improve this boundary merely by grouping setters.

**Revisit gate:** Measurements show forced synchronous style/layout, multiple rendering updates per application tick, or a browser API with stronger atomic publication semantics.

### User-agent animation and typed CSS values

**Normative sources:** [Web Animations Level 1](https://www.w3.org/TR/web-animations-1/) and [CSS Typed OM Level 1](https://www.w3.org/TR/css-typed-om-1/).

**Mechanism:** Web Animations lets the user agent own timing and property sampling after setup. Typed OM represents CSS values as objects to avoid some repeated string construction and parsing.

**Transfer:** A prepared animation might be installed once and sampled by the browser; exact transform values might be parsed once and reused.

**Mario constraint:** The obvious WAAPI translation is roughly 849 independent animated leaves and 551,808 transform keyframes, before lighting, visibility, seeking, interaction overrides, memory, and layer promotion. Typed OM would require hundreds of thousands of stored values or a smaller reusable structure, and browser support remains a constraint.

**Decision:** Separate high-risk labs, not the next PR.

**Revisit gate:** Measure startup parse time, retained memory, layer count, seek/interaction behavior, exact frame parity, script/style/paint/compositor time, and total package size. Abort if setup or retained memory merely moves the bottleneck.

## Local experiment ledger

These conclusions apply to the exact Mario CodePen workload substituted onto PolyCSS `v0.2.11`. They are stronger than analogy because they were measured, but they are not universal claims about every PolyCSS scene.

The SR identifiers below are permanent and match the sequential register. SR-10 appears here only as preflight opportunity counting; it has not been unlocked or executed.

### Evidence provenance

| Artifact | Value |
| --- | --- |
| Consumer | `/Users/ekrof/fed/cssGraphics/.local/codepen-mario-release-doze2/codepen` |
| Model SHA-256 | `3085601d5e6aa6d1a7e3ccc2fbcb01739df5e0b12c4d52c2058937323c46690c` |
| Consumer animation runtime SHA-256 | `25d967f3c4d0d98574938858dd5ae12bfa47d96471c0fb38469b766d305093ec` |
| Consumer scene runtime SHA-256 | `bf3693a35c38bd7f1c8708431d5ef695cfa595e361fee076d92c3dd8c62a2566` |
| PolyCSS commit | `8992048d3a8be738a1061af63531e58bed80fa08` |
| Vendored PolyCSS build SHA-256 | `876930089e790a4a3b831c5fb3a890d4a5aca35c1b0ca88a4385b080b0613079` |
| Vendored core build SHA-256 | `ccb5520752279660e16ba88b9264f59347ba8fc645ee5128130c2190a446812d` |
| Browser viewport | 800 x 600 |

The export originally pinned PolyCSS `0.2.10`. Only its import map was redirected to an exact local `0.2.11` build. Model bytes, topology, animation/runtime logic, effects, interaction, and presentation were retained.

### SR-01 — Centralized frame submission

**Hypothesis:** Queue every style write for one logical source tick, use final value per element/property, then commit once.

**Result:** Falsified for normal Mario playback.

| Scenario | Variant | Style attempts | Commits | Coalesced overwrites | Final no-ops | Tick p50 | Tick p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 180 animation ticks | Immediate | 182,564 | 182,564 | 0 | 0 | 2.40 ms | 3.10 ms |
| 180 animation ticks | Deferred | 182,564 | 181,490 | 0 | 1,074 | 4.10 ms | 4.90 ms |
| Nose interaction | Immediate | 15,227 | 15,227 | 0 | 0 | 1.00 ms | 1.78 ms |
| Nose interaction | Deferred | 15,227 | 10,906 | 0 | 4,321 | 1.40 ms | 1.99 ms |

The 4,321 interaction no-ops were visibility assignments. Four local equality guards removed the same writes without a queue. The manager increased script cost in normal traces while style lifecycle counts remained nearly identical, confirming that the browser already deferred physical rendering.

**Do not retry as:** `scene.batch()`, generic frame manager, generic renderer abstraction, DOM worker queue, or primitive submission API.

**Can be reopened as:** a lag/catch-up final-state experiment only, because DOMFormat's scheduler may advance multiple due ticks in one animation callback.

### SR-02 — Visibility-coherent transform publication prototype

**Hypothesis:** A hidden leaf needs current logical state but not every intermediate physical `style.transform`; publish the newest transform immediately before reveal.

**Result:** Supported as an internal prepared-playback optimization.

#### Complete-loop opportunity

| Metric | Value |
| --- | ---: |
| Mean hidden leaves | 372.19 / 1,213 (30.68%) |
| Median hidden leaves | 358 |
| p95 hidden leaves | 554 |
| Minimum / maximum hidden leaves | 67 / 621 |
| Total transform changes | 551,808 |
| Changes targeting currently hidden leaves | 93,742 (16.99%) |
| Reveal flushes required | 406 |
| Modeled transform-write reduction | 16.91% |

#### Deterministic 180-tick benchmark

Six alternating manual-clock runs produced:

| Metric | Baseline | Hidden-dirty candidate | Delta |
| --- | ---: | ---: | ---: |
| Total committed style writes | 182,564 | 161,654 | -20,910 (-11.45%) |
| Transform writes | 129,372 | 108,462 | -20,910 (-16.16%) |
| Wall median | 434.65 ms | 372.80 ms | -14.23% |
| Tick p50 | 2.50 ms | 2.10 ms | -16.00% |
| Tick p95 | 3.00 ms | 2.60 ms | -13.33% |
| Tick p99 | 3.20 ms | 2.90 ms | -9.38% |

Baseline and candidate screenshots were byte-identical with SHA-256 `8f1438be05cbf040165c30f4e015c3c307ed79ddd6fb1a0fe3c9e730684afd63`.

#### Complete-loop semantic proof

All 820 frames were compared by visible leaf style state:

- frames with a visible mismatch: 0;
- visible style mismatches: 0;
- hidden leaves with intentionally stale physical transforms after the last frame: 187.

The last value is the semantic cost. Paint is exact, but raw DOM is no longer a canonical complete state snapshot until a synchronization barrier flushes hidden leaves.

#### Interaction proof

Nose drag/release retained all node identities and produced zero pixel mismatches. The candidate performed 15,252 property writes versus 15,227 baseline writes because 25 hidden dirty leaves flushed on reveal. Eighty final style differences were all on hidden leaves and none affected paint.

This is not an interaction optimization. Automatic noninteractive playback is the profitable path; interaction entry must be a synchronization barrier.

#### Normal-scheduler Chrome trace

The repository's Chrome-trace workflow captured one warmed normal-loop trace per variant:

| Metric | Baseline | Hidden-dirty candidate | Delta |
| --- | ---: | ---: | ---: |
| Frame p50 | 41.700 ms | 41.600 ms | -0.100 ms |
| Frame p95 | 74.995 ms | 75.065 ms | +0.070 ms |
| Frame p99 | 84.844 ms | 83.052 ms | -1.792 ms |
| Script/frame | 4.2524 ms | 3.6305 ms | -14.6% |
| Style/frame | 1.1237 ms | 1.0202 ms | -9.2% |
| Main compositor/frame | 12.3396 ms | 11.2811 ms | -8.6% |
| Paint/frame | 1.0034 ms | 0.9498 ms | -5.3% |
| Layout/frame | 0 | 0 | unchanged |

Headless Chromium used a software drawing path and this was a single trace pair. The durable claim is reduced setters plus lower script/style work. There is no demonstrated p95 frame-time improvement.

### SR-03 — Additional rigid hierarchy / matrix palette

**Hypothesis:** More leaves might share a motion sequence and move under another retained parent.

**Result:** Falsified for this Mario package.

- 364 unchanged leaves form exactly three groups and are already absent from the delta stream.
- all 849 animated leaves have unique affine-delta sequences at three tested tolerances.
- new wrappers would add DOM and ownership complexity without removing animated publications.

### SR-04 — Transform component decomposition

**Hypothesis:** Publish translation separately from the transform basis, or place them on nested nodes.

**Result:** Falsified.

- only translation changed in 3,394 of 551,808 changes (0.615%);
- only the basis changed in 4 changes;
- most changes modified seven to twelve of the twelve affine components;
- 121,291 changes modified all twelve components.

The motion does not contain the separability needed to repay more properties or nodes. Exact affine `basis[9] + translation[3]` remains the correct unit; TRS reconstruction is not exact for real deformed leaves.

### SR-05 — Exact polygon merging

**Hypothesis:** Merge animated triangle pairs to reduce DOM count.

**Result:** Falsified under exactness.

- same-shape shared-edge pairs: 1,784;
- exactly coplanar/same-normal pairs: 33, of which 12 are static;
- within one source unit: 44, of which 20 are static;
- theoretical reduction ceiling: below 3% before compatibility checks.

### SR-06 — Maximum raw visibility

**Hypothesis:** Apply every mathematically hidden frame/leaf result.

**Result:** Falsified as a publication policy.

| Schedule | Mean hidden | Modeled total property work with hidden-dirty |
| --- | ---: | ---: |
| All visible | 0 | 702,735 |
| Current retained schedule | 372.19 | 626,260 |
| Raw mathematical schedule | 428.05 | 610,382 |

Raw visibility saves 2.54% beyond the current schedule but causes severe transition bursts: mean 43 changes/frame, p95 124, p99 417, maximum 821. The current schedule correctly spends some overdraw to avoid DOM churn.

### SR-10 preflight — One record write per dirty leaf

**Hypothesis:** Combine transform, lighting, and visibility changes for one leaf into one publication.

**Status:** Opportunity counted only. The actual experiment remains locked behind SR-09 because upstream publication and visibility decisions change its baseline.

Across all 820 frames:

- property mutations: 718,637;
- unique dirty leaf/frame records: 599,879;
- theoretical setter reduction: 16.53%;
- transform plus lighting overlaps: 108,189;
- transform plus visibility overlaps: 6,958;
- visibility plus lighting overlaps: 7,097;
- all three overlap: 3,486.

`style.cssText` may be slower because it reparses and replaces a whole declaration. Do not implement from the theoretical count; prototype it against individual setters and inspect style/paint traces.

## Rejection ledger

This table is the quick stop sign. Do not reopen these directions without satisfying the stated gate.

| Direction | Why it is currently rejected | Reopen only when |
| --- | --- | --- |
| Public `scene.batch()` | No measured coalescing in Mario; browser already supplies physical rendering boundary | Real callers show same-target overwrites or repeated scene-wide recomputation in one frame |
| Generic submission manager | Added allocation/traversal and script cost | It removes upstream work, not merely delays setters |
| Worker DOM mutation | Workers cannot directly own the live DOM; messaging adds another boundary | Browser platform changes or work is pure preparation with transferable results |
| Canvas/WebGL/WebGPU fallback | Changes the renderer and product identity | Product scope explicitly changes |
| Scanline/span rasterizer | PolyCSS does not own pixels | Product adopts a framebuffer |
| Screen-tile DOM buckets | Does not reduce leaf count; breaks stable hierarchy | Stable browser grouping primitive proves a win |
| More Mario shape wrappers | Every animated leaf sequence is unique | A new model shows large repeated exact clusters |
| Translation/basis split | Almost all changes touch both | A new animation corpus shows strong component sparsity |
| Exact Mario merging | Less than 3% upper bound | Different topology or authorized approximation changes the ceiling |
| Raw maximum culling | Transition bursts dominate marginal savings | Cost-aware bounded schedule beats current total work |
| LOD, progressive meshes, or impostors | Runtime representation switching violates the PolyCSS contract; impostors also lose polygon identity and interaction | Do not reopen as a PolyCSS optimization |
| Per-frame runtime lighting rasterization | Prepared surface cache already owns it | Live lighting becomes a required exact behavior and cannot use CSS |
| WAAPI in the main PR | Huge keyframe/layer/memory uncertainty | Separate lab passes startup, memory, parity, interaction, and trace gates |
| Typed OM in the main PR | Support and memory benefit unproven | Separate lab shows lower parse/publication cost without larger retained state |

## DOMFormat follow-up commit

### Commit identity

Conventional subject:

```text
perf(domformat): defer hidden playback transforms
```

This is the implemented follow-up on PR #81, not a new renderer feature and not
a public batching API.

### Scope

The commit should change only the prepared-playback interpreter, its normative publication semantics, independent implementations, focused fixtures/tests, and measured evidence.

It should not change:

- the `domformat@0` document shape;
- packed codec bytes or transform encoding;
- public runtime keys;
- PolyCSS core or renderer APIs;
- React/Vue surfaces;
- topology or leaf identity;
- atlas generation;
- interaction mathematics;
- the scheduler's catch-up policy;
- Gallery corpus bytes unless a test fixture needs regeneration for an unrelated reason.

### State model

Reuse the existing canonical logical state:

```js
const leafTransforms = new Uint32Array(packet.leafCount);
const dirtyHiddenTransforms = new Uint8Array(packet.leafCount);
```

`leafTransforms[index]` remains authoritative for the current source frame. The DOM inline style becomes a publication cache that is guaranteed current for paint-visible leaves and may lag only for hidden leaves during automatic animation.

Internal helpers should express the contract directly:

```js
const isPaintVisible = (index) =>
  (visible[index] === 1 || forced[index] === 1) && degenerate[index] === 0;

const publishPreparedLeafTransform = (index) => {
  if (dirtyHiddenTransforms[index] === 0) return;
  leaves[index].style.transform = packet.transforms[leafTransforms[index]];
  dirtyHiddenTransforms[index] = 0;
};

const publishOrDeferPreparedLeafTransform = (index) => {
  if (isPaintVisible(index)) {
    leaves[index].style.transform = packet.transforms[leafTransforms[index]];
    dirtyHiddenTransforms[index] = 0;
  } else {
    dirtyHiddenTransforms[index] = 1;
  }
};
```

Exact helper names may differ. The invariants may not.

### Required invariants

1. **Logical exactness:** `leafTransforms` always describes the current logical source frame, visible or hidden.
2. **Paint exactness:** before a leaf can become paint-visible, its latest prepared transform is physically published.
3. **Ordering:** a reveal flush happens before `visibility: visible` is assigned.
4. **Latest wins:** any number of hidden transform changes collapse deterministically to the last logical transform.
5. **Stable identity:** no shape or leaf is replaced, reparented, inserted, or removed.
6. **Public synchronization:** `runtime.seek(frame)` is a full state barrier, including when `frame === runtime.sourceFrame`.
7. **Interaction synchronization:** animation-to-interaction mode entry flushes every dirty prepared transform before interaction publication begins.
8. **No dirty interaction state:** interaction transforms continue to publish synchronously; this optimization is not used to defer them.
9. **Restart exactness:** interaction restore and restart leave the prepared state physically canonical.
10. **Initial exactness:** initial publication writes every transform exactly as before.
11. **No new scheduling:** the caller/browser scheduler remains unchanged in this commit.
12. **Failure behavior:** no new asynchronous path, promise, cancellation state, or partial lifecycle state is introduced.

### Operation semantics

| Operation | Logical update | Physical publication |
| --- | --- | --- |
| Initial mount | Load every shape/leaf state | Publish every shape/leaf, then surface and appearance |
| Sequential automatic animation row | Update every referenced `leafTransforms` entry | Publish visible entries; mark hidden entries dirty |
| Automatic nonsequential timeline jump | Simulate all rows into logical arrays | Publish final visible dirty targets; keep hidden dirty |
| Visibility changes hidden -> visible | Update visibility bit | Flush latest prepared transform, then reveal |
| Visibility changes visible -> hidden | Update visibility bit | Existing conservative ordering may publish that row's transform before hiding |
| Forced visibility | Update forced set | Flush latest prepared transform before newly forced reveal |
| Public `seek(target)` | Simulate to target | Publish final dirty targets and flush all hidden dirty transforms before returning |
| Public `seek(currentFrame)` | No frame simulation | Flush all hidden dirty transforms before returning |
| Enter interaction mode | Seek/synchronize to interaction initial frame | Begin interaction only after no hidden prepared dirt remains |
| Interaction leaf update | Update interaction state | Publish synchronously as today |
| Restore/restart | Restore canonical prepared arrays | Publish restored target transforms and clear their dirty bits |
| Destroy | No new logical state | No flush required; cleanup remains idempotent |

The same-frame `seek()` rule gives snapshot/export callers a synchronization mechanism without adding a public `flush()` method:

```js
runtime.seek(runtime.sourceFrame);
```

After it returns, hidden and visible inline transforms are canonical for the current logical frame.

### Interpreter shape

Do not overload the public API with a `deferHidden` option. Keep the distinction internal:

- automatic `advance()` may use a non-synchronizing internal seek for timeline jumps;
- externally callable `seek()` synchronizes hidden transforms;
- mode changes and restart already cross `seek()` and therefore become barriers;
- `writeVisibility()` owns the pre-reveal flush.

This preserves existing synchronous behavior at explicit operations while optimizing only automatic invisible publication.

### Normative specification changes

Update `packages/domformat/spec/codecs/polycss-playback-0.md` in place:

- distinguish canonical logical transform state from the physical inline-style cache;
- require automatic playback to defer hidden leaf transforms and retain the latest index;
- require flush-before-reveal ordering;
- require public seek, including same-frame seek, to synchronize all transforms;
- state that interaction mode begins from synchronized prepared DOM;
- keep visible output, target order, and stable identity normative;
- avoid adding an optional optimization flag. One interpreter contract is easier to certify.

If `polycss-3d-0.md` currently implies that every hidden inline transform is canonical at every automatic tick, update that language rather than adding a compatibility mode.

### Code and conformance surfaces

At minimum, inspect and keep consistent:

- `packages/domformat/src/state/polycss.js`;
- `packages/domformat/src/browser.js` if the public/internal seek barrier needs an explicit call path;
- `packages/domformat/conformance/viewer/playback.js`;
- the independent N-version viewer if it implements playback publication separately;
- `packages/domformat/spec/codecs/polycss-playback-0.md`;
- `packages/domformat/spec/polycss-3d-0.md` if its lifecycle language is affected;
- browser, playback, interaction, lifecycle, conformance, and independent-viewer tests;
- release-package allowlists only if test/spec files alter the source tarball contract.

Because PR #81 treats independent implementations as evidence, changing only the main interpreter is incomplete even if unit tests pass.

### Focused test matrix

#### Logical and publication tests

- hidden leaf receives one transform change: logical index changes, DOM setter count stays zero, dirty bit is set;
- hidden leaf receives several changes: exactly the last transform publishes on reveal;
- dirty leaf reveals through prepared visibility: transform setter occurs before visible setter;
- dirty leaf becomes forced-visible: latest prepared transform publishes before reveal;
- visible leaf continues to publish synchronously;
- newly hidden leaf preserves current ordering and exact visible result;
- two hidden leaves flush in ascending deterministic target order at a barrier;
- hidden dirty transform equal to the already published string clears without a redundant assignment if equality guarding is retained.

#### Synchronization tests

- `seek(currentFrame)` flushes all hidden dirty leaves;
- `seek(otherFrame)` produces canonical physical state for every leaf before return;
- automatic nonsequential advance retains hidden dirt instead of accidentally using the public full barrier;
- animation -> interaction flushes before any interaction target becomes visible;
- interaction -> animation restart restores exact prepared transforms;
- forced and degenerate visibility composition cannot reveal stale prepared state;
- destroy remains idempotent with dirty leaves present.

#### Identity and parity tests

- shape and leaf object identities remain unchanged for the complete fixture loop;
- every visible leaf has the same transform, visibility, and lighting state as baseline after every frame;
- full serialized DOM is identical after a same-frame synchronization seek;
- browser screenshots remain within the existing exact/bounded corpus oracle;
- no extra nodes, style elements, object URLs, observers, or listeners are created.

#### Work tests

Use a synthetic fixture with long hidden runs and repeated hidden transform changes. Assert exact counts rather than timing:

- baseline-equivalent logical changes;
- fewer physical transform assignments;
- one reveal flush per dirty run, not one per hidden frame;
- no write reduction claim from interaction mode.

Keep the local Mario benchmark as representative external evidence without checking in proprietary inputs.

### Acceptance gates

SR-07 was allowed to close only when all of these held:

- zero visible-state mismatches over the complete Mario loop;
- zero Mario screenshot pixel mismatches over a numbered capture of the
  complete 820-frame loop, after an exact baseline A/A capture;
- stable node identity;
- same-frame public seek restores canonical full DOM state;
- interaction drag/release visual parity;
- deterministic transform-write reduction remains at least 10% on the 180-tick Mario benchmark;
- no regression in the package's independent conformance implementations;
- no meaningful script/style regression in a normal browser trace;
- `pnpm --filter @layoutit/polycss-domformat test:release` passes;
- `pnpm test && pnpm build` passes;
- `git diff --check` passes.

A flat traced p95 is acceptable if deterministic work is materially lower and
trace-phase movement stays within repeated-run variation. Do not claim an FPS
improvement unless repeated traces demonstrate one.

## Sequential experiment register

This is the canonical execution queue. Work proceeds from the first nonterminal row downward. At most one row may be `READY` or `ACTIVE`; every later row remains `LOCKED` because the predecessor changes its baseline or premise.

Current slot: **SR-09 is `READY`; every later experiment remains `LOCKED`.**

| ID | Experiment | Depends on | Status | Closure evidence or unlock condition | Unlocks |
| --- | --- | --- | --- | --- | --- |
| SR-01 | Centralized frame submission | Exact Mario baseline | FALSIFIED | Zero same-target/property overwrites; normal playback became slower | SR-02 |
| SR-02 | Visibility-coherent publication prototype | SR-01 terminal | SUPPORTED | 16.16% fewer transform writes; SR-07 later supplied exact pixel and integration proof | SR-03 |
| SR-03 | Additional rigid hierarchy | SR-02 terminal | FALSIFIED | All 849 animated leaves had unique transform sequences | SR-04 |
| SR-04 | Transform component decomposition | SR-03 terminal | FALSIFIED | Only 0.615% of changes were translation-only; affine bases are not exact TRS | SR-05 |
| SR-05 | Exact polygon merging | SR-04 terminal | FALSIFIED | Exact theoretical leaf reduction remained below 3% before compatibility costs | SR-06 |
| SR-06 | Maximum raw visibility | SR-05 terminal | FALSIFIED | Only 2.54% marginal work reduction with transition bursts up to 821 writes/frame | SR-07 |
| SR-07 | Integrate visibility-coherent publication in DOMFormat | SR-01 through SR-06 terminal | ADOPTED | 16.17% fewer transform writes; exact 820-frame animation and 44-frame interaction pixels; stable identity; canonical seek barrier; release gates green | SR-08 |
| SR-08 | Coalesce overdue-tick publication | SR-07 terminal and new baseline recorded | ADOPTED | Controlled catch-up style mutations/tick -63.30% and p95 -63.23%; exact 317-commit/820-tick pixels; stable identity | SR-09 |
| SR-09 | Re-score prepared visibility runs | SR-08 terminal and final publication costs recorded | READY | Minimize total work with a hard transition-burst bound; do not maximize hidden percentage | SR-10 |
| SR-10 | Publish one guarded record per dirty leaf | SR-09 terminal and overlap counts recomputed | LOCKED | Beat individual setters in deterministic work and browser traces without changing visible state or identity | SR-11 |
| SR-11 | Typed OM publication | SR-10 terminal and trace proves parsing/publication remains material | LOCKED | Beat the surviving publication path after startup, support, and retained-memory costs | SR-12 |
| SR-12 | WAAPI prepared-playback lab | SR-11 terminal and per-frame JS remains material | LOCKED | Preserve exact seek, visibility, lighting, interaction, identity, startup, memory, and trace behavior | End of current chain |

Status rules:

- IDs never change or get reused.
- `SUPPORTED` records a successful prototype when integration is a separate row. `ADOPTED`, `FALSIFIED`, `NOT APPLICABLE`, `OUT OF SCOPE`, and `CANCELLED` are other terminal decisions.
- Starting work changes the one `READY` row to `ACTIVE` and freezes its exact input hashes and baseline.
- Closing an experiment updates this table, its detailed ledger entry, measurements, parity evidence, and decision before the next row becomes `READY`.
- No row can close as `SUPPORTED` or `ADOPTED` without the numbered visual-parity evidence required above.
- A failed experiment may still unlock the next row if that next premise survives. If it does not, mark the affected rows `CANCELLED` and rewrite the chain before doing more work.
- Do not prototype a locked row in parallel. The point of the chain is to measure each idea against the architecture produced by the previous decision.
- LOD, progressive refinement, and impostors never enter this queue.

### SR-07 — Integrate visibility-coherent publication

- Owner: DOMFormat prepared-playback interpreter.
- Started: 2026-08-04.
- Closed: 2026-08-04.
- Decision: `ADOPTED`.
- Code baseline: DOMFormat PR #81 commit `6ac5eadde94361e34dbcd3b678a4a95560780e01`.
- Candidate main interpreter SHA-256: `f701ab0571f4989e65dcc1f436dfe770bd2f1d057e8f0c58818cf56adfe4c69a`.
- Candidate independent interpreter SHA-256: `e27058e5eb2ea92da9cdaa5cf577ca6d592a14b86414b55692904fca9b2872b6`.
- API: none.
- Schema: none.
- Product effect: less invisible DOM mutation during automatic playback.

Exact Mario input closure:

```text
source artifact  73e32d41a32f5d9a4c2fb4f14c2e317233e71cbec1a4865c6c0321a2337c53a2
meta.json         f384ef10561bbb4c22929f811ecfc2dbd0ccfa2d6fa57243861c53e454d6c0f9
tree.json         36122d677499bd895f99f3bcae2cdbd278f10fee77ce4acae3898c963b0737d9
state.json        cfabf9928b836c7f1dcd41143f7d6957ef0d4eb016a3c2976862d0b38b01df85
bindings.json     f15b930ca44531a85b6f6c6b5d93d7da4e466a050947a0709e7e60ad205cfbaf
css-binding.json  1bebbac5d2f110c4cfcb83864eb8a8f0062b623e75f979204c496f4baed1cc0d
resources.json    0a0e0a44a552b691aaf7f960540e34a34da729758be4682035551591a26579e5
background.webp   91491ade6907ef756512c673bcfacab1b7c1b6ca99739eed521eaf4e81733f7a
cursor.webp       bbfd045378fed692822c0426f4ef1042b7d3affd815682ad21b7ae15ca96cbab
effects.webp      98ecac8aafe4b7733ceb87fb96dcf49da5aa61238b0a4d6c2a09f4937c1eb71a
model-css.css     05e01a250febb982ed1e22a4206638478b5db4dbf4d3964a559c020dcd099253
texels.webp       cb3cbaedb6a0a6680652640210df470f48b4d92f1896a35e816851379b91f5ca
```

The local ignored evidence bundle is
`bench/results/sr-07-mario-2026-08-04/`. It uses 1,320 retained nodes, 1,213
playback leaves, 820 source frames, a 320x240 viewport, exact source-frame
stepping, and the baseline implementation loaded directly from the frozen
PR-head commit.

#### Deterministic work result

Six interleaved fresh-page repetitions of 180 ticks produced one exact count
per variant:

| Metric | Baseline | Candidate | Change |
| --- | ---: | ---: | ---: |
| All attempted style assignments | 181,269 | 160,471 | -20,798 (-11.47%) |
| Transform assignments | 128,592 | 107,794 | -20,798 (-16.17%) |
| Visibility assignments | 6,346 | 6,346 | 0 |
| Visible-state digest | `fd4d6780...ae22a` | `fd4d6780...ae22a` | exact |

The style proxy makes assignment counts authoritative but inflates the timing
benefit. Its wall-time p50 moved from 564.50 ms to 486.95 ms; that number is
supportive only and is not the browser-performance claim.

#### Browser trace result

Three order-balanced, fresh-page, instrumentation-free Chrome pairs used a
2,000 ms warmup and 5,000 ms action window. Medians across the three runs:

| Metric | Baseline | Candidate | Interpretation |
| --- | ---: | ---: | --- |
| Frame time p50 | 8.300 ms | 8.300 ms | flat |
| Frame time p95 | 8.800 ms | 9.000 ms | overlapping run ranges; no meaningful regression |
| Frame time p99 | 9.271 ms | 9.271 ms | flat |
| Script | 0.0615 ms/frame | 0.0516 ms/frame | lower, below frame-time resolution |
| Main-thread compositor | 0.1612 ms/frame | 0.1388 ms/frame | lower, below frame-time resolution |
| Pre-paint | 0.0051 ms/frame | 0.0045 ms/frame | effectively flat |
| Style / layout / paint / raster | 0 | 0 | unchanged |

This demonstrates no meaningful trace regression. It does not demonstrate an
FPS or frame-time improvement, and none is claimed.

#### State, identity, and pixel result

The first immediate-screenshot calibration exposed a particle-only baseline
A/A race around source frame 483. The evidence harness was corrected to wait
for two animation frames after publication so Chromium had crossed a browser
commit boundary; no product code or tolerance changed. The complete capture
was then repeated from scratch at an exact-zero threshold:

| Sequence | Frames | Baseline A/A | Candidate | Max channel delta | Changed pixels |
| --- | ---: | --- | --- | ---: | ---: |
| Animation | 820 | exact | exact | 0 | 0 |
| Pointer drag/release/settle | 44 | exact | exact | 0 | 0 |

All node identities remained stable in every frame. The complete visible-state
sequence digest was identical across both baselines and the candidate:
`5e6618143929f7519abee6109c98066dc08001eb6dcc1362a562f2e04c86ea39`.
The candidate's final hidden physical DOM intentionally differed before a
barrier, then `seek(sourceFrame)` restored the exact baseline full-DOM hash
`f45c2040cc88ced642f1db9b3a624906b9fcf6b14b5c9eeceddc0d44ddd3b07f`.

#### Conformance and decision

- Production and independent interpreters implement the same logical/physical
  split, deterministic target ordering, flush-before-reveal rule, and public
  same-frame seek barrier.
- The focused publication/independent matrix passed 21 tests.
- `pnpm --filter @layoutit/polycss-domformat test:release` passed 132 tests,
  Python/JavaScript conformance, real-Chrome zero-delta checks, and deterministic
  tarball validation.
- `pnpm test && pnpm build` passed across the monorepo.
- No nodes, topology, assets, atlas behavior, animation state, effects,
  lighting, visibility, interaction math, scheduler behavior, API, or schema
  changed. LOD remains excluded.

Decision: adopt the small internal publication cache. The deterministic work
reduction is above the frozen 10% gate, exact visual and semantic behavior is
proved, and browser cost did not meaningfully regress. Keep the performance
claim narrow: fewer transform assignments, not higher FPS.

### SR-08 — Coalesce overdue-tick publication

- Owner: DOMFormat browser scheduler plus state interpreters.
- Status: `ADOPTED`.
- Started: 2026-08-04.
- Closed: 2026-08-04.
- Code baseline: DOMFormat PR #81 plus SR-07 commit `debaa5f99eba0dbdbf41c8c0ea44483bfc64098d`.
- Workload: Mario prepared retained-DOM package, 1,320 package nodes, 1,213
  leaves, 820 source frames at 30 Hz.
- API and schema: unchanged.
- Decision: `ADOPTED` as an internal animation-backlog publication path.

#### Falsification premise

The frozen scheduler published inside its overdue-tick `while` loop. Repeated
ticks were not hypothetical: three paired normal-browser repetitions observed 6
multi-tick callbacks over 1,080 baseline callbacks; 6x CPU throttling observed
624 over 720; and an explicit 120 ms stall every 60 callbacks observed 20 over
1,082. This supported prototyping the narrow catch-up path. It did not reopen a
normal-frame submission layer: 99.44% of normal baseline callbacks still had at
most one due tick.

#### Adopted boundary

- Count due ticks before publication.
- Keep zero- and one-tick animation callbacks on the existing synchronous path.
- For multiple overdue animation ticks, evaluate every timeline tick and every
  distinct prepared-effects source-frame transition in order, accumulate dirty
  retained targets, and publish only final model, appearance, shape, leaf,
  surface, star, and particle state.
- Keep every overdue interaction tick separately stepped and published. Input,
  cursor, selection, grab, spring, and interaction effects are observable state,
  not discardable intermediate animation paint.
- Keep public `seek()` synchronous and retain the existing hidden-transform
  synchronization barrier. No public `advanceMany()`, `scene.batch()`, nested
  batch semantics, worker, backend, alternate primitive stream, or renderer
  abstraction was added.

The retained graph remains immutable after mount, so mesh removal and stale
asynchronous topology work do not enter this path. Errors still destroy the
mount transactionally. Dirty targets commit in stable numeric order, and no
node is replaced.

#### Measured work

Three alternating real-Chromium repetitions per variant used the production
mount scheduler. Counts are normalized per logical due tick because a faster
candidate can prevent its own lag feedback and therefore observe fewer total
overdue ticks.

| Scenario | Frozen baseline | Candidate | Result |
| --- | ---: | ---: | ---: |
| Normal style mutations / due tick | 873.237 | 872.154 | -0.12%; intentionally unchanged |
| Normal callback p95 median | 0.900 ms | 0.900 ms | no regression |
| 6x CPU style mutations / due tick | 961.815 | 469.143 | -51.22% |
| 6x CPU callback p95 median | 20.815 ms | 10.405 ms | -50.01% |
| Controlled-stall catch-up attempted writes / due tick | 998.288 | 365.367 | -63.40% |
| Controlled-stall catch-up style mutations / due tick | 988.055 | 362.582 | -63.30% |
| Controlled-stall catch-up p95 | 13.040 ms | 4.795 ms | -63.23% |

The controlled-stall catch-ups attempted 46,540 baseline transform writes and
15,778 candidate transform writes even though the candidate sample contained
more catch-up due ticks (79 versus 73). Across the whole controlled-stall run,
which is mostly zero- and one-tick callbacks, style mutations per tick fell
8.61%. The normal path is not claimed as a performance win.

Paired controlled-stall Chrome traces found no meaningful aggregate style,
layout, paint, raster, or scripting regression. The imposed stalls dominate
frame pacing, and repeated traces do not resolve an FPS gain; none is claimed.

#### Semantic and visual parity

- A deterministic callback pattern of 1-6 due ticks covered all 820 logical
  Mario ticks in 316 publication groups plus the initial state.
- All 317 baseline/candidate paint-state hashes matched, retained identity held
  for all 1,321 mounted nodes, and the numbered 320x240 frame oracle reported
  zero changed pixels, zero mean/RMS delta, and zero maximum channel delta.
- After an explicit same-frame seek, the only full-inline-style differences
  were `backgroundPositionY` on 84 computed-hidden leaves. No visible node
  differed, and every later reveal in the complete run matched. This is the
  existing visibility-coherent rule: hidden lighting paint may remain stale
  until it is visible; the public seek barrier canonically synchronizes hidden
  transforms.
- Reference and independent implementations passed focused tests proving
  batched playback state, final effects state, stable identities, explicit
  seek synchronization, and separate publication of every overdue interaction
  tick.
- `pnpm --filter @layoutit/polycss-domformat test:release` passed 137 tests,
  Python/JavaScript conformance, real-Chrome zero-delta checks, and deterministic
  tarball validation. `pnpm test`, `pnpm build`, and `git diff --check` passed
  across the monorepo.

Decision: adopt the smallest MAME-inspired submission seam that measurement
supports. Logical simulation and physical publication are separate during an
animation backlog only. The browser remains the one physical rendering commit
boundary, and a generic frame manager remains falsified for normal playback.

### SR-09 — Re-score prepared visibility runs

- Owner: Mario/cssGraphics preparation, not DOMFormat runtime.
- Current evidence: low-single-digit modeled headroom against the pre-SR-07 baseline.

Recompute the model after SR-07 and SR-08 close. Score each candidate hidden run with an objective resembling:

```text
saved transform publications
+ saved lighting publications
+ estimated saved paint/compositor work
- hide/reveal publication cost
- transition burst penalty
```

Enforce a strict maximum transition count per frame. Compare total property work, worst-frame transitions, full visual parity, and trace paint/compositor work. Do not optimize hidden percentage in isolation.

### SR-10 — Publish one guarded record per dirty leaf

- Owner: DOMFormat prepared-playback interpreter or an isolated harness until supported.
- Current evidence: a preflight theoretical ceiling of 16.53% fewer setter calls before upstream changes.

Recount transform, visibility, and lighting overlap against SR-09's final schedule. Compare current individual guarded setters with one explicit per-leaf publication record. Treat `style.cssText`, CSS custom properties, and direct setters as separate candidates rather than assuming one implementation represents the idea.

Use exact setter counts, full visible-state parity, stable identity, startup/memory measurements, and browser trace phases. A lower JavaScript call count alone does not pass.

### SR-11 — Typed OM publication

- Owner: isolated harness until support and benefit are proven.
- Current evidence: no measured benefit on the final publication shape.

Run only if SR-10's trace shows string construction or CSS parsing remains material. Compare the surviving direct/record path with Typed OM values under the same browser, startup, memory, state, pixel, and compatibility gates. Close as `NOT APPLICABLE` if support or retained object cost makes it unsuitable.

### SR-12 — WAAPI prepared-playback lab

- Owner: isolated experimental harness.
- Current evidence: open, high risk.

This is last because every earlier experiment can reduce or eliminate the JavaScript work it proposes to transfer to the user agent. Measure:

- setup and keyframe parsing time;
- retained JavaScript and browser memory;
- number of animations and composited layers;
- exact source-frame seeking;
- visibility and lighting synchronization;
- interaction override and restore;
- startup-to-first-paint;
- package bytes;
- script, style, paint, raster, and compositor trace groups.

Abort if the roughly 849 tracks / 551,808 transform keyframes merely move cost to startup, memory, or layer management.

### Separate PolyCSS work

Keep these outside the DOMFormat follow-up:

- generation fencing for stale chunked/asynchronous mesh rendering;
- nested shadow invalidation coalescing inside existing synchronous calls;
- centralization of the compact triangle-frame type in `core` if pursued;
- broad `createPolyScene` cleanup;
- any public batch surface.

They solve different ownership problems and should not make the DOMFormat commit harder to review.

## Performance investigation playbook

### 1. Freeze provenance

Record before changing code:

- repository and exact commit;
- package/model/runtime hashes;
- browser build and launch mode;
- viewport, device scale factor, headless/headful state, and CPU throttle;
- animation source cadence and scheduler mode;
- leaf, shape, frame, atlas, and effect counts;
- whether the browser uses hardware or software rasterization.

If input bytes change, old parity and timing evidence no longer proves the new run.

### 2. Classify the cost

Instrument separately:

- simulation/math;
- logical state changes;
- physical DOM attempts and committed setters by property;
- complete rerenders and topology changes;
- atlas generation/rasterization;
- visibility transitions;
- shadow/effect publication;
- style, layout, pre-paint, paint, raster, compositor, and GPU/viz trace groups;
- memory/startup when a technique preinstalls data.

Do not use FPS alone to choose an architecture.

### 3. Establish deterministic work evidence

Use a manual source clock where possible. Alternate baseline and candidate runs to reduce drift. Six repetitions is the current minimum convention for small deterministic timing comparisons; exact operation counts matter more than wall time.

Report median and tail tick time, not only the mean.

### 4. Prove state and identity

For every source frame or representative complete loop:

- compare visible transforms, visibility, lighting state, and relevant material state;
- retain references and prove every expected node is the same object;
- assert no child-list mutation during stable playback;
- distinguish logical state from physical publication state explicitly.

### 5. Prove pixels

Capture baseline, candidate, and absolute difference under the same browser/viewport. Record mismatch count and hashes. A preview is not parity proof; a black absolute diff plus exact source and environment provenance is.

### 6. Trace the normal loop

Use the repository's `chrome-trace` workflow with:

- warmup before measurement;
- identical interaction and wait windows;
- compact trace summaries retained with the report;
- raw traces kept outside Git when large;
- repeated captures before making a p95 claim.

Interpret a lower setter count as a work reduction, not automatically as a frame-time win.

### 7. Test semantic boundaries

At minimum:

- synchronous return behavior;
- thrown error timing;
- nested or reentrant calls;
- target removal and destruction;
- stale asynchronous completion;
- seek and restart;
- interaction entry/exit;
- hidden-to-visible transition;
- snapshot/export;
- stable node identity.

### 8. Write the decision, including rejection

Every active experiment must close with one of:

- **Adopted:** implemented and verified;
- **Supported:** prototype meets the measured acceptance criteria;
- **Falsified:** prototype or data contradicts the hypothesis;
- **Not applicable:** its required cost or platform condition is absent;
- **Out of scope:** requires a changed product boundary;
- **Cancelled:** an upstream decision invalidated its premise before execution.

Record the premise that would permit reopening it.

Update the sequential register in the same change. Do not unlock the next row from a commentary note, partial benchmark, or uncommitted inference.

## Research decision template

Append future entries using this shape:

```md
### YYYY-MM-DD — Technique / hypothesis

Register ID:
Depends on:
Status: Adopted | Supported | Falsified | Not applicable | Out of scope | Cancelled

Problem measured:
Exact input and hashes:
Baseline:
Prototype:
Deterministic work result:
Browser trace result:
State/identity result:
Pixel result:
Semantic risks:
Ownership decision:
Reopen gate:
Next-row decision:
Primary sources:
Evidence artifact paths:
```

Do not erase a falsification when a new variant is tried. Add the narrower changed premise and preserve the earlier result.

## Ownership map

Use this before deciding where an optimization belongs.

| Layer | Owns | Does not own | Relevant techniques |
| --- | --- | --- | --- |
| `@layoutit/polycss-core` | Pure geometry, animation math/types, culling algorithms, atlas planning | DOM, browser scheduling, style publication | geometry reduction, hierarchy math, visibility math, shared triangle-frame contract |
| `@layoutit/polycss` | General retained scene, leaf emission, camera/mesh styles, atlas rasterization, shadows, snapshots | Producer-specific prepared timelines | stable DOM, synchronous scene mutation, stale async render fencing |
| `@layoutit/polycss-morph` | Prepared model contracts and browser playback profiles | General scene batching, framework mirrors | prepared state, sparse deformation, caller-owned time |
| `@layoutit/polycss-domformat` | Canonical retained tree/state/bindings, executable prepared playback, lifecycle, conformance | Producer parsing, PolyCSS internals, arbitrary renderer abstraction | compiled streams, logical/physical state separation, deterministic publication |
| Mario/cssGraphics producer | Source-faithful lowering, visibility audit, atlas/light states, interaction closure, product pacing | Generic package semantics | preprocessing, PVS-like schedules, cost-aware hidden runs |
| Browser | CSS parsing, style, layout, paint, raster, tiling, compositing, presentation | Source semantics and canonical logical frame state | physical commit, compositor animation, layer/raster behavior |

Visibility-coherent publication belongs in DOMFormat because the optimization needs all of these at once:

- prepared transform indices;
- prepared visibility state;
- interaction-forced visibility;
- deterministic source-frame semantics;
- a retained binding table;
- explicit public synchronization operations.

`core` has none of the DOM/publication semantics. General `createPolyScene` does not know a future prepared timeline. The Mario producer should improve which runs are hidden, but should not own the browser interpreter's dirty physical cache.

## Common inference errors

- **Fewer setter calls do not guarantee fewer style calculations.** Trace both.
- **One JavaScript commit call does not mean one browser rendering update.** The browser owns update timing.
- **A hidden element is not necessarily free.** It may still participate in style, retained layer state, memory, and ancestor invalidation.
- **A transform animation is not guaranteed to be compositor-only.** Property, layerization, browser, and scene structure matter.
- **A precomputed stream can trade CPU for startup, package size, and memory.** Measure all four.
- **A smaller gzip file is not automatically a faster runtime representation.** Decode and materialization may dominate.
- **A final matching screenshot does not prove the animation.** Compare every visible frame state and representative pixels.
- **A black diff without exact input provenance is not an oracle.** Record hashes and environment.
- **Stable DOM does not mean low mutation.** Mario retained every node while still publishing more than half a million transform changes.
- **Maximum culling is not minimum work.** Visibility transitions have cost and tail bursts matter.
- **A historical renderer's fastest inner loop is not automatically transferable.** First match ownership of the output and work unit.
- **Headless GPU/viz trace totals are not portable hardware claims.** Use them directionally and repeat normal-loop captures.
- **A microbenchmark wall-time win is not a product FPS claim.** Retain both deterministic and browser-lifecycle evidence.
- **Exact affine animation is not generally reducible to TRS.** Mario's deformed bases include shear/non-orthogonality.

## Code-reading index

### Start here for DOMFormat publication

- [Main prepared-playback interpreter at PR #81's commit](https://github.com/LayoutitStudio/polycss/blob/6ac5eadde94361e34dbcd3b678a4a95560780e01/packages/domformat/src/state/polycss.js)
- [Browser mount, mode, scheduling, and public runtime](https://github.com/LayoutitStudio/polycss/blob/6ac5eadde94361e34dbcd3b678a4a95560780e01/packages/domformat/src/browser.js)
- [Retained tree instantiation](https://github.com/LayoutitStudio/polycss/blob/6ac5eadde94361e34dbcd3b678a4a95560780e01/packages/domformat/src/retained-dom.js)
- [Lifecycle state machine](https://github.com/LayoutitStudio/polycss/blob/6ac5eadde94361e34dbcd3b678a4a95560780e01/packages/domformat/src/lifecycle.js)
- [Independent browser viewer playback](https://github.com/LayoutitStudio/polycss/blob/6ac5eadde94361e34dbcd3b678a4a95560780e01/packages/domformat/conformance/viewer/playback.js)
- [Prepared-playback normative specification](https://github.com/LayoutitStudio/polycss/blob/6ac5eadde94361e34dbcd3b678a4a95560780e01/packages/domformat/spec/codecs/polycss-playback-0.md)
- [Surface visibility/lighting normative specification](https://github.com/LayoutitStudio/polycss/blob/6ac5eadde94361e34dbcd3b678a4a95560780e01/packages/domformat/spec/codecs/polycss-surface-0.md)

### Start here for general PolyCSS rendering

- `packages/polycss/src/api/createPolyScene.ts`: mesh lifecycle, `setPolygons()`, stable triangle updates, transforms, scene options, culling, atlas rebakes, and shadow invalidation.
- `packages/polycss/src/api/scene/types.ts`: public scene/mesh and `PolyAnimationTriangleFrame` contracts.
- `packages/polycss/src/render/polyDOM.ts`: retained polygon leaf emission.
- `packages/polycss/src/render/atlas/`: planning, rasterization, stable triangles, and atlas emission.
- `packages/polycss/src/render/voxelRenderer.ts`: prepared direct voxel leaf path.
- `packages/polycss/src/snapshot/exportPolySceneSnapshot.ts`: physical DOM snapshot semantics.
- `packages/core/src/animation/`: animation data and polygon optimization.
- `packages/core/src/cull/`: camera, interior, and light visibility algorithms.
- `packages/core/src/shadow/`: pure receiver/shadow planning.

### Start here for prepared Morph playback

- `packages/morph/src/runtime/playback/playback.ts`: current Morph prepared-playback runtime.
- `packages/morph/src/render/preparedDomTarget.ts`: prepared retained-DOM target.
- `packages/morph/src/contracts/`: profile and package contracts.

Morph and DOMFormat remain separate. Do not move a DOMFormat interpreter optimization into Morph merely because both use prepared playback.

### Start here for exact local Mario evidence

- `/Users/ekrof/fed/cssGraphics/.local/codepen-mario-release-doze2/codepen/runtime/animation.js`: packed frame playback and source timing.
- `/Users/ekrof/fed/cssGraphics/.local/codepen-mario-release-doze2/codepen/runtime/scene.js`: retained DOM, visibility, lighting, effects, and interaction publication.
- `/Users/ekrof/fed/cssGraphics/src/adapters/super-mario-64/stages/motion.mjs`: source motion preparation.
- `/Users/ekrof/fed/cssGraphics/src/adapters/super-mario-64/stages/visibilityCulling.mjs`: visibility audit and retained schedule preparation.
- `/Users/ekrof/fed/cssGraphics/build/reports/lean-mario-runtime-oracle-20260729/title-head-visibility-conservative.json`: raw conservative visibility oracle.
- `/Users/ekrof/fed/cssGraphics/build/reports/lean-mario-runtime-oracle-20260729/title-head-visibility-retained-safe.json`: retained schedule proof.
- `bench/results/mame-mario-codepen-2026-08-04/report.md`: ignored local broad-submission report.
- `bench/results/mame-mario-codepen-2026-08-04/software-renderer-techniques.md`: ignored local broader-technique report.

The last two paths are local ignored evidence, not durable repository inputs. All decision-critical numbers are copied into this bible.

## Curated source shelf

Read the item matching the problem. There is no reason to reread the full shelf for every optimization.

### Retained structures and hierarchy

- Ivan Sutherland, 1963, [*Sketchpad: A Man-Machine Graphical Communication System*](https://archive.computerhistory.org/resources/access/text/2017/03/102726907-05-01-acc.pdf). Read for retained picture structure, instances, and interactive logical state.
- James H. Clark, 1976, [*Hierarchical Geometric Models for Visible Surface Algorithms*](https://doi.org/10.1145/360349.360354). Read for hierarchy, visible complexity, shared transforms, and view-dependent detail.
- SM64 community decompilation, [rendering graph-node traversal](https://github.com/n64decomp/sm64/blob/master/src/game/rendering_graph_node.c). Read for the concrete Mario matrix-stack/display-list organization; treat it as community reconstruction rather than official source.

### General hidden-surface taxonomy

- Sutherland, Sproull, and Schumacker, 1974, [*A Characterization of Ten Hidden-Surface Algorithms*](https://doi.org/10.1145/356625.356626). Read to classify object-space, image-space, sorting, scanline, and coherence trade-offs.
- Edwin Catmull, 1974, [*A Subdivision Algorithm for Computer Display of Curved Surfaces*](https://collections.lib.utah.edu/details?id=104071). Read for subdivision-to-sample thinking, z-buffered imagery, and texture preparation history.

### Visibility preprocessing and coherence

- Fuchs, Kedem, and Naylor, 1980, [*On Visible Surface Generation by A Priori Tree Structures*](https://doi.org/10.1145/965105.807481). Read for spending static preprocessing to reduce runtime visibility.
- Teller and Séquin, 1991, [*Visibility Preprocessing for Interactive Walkthroughs*](https://people.csail.mit.edu/teller/pubs/siggraph91.pdf). Read for PVS and cell-based conservative visibility.
- Greene, Kass, and Miller, 1993, [*Hierarchical Z-Buffer Visibility*](https://www.cs.princeton.edu/courses/archive/spring01/cs598b/papers/greene93.pdf). Read for object/image hierarchy and temporal coherence.
- Bittner et al., 2004, [*Coherent Hierarchical Culling*](https://doi.org/10.1111/j.1467-8659.2004.00793.x). Read when latency and prior-frame visibility affect scheduling.

### Shipping CPU renderers

- id Software Doom source, [BSP renderer](https://github.com/id-Software/DOOM/blob/master/linuxdoom-1.10/r_bsp.c). Read for front-to-back world traversal and clipped solid segments.
- id Software Quake source, [edge/span path](https://github.com/id-Software/Quake/blob/master/WinQuake/r_edge.c), [BSP traversal](https://github.com/id-Software/Quake/blob/master/WinQuake/r_bsp.c), and [surface cache](https://github.com/id-Software/Quake/blob/master/WinQuake/d_surf.c#L261-L350). Read for separation of geometry visibility, span generation, and cached shaded surfaces.
- MAME, [software 3D rendering documentation](https://docs.mamedev.org/techspecs/poly_manager.html) and [`poly_manager` source](https://github.com/mamedev/mame/blob/6da3195803ecb61165629230dad3fd8893c2b89f/src/devices/video/poly.h). Read for immutable state snapshots, extent work, ordering, queues, and explicit waits.
- MAME's current [N64 video implementation](https://github.com/mamedev/mame/blob/6da3195803ecb61165629230dad3fd8893c2b89f/src/mame/nintendo/n64_v.cpp). Read only when investigating N64/RDP fidelity; it is not the default architecture source for DOM publication.

### Locality, parallelism, and excluded detail techniques

- Cook, Carpenter, and Catmull, 1987, [*The Reyes Image Rendering Architecture*](https://graphics.pixar.com/library/Reyes/paper.pdf). Read for common primitives, natural coordinate systems, bucketing, and working-set locality.
- Molnar et al., 1994, [*A Sorting Classification of Parallel Rendering*](https://www.cs.cmu.edu/afs/cs/academic/class/15869-f11/www/readings/molnar94_sorting.pdf). Read only when deciding where geometry-to-screen redistribution or parallel boundaries belong.
- Hugues Hoppe, 1996, [*Progressive Meshes*](https://www.microsoft.com/en-us/research/publication/progressive-meshes/). Retain as historical classification only, so progressive refinement or LOD is recognized and rejected rather than rediscovered as a PolyCSS candidate.

### Display compilation and synchronization

- Khronos, [OpenGL 1.1 specification](https://registry.khronos.org/OpenGL/specs/gl/glspec11.pdf), display-list chapter. Read for compile/execute semantics and what state is captured.
- MAME sources above. Read for state snapshots and wait boundaries when asynchronous work can observe mutable state.

### Retained invalidation and browser publication

- Microsoft, [*Invalidating and Validating the Update Region*](https://learn.microsoft.com/en-us/windows/win32/gdi/invalidating-and-validating-the-update-region). Read for accumulated damage and delayed paint boundaries.
- Chromium, [*The Rendering Critical Path*](https://www.chromium.org/developers/the-rendering-critical-path/). Read before claiming a DOM setter maps directly to paint.
- Chromium, [*GPU Accelerated Compositing in Chrome*](https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/). Read before claiming a transform remains compositor-only or avoids repaint.
- WHATWG, [HTML animation frame processing](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html). Read when changing scheduling semantics.
- W3C, [Web Animations Level 1](https://www.w3.org/TR/web-animations-1/). Read before a WAAPI playback experiment.
- W3C, [CSS Typed OM Level 1](https://www.w3.org/TR/css-typed-om-1/). Read before claiming typed values avoid enough parse cost to matter.

## What is settled, what is next

### Settled

- Prepared Mario is already a retained display-list renderer layered on the browser.
- MAME's general queue is not the missing layer for normal playback.
- The browser lifecycle is the physical commit boundary.
- Stable leaf identity is non-negotiable for this product.
- Mario has no additional reusable rigid hierarchy.
- Exact transform decomposition and triangle merging do not have material headroom.
- Prepared visibility is valuable, but transition cost must be part of its objective.
- Hidden logical state can safely outrun hidden physical publication if explicit barriers restore canonical DOM.
- SR-07 adopted that split inside DOMFormat with exact full-loop visual proof and no public batching API.
- SR-08 adopted final-state physical publication for multi-tick animation
  backlogs while preserving every logical tick and separately publishing every
  interaction tick.
- LOD, progressive refinement, and impostor substitution are outside the PolyCSS contract.

### Next

1. Start only ready row SR-09 when authorized; no later row may begin.
2. Recompute visibility-run savings against the adopted SR-07 and SR-08
   publication costs.
3. Score saved transform, lighting, paint, and compositor work against hide /
   reveal writes and a hard worst-frame transition-burst limit.
4. Reject any candidate that merely maximizes hidden percentage, and require
   full numbered Mario visual parity before adopting a win.

### Not next

- a public batch API;
- a generic frame/submission manager;
- a renderer rewrite;
- workers;
- runtime scan conversion;
- a broad `createPolyScene.ts` refactor;
- LOD, progressive refinement, or impostor substitution.
