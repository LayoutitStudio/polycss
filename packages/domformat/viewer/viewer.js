const host = document.querySelector("#viewer");
const status = document.querySelector("#status");
const parameters = new URLSearchParams(location.search);
const modelUrl = parameters.get("model");
const implementation = parameters.get("implementation") ?? "reference";
const comparison = parameters.get("compare");
const paintProof = parameters.get("proof") === "1";
const publicationDiagnostics = parameters.get("diagnostics") === "1";
let runtime = null;
let comparisonRuntime = null;

async function loadConformanceStatePage(record, signal) {
  const packageUrl = new URL(modelUrl, location.href);
  const resourceUrl = new URL(record.path, packageUrl);
  if (resourceUrl.origin !== packageUrl.origin || resourceUrl.username || resourceUrl.password) throw new Error(`State page ${record.id} escapes the package origin.`);
  const response = await fetch(resourceUrl, { cache: "no-store", credentials: "omit", redirect: "error", signal });
  if (!response.ok || !response.body) throw new Error(`State page ${record.id} request failed.`);
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) !== record.byteLength)) throw new Error(`State page ${record.id} has the wrong Content-Length.`);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > record.byteLength) throw new Error(`State page ${record.id} exceeds its declared length.`);
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  if (length !== record.byteLength) throw new Error(`State page ${record.id} has the wrong length.`);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

if (comparison || paintProof) status.hidden = true;

try {
  if (!modelUrl) throw new Error("Missing required ?model=/path/to/model.json URL.");
  if (implementation !== "reference" && implementation !== "conformance") throw new Error(`Unsupported viewer implementation ${implementation}.`);
  if (comparison && comparison !== "conformance") throw new Error(`Unsupported viewer comparison ${comparison}.`);
  const production = await import("../dist/browser.js");
  const diagnostics = publicationDiagnostics
    ? (await import("../dist/internal-conformance.js")).createPolycssPublicationDiagnostics()
    : null;
  const conformanceMount = implementation === "conformance" || comparison
    ? (await import("../conformance/viewer/mount.js")).mountConformanceDom
    : null;
  const result = await production.readDomBrowserUrl(modelUrl);
  const mount = implementation === "reference" ? production.mountDom : conformanceMount;
  const mountOptions = {
    animate: parameters.get("animate") !== "0",
    ...(parameters.has("mode") ? { mode: parameters.get("mode") } : {}),
    viewportWidth: comparison ? innerWidth / 2 : innerWidth,
    viewportHeight: innerHeight,
    loadStatePage: loadConformanceStatePage,
    ...(diagnostics ? { diagnostics } : {}),
  };
  if (comparison) {
    host.style.width = "50%";
    host.style.right = "50%";
  }
  runtime = await mount(result, host, mountOptions);
  if (comparison) {
    const comparisonHost = document.createElement("main");
    comparisonHost.setAttribute("aria-label", "Independent DOM model");
    Object.assign(comparisonHost.style, {
      position: "fixed",
      top: "0",
      right: "0",
      bottom: "0",
      width: "50%",
      overflow: "hidden",
    });
    document.body.insertBefore(comparisonHost, status);
    comparisonRuntime = await conformanceMount(result, comparisonHost, {
      ...mountOptions,
      viewportWidth: innerWidth / 2,
    });
  }
  const playback = result.document.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0" || channel.interpreter === "polycss-paged-playback@0");
  if (parameters.has("frame")) {
    const frame = Number(parameters.get("frame"));
    if (!Number.isSafeInteger(frame)) throw new Error("The requested proof frame is invalid.");
    if (typeof runtime.seekAsync === "function") await runtime.seekAsync(frame);
    else runtime.seek(frame);
    if (comparisonRuntime) {
      if (typeof comparisonRuntime.seekAsync === "function") await comparisonRuntime.seekAsync(frame);
      else comparisonRuntime.seek(frame);
    }
  }
  const leaves = playback?.targets.leaves.length
    ?? result.document.meta.counts?.leaves
    ?? result.document.tree.nodes.filter((node) => !result.document.tree.nodes.some((candidate) => candidate.parent === node.index)).length;
  document.documentElement.dataset.domformatSourceFrame = String(runtime.sourceFrame);
  document.documentElement.dataset.domformatReady = "";
  globalThis.domformatProof = Object.freeze({
    format: result.document.meta.format,
    profile: result.document.meta.profile,
    documentType: "json-with-sibling-resources",
    nodes: result.document.tree.nodes.length,
    leaves,
    implementation: comparison
      ? "comparison"
      : implementation,
    get lifecycle() { return runtime.lifecycle; },
    get mode() { return runtime.mode; },
    get sourceFrame() { return runtime.sourceFrame; },
    get bankId() { return runtime.bankId; },
    get diagnostics() { return diagnostics; },
    seek(frame) {
      const value = runtime.seek(frame);
      comparisonRuntime?.seek(frame);
      document.documentElement.dataset.domformatSourceFrame = String(value);
      return value;
    },
    async seekAsync(frame) {
      const value = typeof runtime.seekAsync === "function" ? await runtime.seekAsync(frame) : runtime.seek(frame);
      if (comparisonRuntime) {
        if (typeof comparisonRuntime.seekAsync === "function") await comparisonRuntime.seekAsync(frame);
        else comparisonRuntime.seek(frame);
      }
      document.documentElement.dataset.domformatSourceFrame = String(value);
      return value;
    },
    selectBank(id) {
      const value = runtime.selectBank(id);
      comparisonRuntime?.selectBank(id);
      document.documentElement.dataset.domformatSourceFrame = String(value);
      return value;
    },
    async selectBankAsync(id) {
      const value = typeof runtime.selectBankAsync === "function" ? await runtime.selectBankAsync(id) : runtime.selectBank(id);
      if (comparisonRuntime) {
        if (typeof comparisonRuntime.selectBankAsync === "function") await comparisonRuntime.selectBankAsync(id);
        else comparisonRuntime.selectBank(id);
      }
      document.documentElement.dataset.domformatSourceFrame = String(value);
      return value;
    },
    setMode(mode) { return runtime.setMode(mode); },
    setInput(id, value) { return runtime.setInput(id, value); },
    destroy() {
      runtime.destroy();
      comparisonRuntime?.destroy();
      document.documentElement.removeAttribute("data-domformat-ready");
      document.documentElement.dataset.domformatDestroyed = "";
      status.textContent = "destroyed";
    },
  });
  addEventListener("pagehide", () => {
    runtime.destroy();
    comparisonRuntime?.destroy();
  }, { once: true });
  status.textContent = `${result.document.meta.format} · ${result.document.tree.nodes.length} nodes · ${leaves} leaves`;
} catch (error) {
  runtime?.destroy();
  comparisonRuntime?.destroy();
  document.documentElement.dataset.domformatError = "";
  status.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
}
