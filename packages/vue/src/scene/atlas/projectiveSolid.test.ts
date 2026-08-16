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
import { describe, it, expect } from "vitest";
import { parseHex, rgbKey } from "@layoutit/polycss-core";
import type { TextureAtlasPlan, SolidPaintDefaults } from "@layoutit/polycss-core";
import { renderTextureProjectiveSolidPoly } from "./projectiveSolid";

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

function styleFor(solidPaintDefaults?: SolidPaintDefaults): Record<string, string | undefined> {
  const vnode = renderTextureProjectiveSolidPoly({
    entry: projectiveEntry(),
    textureLighting: "dynamic",
    solidPaintDefaults,
  });
  return (vnode.props?.style ?? {}) as Record<string, string | undefined>;
}

describe("renderTextureProjectiveSolidPoly — dynamic normals", () => {
  it("emits normal vars even when the color matches the dominant dynamic color", () => {
    const style = styleFor({ dynamicColorKey: rgbKey(parseHex("#ff0000")) });
    expect(style["--pnx"]).toBe("0.0000");
    expect(style["--pny"]).toBe("0.7071");
    expect(style["--pnz"]).toBe("0.7071");
    // Base color falls back to the scene-level dominant dynamic color vars.
    expect(style["--psr"]).toBeUndefined();
    expect(style["--psg"]).toBeUndefined();
    expect(style["--psb"]).toBeUndefined();
  });

  it("emits normal AND base-color vars when the color differs from the dominant dynamic color", () => {
    const style = styleFor({ dynamicColorKey: rgbKey(parseHex("#00ff00")) });
    expect(style["--pny"]).toBe("0.7071");
    expect(style["--psr"]).toBe("1.0000");
    expect(style["--psg"]).toBe("0.0000");
    expect(style["--psb"]).toBe("0.0000");
  });
});
