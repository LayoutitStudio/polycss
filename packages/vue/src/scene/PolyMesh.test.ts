import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, h, nextTick } from "vue";
import type { VNode } from "vue";
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

const TEXTURED_TRIANGLE: Polygon = {
  vertices: TRIANGLE.vertices,
  texture: "https://example.com/tex.png",
  uvs: [[0, 0], [1, 0], [0, 1]],
};

const OFFSET_TEXTURED_TRIANGLE: Polygon = {
  vertices: [
    [10, 0, 0],
    [12, 0, 0],
    [10, 2, 0],
  ],
  texture: "tex.png",
  uvs: [[0, 0], [1, 0], [0, 1]],
  textureTriangles: [
    {
      vertices: [
        [10, 0, 0],
        [12, 0, 0],
        [10, 2, 0],
      ],
      uvs: [[0, 0], [1, 0], [0, 1]],
    },
  ],
};

const QUAD: Polygon = {
  vertices: [
    [0, 0, 1],
    [2, 0, 1],
    [2, 2, 1],
    [0, 2, 1],
  ],
  color: "#00ff00",
};

interface VoxelInput {
  x: number;
  y: number;
  z: number;
  colorIndex: number;
}

function buildVoxBuffer(size: [number, number, number], voxels: VoxelInput[]): ArrayBuffer {
  const sizeChunkBytes = 12 + 12;
  const xyziChunkBytes = 12 + 4 + voxels.length * 4;
  const childrenSize = sizeChunkBytes + xyziChunkBytes;
  const buf = new ArrayBuffer(8 + 12 + childrenSize);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let off = 0;
  const writeId = (id: string) => {
    for (let i = 0; i < 4; i += 1) u8[off++] = id.charCodeAt(i);
  };
  const writeU32 = (value: number) => {
    dv.setUint32(off, value, true);
    off += 4;
  };
  const writeU8 = (value: number) => {
    u8[off++] = value;
  };

  writeId("VOX ");
  writeU32(150);
  writeId("MAIN");
  writeU32(0);
  writeU32(childrenSize);
  writeId("SIZE");
  writeU32(12);
  writeU32(0);
  writeU32(size[0]);
  writeU32(size[1]);
  writeU32(size[2]);
  writeId("XYZI");
  writeU32(4 + voxels.length * 4);
  writeU32(0);
  writeU32(voxels.length);
  for (const voxel of voxels) {
    writeU8(voxel.x);
    writeU8(voxel.y);
    writeU8(voxel.z);
    writeU8(voxel.colorIndex);
  }
  return buf;
}

function mockFetchVox(): void {
  const buffer = buildVoxBuffer([1, 1, 1], [{ x: 0, y: 0, z: 0, colorIndex: 1 }]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(""),
    arrayBuffer: () => Promise.resolve(buffer),
  }));
}

function renderMesh(
  meshProps: Record<string, unknown> = {},
  slots: Record<string, () => VNode | VNode[]> = {},
  sceneProps: Record<string, unknown> = {},
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(PolyCamera, {}, {
          default: () =>
            h(PolyScene, sceneProps, {
              default: () => h(PolyMesh, meshProps, slots),
            }),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("PolyMesh (Vue) — with polygons prop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders a .polycss-mesh wrapper", () => {
    const { container } = renderMesh({ polygons: [TRIANGLE] });
    const mesh = container.querySelector(".polycss-mesh");
    expect(mesh).toBeTruthy();
  });

  it("renders polygon leaf elements for each polygon", () => {
    const { container } = renderMesh({ polygons: [TRIANGLE, QUAD] });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(2);
  });

  it("inherits scene strategies.disable b for auto-rendered rects", () => {
    vi.stubGlobal("CSS", {
      supports: vi.fn((property: string) => property === "border-shape"),
    });
    const { container } = renderMesh(
      { polygons: [QUAD] },
      {},
      { strategies: { disable: ["b"] } },
    );
    const poly = container.querySelector("i") as HTMLElement | null;
    expect(container.querySelector("b")).toBeNull();
    expect(poly).toBeTruthy();
    expect(poly!.style.getPropertyValue("border-shape")).toContain("polygon(");
  });

  it("hoists repeated baked solid paint to the mesh wrapper", () => {
    const { container } = renderMesh({ polygons: [TRIANGLE, TRIANGLE] });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    const polys = Array.from(container.querySelectorAll("u")) as HTMLElement[];
    expect(mesh.style.getPropertyValue("--polycss-paint")).not.toBe("");
    expect(polys).toHaveLength(2);
    expect(polys[0].getAttribute("style")?.trim().startsWith("transform:")).toBe(true);
    expect(polys.every((poly) => poly.style.color === "")).toBe(true);
    expect(polys.every((poly) => poly.style.borderBottomColor === "")).toBe(true);
  });

  it("hoists repeated dynamic solid base RGB channels to the mesh wrapper", () => {
    const { container } = renderMesh({ polygons: [TRIANGLE, TRIANGLE], textureLighting: "dynamic" });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    const polys = Array.from(container.querySelectorAll("u")) as HTMLElement[];
    expect(mesh.style.getPropertyValue("--psr")).toBe("1.0000");
    expect(mesh.style.getPropertyValue("--psg")).toBe("0.0000");
    expect(mesh.style.getPropertyValue("--psb")).toBe("0.0000");
    expect(polys).toHaveLength(2);
    expect(polys.every((poly) => poly.style.getPropertyValue("--psr") === "")).toBe(true);
  });

  it("renders textured polygons as polygon s elements", () => {
    const { container } = renderMesh({ polygons: [TEXTURED_TRIANGLE] });
    const poly = container.querySelector("s");
    expect(poly).toBeTruthy();
    expect(poly?.tagName.toLowerCase()).toBe("s");
  });

  it("renders no poly elements for empty polygons", () => {
    const { container } = renderMesh({ polygons: [] });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(0);
  });

  it("mesh wrapper leaves position to base CSS", () => {
    const { container } = renderMesh({ polygons: [TRIANGLE] });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.position).toBe("");
  });

  it("mesh wrapper leaves transformStyle to base CSS", () => {
    const { container } = renderMesh({ polygons: [TRIANGLE] });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transformStyle).toBe("");
  });

  it("applies custom class to mesh wrapper", () => {
    const { container } = renderMesh({ polygons: [TRIANGLE], class: "my-mesh" });
    const mesh = container.querySelector(".polycss-mesh");
    expect(mesh?.classList.contains("my-mesh")).toBe(true);
  });
});

