import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { chromium } from "playwright";
import { buildDom } from "../src/writer.js";
import { invariant } from "../src/errors.js";
import { crc32 } from "../src/crc32.js";
import { loadManifest } from "../src/manifest.js";
import { CSSGRAPHICS_REVISION, STABLE_CSSGRAPHICS_BROWSER_CONTRACTS } from "../test/cssgraphics-contracts.js";
import {
  syntheticAdapterTechniquesInput,
  syntheticAspectProfileTimelinesInput,
  syntheticCompositorTimingInput,
  syntheticCssGraphicsDemoInput,
  syntheticDynamicViewportProfilesInput,
  syntheticEvictingPagedVariantsInput,
  syntheticExactTimingInput,
  syntheticOrbitInput,
  syntheticPagedPlaybackChangesInput,
  syntheticPagedPreparedBanksInput,
  syntheticPagedProfileTimelinesWithoutInteractionInput,
  syntheticProfileTimelinesInput,
  syntheticViewportProfilesInput,
} from "../test/helpers.js";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "domformat-browser-release-"));
let server;
let launchedBrowser;

function contentType(path) {
  if (path.endsWith(".html")) return "text/html;charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript;charset=utf-8";
  if (path.endsWith(".json")) return "application/json;charset=utf-8";
  if (path.endsWith(".css")) return "text/css;charset=utf-8";
  if (path.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function availableBrowser() {
  const candidates = [
    process.env.DOMFORMAT_BROWSER,
    chromium.executablePath(),
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  invariant(false, "MISSING_RELEASE_BROWSER", "A Chromium-family browser is required for the real-browser release gate. Set DOMFORMAT_BROWSER to its executable path.");
}

function serve(explicitFiles, runtimeRoot, runtimeRequests) {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const explicit = explicitFiles.get(pathname);
      invariant(!pathname.startsWith("/src/") && !pathname.startsWith("/packages/domformat/"), "WORKSPACE_RUNTIME_IMPORT", `Browser smoke requested workspace runtime path ${pathname}.`);
      const installedRuntimeRequest = pathname.startsWith("/dist/");
      const sourceRoot = installedRuntimeRequest ? runtimeRoot : root;
      const target = explicit ?? resolve(sourceRoot, `.${pathname}`);
      invariant(explicit !== undefined || target.startsWith(`${sourceRoot}${sep}`), "UNSAFE_TEST_PATH", "Browser smoke request escaped its fixture root.");
      const bytes = await readFile(target);
      if (installedRuntimeRequest) runtimeRequests.push(Object.freeze({ pathname, target }));
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": bytes.length,
        "content-type": contentType(target),
      });
      response.end(bytes);
    } catch {
      response.writeHead(404, { "content-type": "text/plain;charset=utf-8" });
      response.end("missing");
    }
  });
}

function browserArguments() {
  return process.env.DOMFORMAT_BROWSER_NO_SANDBOX === "1"
    || (typeof process.getuid === "function" && process.getuid() === 0)
    ? ["--no-sandbox"]
    : [];
}

function diagnosticSuffix(status, diagnostics, error) {
  const entries = [
    status?.trim() ? `status: ${status.trim()}` : "",
    ...diagnostics,
    error instanceof Error ? error.message : error ? String(error) : "",
  ].filter(Boolean);
  return entries.length > 0 ? ` (${entries.join("; ").slice(0, 1000)})` : "";
}

async function withBrowserPage(browser, dimensions, label, action) {
  const context = await browser.newContext({
    viewport: dimensions,
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  const page = await context.newPage();
  const diagnostics = [];
  page.on("pageerror", (error) => diagnostics.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(`console error: ${message.text()}`);
  });
  let result;
  let primaryError;
  try {
    result = await action(page, diagnostics);
  } catch (error) {
    primaryError = error;
  }
  try {
    await context.close();
  } catch (error) {
    primaryError ??= error;
  }
  if (primaryError) throw primaryError;
  invariant(diagnostics.length === 0, "BROWSER_RELEASE_BROWSER", `${label} emitted browser errors${diagnosticSuffix("", diagnostics)}.`);
  return result;
}

async function waitForPublication(page, url, label, diagnostics, expectedPaintResources, paintBarrier = true) {
  let waitError;
  try {
    await page.goto(url, { waitUntil: "load", timeout: 20_000 });
    await page.waitForFunction(() => {
      const root = document.documentElement;
      return root.hasAttribute("data-domformat-ready") || root.hasAttribute("data-domformat-error");
    }, undefined, { polling: 50, timeout: 20_000 });
  } catch (error) {
    waitError = error;
  }
  const publication = await page.evaluate(() => ({
    ready: document.documentElement.hasAttribute("data-domformat-ready"),
    error: document.documentElement.hasAttribute("data-domformat-error"),
    status: document.querySelector("#status")?.textContent ?? "",
  })).catch(() => ({ ready: false, error: false, status: "" }));
  invariant(!waitError, "BROWSER_RELEASE_MOUNT", `${label} did not publish the retained DOM${diagnosticSuffix(publication.status, diagnostics, waitError)}.`);
  invariant(!publication.error, "BROWSER_RELEASE_MOUNT", `${label} reported a package mount failure${diagnosticSuffix(publication.status, diagnostics)}.`);
  invariant(publication.ready, "BROWSER_RELEASE_MOUNT", `${label} did not publish the retained DOM${diagnosticSuffix(publication.status, diagnostics)}.`);
  const resources = await page.evaluate(async () => {
    const urls = new Set();
    const urlPattern = /url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/gu;
    for (const element of document.querySelectorAll("*")) {
      const background = getComputedStyle(element).backgroundImage;
      for (const match of background.matchAll(urlPattern)) {
        const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
        if (value.startsWith("blob:")) urls.add(value);
      }
      for (const attribute of ["src", "href"]) {
        const value = element.getAttribute(attribute);
        if (value?.startsWith("blob:")) urls.add(value);
      }
    }
    let timeout;
    try {
      const decoded = [...urls].map(async (resource) => {
        const image = new Image();
        image.src = resource;
        await image.decode();
      });
      if (document.fonts) decoded.push(document.fonts.ready);
      await Promise.race([
        Promise.all(decoded),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("paint resources did not decode within 5 seconds")), 5_000);
        }),
      ]);
      return { decoded: true, count: urls.size, error: "" };
    } catch (error) {
      return { decoded: false, count: urls.size, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timeout);
    }
  });
  invariant(resources.count === expectedPaintResources, "BROWSER_RELEASE_PAINT", `${label} exposed ${resources.count} blob-backed paint resources instead of ${expectedPaintResources}.`);
  invariant(resources.decoded, "BROWSER_RELEASE_PAINT", `${label} did not decode ${resources.count} paint resources (${resources.error}).`);
  if (!paintBarrier) return;
  const paint = await page.evaluate(() => new Promise((resolvePaint) => {
    const timeout = setTimeout(() => resolvePaint(false), 2_000);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      clearTimeout(timeout);
      resolvePaint(true);
    }));
  }));
  invariant(paint, "BROWSER_RELEASE_PAINT", `${label} did not cross its two-frame paint barrier.`);
}

