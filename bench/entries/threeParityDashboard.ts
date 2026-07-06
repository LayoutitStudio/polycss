import * as THREE from "three";
import {
  boxPolygons,
  createPolyOrthographicCamera,
  createPolyPerspectiveCamera,
  createPolyScene,
  dodecahedronPolygons,
  icosahedronPolygons,
  loadMesh,
} from "@layoutit/polycss";
import type {
  ParseResult,
  Polygon,
  Vec3,
} from "@layoutit/polycss";
import {
  AmbientLight,
  DirectionalLight,
  OrthographicCamera as PolyThreeOrthographicCamera,
  PerspectiveCamera as PolyThreePerspectiveCamera,
  Vector3,
  createPolyOrthographicCameraFromThree,
  createPolyPerspectiveCameraFromThree,
  mountPolyThreeScene,
  polyToThreePoint,
  threeToPolyPoint,
} from "@layoutit/polycss/three";

type CameraMode = "perspective" | "orthographic" | "fpv";
type ObjectKey = "cube" | "icosahedron" | "dodecahedron" | "cactus" | "box" | "car";
type SceneKey = "single" | "lineup" | "occlusion";
type ViewKey = "iso" | "front" | "side" | "top";
type LightingMode = "baked" | "dynamic";
type ThreePolygon = Omit<Polygon, "vertices"> & { vertices: Vec3[] };
type BBox2 = { x: number; y: number; width: number; height: number; count: number };

const state = {
  object: "cube" as ObjectKey,
  scene: "single" as SceneKey,
  camera: "perspective" as CameraMode,
  view: "iso" as ViewKey,
  fov: 42,
  orthoSize: 7,
  zoom: 1,
  lighting: "baked" as LightingMode,
  yaw: 35,
  pitch: 24,
};

const objectCache = new Map<ObjectKey, Promise<ThreePolygon[]>>();
let renderToken = 0;
let renderer: THREE.WebGLRenderer | null = null;
let polyScenes: Array<{ destroy(): void }> = [];
let activeCodeTab: "three" | "adapter" | "native" = "three";
let lastCode = { three: "", adapter: "", native: "" };

const els = {
  object: byId<HTMLSelectElement>("object"),
  scene: byId<HTMLSelectElement>("scene"),
  camera: byId<HTMLSelectElement>("camera"),
  view: byId<HTMLSelectElement>("view"),
  lighting: byId<HTMLSelectElement>("lighting"),
  fov: byId<HTMLInputElement>("fov"),
  orthoSize: byId<HTMLInputElement>("ortho-size"),
  zoom: byId<HTMLInputElement>("zoom"),
  fovValue: byId<HTMLElement>("fov-value"),
  sizeValue: byId<HTMLElement>("size-value"),
  zoomValue: byId<HTMLElement>("zoom-value"),
  reset: byId<HTMLButtonElement>("reset"),
  threeSurface: byId<HTMLElement>("three-surface"),
  adapterHost: byId<HTMLElement>("adapter-host"),
  nativeHost: byId<HTMLElement>("native-host"),
  metricThree: byId<HTMLElement>("metric-three"),
  metricAdapter: byId<HTMLElement>("metric-adapter"),
  metricNative: byId<HTMLElement>("metric-native"),
  metricDelta: byId<HTMLElement>("metric-delta"),
  code: byId<HTMLElement>("code"),
};

const objectLabels: Record<ObjectKey, string> = {
  cube: "colored cube",
  icosahedron: "icosahedron",
  dodecahedron: "dodecahedron",
  cactus: "gallery cactus",
  box: "gallery box",
  car: "gallery car",
};

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

function parseResult(polygons: Polygon[]): ParseResult {
  return { polygons, objectUrls: [], warnings: [], dispose() {} };
}

function polyPolygonsToThree(polygons: Polygon[]): ThreePolygon[] {
  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map((vertex) => polyToThreePoint(vertex).toArray() as Vec3),
    textureTriangles: undefined,
    uvs: undefined,
    texture: undefined,
    material: undefined,
  }));
}

