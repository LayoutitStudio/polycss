// Parametric-vs-exact shadow harness.
//
// Compares PolyCSS parametric shadows (pm=1) against PolyCSS exact shadows
// (pm=0) at IDENTICAL camera + light. Exact is ground truth, so the pixel diff
// IS the parametric approximation error. Object pixels are identical in both
// renders and cancel, so the diff isolates the shadow (no need to tell object
// from shadow visually). The browser decodes the PNGs and returns only scalar
// metrics, so no Node image library is needed.
//
// Usage: node bench/shadow-diff.mjs [base]   (default base http://localhost:4322)
import { chromium } from "playwright";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";

const BASE = process.argv[2] ?? "http://localhost:4322";
const PAGE = "/shadow-parametric.html";

// scenario knobs shared by both renders; `pm` flips parametric on/off.
const CONFIGS = [
  { name: "castle floor   (steep)", mesh: "castle", sx: 1, ss: 0, def: 48, q: "rx=55&ry=15&z=18&dx=1&dy=0.6&dz=1" },
  { name: "castle floor   (graze)", mesh: "castle", sx: 1, ss: 0, def: 48, q: "rx=55&ry=15&z=18&dx=1.4&dy=0.2&dz=0.5" },
  { name: "castle self    (steep)", mesh: "castle", sx: 0, ss: 1, def: 48, q: "rx=62&ry=20&z=40&dx=1&dy=0.6&dz=1" },
  { name: "castle self    (side) ", mesh: "castle", sx: 0, ss: 1, def: 48, q: "rx=62&ry=20&z=40&dx=1.4&dy=0.2&dz=0.5" },
  { name: "apple  floor   (steep)", mesh: "apple",  sx: 1, ss: 0, def: 48, q: "rx=45&ry=10&z=30&dx=1&dy=0.6&dz=1" },
  { name: "apple  self    (steep)", mesh: "apple",  sx: 0, ss: 1, def: 48, q: "rx=45&ry=10&z=40&dx=1&dy=0.6&dz=1" },
  { name: "cottage floor  (steep)", mesh: "cottage", sx: 1, ss: 0, def: 48, q: "rx=50&ry=12&z=22&dx=1&dy=0.6&dz=1" },
  { name: "coliseum floor (steep)", mesh: "coliseum", sx: 1, ss: 0, def: 48, q: "rx=50&ry=12&z=22&dx=1&dy=0.6&dz=1" },
];

const url = (c, pm) => `${BASE}${PAGE}?mesh=${c.mesh}&pm=${pm}&sx=${c.sx}&ss=${c.ss}&def=${c.def}&fv=1&${c.q}`;

async function shotHost(page, u) {
  await page.goto(u, { waitUntil: "networkidle" });
  await page.waitForSelector("#poly-host .polycss-scene", { state: "attached", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1800);
  const el = await page.$("#poly-host");
  return await el.screenshot();
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
    const THR = 18;
    // background luminance = top-left corner (always empty in both panels).
    const bg = A[0] * 0.299 + A[1] * 0.587 + A[2] * 0.114;
    let diff = 0, over = 0, under = 0, sum = 0;
    let pShadow = 0, eShadow = 0, inter = 0, uni = 0;
    for (let i = 0; i < A.length; i += 4) {
      const la = A[i] * 0.299 + A[i + 1] * 0.587 + A[i + 2] * 0.114;
      const lb = B[i] * 0.299 + B[i + 1] * 0.587 + B[i + 2] * 0.114;
      const d = la - lb, ad = Math.abs(d);
      if (ad > THR) { diff++; sum += ad; if (d < 0) over++; else under++; }
      const sa = la < bg - THR, sb = lb < bg - THR;
      if (sa) pShadow++; if (sb) eShadow++;
      if (sa && sb) inter++; if (sa || sb) uni++;
    }
    const N = A.length / 4;
    return {
      pAreaPct: (100 * pShadow / N).toFixed(2), // parametric shadow coverage area
      eAreaPct: (100 * eShadow / N).toFixed(2), // exact shadow coverage area
      overPct: (100 * over / N).toFixed(2),   // param darker than exact (over-shadow)
      underPct: (100 * under / N).toFixed(2), // param lighter (missing shadow)
      mad: (sum / N).toFixed(2),
      iou: uni ? (inter / uni).toFixed(3) : "1.000", // only meaningful for shadows-only (sx=1)
    };
  }, [bufA.toString("base64"), bufB.toString("base64")]);
}

const browser = await chromium.launch({ args: chromiumArgsWithGpuDefault() });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const scratch = await browser.newPage();
await scratch.setContent("<html><body></body></html>");
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text().slice(0, 120)); });

console.log("\nparametric (pm=1) vs exact (pm=0) — exact is ground truth\n");
console.log("scenario                 pArea% eArea%  over% under%   MAD  IoU(sx=1)");
console.log("-".repeat(72));
for (const c of CONFIGS) {
  const a = await shotHost(page, url(c, 1));
  const b = await shotHost(page, url(c, 0));
  const r = await diff(scratch, a, b);
  const iou = c.sx === 1 ? r.iou : "  -  ";
  console.log(`${c.name}  ${r.pAreaPct.padStart(6)} ${r.eAreaPct.padStart(6)} ${r.overPct.padStart(6)} ${r.underPct.padStart(5)} ${r.mad.padStart(5)}   ${iou}`);
}
console.log("");
await browser.close();
