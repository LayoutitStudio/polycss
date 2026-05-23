import { chromium } from "playwright";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromiumArgsWithGpuDefault } from "/Users/apresmoi/Documents/voxcss/bench/chromium-defaults.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({
  headless: true,
  args: chromiumArgsWithGpuDefault([], { softwareBackend: false }),
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[console.error] ${msg.text()}`);
  });
  await page.goto("http://localhost:4400/real-shadow.html", { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.waitForTimeout(300);
  const status = await page.evaluate(() => document.getElementById("status")?.textContent ?? "");
  console.log("status:", status);
  // Primary screenshot (with shadows) — taken BEFORE any hiding.
  await page.screenshot({ path: "/tmp/real-shadow.png", fullPage: false });
  // Rotate camera 180° to see the other side
  await page.evaluate(() => {
    // Drag the canvas to rotate via orbit controls — fake a drag event
    const host = document.getElementById("host");
    const r = host.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    host.dispatchEvent(new PointerEvent("pointerdown", { clientX: cx, clientY: cy, button: 0, pointerType: "mouse", bubbles: true, pointerId: 1 }));
    host.dispatchEvent(new PointerEvent("pointermove", { clientX: cx + 600, clientY: cy, button: 0, pointerType: "mouse", bubbles: true, pointerId: 1 }));
    host.dispatchEvent(new PointerEvent("pointerup", { clientX: cx + 600, clientY: cy, button: 0, pointerType: "mouse", bubbles: true, pointerId: 1 }));
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/real-shadow-other-side.png", fullPage: false });
  console.log("/tmp/real-shadow-other-side.png");
  // Baseline screenshot with shadows hidden, for diff comparison.
  await page.evaluate(() => {
    document.querySelectorAll("svg.polycss-shadow").forEach((s) => s.style.display = "none");
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: "/tmp/real-shadow-nopole.png", fullPage: false });
  console.log("/tmp/real-shadow-nopole.png");
  const meshState = await page.evaluate(() => {
    const scene = document.querySelector(".polycss-scene");
    const meshes = scene?.querySelectorAll(".polycss-mesh") ?? [];
    return Array.from(meshes).map((m, i) => ({ i, transform: m.style.transform.slice(0, 60) }));
  });
  console.log("meshes:", JSON.stringify(meshState));
  const debug = await page.evaluate(() => {
    const meshes = document.querySelectorAll(".polycss-mesh");
    const groundSvg = document.querySelector("svg.polycss-shadow:not(.polycss-shadow-receiver)");
    const d = groundSvg?.querySelector("path")?.getAttribute("d") ?? "";
    // Last subpath in d:
    const subs = d.split("Z").filter(Boolean);
    const last = subs[subs.length - 1] ?? "";
    // Dump each mesh's transform + receiveShadow state. Read via the
    // public handle exposed on the bench global.
    const handles = {
      plane: window.planeHandle,
      apple: window.appleHandle,
      pole: window.poleHandle,
    };
    const handleStates = {};
    for (const [k, h] of Object.entries(handles)) {
      handleStates[k] = h ? {
        receiveShadow: h.transform?.receiveShadow,
        castShadow: h.transform?.castShadow,
        position: h.transform?.position,
      } : null;
    }
    return {
      meshCount: meshes.length,
      lastSubpath: last.slice(0, 200),
      totalSubpaths: subs.length,
      handleStates,
    };
  });
  // Also dump receiver SVG content (apple receiver surface)
  const receiverDump = await page.evaluate(() => {
    const recvs = Array.from(document.querySelectorAll("svg.polycss-shadow-receiver"));
    return {
      count: recvs.length,
      items: recvs.map((recv) => ({
        width: recv.getAttribute("width"),
        height: recv.getAttribute("height"),
        transform: recv.style.transform.slice(0, 120),
        subpathCount: ((recv.querySelector("path")?.getAttribute("d") ?? "").match(/M/g) || []).length,
      })),
    };
  });
  const hullDbg = await page.evaluate(() => window.__hullDbg);
  console.log("hullDbg:", JSON.stringify(hullDbg, null, 2));
  const allBounds = await page.evaluate(() => ({ apple: window.__appleBounds, pole: window.__poleBounds }));
  console.log("bounds:", JSON.stringify(allBounds, null, 2));
  const handleBounds = await page.evaluate(() => {
    const polys = window.__applePolys;
    if (!polys) return null;
    const verts = polys.flatMap((p) => p.vertices);
    const b = (i) => ({ min: Math.min(...verts.map((v) => v[i])), max: Math.max(...verts.map((v) => v[i])) });
    return { polyCount: polys.length, x: b(0), y: b(1), z: b(2) };
  });
  console.log("apple bounds (post scene.add):", JSON.stringify(handleBounds, null, 2));
  console.log("receiver:", JSON.stringify(receiverDump, null, 2));
  console.log("debug:", JSON.stringify(debug, null, 2));
  const vcountHist = await page.evaluate(() => {
    const scene = window.__polySnapshot; // hack — but easier: just look at mesh polygon data via handles
    // Each polycss-mesh has its leaf elements; count vertices via the s/u/i element classes? No.
    // Just dump rendered shadow path subpath vertex counts to histogram.
    const groundSvg = document.querySelector("svg.polycss-shadow:not(.polycss-shadow-receiver)");
    if (!groundSvg) return {};
    const d = groundSvg.querySelector("path")?.getAttribute("d") ?? "";
    const sps = d.split("Z").filter(Boolean);
    const hist = {};
    for (const sp of sps) {
      const coords = sp.replace(/[ML]/g, ",").split(",").filter(Boolean);
      const vc = coords.length / 2;
      hist[vc] = (hist[vc] || 0) + 1;
    }
    return hist;
  });
  console.log("vertex-count histogram:", JSON.stringify(vcountHist));
  const shadowDump = await page.evaluate(() => {
    const groundSvg = document.querySelector("svg.polycss-shadow:not(.polycss-shadow-receiver)");
    if (!groundSvg) return { error: "no ground svg" };
    const path = groundSvg.querySelector("path");
    const d = path?.getAttribute("d") ?? "";
    // Split into subpaths and count CCW vs CW winding for each
    const subpaths = d.split("Z").filter(Boolean);
    const sample = subpaths.slice(0, 6).map((sp) => {
      // Parse "Mx,yLx,yLx,y..." → vertex list
      const coords = sp.replace(/[ML]/g, ",").split(",").filter(Boolean).map(Number);
      const verts = [];
      for (let i = 0; i + 1 < coords.length; i += 2) verts.push([coords[i], coords[i + 1]]);
      // Signed area (positive = math-CCW = screen-CW in SVG)
      let a = 0;
      for (let i = 0; i < verts.length; i++) {
        const p = verts[i]; const q = verts[(i + 1) % verts.length];
        a += p[0] * q[1] - q[0] * p[1];
      }
      return { vcount: verts.length, signedArea: a / 2 };
    });
    let ccwCount = 0, cwCount = 0, degenCount = 0;
    const cwOffenders = [];
    for (const sp of subpaths) {
      const coords = sp.replace(/[ML]/g, ",").split(",").filter(Boolean).map(Number);
      const verts = [];
      for (let i = 0; i + 1 < coords.length; i += 2) verts.push([coords[i], coords[i + 1]]);
      let a = 0;
      for (let i = 0; i < verts.length; i++) {
        const p = verts[i]; const q = verts[(i + 1) % verts.length];
        a += p[0] * q[1] - q[0] * p[1];
      }
      if (a > 1) ccwCount++;
      else if (a < -1) { cwCount++; if (cwOffenders.length < 3) cwOffenders.push({ area: a / 2, vcount: verts.length, verts }); }
      else degenCount++;
    }
    return {
      svgWidth: groundSvg.getAttribute("width"),
      svgHeight: groundSvg.getAttribute("height"),
      svgTransform: groundSvg.style.transform,
      subpathCount: subpaths.length,
      ccwCount, cwCount, degenCount,
      cwOffenders,
    };
  });
  console.log("shadow:", JSON.stringify(shadowDump, null, 2));
  console.log("/tmp/real-shadow.png");
} finally {
  await browser.close();
}