function threePolygonsToPoly(polygons: ThreePolygon[]): Polygon[] {
  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map((vertex) => threeToPolyPoint(vertex as Vec3)),
    textureTriangles: undefined,
    uvs: undefined,
    texture: undefined,
    material: undefined,
  }));
}

function normalizeThreePolygons(polygons: ThreePolygon[], targetSize = 2.4): ThreePolygon[] {
  const bounds = bounds3(polygons);
  const span = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
  const maxSpan = Math.max(span[0], span[1], span[2], 0.0001);
  const scale = targetSize / maxSpan;
  const centerX = (bounds.min[0] + bounds.max[0]) / 2;
  const centerZ = (bounds.min[2] + bounds.max[2]) / 2;
  const minY = bounds.min[1];

  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map((vertex) => [
      (vertex[0] - centerX) * scale,
      (vertex[1] - minY) * scale,
      (vertex[2] - centerZ) * scale,
    ]),
  }));
}

function bounds3(polygons: Pick<Polygon, "vertices">[]) {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) {
    for (const vertex of polygon.vertices) {
      min[0] = Math.min(min[0], vertex[0]);
      min[1] = Math.min(min[1], vertex[1]);
      min[2] = Math.min(min[2], vertex[2]);
      max[0] = Math.max(max[0], vertex[0]);
      max[1] = Math.max(max[1], vertex[1]);
      max[2] = Math.max(max[2], vertex[2]);
    }
  }
  return { min, max };
}

function transformThreePolygons(
  polygons: ThreePolygon[],
  transform: { position?: Vec3; scale?: number; rotationY?: number },
): ThreePolygon[] {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(...(transform.position ?? [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, transform.rotationY ?? 0, 0)),
    new THREE.Vector3(transform.scale ?? 1, transform.scale ?? 1, transform.scale ?? 1),
  );
  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map((vertex) => {
      const v = new THREE.Vector3(vertex[0], vertex[1], vertex[2]).applyMatrix4(matrix);
      return [v.x, v.y, v.z] as Vec3;
    }),
  }));
}

function floorPolygon(): ThreePolygon {
  return {
    color: "#d8dee8",
    vertices: [
      [-4.2, 0, -4.2],
      [-4.2, 0, 4.2],
      [4.2, 0, 4.2],
      [4.2, 0, -4.2],
    ],
  };
}

async function objectPolygons(key: ObjectKey): Promise<ThreePolygon[]> {
  if (!objectCache.has(key)) {
    objectCache.set(key, loadObjectPolygons(key));
  }
  return objectCache.get(key)!;
}

async function loadObjectPolygons(key: ObjectKey): Promise<ThreePolygon[]> {
  if (key === "cube") {
    return normalizeThreePolygons(polyPolygonsToThree(boxPolygons({
      size: 2,
      faces: {
        right: { color: "#ef4444" },
        left: { color: "#b91c1c" },
        front: { color: "#f59e0b" },
        back: { color: "#2563eb" },
        top: { color: "#f8fafc" },
        bottom: { color: "#64748b" },
      },
    })), 2.15);
  }
  if (key === "icosahedron") {
    return normalizeThreePolygons(polyPolygonsToThree(icosahedronPolygons({ size: 1, color: "#38bdf8" })), 2.25);
  }
  if (key === "dodecahedron") {
    return normalizeThreePolygons(polyPolygonsToThree(dodecahedronPolygons({ size: 1, color: "#f97316" })), 2.25);
  }

  const url = {
    cactus: "/gallery/glb/poly-pizza/cactus-a.glb",
    box: "/gallery/glb/urban/Box.glb",
    car: "/gallery/glb/urban/Car.glb",
  }[key];
  const result = await loadMesh(url, {
    meshResolution: "lossless",
    gltfOptions: { center: true },
    solidTextureSamples: true,
  });
  return normalizeThreePolygons(polyPolygonsToThree(result.polygons), key === "car" ? 3.0 : 2.45);
}

