// Parametric-shadow RUBRIC harness.
//
// Treats the parametric shadow as an approximation refined by named, checkable
// invariants ("rubrics"). Each rubric measures one describable property against
// PolyCSS exact shadows (ground truth) or against a geometric truth (e.g. a
// convex mesh must self-shadow nothing). Every correction we append to the
// approximation is judged by the whole rubric set, so we see both the win and
// any regression.
//
// Metric primitives (all from in-browser pixel decode, no Node image lib):
//   over%  = parametric darker than exact   (false / excess shadow)
//   under% = parametric lighter than exact  (missing shadow)
//   IoU    = shadow-region overlap (shadows-only mode only)
//
// Usage: node bench/shadow-rubric.mjs [base]
import { chromium } from "playwright";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";

const BASE = process.argv[2] ?? "http://localhost:4322";
const PAGE = "/shadow-parametric.html";

// A scene = one (mesh, view, light, mode). `sx:1` shadows-only isolates floor
// cast shadow; `sx:0 ss:1` isolates self-shadow (object identical in both
// renders, so the diff is purely self-shadow).
const SCENES = {
  cubeSelf:    { mesh: "cube",    sx: 0, ss: 1, def: 48, q: "rx=58&ry=24&z=30&dx=1&dy=0.5&dz=1" },
  cubeFloor:   { mesh: "cube",    sx: 1, ss: 0, def: 48, q: "rx=55&ry=15&z=22&dx=1&dy=0.5&dz=1" },
  castleFloor: { mesh: "castle",  sx: 1, ss: 0, def: 48, q: "rx=55&ry=15&z=18&dx=1&dy=0.6&dz=1" },
  castleFloorG:{ mesh: "castle",  sx: 1, ss: 0, def: 48, q: "rx=55&ry=15&z=18&dx=1.4&dy=0.2&dz=0.5" },
  castleSelf:  { mesh: "castle",  sx: 0, ss: 1, def: 48, q: "rx=62&ry=20&z=40&dx=1&dy=0.6&dz=1" },
  castleSelfG: { mesh: "castle",  sx: 0, ss: 1, def: 48, q: "rx=62&ry=20&z=40&dx=1.5&dy=0.15&dz=0.4" },
  appleFloor:  { mesh: "apple",   sx: 1, ss: 0, def: 48, q: "rx=45&ry=10&z=30&dx=1&dy=0.6&dz=1" },
  appleSelf:   { mesh: "apple",   sx: 0, ss: 1, def: 48, q: "rx=45&ry=10&z=40&dx=1&dy=0.6&dz=1" },
  cottageFloor:{ mesh: "cottage", sx: 1, ss: 0, def: 48, q: "rx=50&ry=12&z=22&dx=1&dy=0.6&dz=1" },
  coliseumFloor:{ mesh: "coliseum",sx: 1, ss: 0, def: 144, q: "rx=50&ry=12&z=22&dx=1&dy=0.6&dz=1" },
  coliseumSelf: { mesh: "coliseum",sx: 0, ss: 1, def: 96, q: "rx=42.7&ry=338.4&z=16&ax=1&oz_coliseum=0.1&dx=-1&dy=0.33&dz=0.98" },
};

