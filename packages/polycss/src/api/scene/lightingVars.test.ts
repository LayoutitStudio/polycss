import { describe, expect, it } from "vitest";
import type { Polygon } from "@layoutit/polycss-core";
import {
  BAKED_SOLID_PREVIEW_ACTIVE,
  BAKED_SOLID_PREVIEW_ACTIVE_VAR,
  BAKED_SOLID_PREVIEW_B,
  BAKED_SOLID_PREVIEW_G,
  BAKED_SOLID_PREVIEW_LAMBERT,
  BAKED_SOLID_PREVIEW_R,
  LIGHTING_VAR_NAMES,
  applyBakedSolidColor,
  applyBakedSolidPreviewPaint,
  applyDynamicColorVars,
  applyDynamicLightVars,
  applyLightingVars,
  applySolidPaintVars,
  bakedSolidPreviewPaintColor,
  clearBakedSolidPreviewPaintVars,
  clearLightingVars,
  setStylePropertyIfChanged,
} from "./lightingVars";

describe("constants", () => {
  it("LIGHTING_VAR_NAMES covers ambient/directional/shadow CSS-var family", () => {
    expect(LIGHTING_VAR_NAMES).toContain("--plx");
    expect(LIGHTING_VAR_NAMES).toContain("--plr");
    expect(LIGHTING_VAR_NAMES).toContain("--par");
    expect(LIGHTING_VAR_NAMES).toContain("--clz");
  });
  it("BAKED_SOLID_PREVIEW_ACTIVE_VAR uses the preview-active token name", () => {
    expect(BAKED_SOLID_PREVIEW_ACTIVE_VAR).toBe("--polycss-light-preview-active");
    expect(BAKED_SOLID_PREVIEW_ACTIVE).toContain(BAKED_SOLID_PREVIEW_ACTIVE_VAR);
  });
  it("BAKED_SOLID_PREVIEW_LAMBERT references the standard normal+light vars", () => {
    for (const v of ["--pnx", "--pny", "--pnz", "--plx", "--ply", "--plz"]) {
      expect(BAKED_SOLID_PREVIEW_LAMBERT).toContain(v);
    }
  });
  it("BAKED_SOLID_PREVIEW_R/G/B reference per-channel light + ambient + source", () => {
    expect(BAKED_SOLID_PREVIEW_R).toContain("--psr");
    expect(BAKED_SOLID_PREVIEW_R).toContain("--par");
    expect(BAKED_SOLID_PREVIEW_R).toContain("--plr");
    expect(BAKED_SOLID_PREVIEW_G).toContain("--psg");
    expect(BAKED_SOLID_PREVIEW_B).toContain("--psb");
  });
});

describe("setStylePropertyIfChanged", () => {
  it("writes on first call and reports true", () => {
    const el = document.createElement("div");
    expect(setStylePropertyIfChanged(el, "--foo", "1")).toBe(true);
    expect(el.style.getPropertyValue("--foo")).toBe("1");
  });
  it("returns false (no-op) when value is unchanged", () => {
    const el = document.createElement("div");
    setStylePropertyIfChanged(el, "--foo", "1");
    expect(setStylePropertyIfChanged(el, "--foo", "1")).toBe(false);
  });
  it("returns true after a real change", () => {
    const el = document.createElement("div");
    setStylePropertyIfChanged(el, "--foo", "1");
    expect(setStylePropertyIfChanged(el, "--foo", "2")).toBe(true);
    expect(el.style.getPropertyValue("--foo")).toBe("2");
  });
});

describe("clearLightingVars", () => {
  it("removes every var in LIGHTING_VAR_NAMES", () => {
    const el = document.createElement("div");
    for (const v of LIGHTING_VAR_NAMES) el.style.setProperty(v, "0.5");
    clearLightingVars(el);
    for (const v of LIGHTING_VAR_NAMES) expect(el.style.getPropertyValue(v)).toBe("");
  });
  it("is safe to call when nothing is set (no-throw)", () => {
    const el = document.createElement("div");
    expect(() => clearLightingVars(el)).not.toThrow();
  });
});