async function scenePolygons(): Promise<ThreePolygon[]> {
  const base = await objectPolygons(state.object);
  const floor = floorPolygon();
  if (state.scene === "lineup") {
    return [
      floor,
      ...transformThreePolygons(base, { position: [-2.25, 0, 0.2], scale: 0.72, rotationY: -0.45 }),
      ...transformThreePolygons(base, { position: [0, 0, 0], scale: 0.86, rotationY: 0.1 }),
      ...transformThreePolygons(base, { position: [2.25, 0, -0.15], scale: 0.72, rotationY: 0.55 }),
    ];
  }
  if (state.scene === "occlusion") {
    return [
      floor,
      ...transformThreePolygons(base, { position: [-0.72, 0, 0.78], scale: 0.95, rotationY: 0.5 }),
      ...transformThreePolygons(base, { position: [0.82, 0, -0.42], scale: 0.95, rotationY: -0.35 }),
    ];
  }
  return [floor, ...base];
}

function panelSize(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return {
    width: Math.max(300, Math.round(rect.width)),
    height: Math.max(260, Math.round(rect.height)),
  };
}

function cameraPosition(mode: CameraMode): { position: THREE.Vector3; target: THREE.Vector3 } {
  if (mode === "fpv") {
    return {
      position: new THREE.Vector3(-0.4, 1.35, 5.1 / state.zoom),
      target: new THREE.Vector3(0, 1.05, 0),
    };
  }
  const target = new THREE.Vector3(0, 1.05, 0);
  const radius = 7.2 / state.zoom;
  const yaw = state.yaw * Math.PI / 180;
  const pitch = state.pitch * Math.PI / 180;
  return {
    position: new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch) * radius,
      target.y + Math.sin(pitch) * radius,
      Math.cos(yaw) * Math.cos(pitch) * radius,
    ),
    target,
  };
}

function applyPresetView() {
  const view = state.view;
  if (view === "iso") {
    state.yaw = 35;
    state.pitch = 24;
  } else if (view === "front") {
    state.yaw = 0;
    state.pitch = 0;
  } else if (view === "side") {
    state.yaw = 90;
    state.pitch = 0;
  } else {
    state.yaw = 0;
    state.pitch = 82;
  }
}

function makeThreeCamera(size: { width: number; height: number }) {
  const mode = state.camera;
  const { position, target } = cameraPosition(mode);
  const aspect = size.width / size.height;
  const camera = mode === "orthographic"
    ? new THREE.OrthographicCamera(
        -state.orthoSize * aspect / 2,
        state.orthoSize * aspect / 2,
        state.orthoSize / 2,
        -state.orthoSize / 2,
        0.01,
        200,
      )
    : new THREE.PerspectiveCamera(state.fov, aspect, 0.01, 200);
  camera.position.copy(position);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

function makeCompatCamera(size: { width: number; height: number }) {
  const mode = state.camera;
  const { position, target } = cameraPosition(mode);
  const aspect = size.width / size.height;
  if (mode === "orthographic") {
    const camera = new PolyThreeOrthographicCamera(
      -state.orthoSize * aspect / 2,
      state.orthoSize * aspect / 2,
      state.orthoSize / 2,
      -state.orthoSize / 2,
      0.01,
      200,
    );
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(new Vector3(target.x, target.y, target.z));
    return camera;
  }
  const camera = new PolyThreePerspectiveCamera(state.fov, aspect, 0.01, 200);
  camera.position.set(position.x, position.y, position.z);
  camera.lookAt(new Vector3(target.x, target.y, target.z));
  return camera;
}

function makeLights() {
  const ambient = new AmbientLight("#ffffff", 0.48);
  const directional = new DirectionalLight("#ffffff", 0.82);
  directional.position.set(3.4, 5.2, 4.1);
  directional.target.position.set(0, 0.8, 0);
  return { ambient, directional };
}

function renderThree(polygons: ThreePolygon[], camera: THREE.Camera, size: { width: number; height: number }) {
  renderer?.dispose();
  els.threeSurface.textContent = "";
  const canvas = document.createElement("canvas");
  els.threeSurface.appendChild(canvas);
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size.width, size.height, false);
    renderer.setClearColor(0xf8fafc, 1);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight("#ffffff", 0.48));
    const light = new THREE.DirectionalLight("#ffffff", 0.82);
    light.position.set(3.4, 5.2, 4.1);
    light.target.position.set(0, 0.8, 0);
    scene.add(light);
    scene.add(light.target);

    scene.add(meshFromPolygons(polygons));
    renderer.render(scene, camera);
  } catch (err) {
    renderer = null;
    renderThreeCanvasFallback(canvas, polygons, camera, size);
    console.warn("Three.js WebGL unavailable; dashboard used a 2D projected fallback for this panel.", err);
  }
}

