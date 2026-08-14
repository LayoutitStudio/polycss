/**
 * The tracks a task can be run in.
 *
 * `polycss` is the intervention: PolyCSS with the skill installed.
 *
 * `polycss-noskill` is the actual CONTROL. Same library, same task, same
 * contract, skill withheld — so the only thing that differs is the
 * intervention, and the delta is attributable to the skill.
 *
 * `three` is an external BASELINE, not a control. It changes the rendering
 * library, its API and its whole authoring contract at the same time as it
 * removes the skill, so a polycss-vs-three delta conflates the skill with how
 * familiar and how expensive each library is for that model. It answers a
 * different and still useful question — "is this task hard for this model at
 * all?" — and it calibrates the graders. It does not measure the skill.
 *
 * No track is ever compared to another pixel-for-pixel. A PolyCSS scene is
 * never diffed against a Three.js render and neither is a reference image for
 * the other; each is graded on its own against the same task-level visual
 * criteria, which is what makes the SCORES comparable.
 *
 * Workspaces are separate per track and neither knows the other exists.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

const SHARED_CONTRACT = `Write your scene in a single file \`scene.mjs\` in this directory.

It must export one function:

    export function mount(host) { ... }

\`host\` is an empty \`<div>\` that is already in the document, sized 900x600.
Build the scene inside it.

Do not write any other file. Do not add a package.json, do not install
anything, and do not use a CDN URL. Do not run a dev server. Do not try to open
a browser. When \`scene.mjs\` is written, you are done.`;

export const TRACKS = {
  polycss: {
    label: "PolyCSS",
    /** The skill under test is installed into the workspace. */
    installSkill: true,
    contract: `${SHARED_CONTRACT}

Import everything from "@layoutit/polycss" — the bundler resolves that
specifier. The scene renders as DOM elements, on the page's white background.`,
    alias: {
      "@layoutit/polycss-core": resolve(repoRoot, "packages/core/src/index.ts"),
      "@layoutit/polycss-core/three": resolve(repoRoot, "packages/core/src/three/index.ts"),
      "@layoutit/polycss": resolve(repoRoot, "packages/polycss/src/index.ts"),
      "@layoutit/polycss/elements": resolve(repoRoot, "packages/polycss/src/elements/index.ts"),
      "@layoutit/polycss/three": resolve(repoRoot, "packages/polycss/src/three.ts"),
    },
  },

  "polycss-noskill": {
    label: "PolyCSS (no skill)",
    /** The control: identical to `polycss` except the skill is withheld. */
    installSkill: false,
    contract: null, // filled in below — identical to the polycss contract
    alias: null,
  },

  three: {
    label: "Three.js",
    /** External baseline — a different library, not a control. See the header. */
    installSkill: false,
    contract: `${SHARED_CONTRACT}

Import from "three" (and "three/addons/..." for anything under examples/jsm) —
the bundler resolves those specifiers.

Create your own WebGLRenderer sized to the host and append its canvas to the
host. Set the renderer clear color to white, so the scene reads on the page the
same way any other scene would. Drive it with a continuous render loop.`,
    alias: {
      three: resolve(repoRoot, "node_modules/three/build/three.module.js"),
      "three/addons": resolve(repoRoot, "node_modules/three/examples/jsm"),
      "three/examples/jsm": resolve(repoRoot, "node_modules/three/examples/jsm"),
    },
  },
};

export const TRACK_NAMES = Object.keys(TRACKS);

export function selectTracks(names) {
  const requested = names.length === 0 ? ["polycss"] : names;
  const expanded = requested.flatMap((n) => (n === "all" ? TRACK_NAMES : [n]));
  const unknown = expanded.filter((n) => !TRACK_NAMES.includes(n));
  if (unknown.length > 0) {
    throw new Error(`unknown track(s): ${unknown.join(", ")}\nknown: ${TRACK_NAMES.join(", ")}, all`);
  }
  return [...new Set(expanded)];
}

// The control must differ from the intervention in exactly one way, so it
// inherits the PolyCSS contract and aliases verbatim rather than restating
// them, where a copy could drift.
TRACKS["polycss-noskill"].contract = TRACKS.polycss.contract;
TRACKS["polycss-noskill"].alias = TRACKS.polycss.alias;
