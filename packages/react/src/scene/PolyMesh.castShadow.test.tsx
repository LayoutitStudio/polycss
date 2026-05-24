/**
 * PolyMesh castShadow tests — mirrors the vanilla castShadow describe block in
 * packages/polycss/src/api/createPolyScene.test.ts.
 *
 * Covers:
 *  - default (no castShadow) → no .polycss-shadow elements
 *  - castShadow + dynamic → 1 shadow per non-duplicate polygon
 *  - castShadow + baked → 0 shadows
 *  - shadow tag is <q>
 *  - transform contains `var(--shadow-proj)` then `matrix3d`
 *  - --shadow-ground-cssz is set on the scene element when a casting mesh is added
 *  - toggling castShadow reactively adds/removes shadows
 *  - textured polygons ALSO cast shadows (Frog Guy regression)
 *  - --clx/--cly/--clz are set on the scene element in dynamic mode
 *  - --clx/--cly/--clz are removed when lighting switches to baked
 */
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "./PolyScene";
import { PolyMesh } from "./PolyMesh";
import type { Polygon } from "@layoutit/polycss-core";

const TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

// Spatially distinct triangle — shadow-dedup won't fold it with TRIANGLE.
const DISTINCT_TRIANGLE: Polygon = {
  vertices: [
    [10, 10, 5],
    [11, 10, 5],
    [10, 11, 5],
  ],
  color: "#00ff00",
};

const TEXTURED_TRIANGLE: Polygon = {
  vertices: TRIANGLE.vertices,
  texture: "https://example.com/tex.png",
  uvs: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
};

const DYN_SCENE_PROPS = {
  textureLighting: "dynamic" as const,
  directionalLight: {
    direction: [0.4, -0.7, 0.59] as [number, number, number],
    color: "#ffffff",
    intensity: 1,
  },
};

function renderScene(
  sceneProps: React.ComponentProps<typeof PolyScene>,
  meshProps?: React.ComponentProps<typeof PolyMesh>,
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <PolyCamera>
        <PolyScene {...sceneProps}>
          {meshProps && <PolyMesh {...meshProps} />}
        </PolyScene>
      </PolyCamera>,
    ),
  );
  return { container, root };
}

function rerender(
  root: ReturnType<typeof createRoot>,
  sceneProps: React.ComponentProps<typeof PolyScene>,
  meshProps?: React.ComponentProps<typeof PolyMesh>,
): void {
  act(() =>
    root.render(
      <PolyCamera>
        <PolyScene {...sceneProps}>
          {meshProps && <PolyMesh {...meshProps} />}
        </PolyScene>
      </PolyCamera>,
    ),
  );
}