function meshFromPolygons(polygons: ThreePolygon[]) {
  const positions: number[] = [];
  const colors: number[] = [];
  for (const polygon of polygons) {
    if (polygon.vertices.length < 3) continue;
    const color = new THREE.Color(polygon.color ?? "#cbd5e1");
    for (let i = 1; i < polygon.vertices.length - 1; i++) {
      for (const vertex of [polygon.vertices[0], polygon.vertices[i], polygon.vertices[i + 1]]) {
        positions.push(vertex[0], vertex[1], vertex[2]);
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide }),
  );
}

function renderThreeCanvasFallback(
  canvas: HTMLCanvasElement,
  polygons: ThreePolygon[],
  camera: THREE.Camera,
  size: { width: number; height: number },
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(size.width * dpr);
  canvas.height = Math.round(size.height * dpr);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, size.width, size.height);

  const light = new THREE.Vector3(3.4, 5.2, 4.1).sub(new THREE.Vector3(0, 0.8, 0)).normalize();
  const drawables = polygons
    .filter((polygon) => polygon.vertices.length >= 3)
    .map((polygon) => {
      const pts = polygon.vertices.map((vertex) => {
        const world = new THREE.Vector3(vertex[0], vertex[1], vertex[2]);
        const ndc = world.clone().project(camera);
        const view = world.clone().applyMatrix4(camera.matrixWorldInverse);
        return {
          x: (ndc.x * 0.5 + 0.5) * size.width,
          y: (-ndc.y * 0.5 + 0.5) * size.height,
          z: view.z,
        };
      });
      return {
        polygon,
        pts,
        z: pts.reduce((sum, pt) => sum + pt.z, 0) / pts.length,
      };
    })
    .sort((a, b) => a.z - b.z);

  for (const item of drawables) {
    const normal = polygonNormal(item.polygon.vertices);
    const direct = 0.82 * Math.max(0, normal.dot(light));
    const color = lambertSrgbColor(item.polygon.color ?? "#cbd5e1", direct, 0.48);
    ctx.beginPath();
    ctx.moveTo(item.pts[0].x, item.pts[0].y);
    for (let i = 1; i < item.pts.length; i++) ctx.lineTo(item.pts[i].x, item.pts[i].y);
    ctx.closePath();
    ctx.fillStyle = `#${color.getHexString()}`;
    ctx.fill();
  }

  ctx.fillStyle = "rgba(82, 96, 114, 0.82)";
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("2D fallback: WebGL unavailable in this browser", 12, size.height - 14);
}

function lambertSrgbColor(baseHex: string, direct: number, ambient: number) {
  const base = new THREE.Color(baseHex);
  const lit = new THREE.Color(
    base.r * (direct + ambient) / Math.PI,
    base.g * (direct + ambient) / Math.PI,
    base.b * (direct + ambient) / Math.PI,
  );
  return lit;
}

