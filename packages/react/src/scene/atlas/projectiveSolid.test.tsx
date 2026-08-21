/**
 * Feature tests: projective solid quad emitter — dynamic-mode CSS vars.
 *
 * Pins the D-fix that the surface-normal vars (--pnx/--pny/--pnz) are ALWAYS
 * emitted in dynamic mode. The @property initial normal is (0,0,1), so a
 * projective quad that skipped them (because its color matched the dominant
 * dynamic color) was lit as if facing +Z. Only the base-color vars
 * (--psr/--psg/--psb) may fall back to the scene-level dominant color.
 * Mirrors vanilla's formatInitialSolidPaintStyle and the sibling borderShape
 * emitter.
 */
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHex, rgbKey } from "@layoutit/polycss-core";
import type { TextureAtlasPlan, SolidPaintDefaults } from "@layoutit/polycss-core";
import { TextureProjectiveSolidPoly } from "./projectiveSolid";

type ProjectiveEntry = TextureAtlasPlan & { projectiveMatrix: string };

function projectiveEntry(): ProjectiveEntry {
  return {
    index: 0,
    polygon: {
      vertices: [[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 2, 0]],
      color: "#ff0000",
    },
    normal: [0, 0.7071, 0.7071],
    projectiveMatrix: "1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1",
    shadedColor: "#aa0000",
  } as unknown as ProjectiveEntry;
}

function renderEntry(solidPaintDefaults?: SolidPaintDefaults): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(TextureProjectiveSolidPoly, {
        entry: projectiveEntry(),
        textureLighting: "dynamic" as const,
        solidPaintDefaults,
      }),
    );
  });
  return container.querySelector("b") as HTMLElement;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TextureProjectiveSolidPoly — dynamic normals", () => {
  it("emits normal vars even when the color matches the dominant dynamic color", () => {
    const el = renderEntry({ dynamicColorKey: rgbKey(parseHex("#ff0000")) });
    expect(el.style.getPropertyValue("--pnx")).toBe("0.0000");
    expect(el.style.getPropertyValue("--pny")).toBe("0.7071");
    expect(el.style.getPropertyValue("--pnz")).toBe("0.7071");
    // Base color falls back to the scene-level dominant dynamic color vars.
    expect(el.style.getPropertyValue("--psr")).toBe("");
    expect(el.style.getPropertyValue("--psg")).toBe("");
    expect(el.style.getPropertyValue("--psb")).toBe("");
  });

  it("emits normal AND base-color vars when the color differs from the dominant dynamic color", () => {
    const el = renderEntry({ dynamicColorKey: rgbKey(parseHex("#00ff00")) });
    expect(el.style.getPropertyValue("--pny")).toBe("0.7071");
    expect(el.style.getPropertyValue("--psr")).toBe("1.0000");
    expect(el.style.getPropertyValue("--psg")).toBe("0.0000");
    expect(el.style.getPropertyValue("--psb")).toBe("0.0000");
  });
});
