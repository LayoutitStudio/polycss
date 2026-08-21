/**
 * Receiver-shadow performance-parity tests — pin the memoization contract
 * that brings Vue in line with vanilla:
 *
 *  - a camera move that crosses NO receiver-face visibility boundary causes
 *    ZERO receiver-shadow pipeline work (no prepareCasterPolyItems /
 *    buildParametricCasterOverride / computeMergedReceiverShadows calls);
 *  - a camera move that DOES cross one re-emits, because the output depends
 *    on it: back-facing receiver faces are culled and creases bleed only
 *    toward camera-facing neighbours. The gate is the visibility signature,
 *    so the pipeline runs on boundary crossings — never per frame, and never
 *    "not at all" (which left stale geometry that popped on the next
 *    unrelated change). Mirrors vanilla's `syncShadowsForCameraChange`;
 *  - caster items are cached per (polygons identity + transform) and
 *    reused across re-emits (vanilla `casterItemsCache` parity);
 *  - the parametric override is built once per caster per self/cross
 *    variant and shared across receivers;
 *  - the O(n²) overlap dedup runs once per polygon-array identity even
 *    though two code paths consume it.
 *
 * Mirrors packages/react/src/scene/PolyMesh.receiverShadowPerf.test.tsx.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, defineComponent, h, inject, nextTick, ref } from "vue";
import * as core from "@layoutit/polycss-core";
import type { Polygon, PolyDirectionalLight } from "@layoutit/polycss-core";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyCameraContextKey } from "../camera";
import type { SceneStore } from "../store";
import { PolyScene } from "./PolyScene";
import { PolyMesh } from "./PolyMesh";

vi.mock("@layoutit/polycss-core", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@layoutit/polycss-core")>();
  return {
    ...mod,
    prepareCasterPolyItems: vi.fn(mod.prepareCasterPolyItems),
    buildParametricCasterOverride: vi.fn(mod.buildParametricCasterOverride),
    computeMergedReceiverShadows: vi.fn(mod.computeMergedReceiverShadows),
    findOverlappingPolygonDuplicates: vi.fn(mod.findOverlappingPolygonDuplicates),
  };
});

const casterItemsSpy = vi.mocked(core.prepareCasterPolyItems);
const overrideSpy = vi.mocked(core.buildParametricCasterOverride);
const mergeSpy = vi.mocked(core.computeMergedReceiverShadows);
const dedupSpy = vi.mocked(core.findOverlappingPolygonDuplicates);

// Fresh polygon arrays per test — the module-level WeakMap caches in
// PolyMesh key on array identity, so sharing constants across tests would
// leak cache hits between them.
function floorPolygons(yOffset = 0): Polygon[] {
  return [
    {
      vertices: [
        [-5, -5 + yOffset, 0],
        [5, -5 + yOffset, 0],
        [5, 5 + yOffset, 0],
        [-5, 5 + yOffset, 0],
      ],
      color: "#888888",
    },
  ];
}

/** A closed box: six faces spanning all six axis directions, so an orbit is
 *  guaranteed to cross camera-facing boundaries (unlike a lone floor plane). */
function boxPolygons(): Polygon[] {
  const H = 2;
  return ([
    [[-H, -H, H], [H, -H, H], [H, H, H], [-H, H, H]],
    [[H, -H, -H], [H, H, -H], [H, H, H], [H, -H, H]],
    [[H, H, -H], [-H, H, -H], [-H, H, H], [H, H, H]],
    [[-H, -H, -H], [-H, -H, H], [-H, H, H], [-H, H, -H]],
    [[-H, -H, -H], [H, -H, -H], [H, -H, H], [-H, -H, H]],
    [[-H, -H, -H], [-H, H, -H], [H, H, -H], [H, -H, -H]],
  ] as Array<Array<[number, number, number]>>).map((vertices) => ({
    vertices, color: "#888888",
  }));
}

function casterPolygons(): Polygon[] {
  return [
    {
      vertices: [
        [0, 0, 2],
        [1, 0, 2],
        [0, 1, 2],
      ],
      color: "#ff0000",
    },
  ];
}

