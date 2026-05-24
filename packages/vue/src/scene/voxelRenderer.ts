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
  computeProjectiveQuadMatrix,
  normalFacesCamera,
  parsePureColor,
  PROJECTIVE_QUAD_BLEED,
  resolveProjectiveQuadGuards,
  rotateVec3,
  SOLID_QUAD_CANONICAL_SIZE,
} from "@layoutit/polycss-core";

type Axis = "x" | "y" | "z";
type VoxelSeamSide = "left" | "right" | "top" | "bottom";
type WorldAxisIndex = 0 | 1 | 2;

interface VoxelSeamBleed {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface BrushState {
  color?: string;
  transform?: string;
}

type BrushElement = HTMLElement & {
  __polycssVoxelBrushState?: BrushState;
};

type FaceHostElement = HTMLElement & {
  __polycssVoxelFaceHost?: true;
};

export interface PolyVoxelRenderer {
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
  bleed: VoxelSeamBleed;
}

interface VoxelSeamSegment {
  item: DirectMatrixItem;
  side: VoxelSeamSide;
  variableAxis: WorldAxisIndex;
  fixed: [number, number, number];
  start: number;
  end: number;
}

const DEFAULT_LIGHT_DIR: Vec3 = [0.4, -0.7, 0.59];
const DEFAULT_LIGHT_COLOR = "#ffffff";
const DEFAULT_LIGHT_INTENSITY = 1;
const DEFAULT_AMBIENT_COLOR = "#ffffff";
const DEFAULT_AMBIENT_INTENSITY = 0.4;
const DESKTOP_PRIMITIVE_SIZE = 1;
const MOBILE_PRIMITIVE_SIZE = 8;
const VOXEL_SEAM_BLEED = PROJECTIVE_QUAD_BLEED;
const VOXEL_SEAM_EPS = 1e-6;
const VOXEL_PROJECTIVE_QUAD_GUARDS = resolveProjectiveQuadGuards({ bleed: 0 });

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
  const baseColor = canonicalBrushColor(polygon.color);
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
      bleed: zeroVoxelSeamBleed(),
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
      bleed: zeroVoxelSeamBleed(),
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
      bleed: zeroVoxelSeamBleed(),
    };
  }
  return null;
}

function zeroVoxelSeamBleed(): VoxelSeamBleed {
  return { left: 0, right: 0, top: 0, bottom: 0 };
}

function worldLineKey(segment: VoxelSeamSegment): string {
  const coordKey = (value: number): string => String(Number(value.toFixed(6)));
  let key = `${segment.item.baseColor}|${segment.variableAxis}`;
  for (let axis = 0; axis < 3; axis += 1) {
    if (axis === segment.variableAxis) continue;
    key += `|${axis}:${coordKey(segment.fixed[axis])}`;
  }
  return key;
}

function cssPointForVertex(v: Vec3): Vec3 {
  return [v[1] * BASE_TILE, v[0] * BASE_TILE, v[2] * BASE_TILE];
}

function localPointForItem(item: DirectMatrixItem, p: Vec3): [number, number] {
  if (item.axis === "x") return [p[0], p[2]];
  if (item.axis === "y") return [p[2], p[1]];
  return [p[0], p[1]];
}

function sideForLocalEdge(
  item: DirectMatrixItem,
  a: [number, number],
  b: [number, number],
): VoxelSeamSide | null {
  const left = item.left;
  const right = item.left + item.width;
  const top = item.top;
  const bottom = item.top + item.height;
  if (Math.abs(a[0] - b[0]) <= VOXEL_SEAM_EPS) {
    if (Math.abs(a[0] - left) <= VOXEL_SEAM_EPS) return "left";
    if (Math.abs(a[0] - right) <= VOXEL_SEAM_EPS) return "right";
  }
  if (Math.abs(a[1] - b[1]) <= VOXEL_SEAM_EPS) {
    if (Math.abs(a[1] - top) <= VOXEL_SEAM_EPS) return "top";
    if (Math.abs(a[1] - bottom) <= VOXEL_SEAM_EPS) return "bottom";
  }
  return null;
}

function variableAxisForSegment(a: Vec3, b: Vec3): WorldAxisIndex | null {
  let axis: WorldAxisIndex | null = null;
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(a[i] - b[i]) <= VOXEL_SEAM_EPS) continue;
    if (axis !== null) return null;
    axis = i as WorldAxisIndex;
  }
  return axis;
}

