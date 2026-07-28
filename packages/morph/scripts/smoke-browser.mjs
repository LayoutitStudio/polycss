import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { capturePolyMorphPlane } from "./capture-browser-frames.mjs";
import { capturePolyMorphPreparedBrowsers } from "./capture-prepared-browsers.mjs";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptRoot, "../../..");
const external = process.env.POLY_MORPH_EXAMPLE_URL !== undefined;
let url = process.env.POLY_MORPH_EXAMPLE_URL;
let server;

async function availablePort() {
  const probe = createServer();
  await new Promise((resolveListen, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolveListen);
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolveClose) => probe.close(resolveClose));
  return port;
}

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Morph example server did not start: ${lastError}`);
}

try {
  if (!external) {
    const port = await availablePort();
    url = `http://127.0.0.1:${port}/`;
    server = spawn(
      "pnpm",
      [
        "--filter",
        "@layoutit/polycss-examples-morph",
        "exec",
        "vite",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
      ],
      {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let serverOutput = "";
    server.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
    server.stderr.on("data", (chunk) => { serverOutput += String(chunk); });
    server.on("exit", (code) => {
      if (code && code !== 0) {
        process.stderr.write(serverOutput);
      }
    });
  }
  await waitForServer();
  const report = await capturePolyMorphPlane({
    url,
    outputRoot: resolve(
      repoRoot,
      "notes/evidence/polycss-morph/plane-browser",
    ),
  });
  const prepared = await capturePolyMorphPreparedBrowsers({
    baseUrl: url,
    outputRoot: resolve(repoRoot, "output/playwright/morph-atlas"),
  });
  console.log(JSON.stringify({ plane: report, prepared }));
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolveExit) => {
      server.once("exit", resolveExit);
      setTimeout(resolveExit, 2000);
    });
  }
}