function polygonNormal(vertices: Vec3[]) {
  if (vertices.length < 3) return new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3(...vertices[0]);
  const b = new THREE.Vector3(...vertices[1]);
  const c = new THREE.Vector3(...vertices[2]);
  return b.sub(a).cross(c.sub(a)).normalize();
}

function renderAdapter(host: HTMLElement, polygons: Polygon[], camera: ReturnType<typeof makeCompatCamera>, size: { height: number }) {
  const { ambient, directional } = makeLights();
  const scene = mountPolyThreeScene(host, {
    camera,
    cameraOptions: { viewportHeight: size.height },
    polygons,
    autoCenter: false,
    directionalLight: directional.toPolyDirectionalLight(),
    ambientLight: ambient.toPolyAmbientLight(),
    textureLighting: state.lighting,
    textureQuality: 1,
  });
  polyScenes.push(scene);
}

function renderNative(host: HTMLElement, polygons: Polygon[], camera: ReturnType<typeof makeCompatCamera>, size: { height: number }) {
  const { ambient, directional } = makeLights();
  const nativeCamera = camera instanceof PolyThreePerspectiveCamera
    ? createPolyPerspectiveCameraFromThree(camera, { viewportHeight: size.height })
    : createPolyOrthographicCameraFromThree(camera, { viewportHeight: size.height });
  const scene = createPolyScene(host, {
    camera: nativeCamera,
    autoCenter: false,
    directionalLight: directional.toPolyDirectionalLight(),
    ambientLight: ambient.toPolyAmbientLight(),
    textureLighting: state.lighting,
    textureQuality: 1,
  });
  scene.add(parseResult(polygons), { merge: false, meshResolution: "lossless" });
  polyScenes.push(scene);
}

function clearPolyScenes() {
  for (const scene of polyScenes) scene.destroy();
  polyScenes = [];
  els.adapterHost.textContent = "";
  els.nativeHost.textContent = "";
}

async function render() {
  const token = ++renderToken;
  setLoading(true);
  updateLabels();
  try {
    const polygons = await scenePolygons();
    if (token !== renderToken) return;

    clearPolyScenes();
    const size = panelSize(els.threeSurface);
    const threeCamera = makeThreeCamera(size);
    const compatCamera = makeCompatCamera(size);
    const polyPolygons = threePolygonsToPoly(polygons);

    renderThree(polygons, threeCamera, size);
    renderAdapter(els.adapterHost, polyPolygons, compatCamera, size);
    renderNative(els.nativeHost, polyPolygons, compatCamera, size);
    updateCode();

    requestAnimationFrame(() => {
      const threeBox = projectedBBox(polygons, threeCamera, size);
      const adapterBox = domBBox(els.adapterHost);
      const nativeBox = domBBox(els.nativeHost);
      updateMetrics(threeBox, adapterBox, nativeBox);
      setLoading(false);
      (window as unknown as { __polyThreeParityReady?: boolean; __polyThreeParitySnapshot?: unknown }).__polyThreeParityReady = true;
      (window as unknown as { __polyThreeParitySnapshot?: unknown }).__polyThreeParitySnapshot = {
        state: { ...state },
        threeBox,
        adapterBox,
        nativeBox,
      };
    });
  } catch (err) {
    setLoading(false);
    const message = err instanceof Error ? err.message : String(err);
    els.metricDelta.textContent = `error: ${message}`;
    throw err;
  }
}

function projectedBBox(polygons: ThreePolygon[], camera: THREE.Camera, size: { width: number; height: number }): BBox2 {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const polygon of polygons) {
    for (const vertex of polygon.vertices) {
      const v = new THREE.Vector3(vertex[0], vertex[1], vertex[2]).project(camera);
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) continue;
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count++;
    }
  }
  return bboxOrEmpty(minX, minY, maxX, maxY, count);
}

