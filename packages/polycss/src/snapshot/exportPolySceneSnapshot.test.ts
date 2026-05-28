import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exportPolySceneSnapshot,
  PolySceneSnapshotError,
} from "./exportPolySceneSnapshot";

function makeRenderedScene(style: string): { host: HTMLDivElement; leaf: HTMLElement } {
  const host = document.createElement("div");
  const camera = document.createElement("div");
  const scene = document.createElement("div");
  const leaf = document.createElement("s");
  const script = document.createElement("script");

  camera.className = "polycss-camera";
  camera.setAttribute("onclick", "evil()");
  scene.className = "polycss-scene";
  leaf.setAttribute("style", style);
  leaf.setAttribute("onpointerdown", "evil()");
  script.type = "application/json";
  script.textContent = '{"evil":true}';

  scene.append(leaf, script);
  camera.append(scene);
  host.append(camera);
  document.body.append(host);

  return { host, leaf };
}

function makeSolidScene(): { host: HTMLDivElement; leaf: HTMLElement } {
  const host = document.createElement("div");
  const camera = document.createElement("div");
  const scene = document.createElement("div");
  const mesh = document.createElement("div");
  const leaf = document.createElement("b");

  camera.className = "polycss-camera";
  scene.className = "polycss-scene";
  mesh.className = "polycss-mesh";
  mesh.style.setProperty("--origin", "10px 20px 30px");
  mesh.style.setProperty("--polycss-paint", "#ff0000");
  leaf.setAttribute("style", "transform:matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)");

  mesh.append(leaf);
  scene.append(mesh);
  camera.append(scene);
  host.append(camera);
  document.body.append(host);

  return { host, leaf };
}

function makeDynamicScene(): { host: HTMLDivElement; leaf: HTMLElement } {
  const host = document.createElement("div");
  const camera = document.createElement("div");
  const scene = document.createElement("div");
  const leaf = document.createElement("b");

  camera.className = "polycss-camera";
  scene.className = "polycss-scene";
  scene.dataset.polycssLighting = "dynamic";
  scene.style.setProperty("--plx", "0.1");
  scene.style.setProperty("--ply", "0.2");
  scene.style.setProperty("--plz", "0.3");
  scene.style.setProperty("--clx", "0.1");
  scene.style.setProperty("--cly", "0.2");
  scene.style.setProperty("--clz", "0.3");
  leaf.setAttribute(
    "style",
    "transform:matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1);--pnx:0;--pny:0;--pnz:1;--psr:1;--psg:0;--psb:0",
  );

  scene.append(leaf);
  camera.append(scene);
  host.append(camera);
  document.body.append(host);

  return { host, leaf };
}

function countOccurrences(value: string, pattern: string): number {
  return value.split(pattern).length - 1;
}

describe("exportPolySceneSnapshot", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.title = "";
    vi.unstubAllGlobals();
  });

  it("serializes the current rendered camera subtree and inlines CSS image URLs", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Blob(["atlas"], { type: "image/png" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    document.title = "PolyCSS <snapshot>";
    const { leaf } = makeRenderedScene(
      'background: url("blob:atlas") 0 0 / 64px 64px no-repeat; --polycss-atlas-url: url(blob:atlas); --polycss-atlas-size: 128px;',
    );

    const html = await exportPolySceneSnapshot(leaf);

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>PolyCSS &lt;snapshot&gt;</title>");
    expect(html).toContain('class="polycss-camera"');
    expect(html).toContain('class="polycss-scene"');
    expect(html).toContain("data:image/png;base64,YXRsYXM=");
    expect(html).toContain("data-polycss-snapshot-bg");
    expect(html).toContain(".polycss-scene");
    expect(html).toContain(".polycss-scene s");
    expect(html).toContain("width: 128px");
    expect(html).toContain("height: 128px");
    expect(html).not.toContain("blob:atlas");
    expect(html).not.toContain("--polycss-atlas-size");
    expect(html).not.toContain("--polycss-atlas-url");
    expect(html).not.toContain("@property");
    expect(html).not.toContain("--shadow-proj");
    expect(html).not.toContain(".polycss-scene q");
    expect(html).not.toContain("polycss-transform-ring");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("onpointerdown");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stores repeated atlas image data once in snapshot CSS", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Blob(["atlas"], { type: "image/png" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { leaf } = makeRenderedScene(
      'background: url("blob:atlas") 0 0 / 64px 64px no-repeat; --polycss-atlas-size: 64px;',
    );
    const secondLeaf = leaf.cloneNode() as HTMLElement;
    leaf.after(secondLeaf);

    const html = await exportPolySceneSnapshot(leaf);

    expect(countOccurrences(html, "data:image/png;base64,YXRsYXM=")).toBe(1);
    expect(html.match(/<s\b[^>]*data-polycss-snapshot-bg="a0"/g)?.length).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fetch already-inline data URLs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { host } = makeRenderedScene(
      "background-image: url(data:image/png;base64,abc123);",
    );

    const html = await exportPolySceneSnapshot(host);

    expect(html).toContain("data:image/png;base64,abc123");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("freezes static mesh vars into inline declarations", async () => {
    const { leaf } = makeSolidScene();

    const html = await exportPolySceneSnapshot(leaf);

    expect(html).toContain("transform-origin: 10px 20px 30px");
    expect(html).toContain("color: #ff0000");
    expect(html).not.toContain("--origin");
    expect(html).not.toContain("--polycss-paint");
    expect(html).not.toContain("@property");
    expect(html).not.toContain("--shadow-proj");
  });

  it("includes dynamic lighting CSS only for dynamic snapshots", async () => {
    const { leaf } = makeDynamicScene();

    const html = await exportPolySceneSnapshot(leaf);

    expect(html).toContain('@property --plx { syntax: "<number>"');
    expect(html).toContain('data-polycss-lighting="dynamic"');
    expect(html).toContain('.polycss-scene[data-polycss-lighting="dynamic"] :not(.polycss-bucket) > b');
    expect(html).not.toContain("@property --shadow-ground-cssz");
    expect(html).not.toContain("--shadow-proj");
    expect(html).not.toContain(".polycss-scene q");
    expect(html).not.toContain("--clx");
  });

  it("throws a clear error when an asset cannot be inlined", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("blocked");
    }));
    const { leaf } = makeRenderedScene(
      'background-image: url("https://cdn.example/texture.png");',
    );

    let thrown: unknown;
    try {
      await exportPolySceneSnapshot(leaf);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PolySceneSnapshotError);
    expect(thrown).toMatchObject({
      code: "ASSET_INLINE_FAILED",
      url: "https://cdn.example/texture.png",
    });
  });

  it("rejects invalid targets and targets without a rendered scene", async () => {
    await expect(
      exportPolySceneSnapshot(null as unknown as Element),
    ).rejects.toMatchObject({ code: "INVALID_TARGET" });

    await expect(
      exportPolySceneSnapshot(document.createElement("div")),
    ).rejects.toMatchObject({ code: "SCENE_NOT_FOUND" });
  });
});