const LIGHT_A: PolyDirectionalLight = {
  direction: [0.4, -0.7, 0.59],
  color: "#ffffff",
  intensity: 1,
};
/** Straight down: only a +z face can receive it. */
const LIGHT_DOWN: PolyDirectionalLight = {
  direction: [0, 0, 1],
  color: "#ffffff",
  intensity: 1,
};
/** Clears the box top (z = 2) so its shadow lands on the top face. */
function highCaster(): Polygon[] {
  return [
    {
      vertices: [
        [0, 0, 5],
        [1, 0, 5],
        [0, 1, 5],
      ],
      color: "#ff0000",
    },
  ];
}

const LIGHT_B: PolyDirectionalLight = {
  direction: [0.6, -0.5, 0.62],
  color: "#ffffff",
  intensity: 1,
};

let capturedStore: SceneStore | null = null;
const CaptureStore = defineComponent({
  name: "CaptureStore",
  setup() {
    const ctx = inject(PolyCameraContextKey, null);
    capturedStore = ctx?.store ?? null;
    return () => null;
  },
});

function mountScene(
  meshes: Array<Record<string, unknown>>,
  sceneProps: Record<string, unknown>,
): { container: HTMLElement; light: ReturnType<typeof ref<PolyDirectionalLight>> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const light = ref<PolyDirectionalLight>(sceneProps.directionalLight as PolyDirectionalLight);
  const app = createApp({
    setup() {
      return () =>
        h(PolyCamera, {}, {
          default: () => [
            h(CaptureStore),
            h(PolyScene, { ...sceneProps, directionalLight: light.value }, {
              default: () => meshes.map((meshProps, i) => h(PolyMesh, { key: i, ...meshProps })),
            }),
          ],
        });
    },
  });
  app.mount(container);
  return { container, light };
}

