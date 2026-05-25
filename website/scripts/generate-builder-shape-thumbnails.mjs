import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const websiteRoot = resolve(scriptDir, "..");
const tempDir = join(websiteRoot, ".tmp-builder-shape-thumbnails");
const outDir = join(websiteRoot, "public", "builder", "shape-thumbnails");
const entryPath = join(tempDir, "entry.tsx");
const bundlePath = join(tempDir, "bundle.js");
const htmlPath = join(tempDir, "index.html");

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });
await mkdir(outDir, { recursive: true });

await writeFile(
  entryPath,
  `
import React from "react";
import { createRoot } from "react-dom/client";
import { PolyMesh, PolyOrthographicCamera, PolyScene } from "@layoutit/polycss-react";
import { BUILDER_SHAPE_PRESETS } from "../src/components/BuilderWorkbench/shapePresets";

const light = { direction: [0.38, -0.48, 0.78], color: "#ffffff", intensity: 0.32 };
const ambient = { color: "#ffffff", intensity: 0.52 };

function ShapeThumb({ shape }) {
  const polygons = React.useMemo(() => shape.generatePolygons?.() ?? [], [shape]);
  const meshRotation = shape.id === "builder-shape-dodecahedron"
    ? [0, 45, 0] as [number, number, number]
    : [0, 0, 0] as [number, number, number];
  return (
    <div
      className="thumb"
      data-shape-id={shape.id}
      data-file={new URL(shape.thumbnailSrc, "http://localhost").pathname.split("/").pop()}
    >
      <PolyOrthographicCamera zoom={0.3} rotX={65} rotY={45} target={[0, 0, 0]}>
        <PolyScene
          polygons={[]}
          directionalLight={light}
          ambientLight={ambient}
          textureLighting="baked"
          textureQuality="auto"
          strategies={{ disable: [] }}
        >
          <PolyMesh polygons={polygons} rotation={meshRotation} scale={0.05} />
        </PolyScene>
      </PolyOrthographicCamera>
    </div>
  );
}

function App() {
  return (
    <main className="stage">
      {BUILDER_SHAPE_PRESETS.map((shape) => <ShapeThumb key={shape.id} shape={shape} />)}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
`,
);

await writeFile(
  htmlPath,
  `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        margin: 0;
        background: transparent;
      }
      .stage {
        display: grid;
        grid-template-columns: repeat(4, 112px);
        gap: 16px;
        padding: 16px;
      }
      .thumb {
        width: 112px;
        height: 112px;
        position: relative;
        overflow: hidden;
        background: transparent;
      }
      .thumb .polycss-camera {
        position: absolute;
        inset: 0;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./bundle.js"></script>
  </body>
</html>
`,
);

await esbuild.build({
  entryPoints: [entryPath],
  bundle: true,
  outfile: bundlePath,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  absWorkingDir: websiteRoot,
  sourcemap: false,
  logLevel: "silent",
});

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = resolve(tempDir, `.${decodeURIComponent(pathname)}`);
    if (!filePath.startsWith(tempDir)) {
      response.writeHead(403).end();
      return;
    }
    const contentType = filePath.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(await readFile(filePath));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Could not start local thumbnail server");
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 560, height: 420 }, deviceScaleFactor: 2 });
const pageMessages = [];
page.on("console", (message) => pageMessages.push(`${message.type()}: ${message.text()}`));
page.on("pageerror", (error) => pageMessages.push(`pageerror: ${error.message}`));

try {
  await page.goto(`http://127.0.0.1:${address.port}/index.html`, { waitUntil: "networkidle" });
  try {
    await page.waitForSelector(".thumb .polycss-scene b, .thumb .polycss-scene i, .thumb .polycss-scene s, .thumb .polycss-scene u", {
      state: "attached",
      timeout: 10_000,
    });
  } catch (error) {
    const thumbCount = await page.locator(".thumb").count();
    const bodyText = await page.locator("body").textContent().catch(() => "");
    console.error({ thumbCount, bodyText: bodyText?.slice(0, 1_000), pageMessages });
    throw error;
  }
  await page.evaluate((targetSize) => {
    for (const thumb of Array.from(document.querySelectorAll(".thumb"))) {
      const leaves = Array.from(thumb.querySelectorAll(".polycss-scene b, .polycss-scene i, .polycss-scene s, .polycss-scene u"));
      if (leaves.length === 0) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const leaf of leaves) {
        const rect = leaf.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        minX = Math.min(minX, rect.left);
        minY = Math.min(minY, rect.top);
        maxX = Math.max(maxX, rect.right);
        maxY = Math.max(maxY, rect.bottom);
      }
      const maxDim = Math.max(maxX - minX, maxY - minY);
      const camera = thumb.querySelector(".polycss-camera");
      if (!camera || !Number.isFinite(maxDim) || maxDim <= 0) continue;
      camera.style.transformOrigin = "center center";
      camera.style.transform = `scale(${targetSize / maxDim})`;
    }
  }, 86);
  await page.waitForTimeout(250);

  const thumbs = await page.locator(".thumb").all();
  for (const thumb of thumbs) {
    const file = await thumb.getAttribute("data-file");
    if (!file) continue;
    await thumb.screenshot({ path: join(outDir, file), omitBackground: true });
  }
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(tempDir, { recursive: true, force: true });
}