function uint32Be(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function decodeScreenshot(png, expectedWidth = 320, expectedHeight = 240) {
  const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  invariant(png.length > 8 && png.subarray(0, 8).equals(signature), "BROWSER_RELEASE_PAINT", "Browser screenshot is not PNG.");
  let offset = 8;
  let header;
  let ended = false;
  const imageData = [];
  while (offset < png.length) {
    invariant(offset + 12 <= png.length, "BROWSER_RELEASE_PAINT", "Browser screenshot has a truncated PNG chunk.");
    const length = uint32Be(png, offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + length;
    invariant(payloadEnd + 4 <= png.length, "BROWSER_RELEASE_PAINT", "Browser screenshot PNG chunk exceeds its bytes.");
    invariant(crc32(png.subarray(offset + 4, payloadEnd)) === uint32Be(png, payloadEnd), "BROWSER_RELEASE_PAINT", "Browser screenshot PNG CRC is invalid.");
    if (type === "IHDR") {
      invariant(!header && length === 13, "BROWSER_RELEASE_PAINT", "Browser screenshot PNG header is invalid.");
      header = {
        width: uint32Be(png, payloadStart),
        height: uint32Be(png, payloadStart + 4),
        bitDepth: png[payloadStart + 8],
        colorType: png[payloadStart + 9],
        compression: png[payloadStart + 10],
        filter: png[payloadStart + 11],
        interlace: png[payloadStart + 12],
      };
    } else if (type === "IDAT") {
      imageData.push(png.subarray(payloadStart, payloadEnd));
    } else if (type === "IEND") {
      invariant(length === 0 && payloadEnd + 4 === png.length, "BROWSER_RELEASE_PAINT", "Browser screenshot PNG end chunk is invalid.");
      ended = true;
    }
    offset = payloadEnd + 4;
  }
  invariant(header && ended && imageData.length > 0, "BROWSER_RELEASE_PAINT", "Browser screenshot PNG is incomplete.");
  invariant(header.width === expectedWidth && header.height === expectedHeight && header.bitDepth === 8
    && (header.colorType === 2 || header.colorType === 6)
    && header.compression === 0 && header.filter === 0 && header.interlace === 0,
  "BROWSER_RELEASE_PAINT", "Browser screenshot PNG has an unexpected raster format.");
  const bytesPerPixel = header.colorType === 6 ? 4 : 3;
  const stride = header.width * bytesPerPixel;
  const compressed = Buffer.concat(imageData.map((value) => Buffer.from(value)));
  const filtered = inflateSync(compressed);
  invariant(filtered.length === (stride + 1) * header.height, "BROWSER_RELEASE_PAINT", "Browser screenshot PNG raster length is invalid.");
  const pixels = new Uint8Array(stride * header.height);
  for (let y = 0; y < header.height; y += 1) {
    const filterType = filtered[y * (stride + 1)];
    invariant(filterType >= 0 && filterType <= 4, "BROWSER_RELEASE_PAINT", "Browser screenshot PNG uses an unknown row filter.");
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[y * (stride + 1) + x + 1];
      const left = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[(y - 1) * stride + x - bytesPerPixel] : 0;
      const predictor = filterType === 0 ? 0
        : filterType === 1 ? left
          : filterType === 2 ? up
            : filterType === 3 ? Math.floor((left + up) / 2)
              : paeth(left, up, upperLeft);
      pixels[y * stride + x] = (raw + predictor) & 0xff;
    }
  }
  return { ...header, bytesPerPixel, pixels };
}

function pairedPaintEvidence(referencePng, comparisonPng, label) {
  const reference = decodeScreenshot(referencePng, 320, 240);
  const comparison = decodeScreenshot(comparisonPng, 320, 240);
  invariant(reference.bytesPerPixel === comparison.bytesPerPixel, "BROWSER_RELEASE_PAINT", `${label} screenshots use different raster formats.`);
  let modelPixelDifferences = 0;
  let maximumChannelDelta = 0;
  const colors = new Map();
  let minimumLuma = 255;
  let maximumLuma = 0;
  let samples = 0;
  let minimumDifferenceX = 320;
  let minimumDifferenceY = 240;
  let maximumDifferenceX = -1;
  let maximumDifferenceY = -1;
  for (let y = 0; y < 240; y += 1) {
    for (let x = 0; x < 320; x += 1) {
      const offset = (y * 320 + x) * reference.bytesPerPixel;
      let different = false;
      for (let channel = 0; channel < reference.bytesPerPixel; channel += 1) {
        const delta = Math.abs(reference.pixels[offset + channel] - comparison.pixels[offset + channel]);
        maximumChannelDelta = Math.max(maximumChannelDelta, delta);
        if (delta !== 0) different = true;
      }
      if (different) {
        modelPixelDifferences += 1;
        minimumDifferenceX = Math.min(minimumDifferenceX, x);
        minimumDifferenceY = Math.min(minimumDifferenceY, y);
        maximumDifferenceX = Math.max(maximumDifferenceX, x);
        maximumDifferenceY = Math.max(maximumDifferenceY, y);
      }
      const red = reference.pixels[offset];
      const green = reference.pixels[offset + 1];
      const blue = reference.pixels[offset + 2];
      const color = `${red},${green},${blue}`;
      colors.set(color, (colors.get(color) ?? 0) + 1);
      const luma = Math.round((red * 54 + green * 183 + blue * 19) / 256);
      minimumLuma = Math.min(minimumLuma, luma);
      maximumLuma = Math.max(maximumLuma, luma);
      samples += 1;
    }
  }
  invariant(modelPixelDifferences === 0, "BROWSER_RELEASE_PAINT", `${label} differs in ${modelPixelDifferences} retained-DOM proof pixels (bounds ${minimumDifferenceX},${minimumDifferenceY}-${maximumDifferenceX},${maximumDifferenceY}; maximum channel delta ${maximumChannelDelta}).`);
  const populations = [...colors.values()].sort((left, right) => right - left);
  const secondaryCoverage = (populations[1] ?? 0) / samples;
  invariant(colors.size >= 2 && maximumLuma - minimumLuma >= 2 && secondaryCoverage >= 0.2, "BROWSER_RELEASE_PAINT", `Side-by-side model paint is uniform (${colors.size} colors; luma range ${maximumLuma - minimumLuma}; secondary coverage ${secondaryCoverage.toFixed(3)}).`);
  return Object.freeze({
    distinctColors: colors.size,
    lumaRange: maximumLuma - minimumLuma,
    secondaryCoverage,
    modelPixelDifferences,
    maximumChannelDelta,
  });
}

async function dumpedMount(browser, url, label, nodes, leaves, requiredLeafTag, sourceFrame) {
  const html = await withBrowserPage(browser, { width: 320, height: 240 }, label, async (page, diagnostics) => {
    await waitForPublication(page, url, label, diagnostics, 1);
    return page.content();
  });
  invariant(html.includes("data-domformat-mount-surface=\"\""), "BROWSER_RELEASE_MOUNT", `${label} lacks the isolated mount surface.`);
  invariant(html.includes(`data-domformat-source-frame="${sourceFrame}"`), "BROWSER_RELEASE_MOUNT", `${label} did not publish prepared source frame ${sourceFrame}.`);
  invariant(html.includes(`domformat@0 · ${nodes} nodes · ${leaves} leaves`), "BROWSER_RELEASE_MOUNT", `${label} has unexpected retained-DOM counts.`);
  invariant(new RegExp(`<${requiredLeafTag}(?:\\s|>)`, "u").test(html), "BROWSER_RELEASE_MOUNT", `${label} did not retain its required <${requiredLeafTag}> strategy leaf.`);
}

async function paintedPath(browser, url, label) {
  const png = await withBrowserPage(browser, { width: 320, height: 240 }, label, async (page, diagnostics) => {
    await waitForPublication(page, url, label, diagnostics, 1);
    const statusHidden = await page.evaluate(() => document.querySelector("#status")?.hidden === true);
    invariant(statusHidden, "BROWSER_RELEASE_PAINT", `${label} did not isolate model paint from viewer diagnostics.`);
    return page.screenshot({ type: "png" });
  });
  return png;
}

async function browserFixtureProof(browser, origin, modelUrl, slug, nodes, leaves, requiredLeafTag, sourceFrame) {
  const referenceUrl = `${origin}/viewer/index.html?model=${encodeURIComponent(modelUrl)}&animate=0&frame=${sourceFrame}`;
  const alternateUrl = `${referenceUrl}&implementation=conformance`;
  const nVersionUrl = `${origin}/test/nversion-viewer.html?model=${encodeURIComponent(modelUrl)}&animate=0&frame=${sourceFrame}`;
  await dumpedMount(browser, referenceUrl, `${slug} reference viewer`, nodes, leaves, requiredLeafTag, sourceFrame);
  await dumpedMount(browser, alternateUrl, `${slug} alternate mount`, nodes, leaves, requiredLeafTag, sourceFrame);
  await dumpedMount(browser, nVersionUrl, `${slug} N-version reader path`, nodes, leaves, requiredLeafTag, sourceFrame);

  const referencePng = await paintedPath(browser, `${referenceUrl}&proof=1`, `${slug} reference paint path`);
  const alternatePng = await paintedPath(browser, `${alternateUrl}&proof=1`, `${slug} alternate paint path`);
  const nVersionPng = await paintedPath(browser, `${nVersionUrl}&proof=1`, `${slug} N-version paint path`);
  const alternateComparison = pairedPaintEvidence(referencePng, alternatePng, `${slug} reference/alternate mount paths`);
  const nVersionComparison = pairedPaintEvidence(referencePng, nVersionPng, `${slug} reference/N-version reader paths`);
  return Object.freeze({
    slug,
    sourceFrame,
    nodes,
    leaves,
    alternateMountPaintedDistinctColors: alternateComparison.distinctColors,
    alternateMountPaintedLumaRange: alternateComparison.lumaRange,
    alternateMountPaintedSecondaryCoverage: alternateComparison.secondaryCoverage,
    alternateMountPaintedPngBytes: alternatePng.length,
    alternateMountModelPixelsIdentical: alternateComparison.modelPixelDifferences === 0,
    alternateMountMaximumChannelDelta: alternateComparison.maximumChannelDelta,
    nVersionProbePaintedDistinctColors: nVersionComparison.distinctColors,
    nVersionProbePaintedLumaRange: nVersionComparison.lumaRange,
    nVersionProbePaintedSecondaryCoverage: nVersionComparison.secondaryCoverage,
    nVersionProbePaintedPngBytes: nVersionPng.length,
    nVersionProbeModelPixelsIdentical: nVersionComparison.modelPixelDifferences === 0,
    nVersionProbeMaximumChannelDelta: nVersionComparison.maximumChannelDelta,
  });
}

async function preparedTechniqueProof(browser, url, label) {
  return withBrowserPage(browser, { width: 320, height: 240 }, label, async (page, diagnostics) => {
    await waitForPublication(page, url, label, diagnostics, 1);
    const proof = await page.evaluate(async () => {
      const leaf = document.querySelector('[data-domformat-node="2"]');
      const before = {
        address: leaf?.style.backgroundPosition,
        classes: [...(leaf?.classList ?? [])],
        color: leaf ? getComputedStyle(leaf).color : "",
        visibility: leaf?.style.visibility,
      };
      const observer = new MutationObserver(() => {});
      observer.observe(leaf, { attributes: true, attributeOldValue: true, attributeFilter: ["class", "style"] });
      globalThis.domformatProof.seek(2);
      const mutations = observer.takeRecords().map((record) => ({ attribute: record.attributeName, oldValue: record.oldValue }));
      observer.disconnect();
      await new Promise((resolvePaint) => requestAnimationFrame(() => requestAnimationFrame(resolvePaint)));
      const current = document.querySelector("i.leaf");
      return {
        sameNode: current === leaf,
        before,
        after: {
          address: current?.style.backgroundPosition,
          classes: [...(current?.classList ?? [])],
          color: current ? getComputedStyle(current).color : "",
          visibility: current?.style.visibility,
        },
        mutations,
      };
    });
    invariant(proof.sameNode, "BROWSER_RELEASE_MOUNT", `${label} replaced the retained variant target.`);
    invariant(proof.before.address === "0px 0px" && proof.before.classes.includes("material-a") && proof.before.color === "rgb(255, 0, 0)" && proof.before.visibility === "hidden", "BROWSER_RELEASE_MOUNT", `${label} did not publish the prepared hidden initial variant/address.`);
    invariant(proof.after.address === "-16px -16px" && proof.after.classes.includes("material-b") && !proof.after.classes.includes("material-a") && proof.after.color === "rgb(0, 255, 0)" && proof.after.visibility === "visible", "BROWSER_RELEASE_MOUNT", `${label} did not publish the prepared noninitial variant/address/reveal.`);
    invariant(proof.mutations.length === 4 && proof.mutations[0].attribute === "class" && proof.mutations[1].attribute === "class" && proof.mutations[2].attribute === "style" && proof.mutations[3].attribute === "style", "BROWSER_RELEASE_MOUNT", `${label} did not publish class, address, then reveal in order.`);
    invariant(proof.mutations[2].oldValue?.includes("background-position: 0px 0px") && proof.mutations[2].oldValue?.includes("visibility: hidden") && proof.mutations[3].oldValue?.includes("background-position: -16px -16px") && proof.mutations[3].oldValue?.includes("visibility: hidden"), "BROWSER_RELEASE_MOUNT", `${label} exposed the retained leaf before its prepared address was current.`);
    return proof;
  });
}

async function pagedStateProof(browser, url, label) {
  return withBrowserPage(browser, { width: 320, height: 240 }, label, async (page, diagnostics) => {
    const requests = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/paged/state/")) requests.push(pathname.split("/").at(-1));
    });
    await waitForPublication(page, url, label, diagnostics, 1);
    await page.waitForTimeout(50);
    invariant(requests.join(",") === "variant-page-1.json,variant-page-2.json", "BROWSER_RELEASE_PAGED_STATE", `${label} did not lazily request only its initial/current-lookahead window (${requests.join(",")}).`);
    const publication = await page.evaluate(async () => {
      const leaf = document.querySelector('[data-domformat-node="2"]');
      const identity = leaf;
      const initial = { frame: globalThis.domformatProof.sourceFrame, classes: [...leaf.classList] };
      await globalThis.domformatProof.seekAsync(8);
      const frame8 = { frame: globalThis.domformatProof.sourceFrame, classes: [...leaf.classList] };
      await globalThis.domformatProof.seekAsync(4);
      const frame4 = { frame: globalThis.domformatProof.sourceFrame, classes: [...leaf.classList] };
      await globalThis.domformatProof.seekAsync(5);
      const frame5 = { frame: globalThis.domformatProof.sourceFrame, classes: [...leaf.classList] };
      await globalThis.domformatProof.seekAsync(8);
      const revisitedFrame8 = { frame: globalThis.domformatProof.sourceFrame, classes: [...leaf.classList] };
      await globalThis.domformatProof.seekAsync(1);
      return {
        sameNode: document.querySelector('[data-domformat-node="2"]') === identity,
        initial,
        frame8,
        frame4,
        frame5,
        revisitedFrame8,
        revisitedFrame1: { frame: globalThis.domformatProof.sourceFrame, classes: [...leaf.classList] },
      };
    });
    const counts = Object.fromEntries([...new Set(requests)].map((name) => [name, requests.filter((candidate) => candidate === name).length]));
    invariant(publication.sameNode && publication.initial.frame === 1 && publication.initial.classes.includes("material-a") && publication.frame8.frame === 8 && publication.frame8.classes.includes("material-b") && publication.frame4.frame === 4 && publication.frame4.classes.includes("material-b") && publication.frame5.frame === 5 && publication.frame5.classes.includes("material-a") && publication.revisitedFrame8.frame === 8 && publication.revisitedFrame8.classes.includes("material-b") && publication.revisitedFrame1.frame === 1 && publication.revisitedFrame1.classes.includes("material-a"), "BROWSER_RELEASE_PAGED_STATE", `${label} did not retain one target while publishing requested pages.`);
    invariant(counts["variant-page-1.json"] === 1 && counts["variant-page-2.json"] === 1 && counts["variant-page-3.json"] === 1 && counts["variant-page-4.json"] === 1 && counts["variant-page-5.json"] === 1 && counts["variant-page-6.json"] === 2, "BROWSER_RELEASE_PAGED_STATE", `${label} request log does not prove bounded nonpinned eviction with a pinned playback-initial page (${JSON.stringify(counts)}).`);
    return Object.freeze({ label, requests, counts, publication });
  });
}

