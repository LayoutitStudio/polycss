# static-presentation@0

Status: experimental executable codec/interpreter contract for `domformat@0`
and `polycss-3d@0`.

## Purpose

This contract makes an optional host background, fixed source viewport,
perspective camera, scene base transform, fit policy, and optional cursor-layer
targets explicit.
Initial values are applied through `TREE`; resize/appearance publication uses
the fixed binding and packet. No producer-private layout helper is required.

## Packet

State data is `{ "packet": ... }`. The packet has `version: 0`, required
`camera`, and optional `background`.

Camera fields are:

```text
baseSceneTransform  safe local CSS transform
fitWidth            positive integer fit width
fitHeight           positive integer fit height
sourceWidth         positive integer source viewport width
sourceHeight        positive integer source viewport height
perspective         positive finite CSS pixel distance
profileSelection    optional closed profile selector
profiles            optional bounded prepared responsive profile array
```

`profileSelection` and `profiles` MUST appear together or both be absent. When
present, `profiles` contains 1..16 records in selector order. Every
record declares a unique stable `id`, `fit` (`contain` or `cover`),
`quarterTurns` in `0..3`, finite prepared projection `bounds`
`[minX,minY,maxX,maxY]`, a nonnegative finite `safeInset`, and finite viewport
`bias` `[x,y]` in `-1..1`. The selector is one of:

- `viewport-width`: all but the final record declare a positive, strictly
  increasing integer `maxViewportWidth`; the final record omits it. The viewer
  selects the first row for which `width < maxViewportWidth`, or the final row.
- `landscape-first-portrait-width`: there are at least two records. Record zero
  is the unconditional landscape row and omits `maxViewportWidth`. A viewport
  with `width > height` selects it. Square and portrait viewports select among
  records 1..N-1 by the same strict, increasing width-band rule; the final
  portrait record omits `maxViewportWidth`.

Every maximum is at most 1,000,000. The fixed comparisons use only the numeric
layout width and height. There are no media-query strings, CSS orientation or
user-agent predicates, expressions, capped-fit modes, or geometry-bound
derivation.

The same stable profile ids MAY key optional prepared playback-timeline
overrides. Static presentation still owns only camera fit and mapping sinks; it
does not own playback cadence or source-frame publication. A playback override
bank without presentation profiles, or with an unknown/out-of-order profile
id, is invalid.

When present, background fields are:

```text
resource  image resource id
opacity   finite number in 0..1
position  safe CSS background position
repeat    safe CSS background repeat
size      safe CSS background size
```

## Binding

The executable binding consumes exactly `viewport.height` then
`viewport.width`, both finite-float inputs with no package default. Targets are:

```text
host          $host (the viewer-owned profile mount surface, not the outer application container)
camera        stable camera node
cursorLayer   optional stable cursor owner
cursorStates  optional distinct stable open/closed cursor image nodes
```

Parameters repeat `fitWidth`, `fitHeight`, `sourceWidth`, `sourceHeight`, and
the optional `profileSelection` plus prepared profiles and MUST equal the packet. Declared sinks always
include `height`, `left`, `top`, `transform`, and `width`. `visibility` appears
exactly when the cursor target pair is present. Background is immutable initial
`TREE` state, not an interpreter sink. The cursor layer and cursor states MUST
be declared together, and pointer interaction requires them.

## Initial retained contract

Before mounting, validation cross-checks presentation against `TREE` and
resources:

- when background is present, its resource is an image and equals the mount
  `backgroundImage` resource binding, overlay syntax and opacity equal the
  packet, and mount background position/repeat/size equal the packet;
- when background is absent, those mount background bindings and layout styles
  are absent;
- the camera target declares `position: relative`, source-dimension width and
  height, packet perspective, and source-centred `perspectiveOrigin`, while
  omitting inline `transformOrigin` and `transformStyle`;
- when playback is present, its model target's base transform and binding
  parameter equal `baseSceneTransform`;
- when cursor targets are present, their layer exists and their open/closed
  states are distinct; pointer interaction requires and exactly matches them.

The mount applies the verified background object/package URL only when the
packet declares one. The camera and any cursor nodes are created once and
retain identity.

## Resize and appearance

Playback appearances supply an additional positive scale and vertical source
translation. For host viewport `(width,height)`:

```text
sourceScale = min(width / fitWidth, height / fitHeight)
scale = sourceScale * appearanceScale
camera.left = width/2 - sourceWidth*scale/2
camera.top = height/2 - sourceHeight*scale/2
             + appearanceTranslateY*sourceScale
camera.width = sourceWidth
camera.height = sourceHeight
camera.transform = scale(scale) when scale != 1
camera inline transform = unset when scale == 1
```

Source point `(sourceX,sourceY)` maps to mount-surface layout coordinates as
`(camera.left + sourceX*scale, camera.top + sourceY*scale)`. Positioned pointer
input applies the exact inverse of this current mapping, including appearance
scale and vertical translation. The retained cursor layer uses the forward
mapping and the same scale.

The static-presentation interpreter recomputes this on resize and appearance
change. It is the sole writer of the declared camera fit sinks and does not
rebuild any descendant. Playback passes it the selected appearance but never
writes those sinks itself.
If layout dimensions are not yet observable while the mount surface is
detached, the initial publication uses the declared `sourceWidth` and
`sourceHeight`; it never substitutes a hard-coded producer viewport.

Without playback, the presentation uses appearance scale `1` and translation
`0`, publishes source frame `1`, and schedules no clock. Its controller accepts
only `seek(1)`. The identity fit clears the camera's inline `transform`
property instead of publishing `transform: none`, leaving renderer base CSS in
control.

With profiles, fitting uses the selected prepared bound width and height after
subtracting twice `safeInset`. `contain` selects the smaller axis scale and
clamps the biased visual center inside the safe inset when possible; `cover`
selects the larger scale and permits cropping. Bias is a fraction of the host
width/height. Appearance scale and vertical source translation compose with the
selected fit. The camera transform is the prepared quarter-turn rotation
followed by scale. Prepared bounds are relative to the camera's CSS transform
origin, so camera left/top are solved from the bound center without inspecting
descendant geometry.

Profile selection runs before fitting. Moving between profile ids that resolve
to the same playback timeline changes presentation/viewport rows without
resetting playback tick or its scheduler deadline. Only a change in active
timeline identity restarts animation.

Forward cursor mapping applies the same scale and quarter-turn around the
camera transform origin; input mapping applies its exact inverse. Near-integer
floating residue is canonically snapped, including negative zero. Resize and
breakpoint changes mutate only the declared camera sinks and retain the same
TREE nodes.

Before initial playback publication and on every resize, the viewer resolves
the root presentation profile first. If that changes the active animation
schedule, playback restarts to logical tick 0 and its initial source frame
before the new viewport profile may reveal leaves. Interaction state is not
reset by resize; animation re-entry uses the most recently selected schedule.

The playback scene transform is the packet's `baseSceneTransform` alone for an
empty prepared model transform, or that base followed by one space and the
prepared model transform.

## Cursor presentation

When present, the pointer-grab interpreter controls only the declared cursor
layer and open/closed cursor state targets. The static presentation contract
supplies their stable placement context; it does not infer control roles from
image order. Presentation without pointer interaction MAY omit all cursor
targets.

## Validation boundary

Unknown packet/target/parameter fields, unsafe CSS values, nonpositive
dimensions/perspective, resource-role mismatch, packet/binding/TREE mismatch,
noncanonical inputs/sinks, malformed or nonmatching profiles, missing selector
or final unbounded coverage, unsupported fit/profile selection, or missing/distinctness
violations are fatal before mounting.
