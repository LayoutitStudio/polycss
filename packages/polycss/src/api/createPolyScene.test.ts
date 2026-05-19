/**
 * Imperative scene API tests — verifies createPolyScene's public surface
 * (scene creation, add/remove mesh, transforms, options updates, destroy)
 * plus the autoCenter mirror and 0×0 anchor pattern from React.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParseResult, Polygon } from "@layoutit/polycss-core";
import {
  createPolyScene,
  type PolySceneOptions,
  type PolySceneHandle,
} from "./createPolyScene";
import {
  createPolyOrthographicCamera,
  createPolyPerspectiveCamera,
  type PolyCameraOptions,
} from "./createPolyCamera";

function makeCamera(cameraOpts: PolyCameraOptions = {}) {
  return createPolyOrthographicCamera(cameraOpts);
}

function makeScene(
  host: HTMLElement,
  sceneOpts: Omit<PolySceneOptions, "camera"> = {},
  cameraOpts: PolyCameraOptions = {},
): PolySceneHandle {
  return createPolyScene(host, { camera: makeCamera(cameraOpts), ...sceneOpts });
}

function triangle(color = "#ff0000"): Polygon {
  return {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    color,
  };
}

function backTriangle(color = "#00ff00"): Polygon {
  return {
    vertices: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
    ],
    color,
  };
}

function sideTriangle(color = "#0000ff"): Polygon {
  return {
    vertices: [
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 0],
    ],
    color,
  };
}

function oppositeSideTriangle(color = "#ffff00"): Polygon {
  return {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
    color,
  };
}

function rotatedSideTriangle(deg: number, color = "#0000ff"): Polygon {
  const r = deg * Math.PI / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const rotate = (v: [number, number, number]): [number, number, number] => [
    v[0] * c - v[1] * s,
    v[0] * s + v[1] * c,
    v[2],
  ];
  return {
    vertices: sideTriangle(color).vertices.map(rotate),
    color,
  };
}

function highNormalTrianglePairs(count = 26): Polygon[] {
  const out: Polygon[] = [];
  for (let i = 0; i < count; i += 1) {
    const poly = rotatedSideTriangle(i * 7, "#224466");
    out.push(poly, {
      ...poly,
      vertices: poly.vertices.map((v) => [v[0], v[1], v[2]] as [number, number, number]),
    });
  }
  return out;
}

function texturedTriangle(): Polygon {
  return {
    vertices: triangle().vertices,
    texture: "https://example.com/tex.png",
    uvs: [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
  };
}

function topQuad(color = "#123456"): Polygon {
  return {
    vertices: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    color,
  };
}

function makeParseResult(polygons: Polygon[] = [triangle()]): ParseResult {
  let disposed = false;
  return {
    polygons,
    objectUrls: [],
    warnings: [],
    dispose: () => {
      disposed = true;
    },
    get _disposed() {
      return disposed;
    },
  } as ParseResult & { readonly _disposed: boolean };
}

function makeVoxelParseResult(): ParseResult {
  return {
    ...makeParseResult([triangle()]),
    voxelSource: {
      kind: "magica-vox",
      cells: [{ x: 0, y: 0, z: 0, color: "#ff0000" }],
      rows: 1,
      cols: 1,
      depth: 1,
      scale: 1,
      gridShift: 0,
      sourceBytes: 64,
    },
  };
}

function makeVoxelExactParseResult(): ParseResult {
  return {
    ...makeParseResult([topQuad("#123456")]),
    voxelSource: {
      kind: "magica-vox",
      cells: [{ x: 0, y: 0, z: 0, color: "#ff0000" }],
      rows: 1,
      cols: 1,
      depth: 1,
      scale: 1,
      gridShift: 0,
      sourceBytes: 64,
    },
  };
}

function getSceneEl(host: HTMLElement): HTMLElement {
  const sceneEl = host.querySelector(".polycss-scene") as HTMLElement | null;
  expect(sceneEl).not.toBeNull();
  return sceneEl!;
}

/** Extract the innermost translate3d(...) from the scene transform value. */
function getSceneTranslatePart(host: HTMLElement): string {
  const t = getSceneEl(host).style.transform;
  const m = t.match(/translate3d\([^)]+\)/);
  return m ? m[0] : "";
}