async function combinedPagedStateProof(browser, url, label) {
  return withBrowserPage(browser, { width: 320, height: 240 }, label, async (page, diagnostics) => {
    const requests = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/paged-combined/state/")) requests.push(pathname.split("/").at(-1));
    });
    await waitForPublication(page, url, label, diagnostics, 1);
    await page.waitForTimeout(50);
    const independentReader = label.includes("nversion");
    invariant(new Set(requests).size === (independentReader ? 5 : 4)
      && requests.includes("playback-page-1.json") && requests.includes("playback-page-2.json")
      && requests.includes("variant-page-1.json") && requests.includes("variant-page-2.json")
      && (!independentReader || requests.includes("playback-page-4.json")),
    "BROWSER_RELEASE_PAGED_STATE", `${label} did not lazily load the exact combined current/lookahead window (${requests.join(",")}).`);
    const publication = await page.evaluate(async () => {
      const shape = document.querySelector('[data-domformat-node="1"]');
      const leaf = document.querySelector('[data-domformat-node="2"]');
      const identity = leaf;
      const read = () => ({
        sourceFrame: globalThis.domformatProof.sourceFrame,
        classes: [...leaf.classList],
        shapeTransform: shape.style.transform,
        shapeVisibility: shape.style.visibility,
        leafTransform: leaf.style.transform,
      });
      const initial = read();
      await globalThis.domformatProof.seekAsync(8);
      const frame8 = read();
      await globalThis.domformatProof.seekAsync(4);
      const frame4 = read();
      await globalThis.domformatProof.seekAsync(5);
      const frame5 = read();
      await globalThis.domformatProof.seekAsync(1);
      return {
        sameLeaf: document.querySelector('[data-domformat-node="2"]') === identity,
        leafCount: globalThis.domformatProof.leaves,
        initial,
        frame8,
        frame4,
        frame5,
        frame1: read(),
      };
    });
    invariant(publication.sameLeaf && publication.leafCount === 2
      && publication.initial.sourceFrame === 1 && publication.initial.classes.includes("material-a")
      && publication.frame8.sourceFrame === 8 && publication.frame8.classes.includes("material-b")
      && publication.frame4.sourceFrame === 4 && publication.frame4.classes.includes("material-b")
      && publication.frame5.sourceFrame === 5
      && publication.frame1.sourceFrame === 1 && publication.frame1.classes.includes("material-a")
      && publication.initial.shapeVisibility === "visible" && publication.frame4.shapeVisibility === "hidden"
      && publication.frame4.shapeTransform !== publication.initial.shapeTransform
      && publication.frame8.shapeTransform === publication.frame4.shapeTransform
      && publication.frame4.leafTransform === publication.initial.leafTransform
      && publication.frame5.leafTransform !== publication.initial.leafTransform
      && publication.frame8.leafTransform === publication.frame5.leafTransform
      && publication.frame1.shapeVisibility === "visible"
      && publication.frame1.shapeTransform === publication.initial.shapeTransform
      && publication.frame1.leafTransform === publication.initial.leafTransform,
    "BROWSER_RELEASE_PAGED_STATE", `${label} did not atomically publish combined playback and variant seeks (${JSON.stringify(publication)}).`);
    invariant(requests.some((name) => name === "playback-page-4.json") && requests.some((name) => name === "variant-page-4.json")
      && requests.some((name) => name === "playback-page-3.json") && requests.some((name) => name === "variant-page-3.json"),
    "BROWSER_RELEASE_PAGED_STATE", `${label} did not request both channel pages for lazy random seeks (${requests.join(",")}).`);
    return Object.freeze({ label, requests, publication });
  });
}