async function flushWork(): Promise<void> {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

afterEach(() => {
  document.body.innerHTML = "";
  capturedStore = null;
  vi.clearAllMocks();
});

describe("PolyMesh (Vue) — receiver-shadow memoization parity", () => {
  it("camera moves that cross no visibility boundary cause zero pipeline calls", async () => {
    const caster = casterPolygons();
    const floor = floorPolygons();
    mountScene(
      [
        { polygons: caster, castShadow: true },
        { polygons: floor, receiveShadow: true },
      ],
      {
        textureLighting: "baked",
        directionalLight: LIGHT_A,
        shadow: { parametric: true, definition: 8 },
      },
    );
    await flushWork();

    // The receiver pipeline ran at least once on mount/registration.
    expect(mergeSpy.mock.calls.length).toBeGreaterThan(0);
    const casterItemCalls = casterItemsSpy.mock.calls.length;
    const overrideCalls = overrideSpy.mock.calls.length;
    const mergeCalls = mergeSpy.mock.calls.length;

    // Simulate a camera orbit: mutate the camera store several times.
    const store = capturedStore!;
    expect(store).not.toBeNull();
    for (let i = 0; i < 5; i++) {
      const state = store.getState().cameraState;
      store.setState({ cameraState: { ...state, rotY: state.rotY + 7 } });
      await flushWork();
    }

    // Zero additional pipeline work: a single floor plane never changes its
    // camera facing, so the visibility signature is constant through the orbit.
    expect(casterItemsSpy.mock.calls.length).toBe(casterItemCalls);
    expect(overrideSpy.mock.calls.length).toBe(overrideCalls);
    expect(mergeSpy.mock.calls.length).toBe(mergeCalls);
  });

  it("re-emits when a camera move crosses a visibility boundary", async () => {
    // A box receiver: its faces DO change camera facing, so an orbit must
    // re-emit or the shadows go stale and pop on the next unrelated change.
    const caster = casterPolygons();
    const box = boxPolygons();
    mountScene(
      [
        { polygons: caster, castShadow: true },
        { polygons: box, receiveShadow: true },
      ],
      { textureLighting: "baked", directionalLight: LIGHT_A },
    );
    await flushWork();
    const mergeCalls = mergeSpy.mock.calls.length;
    expect(mergeCalls).toBeGreaterThan(0);

    const store = capturedStore!;
    const state = store.getState().cameraState;
    store.setState({ cameraState: { ...state, rotY: state.rotY + 180 } });
    await flushWork();
    expect(mergeSpy.mock.calls.length).toBeGreaterThan(mergeCalls);

    // …and it settles: re-notifying with the same camera does no more work.
    const settled = mergeSpy.mock.calls.length;
    store.notifyAll();
    await flushWork();
    expect(mergeSpy.mock.calls.length).toBe(settled);
  });

  it("caster items are cached across re-emits with unchanged polygons + transform", async () => {
    const caster = casterPolygons();
    const floor = floorPolygons();
    const { light } = mountScene(
      [
        { polygons: caster, castShadow: true },
        { polygons: floor, receiveShadow: true },
      ],
      { textureLighting: "baked", directionalLight: LIGHT_A },
    );
    await flushWork();

    const casterItemCalls = casterItemsSpy.mock.calls.length;
    expect(casterItemCalls).toBeGreaterThan(0);
    const mergeCalls = mergeSpy.mock.calls.length;

    // Light change → receiver re-emits, but the caster's world-space items
    // are unchanged (same polygons identity, same transform) → cache hit.
    light.value = LIGHT_B;
    await flushWork();

    expect(mergeSpy.mock.calls.length).toBeGreaterThan(mergeCalls); // re-emitted
    expect(casterItemsSpy.mock.calls.length).toBe(casterItemCalls); // cache hit
  });

  it("parametric override builds once per caster per self/cross variant across receivers", async () => {
    const caster = casterPolygons();
    const floorA = floorPolygons(0);
    const floorB = floorPolygons(20);
    mountScene(
      [
        // Caster also receives → exercises the self variant.
        { polygons: caster, castShadow: true, receiveShadow: true },
        { polygons: floorA, receiveShadow: true },
        { polygons: floorB, receiveShadow: true },
      ],
      {
        textureLighting: "baked",
        directionalLight: LIGHT_A,
        shadow: { parametric: true, definition: 8 },
      },
    );
    await flushWork();

    // Three receivers all project the same caster, but the override builder
    // runs once per variant: one cross (shared by both floors) + one self.
    expect(overrideSpy.mock.calls.length).toBe(2);
    const isSelfFlags = overrideSpy.mock.calls.map((call) => call[0].isSelf).sort();
    expect(isSelfFlags).toEqual([false, true]);
  });

  it("overlap dedup runs once per polygon-array identity across both consumers", async () => {
    const caster = casterPolygons();
    // No receiver → the ground-shadow path AND the caster registration both
    // dedup the same caster polygons with identical options.
    const { light } = mountScene(
      [{ polygons: caster, castShadow: true }],
      { textureLighting: "baked", directionalLight: LIGHT_A },
    );
    await flushWork();
    expect(dedupSpy.mock.calls.length).toBe(1);

    // Light change re-runs both consumers — still one dedup per identity.
    light.value = LIGHT_B;
    await flushWork();
    expect(dedupSpy.mock.calls.length).toBe(1);
  });
  it("ignores an unlit plane's horizon crossing, exactly as vanilla does", async () => {
    // Straight-down light: only the box's top face can receive it. Every side
    // face fails `L·n` in every pass, so it emits nothing at ANY camera angle
    // and its facing bit must not enter the signature — otherwise an orbit
    // that only crosses those planes' horizons re-emits the whole pipeline for
    // an output that cannot change. Vanilla passes `signatureLights`; React and
    // Vue omitted it, so they churned where vanilla did not.
    const caster = highCaster();
    const box = boxPolygons();
    mountScene(
      [
        { polygons: caster, castShadow: true },
        { polygons: box, receiveShadow: true },
      ],
      { textureLighting: "baked", directionalLight: LIGHT_DOWN },
    );
    await flushWork();
    const mergeCalls = mergeSpy.mock.calls.length;
    expect(mergeCalls).toBeGreaterThan(0);

    // The same orbit the test above proves DOES cross a boundary under a
    // tilted light — here every plane it crosses is unlit.
    const store = capturedStore!;
    for (const delta of [90, 90, 90, 90]) {
      const state = store.getState().cameraState;
      store.setState({ cameraState: { ...state, rotY: state.rotY + delta } });
      await flushWork();
    }
    expect(mergeSpy.mock.calls.length).toBe(mergeCalls);
  });
});
