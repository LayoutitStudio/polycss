/**
 * PolyMesh castShadow tests — mirrors the vanilla castShadow describe block in
 * packages/polycss/src/api/createPolyScene.test.ts.
 *
 * Covers:
 *  - default (no castShadow) → no .polycss-shadow elements
 *  - castShadow + dynamic → per-mesh SVG shadow
 *  - castShadow + baked → per-mesh SVG shadow
 *  - shadow tag is <svg>
 *  - shadow transform is a translated SVG surface
 *  - toggling castShadow reactively adds/removes shadows
 *  - textured polygons ALSO cast shadows (Frog Guy regression)
 *  - --clx/--cly/--clz are set on the scene element in dynamic mode
 *  - --clx/--cly/--clz are removed when lighting switches to baked
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "./PolyScene";
import { PolyMesh } from "./PolyMesh";
import { useSceneContextValue, type ShadowCasterRegistration } from "./sceneContext";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";

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

// Ground-fallback shadows require a real, nonzero-intensity directional light
// (no implicit default sun), so baked-mode shadow tests pass one explicitly.
const BAKED_SCENE_PROPS = {
  textureLighting: "baked" as const,
  directionalLight: DYN_SCENE_PROPS.directionalLight,
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

  it("castShadow with a custom polygon renderer emits no ground shadow", () => {
    // A render-prop mesh owns its own leaves; the ground-shadow fallback
    // projects renderer-owned geometry and would not match the custom
    // output, so it is suppressed (mirrored by Vue's polygon slot gate).
    const { container } = renderScene(
      { textureLighting: "baked" },
      {
        polygons: [TRIANGLE],
        castShadow: true,
        children: (polygon: Polygon, index: number) => <b key={index} data-custom={String(index)} />,
      },
    );
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);
  });

  it("castShadow in baked mode emits a single <svg> shadow per mesh with one compound <path>", () => {
    // Baked mode concatenates every casting polygon's projected outline
    // into ONE compound `d` (M…L…Z subpaths) rendered under
    // fill-rule=nonzero — one <path> per mesh regardless of polygon count.
    const { container } = renderScene(
      BAKED_SCENE_PROPS,
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

  it("toggling castShadow via prop updates adds/removes shadow SVGs", () => {
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

    rerender(root, BAKED_SCENE_PROPS, { polygons: [TRIANGLE], castShadow: true });
    const after = container.querySelector(".polycss-shadow") as SVGSVGElement;
    expect(after).not.toBeNull();
    expect(after.tagName.toLowerCase()).toBe("svg");
    expect(after.style.transform).toMatch(/^translate3d\(/);
  });

  it("textured polygons (s) ALSO emit shadow SVGs (Frog Guy regression)", async () => {
    // Shadows depend only on the polygon outline, not the texture content.
    // Fully textured meshes must cast shadows or the Frog Guy gets no shadow.
    const { container } = renderScene(DYN_SCENE_PROPS, {
      polygons: [TEXTURED_TRIANGLE],
      castShadow: true,
    });
    await flushReactWork();
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(1);
  });

  it("no directional light → no ground-fallback shadow (no phantom default-sun shadow)", () => {
    // Same gate as the receiver-face path: a scene with no lights at all
    // must not draw a ground shadow from an implicit default sun.
    const { container } = renderScene(
      { textureLighting: "baked" },
      { polygons: [TRIANGLE], castShadow: true },
    );
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);
  });

  it("zero-intensity directional light → no ground-fallback shadow", () => {
    const { container } = renderScene(
      {
        textureLighting: "baked",
        directionalLight: { direction: [0.4, -0.7, 0.59] as Vec3, intensity: 0 },
      },
      { polygons: [TRIANGLE], castShadow: true },
    );
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);
  });

  it("followAnimation same-topology deforms throttle caster re-registration (~12fps) with a trailing emit", () => {
    vi.useFakeTimers();
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      let version = -1;
      let casters: Map<symbol, ShadowCasterRegistration> | undefined;
      function Probe(): null {
        const ctx = useSceneContextValue();
        version = ctx?.shadowCastersVersion ?? -1;
        casters = ctx?.shadowCasters;
        return null;
      }
      const deform = (dz: number): Polygon[] => [
        {
          ...TRIANGLE,
          vertices: TRIANGLE.vertices.map(
            ([x, y, z]) => [x, y, z + dz] as Vec3,
          ),
        },
      ];
      // Stable shadow-options identity across renders — an inline object would
      // churn the scene's registerShadowCaster callback identity and force an
      // unregister/re-register cycle per render, masking the throttle.
      const shadowOptions = { followAnimation: true };
      const renderWith = (polys: Polygon[]): void => {
        act(() =>
          root.render(
            <PolyCamera>
              <PolyScene {...DYN_SCENE_PROPS} shadow={shadowOptions}>
                <PolyMesh polygons={polys} castShadow />
                <Probe />
              </PolyScene>
            </PolyCamera>,
          ),
        );
      };
      renderWith([TRIANGLE]);
      const v0 = version;
      expect(v0).toBeGreaterThanOrEqual(0);
      // Rapid same-topology deforms inside the 80ms window: parked, no
      // downstream registration bump.
      renderWith(deform(0.1));
      renderWith(deform(0.2));
      renderWith(deform(0.3));
      expect(version).toBe(v0);
      // Trailing edge: once the window elapses, exactly one bump lands and it
      // carries the LAST parked pose (a paused animation is never stale).
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(version).toBe(v0 + 1);
      const registered = casters ? Array.from(casters.values()) : [];
      expect(registered.length).toBe(1);
      // The registered geometry is the prepared copy of the LAST pose
      // (z offset 0.3), not one of the earlier parked deforms.
      const zs = registered[0]!.polygons.flatMap((p) => p.vertices.map((v) => v[2]));
      expect(zs.length).toBeGreaterThan(0);
      for (const z of zs) expect(z).toBeCloseTo(0.3, 9);
    } finally {
      vi.useRealTimers();
    }
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