async function viewportProfileProof(browser, url, label) {
  return withBrowserPage(browser, { width: 320, height: 240 }, label, async (page, diagnostics) => {
    await waitForPublication(page, url, label, diagnostics, 1);
    const initial = await page.evaluate(() => {
      const camera = document.querySelector(".camera");
      const leaf = document.querySelector('[data-domformat-node="2"]');
      globalThis.__domformatProfileNodes = { camera, leaf };
      globalThis.domformatProof.seek(2);
      return { cameraTransform: camera.style.transform, leafVisibility: leaf.style.visibility };
    });
    await page.setViewportSize({ width: 640, height: 480 });
    await page.evaluate(() => new Promise((resolvePaint) => requestAnimationFrame(() => requestAnimationFrame(resolvePaint))));
    const desktop = await page.evaluate(() => {
      const { camera, leaf } = globalThis.__domformatProfileNodes;
      return {
        sameCamera: document.querySelector(".camera") === camera,
        sameLeaf: document.querySelector('[data-domformat-node="2"]') === leaf,
        cameraTransform: camera.style.transform,
        leafVisibility: leaf.style.visibility,
        leafAddress: leaf.style.backgroundPositionY,
      };
    });
    invariant(initial.cameraTransform.includes("rotate(90deg)") && initial.leafVisibility === "hidden", "BROWSER_RELEASE_VIEWPORT", `${label} did not publish the mobile root/per-leaf profile.`);
    invariant(desktop.sameCamera && desktop.sameLeaf && !desktop.cameraTransform.includes("rotate(90deg)") && desktop.leafVisibility === "visible" && desktop.leafAddress === "-32px", "BROWSER_RELEASE_VIEWPORT", `${label} did not retain and reveal the desktop root/per-leaf profile.`);
    return Object.freeze({ label, initial, desktop });
  });
}

async function dynamicViewportProfileProof(browser, url, label) {
  return withBrowserPage(browser, { width: 320, height: 240 }, label, async (page, diagnostics) => {
    await waitForPublication(page, url, label, diagnostics, 1);
    const mobile = await page.evaluate(() => {
      const leaf = document.querySelector('[data-domformat-node="2"]');
      globalThis.__domformatDynamicProfileLeaf = leaf;
      const initial = leaf.style.visibility;
      globalThis.domformatProof.seek(2);
      return { initial, frame2: leaf.style.visibility };
    });
    await page.setViewportSize({ width: 640, height: 480 });
    await page.evaluate(() => new Promise((resolvePaint) => requestAnimationFrame(() => requestAnimationFrame(resolvePaint))));
    const desktop = await page.evaluate(() => {
      const leaf = globalThis.__domformatDynamicProfileLeaf;
      const matrix = new DOMMatrix(leaf.style.transform);
      return { sameLeaf: document.querySelector('[data-domformat-node="2"]') === leaf, matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f] };
    });
    await page.setViewportSize({ width: 800, height: 600 });
    await page.evaluate(() => new Promise((resolvePaint) => requestAnimationFrame(() => requestAnimationFrame(resolvePaint))));
    const resized = await page.evaluate(() => {
      const leaf = globalThis.__domformatDynamicProfileLeaf;
      const matrix = new DOMMatrix(leaf.style.transform);
      return { sameLeaf: document.querySelector('[data-domformat-node="2"]') === leaf, matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f] };
    });
    invariant(mobile.initial === "hidden" && mobile.frame2 === "visible", "BROWSER_RELEASE_VIEWPORT", `${label} did not publish profile-specific source-frame visibility (${JSON.stringify(mobile)}).`);
    invariant(desktop.sameLeaf && JSON.stringify(desktop.matrix) === JSON.stringify([0, 2, -3, 0, 68, 107]), "BROWSER_RELEASE_VIEWPORT", `${label} did not publish the capped 640x480 responsive affine row (${JSON.stringify(desktop)}).`);
    invariant(resized.sameLeaf && JSON.stringify(resized.matrix) === JSON.stringify([0, 2, -3, 0, 84, 131]), "BROWSER_RELEASE_VIEWPORT", `${label} did not recompute the same-profile 800x600 affine row (${JSON.stringify(resized)}).`);
    return Object.freeze({ label, mobile, desktop, resized });
  });
}

async function profileTimelineProof(browser, url, label) {
  return withBrowserPage(browser, { width: 320, height: 240 }, label, async (page, diagnostics) => {
    await waitForPublication(page, url, label, diagnostics, 1);
    await page.waitForFunction(() => globalThis.domformatProof.sourceFrame === 3);
    const interaction = await page.evaluate(() => ({
      mode: globalThis.domformatProof.setMode("interaction"),
      sourceFrame: globalThis.domformatProof.sourceFrame,
    }));
    await page.setViewportSize({ width: 640, height: 480 });
    await page.evaluate(() => new Promise((resolvePaint) => requestAnimationFrame(() => requestAnimationFrame(resolvePaint))));
    const preserved = await page.evaluate(() => ({ mode: globalThis.domformatProof.mode, sourceFrame: globalThis.domformatProof.sourceFrame }));
    const reentry = await page.evaluate(() => ({
      mode: globalThis.domformatProof.setMode("animation"),
      sourceFrame: globalThis.domformatProof.sourceFrame,
    }));
    await page.waitForFunction(() => globalThis.domformatProof.sourceFrame === 2);
    const desktop = await page.evaluate(() => ({ mode: globalThis.domformatProof.mode, sourceFrame: globalThis.domformatProof.sourceFrame }));
    invariant(interaction.mode === "interaction" && interaction.sourceFrame === 3 && preserved.mode === "interaction" && preserved.sourceFrame === 3, "BROWSER_RELEASE_PROFILE_TIMELINE", `${label} overwrote interaction state during profile selection.`);
    invariant(reentry.mode === "animation" && reentry.sourceFrame === 1 && desktop.mode === "animation" && desktop.sourceFrame === 2, "BROWSER_RELEASE_PROFILE_TIMELINE", `${label} did not restart and execute the selected baseline schedule.`);
    return Object.freeze({ label, interaction, preserved, reentry, desktop });
  });
}