async function flushReactWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("PolyMesh — castShadow", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("default (no castShadow) emits no .polycss-shadow elements", () => {
    const { container } = renderScene(DYN_SCENE_PROPS, {
      polygons: [TRIANGLE],
    });
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);
  });

  it("castShadow in dynamic mode emits a single <svg> shadow per mesh (same path as baked)", () => {
    const { container } = renderScene(DYN_SCENE_PROPS, {
      polygons: [TRIANGLE, DISTINCT_TRIANGLE],
      castShadow: true,
    });
    const shadows = container.querySelectorAll(".polycss-shadow");
    expect(shadows.length).toBe(1);
    expect(shadows[0]!.tagName.toLowerCase()).toBe("svg");
  });

  it("castShadow in baked mode emits a single <svg> shadow per mesh with one compound <path>", () => {
    // Baked mode concatenates every casting polygon's projected outline
    // into ONE compound `d` (M…L…Z subpaths) rendered under
    // fill-rule=nonzero — one <path> per mesh regardless of polygon count.
    const { container } = renderScene(
      { textureLighting: "baked" },
      { polygons: [TRIANGLE], castShadow: true },
    );
    const shadows = container.querySelectorAll(".polycss-shadow");
    expect(shadows.length).toBe(1);
    const shadow = shadows[0] as SVGSVGElement;
    expect(shadow.tagName.toLowerCase()).toBe("svg");
    expect(shadow.classList.contains("polycss-shadow-svg")).toBe(true);
    expect(shadow.style.transform).toMatch(/^translate3d\(/);
    expect(shadow.style.transform).not.toContain("var(--shadow-proj)");
    const paths = shadow.querySelectorAll("path");
    expect(paths.length).toBe(1);
    const path = paths[0]!;
    expect(path.getAttribute("opacity")).toBe("0.2500");
    expect(path.getAttribute("fill-rule")).toBe("nonzero");
    const d = path.getAttribute("d") || "";
    expect((d.match(/M/g) || []).length).toBe(1);
    expect((d.match(/L/g) || []).length).toBe(2);
    expect((d.match(/Z/g) || []).length).toBe(1);
  });

  it("shadow elements are <svg> elements in either lighting mode", () => {
    const { container } = renderScene(DYN_SCENE_PROPS, {
      polygons: [TRIANGLE],
      castShadow: true,
    });
    const shadows = container.querySelectorAll(".polycss-shadow");
    expect(shadows.length).toBeGreaterThan(0);
    for (const el of Array.from(shadows)) {
      expect(el.tagName.toLowerCase()).toBe("svg");
      expect(el.classList.contains("polycss-shadow-svg")).toBe(true);
    }
  });

  it("toggling castShadow via prop updates adds/removes shadow leaves", () => {
    const { container, root } = renderScene(DYN_SCENE_PROPS, {
      polygons: [TRIANGLE],
      castShadow: false,
    });
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);

    rerender(root, DYN_SCENE_PROPS, { polygons: [TRIANGLE], castShadow: true });
    expect(container.querySelectorAll(".polycss-shadow").length).toBeGreaterThan(0);

    rerender(root, DYN_SCENE_PROPS, { polygons: [TRIANGLE], castShadow: false });
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);
  });

  it("switching scene lighting mode keeps the per-mesh <svg> shadow", () => {
    const { container, root } = renderScene(DYN_SCENE_PROPS, {
      polygons: [TRIANGLE],
      castShadow: true,
    });
    const before = container.querySelector(".polycss-shadow") as SVGSVGElement;
    expect(before.tagName.toLowerCase()).toBe("svg");
    expect(before.style.transform).toMatch(/^translate3d\(/);

    rerender(root, { textureLighting: "baked" }, { polygons: [TRIANGLE], castShadow: true });
    const after = container.querySelector(".polycss-shadow") as SVGSVGElement;
    expect(after).not.toBeNull();
    expect(after.tagName.toLowerCase()).toBe("svg");
    expect(after.style.transform).toMatch(/^translate3d\(/);
  });

  it("textured polygons (s) ALSO emit shadow leaves (Frog Guy regression)", async () => {
    // Shadows depend only on the polygon outline, not the texture content.
    // Fully textured meshes must cast shadows or the Frog Guy gets no shadow.
    const { container } = renderScene(DYN_SCENE_PROPS, {
      polygons: [TEXTURED_TRIANGLE],
      castShadow: true,
    });
    await flushReactWork();
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(1);
  });

  it("--clx/--cly/--clz are set on the scene element in dynamic mode", () => {
    const { container } = renderScene(DYN_SCENE_PROPS);
    const sceneEl = container.querySelector(".polycss-scene") as HTMLElement;
    expect(sceneEl.style.getPropertyValue("--clx")).not.toBe("");
    expect(sceneEl.style.getPropertyValue("--cly")).not.toBe("");
    expect(sceneEl.style.getPropertyValue("--clz")).not.toBe("");
  });

  it("--clx/--cly/--clz are removed when lighting switches to baked", () => {
    const { container, root } = renderScene(DYN_SCENE_PROPS);
    const sceneEl = container.querySelector(".polycss-scene") as HTMLElement;
    expect(sceneEl.style.getPropertyValue("--clx")).not.toBe("");

    rerender(root, { textureLighting: "baked" });
    expect(sceneEl.style.getPropertyValue("--clx")).toBe("");
    expect(sceneEl.style.getPropertyValue("--cly")).toBe("");
    expect(sceneEl.style.getPropertyValue("--clz")).toBe("");
  });
});
