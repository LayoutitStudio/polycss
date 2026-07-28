import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptRoot, "../../..");
const defaultOutput = resolve(
  repoRoot,
  "notes/evidence/polycss-morph/plane-browser",
);

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function settlePaint(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  });
}

async function captureState(page, runRoot, index, name) {
  await settlePaint(page);
  const state = await page.evaluate(() => window.__polyMorphDemo.snapshot());
  const bytes = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    type: "png",
  });
  const filename = `${String(index).padStart(3, "0")}-${name}.png`;
  await writeFile(resolve(runRoot, filename), bytes);
  return {
    name,
    filename,
    sha256: hash(bytes),
    bytes: bytes.byteLength,
    state,
  };
}

async function runSequence(browser, url, runRoot) {
  await mkdir(runRoot, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const networkErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.stack ?? error.message));
  page.on("requestfailed", (request) => {
    networkErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      networkErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__polyMorphDemo?.ready === true);

  const frames = [];
  await page.evaluate(() => window.__polyMorphDemo.reset());
  frames.push(await captureState(page, runRoot, 0, "front"));

  await page.evaluate(() => {
    const snapshot = window.__polyMorphDemo.snapshot();
    const patchId = snapshot.patchIds[Math.floor(snapshot.patchIds.length / 2)];
    window.__polyMorphDemo.setPatch(patchId, 0.65);
  });
  frames.push(await captureState(page, runRoot, 1, "sculpted"));

  await page.evaluate(() => window.__polyMorphDemo.setZoom(96));
  frames.push(await captureState(page, runRoot, 2, "zoomed"));

  await page.evaluate(() => window.__polyMorphDemo.reset());
  const sceneBox = await page.locator("[data-scene]").boundingBox();
  if (!sceneBox) throw new Error("Terrain scene is not painted.");
  await page.mouse.move(sceneBox.x + 12, sceneBox.y + 12);
  await page.mouse.down();
  await page.mouse.move(sceneBox.x + 112, sceneBox.y + 62, { steps: 8 });
  await page.mouse.up();
  frames.push(await captureState(page, runRoot, 3, "rotated"));

  await page.evaluate(() => window.__polyMorphDemo.reset());
  frames.push(await captureState(page, runRoot, 4, "reset"));

  await context.close();
  return { frames, consoleErrors, networkErrors };
}

function assertRun(run) {
  if (run.consoleErrors.length > 0) {
    throw new Error(`Browser console errors: ${run.consoleErrors.join(" | ")}`);
  }
  if (run.networkErrors.length > 0) {
    throw new Error(`Browser network errors: ${run.networkErrors.join(" | ")}`);
  }
  for (const frame of run.frames) {
    if (!frame.state.identityStable) {
      throw new Error(`${frame.name}: retained leaf identity drifted.`);
    }
    if (
      Object.values(frame.state.forbidden).some((value) => value !== 0)
    ) {
      throw new Error(`${frame.name}: forbidden runtime work was reported.`);
    }
  }
  const sculpted = run.frames.find(({ name }) => name === "sculpted").state;
  if (
    sculpted.mode !== "sculpted"
    || sculpted.selectedPatchId === null
    || sculpted.dirtyLeafIds.length === 0
    || sculpted.lastApply.leafTransformWrites !== sculpted.dirtyLeafIds.length
  ) {
    throw new Error("Terrain sculpt did not remain a sparse retained-leaf update.");
  }
  const zoomed = run.frames.find(({ name }) => name === "zoomed").state;
  if (zoomed.camera.zoom !== 96) {
    throw new Error("Terrain zoom did not apply.");
  }
  const front = run.frames.find(({ name }) => name === "front").state;
  const rotated = run.frames.find(({ name }) => name === "rotated").state;
  if (
    rotated.camera.rotX === front.camera.rotX
    && rotated.camera.rotY === front.camera.rotY
  ) {
    throw new Error("Black-space drag did not orbit the terrain.");
  }
  const reset = run.frames.find(({ name }) => name === "reset").state;
  if (
    reset.mode !== "ready"
    || reset.selectedPatchId !== null
    || reset.dirtyLeafIds.length !== 0
    || Object.keys(reset.patchValues).length !== 0
  ) {
    throw new Error("Terrain reset did not restore the neutral retained state.");
  }
}

export async function capturePolyMorphPlane({
  url,
  outputRoot = defaultOutput,
}) {
  const target = resolve(outputRoot);
  const staging = `${target}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let first;
  let second;
  try {
    first = await runSequence(browser, url, resolve(staging, "frames/run-a"));
    second = await runSequence(browser, url, resolve(staging, "frames/run-b"));
  } finally {
    await browser.close();
  }
  assertRun(first);
  assertRun(second);

  const statesA = first.frames.map(({ name, state }) => ({ name, state }));
  const statesB = second.frames.map(({ name, state }) => ({ name, state }));
  const stateExact = JSON.stringify(statesA) === JSON.stringify(statesB);
  const framesExact = first.frames.every((frame, index) =>
    frame.sha256 === second.frames[index].sha256);
  await writeFile(
    resolve(staging, "state-run-a.json"),
    `${JSON.stringify(statesA, null, 2)}\n`,
  );
  await writeFile(
    resolve(staging, "state-run-b.json"),
    `${JSON.stringify(statesB, null, 2)}\n`,
  );
  for (const [name, source] of [
    ["front.png", "000-front.png"],
    ["sculpted.png", "001-sculpted.png"],
    ["rotated.png", "003-rotated.png"],
  ]) {
    await copyFile(resolve(staging, "frames/run-a", source), resolve(staging, name));
  }
  const report = {
    schema: "polycss-morph.browser-proof@2",
    fixture: "morph-plane",
    url,
    viewport: { width: 1280, height: 960, deviceScaleFactor: 1 },
    stateExact,
    framesExact,
    frameHashes: first.frames.map((frame, index) => ({
      name: frame.name,
      runA: frame.sha256,
      runB: second.frames[index].sha256,
      bytes: frame.bytes,
    })),
    consoleErrors: [...first.consoleErrors, ...second.consoleErrors],
    networkErrors: [...first.networkErrors, ...second.networkErrors],
    retainedLeafCount: first.frames[0].state.leaves,
    sparseSculptDirtyLeaves:
      first.frames.find(({ name }) => name === "sculpted").state.dirtyLeafIds,
    schedulerCount: first.frames[0].state.forbidden.schedulerCallbacks,
    forbidden: first.frames.map(({ name, state }) => ({
      name,
      ...state.forbidden,
    })),
  };
  await writeFile(resolve(staging, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (!stateExact || !framesExact) {
    throw new Error(
      `Plane browser A/A failed: stateExact=${stateExact}, framesExact=${framesExact}`,
    );
  }
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
  return { ...report, outputRoot: target };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.argv[2] ?? "http://127.0.0.1:4187/";
  const outputRoot = process.argv[3] ?? defaultOutput;
  const result = await capturePolyMorphPlane({ url, outputRoot });
  console.log(JSON.stringify(result));
}