async function aspectProfileTimelineProof(browser, url, label) {
  return withBrowserPage(browser, { width: 320, height: 240 }, label, async (page, diagnostics) => {
    await waitForPublication(page, url, label, diagnostics, 1);
    await page.waitForFunction(() => globalThis.domformatProof.sourceFrame === 2);
    const landscape = await page.evaluate(() => {
      const camera = document.querySelector(".camera");
      const leaf = document.querySelector('[data-domformat-node="2"]');
      globalThis.__domformatAspectNodes = { camera, leaf };
      return { sourceFrame: globalThis.domformatProof.sourceFrame, cameraTransform: camera.style.transform, leafVisibility: leaf.style.visibility };
    });
    const interaction = await page.evaluate(() => ({ mode: globalThis.domformatProof.setMode("interaction"), sourceFrame: globalThis.domformatProof.sourceFrame }));
    await page.setViewportSize({ width: 240, height: 320 });
    await page.evaluate(() => new Promise((resolvePaint) => requestAnimationFrame(() => requestAnimationFrame(resolvePaint))));
    const preserved = await page.evaluate(() => {
      const { camera, leaf } = globalThis.__domformatAspectNodes;
      return {
        mode: globalThis.domformatProof.mode,
        sourceFrame: globalThis.domformatProof.sourceFrame,
        sameCamera: document.querySelector(".camera") === camera,
        sameLeaf: document.querySelector('[data-domformat-node="2"]') === leaf,
        cameraTransform: camera.style.transform,
        leafVisibility: leaf.style.visibility,
      };
    });
    const reentry = await page.evaluate(() => ({ mode: globalThis.domformatProof.setMode("animation"), sourceFrame: globalThis.domformatProof.sourceFrame }));
    await page.waitForFunction(() => globalThis.domformatProof.sourceFrame === 3);
    const phone = await page.evaluate(() => ({ mode: globalThis.domformatProof.mode, sourceFrame: globalThis.domformatProof.sourceFrame }));
    invariant(landscape.sourceFrame === 2 && !landscape.cameraTransform.includes("rotate(90deg)") && landscape.leafVisibility === "visible", "BROWSER_RELEASE_PROFILE_TIMELINE", `${label} did not select the 320x240 landscape baseline before publication.`);
    invariant(interaction.mode === "interaction" && interaction.sourceFrame === 3 && preserved.mode === "interaction" && preserved.sourceFrame === 3 && preserved.sameCamera && preserved.sameLeaf && preserved.cameraTransform.includes("rotate(90deg)") && preserved.leafVisibility === "hidden", "BROWSER_RELEASE_PROFILE_TIMELINE", `${label} did not select the portrait phone presentation while preserving interaction state.`);
    invariant(reentry.mode === "animation" && reentry.sourceFrame === 1 && phone.mode === "animation" && phone.sourceFrame === 3, "BROWSER_RELEASE_PROFILE_TIMELINE", `${label} did not restart and execute the portrait phone schedule.`);
    return Object.freeze({ label, landscape, interaction, preserved, reentry, phone });
  });
}

async function pinnedProfileRestartProof(browser, url, label) {
  return withBrowserPage(browser, { width: 320, height: 240 }, label, async (page, diagnostics) => {
    const requests = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/paged-profile/state/")) requests.push(pathname.split("/").at(-1));
    });
    await waitForPublication(page, url, label, diagnostics, 1);
    await page.evaluate(() => globalThis.domformatProof.seekAsync(5));
    await page.setViewportSize({ width: 640, height: 480 });
    await page.evaluate(() => new Promise((resolvePaint) => requestAnimationFrame(() => requestAnimationFrame(resolvePaint))));
    const publication = await page.evaluate(() => ({
      lifecycle: globalThis.domformatProof.lifecycle.phase,
      sourceFrame: globalThis.domformatProof.sourceFrame,
    }));
    invariant(publication.lifecycle === "publish" && publication.sourceFrame === 1, "BROWSER_RELEASE_PROFILE_TIMELINE", `${label} could not restart from the pinned playback-initial page.`);
    invariant(requests.filter((name) => name === "variant-page-1.json").length === 1, "BROWSER_RELEASE_PROFILE_TIMELINE", `${label} refetched its supposedly pinned playback-initial page.`);
    return Object.freeze({ label, requests, publication });
  });
}

async function preparedBankProof(browser, url, label) {
  return withBrowserPage(browser, { width: 320, height: 240 }, label, async (page, diagnostics) => {
    await waitForPublication(page, url, label, diagnostics, 1);
    const proof = await page.evaluate(async () => {
      const model = document.querySelector(".scene");
      const leaf = document.querySelector('[data-domformat-node="2"]');
      const initial = { bankId: globalThis.domformatProof.bankId, sourceFrame: globalThis.domformatProof.sourceFrame };
      await globalThis.domformatProof.selectBankAsync("beta");
      const beta = { bankId: globalThis.domformatProof.bankId, sourceFrame: globalThis.domformatProof.sourceFrame, sameModel: document.querySelector(".scene") === model, sameLeaf: document.querySelector('[data-domformat-node="2"]') === leaf };
      await globalThis.domformatProof.selectBankAsync("gamma");
      const gamma = { bankId: globalThis.domformatProof.bankId, sourceFrame: globalThis.domformatProof.sourceFrame, sameModel: document.querySelector(".scene") === model, sameLeaf: document.querySelector('[data-domformat-node="2"]') === leaf };
      globalThis.domformatProof.setMode("interaction");
      let interactionError = null;
      try { globalThis.domformatProof.selectBank("alpha"); } catch (error) { interactionError = error?.code ?? String(error); }
      globalThis.domformatProof.setMode("animation");
      const reentry = { bankId: globalThis.domformatProof.bankId, sourceFrame: globalThis.domformatProof.sourceFrame, sameModel: document.querySelector(".scene") === model, sameLeaf: document.querySelector('[data-domformat-node="2"]') === leaf };
      return { initial, beta, gamma, interactionError, reentry };
    });
    invariant(proof.initial.bankId === "alpha" && proof.initial.sourceFrame === 1, "BROWSER_RELEASE_BANK", `${label} did not publish the canonical initial bank.`);
    invariant(proof.beta.bankId === "beta" && proof.beta.sourceFrame === 3 && proof.beta.sameModel && proof.beta.sameLeaf, "BROWSER_RELEASE_BANK", `${label} did not atomically publish retained beta bank state.`);
    invariant(proof.gamma.bankId === "gamma" && proof.gamma.sourceFrame === 5 && proof.gamma.sameModel && proof.gamma.sameLeaf, "BROWSER_RELEASE_BANK", `${label} did not atomically publish retained gamma bank state.`);
    invariant(proof.interactionError === "INVALID_EXPERIENCE_MODE" && proof.reentry.bankId === "gamma" && proof.reentry.sourceFrame === 5 && proof.reentry.sameModel && proof.reentry.sameLeaf, "BROWSER_RELEASE_BANK", `${label} did not preserve host-policy and selected-bank restart boundaries.`);
    return Object.freeze({ label, ...proof });
  });
}

async function orbitInputProof(browser, url, label) {
  return withBrowserPage(browser, { width: 320, height: 240 }, label, async (page, diagnostics) => {
    await waitForPublication(page, url, label, diagnostics, 1);
    const proof = await page.evaluate(() => {
      const model = document.querySelector(".scene");
      const leaf = document.querySelector('[data-domformat-node="2"]');
      const identity = { model, leaf };
      const yaw = globalThis.domformatProof.setInput("orbit.yaw", 90);
      const pitch = globalThis.domformatProof.setInput("orbit.pitch", 100);
      const zoom = globalThis.domformatProof.setInput("orbit.zoom", 0);
      return {
        sameModel: document.querySelector(".scene") === identity.model,
        sameLeaf: document.querySelector('[data-domformat-node="2"]') === identity.leaf,
        yaw,
        pitch,
        zoom,
        modelTransform: model.style.transform,
        leafAddress: leaf.style.backgroundPosition,
      };
    });
    invariant(proof.sameModel && proof.sameLeaf && proof.yaw === 90 && proof.pitch === 28 && proof.zoom === 0.5, "BROWSER_RELEASE_ORBIT", `${label} did not clamp orbit input on retained nodes.`);
    invariant(proof.modelTransform.includes("rotateX(28deg)") && proof.modelTransform.includes("rotateY(90deg)") && proof.modelTransform.includes("scale3d(0.5, 0.516, 0.5)") && proof.leafAddress === "0px -480px", "BROWSER_RELEASE_ORBIT", `${label} did not publish prepared orbit transform/address state (${JSON.stringify(proof)}).`);
    return Object.freeze({ label, ...proof });
  });
}

