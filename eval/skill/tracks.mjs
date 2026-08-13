/**
 * The two tracks an agent is asked to build the same scene in.
 *
 * `polycss` is what we are actually evaluating. `three` is the **control**: the
 * same model, the same task, a library it already knows well, and no skill
 * installed. It exists to answer the question a PolyCSS score alone cannot —
 * "did the agent fail because our skill is inadequate, or because the task
 * itself is hard for it?"
 *
 * The tracks are graded independently and never compared pixel-to-pixel. A
 * PolyCSS scene is never diffed against a Three.js render, and the Three.js
 * output is never a reference image. Both are measured against the SAME
 * task-level visual criteria — is it the right color, the right size, lit,
 * moving, shadowed — so the two scores are comparable as scores while each
 * scene is judged only on its own merits.
 *
 * Workspaces are separate and neither knows the other exists.
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

  three: {
    label: "Three.js",
    /**
     * No skill, deliberately. The control measures what the model can do from
     * its own training, which is the whole point of the comparison.
     */
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