describe("PolyMesh (Vue) — transform props", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("applies translate3d from position prop (post-parity: world units × BASE_TILE with axis swap)", () => {
    const { container } = renderMesh({
      polygons: [TRIANGLE],
      position: [10, 20, 30],
    });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    // world (10, 20, 30) → CSS (worldY*50, worldX*50, worldZ*50) = (1000, 500, 1500)
    expect(mesh.style.transform).toContain("translate3d(1000px, 500px, 1500px)");
  });

  it("applies scale3d from scalar scale", () => {
    const { container } = renderMesh({
      polygons: [TRIANGLE],
      scale: 2,
    });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transform).toContain("scale3d(2, 2, 2)");
  });

  it("does not add scale3d for scale=1", () => {
    const { container } = renderMesh({
      polygons: [TRIANGLE],
      scale: 1,
    });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transform ?? "").not.toContain("scale3d");
  });

  it("applies Vec3 scale", () => {
    const { container } = renderMesh({
      polygons: [TRIANGLE],
      scale: [1, 2, 3],
    });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transform).toContain("scale3d(1, 2, 3)");
  });

  it("applies rotateX from rotation[0]", () => {
    const { container } = renderMesh({
      polygons: [TRIANGLE],
      rotation: [45, 0, 0],
    });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transform).toContain("rotateX(45deg)");
  });
});

describe("PolyMesh (Vue) — autoCenter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("autoCenter=true still renders polygons (vertices recentered)", () => {
    const { container } = renderMesh({ polygons: [QUAD], autoCenter: true });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(1);
  });

  it("autoCenter=false renders polygons unmodified", () => {
    const { container } = renderMesh({ polygons: [QUAD], autoCenter: false });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(1);
  });

  it("autoCenter=true also recenters texture triangle source vertices", () => {
    const received: Polygon[] = [];
    renderMesh(
      { polygons: [OFFSET_TEXTURED_TRIANGLE], autoCenter: true },
      {
        polygon: ({ polygon }: { polygon: Polygon }) => {
          received.push(polygon);
          return h("div");
        },
      },
    );

    const polygon = received.find((p) => p.textureTriangles?.length);
    expect(polygon?.vertices[0]).toEqual([-1, -1, 0]);
    expect(polygon?.textureTriangles?.[0].vertices[0]).toEqual([-1, -1, 0]);
  });
});

