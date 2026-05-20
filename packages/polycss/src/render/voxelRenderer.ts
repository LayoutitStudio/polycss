import type {
  CameraCullRotation,
  PolyAmbientLight,
  PolyDirectionalLight,
  PolyVoxelFace,
  Polygon,
  Vec3,
} from "@layoutit/polycss-core";
import {
  BASE_TILE,
  normalFacesCamera,
  parsePureColor,
  rotateVec3,
} from "@layoutit/polycss-core";

type Axis = "x" | "y" | "z";

interface BrushState {
  color?: string;
  transform?: string;
}

type BrushElement = HTMLElement & {
  __polycssVoxelBrushState?: BrushState;
};

export interface PolyVoxelRenderer {
  readonly element: HTMLElement;
  readonly brushCount: number;
  render(rotation: CameraCullRotation): void;
  syncCamera(rotation: CameraCullRotation): void;
  dispose(): void;
}

export interface PolyVoxelRendererOptions {
  doc: Document;
  wrapper: HTMLElement;
  polygons?: readonly Polygon[];
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
}

interface RGB { r: number; g: number; b: number; alpha: number; }

interface DirectMatrixItem {
  axis: Axis;
  face: PolyVoxelFace;
  left: number;
  top: number;
  width: number;
  height: number;
  z: number;
  baseColor: string;
  sourceIndex: number;
}