async function compositorTimingProof(browser, url, label, animate) {
  return withBrowserPage(browser, { width: 320, height: 240 }, label, async (page, diagnostics) => {
    await waitForPublication(page, url, label, diagnostics, 1);
    const initialFrame = await page.evaluate(() => globalThis.domformatProof.sourceFrame);
    await page.waitForTimeout(160);
    const beforeSeek = await page.evaluate(() => {
      const animation = document.querySelector(".scene").getAnimations()[0];
      return { frame: globalThis.domformatProof.sourceFrame, animationCount: document.querySelector(".scene").getAnimations().length, playState: animation?.playState, currentTime: Number(animation?.currentTime) };
    });
    const seek = await page.evaluate(() => {
      const model = document.querySelector(".scene");
      const leaf = document.querySelector('[data-domformat-node="2"]');
      const animation = model.getAnimations()[0];
      const identity = model;
      globalThis.domformatProof.seek(4);
      const inlineMatrix = new DOMMatrixReadOnly(leaf.style.transform).toFloat64Array();
      const computedMatrix = new DOMMatrixReadOnly(getComputedStyle(leaf).transform).toFloat64Array();
      return {
        sameModel: document.querySelector(".scene") === identity,
        frame: globalThis.domformatProof.sourceFrame,
        playState: animation.playState,
        currentTime: Number(animation.currentTime),
        leafTransition: leaf.style.transition,
        snapDelta: Math.max(...inlineMatrix.map((value, index) => Math.abs(value - computedMatrix[index]))),
      };
    });
    const logicalTick = seek.currentTime / (1000 / 30);
    invariant(beforeSeek.animationCount === 1 && seek.sameModel && seek.frame === 4 && Math.abs(logicalTick - Math.round(logicalTick)) < 0.01 && seek.snapDelta < 1e-6, "BROWSER_RELEASE_COMPOSITOR", `${label} did not snap retained compositor state to the prepared logical tick (${JSON.stringify(seek)}).`);
    if (animate) {
      invariant(beforeSeek.frame !== initialFrame && seek.playState === "running" && seek.leafTransition !== "none", "BROWSER_RELEASE_COMPOSITOR", `${label} did not keep logical playback and compositor timing active.`);
    } else {
      invariant(beforeSeek.frame === initialFrame && beforeSeek.playState === "paused" && seek.playState === "paused" && seek.leafTransition === "none", "BROWSER_RELEASE_ANIMATE_FALSE", `${label} advanced or resumed compositor state despite animate:false.`);
    }
    return Object.freeze({ label, animate, initialFrame, beforeSeek, seek });
  });
}

async function exactTimingProof(browser, url, label, stallMs, expectedFrame, forcePrequeued = false) {
  return withBrowserPage(browser, { width: 320, height: 240 }, label, async (page, diagnostics) => {
    await page.addInitScript(() => {
      const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
      const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
      const queued = new Map();
      let nextQueuedId = -1;
      let released = false;
      window.requestAnimationFrame = (callback) => {
        if (released) return nativeRequestAnimationFrame(callback);
        const id = nextQueuedId;
        nextQueuedId -= 1;
        queued.set(id, callback);
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        if (!queued.delete(id)) nativeCancelAnimationFrame(id);
      };
      globalThis.__domformatTimingGate = Object.freeze({
        get queuedCount() { return queued.size; },
        release() {
          if (released) return;
          released = true;
          for (const callback of queued.values()) window.requestAnimationFrame(callback);
          queued.clear();
        },
      });
    });
    await waitForPublication(page, url, label, diagnostics, 1, false);
    if (forcePrequeued) {
      await page.evaluate(() => globalThis.domformatProof.seek(1));
      await page.waitForTimeout(50);
      const queuedCount = await page.evaluate(() => globalThis.__domformatTimingGate.queuedCount);
      invariant(queuedCount > 0, "BROWSER_RELEASE_TIMING", `${label} did not force a startup scheduler callback into the pre-release queue.`);
    }
    const proof = await page.evaluate(async ({ duration, resetBeforeStall }) => {
      const leaf = document.querySelector('[data-domformat-node="2"]');
      if (!leaf) throw new Error("The timing proof did not mount its retained leaf.");
      let settled = false;
      let rejectPublication;
      let resolvePublication;
      let timeout;
      const firstPublication = new Promise((resolveFirst, rejectFirst) => {
        resolvePublication = resolveFirst;
        rejectPublication = rejectFirst;
        timeout = setTimeout(() => {
          settled = true;
          rejectFirst(new Error("The first post-stall scheduler publication did not occur."));
        }, 2_000);
      });
      const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => nativeRequestAnimationFrame((timestamp) => {
        try {
          callback(timestamp);
        } catch (error) {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            rejectPublication(error);
          }
          return;
        }
        if (settled || globalThis.domformatProof.sourceFrame === 1) return;
        settled = true;
        clearTimeout(timeout);
        const result = {
          sourceFrame: globalThis.domformatProof.sourceFrame,
          sameLeaf: document.querySelector('[data-domformat-node="2"]') === leaf,
        };
        globalThis.domformatProof.destroy();
        resolvePublication(result);
      });
      if (resetBeforeStall) globalThis.domformatProof.seek(1);
      const start = performance.now();
      while (performance.now() - start < duration) {}
      globalThis.__domformatTimingGate.release();
      return firstPublication;
    }, { duration: stallMs, resetBeforeStall: !forcePrequeued });
    invariant(proof.sourceFrame === expectedFrame && proof.sameLeaf, "BROWSER_RELEASE_TIMING", `${label} first post-stall publication was frame ${proof.sourceFrame}, expected ${expectedFrame}, or replaced retained identity.`);
    return Object.freeze({ label, stallMs, prequeued: forcePrequeued, ...proof });
  });
}

