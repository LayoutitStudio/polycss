# PolyCSS Skills

The PolyCSS agent skill, packaged as an installer. One command drops
`SKILL.md` plus a folder of reference docs into your project so Claude Code,
Codex, or any agent that reads a skills directory writes PolyCSS correctly
instead of guessing.

<!-- polycss:shared:links:start -->
Visit [polycss.com](https://polycss.com) for docs and model examples.

Join [chat.polycss.com](https://chat.polycss.com) for support and community discussions.

<img width="1600" height="300" alt="PolyCSS primitives banner" src="https://github.com/user-attachments/assets/b05e2204-9323-4f83-8d1b-01ea0dd000db" />
<!-- polycss:shared:links:end -->

## Install

```bash
npx @layoutit/polycss-skills
```

No dependencies, nothing added to your `package.json`. It detects which agent
directories your project already has and installs into each of them:

| Agent | Destination |
|---|---|
| Claude Code | `.claude/skills/polycss/` |
| Codex | `.agents/skills/polycss/` |

A project with neither gets `.claude/skills/polycss/`. Start a new agent session
afterwards so the skill is picked up.

## What lands on disk

```
.claude/skills/polycss/
  SKILL.md                            entry point — conventions, invariants, minimal scenes
  docs/authoring-polygons.md          winding, color format, coplanarity, the optimizer
  docs/scenes-and-cameras.md          scene options, camera props, custom elements
  docs/shapes-and-primitives.md       primitives and raw polygon generators
  docs/loading-models.md              OBJ, STL, glTF/GLB, VOX, parse options
  docs/lighting.md                    baked vs dynamic, directional, ambient, point
  docs/shadows.md                     castShadow, receiveShadow, parametric shadows
  docs/textures.md                    UVs, the atlas pipeline, texture quality
  docs/controls-and-interaction.md    orbit, map, first-person, selection, gizmos
  docs/animation.md                   glTF clips, mixers, stable DOM
  docs/performance.md                 leaf counts, render strategies, voxel fast paths
  docs/three-parity.md                porting Three.js scenes
  docs/troubleshooting.md             symptom to cause
  docs/api-index.md                   export inventory per package
```

`SKILL.md` is the entry point and carries the index; the agent reads a doc when
the task calls for it.

## Options

```
--agent <name>   claude, codex, or all. Repeatable and comma-separated.
--dir <path>     Install into this exact directory instead of an agent's.
--cwd <path>     Project root to install into (default: current directory).
--global         Install into your home directory instead of the project.
--force          Overwrite files you have edited since installing.
--dry-run        Print what would change, write nothing.
--list           List the files this package would install.
```

## Upgrading

Run the command again. Installs are content-hashed in a `.polycss-skill.json`
manifest next to the files, so an upgrade rewrites the docs it owns, drops docs
the skill no longer ships, and leaves anything you added alone.

If you have edited an installed file, the upgrade stops and names it rather than
overwriting your work. Re-run with `--force` when you want the shipped version
back.

## Fetching instead of installing

The same content is served at
[polycss.com/skill.md](https://polycss.com/skill.md), with the reference docs
under `polycss.com/skill/docs/`. Use that when an agent can fetch a URL but
cannot run a command.

<!-- polycss:shared:packages:start -->
## Packages

| Package | Description |
|---|---|
| `@layoutit/polycss-core` | Pure math, parsers, lighting, camera helpers, mesh optimization. Zero browser globals. |
| `@layoutit/polycss` | Vanilla custom elements and imperative `createPolyScene` API. |
| `@layoutit/polycss-react` | React components, hooks, controls, and core re-exports. |
| `@layoutit/polycss-vue` | Vue 3 components, composables, controls, and core re-exports. |
| `@layoutit/polycss-morph` | Prepared-model loading, retained DOM animation, morph targets, skinning, and playback. |
| `@layoutit/polycss-skills` | `npx @layoutit/polycss-skills` — installs the PolyCSS agent skill into `.claude/skills` or `.agents/skills`. |
| `@layoutit/polycss-domformat` | Private MIT-licensed producer-neutral `domformat@0` runtime for canonical JSON plus digest-bound sibling resources; conformance and specifications stay repository-side. Not published. |
<!-- polycss:shared:packages:end -->

<!-- polycss:shared:license:start -->
## License

MIT.
<!-- polycss:shared:license:end -->