describe("applyLightingVars", () => {
  it("sets all 14 lighting vars from options", () => {
    const el = document.createElement("div");
    applyLightingVars(el, {
      directionalLight: { direction: [0.4, -0.7, 0.59], color: "#ff0000", intensity: 0.8 },
      ambientLight: { color: "#0000ff", intensity: 0.3 },
    } as any);
    expect(el.style.getPropertyValue("--plx")).not.toBe("");
    expect(el.style.getPropertyValue("--ply")).not.toBe("");
    expect(el.style.getPropertyValue("--plz")).not.toBe("");
    expect(el.style.getPropertyValue("--plr")).toBe("1.0000");
    expect(el.style.getPropertyValue("--plg")).toBe("0.0000");
    expect(el.style.getPropertyValue("--plb")).toBe("0.0000");
    expect(el.style.getPropertyValue("--pli")).toBe("0.8000");
    expect(el.style.getPropertyValue("--par")).toBe("0.0000");
    expect(el.style.getPropertyValue("--pab")).toBe("1.0000");
    expect(el.style.getPropertyValue("--pai")).toBe("0.3000");
  });
  it("clamps --clz away from zero so the shadow projection never divides by zero", () => {
    const el = document.createElement("div");
    applyLightingVars(el, {
      directionalLight: { direction: [1, 0, 0], color: "#fff", intensity: 1 },
    } as any);
    // CSS-frame Z = 0; the clamp pushes |clz| to at least 0.01
    const clz = parseFloat(el.style.getPropertyValue("--clz"));
    expect(Math.abs(clz)).toBeGreaterThanOrEqual(0.01);
  });
  it("supplies defaults when light fields are missing", () => {
    const el = document.createElement("div");
    applyLightingVars(el, {} as any);
    expect(el.style.getPropertyValue("--pli")).toBe("1.0000");
    expect(el.style.getPropertyValue("--pai")).toBe("0.4000");
  });
});

describe("applyDynamicLightVars", () => {
  it("sets data-polycss-lighting and applies lighting vars in dynamic mode", () => {
    const el = document.createElement("div");
    applyDynamicLightVars(el, {
      textureLighting: "dynamic",
      directionalLight: { direction: [1, 0, 0], color: "#fff", intensity: 1 },
    } as any);
    expect(el.dataset.polycssLighting).toBe("dynamic");
    expect(el.style.getPropertyValue("--plr")).not.toBe("");
  });
  it("clears lighting vars in non-dynamic mode", () => {
    const el = document.createElement("div");
    el.style.setProperty("--plx", "stale");
    applyDynamicLightVars(el, { textureLighting: "baked" } as any);
    expect(el.style.getPropertyValue("--plx")).toBe("");
    expect(el.dataset.polycssLighting).toBe("baked");
  });
});

describe("applySolidPaintVars", () => {
  it("sets --polycss-paint when paintColor is present", () => {
    const w = document.createElement("div");
    applySolidPaintVars(w as any, { paintColor: "rgb(255 0 0)" } as any);
    expect(w.style.getPropertyValue("--polycss-paint")).toBe("rgb(255 0 0)");
  });
  it("clears --polycss-paint when paintColor is missing", () => {
    const w = document.createElement("div");
    w.style.setProperty("--polycss-paint", "stale");
    applySolidPaintVars(w as any, {} as any);
    expect(w.style.getPropertyValue("--polycss-paint")).toBe("");
  });
  it("sets --psr/g/b from dynamicColor", () => {
    const w = document.createElement("div");
    applySolidPaintVars(w as any, { dynamicColor: { r: 255, g: 128, b: 0 } } as any);
    expect(w.style.getPropertyValue("--psr")).toBe("1.0000");
    expect(w.style.getPropertyValue("--psg")).toBe("0.5020");
    expect(w.style.getPropertyValue("--psb")).toBe("0.0000");
  });
});

describe("applyDynamicColorVars", () => {
  it("converts CSS color string into --psr/g/b normalised (0..1)", () => {
    const el = document.createElement("div");
    applyDynamicColorVars(el, "#ff8000");
    expect(el.style.getPropertyValue("--psr")).toBe("1.0000");
    expect(el.style.getPropertyValue("--psg")).toBe("0.5020");
    expect(el.style.getPropertyValue("--psb")).toBe("0.0000");
  });
  it("defaults to #cccccc when color is undefined", () => {
    const el = document.createElement("div");
    applyDynamicColorVars(el, undefined);
    // 0xcc = 204; 204/255 ≈ 0.8000
    expect(el.style.getPropertyValue("--psr")).toBe("0.8000");
  });
});