function domBBox(host: HTMLElement): BBox2 {
  const root = host.getBoundingClientRect();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const el of host.querySelectorAll<HTMLElement>(".polycss-mesh *")) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 0.5 || rect.height < 0.5) continue;
    minX = Math.min(minX, rect.left - root.left);
    minY = Math.min(minY, rect.top - root.top);
    maxX = Math.max(maxX, rect.right - root.left);
    maxY = Math.max(maxY, rect.bottom - root.top);
    count++;
  }
  return bboxOrEmpty(minX, minY, maxX, maxY, count);
}

function bboxOrEmpty(minX: number, minY: number, maxX: number, maxY: number, count: number): BBox2 {
  if (!count) return { x: 0, y: 0, width: 0, height: 0, count: 0 };
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
    count,
  };
}

function updateMetrics(three: BBox2, adapter: BBox2, native: BBox2) {
  els.metricThree.textContent = fmtBox(three);
  els.metricAdapter.textContent = fmtBox(adapter);
  els.metricNative.textContent = fmtBox(native);
  els.metricDelta.textContent = [
    `PolyCSS lighting: ${state.lighting}`,
    `adapter vs three: ${fmtDelta(three, adapter)}`,
    `native vs three:  ${fmtDelta(three, native)}`,
    `native vs adapter:${fmtDelta(adapter, native)}`,
  ].join("\n");
}

function fmtBox(box: BBox2): string {
  return `x ${box.x.toFixed(1)}
y ${box.y.toFixed(1)}
w ${box.width.toFixed(1)}
h ${box.height.toFixed(1)}
leaves/verts ${box.count}`;
}

function fmtDelta(a: BBox2, b: BBox2): string {
  const acx = a.x + a.width / 2;
  const acy = a.y + a.height / 2;
  const bcx = b.x + b.width / 2;
  const bcy = b.y + b.height / 2;
  return `center ${Math.hypot(acx - bcx, acy - bcy).toFixed(1)}px, size ${Math.hypot(a.width - b.width, a.height - b.height).toFixed(1)}px`;
}

function setLoading(active: boolean) {
  for (const surface of [els.threeSurface, els.adapterHost.parentElement, els.nativeHost.parentElement]) {
    if (!surface) continue;
    const existing = surface.querySelector(".loading");
    if (!active) {
      existing?.remove();
      continue;
    }
    if (!existing) {
      const loading = document.createElement("div");
      loading.className = "loading";
      loading.textContent = "rendering";
      surface.appendChild(loading);
    }
  }
}

function updateLabels() {
  els.fovValue.textContent = `${state.fov}deg`;
  els.sizeValue.textContent = state.orthoSize.toFixed(2);
  els.zoomValue.textContent = `${state.zoom.toFixed(2)}x`;
}

function codeNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function codeVector(v: THREE.Vector3): string {
  return `${codeNumber(v.x)}, ${codeNumber(v.y)}, ${codeNumber(v.z)}`;
}

function codeSize() {
  const size = panelSize(els.threeSurface);
  return { ...size, aspect: size.width / size.height };
}

function threeCameraCode(size = codeSize()): string {
  const { position, target } = cameraPosition(state.camera);
  if (state.camera === "orthographic") {
    return `const camera = new THREE.OrthographicCamera(
  ${codeNumber(-state.orthoSize * size.aspect / 2)},
  ${codeNumber(state.orthoSize * size.aspect / 2)},
  ${codeNumber(state.orthoSize / 2)},
  ${codeNumber(-state.orthoSize / 2)},
  0.01,
  200,
);
camera.position.set(${codeVector(position)});
camera.lookAt(${codeVector(target)});
camera.updateProjectionMatrix();
camera.updateMatrixWorld();`;
  }
  return `const camera = new THREE.PerspectiveCamera(${state.fov}, ${codeNumber(size.aspect)}, 0.01, 200);
camera.position.set(${codeVector(position)});
camera.lookAt(${codeVector(target)});
camera.updateProjectionMatrix();
camera.updateMatrixWorld();`;
}

