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
import { syntheticAdapterTechniquesInput } from "../test/helpers.js";

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

function serve(explicitFiles, runtimeRoot) {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const explicit = explicitFiles.get(pathname);
      const sourceRoot = pathname === "/dist/browser.js" ? runtimeRoot : root;
      const target = explicit ?? resolve(sourceRoot, `.${pathname}`);
      invariant(explicit !== undefined || target.startsWith(`${sourceRoot}${sep}`), "UNSAFE_TEST_PATH", "Browser smoke request escaped its fixture root.");
      const bytes = await readFile(target);
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

async function waitForPublication(page, url, label, diagnostics, expectedPaintResources) {
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
      const leaf = document.querySelector("i.leaf");
      const before = {
        address: leaf?.style.backgroundPosition,
        classes: [...(leaf?.classList ?? [])],
        color: leaf ? getComputedStyle(leaf).color : "",
      };
      globalThis.domformatProof.seek(2);
      await new Promise((resolvePaint) => requestAnimationFrame(() => requestAnimationFrame(resolvePaint)));
      const current = document.querySelector("i.leaf");
      return {
        sameNode: current === leaf,
        before,
        after: {
          address: current?.style.backgroundPosition,
          classes: [...(current?.classList ?? [])],
          color: current ? getComputedStyle(current).color : "",
        },
      };
    });
    invariant(proof.sameNode, "BROWSER_RELEASE_MOUNT", `${label} replaced the retained variant target.`);
    invariant(proof.before.address === "0px 0px" && proof.before.classes.includes("material-a") && proof.before.color === "rgb(255, 0, 0)", "BROWSER_RELEASE_MOUNT", `${label} did not publish the prepared initial variant/address.`);
    invariant(proof.after.address === "-16px -16px" && proof.after.classes.includes("material-b") && !proof.after.classes.includes("material-a") && proof.after.color === "rgb(0, 255, 0)", "BROWSER_RELEASE_MOUNT", `${label} did not publish the prepared noninitial variant/address.`);
    return proof;
  });
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

  const techniqueBuilt = buildDom(await syntheticAdapterTechniquesInput());
  const techniqueRoot = join(temporary, "techniques");
  await mkdir(techniqueRoot);
  const techniqueModel = join(techniqueRoot, "model.json");
  await writeFile(techniqueModel, techniqueBuilt.bytes);
  for (const [relative, bytes] of techniqueBuilt.externalResources) {
    const target = join(techniqueRoot, ...relative.split("/"));
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, bytes);
  }

  const producerPath = resolve(root, "conformance/producer.py");
  const python = process.platform === "win32" ? "python" : "python3";
  const pythonRoot = join(temporary, "independent");
  await mkdir(pythonRoot);
  const pythonModel = join(pythonRoot, "model.json");
  const producerRun = await execFileAsync(python, ["-B", producerPath, pythonModel], { maxBuffer: 4 * 1024 * 1024, timeout: 20_000 });
  const producerSummary = JSON.parse(producerRun.stdout);
  invariant(producerSummary.codecs === 5 && producerSummary.nodes === 11 && producerSummary.resources === 2, "BROWSER_RELEASE_PRODUCER", "Independent producer emitted an unexpected contract.");

  server = serve(new Map([
    ["/model.json", modelPath],
    ["/model.css", join(temporary, "model.css")],
    ["/assets/checker.png", join(temporary, "assets", "checker.png")],
    ["/techniques/model.json", techniqueModel],
    ["/techniques/model.css", join(techniqueRoot, "model.css")],
    ["/techniques/assets/checker.png", join(techniqueRoot, "assets", "checker.png")],
    ["/independent/model.json", pythonModel],
    ["/independent/independent.css", join(pythonRoot, "independent.css")],
    ["/independent/assets/independent-checker.png", join(pythonRoot, "assets", "independent-checker.png")],
  ]), installedRuntime);
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
  process.stdout.write(`${JSON.stringify({
    browser: browserExecutable,
    browserVersion: launchedBrowser.version(),
    fixtures: proofs,
    independentProducer: producerSummary,
    preparedTechniques,
    browserRuntime: "clean-installed npm tarball",
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