function voxelSeamSegmentForEdge(
  item: DirectMatrixItem,
  polygon: Polygon,
  edgeIndex: number,
): VoxelSeamSegment | null {
  const vertices = polygon.vertices;
  const a = cssPointForVertex(vertices[edgeIndex]);
  const b = cssPointForVertex(vertices[(edgeIndex + 1) % vertices.length]);
  const side = sideForLocalEdge(item, localPointForItem(item, a), localPointForItem(item, b));
  if (!side) return null;
  const variableAxis = variableAxisForSegment(a, b);
  if (variableAxis === null) return null;
  const start = Math.min(a[variableAxis], b[variableAxis]);
  const end = Math.max(a[variableAxis], b[variableAxis]);
  return end - start > VOXEL_SEAM_EPS
    ? { item, side, variableAxis, fixed: a, start, end }
    : null;
}

function markVoxelSeam(segment: VoxelSeamSegment): void {
  segment.item.bleed[segment.side] = Math.max(segment.item.bleed[segment.side], VOXEL_SEAM_BLEED);
}

function applyVoxelSeamBleed(polygons: readonly Polygon[], items: DirectMatrixItem[]): void {
  const groups = new Map<string, VoxelSeamSegment[]>();
  for (const item of items) {
    const polygon = polygons[item.sourceIndex];
    if (!polygon) continue;
    for (let edgeIndex = 0; edgeIndex < polygon.vertices.length; edgeIndex += 1) {
      const segment = voxelSeamSegmentForEdge(item, polygon, edgeIndex);
      if (!segment) continue;
      const key = worldLineKey(segment);
      const group = groups.get(key);
      if (group) group.push(segment);
      else groups.set(key, [segment]);
    }
  }

  for (const segments of groups.values()) {
    if (segments.length < 2) continue;
    segments.sort((a, b) => a.start - b.start || a.end - b.end);
    let active: VoxelSeamSegment[] = [];
    for (const segment of segments) {
      active = active.filter((candidate) => candidate.end > segment.start + VOXEL_SEAM_EPS);
      for (const candidate of active) {
        if (candidate.item.sourceIndex === segment.item.sourceIndex) continue;
        markVoxelSeam(candidate);
        markVoxelSeam(segment);
      }
      active.push(segment);
    }
  }
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

function canonicalBrushColor(input: string | undefined): string {
  if (!input) return "#cccccc";
  const parsed = parsePureColor(input);
  if (!parsed) return input;
  const rgb: RGB = {
    r: parsed.rgb[0],
    g: parsed.rgb[1],
    b: parsed.rgb[2],
    alpha: parsed.alpha,
  };
  if (rgb.alpha < 1) {
    const alpha = Math.round(Math.max(0, rgb.alpha) * 1000) / 1000;
    return `rgba(${clampChannel(rgb.r)}, ${clampChannel(rgb.g)}, ${clampChannel(rgb.b)}, ${alpha})`;
  }
  return rgbToHex(rgb);
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
  applyVoxelSeamBleed(polygons, items);
  return items;
}

function voxelProjectiveBasis(item: DirectMatrixItem): {
  xAxis: Vec3;
  yAxis: Vec3;
  normal: Vec3;
  tx: number;
  ty: number;
  tz: number;
} {
  if (item.axis === "x") {
    return {
      xAxis: [1, 0, 0],
      yAxis: [0, 0, 1],
      normal: [0, -1, 0],
      tx: 0,
      ty: -item.z,
      tz: 0,
    };
  }
  if (item.axis === "y") {
    return {
      xAxis: [0, 0, 1],
      yAxis: [0, 1, 0],
      normal: [-1, 0, 0],
      tx: -item.z,
      ty: 0,
      tz: 0,
    };
  }
  return {
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    normal: [0, 0, 1],
    tx: 0,
    ty: 0,
    tz: item.z,
  };
}

function voxelScreenPts(item: DirectMatrixItem): number[] {
  const left = item.left;
  const top = item.top;
  const right = item.left + item.width;
  const bottom = item.top + item.height;
  return [
    left, top,
    right, top,
    right, bottom,
    left, bottom,
  ];
}

function voxelSeamEdgeAmounts(item: DirectMatrixItem): Map<number, number> {
  return new Map([
    [0, item.bleed.top],
    [1, item.bleed.right],
    [2, item.bleed.bottom],
    [3, item.bleed.left],
  ]);
}

function rescaleProjectiveMatrix(matrix: string, primitiveSize: number): string | null {
  const values = matrix.split(",").map(Number);
  if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) return null;
  const scale = SOLID_QUAD_CANONICAL_SIZE / primitiveSize;
  for (let i = 0; i < 8; i += 1) values[i] *= scale;
  return `matrix3d(${values.map((value) => Number(value.toFixed(6))).join(",")})`;
}

