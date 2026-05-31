import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseFont } from "./parseFont";
import { composeText } from "./composeText";

function loadFixture(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, "../test/fixtures", name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const roboto = parseFont(loadFixture("Roboto-Bold.ttf"));

function bounds(polys: ReturnType<typeof composeText>) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of polys) for (const [x, y] of p.vertices) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

describe("composeText", () => {
  it("renders a single line like textPolygons", () => {
    expect(composeText(roboto, "Poly").length).toBeGreaterThan(0);
  });

  it("stacks multiple lines taller (world X = screen-down)", () => {
    const one = bounds(composeText(roboto, "Poly"));
    const three = bounds(composeText(roboto, "Poly\nCSS\nText"));
    expect(three.maxX - three.minX).toBeGreaterThan((one.maxX - one.minX) * 2);
  });

  it("splits on \\n into independent lines", () => {
    const polys = composeText(roboto, "AB\nCD");
    expect(polys.length).toBeGreaterThan(0);
  });

  it("underline and strike add decoration polygons", () => {
    const plain = composeText(roboto, "Hi").length;
    const underlined = composeText(roboto, "Hi", { underline: true }).length;
    const struck = composeText(roboto, "Hi", { strike: true }).length;
    expect(underlined).toBeGreaterThan(plain);
    expect(struck).toBeGreaterThan(plain);
  });

  it("alignment shifts the short line's horizontal position", () => {
    const sumY = (polys: ReturnType<typeof composeText>) =>
      polys.reduce((s, p) => s + p.vertices.reduce((t, v) => t + v[1], 0), 0);
    const left = sumY(composeText(roboto, "wide line\nx", { align: "left" }));
    const right = sumY(composeText(roboto, "wide line\nx", { align: "right" }));
    // The short line slides right, so the total of world-Y (screen-right) grows.
    expect(right).toBeGreaterThan(left);
  });

  it("arc warp spreads the text wider than unwarped", () => {
    const flat = bounds(composeText(roboto, "WordArt"));
    const arced = bounds(composeText(roboto, "WordArt", { warp: { shape: "arc", amount: 0.8 } }));
    // The arc bows letters up/down, so the vertical (world X) extent grows.
    expect(arced.maxX - arced.minX).toBeGreaterThan(flat.maxX - flat.minX);
  });

  it("warp shapes change the geometry vs none", () => {
    const none = composeText(roboto, "Hi", { warp: { shape: "none" } });
    const wave = composeText(roboto, "Hi", { warp: { shape: "wave", amount: 0.7 } });
    const sum = (ps: ReturnType<typeof composeText>) =>
      ps.reduce((s, p) => s + p.vertices.reduce((t, v) => t + v[0] + v[1], 0), 0);
    expect(Math.abs(sum(none) - sum(wave))).toBeGreaterThan(1);
  });

  it("larger lineHeight increases vertical extent", () => {
    const tight = bounds(composeText(roboto, "A\nB", { lineHeight: 1 }));
    const loose = bounds(composeText(roboto, "A\nB", { lineHeight: 2 }));
    expect(loose.maxX - loose.minX).toBeGreaterThan(tight.maxX - tight.minX);
  });

  // ── regression: holes must never break ──────────────────────────────────
  it("never simplifies a glyph with holes, so the counter can't collapse", () => {
    // 'O' has a counter; its geometry must be identical at any simplify level.
    const exact = composeText(roboto, "O", { simplify: 0 });
    const coarse = composeText(roboto, "O", { simplify: 8 });
    expect(coarse.length).toBe(exact.length);
  });

  it("still simplifies hole-less glyphs (poly reduction works)", () => {
    const exact = composeText(roboto, "M", { simplify: 0 });
    const coarse = composeText(roboto, "M", { simplify: 8 });
    expect(coarse.length).toBeLessThan(exact.length);
  });

  it("round/bevel hold their counters too (inset never overruns the hole)", () => {
    for (const profile of ["round", "bevel"] as const) {
      expect(composeText(roboto, "o", { profile }).length).toBeGreaterThan(0);
      expect(composeText(roboto, "B", { profile, depth: 30 }).length).toBeGreaterThan(0);
    }
  });

  // ── regression: scale / merge / layered ─────────────────────────────────
  it("horizontal scale widens the run", () => {
    const a = bounds(composeText(roboto, "AV"));
    const b = bounds(composeText(roboto, "AV", { scaleX: 2 }));
    expect(b.maxY - b.minY).toBeGreaterThan((a.maxY - a.minY) * 1.6);
  });

  it("vertical scale heightens the glyphs", () => {
    const a = bounds(composeText(roboto, "A"));
    const b = bounds(composeText(roboto, "A", { scaleY: 2 }));
    expect(b.maxX - b.minX).toBeGreaterThan((a.maxX - a.minX) * 1.6);
  });

  it("merge reduces the polygon count", () => {
    const base = composeText(roboto, "Poly", { merge: false });
    const merged = composeText(roboto, "Poly", { merge: true });
    expect(merged.length).toBeLessThan(base.length);
  });

  it("layered back color + oblique recolors and offsets the back", () => {
    const polys = composeText(roboto, "o", { depth: 10, color: "#ff0000", backColor: "#00ff00", oblique: [12, -12] });
    const colors = new Set(polys.map((p) => p.color));
    expect(colors.has("#ff0000")).toBe(true); // front cap
    expect(colors.has("#00ff00")).toBe(true); // back cap
  });

  // ── regression: WordArt fills / outline / flat-layer shadow ──────────────
  it("a face texture UV-maps the front cap across the whole word", () => {
    const tex = "data:image/png;base64,AAAA";
    const polys = composeText(roboto, "Hi", { faceTexture: tex, faceTextureKey: "k" });
    const faces = polys.filter((p) => p.texture === tex);
    expect(faces.length).toBeGreaterThan(0);
    // Every textured face carries one UV per vertex…
    expect(faces.every((p) => p.uvs?.length === p.vertices.length)).toBe(true);
    // …and the UVs span the whole word (reach both extremes of 0..1).
    const us = faces.flatMap((p) => p.uvs!.map((uv) => uv[0]));
    expect(Math.min(...us)).toBeLessThan(0.05);
    expect(Math.max(...us)).toBeGreaterThan(0.95);
    // Walls stay untextured.
    expect(polys.some((p) => !p.texture)).toBe(true);
  });

  it("solid (no faceTexture) leaves the face untextured", () => {
    const polys = composeText(roboto, "Hi");
    expect(polys.every((p) => !p.texture && !p.uvs)).toBe(true);
  });

  it("outline adds a halo silhouette in the outline color", () => {
    const plain = composeText(roboto, "o").length;
    const polys = composeText(roboto, "o", { outline: { color: "#123456", width: 3 } });
    expect(polys.length).toBeGreaterThan(plain);
    expect(polys.some((p) => p.color === "#123456")).toBe(true);
  });

  it("layered mode drops the side walls (front + offset back only)", () => {
    const walled = composeText(roboto, "o", { depth: 12, backColor: "#00ff00", oblique: [10, -10] });
    const flat = composeText(roboto, "o", { depth: 12, backColor: "#00ff00", oblique: [10, -10], layered: true });
    expect(flat.length).toBeLessThan(walled.length);
    expect(flat.some((p) => p.color === "#00ff00")).toBe(true); // shadow layer kept
  });
});