async function cssGraphicsDemoProof(browser, url, contract, implementation) {
  const label = `${contract.label} ${implementation} compatibility`;
  return withBrowserPage(browser, { width: 320, height: 240 }, label, async (page, diagnostics) => {
    await waitForPublication(page, url, label, diagnostics, 1);
    const initial = await page.evaluate(() => {
      const model = document.querySelector(".scene");
      const leaf = document.querySelector('[data-domformat-node="2"]');
      globalThis.__cssGraphicsCompatibilityNodes = { model, leaf };
      return {
        sourceFrame: globalThis.domformatProof.sourceFrame,
        bankId: globalThis.domformatProof.bankId,
        lifecycle: globalThis.domformatProof.lifecycle.phase,
        className: leaf.className,
        color: getComputedStyle(leaf).color,
        transform: leaf.style.transform,
        visibility: leaf.style.visibility,
        address: leaf.style.backgroundPosition || leaf.style.backgroundPositionY,
        modelTransform: model.style.transform,
        shapeTransform: document.querySelector('[data-domformat-node="1"]')?.style.transform ?? "",
        cameraTransform: document.querySelector(".camera").style.transform,
      };
    });
    const sought = await page.evaluate(async () => {
      await globalThis.domformatProof.seekAsync(2);
      const leaf = globalThis.__cssGraphicsCompatibilityNodes.leaf;
      return {
        sourceFrame: globalThis.domformatProof.sourceFrame,
        bankId: globalThis.domformatProof.bankId,
        className: leaf.className,
        color: getComputedStyle(leaf).color,
        transform: leaf.style.transform,
        visibility: leaf.style.visibility,
        address: leaf.style.backgroundPosition || leaf.style.backgroundPositionY,
        modelTransform: globalThis.__cssGraphicsCompatibilityNodes.model.style.transform,
        shapeTransform: document.querySelector('[data-domformat-node="1"]')?.style.transform ?? "",
      };
    });
    let selected = null;
    if (contract.techniques.includes("prepared-banks")) {
      selected = await page.evaluate(async () => {
        await globalThis.domformatProof.selectBankAsync("beta");
        const leaf = globalThis.__cssGraphicsCompatibilityNodes.leaf;
        return { bankId: globalThis.domformatProof.bankId, sourceFrame: globalThis.domformatProof.sourceFrame, className: leaf.className, color: getComputedStyle(leaf).color, transform: leaf.style.transform, visibility: leaf.style.visibility, address: leaf.style.backgroundPosition || leaf.style.backgroundPositionY, modelTransform: globalThis.__cssGraphicsCompatibilityNodes.model.style.transform, shapeTransform: document.querySelector('[data-domformat-node="1"]')?.style.transform ?? "" };
      });
    }
    const responsiveViewport = contract.id === "solitaire" ? { width: 800, height: 600 } : { width: 640, height: 480 };
    await page.setViewportSize(responsiveViewport);
    await page.evaluate(() => new Promise((resolvePaint) => requestAnimationFrame(() => requestAnimationFrame(resolvePaint))));
    const final = await page.evaluate(() => {
      const { model, leaf } = globalThis.__cssGraphicsCompatibilityNodes;
      return {
        sameModel: document.querySelector(".scene") === model,
        sameLeaf: document.querySelector('[data-domformat-node="2"]') === leaf,
        sourceFrame: globalThis.domformatProof.sourceFrame,
        bankId: globalThis.domformatProof.bankId,
        lifecycle: globalThis.domformatProof.lifecycle.phase,
        className: leaf.className,
        color: getComputedStyle(leaf).color,
        transform: leaf.style.transform,
        visibility: leaf.style.visibility,
        address: leaf.style.backgroundPosition || leaf.style.backgroundPositionY,
        modelTransform: model.style.transform,
        shapeTransform: document.querySelector('[data-domformat-node="1"]')?.style.transform ?? "",
        cameraTransform: document.querySelector(".camera").style.transform,
        animationCount: model.getAnimations().length,
      };
    });
    const changed = (left, right) => ["className", "color", "transform", "visibility", "address", "modelTransform", "shapeTransform"].some((key) => left[key] !== right[key]);
    assertCssGraphicsSnapshot(initial, contract.expected.initial, `${label} initial`);
    assertCssGraphicsSnapshot(sought, contract.expected.sought, `${label} sought`);
    assertCssGraphicsSnapshot(selected, contract.expected.selected, `${label} selected`);
    assertCssGraphicsSnapshot(final, contract.expected.final, `${label} final`);
    invariant(initial.sourceFrame === 1 && initial.lifecycle === "publish", "BROWSER_RELEASE_CSSGRAPHICS", `${label} did not publish its canonical source state.`);
    invariant(sought.sourceFrame === 2 && changed(initial, sought), "BROWSER_RELEASE_CSSGRAPHICS", `${label} did not publish an observable next prepared source state (${JSON.stringify({ initial, sought })}).`);
    invariant(final.sameModel && final.sameLeaf && final.lifecycle === "publish", "BROWSER_RELEASE_CSSGRAPHICS", `${label} replaced retained identity or left the publication lifecycle.`);
    if (selected) invariant(selected.bankId === "beta" && selected.sourceFrame === 3 && changed(sought, selected) && final.bankId === "beta", "BROWSER_RELEASE_CSSGRAPHICS", `${label} did not publish and retain its host-selected prepared bank across responsive publication (${JSON.stringify({ sought, selected, finalBankId: final.bankId })}).`);
    if (contract.techniques.includes("responsive-profiles")) invariant(final.cameraTransform !== initial.cameraTransform || changed(selected ?? sought, final), "BROWSER_RELEASE_CSSGRAPHICS", `${label} did not publish its responsive presentation/profile state.`);
    if (contract.techniques.includes("profile-frame-visibility")) invariant(initial.visibility !== sought.visibility, "BROWSER_RELEASE_CSSGRAPHICS", `${label} did not publish sparse profile-frame visibility.`);
    if (contract.techniques.includes("responsive-affine")) invariant(final.transform.startsWith("matrix(") && final.transform !== (selected ?? sought).transform, "BROWSER_RELEASE_CSSGRAPHICS", `${label} did not publish the responsive affine transform (${JSON.stringify({ before: (selected ?? sought).transform, final: final.transform, camera: final.cameraTransform })}).`);
    if (contract.id === "menger") invariant(sought.address !== initial.address && sought.address.trim().split(/\s+/u).length === 2, "BROWSER_RELEASE_CSSGRAPHICS", `${label} did not publish a full two-axis atlas address (${JSON.stringify({ initial: initial.address, sought: sought.address })}).`);
    if (contract.techniques.includes("prepared-variants") || contract.techniques.includes("paged-variants")) invariant(initial.className !== sought.className, "BROWSER_RELEASE_CSSGRAPHICS", `${label} did not publish prepared variant state.`);
    if (contract.techniques.includes("compositor-timing")) invariant(final.animationCount === 1, "BROWSER_RELEASE_CSSGRAPHICS", `${label} did not retain its typed compositor timeline.`);
    return Object.freeze({
      adapter: contract.id,
      revision: CSSGRAPHICS_REVISION,
      implementation,
      cadence: contract.cadence,
      techniques: contract.techniques,
      initial,
      sought,
      selected,
      final,
    });
  });
}

function cssGraphicsTimingProbe(contract) {
  if (contract.id === "3dpipes" || contract.id === "electropaint") return { stallMs: 50, expectedFrame: 2 };
  if (contract.id === "maze") return { stallMs: 60, expectedFrame: 2 };
  if (contract.id === "menger") return { stallMs: 80, expectedFrame: 3 };
  if (contract.id === "solitaire") return { stallMs: 140, expectedFrame: 3 };
  return { stallMs: 80, expectedFrame: 2 };
}

function assertCssGraphicsSnapshot(actual, expected, label) {
  if (!expected) return;
  for (const [key, value] of Object.entries(expected)) invariant(actual?.[key] === value, "BROWSER_RELEASE_CSSGRAPHICS", `${label} ${key} was ${JSON.stringify(actual?.[key])}, expected ${JSON.stringify(value)}.`);
}

async function writeFixture(slug, input) {
  const built = buildDom(await input);
  const directory = join(temporary, slug);
  await mkdir(directory);
  const model = join(directory, "model.json");
  await writeFile(model, built.bytes);
  const routes = new Map([[`/${slug}/model.json`, model]]);
  for (const [relative, bytes] of built.externalResources) {
    const target = join(directory, ...relative.split("/"));
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, bytes);
    routes.set(`/${slug}/${relative}`, target);
  }
  return Object.freeze({ built, model, routes });
}

