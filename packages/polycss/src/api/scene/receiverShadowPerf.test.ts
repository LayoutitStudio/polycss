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
    computeMergedReceiverShadows: vi.fn(mod.computeMergedReceiverShadows),
  };
});

const casterItemsSpy = vi.mocked(core.prepareCasterPolyItems);
const overrideSpy = vi.mocked(core.buildParametricCasterOverride);
const dedupSpy = vi.mocked(core.findOverlappingPolygonDuplicates);
const mergeSpy = vi.mocked(core.computeMergedReceiverShadows);

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

// Receiver-shadow output depends on the camera: back-facing receiver faces are
// culled, and a crease bleeds only toward a camera-facing neighbour (which also
// flips that face between the opaque pre-blend and the alpha form). Left
// frozen, an orbit shows stale geometry that pops on the next unrelated change.
// Re-emitting every frame is the other failure — so the gate is the visibility
// SIGNATURE. Mirrored by the React/Vue camera-signature subscriptions.
describe("applyCamera — signature-gated shadow re-emit", () => {
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

  function boxReceiver(): Polygon[] {
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
    })) as Polygon[];
  }

  /** A slab just above the box that OVERHANGS its −y edge. LIGHT_A comes from
   *  −y, so shadows fall toward +y: the overhang is what puts shadow on the −y
   *  side face as well as the top. Two faces with different normals receiving
   *  is what makes the visible SET camera-dependent — the whole point here. */
  function hoveringCaster(): Polygon {
    return {
      vertices: [[-1.5, -4, 2.5], [-1.5, 0, 2.5], [1.5, 0, 2.5], [1.5, -4, 2.5]],
      color: "#ff0000",
    } as Polygon;
  }

  function build(): void {
    scene = createPolyScene(host, {
      camera: createPolyOrthographicCamera({ rotX: 55, rotY: 20 }),
      textureLighting: "baked",
      directionalLight: LIGHT_A,
      autoCenter: false,
      debugShadowAttrs: true,
    });
    scene.add(makeParseResult([hoveringCaster()]), { castShadow: true, merge: false });
    scene.add(makeParseResult(boxReceiver()), { receiveShadow: true, merge: false });
  }

  /** Face indices whose shadow SVG is currently painted. */
  function visibleFaces(): number[] {
    const svgs = host.querySelectorAll<SVGElement>("svg.polycss-shadow-receiver");
    return Array.from(svgs)
      .filter((s) => s.style.display !== "none")
      .map((s) => Number(s.getAttribute("data-poly-shadow-receiver-face")))
      .sort((a, b) => a - b);
  }

  it("does not re-emit when the camera crosses no facing boundary", () => {
    build();
    const before = mergeSpy.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    for (const rotY of [20.25, 20.5, 20.75, 21]) {
      scene!.camera.update({ rotY });
      scene!.applyCamera();
    }
    expect(mergeSpy.mock.calls.length).toBe(before);
  });

  it("re-emits once when the camera crosses one", () => {
    build();
    const before = mergeSpy.mock.calls.length;
    scene!.camera.update({ rotY: 200 });
    scene!.applyCamera();
    expect(mergeSpy.mock.calls.length).toBeGreaterThan(before);

    // …and settles: re-applying the same camera does no further work.
    const after = mergeSpy.mock.calls.length;
    scene!.applyCamera();
    expect(mergeSpy.mock.calls.length).toBe(after);
  });

  // A receiver whose normals are NOT the six axis directions, so it is not
  // camera-DOM-cullable. That matters: an axis-aligned box takes the voxel cull
  // path on rotation, which remounts and re-emits shadows as a side effect and
  // hides the bug. Every ordinary imported receiver looks like this one.
  const RECEIVER_ROTATION: [number, number, number] = [0, 0, 60];
  function tiltedReceiver(): Polygon[] {
    const r = (30 * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    return boxReceiver().map((p) => ({
      ...p,
      vertices: p.vertices.map(([x, y, z]) => [x * c - y * s, x * s + y * c, z]),
    })) as Polygon[];
  }
  /** Painted receiver shadow faces + the size of each path, as one key. */
  function shadowFingerprint(target: HTMLElement): string {
    return Array.from(target.querySelectorAll<SVGElement>("svg.polycss-shadow-receiver"))
      .filter((s) => s.style.display !== "none")
      .map((s) => `${s.getAttribute("data-poly-shadow-receiver-face")}:`
        + `${(s.querySelector("path")?.getAttribute("d") ?? "").length}`)
      .sort()
      .join("|");
  }
  function buildTilted(target: HTMLElement, rotY: number, rotateAfterBuild: boolean) {
    const built = createPolyScene(target, {
      camera: createPolyOrthographicCamera({ rotX: 55, rotY: rotateAfterBuild ? 20 : rotY }),
      textureLighting: "baked",
      directionalLight: LIGHT_A,
      autoCenter: false,
      debugShadowAttrs: true,
    });
    built.add(makeParseResult([hoveringCaster()]), { castShadow: true, merge: false });
    built.add(makeParseResult(tiltedReceiver()), {
      receiveShadow: true,
      merge: false,
      ...(rotateAfterBuild ? {} : { rotation: RECEIVER_ROTATION }),
    });
    if (rotateAfterBuild) {
      built.meshes()[1]!.setTransform({ rotation: RECEIVER_ROTATION });
      built.camera.update({ rotY });
      built.applyCamera();
    }
    return built;
  }

  it("re-emits when a receiver rotates", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const rotated = buildTilted(target, 20, false);
    const before = mergeSpy.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    // Rotation moves every face plane, so it belongs in the re-emit gate next
    // to position and scale. Skipping it also left the camera short-circuit in
    // emitSceneShadows comparing against identity-pose cached planes — the
    // rotation-aware plane cache key lives one level down, inside
    // emitReceiverShadows, and never gets consulted.
    rotated.meshes()[1]!.setTransform({ rotation: [0, 0, 25] });
    expect(mergeSpy.mock.calls.length).toBeGreaterThan(before);
    rotated.destroy();
    target.remove();
  });

  it("renders the same shadows whether the rotation was applied before or after the build", () => {
    // The oracle for the stale-plane failure: rotating at runtime must land on
    // exactly what a scene authored at that rotation shows. Sampled across a
    // full orbit — with the rotation left out of the gate, 9 of these 36
    // angles disagreed, including rotY 20, where the camera never moves at all.
    for (let rotY = 0; rotY < 360; rotY += 10) {
      const liveHost = document.createElement("div");
      const authoredHost = document.createElement("div");
      document.body.appendChild(liveHost);
      document.body.appendChild(authoredHost);
      const live = buildTilted(liveHost, rotY, true);
      const authored = buildTilted(authoredHost, rotY, false);
      expect(shadowFingerprint(liveHost), `rotY=${rotY}`).toBe(shadowFingerprint(authoredHost));
      live.destroy();
      authored.destroy();
      liveHost.remove();
      authoredHost.remove();
    }
    // 72 scene builds: fast locally (~150ms) but the default 5s budget is not
    // enough on a contended CI runner, where happy-dom setup alone costs ~100s
    // for this package. The sweep is the oracle for the stale-plane bug, so it
    // keeps its full resolution and takes an explicit budget instead.
  }, 60_000);

  it("emits geometry for the new camera, not the old one", () => {
    build();
    // From the front only the top face's shadow is drawn; the −y side face
    // catches the overhang's shadow but is turned away from the camera.
    const front = visibleFaces();
    expect(front).toEqual([0]);

    scene!.camera.update({ rotY: 200 });
    scene!.applyCamera();
    const back = visibleFaces();
    expect(back).not.toEqual(front);

    // The reviewer's repro: an unrelated light-driven rebuild must NOT change
    // what the orbit already shows — that difference is the visible pop.
    scene!.setOptions({ directionalLight: { ...LIGHT_A, intensity: 0.999 } });
    expect(visibleFaces()).toEqual(back);
  });
});
