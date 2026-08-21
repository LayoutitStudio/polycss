/**
 * PolyMesh castShadow tests — mirrors createPolyScene's castShadow describe block.
 *
 * Required cases:
 *   - default → no .polycss-shadow elements
 *   - castShadow + dynamic → per-mesh SVG shadow
 *   - castShadow + baked → per-mesh SVG shadow
 *   - shadow tag is <svg>
 *   - shadow transform is a translated SVG surface
 *   - toggling castShadow reactively adds/removes shadows
 *   - textured polygons ALSO cast shadows
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, defineComponent, h, inject, nextTick, ref, shallowRef } from "vue";
import type { ComputedRef } from "vue";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "./PolyScene";
import { PolyMesh } from "./PolyMesh";
import { PolySceneContextKey, type PolySceneContextValue } from "./sceneContext";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";

const TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

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

const DYNAMIC_SCENE_PROPS = {
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
  directionalLight: DYNAMIC_SCENE_PROPS.directionalLight,
};

function mount(
  sceneProps: Record<string, unknown>,
  meshProps: Record<string, unknown>,
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(PolyCamera, {}, {
          default: () =>
            h(PolyScene, sceneProps, {
              default: () => h(PolyMesh, meshProps),
            }),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PolyMesh (Vue) — castShadow", () => {
  it("default (no castShadow) emits no .polycss-shadow elements", () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, { polygons: [TRIANGLE] });
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);
  });

  it("castShadow:true in dynamic mode emits a single <svg> shadow per mesh (same path as baked)", async () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, {
      polygons: [TRIANGLE, DISTINCT_TRIANGLE],
      castShadow: true,
    });
    await nextTick();
    await nextTick();
    const shadows = container.querySelectorAll(".polycss-shadow");
    expect(shadows.length).toBe(1);
    expect(shadows[0]!.tagName.toLowerCase()).toBe("svg");
  });

  it("castShadow with a polygon slot emits no ground shadow", async () => {
    // A polygon-slot mesh owns its own leaves; the ground-shadow fallback
    // projects renderer-owned geometry and would not match the custom
    // output, so it is suppressed (mirrors React's renderPolygon gate).
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(PolyCamera, {}, {
            default: () =>
              h(PolyScene, { textureLighting: "baked" }, {
                default: () =>
                  h(PolyMesh, { polygons: [TRIANGLE], castShadow: true }, {
                    polygon: () => h("b"),
                  }),
              }),
          });
      },
    });
    app.mount(container);
    await nextTick();
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);
    app.unmount();
  });

  it("castShadow:true in baked mode emits a single <svg> shadow per mesh with one compound <path>", async () => {
    // Baked mode concatenates every casting polygon's projected outline
    // into ONE compound `d` (M…L…Z subpaths) rendered under
    // fill-rule=nonzero. One <path> per mesh regardless of polygon count.
    // nextTick lets the scene's watchEffect derive groundCssZ from the
    // child's registration before the shadow nodes recompute.
    const { container } = mount(
      BAKED_SCENE_PROPS,
      { polygons: [TRIANGLE], castShadow: true },
    );
    await nextTick();
    await nextTick();
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

  it("shadow elements are always <svg> with class polycss-shadow regardless of mode", async () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, {
      polygons: [TRIANGLE, DISTINCT_TRIANGLE],
      castShadow: true,
    });
    await nextTick();
    await nextTick();
    const shadows = Array.from(container.querySelectorAll(".polycss-shadow"));
    expect(shadows.length).toBeGreaterThan(0);
    for (const el of shadows) {
      expect(el.tagName.toLowerCase()).toBe("svg");
      expect(el.classList.contains("polycss-shadow-svg")).toBe(true);
    }
  });

  it("adding a casting mesh sets --shadow-ground-cssz on the scene element", async () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, {
      polygons: [TRIANGLE],
      castShadow: true,
    });
    // watchEffect writes --shadow-ground-cssz after the child PolyMesh registers,
    // which happens asynchronously after mount in Vue's reactive scheduler.
    await nextTick();
    const sceneEl = container.querySelector(".polycss-scene") as HTMLElement;
    expect(sceneEl).not.toBeNull();
    const groundVar = sceneEl.style.getPropertyValue("--shadow-ground-cssz");
    expect(groundVar).not.toBe("");
  });

  it("--shadow-ground-cssz is NOT set when there are no casting meshes", () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, {
      polygons: [TRIANGLE],
      castShadow: false,
    });
    const sceneEl = container.querySelector(".polycss-scene") as HTMLElement;
    expect(sceneEl.style.getPropertyValue("--shadow-ground-cssz")).toBe("");
  });

  it("toggling castShadow reactively adds and removes shadow SVGs", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const castShadow = ref(false);

    const app = createApp({
      setup() {
        return () =>
          h(PolyCamera, {}, {
            default: () =>
              h(PolyScene, DYNAMIC_SCENE_PROPS, {
                default: () => h(PolyMesh, { polygons: [TRIANGLE], castShadow: castShadow.value }),
              }),
          });
      },
    });
    app.mount(container);

    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);

    castShadow.value = true;
    await nextTick();
    expect(container.querySelectorAll(".polycss-shadow").length).toBeGreaterThan(0);

    castShadow.value = false;
    await nextTick();
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);
  });

  it("textured polygons (s) ALSO emit shadow SVGs", async () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, {
      polygons: [TEXTURED_TRIANGLE],
      castShadow: true,
    });
    await nextTick();
    await nextTick();
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(1);
  });

  it("no directional light → no ground-fallback shadow (no phantom default-sun shadow)", async () => {
    // Same gate as the receiver-face path: a scene with no lights at all
    // must not draw a ground shadow from an implicit default sun.
    const { container } = mount(
      { textureLighting: "baked" },
      { polygons: [TRIANGLE], castShadow: true },
    );
    await nextTick();
    await nextTick();
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);
  });

  it("zero-intensity directional light → no ground-fallback shadow", async () => {
    const { container } = mount(
      {
        textureLighting: "baked",
        directionalLight: { direction: [0.4, -0.7, 0.59] as Vec3, intensity: 0 },
      },
      { polygons: [TRIANGLE], castShadow: true },
    );
    await nextTick();
    await nextTick();
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);
  });

  it("followAnimation same-topology deforms throttle caster geometry bumps (~12fps) with a trailing emit", async () => {
    vi.useFakeTimers();
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const polys = shallowRef<Polygon[]>([TRIANGLE]);
      let ctx: ComputedRef<PolySceneContextValue> | null = null;
      const Probe = defineComponent({
        setup() {
          ctx = inject(PolySceneContextKey, null);
          return () => null;
        },
      });
      const app = createApp({
        setup() {
          return () =>
            h(PolyCamera, {}, {
              default: () =>
                h(
                  PolyScene,
                  { ...DYNAMIC_SCENE_PROPS, shadow: { followAnimation: true } },
                  {
                    default: () => [
                      h(PolyMesh, { polygons: polys.value, castShadow: true }),
                      h(Probe),
                    ],
                  },
                ),
            });
        },
      });
      app.mount(container);
      await nextTick();
      await nextTick();
      const registry = ctx!.value.shadowRegistry;
      expect(registry).toBeTruthy();
      const registeredPolygons = (): Polygon[] => registry!.getEntries()[0]!().polygons;
      // The registry serves the mesh's prepared copy — track identity across
      // bumps rather than comparing against the raw prop array.
      const initialRegistered = registeredPolygons();
      const deform = (dz: number): Polygon[] => [
        {
          ...TRIANGLE,
          vertices: TRIANGLE.vertices.map(([x, y, z]) => [x, y, z + dz] as Vec3),
        },
      ];
      // Rapid same-topology deforms inside the 80ms window: parked, the
      // registry still serves the pre-deform geometry (no downstream bump).
      polys.value = deform(0.1);
      await nextTick();
      await nextTick();
      polys.value = deform(0.2);
      await nextTick();
      await nextTick();
      polys.value = deform(0.3);
      await nextTick();
      await nextTick();
      expect(registeredPolygons()).toBe(initialRegistered);
      // Trailing edge: once the window elapses, exactly the LAST parked pose
      // lands (a paused animation is never stale).
      vi.advanceTimersByTime(200);
      await nextTick();
      await nextTick();
      const trailing = registeredPolygons();
      expect(trailing).not.toBe(initialRegistered);
      const zs = trailing.flatMap((p) => p.vertices.map((v) => v[2]));
      expect(zs.length).toBeGreaterThan(0);
      for (const z of zs) expect(z).toBeCloseTo(0.3, 9);
      app.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("disabling followAnimation cancels a pending trailing shadow bump", async () => {
    // Regression: the trailing timer fired even after followAnimation was
    // turned off — the freeze semantics must win at fire time, and the flip
    // cancels the pending timer eagerly.
    vi.useFakeTimers();
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const polys = shallowRef<Polygon[]>([TRIANGLE]);
      const follow = ref(true);
      let ctx: ComputedRef<PolySceneContextValue> | null = null;
      const Probe = defineComponent({
        setup() {
          ctx = inject(PolySceneContextKey, null);
          return () => null;
        },
      });
      const app = createApp({
        setup() {
          return () =>
            h(PolyCamera, {}, {
              default: () =>
                h(
                  PolyScene,
                  { ...DYNAMIC_SCENE_PROPS, shadow: { followAnimation: follow.value } },
                  {
                    default: () => [
                      h(PolyMesh, { polygons: polys.value, castShadow: true }),
                      h(Probe),
                    ],
                  },
                ),
            });
        },
      });
      app.mount(container);
      await nextTick();
      await nextTick();
      const registry = ctx!.value.shadowRegistry;
      const registeredPolygons = (): Polygon[] => registry!.getEntries()[0]!().polygons;
      const initialRegistered = registeredPolygons();
      const deform = (dz: number): Polygon[] => [
        {
          ...TRIANGLE,
          vertices: TRIANGLE.vertices.map(([x, y, z]) => [x, y, z + dz] as Vec3),
        },
      ];
      // Park a trailing bump inside the 80ms window…
      polys.value = deform(0.1);
      await nextTick();
      await nextTick();
      expect(registeredPolygons()).toBe(initialRegistered);
      // …then disable followAnimation before the window elapses.
      follow.value = false;
      await nextTick();
      await nextTick();
      vi.advanceTimersByTime(200);
      await nextTick();
      await nextTick();
      // No bump: the pending trailing emit was cancelled.
      expect(registeredPolygons()).toBe(initialRegistered);
      app.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fresh-but-equal inline shadow objects keep the scene context identity stable", async () => {
    // Regression: an inline `:shadow="{...}"` object is a new identity on
    // every parent render; it used to invalidate the scene context computed —
    // and every receiver's shadow-emit computed — per render even when no
    // shadow field changed. The scene now keys shadow identity field-wise.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const tick = ref(0);
    let ctx: ComputedRef<PolySceneContextValue> | null = null;
    const Probe = defineComponent({
      setup() {
        ctx = inject(PolySceneContextKey, null);
        return () => null;
      },
    });
    const app = createApp({
      setup() {
        return () => {
          void tick.value;
          return h(PolyCamera, {}, {
            default: () =>
              h(
                PolyScene,
                // INLINE shadow object — fresh-but-equal identity per render.
                { ...DYNAMIC_SCENE_PROPS, shadow: { followAnimation: true } },
                {
                  default: () => [
                    h(PolyMesh, { polygons: [TRIANGLE], castShadow: true }),
                    h(Probe),
                  ],
                },
              ),
          });
        };
      },
    });
    app.mount(container);
    await nextTick();
    await nextTick();
    const ctx0 = ctx!.value;
    const shadow0 = ctx0.shadow;
    tick.value++;
    await nextTick();
    await nextTick();
    // Equal-field shadow objects must not produce a new context value.
    expect(ctx!.value).toBe(ctx0);
    expect(ctx!.value.shadow).toBe(shadow0);
    app.unmount();
  });

  it("--clx/--cly/--clz are set on the scene element in dynamic mode", () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, { polygons: [TRIANGLE] });
    const sceneEl = container.querySelector(".polycss-scene") as HTMLElement;
    expect(sceneEl.style.getPropertyValue("--clx")).not.toBe("");
    expect(sceneEl.style.getPropertyValue("--cly")).not.toBe("");
    expect(sceneEl.style.getPropertyValue("--clz")).not.toBe("");
  });

  it("--clx/--cly/--clz are cleared when scene is in baked mode", () => {
    const { container } = mount({ textureLighting: "baked" }, { polygons: [TRIANGLE] });
    const sceneEl = container.querySelector(".polycss-scene") as HTMLElement;
    expect(sceneEl.style.getPropertyValue("--clx")).toBe("");
    expect(sceneEl.style.getPropertyValue("--cly")).toBe("");
    expect(sceneEl.style.getPropertyValue("--clz")).toBe("");
  });

  it("duplicate coincident polygons collapse into the same per-mesh shadow <svg>", async () => {
    // Two triangles at the same position both contribute to the same
    // mesh's compound SVG path (the loose dedup pass drops the second).
    const { container } = mount(DYNAMIC_SCENE_PROPS, {
      polygons: [TRIANGLE, { ...TRIANGLE }],
      castShadow: true,
    });
    await nextTick();
    await nextTick();
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(1);
  });

  it("--shadow-ground-cssz is set when a casting mesh is removed (scene without casting meshes clears it)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const hasMesh = ref(true);

    const app = createApp({
      setup() {
        return () =>
          h(PolyCamera, {}, {
            default: () =>
              h(PolyScene, DYNAMIC_SCENE_PROPS, {
                default: () =>
                  hasMesh.value
                    ? h(PolyMesh, { polygons: [TRIANGLE], castShadow: true })
                    : null,
              }),
          });
      },
    });
    app.mount(container);

    // Allow watchEffect to flush after child registers itself.
    await nextTick();

    const sceneEl = container.querySelector(".polycss-scene") as HTMLElement;
    expect(sceneEl.style.getPropertyValue("--shadow-ground-cssz")).not.toBe("");

    hasMesh.value = false;
    await nextTick();
    expect(sceneEl.style.getPropertyValue("--shadow-ground-cssz")).toBe("");
  });
});
