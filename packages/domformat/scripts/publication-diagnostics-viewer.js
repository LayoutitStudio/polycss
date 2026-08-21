import { readDomBrowserUrl } from "/dist/browser.js";
import { createPolycssPublicationDiagnostics } from "/dist/internal-conformance.js";
import { mountConformanceDom } from "/conformance/viewer/mount.js";

const host = document.querySelector("#viewer");
const status = document.querySelector("#status");
const parameters = new URLSearchParams(location.search);
const modelUrl = parameters.get("model");
let runtime = null;

async function loadStatePage(record, signal) {
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

try {
  if (!modelUrl) throw new Error("Missing required ?model=/path/to/model.json URL.");
  const result = await readDomBrowserUrl(modelUrl);
  const diagnostics = createPolycssPublicationDiagnostics();
  runtime = await mountConformanceDom(result, host, {
    animate: true,
    mode: "animation",
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    loadStatePage,
    diagnostics,
  });
  document.documentElement.dataset.domformatReady = "";
  globalThis.domformatDiagnosticProof = Object.freeze({
    diagnostics,
    implementation: "repo-internal-conformance",
    get sourceFrame() { return runtime.sourceFrame; },
    destroy() {
      runtime.destroy();
      document.documentElement.removeAttribute("data-domformat-ready");
      document.documentElement.dataset.domformatDestroyed = "";
    },
  });
  addEventListener("pagehide", () => runtime.destroy(), { once: true });
  status.textContent = `${result.document.meta.format} · internal publication diagnostics`;
} catch (error) {
  runtime?.destroy();
  document.documentElement.dataset.domformatError = "";
  status.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
}