describe("applyBakedSolidColor", () => {
  it("returns false for atlas-kind leaves (caller falls through to atlas path)", () => {
    const item = { kind: "atlas", plan: {} } as any;
    expect(applyBakedSolidColor(item, {} as Polygon, {} as any)).toBe(false);
  });
  it("returns false when leaf has no plan", () => {
    const item = { kind: "solid" } as any;
    expect(applyBakedSolidColor(item, {} as Polygon, {} as any)).toBe(false);
  });
  it("returns false when the plan is textured (atlas-backed solid)", () => {
    const item = { kind: "solid", plan: { texture: {} } } as any;
    expect(applyBakedSolidColor(item, {} as Polygon, {} as any)).toBe(false);
  });
});

describe("bakedSolidPreviewPaintColor", () => {
  it("emits an rgb(...) string that references the per-channel preview vars", () => {
    const out = bakedSolidPreviewPaintColor("#aabbcc");
    expect(out.startsWith("rgb(")).toBe(true);
    expect(out).toContain("--polycss-preview-r");
    expect(out).toContain("--polycss-preview-g");
    expect(out).toContain("--polycss-preview-b");
  });
  it("includes the preview-active toggle in the mix expression", () => {
    const out = bakedSolidPreviewPaintColor("#ffffff");
    expect(out).toContain(BAKED_SOLID_PREVIEW_ACTIVE_VAR);
  });
  it("falls back to (255,255,255) when the input color can't be parsed", () => {
    const out = bakedSolidPreviewPaintColor("garbage");
    expect(out).toContain("255");
  });
});

describe("applyBakedSolidPreviewPaint", () => {
  it("returns false for atlas leaves", () => {
    expect(applyBakedSolidPreviewPaint({ kind: "atlas" } as any, {} as Polygon, "#fff")).toBe(false);
  });
  it("installs --pnx/--psr/--plam/preview-r/preview-g/preview-b on a solid leaf and reports true", () => {
    const el = document.createElement("div");
    const item = {
      kind: "solid",
      element: el,
      plan: { normal: [0.1, 0.2, 0.97] },
    } as any;
    const changed = applyBakedSolidPreviewPaint(item, { color: "#ff0000" } as any, "#ff0000");
    expect(changed).toBe(true);
    expect(el.style.getPropertyValue("--pnx")).toBe("0.1000");
    expect(el.style.getPropertyValue("--pny")).toBe("0.2000");
    expect(el.style.getPropertyValue("--pnz")).toBe("0.9700");
    expect(el.style.getPropertyValue("--psr")).toBe("1.0000");
    expect(el.style.getPropertyValue("--polycss-paint")).not.toBe("");
    expect(el.style.getPropertyValue("--plam")).toBe(BAKED_SOLID_PREVIEW_LAMBERT);
  });
  it("returns false when called twice with the same input (no churn)", () => {
    const el = document.createElement("div");
    const item = {
      kind: "solid", element: el, plan: { normal: [0, 0, 1] },
    } as any;
    applyBakedSolidPreviewPaint(item, { color: "#aaaaaa" } as any, "#aaaaaa");
    expect(applyBakedSolidPreviewPaint(item, { color: "#aaaaaa" } as any, "#aaaaaa")).toBe(false);
  });
});

describe("clearBakedSolidPreviewPaintVars", () => {
  it("strips every preview var from the leaf", () => {
    const el = document.createElement("div");
    for (const v of ["--pnx","--pny","--pnz","--psr","--psg","--psb","--plam","--polycss-preview-r","--polycss-preview-g","--polycss-preview-b","--polycss-paint"]) {
      el.style.setProperty(v, "stale");
    }
    clearBakedSolidPreviewPaintVars(el);
    for (const v of ["--pnx","--pny","--pnz","--psr","--psg","--psb","--plam","--polycss-preview-r","--polycss-preview-g","--polycss-preview-b","--polycss-paint"]) {
      expect(el.style.getPropertyValue(v)).toBe("");
    }
  });
});
