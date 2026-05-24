// Quick pixel-diff between two screenshot directories.
// Compares same-named files; reports max channel delta and pct of changed pixels.
import { readdirSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { PNG } from "pngjs";

const [aDir, bDir] = process.argv.slice(2).map((p) => resolve(p));
if (!aDir || !bDir) {
  console.error("usage: node shadow-diff.mjs <dirA> <dirB>");
  process.exit(2);
}

const files = readdirSync(aDir).filter((f) => f.endsWith(".png"));
let worst = { file: "", maxDelta: 0, changedPct: 0 };
for (const f of files) {
  const a = PNG.sync.read(readFileSync(`${aDir}/${f}`));
  let b;
  try {
    b = PNG.sync.read(readFileSync(`${bDir}/${f}`));
  } catch (e) {
    console.log(`${f}: MISSING IN B`);
    continue;
  }
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`${f}: SIZE MISMATCH ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    continue;
  }
  let maxD = 0;
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    const d = Math.max(dr, dg, db);
    if (d > 0) changed++;
    if (d > maxD) maxD = d;
  }
  const pct = (changed / (a.width * a.height)) * 100;
  console.log(`${f.padEnd(36)} maxΔ=${String(maxD).padStart(3)} changed=${pct.toFixed(3)}%`);
  if (maxD > worst.maxDelta || (maxD === worst.maxDelta && pct > worst.changedPct)) {
    worst = { file: f, maxDelta: maxD, changedPct: pct };
  }
}
console.log("---");
console.log(`worst: ${worst.file} maxΔ=${worst.maxDelta} changed=${worst.changedPct.toFixed(3)}%`);