function compatCameraCode(variableName: string, size = codeSize()): string {
  const { position, target } = cameraPosition(state.camera);
  if (state.camera === "orthographic") {
    return `const ${variableName} = new OrthographicCamera(
  ${codeNumber(-state.orthoSize * size.aspect / 2)},
  ${codeNumber(state.orthoSize * size.aspect / 2)},
  ${codeNumber(state.orthoSize / 2)},
  ${codeNumber(-state.orthoSize / 2)},
  0.01,
  200,
);
${variableName}.position.set(${codeVector(position)});
${variableName}.lookAt(${codeVector(target)});`;
  }
  return `const ${variableName} = new PerspectiveCamera(${state.fov}, ${codeNumber(size.aspect)}, 0.01, 200);
${variableName}.position.set(${codeVector(position)});
${variableName}.lookAt(${codeVector(target)});`;
}

function lightsCode(prefix: "THREE" | "poly") {
  if (prefix === "THREE") {
    return `scene.add(new THREE.AmbientLight("#ffffff", 0.48));
const directional = new THREE.DirectionalLight("#ffffff", 0.82);
directional.position.set(3.4, 5.2, 4.1);
directional.target.position.set(0, 0.8, 0);
scene.add(directional);
scene.add(directional.target);`;
  }
  return `const ambient = new AmbientLight("#ffffff", 0.48);
const directional = new DirectionalLight("#ffffff", 0.82);
directional.position.set(3.4, 5.2, 4.1);
directional.target.position.set(0, 0.8, 0);`;
}

function currentInputComment() {
  return `// Input geometry: ${objectLabels[state.object]}, ${state.scene} scene, authored in Three/Y-up coordinates.
// The bench loader produces this from primitives or gallery GLBs, then applies the same floor/lineup/occlusion transforms.
const threePolygons = await loadSelectedScenePolygons();`;
}

function updateCode() {
  const size = codeSize();
  lastCode = {
    three: `import * as THREE from "three";

const host = document.querySelector("#three")!;
const size = { width: ${size.width}, height: ${size.height} };
${currentInputComment()}

const canvas = document.createElement("canvas");
host.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setSize(size.width, size.height, false);
renderer.setClearColor(0xf8fafc, 1);

${threeCameraCode(size)}

const scene = new THREE.Scene();
${lightsCode("THREE")}
scene.add(meshFromPolygons(threePolygons));
renderer.render(scene, camera);

function meshFromPolygons(polygons) {
  const positions = [];
  const colors = [];
  for (const polygon of polygons) {
    const color = new THREE.Color(polygon.color ?? "#cbd5e1");
    for (let i = 1; i < polygon.vertices.length - 1; i++) {
      for (const vertex of [polygon.vertices[0], polygon.vertices[i], polygon.vertices[i + 1]]) {
        positions.push(vertex[0], vertex[1], vertex[2]);
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide }),
  );
}`,
    adapter: `import {
  AmbientLight,
  DirectionalLight,
  ${state.camera === "orthographic" ? "OrthographicCamera" : "PerspectiveCamera"},
  mountPolyThreeScene,
  threeToPolyPoint,
} from "@layoutit/polycss/three";

const host = document.querySelector("#poly-three")!;
${currentInputComment()}

const polyPolygons = threePolygons.map((polygon) => ({
  color: polygon.color,
  vertices: polygon.vertices.map((vertex) => threeToPolyPoint(vertex)),
}));

${compatCameraCode("camera", size)}
${lightsCode("poly")}

mountPolyThreeScene(host, {
  camera,
  cameraOptions: { viewportHeight: ${size.height} },
  polygons: polyPolygons,
  autoCenter: false,
  directionalLight: directional.toPolyDirectionalLight(),
  ambientLight: ambient.toPolyAmbientLight(),
  textureLighting: "${state.lighting}",
  textureQuality: 1,
});`,
    native: `import { createPolyScene } from "@layoutit/polycss";
import {
  AmbientLight,
  DirectionalLight,
  ${state.camera === "orthographic" ? "OrthographicCamera, createPolyOrthographicCameraFromThree" : "PerspectiveCamera, createPolyPerspectiveCameraFromThree"},
  threeToPolyPoint,
} from "@layoutit/polycss/three";

const host = document.querySelector("#poly-native")!;
${currentInputComment()}

const polyPolygons = threePolygons.map((polygon) => ({
  color: polygon.color,
  vertices: polygon.vertices.map((vertex) => threeToPolyPoint(vertex)),
}));

${compatCameraCode("threeLikeCamera", size)}
${lightsCode("poly")}

const camera = ${state.camera === "orthographic" ? "createPolyOrthographicCameraFromThree" : "createPolyPerspectiveCameraFromThree"}(threeLikeCamera, {
  viewportHeight: ${size.height},
});

const scene = createPolyScene(host, {
  camera,
  autoCenter: false,
  directionalLight: directional.toPolyDirectionalLight(),
  ambientLight: ambient.toPolyAmbientLight(),
  textureLighting: "${state.lighting}",
  textureQuality: 1,
});

scene.add({ polygons: polyPolygons, objectUrls: [], warnings: [], dispose() {} }, {
  merge: false,
  meshResolution: "lossless",
});`,
  };
  els.code.textContent = lastCode[activeCodeTab];
}

