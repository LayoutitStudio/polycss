import type {
  CameraCullRotation,
  PolyAmbientLight,
  PolyDirectionalLight,
  PolyVoxelFace,
  PolyVoxelSource,
  PolyVoxelSlicePlan,
  Polygon,
  Vec3,
} from "@layoutit/polycss-core";
import {
  BASE_TILE,
  buildPolyVoxelFaceData,
  buildPolyVoxelSlicePlan,
  POLY_VOXEL_NEXT_LAYER_STEP,
  normalFacesCamera,
  parsePureColor,
} from "@layoutit/polycss-core";

type Axis = "x" | "y" | "z";

interface BrushState {
  left?: string;
  top?: string;
  width?: string;
  height?: string;
  color?: string;
  zOffset?: string;
}

type BrushElement = HTMLElement & {
  __polycssVoxelBrushState?: BrushState;
};

export interface PolyVoxelSliceRenderer {
  readonly element: HTMLElement;
  readonly brushCount: number;
  render(rotation: CameraCullRotation): void;
  syncCamera(rotation: CameraCullRotation): void;
  dispose(): void;
}

export interface PolyVoxelSliceRendererOptions {
  doc: Document;
  wrapper: HTMLElement;
  source: PolyVoxelSource;
  polygons?: readonly Polygon[];
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
}

interface RGB { r: number; g: number; b: number; alpha: number; }

interface BrushPlan {
  axis: Axis;
  face: PolyVoxelFace;
  brushes: Array<{
    left: number;
    top: number;
    width: number;
    height: number;
    z: number;
    baseColor: string;
  }>;
}

const DEFAULT_LIGHT_DIR: Vec3 = [0.4, -0.7, 0.59];
const DEFAULT_LIGHT_COLOR = "#ffffff";
const DEFAULT_LIGHT_INTENSITY = 1;
const DEFAULT_AMBIENT_COLOR = "#ffffff";
const DEFAULT_AMBIENT_INTENSITY = 0.4;

const FACE_NORMALS: Record<PolyVoxelFace, Vec3> = {
  t: [0, 0, 1],
  b: [0, 0, -1],
  fl: [0, 1, 0],
  br: [0, -1, 0],
  fr: [1, 0, 0],
  bl: [-1, 0, 0],
};

const FACE_ORDER: PolyVoxelFace[] = ["t", "b", "bl", "br", "fr", "fl"];

const FACE_BY_NORMAL = new Map<string, PolyVoxelFace>([
  ["0,0,1", "t"],
  ["0,0,-1", "b"],
  ["0,1,0", "fl"],
  ["0,-1,0", "br"],
  ["1,0,0", "fr"],
  ["-1,0,0", "bl"],
]);

function visibleFaceSignature(rotation: CameraCullRotation): string {
  const visible: string[] = [];
  for (const face of FACE_ORDER) {
    if (normalFacesCamera(FACE_NORMALS[face], rotation)) visible.push(face);
  }
  return visible.join("|");
}

function applyBrush(
  el: BrushElement,
  left: string,
  top: string,
  width: string,
  height: string,
  color: string,
  zOffset: string,
): void {
  const state = (el.__polycssVoxelBrushState ??= {});
  if (state.left !== left) {
    el.style.left = left;
    state.left = left;
  }
  if (state.top !== top) {
    el.style.top = top;
    state.top = top;
  }
  if (state.width !== width) {
    el.style.width = width;
    state.width = width;
  }
  if (state.height !== height) {
    el.style.height = height;
    state.height = height;
  }
  if (state.color !== color) {
    el.style.color = color;
    state.color = color;
  }
  if (state.zOffset !== zOffset) {
    el.style.transform = `translateZ(${zOffset})`;
    state.zOffset = zOffset;
  }
}

function planBrushZ(plan: PolyVoxelSlicePlan, cellPx: number): string {
  const plane = plan.key.plane * cellPx;
  return plan.key.axis === "z" ? `${plane}px` : `${-plane}px`;
}