describe("PolyMesh (Vue) — scoped slot 'polygon'", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("calls the polygon scoped slot for each polygon", () => {
    const calls: Array<{ polygon: Polygon; index: number }> = [];
    renderMesh(
      { polygons: [TRIANGLE, QUAD] },
      {
        polygon: ({ polygon, index }: { polygon: Polygon; index: number }) => {
          calls.push({ polygon, index });
          return h("div", { class: "slot-polygon", "data-index": index });
        },
      }
    );
    // Vue may call the slot function multiple times (render calls); use unique indices
    const uniqueIndices = [...new Set(calls.map((c) => c.index))];
    expect(uniqueIndices).toContain(0);
    expect(uniqueIndices).toContain(1);
  });

  it("slot polygon receives the polygon object with vertices and color", () => {
    const received: Polygon[] = [];
    renderMesh(
      { polygons: [TRIANGLE] },
      {
        polygon: ({ polygon }: { polygon: Polygon }) => {
          received.push(polygon);
          return h("div");
        },
      }
    );
    expect(received.length).toBeGreaterThan(0);
    expect(received[0].color).toBe("#ff0000");
    expect(received[0].vertices.length).toBe(3);
  });

  it("slot polygon has index 0 for first polygon", () => {
    const indices: number[] = [];
    renderMesh(
      { polygons: [TRIANGLE] },
      {
        polygon: ({ index }: { index: number }) => {
          indices.push(index);
          return h("div");
        },
      }
    );
    expect(indices).toContain(0);
  });
});

describe("PolyMesh (Vue) — loading and error states", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders loading state (polycss-mesh-loading) when src fetch is pending", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // never resolves
    const { container } = renderMesh(
      { src: "https://example.com/mesh.obj" },
      {
        fallback: () => h("div", { class: "loading-slot" }, "loading…"),
      }
    );

    const meshLoading = container.querySelector(".polycss-mesh-loading");
    expect(meshLoading).toBeTruthy();
    const slot = container.querySelector(".loading-slot");
    expect(slot).toBeTruthy();
  });

  it("renders error state when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve(""),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));

    const { container } = renderMesh(
      { src: "https://example.com/missing.obj" },
      {
        error: ({ error }: { error: Error }) =>
          h("div", { class: "error-slot" }, error.message),
      }
    );

    await nextTick();
    await new Promise((r) => setTimeout(r, 100));
    await nextTick();

    const meshError = container.querySelector(".polycss-mesh-error");
    expect(meshError).toBeTruthy();
    const errorSlot = container.querySelector(".error-slot");
    expect(errorSlot).toBeTruthy();
  });

  it("renders loading state without a fallback slot (graceful)", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = renderMesh({ src: "https://example.com/mesh.obj" });
    const meshLoading = container.querySelector(".polycss-mesh-loading");
    expect(meshLoading).toBeTruthy();
  });

  it("renders error state without error slot (graceful)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve(""),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));

    const { container } = renderMesh({ src: "https://example.com/mesh.obj" });

    await nextTick();
    await new Promise((r) => setTimeout(r, 100));
    await nextTick();

    const meshError = container.querySelector(".polycss-mesh-error");
    expect(meshError).toBeTruthy();
  });
});

describe("PolyMesh (Vue) — direct voxel fast path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("routes eligible .vox src meshes through face-wrapper direct brushes", async () => {
    mockFetchVox();
    const { container } = renderMesh({ src: "https://example.com/model.vox" });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await nextTick();

    const mesh = container.querySelector(".polycss-mesh") as HTMLElement | null;
    const faceHosts = container.querySelectorAll(".polycss-mesh > .polycss-voxel-face");
    const brushes = container.querySelectorAll(".polycss-mesh > .polycss-voxel-face > b");
    expect(mesh?.classList.contains("polycss-voxel-mesh")).toBe(true);
    expect(faceHosts.length).toBeGreaterThan(0);
    expect(brushes.length).toBeGreaterThan(0);
    expect(container.querySelector(".polycss-mesh > b")).toBeNull();
  });

  it("falls back to polygon rendering for .vox src meshes in dynamic lighting", async () => {
    mockFetchVox();
    const { container } = renderMesh({
      src: "https://example.com/model.vox",
      textureLighting: "dynamic",
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await nextTick();

    expect(container.querySelector(".polycss-mesh > .polycss-voxel-face")).toBeNull();
    expect(container.querySelector(".polycss-mesh > b,.polycss-mesh > i,.polycss-mesh > s,.polycss-mesh > u")).not.toBeNull();
  });
});

describe("PolyMesh (Vue) — meshResolution prop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("accepts meshResolution='lossless' and mounts leaf DOM without throwing", () => {
    const { container } = renderMesh({ polygons: [TRIANGLE], meshResolution: "lossless" });
    const leaves = container.querySelectorAll("i,b,s,u");
    expect(leaves.length).toBeGreaterThan(0);
  });

  it("accepts meshResolution='lossy' and mounts leaf DOM without throwing", () => {
    const { container } = renderMesh({ polygons: [TRIANGLE, QUAD], meshResolution: "lossy" });
    const leaves = container.querySelectorAll("i,b,s,u");
    expect(leaves.length).toBeGreaterThan(0);
  });
});
