import { createHash } from "node:crypto";
import {
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chromium,
  firefox,
  webkit,
} from "playwright";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptRoot, "../../..");
const defaultOutput = resolve(repoRoot, "output/playwright/morph-atlas");
const cases = [
  {
    id: "chromium-native",
    browserType: chromium,
    path: "prepared.html",
    strategy: "solid-triangle",
    forcedFallback: false,
  },
  {
    id: "chromium-fallback",
    browserType: chromium,
    path: "prepared.html?fallback=1",
    strategy: "atlas-slice",
    forcedFallback: true,
  },
  {
    id: "firefox-fallback",
    browserType: firefox,
    path: "prepared.html",
    strategy: "atlas-slice",
    forcedFallback: false,
  },
  {
    id: "webkit-fallback",
    browserType: webkit,
    path: "prepared.html",
    strategy: "atlas-slice",
    forcedFallback: false,
  },
];

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertProof(entry, proof) {
  if (
    proof?.ready !== true
    || proof.forcedFallback !== entry.forcedFallback
    || proof.leaves < 1
    || proof.dirtyLeaves < 1
    || proof.identityStable !== true
    || Object.values(proof.forbidden).some((value) => value !== 0)
    || proof.resolvedStrategies[entry.strategy] !== proof.leaves
    || Object.keys(proof.resolvedStrategies).length !== 1
  ) {
    throw new Error(`${entry.id}: prepared proof failed: ${JSON.stringify(proof)}`);
  }
  const fallback = entry.strategy === "atlas-slice";
  if (
    (fallback && proof.resourceResolutions < 1)
    || (!fallback && proof.resourceResolutions !== 0)
  ) {
    throw new Error(`${entry.id}: prepared resource resolution drifted`);
  }
}

async function captureCase(entry, baseUrl, staging) {
  const browser = await entry.browserType.launch({ headless: true });
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
  try {
    const url = new URL(entry.path, baseUrl).href;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => document.documentElement.dataset.preparedReady === "true",
    );
    const proof = await page.evaluate(() => window.__polyMorphPreparedProof);
    assertProof(entry, proof);
    if (consoleErrors.length > 0 || networkErrors.length > 0) {
      throw new Error(
        `${entry.id}: browser errors: ${[...consoleErrors, ...networkErrors].join(" | ")}`,
      );
    }
    const screenshot = await page.screenshot({
      animations: "disabled",
      caret: "hide",
      type: "png",
    });
    const filename = `${entry.id}.png`;
    await writeFile(resolve(staging, filename), screenshot);
    return {
      id: entry.id,
      browser: entry.browserType.name(),
      url,
      strategy: entry.strategy,
      proof,
      screenshot: {
        filename,
        bytes: screenshot.byteLength,
        sha256: hash(screenshot),
      },
      consoleErrors,
      networkErrors,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function capturePolyMorphPreparedBrowsers({
  baseUrl,
  outputRoot = defaultOutput,
}) {
  const target = resolve(outputRoot);
  const staging = `${target}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const normalizedBaseUrl = new URL("./", baseUrl).href;
  try {
    const results = [];
    for (const entry of cases) {
      results.push(await captureCase(entry, normalizedBaseUrl, staging));
    }
    const report = {
      schema: "polycss-morph.prepared-browser-proof@1",
      baseUrl: normalizedBaseUrl,
      viewport: { width: 1280, height: 960, deviceScaleFactor: 1 },
      cases: results,
    };
    await writeFile(
      resolve(staging, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    return { ...report, outputRoot: target };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const baseUrl = process.argv[2] ?? "http://127.0.0.1:4187/";
  const outputRoot = process.argv[3] ?? defaultOutput;
  const result = await capturePolyMorphPreparedBrowsers({ baseUrl, outputRoot });
  console.log(JSON.stringify(result));
}