function cssNormalForPolygon(polygon: Polygon): Vec3 | null {
  const vertices = polygon.vertices;
  if (vertices.length < 3) return null;
  const v0 = vertices[0];
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 1; i + 1 < vertices.length; i += 1) {
    const v1 = vertices[i];
    const v2 = vertices[i + 1];
    const e1x = v1[1] - v0[1];
    const e1y = v1[0] - v0[0];
    const e1z = v1[2] - v0[2];
    const e2x = v2[1] - v0[1];
    const e2y = v2[0] - v0[0];
    const e2z = v2[2] - v0[2];
    nx -= e1y * e2z - e1z * e2y;
    ny -= e1z * e2x - e1x * e2z;
    nz -= e1x * e2y - e1y * e2x;
  }
  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-9) return null;
  return [
    Math.round(nx / len),
    Math.round(ny / len),
    Math.round(nz / len),
  ];
}

function polygonBrush(polygon: Polygon): (BrushPlan["brushes"][number] & {
  axis: Axis;
  face: PolyVoxelFace;
}) | null {
  if (polygon.texture || polygon.material || polygon.uvs || polygon.textureTriangles) return null;
  if (polygon.vertices.length !== 4) return null;
  const normal = cssNormalForPolygon(polygon);
  const face = normal ? FACE_BY_NORMAL.get(normal.join(",")) : undefined;
  if (!face) return null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of polygon.vertices) {
    minX = Math.min(minX, v[0]);
    minY = Math.min(minY, v[1]);
    minZ = Math.min(minZ, v[2]);
    maxX = Math.max(maxX, v[0]);
    maxY = Math.max(maxY, v[1]);
    maxZ = Math.max(maxZ, v[2]);
  }

  const eps = 1e-6;
  const baseColor = polygon.color || "#cccccc";
  if (Math.abs(maxZ - minZ) <= eps) {
    return {
      axis: "z",
      face,
      left: minY * BASE_TILE,
      top: minX * BASE_TILE,
      width: Math.max(0, (maxY - minY) * BASE_TILE),
      height: Math.max(0, (maxX - minX) * BASE_TILE),
      z: minZ * BASE_TILE,
      baseColor,
    };
  }
  if (Math.abs(maxX - minX) <= eps) {
    return {
      axis: "x",
      face,
      left: minY * BASE_TILE,
      top: minZ * BASE_TILE,
      width: Math.max(0, (maxY - minY) * BASE_TILE),
      height: Math.max(0, (maxZ - minZ) * BASE_TILE),
      z: -minX * BASE_TILE,
      baseColor,
    };
  }
  if (Math.abs(maxY - minY) <= eps) {
    return {
      axis: "y",
      face,
      left: minZ * BASE_TILE,
      top: minX * BASE_TILE,
      width: Math.max(0, (maxZ - minZ) * BASE_TILE),
      height: Math.max(0, (maxX - minX) * BASE_TILE),
      z: -minY * BASE_TILE,
      baseColor,
    };
  }
  return null;
}

function parseColor(input: string): RGB {
  const parsed = parsePureColor(input);
  if (!parsed) return { r: 255, g: 255, b: 255, alpha: 1 };
  return {
    r: parsed.rgb[0],
    g: parsed.rgb[1],
    b: parsed.rgb[2],
    alpha: parsed.alpha,
  };
}

