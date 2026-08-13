#!/usr/bin/env node
/**
 * Negative controls for the skill evaluation.
 *
 * A grader that never fails grades nothing. Each mutation below takes a
 * reference solution, injects one specific mistake the skill explicitly warns
 * about, and asserts the matching check catches it — and that the OTHER checks
 * stay green, so a mutation cannot pass by breaking the scene wholesale.
 *
 * Run: `pnpm eval:selftest` (needs Chromium; ~30s).
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TASKS } from "./tasks.mjs";
import { verifyCandidates } from "./verify.mjs";

const here = resolve(fileURLToPath(import.meta.url), "..");
const scratch = join(here, ".work", "__selftest__");

const task = (id) => TASKS.find((t) => t.id === id);
const oracle = (id) => readFileSync(join(here, "oracle", `${id}.mjs`), "utf8");

/** Apply a required replacement, failing loudly if the source drifted. */
function patch(source, from, to) {
  if (!source.includes(from)) {
    throw new Error(`mutation target not found in oracle source: ${JSON.stringify(from)}`);
  }
  return source.replace(from, to);
}

const MUTATIONS = [
  {
    // Reversing only SOME faces is the realistic bug and the one that shows.
    // Reversing a closed solid's every face is nearly invisible — you simply
    // see its inside — which is why the winding task uses open tiles.
    name: "tiles wound away from the camera vanish",
    taskId: "05-hand-authored-polygons",
    expect: "faces-visible",
    mutate: (source) =>
      patch(
        source,
        `      [cx - h, cy - h, 0],
      [cx + h, cy - h, 0],
      [cx + h, cy + h, 0],
      [cx - h, cy + h, 0],`,
        `      [cx - h, cy + h, 0],
      [cx + h, cy + h, 0],
      [cx + h, cy - h, 0],
      [cx - h, cy - h, 0],`,
      ),
  },
  {
    name: "a CSS named color renders white",
    taskId: "01-static-cube",
    expect: "color#ff8c1a",
    mutate: (source) => patch(source, `color: "#ff8c1a"`, `color: "orange"`),
  },
  {
    name: "a caster with no receiver draws no shadow in vanilla",
    taskId: "03-cube-with-shadow",
    expect: "shadow-drawn",
    mutate: (source) =>
      patch(
        source,
        `scene.add(createPolyPlane({ axis: 2, size: 160, offset: 0, color: "#94a3b8" }), {
    receiveShadow: true,
  });`,
        `scene.add(createPolyPlane({ axis: 2, size: 160, offset: 0, color: "#94a3b8" }));`,
      ),
  },
  {
    name: "no orbit controls means no autorotate",
    taskId: "02-orbiting-cube",
    expect: "moving",
    mutate: (source) =>
      patch(
        source,
        `  createPolyOrbitControls(scene, {
    drag: true,
    wheel: true,
    animate: { speed: 0.6, axis: "y" },
  });`,
        "",
      ),
  },
  {
    name: "autorotate on a supposedly fixed camera",
    taskId: "01-static-cube",
    expect: "still",
    mutate: (source) =>
      patch(
        source,
        `import { createPolyBox, createPolyCamera, createPolyScene } from "@layoutit/polycss";`,
        `import {
  createPolyBox,
  createPolyCamera,
  createPolyOrbitControls,
  createPolyScene,
} from "@layoutit/polycss";`,
      ).replace(
        `  scene.add(createPolyBox({ size: 100, color: "#ff8c1a" }));`,
        `  scene.add(createPolyBox({ size: 100, color: "#ff8c1a" }));
  createPolyOrbitControls(scene, { animate: { speed: 2, axis: "y" } });`,
      ),
  },
  {
    name: "overlapping shapes are not side by side",
    taskId: "04-two-shapes",
    expect: "separated",
    mutate: (source) =>
      patch(source, `{ position: [0, -110, 0] }`, `{ position: [0, 0, 0] }`).replace(
        `    position: [0, 110, 0],`,
        `    position: [0, 0, 0],`,
      ),
  },
  {
    name: "a shape helper is not hand-authored geometry",
    taskId: "05-hand-authored-polygons",
    expect: "authored",
    mutate: (source) =>
      patch(
        source,
        `import { createPolyCamera, createPolyScene } from "@layoutit/polycss";`,
        `import { createPolyCamera, createPolyScene, createPolyBox } from "@layoutit/polycss";`,
      ).replace(
        `  scene.add({ polygons, objectUrls: [], warnings: [], dispose: () => {} }, { merge: false });`,
        `  void polygons;
  scene.add(createPolyBox({ size: 140, color: COLOR }));`,
      ),
  },
  {
    name: "an overscaled cube runs past the viewport edges",
    taskId: "01-static-cube",
    expect: "scale",
    mutate: (source) => patch(source, `zoom: 3`, `zoom: 24`),
  },
  {
    name: "an undersized cube is a speck",
    taskId: "01-static-cube",
    expect: "scale",
    mutate: (source) => patch(source, `zoom: 3`, `zoom: 0.25`),
  },
  {
    name: "a light pointing away leaves the cube near-black",
    taskId: "01-static-cube",
    expect: "brightness",
    mutate: (source) =>
      patch(
        source,
        `directionalLight: { direction: [0.5, -0.6, 0.7], color: "#ffffff", intensity: 1 },
    ambientLight: { color: "#ffffff", intensity: 0.4 },`,
        `directionalLight: { direction: [0, 0, -1], color: "#ffffff", intensity: 1 },
    ambientLight: { color: "#ffffff", intensity: 0.04 },`,
      ),
  },
  {
    name: "a zero-opacity shadow emits paths but darkens nothing",
    taskId: "03-cube-with-shadow",
    expect: "shadow-contrast",
    mutate: (source) => patch(source, `shadow: { opacity: 0.35 }`, `shadow: { opacity: 0 }`),
  },
  {
    // The regression that motivated the check: a lift too small to clear the
    // receiver leaves the shadow z-fighting and painted over.
    name: "a shadow lift too small to clear the receiver is invisible",
    taskId: "03-cube-with-shadow",
    expect: "shadow-contrast",
    mutate: (source) =>
      patch(source, `shadow: { opacity: 0.35 }`, `shadow: { opacity: 0.35, lift: 0.001 }`),
  },
  {
    name: "an export that does not exist fails the build",
    taskId: "01-static-cube",
    expect: "*",
    mutate: (source) =>
      patch(source, `createPolyScene }`, `createPolyScene, createPolyCube }`).replace(
        `  scene.add(createPolyBox({ size: 100, color: "#ff8c1a" }));`,
        `  scene.add(createPolyCube({ size: 100, color: "#ff8c1a" }));`,
      ),
  },
];

rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });

const candidates = MUTATIONS.map((mutation, index) => {
  const source = mutation.mutate(oracle(mutation.taskId));
  const dir = join(scratch, String(index));
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, "scene.mjs");
  writeFileSync(entry, source);
  return {
    key: `mutant-${index}`,
    agent: "mutant",
    task: task(mutation.taskId),
    mutation,
    entry,
    source,
  };
});

console.log(`[selftest] grading ${candidates.length} mutation(s) ...\n`);
const results = await verifyCandidates(candidates, { settleMs: 1200 });

let failures = 0;
for (const result of results) {
  const { mutation } = result;
  const failed = result.checks.filter((c) => !c.pass).map((c) => c.id);

  try {
    if (mutation.expect === "*") {
      // A build failure must take every check down with it.
      assert.equal(result.build.ok, false, "expected the bundle to fail to build");
      assert.equal(failed.length, result.checks.length, "expected every check to be skipped");
    } else {
      assert.ok(
        failed.includes(mutation.expect),
        `expected check "${mutation.expect}" to fail; failing checks were [${failed.join(", ") || "none"}]`,
      );
      // Guard against a mutation that "passes" by breaking everything: the
      // scene must still mount and paint.
      assert.ok(
        !failed.includes("mounts") && !failed.includes("scene"),
        `mutation broke the scene outright (failed: ${failed.join(", ")})`,
      );
    }
    console.log(`  ok    ${mutation.name}  ->  caught by [${failed.join(", ")}]`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${mutation.name}\n        ${error.message}`);
  }
}

rmSync(scratch, { recursive: true, force: true });

console.log(
  `\n[selftest] ${results.length - failures}/${results.length} mutations caught by the graders`,
);
process.exitCode = failures === 0 ? 0 : 1;