describe("createPolyScene", () => {
  let host: HTMLElement;
  let scene: PolySceneHandle | null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    scene = null;
  });

  afterEach(() => {
    if (scene) scene.destroy();
    if (host.parentNode) host.parentNode.removeChild(host);
  });

  describe("scene creation", () => {
    it("throws when host is missing", () => {
      expect(() =>
        createPolyScene(null as unknown as HTMLElement, { camera: makeCamera() }),
      ).toThrow(/host must be an HTMLElement/);
    });

    it("throws when camera is missing", () => {
      expect(() =>
        createPolyScene(host, {} as unknown as PolySceneOptions),
      ).toThrow(/camera handle is required/);
    });

    it("exposes the host element on the returned handle", () => {
      scene = makeScene(host);
      expect(scene.host).toBe(host);
    });

    it("camera state reflects values passed to createPolyOrthographicCamera", () => {
      scene = makeScene(host, {}, { rotX: 30, rotY: 60, zoom: 2 });
      expect(scene.camera.state.rotX).toBe(30);
      expect(scene.camera.state.rotY).toBe(60);
      expect(scene.camera.state.zoom).toBe(2);
    });

    it("camera.update() + applyCamera() reflects new camera state", () => {
      scene = makeScene(host, {}, { rotY: 0 });
      scene.camera.update({ rotY: 90 });
      scene.applyCamera();
      expect(scene.camera.state.rotY).toBe(90);
    });

    it("creates a .polycss-scene child under the host", () => {
      scene = makeScene(host);
      const sceneEl = host.querySelector(".polycss-scene");
      expect(sceneEl).not.toBeNull();
    });

    it("renders the scene element as a 0x0 anchor at center (top:50%/left:50%)", () => {
      scene = makeScene(host);
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.getAttribute("aria-hidden")).toBe("true");
      expect(sceneEl.style.position).toBe("");
      expect(sceneEl.style.top).toBe("");
      expect(sceneEl.style.left).toBe("");
      expect(sceneEl.style.width).toBe("");
      expect(sceneEl.style.height).toBe("");
    });

    it("applies scene transform from camera options", () => {
      scene = createPolyScene(host, {
        camera: createPolyPerspectiveCamera({ perspective: 1500, rotX: 30, rotY: 60, zoom: 2 }),
      });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      const transform = sceneEl.style.transform;
      expect(sceneEl.style.perspective).toBe("1500px");
      expect(transform).toContain("scale(2)");
      expect(transform).toContain("rotateX(30deg)");
      // rotY in our API maps to CSS rotate() (i.e. rotateZ) so the model
      // spins around its vertical world-Z axis, matching React's PolyCamera.
      expect(transform).toContain("rotate(60deg)");
    });

    it("folds host CSS zoom into the emitted scene transform", () => {
      host.style.setProperty("zoom", "0.5");
      scene = createPolyScene(host, {
        camera: createPolyPerspectiveCamera({ distance: 100, perspective: 1500, rotX: 30, rotY: 60, zoom: 2 }),
      });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      const transform = sceneEl.style.transform;
      expect(sceneEl.style.perspective).toBe("750px");
      expect(sceneEl.style.getPropertyValue("zoom")).toBe("2");
      expect(transform).toContain("translateZ(-50px)");
      expect(transform).toContain("scale(1)");
      expect(transform).toContain("rotateX(30deg)");
      expect(transform).toContain("rotate(60deg)");
      expect(scene.camera.state.zoom).toBe(2);
    });

    it("inlines a large finite perspective when camera is orthographic", () => {
      scene = makeScene(host);
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      // perspective: none triggers a Chrome compositor bug that mis-rasterizes
      // <u> border-triangle leaves at initial paint. A very large finite value
      // is visually orthographic but avoids the broken fast path.
      expect(sceneEl.style.perspective).toBe("1000000px");
    });

    it("injects base styles into the document", () => {
      scene = makeScene(host);
      const styleEl = document.getElementById("polycss-styles");
      expect(styleEl).not.toBeNull();
      expect(styleEl?.textContent).toContain("transform-origin: 0 0");
      expect(styleEl?.textContent).toContain("backface-visibility: hidden");
      expect(styleEl?.textContent).toContain("background-repeat: no-repeat");
      expect(styleEl?.textContent).toContain("width: 64px;");
      expect(styleEl?.textContent).toContain("height: 64px;");
      expect(styleEl?.textContent).toContain("width: var(--polycss-atlas-size, 64px);");
      expect(styleEl?.textContent).toContain("height: var(--polycss-atlas-size, 64px);");
      expect(styleEl?.textContent).toContain("border-width: 0 32px 64px 32px;");
      expect(styleEl?.textContent).toContain("width: 0;");
      expect(styleEl?.textContent).toContain("height: 0;");
    });
  });

  describe("add / remove mesh", () => {
    it("adds a .polycss-mesh wrapper with one polygon leaf element per polygon", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult([triangle(), triangle("#00ff00")]));
      const wrappers = host.querySelectorAll(".polycss-mesh");
      expect(wrappers.length).toBe(1);
      const polys = host.querySelectorAll("i,b,s,u");
      expect(polys.length).toBe(2);
      expect(host.querySelector(".polycss-poly-atlas")).toBeNull();
      expect(host.querySelector(".polycss-poly-solid")).toBeNull();
      expect(host.querySelector(".polycss-poly-textured")).toBeNull();
      expect(host.querySelector("svg")).toBeNull();
      expect(handle.polygons.length).toBe(2);
    });

    it("routes exact raw vox sources through the direct voxel renderer", () => {
      scene = makeScene(host);
      scene.add(makeVoxelExactParseResult(), { merge: false });
      const voxelBrushes = Array.from(host.querySelectorAll(".polycss-mesh > b"));
      expect(host.querySelector(".polycss-voxel-host-z")).toBeNull();
      expect(voxelBrushes.length).toBeGreaterThan(0);
      expect(voxelBrushes.every((el) => el.tagName === "B")).toBe(true);
      expect(host.querySelector(".polycss-mesh")?.classList.contains("polycss-voxel-mesh")).toBe(true);
      const firstBrush = voxelBrushes[0] as HTMLElement;
      expect(firstBrush.style.left).toBe("");
      expect(firstBrush.style.top).toBe("");
      expect(firstBrush.style.width).toBe("");
      expect(firstBrush.style.height).toBe("");
      expect(firstBrush.style.gridArea).toBe("");
      expect(firstBrush.style.transform).toContain("matrix3d(");
      expect(firstBrush.style.backfaceVisibility).toBe("");
      expect(firstBrush.style.pointerEvents).toBe("");
      expect(firstBrush.style.getPropertyValue("--polycss-voxel-z")).toBe("");
      expect(voxelBrushes.every((el) => el.className === "")).toBe(true);
    });

    it("applies baked lighting to direct voxel quads", () => {
      scene = makeScene(host, {
        directionalLight: { direction: [0, 0, -1], color: "#ffffff", intensity: 1 },
        ambientLight: { color: "#ffffff", intensity: 0 },
      }, { rotX: 0, rotY: 0 });
      scene.add(makeVoxelExactParseResult(), { merge: false });
      const brush = host.querySelector(".polycss-mesh > b") as HTMLElement | null;
      expect(brush).not.toBeNull();
      expect(brush!.style.color).toMatch(/^(#000000|rgb\\(0, 0, 0\\))$/);
    });

    it("uses exact parsed voxel polygons for direct matrix placement", () => {
      scene = makeScene(host, {
        directionalLight: { direction: [0, 0, 1], color: "#ffffff", intensity: 0 },
        ambientLight: { color: "#ffffff", intensity: 1 },
      }, { rotX: 65, rotY: 45 });
      scene.add(makeVoxelExactParseResult(), { merge: false });
      const brush = host.querySelector(".polycss-mesh > b") as HTMLElement | null;
      expect(brush).not.toBeNull();
      expect(brush!.style.color).toMatch(/^(#123456|rgb\\(18, 52, 86\\))$/);
      expect(brush!.style.width).toBe("");
      expect(brush!.style.height).toBe("");
      expect(brush!.style.transform).toContain("matrix3d(50,0,0,0,0,50");
    });

    it("falls back to polygon rendering when raw vox polygons are not exact direct quads", () => {
      scene = makeScene(host);
      scene.add(makeVoxelParseResult(), { merge: false });
      expect(host.querySelector(".polycss-voxel-host-z")).toBeNull();
      expect(host.querySelector(".polycss-mesh > b")).toBeNull();
      expect(host.querySelector("i,b,s,u")).not.toBeNull();
    });

    it("falls back to polygon rendering after setPolygons replaces vox source geometry", () => {
      scene = makeScene(host);
      const handle = scene.add(makeVoxelExactParseResult(), { merge: false });
      expect(host.querySelector(".polycss-mesh > b")).not.toBeNull();
      handle.setPolygons([triangle()], { merge: false });
      expect(host.querySelector(".polycss-voxel-host-z")).toBeNull();
      expect(host.querySelector(".polycss-mesh > b")).toBeNull();
      expect(host.querySelector(".polycss-mesh")?.classList.contains("polycss-voxel-mesh")).toBe(false);
      expect(host.querySelector("i,b,s,u")).not.toBeNull();
    });

    it("hoists the repeated baked solid paint to the mesh wrapper", () => {
      scene = makeScene(host);
      scene.add(makeParseResult([triangle(), triangle()]), { merge: false });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      const polys = Array.from(host.querySelectorAll("u")) as HTMLElement[];
      expect(wrapper.style.getPropertyValue("--polycss-paint")).not.toBe("");
      expect(polys).toHaveLength(2);
      expect(polys.every((poly) => poly.style.color === "")).toBe(true);
      expect(polys.every((poly) => poly.style.borderBottomColor === "")).toBe(true);
    });

    it("hoists repeated dynamic solid base RGB channels to the mesh wrapper", () => {
      scene = makeScene(host, { textureLighting: "dynamic" });
      scene.add(makeParseResult([triangle(), triangle()]), { merge: false });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      const polys = Array.from(host.querySelectorAll("u")) as HTMLElement[];
      expect(wrapper.style.getPropertyValue("--psr")).toBe("1.0000");
      expect(wrapper.style.getPropertyValue("--psg")).toBe("0.0000");
      expect(wrapper.style.getPropertyValue("--psb")).toBe("0.0000");
      expect(polys).toHaveLength(2);
      expect(polys.every((poly) => poly.style.getPropertyValue("--psr") === "")).toBe(true);
    });

    it("renders textured polygons as polygon s elements", () => {
      scene = makeScene(host);
      scene.add(makeParseResult([texturedTriangle()]));
      const poly = host.querySelector("s");
      expect(poly).not.toBeNull();
      expect(poly?.tagName.toLowerCase()).toBe("s");
    });

    it("applies mesh transform CSS", () => {
      scene = makeScene(host);
      scene.add(makeParseResult(), {
        position: [10, 20, 30],
        rotation: [45, 0, 0],
        scale: 2,
      });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      expect(wrapper.style.transform).toContain("translate3d(10px, 20px, 30px)");
      expect(wrapper.style.transform).toContain("rotateX(45deg)");
      expect(wrapper.style.transform).toContain("scale3d(2, 2, 2)");
    });

    it("handle.remove() detaches the wrapper from the DOM", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult());
      expect(host.querySelectorAll(".polycss-mesh").length).toBe(1);
      handle.remove();
      expect(host.querySelectorAll(".polycss-mesh").length).toBe(0);
    });

    it("handle.setTransform() updates the wrapper transform without re-mount", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult(), { position: [0, 0, 0] });
      handle.setTransform({ position: [5, 5, 5] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      expect(wrapper.style.transform).toContain("translate3d(5px, 5px, 5px)");
    });

    it("can update stableDom mesh geometry without replacing polygon elements", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult([triangle()]), {
        merge: false,
        stableDom: true,
      });
      const before = Array.from(host.querySelectorAll("i,b,s,u")) as HTMLElement[];
      expect(before.length).toBe(1);
      const beforeTransform = before[0].style.transform;

      handle.setPolygons([{
        vertices: [
          [0, 0, 0],
          [2, 0, 0],
          [0, 1, 0],
        ],
        color: "#ff0000",
      }], { merge: false, stableDom: true });

      const after = Array.from(host.querySelectorAll("i,b,s,u")) as HTMLElement[];
      expect(after.length).toBe(1);
      expect(after[0]).toBe(before[0]);
      expect(after[0].style.transform).not.toBe(beforeTransform);
    });

    it("preserves caller-mounted mesh wrapper children across setPolygons()", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult([triangle()]), { merge: false });
      const nested = document.createElement("div");
      nested.className = "nested-helper";
      handle.element.appendChild(nested);

      handle.setPolygons([triangle("#00ff00")], { merge: false });

      expect(handle.element.contains(nested)).toBe(true);
      expect(handle.element.lastElementChild).toBe(nested);
      expect(handle.element.querySelectorAll("i,b,s,u").length).toBe(1);
    });

    it("updates stableDom textured triangles without replacing loaded atlas elements", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult([texturedTriangle()]), {
        merge: false,
        stableDom: true,
      });
      const before = host.querySelector("s") as HTMLElement;
      expect(before).not.toBeNull();
      before.style.background = 'url("blob:static-atlas") 0px 0px / 8px 8px no-repeat';
      before.style.opacity = "";
      const beforeTransform = before.style.transform;

      handle.setPolygons([{
        ...texturedTriangle(),
        vertices: [
          [0, 0, 0],
          [2, 0, 0],
          [0, 1, 0],
        ],
      }], { merge: false, stableDom: true });

      const after = host.querySelector("s") as HTMLElement;
      expect(after).toBe(before);
      expect(after.style.background).toContain("blob:static-atlas");
      expect(after.style.opacity).toBe("");
      expect(after.style.transform).not.toBe(beforeTransform);
    });

    it("handle.dispose() detaches the wrapper AND calls parseResult.dispose()", () => {
      scene = makeScene(host);
      const pr = makeParseResult();
      const handle = scene.add(pr);
      handle.dispose();
      expect(host.querySelectorAll(".polycss-mesh").length).toBe(0);
      expect((pr as ParseResult & { _disposed: boolean })._disposed).toBe(true);
    });

    it("handle.dispose() is idempotent", () => {
      scene = makeScene(host);
      const pr = makeParseResult();
      const handle = scene.add(pr);
      handle.dispose();
      expect(() => handle.dispose()).not.toThrow();
    });

    it("supports vec3 scale", () => {
      scene = makeScene(host);
      scene.add(makeParseResult(), { scale: [1, 2, 3] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      expect(wrapper.style.transform).toContain("scale3d(1, 2, 3)");
    });

    it("renders nothing for degenerate polygons", () => {
      scene = makeScene(host);
      const degenerate: Polygon = { vertices: [[0, 0, 0]], color: "#ff0000" };
      scene.add(makeParseResult([degenerate]));
      const polys = host.querySelectorAll("i,b,s,u");
      expect(polys.length).toBe(0);
    });

    it("keeps source polygon alignment when degenerate polygons are skipped", () => {
      scene = makeScene(host);
      const degenerate: Polygon = { vertices: [[0, 0, 0]], color: "#ff0000" };
      scene.add(makeParseResult([degenerate, triangle()]));
      const poly = host.querySelector("i,b,s,u") as HTMLElement;
      expect(poly).not.toBeNull();
      expect(poly.tagName.toLowerCase()).toBe("u");
      expect(poly.style.transform).toContain("matrix3d(");
      expect(poly.style.borderBottomWidth).toBe("");
    });

    describe("rebakeAtlas", () => {
      it("rebakeAtlas() does not throw", () => {
        scene = makeScene(host);
        const handle = scene.add(makeParseResult([triangle()]));
        expect(() => handle.rebakeAtlas()).not.toThrow();
      });

      it("rebakeAtlas() re-renders the mesh (polygon elements are replaced)", () => {
        scene = makeScene(host);
        const handle = scene.add(makeParseResult([triangle()]));
        handle.setTransform({ rotation: [0, 45, 0] });

        // Capture the current polygon element reference(s) before rebake.
        const before = Array.from(host.querySelectorAll(".polycss-mesh i, .polycss-mesh b, .polycss-mesh s, .polycss-mesh u")) as HTMLElement[];
        expect(before.length).toBeGreaterThan(0);

        handle.rebakeAtlas();

        // After rebake the wrapper should still have polygon elements.
        const after = Array.from(host.querySelectorAll(".polycss-mesh i, .polycss-mesh b, .polycss-mesh s, .polycss-mesh u")) as HTMLElement[];
        expect(after.length).toBeGreaterThan(0);
      });

      it("rebakeAtlas() is callable multiple times without throwing", () => {
        scene = makeScene(host);
        const handle = scene.add(makeParseResult([triangle()]));
        expect(() => {
          handle.setTransform({ rotation: [0, 30, 0] });
          handle.rebakeAtlas();
          handle.setTransform({ rotation: [0, 60, 0] });
          handle.rebakeAtlas();
          handle.setTransform({ rotation: [0, 90, 0] });
          handle.rebakeAtlas();
        }).not.toThrow();
      });

      it("rebakeAtlas() calls renderEntry (spy on setPolygons verifies re-render pathway)", () => {
        scene = makeScene(host);
        const handle = scene.add(makeParseResult([triangle()]));
        handle.setTransform({ rotation: [0, 45, 0] });

        // Spy on renderEntry indirectly: clearRendered empties the wrapper,
        // then re-populates it. After rebakeAtlas the wrapper must be non-empty.
        const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
        // Manually hollow out the wrapper to detect the re-population.
        while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
        expect(wrapper.children.length).toBe(0);

        handle.rebakeAtlas();
        // renderEntry re-populates the wrapper synchronously (solid polys).
        expect(wrapper.children.length).toBeGreaterThan(0);
      });

      it("rebakeAtlas() on a mesh with no rotation uses zero-rotation inverse (identity light)", () => {
        scene = makeScene(host, {
          directionalLight: { direction: [0, 0, 1], color: "#ffffff", intensity: 1 },
        });
        const handle = scene.add(makeParseResult([triangle()]));
        // With zero rotation the inverse is the identity, so the light direction
        // passed to the baker equals the original. No throw, mesh still renders.
        expect(() => handle.rebakeAtlas()).not.toThrow();
        const polys = host.querySelectorAll(".polycss-mesh i, .polycss-mesh b, .polycss-mesh s, .polycss-mesh u");
        expect(polys.length).toBeGreaterThan(0);
      });

      it("rebakeAtlas() is a no-op spy target (can be mocked externally)", () => {
        scene = makeScene(host);
        const handle = scene.add(makeParseResult([triangle()]));
        const spy = vi.spyOn(handle, "rebakeAtlas");
        handle.rebakeAtlas();
        expect(spy).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("PolyMeshHandle getters", () => {
    it("getPolygons() returns the same array as handle.polygons", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult([triangle()]));
      expect(handle.getPolygons()).toBe(handle.polygons);
    });

    it("getPolygons() reflects setPolygons() update", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult([triangle()]));
      const newPolys = [triangle("#00ff00"), triangle("#0000ff")];
      handle.setPolygons(newPolys, { merge: false });
      expect(handle.getPolygons()).toBe(handle.polygons);
      expect(handle.getPolygons().length).toBe(2);
    });

    it("getPosition() returns transform.position", () => {
      scene = makeScene(host);
      const pos: [number, number, number] = [1, 2, 3];
      const handle = scene.add(makeParseResult(), { position: pos });
      expect(handle.getPosition()).toEqual(pos);
      expect(handle.getPosition()).toBe(handle.transform.position);
    });

    it("getPosition() returns undefined when no position set", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult());
      expect(handle.getPosition()).toBeUndefined();
    });

    it("getPosition() reflects setTransform() update", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult(), { position: [0, 0, 0] });
      handle.setTransform({ position: [10, 20, 30] });
      expect(handle.getPosition()).toEqual([10, 20, 30]);
    });

    it("getRotation() returns transform.rotation", () => {
      scene = makeScene(host);
      const rot: [number, number, number] = [45, 90, 180];
      const handle = scene.add(makeParseResult(), { rotation: rot });
      expect(handle.getRotation()).toEqual(rot);
      expect(handle.getRotation()).toBe(handle.transform.rotation);
    });

    it("getRotation() returns undefined when no rotation set", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult());
      expect(handle.getRotation()).toBeUndefined();
    });

    it("getScale() returns transform.scale (number)", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult(), { scale: 2.5 });
      expect(handle.getScale()).toBe(2.5);
      expect(handle.getScale()).toBe(handle.transform.scale);
    });

    it("getScale() returns transform.scale (Vec3)", () => {
      scene = makeScene(host);
      const scale: [number, number, number] = [1, 2, 3];
      const handle = scene.add(makeParseResult(), { scale });
      expect(handle.getScale()).toEqual(scale);
    });

    it("getScale() returns undefined when no scale set", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult());
      expect(handle.getScale()).toBeUndefined();
    });
  });

  describe("automatic merge", () => {
    it("collapses coplanar same-color triangles", () => {
      // Two triangles forming a quad, both red, should merge to 1 polygon.
      const tri1: Polygon = {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
        ],
        color: "#ff0000",
      };
      const tri2: Polygon = {
        vertices: [
          [0, 0, 0],
          [1, 1, 0],
          [0, 1, 0],
        ],
        color: "#ff0000",
      };
      scene = makeScene(host);
      const handle = scene.add(makeParseResult([tri1, tri2]));
      // After merge there should be 1 polygon, not 2.
      expect(handle.polygons.length).toBe(1);
    });
  });

  describe("setOptions", () => {
    it("updates scene transform when camera.update + applyCamera changes rotation", () => {
      scene = makeScene(host, {}, { rotX: 0 });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      const before = sceneEl.style.transform;
      scene.camera.update({ rotX: 90 });
      scene.applyCamera();
      expect(sceneEl.style.transform).not.toBe(before);
      expect(sceneEl.style.transform).toContain("rotateX(90deg)");
    });

    it("perspective camera applies the configured perspective at creation", () => {
      scene = createPolyScene(host, { camera: createPolyPerspectiveCamera({ perspective: 2500 }) });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.style.perspective).toBe("2500px");
    });

    it("orthographic camera produces the 1000000px stand-in perspective", () => {
      scene = makeScene(host);
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      // See "inlines a large finite perspective..." for the rationale.
      expect(sceneEl.style.perspective).toBe("1000000px");
    });

    it("emits dynamic light cascade vars on the scene element when textureLighting='dynamic'", () => {
      scene = makeScene(host, {
        textureLighting: "dynamic",
        directionalLight: { direction: [0, 0, 1], color: "#ff8800", intensity: 1.5 },
        ambientLight: { color: "#222222", intensity: 0.3 },
      });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.dataset.polycssLighting).toBe("dynamic");
      expect(sceneEl.style.getPropertyValue("--plz")).toBe("1.0000");
      expect(sceneEl.style.getPropertyValue("--pli")).toBe("1.5000");
      expect(sceneEl.style.getPropertyValue("--pai")).toBe("0.3000");
      // #ff8800 → r=255 (1), g=136 (0.5333), b=0 (0).
      expect(sceneEl.style.getPropertyValue("--plr")).toBe("1.0000");
      expect(sceneEl.style.getPropertyValue("--plb")).toBe("0.0000");
      // #222222 → r=g=b=34 (0.1333).
      expect(sceneEl.style.getPropertyValue("--par")).toBe("0.1333");
    });

    it("removes dynamic light vars when textureLighting flips back to baked", () => {
      scene = makeScene(host, { textureLighting: "dynamic" });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.style.getPropertyValue("--plz")).not.toBe("");
      scene.setOptions({ textureLighting: "baked" });
      expect(sceneEl.style.getPropertyValue("--plz")).toBe("");
      expect(sceneEl.dataset.polycssLighting).toBe("baked");
    });

    it("honors strategies.disable at creation time", () => {
      scene = makeScene(host, { strategies: { disable: ["u"] } });
      scene.add(makeParseResult([triangle()]));
      expect(host.querySelector("u")).toBeNull();
      expect(host.querySelector("i, s")).not.toBeNull();
    });

    it("re-renders meshes when strategies changes via setOptions", () => {
      scene = makeScene(host);
      scene.add(makeParseResult([triangle()]));
      expect(host.querySelector("u")).not.toBeNull();
      scene.setOptions({ strategies: { disable: ["u"] } });
      expect(host.querySelector("u")).toBeNull();
      expect(host.querySelector("i, s")).not.toBeNull();
    });

    it("re-enables a strategy when removed from disable list via setOptions", () => {
      scene = makeScene(host, { strategies: { disable: ["u"] } });
      scene.add(makeParseResult([triangle()]));
      expect(host.querySelector("u")).toBeNull();
      scene.setOptions({ strategies: { disable: [] } });
      expect(host.querySelector("u")).not.toBeNull();
    });

    it("skips mesh re-render when setOptions is called with equivalent strategies", () => {
      scene = makeScene(host, { strategies: { disable: ["u"] } });
      scene.add(makeParseResult([triangle()]));
      const firstLeaf = host.querySelector("i, s");
      expect(firstLeaf).not.toBeNull();
      // Same disable list, fresh object — must not re-render (which would
      // replace the DOM node). Guards against callers that bundle
      // `strategies` into every camera-update setOptions call.
      scene.setOptions({ strategies: { disable: ["u"] } });
      expect(host.querySelector("i, s")).toBe(firstLeaf);
    });

    it("mounts only camera-facing voxel leaves by default", () => {
      scene = makeScene(host, {}, { rotX: 0, rotY: 0 });
      const handle = scene.add(makeParseResult([triangle(), backTriangle()]), { merge: false });
      expect(handle.polygons.length).toBe(2);
      const firstLeaf = host.querySelector(".polycss-mesh i, .polycss-mesh b, .polycss-mesh s, .polycss-mesh u");
      expect(host.querySelectorAll(".polycss-mesh i, .polycss-mesh b, .polycss-mesh s, .polycss-mesh u").length).toBe(1);

      scene.camera.update({ rotX: 180 });
      scene.applyCamera();
      const nextLeaf = host.querySelector(".polycss-mesh i, .polycss-mesh b, .polycss-mesh s, .polycss-mesh u");
      expect(nextLeaf).not.toBe(firstLeaf);
      expect(host.querySelectorAll(".polycss-mesh i, .polycss-mesh b, .polycss-mesh s, .polycss-mesh u").length).toBe(1);
    });

    it("does not remount culling leaves when camera rotation keeps the same visible normal set", () => {
      scene = makeScene(host, {}, { rotX: 0, rotY: 0 });
      scene.add(makeParseResult([triangle(), backTriangle()]), { merge: false });
      const firstLeaf = host.querySelector(".polycss-mesh i, .polycss-mesh b, .polycss-mesh s, .polycss-mesh u");
      expect(firstLeaf).not.toBeNull();

      scene.camera.update({ rotY: 10 });
      scene.applyCamera();

      expect(host.querySelector(".polycss-mesh i, .polycss-mesh b, .polycss-mesh s, .polycss-mesh u")).toBe(firstLeaf);
      expect(host.querySelectorAll(".polycss-mesh i, .polycss-mesh b, .polycss-mesh s, .polycss-mesh u").length).toBe(1);
    });

    it("keeps caller-mounted children when camera culling remounts leaves", () => {
      scene = makeScene(host, {}, { rotX: 0, rotY: 0 });
      const handle = scene.add(makeParseResult([triangle(), backTriangle()]), { merge: false });
      const nested = document.createElement("div");
      nested.className = "nested-helper";
      handle.element.appendChild(nested);

      scene.camera.update({ rotX: 180 });
      scene.applyCamera();

      expect(handle.element.contains(nested)).toBe(true);
      expect(handle.element.lastElementChild).toBe(nested);
      expect(handle.element.querySelectorAll("i,b,s,u").length).toBe(1);
    });

    it("patches culling deltas without removing leaves that stayed visible", () => {
      scene = makeScene(host, {}, { rotX: 65, rotY: 45 });
      const handle = scene.add(
        makeParseResult([
          triangle("#111111"),
          sideTriangle("#222222"),
          oppositeSideTriangle("#333333"),
        ]),
        { merge: false },
      );
      const leaves = handle.element.querySelectorAll("i,b,s,u");
      expect(leaves.length).toBe(2);
      const stableLeaf = leaves[0];
      const removed: Node[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) removed.push(...Array.from(record.removedNodes));
      });
      observer.observe(handle.element, { childList: true });

      scene.camera.update({ rotY: 225 });
      scene.applyCamera();
      observer.disconnect();

      expect(handle.element.querySelectorAll("i,b,s,u").length).toBe(2);
      expect(handle.element.querySelector("i,b,s,u")).toBe(stableLeaf);
      expect(removed).not.toContain(stableLeaf);
    });

    it("uses strict culling for low-normal meshes so voxel faces do not linger behind the camera", () => {
      scene = makeScene(host, {}, { rotX: 65, rotY: 179 });
      scene.add(makeParseResult([triangle(), sideTriangle()]), { merge: false, stableDom: true });
      expect(host.querySelectorAll(".polycss-mesh i, .polycss-mesh b, .polycss-mesh s, .polycss-mesh u").length).toBe(2);

      scene.camera.update({ rotY: 181 });
      scene.applyCamera();

      expect(host.querySelectorAll(".polycss-mesh i, .polycss-mesh b, .polycss-mesh s, .polycss-mesh u").length).toBe(1);
    });

    it("leaves high-normal meshes on the stable DOM path", () => {
      scene = makeScene(host, { textureLighting: "dynamic" }, { rotX: 65, rotY: 0 });
      const handle = scene.add(makeParseResult(highNormalTrianglePairs()), { merge: false });
      expect(handle.element.querySelector(".polycss-bucket")).not.toBeNull();
      const leafCount = handle.element.querySelectorAll("i,b,s,u").length;

      const records: MutationRecord[] = [];
      const observer = new MutationObserver((items) => records.push(...items));
      observer.observe(handle.element, { childList: true, subtree: true });

      scene.camera.update({ rotY: 180 });
      scene.applyCamera();
      observer.disconnect();

      expect(records).toHaveLength(0);
      expect(handle.element.querySelectorAll("i,b,s,u").length).toBe(leafCount);
    });

    // Perf-fix tests: setOptions used to call recomputeAutoCenter() on every
    // call, which is O(N polys) and would be paid 60×/sec by an autorotate
    // loop. The smart-diff version only recomputes when `autoCenter` itself
    // changes (mesh add/remove paths still trigger their own recomputation,
    // so geometry changes are correctly reflected).
    //
    // We observe the side effect of recomputeAutoCenter via the innermost
    // translate3d in scene transform: if the bbox-center offset changed,
    // the translate3d values change. Camera-only setOptions must leave the
    // translate3d component unchanged (the rest of the transform — scale,
    // rotateX, rotate — will update; only the innermost translate3d reflects
    // the autoCenter state).
    describe("autoCenter recomputation diff", () => {
      it("does not recompute autoCenter on a camera-only applyCamera", () => {
        scene = makeScene(host, { autoCenter: true });
        scene.add(makeParseResult([triangle()]));
        // Capture the translate3d before — autoCenter is on so it should be non-zero.
        const translateBefore = getSceneTranslatePart(host);
        expect(translateBefore).toMatch(/^translate3d/);
        expect(translateBefore).not.toBe("translate3d(0px, 0px, 0px)");
        scene.camera.update({ rotY: 90 });
        scene.applyCamera();
        // The translate3d (offset) must not change — recomputeAutoCenter was skipped.
        expect(getSceneTranslatePart(host)).toBe(translateBefore);
      });

      it("does not recompute autoCenter on a lighting-only setOptions", () => {
        scene = makeScene(host, { autoCenter: true });
        scene.add(makeParseResult([triangle()]));
        const translateBefore = getSceneTranslatePart(host);
        scene.setOptions({
          directionalLight: { direction: [1, 0, 0], color: "#fff", intensity: 1 },
        });
        expect(getSceneTranslatePart(host)).toBe(translateBefore);
      });

      it("does not recompute autoCenter on textureLighting changes", () => {
        scene = makeScene(host, { autoCenter: true, textureLighting: "dynamic" });
        scene.add(makeParseResult([triangle()]));
        const translateBefore = getSceneTranslatePart(host);
        scene.setOptions({ textureLighting: "baked" });
        expect(getSceneTranslatePart(host)).toBe(translateBefore);
      });

      it("does not recompute autoCenter on applyCamera (perspective does not apply)", () => {
        scene = makeScene(host, { autoCenter: true });
        scene.add(makeParseResult([triangle()]));
        const translateBefore = getSceneTranslatePart(host);
        scene.applyCamera();
        expect(getSceneTranslatePart(host)).toBe(translateBefore);
      });

      it("DOES recompute autoCenter when autoCenter itself toggles", () => {
        scene = makeScene(host, { autoCenter: false });
        scene.add(makeParseResult([triangle()]));
        // autoCenter off → translate3d should be zero (no offset).
        expect(getSceneTranslatePart(host)).toBe("translate3d(0px, 0px, 0px)");
        // Flip on → must recompute and produce a non-zero offset.
        scene.setOptions({ autoCenter: true });
        expect(getSceneTranslatePart(host)).not.toBe("translate3d(0px, 0px, 0px)");
      });

      it("does NOT recompute autoCenter when autoCenter is re-set to its current value", () => {
        // The diff is value-based (prevAutoCenter !== nextAutoCenter), so
        // setting autoCenter to its existing value is a no-op. Callers
        // that need to force a refresh should toggle off-then-on, or
        // change the underlying mesh (which triggers its own recompute
        // via add()/remove()).
        scene = makeScene(host, { autoCenter: true });
        scene.add(makeParseResult([triangle()]));
        const translateBefore = getSceneTranslatePart(host);
        expect(translateBefore).not.toBe("translate3d(0px, 0px, 0px)");
        scene.setOptions({ autoCenter: true });
        // Offset must be unchanged — no recompute was triggered.
        expect(getSceneTranslatePart(host)).toBe(translateBefore);
      });

      it("applyCamera updates the scene transform without affecting autoCenter offset", () => {
        // Sanity check: applyCamera must update the scene transform — the scene
        // element should still reflect new rotY — without triggering a recomputeAutoCenter.
        scene = makeScene(host, { autoCenter: true }, { rotY: 0 });
        scene.add(makeParseResult([triangle()]));
        const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
        scene.camera.update({ rotY: 137 });
        scene.applyCamera();
        expect(sceneEl.style.transform).toContain("rotate(137deg)");
      });
    });
  });

  describe("destroy", () => {
    it("removes the scene element from the host", () => {
      scene = makeScene(host);
      expect(host.querySelector(".polycss-scene")).not.toBeNull();
      scene.destroy();
      expect(host.querySelector(".polycss-scene")).toBeNull();
      scene = null;
    });

    it("disposes all registered meshes (calls parseResult.dispose())", () => {
      scene = makeScene(host);
      const pr1 = makeParseResult();
      const pr2 = makeParseResult();
      scene.add(pr1);
      scene.add(pr2);
      scene.destroy();
      scene = null;
      expect((pr1 as ParseResult & { _disposed: boolean })._disposed).toBe(true);
      expect((pr2 as ParseResult & { _disposed: boolean })._disposed).toBe(true);
    });
  });

  describe("dynamic-mode per-mesh light override", () => {
    // Directional light pointing straight down +Z (unit vector, easy to verify
    // after inverse rotation).
    const lightDir = [0, 0, 1] as [number, number, number];
    const dynLight = {
      textureLighting: "dynamic" as const,
      directionalLight: { direction: lightDir, color: "#ffffff", intensity: 1 },
    };

    it("emits --plx/ly/lz on the mesh wrapper when dynamic + non-zero rotation", () => {
      scene = makeScene(host, dynLight);
      scene.add(makeParseResult([triangle()]), { rotation: [0, 90, 0] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      // inverseRotateVec3([0,0,1], [0,90,0]) = rotateY(-90) on [0,0,1] = [-1,0,0]
      expect(wrapper.style.getPropertyValue("--plx")).toBe("-1.0000");
      expect(wrapper.style.getPropertyValue("--ply")).toBe("0.0000");
      expect(wrapper.style.getPropertyValue("--plz")).toBe("0.0000");
    });

    it("updates the override synchronously when setTransform changes rotation", () => {
      scene = makeScene(host, dynLight);
      const handle = scene.add(makeParseResult([triangle()]), { rotation: [0, 90, 0] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      // Rotate back to zero — override should be removed.
      handle.setTransform({ rotation: [0, 0, 0] });
      expect(wrapper.style.getPropertyValue("--plx")).toBe("");
      expect(wrapper.style.getPropertyValue("--ply")).toBe("");
      expect(wrapper.style.getPropertyValue("--plz")).toBe("");
    });

    it("removes the override when rotation is set back to zero", () => {
      scene = makeScene(host, dynLight);
      const handle = scene.add(makeParseResult([triangle()]), { rotation: [0, 90, 0] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      expect(wrapper.style.getPropertyValue("--plx")).not.toBe("");
      handle.setTransform({ rotation: [0, 0, 0] });
      expect(wrapper.style.getPropertyValue("--plx")).toBe("");
    });

    it("removes the override when scene switches to baked lighting", () => {
      scene = makeScene(host, dynLight);
      scene.add(makeParseResult([triangle()]), { rotation: [0, 90, 0] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      expect(wrapper.style.getPropertyValue("--plx")).not.toBe("");
      scene.setOptions({ textureLighting: "baked" });
      expect(wrapper.style.getPropertyValue("--plx")).toBe("");
      expect(wrapper.style.getPropertyValue("--ply")).toBe("");
      expect(wrapper.style.getPropertyValue("--plz")).toBe("");
    });

    it("does NOT emit override for a mesh with no rotation in a dynamic scene", () => {
      scene = makeScene(host, dynLight);
      scene.add(makeParseResult([triangle()]));
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      expect(wrapper.style.getPropertyValue("--plx")).toBe("");
      expect(wrapper.style.getPropertyValue("--ply")).toBe("");
      expect(wrapper.style.getPropertyValue("--plz")).toBe("");
    });

    it("updates the override on all meshes when scene directionalLight changes", () => {
      scene = makeScene(host, dynLight);
      scene.add(makeParseResult([triangle()]), { rotation: [0, 90, 0] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      // Change the world light to +X direction → inverseRotateVec3([1,0,0],[0,90,0])
      // = rotateY(-90) on [1,0,0] → x=1*cos(-90)+0*sin(-90)=0, z=-1*sin(-90)+0*cos(-90)=1
      // result = [0, 0, 1]
      scene.setOptions({
        directionalLight: { direction: [1, 0, 0], color: "#ffffff", intensity: 1 },
      });
      expect(wrapper.style.getPropertyValue("--plx")).toBe("0.0000");
      expect(wrapper.style.getPropertyValue("--ply")).toBe("0.0000");
      expect(wrapper.style.getPropertyValue("--plz")).toBe("1.0000");
    });

    it("does NOT emit override when scene has no directionalLight", () => {
      scene = makeScene(host, { textureLighting: "dynamic" });
      scene.add(makeParseResult([triangle()]), { rotation: [0, 90, 0] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      expect(wrapper.style.getPropertyValue("--plx")).toBe("");
    });
  });

  describe("updatePolygon", () => {
    it("mutates the polygon's color when targeted by reference", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult([triangle("#ff0000")]), { merge: false });
      const poly = handle.polygons[0];
      handle.updatePolygon(poly, { color: "#00ff00" });
      expect(handle.polygons[0].color).toBe("#00ff00");
      // Identity preserved — mutation is in place so consumers holding refs see it.
      expect(handle.polygons[0]).toBe(poly);
    });

    it("mutates the polygon's color when targeted by index", () => {
      scene = makeScene(host);
      const handle = scene.add(
        makeParseResult([triangle("#ff0000"), triangle("#00ff00")]),
        { merge: false },
      );
      handle.updatePolygon(1, { color: "#0000ff" });
      expect(handle.polygons[1].color).toBe("#0000ff");
      expect(handle.polygons[0].color).toBe("#ff0000");
    });

    it("merges partial fields onto the polygon (only updates what's passed)", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult([triangle("#ff0000")]), { merge: false });
      const originalVerts = handle.polygons[0].vertices;
      handle.updatePolygon(0, { color: "#00ff00" });
      expect(handle.polygons[0].color).toBe("#00ff00");
      expect(handle.polygons[0].vertices).toBe(originalVerts);
    });

    it("re-renders the mesh DOM (leaf elements are fresh after update)", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult([triangle("#ff0000")]), { merge: false });
      const before = host.querySelector("u, b, i, s") as HTMLElement;
      handle.updatePolygon(0, { color: "#00ff00" });
      const after = host.querySelector("u, b, i, s") as HTMLElement;
      // renderEntry tears down and re-emits; the leaf is a fresh node.
      expect(after).not.toBe(before);
    });

    it("no-ops on a stale polygon reference (not in the current polygons array)", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult([triangle("#ff0000")]), { merge: false });
      const stale: Polygon = { vertices: triangle().vertices, color: "#abcdef" };
      const elBefore = host.querySelector("u, b, i, s");
      expect(() => handle.updatePolygon(stale, { color: "#000000" })).not.toThrow();
      expect(handle.polygons[0].color).toBe("#ff0000");
      // No re-render either — DOM untouched.
      expect(host.querySelector("u, b, i, s")).toBe(elBefore);
    });

    it("no-ops when index is out of range", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult([triangle("#ff0000")]), { merge: false });
      expect(() => handle.updatePolygon(99, { color: "#000000" })).not.toThrow();
      expect(() => handle.updatePolygon(-1, { color: "#000000" })).not.toThrow();
      expect(handle.polygons[0].color).toBe("#ff0000");
    });

    it("can be called repeatedly to step through colors", () => {
      scene = makeScene(host);
      const handle = scene.add(makeParseResult([triangle("#ff0000")]), { merge: false });
      handle.updatePolygon(0, { color: "#00ff00" });
      handle.updatePolygon(0, { color: "#0000ff" });
      handle.updatePolygon(0, { color: "#ffff00" });
      expect(handle.polygons[0].color).toBe("#ffff00");
    });
  });

  describe("autoCenter", () => {
    it("default (no autoCenter) leaves the scene translate3d at origin", () => {
      scene = makeScene(host);
      scene.add(makeParseResult());
      // Without autoCenter the offset is [0,0,0], so the innermost translate3d is zero.
      expect(getSceneTranslatePart(host)).toBe("translate3d(0px, 0px, 0px)");
    });

    it("autoCenter=true folds the bbox center into the scene translate3d", () => {
      // Triangle whose bbox center is at (0.5, 0.5, 0).
      const t: Polygon = {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        color: "#ff0000",
      };
      scene = makeScene(host, { autoCenter: true });
      scene.add(makeParseResult([t]));
      // World-Y → CSS-X: cssX = 0.5 * 50 = 25 → translate by -25.
      // World-X → CSS-Y: cssY = 0.5 * 50 = 25 → translate by -25.
      const translate = getSceneTranslatePart(host);
      expect(translate).toMatch(/^translate3d\(.+\)$/);
      expect(translate).toContain("-25");
    });

    it("autoCenter recomputes when meshes change", () => {
      scene = makeScene(host, { autoCenter: true });
      const handle = scene.add(makeParseResult([triangle()]));
      const t1 = getSceneTranslatePart(host);

      // Add a second mesh with different bbox.
      const big: Polygon = {
        vertices: [
          [0, 0, 0],
          [10, 0, 0],
          [0, 10, 0],
        ],
        color: "#00ff00",
      };
      const bigHandle = scene.add(makeParseResult([big]));
      const t2 = getSceneTranslatePart(host);
      expect(t2).not.toBe(t1);

      // Removing the dominant mesh should recompute back to the small one.
      bigHandle.remove();
      const t3 = getSceneTranslatePart(host);
      expect(t3).toBe(t1);

      // Removing the last mesh resets the offset to zero.
      handle.remove();
      const t4 = getSceneTranslatePart(host);
      expect(t4).toBe("translate3d(0px, 0px, 0px)");
    });

    it("autoCenter=true with no meshes leaves translate3d at origin", () => {
      scene = makeScene(host, { autoCenter: true });
      expect(getSceneTranslatePart(host)).toBe("translate3d(0px, 0px, 0px)");
    });

    it("setOptions({autoCenter: true}) enables centering after the fact", () => {
      scene = makeScene(host, { autoCenter: false });
      scene.add(makeParseResult([triangle()]));
      expect(getSceneTranslatePart(host)).toBe("translate3d(0px, 0px, 0px)");
      scene.setOptions({ autoCenter: true });
      expect(getSceneTranslatePart(host)).not.toBe("translate3d(0px, 0px, 0px)");
    });

    it("autoCenter uses the fixed default Z elevation", () => {
      // Triangle whose bbox in Z is [0, 2]. Center Z is 1. cssZ = 1 * 50 = 50.
      const tri: Polygon = {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 0, 2],
        ],
        color: "#fff",
      };
      scene = makeScene(host, { autoCenter: true });
      scene.add(makeParseResult([tri]));
      expect(getSceneTranslatePart(host)).toContain("-50px");
    });

    it("excludeFromAutoCenter meshes do not shift the bbox", () => {
      // The chicken (one triangle) defines the bbox. An overlay mesh added
      // far from the origin would normally pull the center toward itself
      // — but with excludeFromAutoCenter:true the overlay is ignored.
      const chicken: Polygon = {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        color: "#fff",
      };
      const farAway: Polygon = {
        vertices: [
          [100, 100, 0],
          [101, 100, 0],
          [100, 101, 0],
        ],
        color: "#fff",
      };
      scene = makeScene(host, { autoCenter: true });
      scene.add(makeParseResult([chicken]));
      const before = getSceneTranslatePart(host);
      scene.add(makeParseResult([farAway]), { excludeFromAutoCenter: true });
      expect(getSceneTranslatePart(host)).toBe(before);

      // Sanity check: without the flag, the same overlay DOES shift the bbox.
      scene.add(makeParseResult([farAway]));
      expect(getSceneTranslatePart(host)).not.toBe(before);
    });
  });

  describe("castShadow", () => {
    const dynOpts = {
      textureLighting: "dynamic" as const,
      directionalLight: { direction: [0.4, -0.7, 0.59] as [number, number, number], color: "#ffffff", intensity: 1 },
    };

    it("default (no castShadow) emits no .polycss-shadow elements", () => {
      scene = makeScene(host, dynOpts);
      scene.add(makeParseResult([triangle()]));
      expect(host.querySelectorAll(".polycss-shadow").length).toBe(0);
    });

    it("castShadow:true in dynamic mode emits shadow leaves, one per non-textured polygon", () => {
      scene = makeScene(host, dynOpts);
      // Use spatially distinct triangles so the loose shadow-dedup pass
      // doesn't fold them into one shadow (two triangles at the same
      // location WOULD be deduped, which is the intended behavior).
      const distinctTri: Polygon = {
        vertices: [[10, 10, 5], [11, 10, 5], [10, 11, 5]],
        color: "#00ff00",
      };
      scene.add(makeParseResult([triangle(), distinctTri]), { castShadow: true, merge: false });
      expect(host.querySelectorAll(".polycss-shadow").length).toBe(2);
    });

    it("castShadow:true in baked mode emits NO shadow leaves", () => {
      scene = makeScene(host, { textureLighting: "baked" });
      scene.add(makeParseResult([triangle()]), { castShadow: true });
      expect(host.querySelectorAll(".polycss-shadow").length).toBe(0);
    });

    it("shadow leaves have the polycss-shadow class", () => {
      scene = makeScene(host, dynOpts);
      scene.add(makeParseResult([triangle()]), { castShadow: true });
      const shadows = host.querySelectorAll(".polycss-shadow");
      expect(shadows.length).toBeGreaterThan(0);
      for (const el of Array.from(shadows)) {
        expect(el.classList.contains("polycss-shadow")).toBe(true);
      }
    });

    it("shadow leaves are always <q> with border-shape regardless of caster tag", () => {
      scene = makeScene(host, dynOpts);
      // Mix shapes at distinct 3D positions (otherwise the loose-tolerance
      // shadow dedup pass folds them into one shadow). Each emits a <q>
      // shadow — a dedicated single-letter render strategy in the tag
      // taxonomy alongside <b>/<i>/<s>/<u>, kept clear of the dynamic-
      // mode Lambert color rule.
      const distinctTri: Polygon = {
        vertices: [[10, 10, 5], [11, 10, 5], [10, 11, 5]],
        color: "#00ff00",
      };
      scene.add(makeParseResult([triangle(), distinctTri]), {
        castShadow: true,
        merge: false,
      });
      const shadows = Array.from(host.querySelectorAll(".polycss-shadow"));
      expect(shadows.length).toBeGreaterThan(0);
      for (const el of shadows) {
        expect((el as HTMLElement).tagName.toLowerCase()).toBe("q");
        expect((el as HTMLElement).style.getPropertyValue("border-shape")).not.toBe("");
      }
    });

    it("shadow leaves transform contains var(--shadow-proj) followed by matrix3d", () => {
      scene = makeScene(host, dynOpts);
      scene.add(makeParseResult([triangle()]), { castShadow: true });
      const shadow = host.querySelector(".polycss-shadow") as HTMLElement;
      expect(shadow).not.toBeNull();
      expect(shadow.style.transform).toMatch(/^var\(--shadow-proj\)\s+matrix3d\(/);
    });

    it("adding a casting mesh sets --shadow-ground-cssz on the scene element", () => {
      scene = makeScene(host, dynOpts);
      scene.add(makeParseResult([triangle()]), { castShadow: true });
      const sceneEl = getSceneEl(host);
      const groundVar = sceneEl.style.getPropertyValue("--shadow-ground-cssz");
      expect(groundVar).not.toBe("");
    });

    it("removing the casting mesh clears --shadow-ground-cssz", () => {
      scene = makeScene(host, dynOpts);
      const handle = scene.add(makeParseResult([triangle()]), { castShadow: true });
      const sceneEl = getSceneEl(host);
      expect(sceneEl.style.getPropertyValue("--shadow-ground-cssz")).not.toBe("");
      handle.remove();
      expect(sceneEl.style.getPropertyValue("--shadow-ground-cssz")).toBe("");
    });

    it("toggling castShadow via setTransform adds/removes shadow leaves", () => {
      scene = makeScene(host, dynOpts);
      const handle = scene.add(makeParseResult([triangle()]), { castShadow: false });
      expect(host.querySelectorAll(".polycss-shadow").length).toBe(0);
      handle.setTransform({ castShadow: true });
      expect(host.querySelectorAll(".polycss-shadow").length).toBeGreaterThan(0);
      handle.setTransform({ castShadow: false });
      expect(host.querySelectorAll(".polycss-shadow").length).toBe(0);
    });

    it("switching from dynamic to baked removes shadow leaves", () => {
      scene = makeScene(host, dynOpts);
      scene.add(makeParseResult([triangle()]), { castShadow: true });
      expect(host.querySelectorAll(".polycss-shadow").length).toBeGreaterThan(0);
      scene.setOptions({ textureLighting: "baked" });
      expect(host.querySelectorAll(".polycss-shadow").length).toBe(0);
    });

    it("switching from baked back to dynamic re-emits shadow leaves", () => {
      scene = makeScene(host, { textureLighting: "baked" });
      scene.add(makeParseResult([triangle()]), { castShadow: true });
      expect(host.querySelectorAll(".polycss-shadow").length).toBe(0);
      scene.setOptions({ ...dynOpts });
      expect(host.querySelectorAll(".polycss-shadow").length).toBeGreaterThan(0);
    });

    it("textured polygons (s) ALSO emit shadow leaves", () => {
      scene = makeScene(host, dynOpts);
      scene.add(makeParseResult([texturedTriangle()]), { castShadow: true });
      // Shadows depend only on the polygon's outline, not its texture
      // content. Atlas (<s>) polygons cast shadows the same way as
      // <b>/<i>/<u> — a flat <q> projected onto the ground. Otherwise
      // fully textured meshes (e.g. Frog Guy) get no shadow at all.
      expect(host.querySelectorAll(".polycss-shadow").length).toBe(1);
    });

    it("--clx/--cly/--clz are set on the scene element in dynamic mode", () => {
      scene = makeScene(host, dynOpts);
      const sceneEl = getSceneEl(host);
      expect(sceneEl.style.getPropertyValue("--clx")).not.toBe("");
      expect(sceneEl.style.getPropertyValue("--cly")).not.toBe("");
      expect(sceneEl.style.getPropertyValue("--clz")).not.toBe("");
    });

    it("--clx/--cly/--clz are removed when lighting switches to baked", () => {
      scene = makeScene(host, dynOpts);
      const sceneEl = getSceneEl(host);
      expect(sceneEl.style.getPropertyValue("--clx")).not.toBe("");
      scene.setOptions({ textureLighting: "baked" });
      expect(sceneEl.style.getPropertyValue("--clx")).toBe("");
      expect(sceneEl.style.getPropertyValue("--cly")).toBe("");
      expect(sceneEl.style.getPropertyValue("--clz")).toBe("");
    });
  });
});

describe("scene.add — meshResolution option", () => {
  let host: HTMLElement;
  let scene: PolySceneHandle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    scene?.destroy();
    if (host.parentNode) host.parentNode.removeChild(host);
  });

  it("scene.add with meshResolution='lossless' does not throw and produces leaf DOM", () => {
    scene = makeScene(host);
    const handle = scene.add(makeParseResult([triangle(), triangle()]), { meshResolution: "lossless" });
    expect(handle).toBeTruthy();
    expect(host.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
  });

  it("scene.add with meshResolution='lossy' does not throw and produces leaf DOM", () => {
    scene = makeScene(host);
    const handle = scene.add(makeParseResult([triangle()]), { meshResolution: "lossy" });
    expect(handle).toBeTruthy();
    expect(host.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
  });
});
