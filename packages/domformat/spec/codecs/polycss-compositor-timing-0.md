# `polycss-compositor-timing@0`

Status: fixed executable DOMFORMAT profile contract.

This interpreter is the closed prepared publication strategy used for retained
transform motion that the browser compositor can own. It is not an escape hatch
for package CSS animation, transitions, easing functions, keyframe text, or
script.

The state codec is `polycss-compositor-timing-prepared@0`. Its packet has exactly
`version: 0`, `timing: "linear"`, and a bounded nonempty `targets` array. The
binding has the same ordered `nodes`, the un-defaulted uint inputs
`time.source-frame` and `time.tick`, the sole sink `style.transform`, and
`frameCount` and the same `tickRateHz` or reduced `tickIntervalUs` cadence
representation as playback. Version 0 compositor timing requires fixed cadence
and rejects playback timelines with explicit `deadlineMicros`.

Each target identifies one playback-owned `model`, `shape`, or `leaf` by kind
and index. A `transition` target supplies only an integer duration of one to
eight prepared ticks. A `cycle` target is limited in version 0 to the retained
model, uses `iterations: "infinite"` and `closure: "closed"`, and carries three
to 256 strictly increasing `{ tick, transformIndex }` rows. The first tick is
zero, the last equals `durationTicks`, and the first and last transform indices
are identical. Every transform index addresses the already validated playback
transform dictionary. Playback model rows must not also change a cycled model.

The viewer owns the physical timing objects. A cycle becomes one linear WAAPI
animation with canonical offsets and no per-tick JavaScript transform writes.
A transition becomes one viewer-authored linear `transform` transition. Initial
publication, public seek, restart, catch-up, pause, nonsequential jump, and loop
wrap disable interpolation, synchronously publish the exact prepared state, set
the cycle time, and then restore timing. Interaction mode pauses cycles and
disables transitions. Destroy cancels every timing object and clears viewer
transition state.
