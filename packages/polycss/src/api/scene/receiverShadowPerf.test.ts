/**
 * Receiver-shadow memoization tests for the vanilla scene — pin the
 * per-caster caches used by `emitReceiverShadows`:
 *
 *  - the parametric override is built once per caster per self/cross
 *    variant (from the hoisted cached world verts) and reused across every
 *    receiver AND across re-emits with an unchanged light;
 *  - the O(n²) overlap dedup (`findOverlappingPolygonDuplicates`) runs once
 *    per polygon-array identity + option set, not once per caster per emit;
 *  - `prepareCasterPolyItems` stays cached across light-only re-emits
 *    (regression pin for the pre-existing `casterItemsCache`).
 *
 * Mirrored by PolyMesh.receiverShadowPerf tests in react + vue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "@layoutit/polycss-core";
import type { ParseResult, Polygon } from "@layoutit/polycss-core";
import { createPolyScene, type PolySceneHandle } from "../createPolyScene";
import { createPolyOrthographicCamera } from "../createPolyCamera";

vi.mock("@layoutit/polycss-core", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@layoutit/polycss-core")>();
  return {
    ...mod,
    prepareCasterPolyItems: vi.fn(mod.prepareCasterPolyItems),
    buildParametricCasterOverride: vi.fn(mod.buildParametricCasterOverride),
    findOverlappingPolygonDuplicates: vi.fn(mod.findOverlappingPolygonDuplicates),
  };
});

const casterItemsSpy = vi.mocked(core.prepareCasterPolyItems);
const overrideSpy = vi.mocked(core.buildParametricCasterOverride);
const dedupSpy = vi.mocked(core.findOverlappingPolygonDuplicates);

function makeParseResult(polygons: Polygon[]): ParseResult {
  return {
    polygons,
    objectUrls: [],
    warnings: [],
    dispose: () => {},
  } as ParseResult;
}

function floor(yOffset = 0): Polygon {
  return {
    vertices: [
      [-10, -10 + yOffset, -0.1],
      [10, -10 + yOffset, -0.1],
      [10, 10 + yOffset, -0.1],
      [-10, 10 + yOffset, -0.1],
    ],
    color: "#888888",
  };
}

function casterTriangle(): Polygon {
  return {
    vertices: [
      [0, 0, 2],
      [0, 1, 2],
      [1, 0, 2],
    ],
    color: "#ff0000",
  };
}

const LIGHT_A = {
  direction: [0.4, -0.7, 0.59] as [number, number, number],
  color: "#ffffff",
  intensity: 1,
};
const LIGHT_B = {
  direction: [0.6, -0.5, 0.62] as [number, number, number],
  color: "#ffffff",
  intensity: 1,
};

describe("emitReceiverShadows — per-caster caches", () => {
  let host: HTMLElement;
  let scene: PolySceneHandle | null = null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    scene?.destroy();
    scene = null;
    host.remove();
    vi.clearAllMocks();
  });

  it("builds the parametric override once per caster per self/cross variant, reused across receivers", () => {
    scene = createPolyScene(host, {
      camera: createPolyOrthographicCamera({}),
      textureLighting: "baked",
      directionalLight: LIGHT_A,
      shadow: { parametric: true, definition: 8 },
    });
    scene.add(makeParseResult([floor(0)]), { receiveShadow: true });
    scene.add(makeParseResult([floor(40)]), { receiveShadow: true });
    // Caster also receives → exercises the self variant.
    scene.add(makeParseResult([casterTriangle()]), { castShadow: true, receiveShadow: true });

    // Three receivers project the same caster, but the override builder runs
    // once per variant: one cross (shared by both floors) + one self.
    expect(overrideSpy.mock.calls.length).toBe(2);
    const isSelfFlags = overrideSpy.mock.calls.map((call) => call[0].isSelf).sort();
    expect(isSelfFlags).toEqual([false, true]);

    // A light change re-emits and rebuilds both variants exactly once each.
    scene.setOptions({ directionalLight: LIGHT_B });
    expect(overrideSpy.mock.calls.length).toBe(4);
  });

  it("keeps caster items and overlap dedup cached across light-only re-emits", () => {
    scene = createPolyScene(host, {
      camera: createPolyOrthographicCamera({}),
      textureLighting: "baked",
      directionalLight: LIGHT_A,
    });
    scene.add(makeParseResult([floor()]), { receiveShadow: true });
    scene.add(makeParseResult([casterTriangle()]), { castShadow: true });

    const casterItemCalls = casterItemsSpy.mock.calls.length;
    const dedupCalls = dedupSpy.mock.calls.length;
    expect(casterItemCalls).toBeGreaterThan(0);
    expect(dedupCalls).toBeGreaterThan(0);

    // Light-only changes re-emit the receiver shadows but neither the
    // caster's world-space items nor the O(n²) dedup drop-set recompute
    // (polygon identity + transform unchanged).
    scene.setOptions({ directionalLight: LIGHT_B });
    scene.setOptions({ directionalLight: LIGHT_A });

    expect(casterItemsSpy.mock.calls.length).toBe(casterItemCalls);
    expect(dedupSpy.mock.calls.length).toBe(dedupCalls);
  });
});
