import { beforeEach, describe, expect, it } from "vitest";
import {
  createPolyMorphPreparedDomTarget,
  PolyMorphRenderError,
} from "./index.js";

function createGraph() {
  const host = document.createElement("main");
  const model = document.createElement("div");
  const shape = document.createElement("div");
  const leaf = document.createElement("u");
  document.body.appendChild(host);
  host.appendChild(model);
  model.appendChild(shape);
  shape.appendChild(leaf);
  return { host, model, shape, leaf };
}

function createTarget(writeModelTransform?: (transform: string) => boolean) {
  const graph = createGraph();
  let modelTransform: string | undefined;
  let modelWrites = 0;
  const target = createPolyMorphPreparedDomTarget({
    model: {
      element: graph.model,
      writeTransform(transform) {
        if (writeModelTransform) return writeModelTransform(transform);
        if (modelTransform === transform) return false;
        modelTransform = transform;
        graph.model.style.transform = transform;
        modelWrites += 1;
        return true;
      },
    },
    shapes: [{ element: graph.shape }],
    leaves: [{ element: graph.leaf }],
  });
  return { ...graph, target, get modelWrites() { return modelWrites; } };
}

describe("createPolyMorphPreparedDomTarget", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("writes through stable indexed targets and deduplicates requested values", () => {
    const graph = createTarget();
    const { target } = graph;

    expect(Object.isFrozen(target.shapes)).toBe(true);
    expect(Object.isFrozen(target.leaves)).toBe(true);
    expect(target.shapes[0]!.element).toBe(graph.shape);
    expect(target.leaves[0]!.element).toBe(graph.leaf);
    expect(target.model.writeTransform("")).toBe(true);
    expect(target.model.writeTransform("")).toBe(false);
    expect(graph.modelWrites).toBe(1);

    expect(target.shapes[0]!.writeTransform("")).toBe(true);
    expect(target.shapes[0]!.writeTransform("")).toBe(false);
    graph.shape.style.transform = "scale(2)";
    expect(target.shapes[0]!.writeTransform("")).toBe(false);
    expect(graph.shape.style.transform).toBe("scale(2)");

    const transform = "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,2,3,4,1)";
    expect(target.leaves[0]!.writeTransform(transform)).toBe(true);
    expect(target.leaves[0]!.writeTransform(transform)).toBe(false);
    expect(target.leaves[0]!.writeVisibility(false)).toBe(true);
    expect(target.leaves[0]!.writeVisibility(false)).toBe(false);
    expect(target.leaves[0]!.writeOpacity(0.5)).toBe(true);
    expect(target.leaves[0]!.writeOpacity(0.5)).toBe(false);
    expect(target.leaves[0]!.writeImagePositionY("-4px")).toBe(true);
    expect(target.leaves[0]!.writeImagePositionY("-4px")).toBe(false);
    expect(() => target.assertStableDomIdentity()).not.toThrow();
    expect(graph.host.querySelectorAll("*")).toHaveLength(3);
  });

  it("rejects invalid target inputs and writer values", () => {
    expect(() => createPolyMorphPreparedDomTarget(null as never))
      .toThrowError(PolyMorphRenderError);
    expect(() => createPolyMorphPreparedDomTarget({
      model: {
        element: document.createElement("div"),
        writeTransform: () => true,
      },
      shapes: null as never,
      leaves: [],
    })).toThrowError(PolyMorphRenderError);
    expect(() => createPolyMorphPreparedDomTarget({
      model: {
        element: document.createElement("div"),
        writeTransform: () => true,
      },
      shapes: [{ element: {} as HTMLElement }],
      leaves: [],
    })).toThrowError(PolyMorphRenderError);
    expect(() => createPolyMorphPreparedDomTarget({
      model: {
        element: document.createElement("div"),
        writeTransform: null as never,
      },
      shapes: [],
      leaves: [],
    })).toThrowError(PolyMorphRenderError);

    const graph = createTarget(() => "changed" as unknown as boolean);
    expect(() => graph.target.model.writeTransform(""))
      .toThrowError(PolyMorphRenderError);
    expect(() => graph.target.leaves[0]!.writeTransform(null as never))
      .toThrowError(PolyMorphRenderError);
    expect(() => graph.target.leaves[0]!.writeVisibility("yes" as never))
      .toThrowError(PolyMorphRenderError);
    expect(() => graph.target.leaves[0]!.writeOpacity(Number.NaN))
      .toThrowError(PolyMorphRenderError);
    expect(() => graph.target.leaves[0]!.writeOpacity(-0.1))
      .toThrowError(PolyMorphRenderError);
    expect(() => graph.target.leaves[0]!.writeOpacity(1.1))
      .toThrowError(PolyMorphRenderError);
    expect(() => graph.target.leaves[0]!.writeImagePositionY(""))
      .toThrowError(PolyMorphRenderError);
    expect(() => graph.target.leaves[0]!.writeImagePositionY(null as never))
      .toThrowError(PolyMorphRenderError);
  });

  it.each(["model", "shape", "leaf"] as const)(
    "detects %s parent identity drift",
    (kind) => {
      const graph = createTarget();
      const element = graph[kind];
      document.body.appendChild(element);
      expect(() => graph.target.assertStableDomIdentity())
        .toThrowError(PolyMorphRenderError);
    },
  );

  it("invalidates writers without removing caller-owned DOM", () => {
    const graph = createTarget();
    graph.target.destroy();
    graph.target.destroy();

    expect(graph.target.destroyed).toBe(true);
    expect(graph.host.querySelectorAll("*")).toHaveLength(3);
    expect(() => graph.target.assertStableDomIdentity())
      .toThrowError(PolyMorphRenderError);
    expect(() => graph.target.model.writeTransform(""))
      .toThrowError(PolyMorphRenderError);
    expect(() => graph.target.shapes[0]!.writeVisibility(true))
      .toThrowError(PolyMorphRenderError);
  });
});