function affineVoxelMatrix(item: DirectMatrixItem, primitiveSize: number): string {
  const left = item.left - item.bleed.left;
  const top = item.top - item.bleed.top;
  const width = item.width + item.bleed.left + item.bleed.right;
  const height = item.height + item.bleed.top + item.bleed.bottom;
  const zOffset = item.z;
  const scaleX = width / primitiveSize;
  const scaleY = height / primitiveSize;
  const values = item.axis === "x"
    ? [
        scaleX, 0, 0, 0,
        0, 0, scaleY, 0,
        0, -1, 0, 0,
        left, -zOffset, top, 1,
      ]
    : item.axis === "y"
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

function directMatrix(item: DirectMatrixItem, primitiveSize: number): string {
  const { xAxis, yAxis, normal, tx, ty, tz } = voxelProjectiveBasis(item);
  const projective = computeProjectiveQuadMatrix(
    voxelScreenPts(item),
    xAxis,
    yAxis,
    normal,
    tx,
    ty,
    tz,
    VOXEL_PROJECTIVE_QUAD_GUARDS,
    voxelSeamEdgeAmounts(item),
  );
  return projective
    ? rescaleProjectiveMatrix(projective, primitiveSize) ?? affineVoxelMatrix(item, primitiveSize)
    : affineVoxelMatrix(item, primitiveSize);
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
  const itemFaces = new Set(directMatrixItems.map((item) => item.face));
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

  const elementBySourceIndex = new Map<number, BrushElement>();
  const hostByFace = new Map<PolyVoxelFace, FaceHostElement>();
  const faceOrderKeys = new Map<PolyVoxelFace, string>();
  const directMatrixItemsByFace = new Map<PolyVoxelFace, DirectMatrixItem[]>();
  for (const item of directMatrixItems) {
    let faceItems = directMatrixItemsByFace.get(item.face);
    if (!faceItems) {
      faceItems = [];
      directMatrixItemsByFace.set(item.face, faceItems);
    }
    faceItems.push(item);
  }
  let lastSignature = "";
  let mountedBrushCount = 0;
  let mountedFaces = new Set<PolyVoxelFace>();

  const brushForItem = (item: DirectMatrixItem): BrushElement => {
    let el = elementBySourceIndex.get(item.sourceIndex);
    if (!el) {
      el = doc.createElement("b") as BrushElement;
      elementBySourceIndex.set(item.sourceIndex, el);
      applyBrush(
        el,
        shadedColor(item.face, item.baseColor),
        directMatrix(item, primitiveSize),
      );
    }
    return el;
  };

  const hostForFace = (face: PolyVoxelFace): FaceHostElement => {
    let host = hostByFace.get(face);
    if (!host) {
      host = doc.createElement("span") as FaceHostElement;
      host.className = `polycss-voxel-face polycss-voxel-face-${face}`;
      host.dataset.polycssVoxelFace = face;
      host.__polycssVoxelFaceHost = true;
      hostByFace.set(face, host);
    }
    return host;
  };

  const firstPreservedChild = (): ChildNode | null => {
    for (const child of Array.from(wrapper.childNodes)) {
      if ((child as FaceHostElement).__polycssVoxelFaceHost) continue;
      return child;
    }
    return null;
  };

  const syncFaceHost = (face: PolyVoxelFace, items: readonly DirectMatrixItem[]): void => {
    const nextOrderKey = items.map((item) => item.sourceIndex).join(",");
    if (faceOrderKeys.get(face) === nextOrderKey) return;
    const host = hostForFace(face);
    const fragment = doc.createDocumentFragment();
    for (const item of items) fragment.appendChild(brushForItem(item));
    host.replaceChildren(fragment);
    faceOrderKeys.set(face, nextOrderKey);
  };

  const prebuildFaceHosts = (): void => {
    for (const face of FACE_ORDER) {
      if (!itemFaces.has(face)) continue;
      syncFaceHost(face, directMatrixItemsByFace.get(face) ?? []);
    }
  };

  const facesForSignature = (signature: string): Set<PolyVoxelFace> =>
    new Set(signature.split("|").filter(Boolean) as PolyVoxelFace[]);

  const faceOrderForSignature = (signature: string): PolyVoxelFace[] => {
    const visibleFaces = facesForSignature(signature);
    return FACE_ORDER.filter((face) => visibleFaces.has(face) && itemFaces.has(face));
  };

  const countBrushesForFaces = (faces: Iterable<PolyVoxelFace>): number => {
    let count = 0;
    for (const face of faces) count += directMatrixItemsByFace.get(face)?.length ?? 0;
    return count;
  };

  const itemsByFaceOrder = (
    orderedItems: readonly DirectMatrixItem[],
  ): { orderedFaces: PolyVoxelFace[]; itemsByFace: Map<PolyVoxelFace, DirectMatrixItem[]> } => {
    const seen = new Set<PolyVoxelFace>();
    const orderedFaces: PolyVoxelFace[] = [];
    const itemsByFace = new Map<PolyVoxelFace, DirectMatrixItem[]>();
    for (const item of orderedItems) {
      if (!seen.has(item.face)) {
        seen.add(item.face);
        orderedFaces.push(item.face);
      }
      let faceItems = itemsByFace.get(item.face);
      if (!faceItems) {
        faceItems = [];
        itemsByFace.set(item.face, faceItems);
      }
      faceItems.push(item);
    }
    return { orderedFaces, itemsByFace };
  };

  const mountFaceHosts = (orderedFaces: readonly PolyVoxelFace[], reorderMountedFaces: boolean): void => {
    const nextFaces = new Set(orderedFaces);
    for (const face of mountedFaces) {
      if (nextFaces.has(face)) continue;
      const host = hostByFace.get(face);
      if (host?.parentNode === wrapper) wrapper.removeChild(host);
    }

    if (reorderMountedFaces) {
      const fragment = doc.createDocumentFragment();
      for (const face of orderedFaces) fragment.appendChild(hostForFace(face));
      wrapper.insertBefore(fragment, firstPreservedChild());
      mountedFaces = nextFaces;
      return;
    }

    for (let i = 0; i < orderedFaces.length; i += 1) {
      const face = orderedFaces[i];
      const host = hostForFace(face);
      if (host.parentNode === wrapper) continue;
      let reference: ChildNode | null = null;
      for (let j = i + 1; j < orderedFaces.length; j += 1) {
        const nextHost = hostByFace.get(orderedFaces[j]);
        if (nextHost?.parentNode === wrapper) {
          reference = nextHost;
          break;
        }
      }
      wrapper.insertBefore(host, reference ?? firstPreservedChild());
    }
    mountedFaces = nextFaces;
  };

  const draw = (signature: string, rotation: CameraCullRotation, syncOrder: boolean): void => {
    if (!syncOrder) {
      const orderedFaces = faceOrderForSignature(signature);
      mountFaceHosts(orderedFaces, false);
      mountedBrushCount = countBrushesForFaces(orderedFaces);
      return;
    }

    const visibleFaces = new Set(signature.split("|").filter(Boolean) as PolyVoxelFace[]);
    const orderedItems = orderDirectMatrixItems(directMatrixItems, visibleFaces, rotation);
    const { orderedFaces, itemsByFace } = itemsByFaceOrder(orderedItems);

    for (const face of orderedFaces) {
      syncFaceHost(face, itemsByFace.get(face) ?? []);
    }
    mountFaceHosts(orderedFaces, true);
    mountedBrushCount = orderedItems.length;
  };

  prebuildFaceHosts();

  return {
    get brushCount() { return mountedBrushCount; },
    render(rotation: CameraCullRotation) {
      lastSignature = visibleFaceSignature(rotation);
      draw(lastSignature, rotation, true);
    },
    syncCamera(rotation: CameraCullRotation) {
      const nextSignature = visibleFaceSignature(rotation);
      if (nextSignature === lastSignature) return;
      lastSignature = nextSignature;
      draw(nextSignature, rotation, false);
    },
    dispose() {
      for (const host of hostByFace.values()) host.remove();
      wrapper.classList.remove("polycss-voxel-mesh");
      wrapper.style.removeProperty("--polycss-voxel-primitive");
      elementBySourceIndex.clear();
      hostByFace.clear();
      faceOrderKeys.clear();
      mountedBrushCount = 0;
      mountedFaces = new Set();
      lastSignature = "";
    },
  };
}
