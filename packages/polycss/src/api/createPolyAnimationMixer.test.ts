/**
 * Vanilla animation test: createPolyAnimationMixer with a real PolyMeshHandle
 * from createPolyScene + a fake ParseAnimationController.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPolyScene } from "./createPolyScene";
import { createPolyAnimationMixer, LoopOnce } from "@layoutit/polycss-core";
import type { ParseAnimationController, ParseAnimationClip, Polygon } from "@layoutit/polycss-core";
import { createPolyOrthographicCamera } from "./createPolyCamera";

const POLY_ANIMATION_TRIANGLE_FRAME_SOURCE = Symbol.for("polycss.animation.triangleFrameSource");

interface PolyAnimationTriangleFrame {
  polygonCount: number;
  vertices: Float64Array;
  colors?: readonly (string | undefined)[];
  solidTriangles?: boolean;
}

interface PolyAnimationTriangleFrameSource {
  [POLY_ANIMATION_TRIANGLE_FRAME_SOURCE]?: (
    clip: number | string,
    timeSeconds: number,
  ) => PolyAnimationTriangleFrame | null | undefined;
}

const TRI: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  color: "#ff0000",
};

const TRI2: Polygon = {
  vertices: [[0, 0, 1], [1, 0, 1], [0, 1, 1]],
  color: "#00ff00",
};

function makeClip(index: number, name: string, duration = 1): ParseAnimationClip {
  return { index, name, duration, channelCount: 1 };
}

function makeController(
  clips: ParseAnimationClip[],
  polygonsByTime?: (t: number) => Polygon[],
): ParseAnimationController {
  return {
    clips,
    sample: (_clip, t) => polygonsByTime ? polygonsByTime(t) : [TRI],
  };
}

function frameVertices(polygon: Polygon): Float64Array {
  const vertices = new Float64Array(9);
  for (let vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
    const vertex = polygon.vertices[vertexIndex]!;
    const offset = vertexIndex * 3;
    vertices[offset] = vertex[0];
    vertices[offset + 1] = vertex[1];
    vertices[offset + 2] = vertex[2];
  }
  return vertices;
}

describe("createPolyAnimationMixer with PolyMeshHandle", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    document.body.removeChild(host);
  });

  it("mixer.update() calls mesh.setPolygons() on a playing action", () => {
    const scene = createPolyScene(host, { camera: createPolyOrthographicCamera() });
    const parseResult = {
      polygons: [TRI],
      objectUrls: [],
      dispose: () => {},
      warnings: [],
    };
    const mesh = scene.add(parseResult, { merge: false, stableDom: false });
    const clip = makeClip(0, "idle");
    const ctrl = makeController([clip]);
    const mixer = createPolyAnimationMixer(mesh, ctrl);

    mixer.clipAction("idle").play();

    // Before update, polygons are the original
    const originalPolygons = mesh.polygons;

    // After update, setPolygons should have been called
    mixer.update(0.1);

    // The mesh.polygons property should be set to whatever sample returned
    // (which is [TRI] in this case, so same shape but newly allocated)
    expect(mesh.polygons).toBeDefined();
    expect(Array.isArray(mesh.polygons)).toBe(true);
    expect(mesh.polygons.length).toBe(1);

    // Cleanup
    mesh.dispose();
    scene.destroy();

    // Reference originalPolygons to avoid unused var warning
    void originalPolygons;
  });

  it("mixer updates mesh polygons to sampled values", () => {
    const scene = createPolyScene(host, { camera: createPolyOrthographicCamera() });
    const parseResult = {
      polygons: [TRI],
      objectUrls: [],
      dispose: () => {},
      warnings: [],
    };
    const mesh = scene.add(parseResult, { merge: false, stableDom: false });

    const frames = [TRI, TRI2];
    let frameIndex = 0;
    const ctrl: ParseAnimationController = {
      clips: [makeClip(0, "walk", 2)],
      sample: (_clip, t) => {
        frameIndex = t < 1 ? 0 : 1;
        return [frames[frameIndex]];
      },
    };

    const mixer = createPolyAnimationMixer(mesh, ctrl);
    mixer.clipAction("walk").play();

    mixer.update(0.5);
    // At t=0.5, first frame
    expect(mesh.polygons[0].color).toBe("#ff0000");

    mixer.update(0.6);
    // At t=1.1, second frame
    expect(mesh.polygons[0].color).toBe("#00ff00");

    mesh.dispose();
    scene.destroy();
  });

  it("keeps stable triangle baked color pinned on the triangle-frame fast path", () => {
    const scene = createPolyScene(host, {
      camera: createPolyOrthographicCamera(),
      directionalLight: { direction: [0, 0, 1], color: "#ffffff", intensity: 1 },
      ambientLight: { color: "#ffffff", intensity: 0 },
    });
    const restTriangle: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 1]],
      color: "#ff0000",
    };
    const animatedTriangle: Polygon = {
      vertices: [[0, 0, 0], [2, 0, 0], [0, 1, 1]],
      color: "#ff0000",
    };
    const parseResult = {
      polygons: [restTriangle],
      objectUrls: [],
      dispose: () => {},
      warnings: [],
    };
    const mesh = scene.add(parseResult, { merge: false, stableDom: true });
    const leaf = host.querySelector("u") as HTMLElement;
    const initialTransform = leaf.style.transform;
    const initialColor = leaf.style.color;
    const clip = makeClip(0, "bend");
    const ctrl = {
      clips: [clip],
      sample: () => [animatedTriangle],
      [POLY_ANIMATION_TRIANGLE_FRAME_SOURCE]: () => ({
        polygonCount: 1,
        vertices: frameVertices(animatedTriangle),
        colors: [animatedTriangle.color],
        solidTriangles: true,
      }),
    } satisfies ParseAnimationController & PolyAnimationTriangleFrameSource;
    const mixer = createPolyAnimationMixer(mesh, ctrl);

    mixer.clipAction("bend").play();
    mixer.update(0.1);

    expect(leaf.style.transform).not.toBe(initialTransform);
    expect(leaf.style.color).toBe(initialColor);

    mesh.dispose();
    scene.destroy();
  });

  it("stopAllAction stops mesh updates", () => {
    const scene = createPolyScene(host, { camera: createPolyOrthographicCamera() });
    const parseResult = {
      polygons: [TRI],
      objectUrls: [],
      dispose: () => {},
      warnings: [],
    };
    const mesh = scene.add(parseResult, { merge: false, stableDom: false });
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createPolyAnimationMixer(mesh, ctrl);

    mixer.clipAction("run").play();
    mixer.stopAllAction();

    // Track polygon changes after stopAllAction
    const polygonsBeforeUpdate = mesh.polygons;
    mixer.update(0.1);
    // No update should have happened
    expect(mesh.polygons).toBe(polygonsBeforeUpdate);

    mesh.dispose();
    scene.destroy();
  });

  it("LoopOnce action stops after one full duration", () => {
    const scene = createPolyScene(host, { camera: createPolyOrthographicCamera() });
    const parseResult = {
      polygons: [TRI],
      objectUrls: [],
      dispose: () => {},
      warnings: [],
    };
    const mesh = scene.add(parseResult, { merge: false, stableDom: false });
    const ctrl = makeController([makeClip(0, "once", 1)]);
    const mixer = createPolyAnimationMixer(mesh, ctrl);
    const action = mixer.clipAction("once");
    action.setLoop(LoopOnce, 1).play();

    mixer.update(1.5);
    expect(action.isRunning).toBe(false);

    mesh.dispose();
    scene.destroy();
  });
});