// Each rubric: a scene, the metric to read, a pass predicate, and a plain
// description of the invariant it encodes.
const RUBRICS = [
  { id: "convex-no-self/cube",   scene: "cubeSelf",   metric: "over", max: 0.20, why: "a convex mesh self-shadows nothing" },
  { id: "convex-no-self/apple",  scene: "appleSelf",  metric: "over", max: 2.00, why: "a near-convex mesh barely self-shadows" },
  { id: "floor-iou/castle",      scene: "castleFloor", metric: "iou", min: 0.93, why: "floor cast shadow matches exact footprint" },
  { id: "floor-iou/castle-graze",scene: "castleFloorG",metric: "iou", min: 0.93, why: "floor footprint holds at grazing light" },
  { id: "floor-iou/apple",       scene: "appleFloor", metric: "iou", min: 0.93, why: "convex floor shadow matches exact" },
  { id: "floor-iou/cottage",     scene: "cottageFloor",metric: "iou",min: 0.93, why: "floor footprint matches exact" },
  { id: "floor-iou/coliseum",    scene: "coliseumFloor",metric:"iou",min: 0.90, why: "holed floor footprint matches exact" },
  { id: "no-overshadow/castleSelf",scene:"castleSelf", metric:"over",max: 6.00, why: "self-shadow does not over-darken" },
  { id: "no-undershadow/castleSelf",scene:"castleSelf",metric:"under",max:3.00,why:"real self-shadow is not erased by bias" },
  { id: "no-overshadow/castleSelfG",scene:"castleSelfG",metric:"over",max:6.00,why:"grazing-light self-shadow does not over-darken" },
  { id: "no-undershadow/castleSelfG",scene:"castleSelfG",metric:"under",max:3.00,why:"grazing-light self-shadow not erased (depth bands suffice)" },
  { id: "no-undershadow/coliseumSelf",scene:"coliseumSelf",metric:"under",max:1.50,why:"coliseum interior self-shadow not erased by depth bias" },
  { id: "no-overshadow/coliseumSelf",scene:"coliseumSelf",metric:"over",max:3.00,why:"coliseum self-shadow does not over-darken the arena" },
  { id: "no-undershadow/castleFloor",scene:"castleFloor",metric:"under",max:1.00,why:"floor shadow has no holes vs exact" },
];

const url = (s, pm) => `${BASE}${PAGE}?mesh=${s.mesh}&pm=${pm}&sx=${s.sx}&ss=${s.ss}&def=${s.def}&fv=1&${s.q}`;

async function shotHost(page, u) {
  await page.goto(u, { waitUntil: "networkidle" });
  await page.waitForSelector("#poly-host .polycss-scene", { state: "attached", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return await (await page.$("#poly-host")).screenshot();
}

async function diff(scratch, bufA, bufB) {
  return await scratch.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = "data:image/png;base64," + src; });
    const [iA, iB] = await Promise.all([load(a), load(b)]);
    const W = Math.min(iA.width, iB.width), H = Math.min(iA.height, iB.height);
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(iA, 0, 0); const A = cx.getImageData(0, 0, W, H).data;
    cx.clearRect(0, 0, W, H); cx.drawImage(iB, 0, 0); const B = cx.getImageData(0, 0, W, H).data;
    const THR = 18, bg = A[0] * 0.299 + A[1] * 0.587 + A[2] * 0.114;
    let over = 0, under = 0, inter = 0, uni = 0, N = A.length / 4;
    for (let i = 0; i < A.length; i += 4) {
      const la = A[i] * 0.299 + A[i + 1] * 0.587 + A[i + 2] * 0.114;
      const lb = B[i] * 0.299 + B[i + 1] * 0.587 + B[i + 2] * 0.114;
      const d = la - lb;
      if (Math.abs(d) > THR) { if (d < 0) over++; else under++; }
      const sa = la < bg - THR, sb = lb < bg - THR;
      if (sa && sb) inter++; if (sa || sb) uni++;
    }
    return { over: 100 * over / N, under: 100 * under / N, iou: uni ? inter / uni : 1 };
  }, [bufA.toString("base64"), bufB.toString("base64")]);
}

const browser = await chromium.launch({ args: chromiumArgsWithGpuDefault() });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const scratch = await browser.newPage();
await scratch.setContent("<html></html>");

// measure each unique scene once
const metrics = {};
const needed = [...new Set(RUBRICS.map((r) => r.scene))];
for (const key of needed) {
  const s = SCENES[key];
  const a = await shotHost(page, url(s, 1));
  const b = await shotHost(page, url(s, 0));
  metrics[key] = await diff(scratch, a, b);
}

console.log("\nPARAMETRIC SHADOW RUBRICS\n");
let pass = 0;
for (const r of RUBRICS) {
  const m = metrics[r.scene];
  const v = m[r.metric];
  const ok = r.max != null ? v <= r.max : v >= r.min;
  if (ok) pass++;
  const bound = r.max != null ? `≤${r.max}` : `≥${r.min}`;
  const val = r.metric === "iou" ? v.toFixed(3) : v.toFixed(2) + "%";
  console.log(`${ok ? "PASS" : "FAIL"}  ${r.id.padEnd(28)} ${r.metric}=${val.padStart(7)} (${bound})  — ${r.why}`);
}
console.log(`\n${pass}/${RUBRICS.length} rubrics pass\n`);
await browser.close();