const DEFAULT_LIGHT_DIR: Vec3 = [0.4, -0.7, 0.59];
const DEFAULT_LIGHT_COLOR = "#ffffff";
const DEFAULT_LIGHT_INTENSITY = 1;
const DEFAULT_AMBIENT_COLOR = "#ffffff";
const DEFAULT_AMBIENT_INTENSITY = 0.4;
const DESKTOP_PRIMITIVE_SIZE = 1;
const MOBILE_PRIMITIVE_SIZE = 8;

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
  color: string,
  transform: string,
): void {
  const state = (el.__polycssVoxelBrushState ??= {});
  if (state.color !== color) {
    el.style.color = color;
    state.color = color;
  }
  if (state.transform !== transform) {
    el.style.transform = transform;
    state.transform = transform;
  }
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

function polygonBrush(polygon: Polygon): Omit<DirectMatrixItem, "sourceIndex"> | null {
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

function buildDirectMatrixItems(polygons: readonly Polygon[] | undefined): DirectMatrixItem[] {
  if (!polygons?.length) return [];
  const items: DirectMatrixItem[] = [];
  for (let sourceIndex = 0; sourceIndex < polygons.length; sourceIndex += 1) {
    const polygon = polygons[sourceIndex];
    const brush = polygonBrush(polygon);
    if (!brush || brush.width <= 0 || brush.height <= 0) return [];
    items.push({
      ...brush,
      sourceIndex,
    });
  }
  return items;
}

function directMatrix(
  axis: Axis,
  left: number,
  top: number,
  width: number,
  height: number,
  zOffset: number,
  primitiveSize: number,
): string {
  const scaleX = width / primitiveSize;
  const scaleY = height / primitiveSize;
  const values = axis === "x"
    ? [
        scaleX, 0, 0, 0,
        0, 0, scaleY, 0,
        0, -1, 0, 0,
        left, -zOffset, top, 1,
      ]
    : axis === "y"
      ? [
          0, 0, scaleX, 0,
          0, scaleY, 0, 0,
          -1, 0, 0, 0,
          -zOffset, top, left, 1,
        ]
      : [
          scaleX, 0, 0, 0,
          0, scaleY, 0, 0,
          0, 0, 1, 0,
          left, top, zOffset, 1,
        ];
  return `matrix3d(${values.map((value) => Number(value.toFixed(6))).join(",")})`;
}

function isMobileDocument(doc: Document): boolean {
  const media = doc.defaultView?.matchMedia;
  if (!media) return false;
  return media("(pointer: coarse)").matches || media("(hover: none)").matches;
}

function primitiveSizeForDocument(doc: Document): number {
  return isMobileDocument(doc) ? MOBILE_PRIMITIVE_SIZE : DESKTOP_PRIMITIVE_SIZE;
}

function itemCenter(item: DirectMatrixItem): Vec3 {
  if (item.axis === "x") {
    return [item.left + item.width / 2, -item.z, item.top + item.height / 2];
  }
  if (item.axis === "y") {
    return [-item.z, item.top + item.height / 2, item.left + item.width / 2];
  }
  return [item.left + item.width / 2, item.top + item.height / 2, item.z];
}

function projectedPoint(item: DirectMatrixItem, rotation: CameraCullRotation): { x: number; y: number } {
  let center = itemCenter(item);
  const meshRotation = rotation.meshRotation;
  if (meshRotation) {
    center = rotateVec3(center, meshRotation[0] ?? 0, meshRotation[1] ?? 0, meshRotation[2] ?? 0);
  }
  const [x, y] = rotateVec3(center, rotation.rotX, 0, rotation.rotY);
  return { x, y };
}

function orderDirectMatrixItems(
  items: readonly DirectMatrixItem[],
  visibleFaces: Set<PolyVoxelFace>,
  rotation: CameraCullRotation,
): DirectMatrixItem[] {
  const entries = items
    .filter((item) => visibleFaces.has(item.face))
    .map((item) => ({ item, ...projectedPoint(item, rotation) }));
  if (entries.length === 0) return [];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const entry of entries) {
    minX = Math.min(minX, entry.x);
    maxX = Math.max(maxX, entry.x);
    minY = Math.min(minY, entry.y);
    maxY = Math.max(maxY, entry.y);
  }

  const tileCount = 4;
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const tiles = new Map<string, {
    tx: number;
    ty: number;
    sourceIndex: number;
    items: DirectMatrixItem[];
  }>();
  for (const entry of entries) {
    const tx = Math.min(
      tileCount - 1,
      Math.max(0, Math.floor(((entry.x - minX) / spanX) * tileCount)),
    );
    const ty = Math.min(
      tileCount - 1,
      Math.max(0, Math.floor(((entry.y - minY) / spanY) * tileCount)),
    );
    const key = `${tx}:${ty}`;
    let tile = tiles.get(key);
    if (!tile) {
      tile = { tx, ty, sourceIndex: entry.item.sourceIndex, items: [] };
      tiles.set(key, tile);
    }
    tile.items.push(entry.item);
    tile.sourceIndex = Math.min(tile.sourceIndex, entry.item.sourceIndex);
  }

  return Array.from(tiles.values())
    .sort((a, b) => (a.ty - b.ty) || (a.tx - b.tx) || a.sourceIndex - b.sourceIndex)
    .flatMap((tile) => tile.items);
}

export function createPolyVoxelRenderer(
  options: PolyVoxelRendererOptions,
): PolyVoxelRenderer | null {
  const { doc, wrapper, polygons, directionalLight, ambientLight } = options;
  const directMatrixItems = buildDirectMatrixItems(polygons);
  if (directMatrixItems.length === 0) return null;
  wrapper.classList.add("polycss-voxel-mesh");
  const primitiveSize = primitiveSizeForDocument(doc);
  if (primitiveSize !== DESKTOP_PRIMITIVE_SIZE) {
    wrapper.style.setProperty("--polycss-voxel-primitive", `${primitiveSize}px`);
  }

  const colorCache = new Map<string, string>();
  const shadedColor = (face: PolyVoxelFace, baseColor: string): string => {
    const key = `${face}|${baseColor}`;
    const cached = colorCache.get(key);
    if (cached) return cached;
    const shaded = shadeBrushColor(FACE_NORMALS[face], baseColor, directionalLight, ambientLight);
    colorCache.set(key, shaded);
    return shaded;
  };

  const pool: BrushElement[] = [];
  let lastSignature = "";
  let mountedBrushCount = 0;

  const nextBrush = (index: number): BrushElement => {
    let el = pool[index];
    if (!el) {
      el = doc.createElement("b") as BrushElement;
      pool[index] = el;
    }
    if (el.parentElement !== wrapper) wrapper.appendChild(el);
    return el;
  };

  const draw = (signature: string, rotation: CameraCullRotation): void => {
    const visibleFaces = new Set(signature.split("|").filter(Boolean) as PolyVoxelFace[]);
    const orderedItems = orderDirectMatrixItems(directMatrixItems, visibleFaces, rotation);
    mountedBrushCount = 0;
    for (const item of orderedItems) {
      const el = nextBrush(mountedBrushCount);
      applyBrush(
        el,
        shadedColor(item.face, item.baseColor),
        directMatrix(item.axis, item.left, item.top, item.width, item.height, item.z, primitiveSize),
      );
      mountedBrushCount += 1;
    }
    for (let i = mountedBrushCount; i < pool.length; i += 1) pool[i]?.remove();
  };

  return {
    element: wrapper,
    get brushCount() { return mountedBrushCount; },
    render(rotation: CameraCullRotation) {
      lastSignature = visibleFaceSignature(rotation);
      draw(lastSignature, rotation);
    },
    syncCamera(rotation: CameraCullRotation) {
      const nextSignature = visibleFaceSignature(rotation);
      if (nextSignature === lastSignature) return;
      lastSignature = nextSignature;
      draw(nextSignature, rotation);
    },
    dispose() {
      for (const el of pool) el.remove();
      wrapper.classList.remove("polycss-voxel-mesh");
      wrapper.style.removeProperty("--polycss-voxel-primitive");
      pool.length = 0;
      mountedBrushCount = 0;
      lastSignature = "";
    },
  };
}
