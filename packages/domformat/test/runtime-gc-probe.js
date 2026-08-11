import assert from "node:assert/strict";
import { setImmediate as waitForTurn } from "node:timers/promises";
import { mountDom, readDomBrowser } from "../src/browser.js";
import { buildDom } from "../src/writer.js";
import { builtExternalResources, syntheticPolycssInput } from "./helpers.js";
import { FakeElement, fakeBrowserDocument } from "./fake-browser.js";

assert.equal(typeof globalThis.gc, "function");

let runtime;
let mountedSurface;

async function mountAndDestroy() {
  const built = buildDom(await syntheticPolycssInput());
  const result = await readDomBrowser(built.bytes, { externalResources: builtExternalResources(built) });
  const { document } = fakeBrowserDocument();
  const host = new FakeElement(document, "main");
  runtime = await mountDom(result, host, { animate: false });
  mountedSurface = new WeakRef(host.childNodes[0]);
  runtime.destroy();
}

await mountAndDestroy();
await waitForTurn();
for (let index = 0; index < 24; index += 1) {
  globalThis.gc();
  await waitForTurn();
}

assert.equal(runtime.lifecycle.phase, "destroy");
assert.equal(mountedSurface.deref(), undefined);
