// Capture shadow scene from many camera positions + a few light positions
// so we can compare baseline vs each optimization visually.
//
// Usage: node bench/shadow-multi-angle.mjs <out-dir>
// Output: <out-dir>/cam-{az}-light-{lightAz}.png
//
// Camera rotates by faking pointer drag on the host element.
// Light is set programmatically via the #az slider on real-shadow.html.
import { chromium } from "playwright";
import { resolve } from "node:path";
import { chromiumArgsWithGpuDefault } from "./chromium-defaults.mjs";

const outDir = process.argv[2] ? resolve(process.argv[2]) : resolve("bench/results/baselines/shadows");

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
  await page.goto("http://localhost:4400/real-shadow.html?norayt", { waitUntil: "networkidle", timeout: 15000 });
  // Wait for meshes + first frame.
  await page.waitForFunction(() => document.querySelectorAll("svg.polycss-shadow").length > 0, { timeout: 15000 });
  await page.waitForTimeout(400);

  const lightSweep = [60, 150, 240, 330];
  const camRotations = [0, 90, 180, 270]; // horizontal drag pixels = rotation
  const dragPxPer90Deg = 300;

  for (const lightAz of lightSweep) {
    await page.evaluate((v) => {
      const el = document.getElementById("az");
      el.value = String(v);
      el.dispatchEvent(new Event("input"));
    }, lightAz);
    await page.waitForTimeout(80);

    for (const camAz of camRotations) {
      // Reset camera by hard-reloading? Too slow. Instead, rotate
      // by drag delta from previous position. Track absolute drag.
      const dragX = camAz === 0 ? 0 : dragPxPer90Deg * (camAz / 90);
      // Each frame: pointerdown at center, pointermove by dragX, pointerup.
      // The orbit controls track delta, so each iteration applies a
      // relative rotation. To make absolute we'd need to reset the
      // camera; for our purposes a per-angle sweep works the same.
      if (camAz > 0) {
        await page.evaluate(({ dx }) => {
          const host = document.getElementById("host");
          const r = host.getBoundingClientRect();
          const cx = r.x + r.width / 2;
          const cy = r.y + r.height / 2;
          host.dispatchEvent(new PointerEvent("pointerdown", { clientX: cx, clientY: cy, button: 0, pointerType: "mouse", bubbles: true, pointerId: 1 }));
          host.dispatchEvent(new PointerEvent("pointermove", { clientX: cx + dx, clientY: cy, button: 0, pointerType: "mouse", bubbles: true, pointerId: 1 }));
          host.dispatchEvent(new PointerEvent("pointerup", { clientX: cx + dx, clientY: cy, button: 0, pointerType: "mouse", bubbles: true, pointerId: 1 }));
        }, { dx: dragPxPer90Deg / (camRotations.length - 1) });
        await page.waitForTimeout(120);
      }

      const file = `${outDir}/cam-${String(camAz).padStart(3, "0")}-light-${String(lightAz).padStart(3, "0")}.png`;
      await page.screenshot({ path: file, fullPage: false });
      console.log(file);
    }
    // Reset camera back to azim 0 for next light run by reversing drags.
    await page.evaluate(({ dx }) => {
      const host = document.getElementById("host");
      const r = host.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      host.dispatchEvent(new PointerEvent("pointerdown", { clientX: cx, clientY: cy, button: 0, pointerType: "mouse", bubbles: true, pointerId: 1 }));
      host.dispatchEvent(new PointerEvent("pointermove", { clientX: cx - dx, clientY: cy, button: 0, pointerType: "mouse", bubbles: true, pointerId: 1 }));
      host.dispatchEvent(new PointerEvent("pointerup", { clientX: cx - dx, clientY: cy, button: 0, pointerType: "mouse", bubbles: true, pointerId: 1 }));
    }, { dx: dragPxPer90Deg });
    await page.waitForTimeout(120);
  }
} finally {
  await browser.close();
}