function rgbToHex({ r, g, b }: RGB): string {
  const f = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

function clampChannel(value: number): number {
  return Math.round(Math.max(0, Math.min(255, value)));
}

function shadeBrushColor(
  normal: Vec3,
  baseColor: string,
  directionalLight: PolyDirectionalLight | undefined,
  ambientLight: PolyAmbientLight | undefined,
): string {
  const base = parseColor(baseColor);
  const light = parseColor(directionalLight?.color ?? DEFAULT_LIGHT_COLOR);
  const ambient = parseColor(ambientLight?.color ?? DEFAULT_AMBIENT_COLOR);
  const lightDir = directionalLight?.direction ?? DEFAULT_LIGHT_DIR;
  const lightLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / lightLen;
  const ly = lightDir[1] / lightLen;
  const lz = lightDir[2] / lightLen;
  const directScale = Math.max(0, directionalLight?.intensity ?? DEFAULT_LIGHT_INTENSITY) *
    Math.max(0, normal[0] * lx + normal[1] * ly + normal[2] * lz);
  const ambientIntensity = Math.max(0, ambientLight?.intensity ?? DEFAULT_AMBIENT_INTENSITY);
  const tintR = (ambient.r / 255) * ambientIntensity + (light.r / 255) * directScale;
  const tintG = (ambient.g / 255) * ambientIntensity + (light.g / 255) * directScale;
  const tintB = (ambient.b / 255) * ambientIntensity + (light.b / 255) * directScale;
  const shaded: RGB = {
    r: base.r * tintR,
    g: base.g * tintG,
    b: base.b * tintB,
    alpha: base.alpha,
  };
  return shaded.alpha < 1
    ? `rgba(${clampChannel(shaded.r)}, ${clampChannel(shaded.g)}, ${clampChannel(shaded.b)}, ${shaded.alpha})`
    : rgbToHex(shaded);
}

function buildMergedPlans(source: PolyVoxelSource, cellPx: number): BrushPlan[] {
  const faces = buildPolyVoxelFaceData(source);
  const faceIndex = new Map<string, (typeof faces)[number]>();
  for (const face of faces) {
    faceIndex.set(`${face.key.axis}:${face.key.plane}:${face.key.face}`, face);
  }
  return faces.map((face): BrushPlan => {
    const nextPlane = face.key.plane + POLY_VOXEL_NEXT_LAYER_STEP[face.key.face];
    const nextFace = faceIndex.get(`${face.key.axis}:${nextPlane}:${face.key.face}`);
    const plan = buildPolyVoxelSlicePlan(face, nextFace?.buffer ?? null);
    const z = Number.parseFloat(planBrushZ(plan, cellPx));
    return {
      axis: plan.key.axis,
      face: plan.key.face,
      brushes: plan.brushes.map((brush) => ({
        left: (plan.buffer.minCol + brush.c0) * cellPx,
        top: (plan.buffer.minRow + brush.r0) * cellPx,
        width: (brush.c1 - brush.c0) * cellPx,
        height: (brush.r1 - brush.r0) * cellPx,
        z,
        baseColor: brush.baseColor,
      })),
    };
  });
}

function buildPolygonPlans(polygons: readonly Polygon[] | undefined): BrushPlan[] {
  if (!polygons?.length) return [];
  const plans = new Map<string, BrushPlan>();
  let accepted = 0;
  for (const polygon of polygons) {
    const brush = polygonBrush(polygon);
    if (!brush || brush.width <= 0 || brush.height <= 0) continue;
    accepted += 1;
    const key = `${brush.axis}:${brush.face}`;
    let plan = plans.get(key);
    if (!plan) {
      plan = { axis: brush.axis, face: brush.face, brushes: [] };
      plans.set(key, plan);
    }
    plan.brushes.push({
      left: brush.left,
      top: brush.top,
      width: brush.width,
      height: brush.height,
      z: brush.z,
      baseColor: brush.baseColor,
    });
  }
  return accepted === polygons.length ? Array.from(plans.values()) : [];
}

function configureHost(
  host: HTMLElement,
  width: number,
  height: number,
): void {
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
}

export function createPolyVoxelSliceRenderer(
  options: PolyVoxelSliceRendererOptions,
): PolyVoxelSliceRenderer {
  const { doc, wrapper, source, polygons, directionalLight, ambientLight } = options;
  const cellPx = Math.max(1, Math.round(source.scale * BASE_TILE));
  const polygonPlans = buildPolygonPlans(polygons);
  const plans = polygonPlans.length > 0
    ? polygonPlans
    : buildMergedPlans(source, cellPx);
  const shiftPx = polygonPlans.length > 0 ? 0 : source.gridShift * BASE_TILE;
  const colorCache = new Map<string, string>();

  const hosts: Record<Axis, HTMLElement> = {
    z: doc.createElement("div"),
    x: doc.createElement("div"),
    y: doc.createElement("div"),
  };
  hosts.z.className = "polycss-voxel-host polycss-voxel-host-z";
  hosts.x.className = "polycss-voxel-host polycss-voxel-host-x";
  hosts.y.className = "polycss-voxel-host polycss-voxel-host-y";
  const shiftTransform = shiftPx !== 0
    ? `translate3d(${shiftPx}px, ${shiftPx}px, ${shiftPx}px) `
    : "";
  hosts.z.style.transform = shiftTransform.trim();
  hosts.x.style.transform = `${shiftTransform}rotateX(90deg)`;
  hosts.y.style.transform = `${shiftTransform}rotateY(-90deg)`;
  wrapper.append(hosts.z, hosts.x, hosts.y);

  configureHost(
    hosts.z,
    source.cols * cellPx,
    source.rows * cellPx,
  );
  configureHost(
    hosts.x,
    source.cols * cellPx,
    source.depth * cellPx,
  );
  configureHost(
    hosts.y,
    source.depth * cellPx,
    source.rows * cellPx,
  );

  const pools: Record<Axis, BrushElement[]> = { z: [], x: [], y: [] };
  let lastSignature = "";
  let mountedBrushCount = 0;

  const nextBrush = (axis: Axis, index: number): BrushElement => {
    let el = pools[axis][index];
    if (!el) {
      el = doc.createElement("b") as BrushElement;
      pools[axis][index] = el;
    }
    if (el.parentElement !== hosts[axis]) hosts[axis].appendChild(el);
    return el;
  };

  const shadedColor = (face: PolyVoxelFace, baseColor: string): string => {
    const key = `${face}|${baseColor}`;
    const cached = colorCache.get(key);
    if (cached) return cached;
    const shaded = shadeBrushColor(FACE_NORMALS[face], baseColor, directionalLight, ambientLight);
    colorCache.set(key, shaded);
    return shaded;
  };

  const draw = (signature: string): void => {
    const visibleFaces = new Set(signature.split("|").filter(Boolean) as PolyVoxelFace[]);
    const used: Record<Axis, number> = { z: 0, x: 0, y: 0 };
    mountedBrushCount = 0;

    for (const plan of plans) {
      const axis = plan.axis;
      if (!visibleFaces.has(plan.face)) continue;
      for (const brush of plan.brushes) {
        const left = `${brush.left}px`;
        const top = `${brush.top}px`;
        const width = `${brush.width}px`;
        const height = `${brush.height}px`;
        const zOffset = `${brush.z}px`;
        const el = nextBrush(axis, used[axis]);
        used[axis] += 1;
        applyBrush(
          el,
          left,
          top,
          width,
          height,
          shadedColor(plan.face, brush.baseColor),
          zOffset,
        );
        mountedBrushCount += 1;
      }
    }

    for (const axis of Object.keys(pools) as Axis[]) {
      const pool = pools[axis];
      for (let i = used[axis]; i < pool.length; i += 1) pool[i]?.remove();
    }
  };

  const renderer: PolyVoxelSliceRenderer = {
    element: hosts.z,
    get brushCount() { return mountedBrushCount; },
    render(rotation: CameraCullRotation) {
      lastSignature = visibleFaceSignature(rotation);
      draw(lastSignature);
    },
    syncCamera(rotation: CameraCullRotation) {
      const nextSignature = visibleFaceSignature(rotation);
      if (nextSignature === lastSignature) return;
      lastSignature = nextSignature;
      draw(nextSignature);
    },
    dispose() {
      hosts.z.remove();
      hosts.x.remove();
      hosts.y.remove();
      pools.x.length = 0;
      pools.y.length = 0;
      pools.z.length = 0;
      mountedBrushCount = 0;
      lastSignature = "";
    },
  };

  return renderer;
}
