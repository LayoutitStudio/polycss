# Skill evaluation

Does an agent that has only the PolyCSS skill actually write correct PolyCSS?

This harness answers that empirically. It hands a coding agent a throwaway
workspace containing nothing but the installed skill and a task, runs the
agent's real CLI, then grades **what the resulting scene actually paints in
Chromium** — not what the agent said it did.

```bash
pnpm eval:skill --agent oracle --track all   # reference solutions (must be 100%)
pnpm eval:skill --agent claude --track all   # one agent, both tracks, all tasks
pnpm eval:skill --agent all --track all --keep --json out.json
pnpm eval:skill --task 03-cube-with-shadow --agent claude,codex
pnpm eval:skill --agent claude --reuse       # re-grade existing work, no new calls
pnpm eval:selftest                           # prove the graders can fail
```

## How a run works

For each (agent, task) pair:

1. **Isolate.** A fresh directory outside the repository gets
   `npx polycss-skills --agent all` and a `TASK.md`, and nothing else.
2. **Run the agent** non-interactively in that directory. The task asks for one
   file, `scene.mjs`, exporting `mount(host)`.
3. **Build** it with esbuild, aliasing `@layoutit/polycss` to workspace source.
   An import that does not exist is a build error here — invented exports fail
   loudly instead of mysteriously.
4. **Render** it in Chromium and sample the result twice, ~2s apart, so motion
   is observable.
5. **Grade** with the task's checks.

## What the isolation is worth

The workspace lives outside the repo, which stops an agent reaching this
monorepo by walking up from its working directory. One did exactly that on the
no-skill control track before the move, and wrote PolyCSS in the Three.js
control.

That is the limit of it. This is **not a sandbox**: the host filesystem is still
reachable by absolute path, HOME and any global skills are visible, network is
open, and sibling task workspaces share a root. Several adapters run with
approvals bypassed.

So read a score as *the skill was sufficient*, not *the skill was the only
source*. The cross-track comparison is the trustworthy signal, because both
tracks run under identical conditions. For a stronger claim, run each case in a
container with a temporary HOME and network denied.

## Grading on pixels, not DOM boxes

The graders sample painted pixels (Chromium decodes the screenshot inside the
page, so no image library is needed), plus a few structural DOM facts like mesh
count and shadow paths.

This is not a stylistic preference. Leaf strategies other than `<b>` carry
`backface-visibility: hidden`, so a back-facing leaf **keeps its bounding rect
while painting nothing**. An earlier rect-based grader scored a fully reversed
mesh as perfectly visible. Only pixels survive that.

## Tasks

| Task | What it really tests |
|---|---|
| `01-static-cube` | Camera/scene nesting, a primitive, a parseable color, and *not* animating when nothing asked for it. |
| `02-orbiting-cube` | Reaching for `createPolyOrbitControls` instead of hand-rolling a `requestAnimationFrame` loop. |
| `03-cube-with-shadow` | The vanilla no-ground-fallback trap: a caster with no `receiveShadow` mesh draws nothing. |
| `04-two-shapes` | Two meshes, two colors, positioned in world space so neither hides the other. |
| `05-hand-authored-polygons` | Winding. Four flat tiles wound CCW from above; any tile wound the other way is backface-culled and paints nothing, costing a whole painted region. |
| `06-composed-scene` | Everything at once: ground, three primitives, lights, shadows, controls. |

### Why tiles and not a pyramid

The winding task started as a hand-authored pyramid, and reversing **every**
face changed the image by 0.05%. A closed solid rendered inside-out looks
almost identical — the near faces vanish and the far faces appear in the same
silhouette. Measured, not assumed:

| pyramid | painted | shades |
|---|---|---|
| correct winding | 13.14% | 5 |
| one face reversed | 13.16% | 5 |
| two faces reversed | 8.94% | 4 |
| every face reversed | 13.09% | 5 |

Winding is only *observable* on surfaces that are single-sided from the
viewpoint, which is what four open tiles give. The underlying rule was
confirmed separately: one tilted triangle wound away from the camera mounts its
leaf and paints zero pixels.

## Trusting the graders

A check that cannot fail measures nothing. `pnpm eval:selftest` takes each
reference solution, injects one specific mistake the skill warns about, and
asserts the matching check catches it *and* that the scene still mounts — so a
mutation cannot "pass" by breaking everything.

Current controls: reversed winding, a CSS named color, a shadow caster with no
receiver, a missing autorotate, an unwanted autorotate, overlapping shapes, a
shape helper used where the task demanded hand-authored geometry, and an
import that does not exist.

## Adding an agent

One entry in `agents.mjs` with the CLI's non-interactive flags. Agents run with
approvals bypassed because the workspace is a throwaway temp directory. CLI
flags drift between releases; if one adapter breaks, fix that `argv` and
nothing else.

## Adding a task

Add to `tasks.mjs`, splitting its checks into `visual` (graded on both tracks)
and `native` (PolyCSS-only), then drop a reference solution in
`oracle/polycss/<task-id>.mjs` and `oracle/three/<task-id>.mjs`. Both oracles
must score 100% — if either does not, the grader is wrong, not the agent. Add a
mutation to `selftest.mjs` for any new check that could silently pass.

## Interpreting results

`--agent oracle` scoring below 100% is a **harness** bug. A real agent scoring
below 100% is a finding: read the failure reason, then decide whether the skill
failed to say something, said it somewhere the agent did not look, or the agent
ignored it. The first two are fixable in `packages/skills/skill/`.

Use `--keep` to leave the workspaces under `$TMPDIR/polycss-skill-eval` and read
what the agent actually wrote. `--reuse` then re-grades them without spending
another agent call, which is how to iterate on a grader.

Screenshot a red result before believing it. Three separate findings in this
suite turned out to be grader bugs, not agent mistakes.