try {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const packRoot = join(temporary, "pack");
  const installRoot = join(temporary, "install");
  await Promise.all([mkdir(packRoot), mkdir(installRoot)]);
  const packRun = await execFileAsync(npm, ["pack", "--json", "--pack-destination", packRoot], { cwd: root, maxBuffer: 16 * 1024 * 1024, timeout: 60_000 });
  const reportStart = packRun.stdout.lastIndexOf("\n[");
  const packReports = JSON.parse(reportStart === -1 ? packRun.stdout : packRun.stdout.slice(reportStart + 1));
  invariant(packReports.length === 1, "BROWSER_RELEASE_PACKAGE", "Browser release npm pack returned an unexpected report.");
  const tarball = join(packRoot, packReports[0].filename);
  await execFileAsync(npm, ["install", "--prefix", installRoot, "--no-audit", "--no-fund", tarball], { maxBuffer: 16 * 1024 * 1024, timeout: 60_000 });
  const installedRuntime = join(installRoot, "node_modules", "@layoutit", "polycss-domformat");

  const input = await loadManifest(resolve(root, "fixtures/synthetic-polycss/manifest.json"));
  const built = buildDom(input);
  const modelPath = join(temporary, "synthetic.json");
  await writeFile(modelPath, built.bytes);
  for (const [relative, bytes] of built.externalResources) {
    const target = join(temporary, ...relative.split("/"));
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, bytes);
  }

  const techniques = await writeFixture("techniques", syntheticAdapterTechniquesInput());
  const paged = await writeFixture("paged", syntheticEvictingPagedVariantsInput());
  const pagedCombinedInput = await syntheticPagedPlaybackChangesInput();
  delete pagedCombinedInput.meta.counts;
  const pagedCombined = await writeFixture("paged-combined", pagedCombinedInput);
  const viewport = await writeFixture("viewport", syntheticViewportProfilesInput());
  const dynamicViewport = await writeFixture("dynamic-viewport", syntheticDynamicViewportProfilesInput());
  const profileTimeline = await writeFixture("profile-timeline", syntheticProfileTimelinesInput());
  const aspectProfileTimeline = await writeFixture("aspect-profile-timeline", syntheticAspectProfileTimelinesInput());
  const pagedProfile = await writeFixture("paged-profile", syntheticPagedProfileTimelinesWithoutInteractionInput());
  const preparedBanks = await writeFixture("prepared-banks", syntheticPagedPreparedBanksInput());
  const orbit = await writeFixture("orbit", syntheticOrbitInput());
  const compositor = await writeFixture("compositor", syntheticCompositorTimingInput());
  const exactSingle = await writeFixture("exact-single", syntheticExactTimingInput({ tickIntervalUs: [100_000, 1] }));
  const elapsedInput = await syntheticExactTimingInput({ catchUpPolicy: "elapsed", tickIntervalUs: [100_000, 1], deadlineMicros: [0, 80_000, 200_000, 300_000] });
  const elapsedPacket = elapsedInput.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0").data.packet;
  elapsedPacket.timeline.loopTicks = 3;
  elapsedPacket.timeline.frames = [1, 1, 2];
  const exactElapsed = await writeFixture("exact-elapsed", elapsedInput);
  const cssGraphicsFixtures = new Map();
  for (const contract of STABLE_CSSGRAPHICS_BROWSER_CONTRACTS) {
    cssGraphicsFixtures.set(contract.id, await writeFixture(`cssgraphics-${contract.id}`, syntheticCssGraphicsDemoInput(contract.id)));
  }

  const producerPath = resolve(root, "conformance/producer.py");
  const python = process.platform === "win32" ? "python" : "python3";
  const pythonRoot = join(temporary, "independent");
  await mkdir(pythonRoot);
  const pythonModel = join(pythonRoot, "model.json");
  const producerRun = await execFileAsync(python, ["-B", producerPath, pythonModel], { maxBuffer: 4 * 1024 * 1024, timeout: 20_000 });
  const producerSummary = JSON.parse(producerRun.stdout);
  invariant(producerSummary.codecs === 5 && producerSummary.nodes === 11 && producerSummary.resources === 2, "BROWSER_RELEASE_PRODUCER", "Independent producer emitted an unexpected contract.");

  const runtimeRequests = [];
  const explicitFiles = new Map([
    ["/model.json", modelPath],
    ["/model.css", join(temporary, "model.css")],
    ["/assets/checker.png", join(temporary, "assets", "checker.png")],
    ["/independent/model.json", pythonModel],
    ["/independent/independent.css", join(pythonRoot, "independent.css")],
    ["/independent/assets/independent-checker.png", join(pythonRoot, "assets", "independent-checker.png")],
  ]);
  for (const fixture of [techniques, paged, pagedCombined, viewport, dynamicViewport, profileTimeline, aspectProfileTimeline, pagedProfile, preparedBanks, orbit, compositor, exactSingle, exactElapsed, ...cssGraphicsFixtures.values()]) {
    for (const [pathname, target] of fixture.routes) explicitFiles.set(pathname, target);
  }
  server = serve(explicitFiles, installedRuntime, runtimeRequests);
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  invariant(address && typeof address === "object", "BROWSER_RELEASE_SERVER", "Browser release server did not bind a local port.");
  const origin = `http://127.0.0.1:${address.port}`;
  const browserExecutable = await availableBrowser();
  launchedBrowser = await chromium.launch({
    executablePath: browserExecutable,
    headless: true,
    args: browserArguments(),
  });
  const proofs = [];
  proofs.push(await browserFixtureProof(launchedBrowser, origin, "/model.json", "reference-writer-json", 8, 1, "i", 1));
  proofs.push(await browserFixtureProof(launchedBrowser, origin, "/independent/model.json", "independent-producer-json", 11, 2, "u", 2));
  const preparedTechniques = [];
  preparedTechniques.push(await preparedTechniqueProof(launchedBrowser, `${origin}/viewer/index.html?model=%2Ftechniques%2Fmodel.json&animate=0`, "prepared techniques reference viewer"));
  preparedTechniques.push(await preparedTechniqueProof(launchedBrowser, `${origin}/viewer/index.html?model=%2Ftechniques%2Fmodel.json&animate=0&implementation=conformance`, "prepared techniques alternate mount"));
  preparedTechniques.push(await preparedTechniqueProof(launchedBrowser, `${origin}/test/nversion-viewer.html?model=%2Ftechniques%2Fmodel.json&animate=0`, "prepared techniques N-version path"));
  const paths = [
    { id: "reference", page: "/viewer/index.html", suffix: "" },
    { id: "conformance", page: "/viewer/index.html", suffix: "&implementation=conformance" },
    { id: "nversion", page: "/test/nversion-viewer.html", suffix: "" },
  ];
  const pagedState = [];
  const combinedPagedState = [];
  const viewportProfiles = [];
  const dynamicViewportProfiles = [];
  const profileTimelines = [];
  const aspectProfileTimelines = [];
  const preparedBankHandoffs = [];
  const pinnedProfileRestarts = [];
  const orbitInput = [];
  const compositorTiming = [];
  const exactTiming = [];
  const cssGraphicsCompatibility = [];
  const cssGraphicsTiming = [];
  for (const path of paths) {
    const viewerUrl = (fixture, animate) => `${origin}${path.page}?model=%2F${fixture}%2Fmodel.json&animate=${animate ? "1" : "0"}&mode=animation${path.suffix}`;
    pagedState.push(await pagedStateProof(launchedBrowser, viewerUrl("paged", false), `paged state ${path.id} path`));
    combinedPagedState.push(await combinedPagedStateProof(launchedBrowser, viewerUrl("paged-combined", false), `combined paged state ${path.id} path`));
    viewportProfiles.push(await viewportProfileProof(launchedBrowser, viewerUrl("viewport", false), `viewport profiles ${path.id} path`));
    dynamicViewportProfiles.push(await dynamicViewportProfileProof(launchedBrowser, viewerUrl("dynamic-viewport", false), `dynamic viewport profiles ${path.id} path`));
    profileTimelines.push(await profileTimelineProof(launchedBrowser, viewerUrl("profile-timeline", true), `profile timelines ${path.id} path`));
    aspectProfileTimelines.push(await aspectProfileTimelineProof(launchedBrowser, viewerUrl("aspect-profile-timeline", true), `aspect profile timelines ${path.id} path`));
    pinnedProfileRestarts.push(await pinnedProfileRestartProof(launchedBrowser, viewerUrl("paged-profile", false), `pinned profile restart ${path.id} path`));
    preparedBankHandoffs.push(await preparedBankProof(launchedBrowser, viewerUrl("prepared-banks", false), `prepared bank handoff ${path.id} path`));
    orbitInput.push(await orbitInputProof(launchedBrowser, viewerUrl("orbit", false), `orbit input ${path.id} path`));
    compositorTiming.push(await compositorTimingProof(launchedBrowser, viewerUrl("compositor", true), `compositor timing ${path.id} path`, true));
    compositorTiming.push(await compositorTimingProof(launchedBrowser, viewerUrl("compositor", false), `compositor animate:false ${path.id} path`, false));
    exactTiming.push(await exactTimingProof(launchedBrowser, viewerUrl("exact-single", true), `exact single-step timing ${path.id} path`, 350, 2));
    exactTiming.push(await exactTimingProof(launchedBrowser, viewerUrl("exact-elapsed", true), `explicit elapsed timing ${path.id} path`, 210, 2));
    exactTiming.push(await exactTimingProof(launchedBrowser, viewerUrl("cssgraphics-3dpipes", true), `forced prequeued scheduler timing ${path.id} path`, 0, 2, true));
    for (const contract of STABLE_CSSGRAPHICS_BROWSER_CONTRACTS) {
      cssGraphicsCompatibility.push(await cssGraphicsDemoProof(launchedBrowser, viewerUrl(`cssgraphics-${contract.id}`, false), contract, path.id));
      const timing = cssGraphicsTimingProbe(contract);
      cssGraphicsTiming.push(await exactTimingProof(launchedBrowser, viewerUrl(`cssgraphics-${contract.id}`, true), `${contract.label} exact timing ${path.id} path`, timing.stallMs, timing.expectedFrame));
    }
  }
  invariant(runtimeRequests.length > 1 && runtimeRequests.every(({ target }) => target.startsWith(`${join(installedRuntime, "dist")}${sep}`)), "WORKSPACE_RUNTIME_IMPORT", "Browser smoke did not resolve every runtime module from the clean-installed tarball.");
  process.stdout.write(`${JSON.stringify({
    browser: browserExecutable,
    browserVersion: launchedBrowser.version(),
    fixtures: proofs,
    independentProducer: producerSummary,
    preparedTechniques,
    pagedState,
    combinedPagedState,
    viewportProfiles,
    dynamicViewportProfiles,
    profileTimelines,
    aspectProfileTimelines,
    preparedBankHandoffs,
    pinnedProfileRestarts,
    orbitInput,
    compositorTiming,
    exactTiming,
    cssGraphicsCompatibility,
    cssGraphicsTiming,
    browserRuntime: "clean-installed npm tarball",
    browserRuntimeModules: [...new Set(runtimeRequests.map(({ pathname }) => pathname))].sort(),
    alternateMountModelPixelsIdentical: proofs.every((proof) => proof.alternateMountModelPixelsIdentical),
    alternateMountMaximumChannelDelta: Math.max(...proofs.map((proof) => proof.alternateMountMaximumChannelDelta)),
    nVersionProbeModelPixelsIdentical: proofs.every((proof) => proof.nVersionProbeModelPixelsIdentical),
    nVersionProbeMaximumChannelDelta: Math.max(...proofs.map((proof) => proof.nVersionProbeMaximumChannelDelta)),
    realBrowser: true,
  }, null, 2)}\n`);
} finally {
  try { await launchedBrowser?.close(); } catch {}
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temporary, { recursive: true, force: true });
}