function bindControls() {
  els.object.value = state.object;
  els.scene.value = state.scene;
  els.camera.value = state.camera;
  els.view.value = state.view;
  els.lighting.value = state.lighting;
  els.fov.value = String(state.fov);
  els.orthoSize.value = String(state.orthoSize);
  els.zoom.value = String(state.zoom);

  els.object.addEventListener("change", () => {
    state.object = els.object.value as ObjectKey;
    render();
  });
  els.scene.addEventListener("change", () => {
    state.scene = els.scene.value as SceneKey;
    render();
  });
  els.camera.addEventListener("change", () => {
    state.camera = els.camera.value as CameraMode;
    render();
  });
  els.view.addEventListener("change", () => {
    state.view = els.view.value as ViewKey;
    applyPresetView();
    render();
  });
  els.lighting.addEventListener("change", () => {
    state.lighting = els.lighting.value as LightingMode;
    render();
  });
  els.fov.addEventListener("input", () => {
    state.fov = Number(els.fov.value);
    render();
  });
  els.orthoSize.addEventListener("input", () => {
    state.orthoSize = Number(els.orthoSize.value);
    render();
  });
  els.zoom.addEventListener("input", () => {
    state.zoom = Number(els.zoom.value);
    render();
  });
  els.reset.addEventListener("click", () => {
    state.zoom = 1;
    state.view = "iso";
    els.zoom.value = "1";
    els.view.value = "iso";
    applyPresetView();
    render();
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>(".tabs button")) {
    button.addEventListener("click", () => {
      activeCodeTab = button.dataset.tab as typeof activeCodeTab;
      for (const b of document.querySelectorAll(".tabs button")) b.classList.remove("active");
      button.classList.add("active");
      els.code.textContent = lastCode[activeCodeTab];
    });
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  for (const surface of document.querySelectorAll<HTMLElement>(".surface")) {
    surface.addEventListener("pointerdown", (event) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      surface.setPointerCapture(event.pointerId);
    });
    surface.addEventListener("pointermove", (event) => {
      if (!dragging || state.camera === "fpv") return;
      state.yaw += (event.clientX - lastX) * 0.35;
      state.pitch = Math.max(-82, Math.min(82, state.pitch - (event.clientY - lastY) * 0.25));
      lastX = event.clientX;
      lastY = event.clientY;
      render();
    });
    surface.addEventListener("pointerup", () => {
      dragging = false;
    });
  }

  window.addEventListener("resize", () => render());
}

bindControls();
applyPresetView();
render();
