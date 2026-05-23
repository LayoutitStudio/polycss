/**
 * Minimal glTF 2.0 / GLB loader — extracts triangle meshes (positions +
 * indices + per-material color) into polycss polygons. Also exposes a
 * lightweight animation sampler for node TRS animation and simple skinned
 * meshes. Skips PBR extras and morph targets: the goal is still to render
 * polycss polygons, not be a complete glTF runtime.
 *
 * Supports both .glb (binary container with magic "glTF") and .gltf (JSON
 * with separate .bin) — for .gltf the caller must supply the buffers via
 * the `resolveBuffer` callback.
 *
 * For each mesh primitive we:
 *   1. Read the POSITION accessor → Vec3[] of vertex positions.
 *   2. Read the indices accessor → triangle index array.
 *   3. Pick the material's pbrMetallicRoughness.baseColorFactor as a
 *      sRGB color, fall back to the override or palette if missing.
 *   4. Emit one triangle Polygon per (i, i+1, i+2).
 *
 * After parsing, the mesh is uniformly scaled to fit `targetSize` units
 * and the y/z axes are cyclically permuted (so glTF's +Y-up becomes
 * polycss's +Z-up without inverting handedness — a single y↔z swap would
 * flip every triangle's winding and break backface culling).
 */
import type {
  Polygon,
  PolyTextureAlphaMode,
  PolyTextureWrap,
  PolyTextureWrapMode,
  Vec2,
  Vec3,
} from "../types";
import type { ParseAnimationController, ParseAnimationClip, ParseResult } from "./types";

export interface GltfParseOptions {
  /** Largest mesh extent (units). Mesh is uniformly scaled to fit. Default 60. */
  targetSize?: number;
  /** Padding offset (avoids coordinate "0"). Default 1. */
  gridShift?: number;
  /** Color used when a primitive has no material or no baseColorFactor. */
  defaultColor?: string;
  /**
   * Override map: glTF material name → CSS color string. Falls back to the
   * material's `pbrMetallicRoughness.baseColorFactor` if not in this map.
   */
  materialColors?: Record<string, string>;
  /**
   * Override map: glTF material name → texture image URL. Takes priority over
   * `pbrMetallicRoughness.baseColorTexture`; useful for GLB/GLTF exports that
   * preserved UVs but dropped external image references.
   */
  materialTextures?: Record<string, string>;
  /**
   * Which axis is "up" in the source mesh.
   *  - "y" (default, glTF spec): cyclic permutation (x,y,z) → (z,x,y) so
   *    +Y ends up on polycss's +Z (elevation).
   *  - "z" (Blender-style, FBX2glTF often emits this): identity, no swap.
   * Pick "z" if the model lands on its side / lies down instead of
   * standing.
   */
  upAxis?: "y" | "z";
  /**
   * For .gltf (non-binary) — resolve a glTF buffer URI to its bytes. The
   * built-in parser handles GLB binary chunks natively; .gltf files with
   * external .bin files need this.
   */
  resolveBuffer?: (uri: string) => Promise<Uint8Array> | Uint8Array;
  /**
   * Base URL the source file lives at. Used to resolve external image URIs
   * (`doc.images[i].uri = "Textures/foo.png"`) against the GLB/glTF's
   * location. Without this, relative URIs would resolve against the page,
   * which 404s. Pass the same URL you fetched the file from.
   */
  baseUrl?: string;
}

const GLB_MAGIC = 0x46546c67; // "glTF" little-endian
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

const TYPE_COUNT: Record<string, number> = {
  SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16,
};

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  sparse?: {
    count: number;
    indices: {
      bufferView: number;
      byteOffset?: number;
      componentType: number;
    };
    values: {
      bufferView: number;
      byteOffset?: number;
    };
  };
}
interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}
interface GltfTextureInfo {
  index: number; // index into doc.textures[]
  texCoord?: number;
}
interface GltfMaterial {
  name?: string;
  doubleSided?: boolean;
  alphaMode?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    baseColorTexture?: GltfTextureInfo;
  };
}
interface GltfImage {
  uri?: string;
  bufferView?: number;
  mimeType?: string;
}
interface GltfTexture {
  source?: number; // index into doc.images[]
  sampler?: number; // index into doc.samplers[]
}
interface GltfSampler {
  wrapS?: number;
  wrapT?: number;
}
interface GltfPrimitive {
  attributes: { POSITION: number;[k: string]: number };
  indices?: number;
  material?: number;
  extensions?: Record<string, unknown>;
  /** glTF mode: 4 = TRIANGLES, 5 = TRIANGLE_STRIP, 6 = TRIANGLE_FAN. */
  mode?: number;
}
interface GltfMesh {
  name?: string;
  primitives: GltfPrimitive[];
}
interface GltfNode {
  name?: string;
  mesh?: number;
  skin?: number;
  children?: number[];
  /** TRS — polycss reads either matrix or these three components. */
  matrix?: number[];
  translation?: number[];
  rotation?: number[]; // quaternion (x, y, z, w)
  scale?: number[];
}
interface GltfSkin {
  joints: number[];
  inverseBindMatrices?: number;
  skeleton?: number;
  name?: string;
}
interface GltfAnimationSampler {
  input: number;
  output: number;
  interpolation?: "LINEAR" | "STEP" | "CUBICSPLINE" | string;
}
interface GltfAnimationChannel {
  sampler: number;
  target: {
    node?: number;
    path?: "translation" | "rotation" | "scale" | "weights" | string;
  };
}
interface GltfAnimation {
  name?: string;
  samplers?: GltfAnimationSampler[];
  channels?: GltfAnimationChannel[];
}
interface GltfScene {
  nodes?: number[];
}
interface GltfDoc {
  asset?: {
    version?: string;
    minVersion?: string;
  };
  extensionsRequired?: string[];
  extensionsUsed?: string[];
  scene?: number;
  scenes?: GltfScene[];
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  materials?: GltfMaterial[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: { byteLength: number; uri?: string }[];
  images?: GltfImage[];
  textures?: GltfTexture[];
  samplers?: GltfSampler[];
  skins?: GltfSkin[];
  animations?: GltfAnimation[];
}

function decodeUtf8(bytes: Uint8Array): string {
  const Decoder = (globalThis as unknown as { TextDecoder: new () => { decode: (a: Uint8Array) => string } }).TextDecoder;
  return new Decoder().decode(bytes);
}

/**
 * Decode a base64-encoded `data:` URI to bytes. glTF JSON files often embed
 * the buffer this way (`data:application/octet-stream;base64,...`).
 */
function dataUriToBytes(uri: string): Uint8Array {
  const comma = uri.indexOf(",");
  if (comma < 0) throw new Error("parseGltf: malformed data: URI");
  const meta = uri.slice(5, comma); // strip "data:"
  const payload = uri.slice(comma + 1);
  if (!meta.includes(";base64")) {
    const text = decodeURIComponent(payload);
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }
  const bin = (globalThis as unknown as { atob: (s: string) => string }).atob(payload);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseGlbContainer(buf: ArrayBuffer): { doc: GltfDoc; bin: Uint8Array | null } {
  const view = new DataView(buf);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("parseGltf: not a GLB (bad magic)");
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`parseGltf: only glTF v2 supported (got v${version})`);

  let offset = 12;
  let doc: GltfDoc | null = null;
  let bin: Uint8Array | null = null;
  while (offset < buf.byteLength) {
    const len = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === CHUNK_JSON) {
      const bytes = new Uint8Array(buf, start, len);
      doc = JSON.parse(decodeUtf8(bytes));
    } else if (type === CHUNK_BIN) {
      bin = new Uint8Array(buf, start, len);
    }
    offset = start + len;
  }
  if (!doc) throw new Error("parseGltf: no JSON chunk in GLB");
  return { doc, bin };
}

function parseVersionString(value: string | undefined): [number, number] | null {
  if (!value) return null;
  const match = /^(\d+)\.(\d+)(?:\D.*)?$/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function validateGltfAsset(doc: GltfDoc): void {
  const version = parseVersionString(doc.asset?.version);
  if (!version || version[0] !== 2) {
    throw new Error(`parseGltf: only glTF asset v2 supported (got ${doc.asset?.version ?? "missing"})`);
  }
  const minVersion = parseVersionString(doc.asset?.minVersion);
  if (doc.asset?.minVersion && (!minVersion || minVersion[0] > 2 || (minVersion[0] === 2 && minVersion[1] > 0))) {
    throw new Error(`parseGltf: glTF asset requires minVersion ${doc.asset.minVersion}`);
  }
}

function resolveBuffers(
  doc: GltfDoc,
  glbBin: Uint8Array | null,
  resolveBuffer?: (uri: string) => Uint8Array | Promise<Uint8Array>,
): Uint8Array[] {
  const specs = doc.buffers ?? [];
  return specs.map((buffer, index) => {
    const uri = buffer.uri;
    if (uri) {
      if (uri.startsWith("data:")) return dataUriToBytes(uri);
      if (resolveBuffer) {
        const result = resolveBuffer(uri);
        if (result instanceof Uint8Array) return result;
        throw new Error("parseGltf: resolveBuffer returned a Promise; use parseGltf via async if your buffers are external");
      }
      throw new Error(`parseGltf: external buffer URI "${uri}" — provide options.resolveBuffer`);
    }
    if (index === 0 && glbBin) return glbBin;
    throw new Error(`parseGltf: buffer[${index}] has no uri and no GLB BIN chunk`);
  });
}

function resolveBufferView(
  doc: GltfDoc,
  buffers: Uint8Array[],
  bufferViewIdx: number,
): { buffer: Uint8Array; view: GltfBufferView } {
  const view = doc.bufferViews?.[bufferViewIdx];
  const buffer = view ? buffers[view.buffer] : undefined;
  if (!view || !buffer) throw new Error(`parseGltf: bad bufferView ${bufferViewIdx}`);
  const offset = view.byteOffset ?? 0;
  if (offset < 0 || view.byteLength < 0 || offset + view.byteLength > buffer.byteLength) {
    throw new Error(`parseGltf: bufferView ${bufferViewIdx} outside buffer ${view.buffer}`);
  }
  return { buffer, view };
}

function assertAccessorFits(acc: GltfAccessor, view: GltfBufferView, stride: number, packedBytes: number): void {
  if (acc.count <= 0) return;
  const relativeOffset = acc.byteOffset ?? 0;
  const byteEnd = relativeOffset + stride * (acc.count - 1) + packedBytes;
  if (relativeOffset < 0 || byteEnd > view.byteLength) {
    throw new Error("parseGltf: accessor does not fit bufferView");
  }
}

type AccessorArray = Float32Array | Uint16Array | Uint32Array | Uint8Array | Int8Array | Int16Array;

function typedArrayFromValues(componentType: number, values: number[], normalized: boolean | undefined): AccessorArray {
  if (normalized || componentType === 5126) return new Float32Array(values);
  switch (componentType) {
    case 5120: return new Int8Array(values);
    case 5121: return new Uint8Array(values);
    case 5122: return new Int16Array(values);
    case 5123: return new Uint16Array(values);
    case 5125: return new Uint32Array(values);
    default: throw new Error(`parseGltf: unhandled componentType ${componentType}`);
  }
}

function readAccessor(doc: GltfDoc, buffers: Uint8Array[], accessorIdx: number): {
  array: AccessorArray;
  count: number;
  componentCount: number;
} {
  const acc = doc.accessors?.[accessorIdx];
  if (!acc) throw new Error(`parseGltf: bad accessor ${accessorIdx}`);
  const bytesPerComponent = COMPONENT_BYTES[acc.componentType];
  const componentCount = TYPE_COUNT[acc.type];
  if (!bytesPerComponent || !componentCount) {
    throw new Error(`parseGltf: unsupported accessor type ${acc.type}/${acc.componentType}`);
  }
  if (acc.sparse || acc.normalized || acc.bufferView === undefined) {
    const { values } = readAccessorComponents(doc, buffers, accessorIdx);
    return { array: typedArrayFromValues(acc.componentType, values, acc.normalized), count: acc.count, componentCount };
  }
  const { buffer: bin, view } = resolveBufferView(doc, buffers, acc.bufferView);
  const offset = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const elements = acc.count * componentCount;
  const packedBytes = bytesPerComponent * componentCount;
  const stride = view.byteStride ?? packedBytes;
  assertAccessorFits(acc, view, stride, packedBytes);

  if (stride === packedBytes) {
    const slice = bin.buffer.slice(
      bin.byteOffset + offset,
      bin.byteOffset + offset + elements * bytesPerComponent,
    );
    let array: AccessorArray;
    switch (acc.componentType) {
      case 5120: array = new Int8Array(slice); break;
      case 5121: array = new Uint8Array(slice); break;
      case 5122: array = new Int16Array(slice); break;
      case 5123: array = new Uint16Array(slice); break;
      case 5125: array = new Uint32Array(slice); break;
      case 5126: array = new Float32Array(slice); break;
      default: throw new Error(`parseGltf: unhandled componentType ${acc.componentType}`);
    }
    return { array, count: acc.count, componentCount };
  }

  let array: AccessorArray;
  switch (acc.componentType) {
    case 5120: array = new Int8Array(elements); break;
    case 5121: array = new Uint8Array(elements); break;
    case 5122: array = new Int16Array(elements); break;
    case 5123: array = new Uint16Array(elements); break;
    case 5125: array = new Uint32Array(elements); break;
    case 5126: array = new Float32Array(elements); break;
    default: throw new Error(`parseGltf: unhandled componentType ${acc.componentType}`);
  }

  const data = new DataView(bin.buffer);
  const start = bin.byteOffset + offset;
  let write = 0;
  for (let i = 0; i < acc.count; i++) {
    const elementOffset = start + i * stride;
    for (let c = 0; c < componentCount; c++) {
      array[write++] = readRawComponent(
        data,
        elementOffset + c * bytesPerComponent,
        acc.componentType,
      );
    }
  }
  return { array, count: acc.count, componentCount };
}

function readRawComponent(data: DataView, offset: number, componentType: number): number {
  switch (componentType) {
    case 5120: return data.getInt8(offset);
    case 5121: return data.getUint8(offset);
    case 5122: return data.getInt16(offset, true);
    case 5123: return data.getUint16(offset, true);
    case 5125: return data.getUint32(offset, true);
    case 5126: return data.getFloat32(offset, true);
    default: throw new Error(`parseGltf: unhandled componentType ${componentType}`);
  }
}

function normalizeComponent(value: number, componentType: number): number {
  switch (componentType) {
    case 5120: return Math.max(value / 127, -1);
    case 5121: return value / 255;
    case 5122: return Math.max(value / 32767, -1);
    case 5123: return value / 65535;
    default: return value;
  }
}

function readAccessorComponents(doc: GltfDoc, buffers: Uint8Array[], accessorIdx: number): {
  values: number[];
  count: number;
  componentCount: number;
} {
  const acc = doc.accessors?.[accessorIdx];
  if (!acc) throw new Error(`parseGltf: bad accessor ${accessorIdx}`);
  const bytesPerComponent = COMPONENT_BYTES[acc.componentType];
  const componentCount = TYPE_COUNT[acc.type];
  if (!bytesPerComponent || !componentCount) {
    throw new Error(`parseGltf: unsupported accessor type ${acc.type}/${acc.componentType}`);
  }
  const packedBytes = bytesPerComponent * componentCount;
  const values = new Array(acc.count * componentCount).fill(0);
  if (acc.bufferView !== undefined) {
    const { buffer, view } = resolveBufferView(doc, buffers, acc.bufferView);
    const start = buffer.byteOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const stride = view.byteStride ?? packedBytes;
    assertAccessorFits(acc, view, stride, packedBytes);
    const data = new DataView(buffer.buffer);
    let write = 0;
    for (let i = 0; i < acc.count; i++) {
      const elementOffset = start + i * stride;
      for (let c = 0; c < componentCount; c++) {
        const raw = readRawComponent(data, elementOffset + c * bytesPerComponent, acc.componentType);
        values[write++] = acc.normalized ? normalizeComponent(raw, acc.componentType) : raw;
      }
    }
  }
  if (acc.sparse) {
    const sparse = acc.sparse;
    const sparseIndices = sparse.indices;
    const sparseIndexBytes = COMPONENT_BYTES[sparseIndices.componentType];
    if (
      sparseIndices.componentType !== 5121 &&
      sparseIndices.componentType !== 5123 &&
      sparseIndices.componentType !== 5125
    ) {
      throw new Error(`parseGltf: unhandled sparse index componentType ${sparseIndices.componentType}`);
    }
    const { buffer: indexBuffer, view: indexView } = resolveBufferView(doc, buffers, sparseIndices.bufferView);
    const indexStart = indexBuffer.byteOffset + (indexView.byteOffset ?? 0) + (sparseIndices.byteOffset ?? 0);
    const indexData = new DataView(indexBuffer.buffer);
    const { buffer: valueBuffer, view: valueView } = resolveBufferView(doc, buffers, sparse.values.bufferView);
    const valueStart = valueBuffer.byteOffset + (valueView.byteOffset ?? 0) + (sparse.values.byteOffset ?? 0);
    const valueData = new DataView(valueBuffer.buffer);
    for (let i = 0; i < sparse.count; i++) {
      const targetIndex = readRawComponent(indexData, indexStart + i * sparseIndexBytes, sparseIndices.componentType);
      for (let c = 0; c < componentCount; c++) {
        const raw = readRawComponent(valueData, valueStart + (i * componentCount + c) * bytesPerComponent, acc.componentType);
        values[targetIndex * componentCount + c] = acc.normalized ? normalizeComponent(raw, acc.componentType) : raw;
      }
    }
  }
  return { values, count: acc.count, componentCount };
}

function extractImageUrls(
  doc: GltfDoc,
  buffers: Uint8Array[],
  baseUrl?: string,
): { urls: string[]; objectUrls: string[] } {
  const urls: string[] = [];
  const objectUrls: string[] = [];
  const g = globalThis as unknown as {
    Blob: new (parts: ArrayLike<number>[] | Uint8Array[], opts?: { type?: string }) => unknown;
    URL: { createObjectURL: (b: unknown) => string; new (u: string, base?: string): { href: string } };
  };
  for (const img of doc.images ?? []) {
    if (img.uri) {
      if (baseUrl && !img.uri.startsWith("data:")) {
        try {
          urls.push(new g.URL(img.uri, baseUrl).href);
        } catch {
          urls.push(img.uri);
        }
      } else {
        urls.push(img.uri);
      }
      continue;
    }
    if (img.bufferView !== undefined) {
      let bytes: Uint8Array;
      try {
        const { buffer, view } = resolveBufferView(doc, buffers, img.bufferView);
        const offset = view.byteOffset ?? 0;
        bytes = buffer.subarray(offset, offset + view.byteLength);
      } catch {
        urls.push("");
        continue;
      }
      const mime = img.mimeType ?? "image/png";
      const blob = new g.Blob([bytes], { type: mime });
      const url = g.URL.createObjectURL(blob);
      urls.push(url);
      objectUrls.push(url);
    } else {
      urls.push("");
    }
  }
  return { urls, objectUrls };
}

interface GltfMaterialTextureInfo {
  url: string;
  wrap: PolyTextureWrap;
  alphaMode: PolyTextureAlphaMode;
  texCoord: number;
}

function gltfWrapMode(value: number | undefined): PolyTextureWrapMode {
  switch (value ?? 10497) {
    case 33071: return "clamp-to-edge";
    case 33648: return "mirrored-repeat";
    case 10497: return "repeat";
    default: return "repeat";
  }
}

function textureWrapForTexture(doc: GltfDoc, texture: GltfTexture | undefined): PolyTextureWrap {
  const sampler = texture?.sampler !== undefined ? doc.samplers?.[texture.sampler] : undefined;
  return {
    s: gltfWrapMode(sampler?.wrapS),
    t: gltfWrapMode(sampler?.wrapT),
  };
}

function gltfAlphaMode(value: string | undefined): PolyTextureAlphaMode {
  switch (value) {
    case "BLEND": return "blend";
    case "MASK": return "mask";
    case "OPAQUE":
    default: return "opaque";
  }
}

function buildMaterialTextureMap(doc: GltfDoc, imageUrls: string[]): Map<number, GltfMaterialTextureInfo> {
  const out = new Map<number, GltfMaterialTextureInfo>();
  const mats = doc.materials ?? [];
  for (let i = 0; i < mats.length; i++) {
    const texIdx = mats[i].pbrMetallicRoughness?.baseColorTexture?.index;
    if (texIdx === undefined) continue;
    const texture = doc.textures?.[texIdx];
    const sourceIdx = texture?.source;
    if (sourceIdx === undefined) continue;
    const url = imageUrls[sourceIdx];
    if (url) {
      out.set(i, {
        url,
        wrap: textureWrapForTexture(doc, texture),
        alphaMode: gltfAlphaMode(mats[i].alphaMode),
        texCoord: mats[i].pbrMetallicRoughness?.baseColorTexture?.texCoord ?? 0,
      });
    }
  }
  return out;
}

function colorFromMaterial(
  mat: GltfMaterial | undefined,
  fallback: string,
  alphaMode: PolyTextureAlphaMode,
): string {
  const c = mat?.pbrMetallicRoughness?.baseColorFactor;
  if (!c || c.length < 3) return fallback;
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const toHex = (n: number) => Math.round(clamp01(n) * 255).toString(16).padStart(2, "0");
  const toByte = (n: number) => Math.round(clamp01(n) * 255);
  const alpha = alphaMode === "opaque" ? 1 : clamp01(c[3] ?? 1);
  return alpha < 1
    ? `rgba(${toByte(c[0])}, ${toByte(c[1])}, ${toByte(c[2])}, ${Math.round(alpha * 1000) / 1000})`
    : `#${toHex(c[0])}${toHex(c[1])}${toHex(c[2])}`;
}

// ── Node transform math ─────────────────────────────────────────────────

type Mat4 = number[]; // length 16, column-major like glTF

const IDENTITY4: Mat4 = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

function mulMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16) as Mat4;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8]  * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9]  * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function trsToMat4(t?: number[], r?: number[], s?: number[]): Mat4 {
  const tx = t?.[0] ?? 0, ty = t?.[1] ?? 0, tz = t?.[2] ?? 0;
  const qx = r?.[0] ?? 0, qy = r?.[1] ?? 0, qz = r?.[2] ?? 0, qw = r?.[3] ?? 1;
  const sx = s?.[0] ?? 1, sy = s?.[1] ?? 1, sz = s?.[2] ?? 1;

  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;

  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx,       (xz - wy) * sx,       0,
    (xy - wz) * sy,       (1 - (xx + zz)) * sy, (yz + wx) * sy,       0,
    (xz + wy) * sz,       (yz - wx) * sz,       (1 - (xx + yy)) * sz, 0,
    tx,                   ty,                   tz,                   1,
  ];
}

function nodeLocalMatrix(n: GltfNode): Mat4 {
  if (n.matrix && n.matrix.length === 16) return n.matrix.slice() as Mat4;
  return trsToMat4(n.translation, n.rotation, n.scale);
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scaleVec3(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function lerpArray(a: number[], b: number[], t: number): number[] {
  const out = new Array(Math.min(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

function normalizeQuat(q: number[]): number[] {
  const len = Math.hypot(q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 1) || 1;
  return [
    (q[0] ?? 0) / len,
    (q[1] ?? 0) / len,
    (q[2] ?? 0) / len,
    (q[3] ?? 1) / len,
  ];
}

function slerpQuat(aIn: number[], bIn: number[], t: number): number[] {
  const a = normalizeQuat(aIn);
  let b = normalizeQuat(bIn);
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (cos < 0) {
    cos = -cos;
    b = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (cos > 0.9995) return normalizeQuat(lerpArray(a, b, t));
  const theta = Math.acos(Math.max(-1, Math.min(1, cos)));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return normalizeQuat([
    a[0] * wa + b[0] * wb,
    a[1] * wa + b[1] * wb,
    a[2] * wa + b[2] * wb,
    a[3] * wa + b[3] * wb,
  ]);
}

interface NodePose {
  translation: number[];
  rotation: number[];
  scale: number[];
  matrix?: Mat4;
}

function poseFromNode(node: GltfNode | undefined): NodePose {
  return {
    translation: node?.translation?.slice() ?? [0, 0, 0],
    rotation: node?.rotation?.slice() ?? [0, 0, 0, 1],
    scale: node?.scale?.slice() ?? [1, 1, 1],
    matrix: node?.matrix && node.matrix.length === 16 ? node.matrix.slice() as Mat4 : undefined,
  };
}

function poseLocalMatrix(pose: NodePose): Mat4 {
  if (pose.matrix) return pose.matrix.slice() as Mat4;
  return trsToMat4(pose.translation, pose.rotation, pose.scale);
}

function collectSceneRoots(doc: GltfDoc): number[] {
  const sceneIdx = doc.scene ?? 0;
  const roots = doc.scenes?.[sceneIdx]?.nodes;
  if (roots && roots.length > 0) return roots;
  return [];
}

function computeWorldMatrices(doc: GltfDoc, localMatrices: Mat4[]): Mat4[] {
  const nodes = doc.nodes ?? [];
  const worlds: Mat4[] = new Array(nodes.length);
  const visited = new Set<number>();

  const walk = (nodeIdx: number, parentWorld: Mat4): void => {
    if (nodeIdx < 0 || nodeIdx >= nodes.length) return;
    const world = mulMat4(parentWorld, localMatrices[nodeIdx] ?? IDENTITY4);
    worlds[nodeIdx] = world;
    visited.add(nodeIdx);
    for (const child of nodes[nodeIdx].children ?? []) walk(child, world);
  };

  const roots = collectSceneRoots(doc);
  if (roots.length > 0) {
    for (const root of roots) walk(root, IDENTITY4);
  }
  for (let i = 0; i < nodes.length; i++) {
    if (!visited.has(i)) walk(i, IDENTITY4);
  }
  return worlds;
}

interface AnimatedPrimitiveSource {
  sourceIndex: number;
  meshNode: number | null;
  meshBindWorld: Mat4;
  skinIndex?: number;
  positions: Vec3[];
  indices: number[];
  triangleMask: boolean[];
  color: string;
  texture?: string;
  textureWrap?: PolyTextureWrap;
  textureAlphaMode?: PolyTextureAlphaMode;
  doubleSided?: boolean;
  uvs?: Vec2[];
  joints?: number[][];
  weights?: number[][];
}

interface RuntimeAnimationSampler {
  input: number[];
  output: number[];
  componentCount: number;
  interpolation: string;
}

interface RuntimeAnimationChannel {
  sampler: RuntimeAnimationSampler;
  targetNode: number;
  path: string;
}

interface RuntimeAnimationClip {
  info: ParseAnimationClip;
  channels: RuntimeAnimationChannel[];
}

interface AnimatedPolygonSourceRef {
  sourceIndex: number;
  triangleIndex: number;
}

interface RuntimeSourceTriangleMask {
  triangleMask: readonly boolean[];
  activeVertices: readonly number[];
}

interface GltfAnimationRuntimeInfo {
  withPolygonFilter(indices: readonly number[]): ParseAnimationController | undefined;
}

const GLTF_ANIMATION_RUNTIME_INFO = Symbol("polycss.gltfAnimationRuntimeInfo");
const POLY_ANIMATION_TRIANGLE_FRAME_SOURCE = Symbol.for("polycss.animation.triangleFrameSource");

interface PolyAnimationTriangleFrame {
  polygonCount: number;
  vertices: Float64Array;
  colors?: readonly (string | undefined)[];
  textureFlags?: readonly boolean[];
  solidTriangles?: boolean;
}

interface GltfAnimationController extends ParseAnimationController {
  [GLTF_ANIMATION_RUNTIME_INFO]?: GltfAnimationRuntimeInfo;
  [POLY_ANIMATION_TRIANGLE_FRAME_SOURCE]?: (
    clip: number | string,
    timeSeconds: number,
  ) => PolyAnimationTriangleFrame | null | undefined;
}

export function filterGltfAnimationController(
  animation: ParseAnimationController | undefined,
  indices: readonly number[],
): ParseAnimationController | undefined {
  return animation
    ? (animation as GltfAnimationController)[GLTF_ANIMATION_RUNTIME_INFO]?.withPolygonFilter(indices)
    : undefined;
}

function sameProjectedVertex(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function isDegenerateProjectedTriangle(v0: Vec3, v1: Vec3, v2: Vec3): boolean {
  return sameProjectedVertex(v0, v1) || sameProjectedVertex(v0, v2) || sameProjectedVertex(v1, v2);
}

function readAccessorTupleArray(
  doc: GltfDoc,
  buffers: Uint8Array[],
  accessorIdx: number | undefined,
  expectedComponents: number,
  expectedCount: number,
): number[][] | undefined {
  if (accessorIdx === undefined) return undefined;
  const { values, count, componentCount } = readAccessorComponents(doc, buffers, accessorIdx);
  if (count !== expectedCount || componentCount < 1) return undefined;
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    const tuple: number[] = [];
    for (let c = 0; c < expectedComponents; c++) {
      tuple.push(values[i * componentCount + c] ?? 0);
    }
    out.push(tuple);
  }
  return out;
}

function readMat4Array(doc: GltfDoc, buffers: Uint8Array[], accessorIdx: number | undefined, count: number): Mat4[] {
  if (accessorIdx === undefined) {
    return Array.from({ length: count }, () => IDENTITY4.slice() as Mat4);
  }
  const { values, componentCount, count: accCount } = readAccessorComponents(doc, buffers, accessorIdx);
  if (componentCount !== 16) {
    throw new Error(`parseGltf: inverseBindMatrices accessor ${accessorIdx} is not MAT4`);
  }
  const out: Mat4[] = [];
  for (let i = 0; i < count; i++) {
    const sourceIndex = Math.min(i, accCount - 1);
    out.push(values.slice(sourceIndex * 16, sourceIndex * 16 + 16) as Mat4);
  }
  return out;
}

function samplerValueAt(sampler: RuntimeAnimationSampler, keyIndex: number): number[] {
  const cc = sampler.componentCount;
  const base = sampler.interpolation === "CUBICSPLINE"
    ? (keyIndex * 3 + 1) * cc
    : keyIndex * cc;
  return sampler.output.slice(base, base + cc);
}

function sampleAnimationChannel(sampler: RuntimeAnimationSampler, timeSeconds: number, path: string): number[] {
  const times = sampler.input;
  if (times.length === 0) return [];
  if (times.length === 1 || timeSeconds <= times[0]) return samplerValueAt(sampler, 0);
  const lastIndex = times.length - 1;
  if (timeSeconds >= times[lastIndex]) return samplerValueAt(sampler, lastIndex);

  let lo = 0;
  let hi = lastIndex;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= timeSeconds) lo = mid;
    else hi = mid;
  }

  const t0 = times[lo];
  const t1 = times[lo + 1];
  const amount = t1 > t0 ? (timeSeconds - t0) / (t1 - t0) : 0;
  const a = samplerValueAt(sampler, lo);
  const b = samplerValueAt(sampler, lo + 1);
  if (sampler.interpolation === "STEP") return a;
  if (path === "rotation") return slerpQuat(a, b, amount);
  return lerpArray(a, b, amount);
}

function buildAnimationController(
  doc: GltfDoc,
  buffers: Uint8Array[],
  sources: AnimatedPrimitiveSource[],
  polygonRefs: Array<AnimatedPolygonSourceRef | undefined>,
  project: (v: Vec3) => Vec3,
  projectFrameVertex: (v: Vec3, out: Float64Array, offset: number) => void,
): ParseAnimationController | undefined {
  const animations = doc.animations ?? [];
  if (animations.length === 0 || sources.length === 0) return undefined;

  const basePoses = (doc.nodes ?? []).map((node) => poseFromNode(node));
  const baseLocalMatrices = basePoses.map(poseLocalMatrix);
  const bindWorldMatrices = computeWorldMatrices(doc, baseLocalMatrices);
  const skins = (doc.skins ?? []).map((skin) => ({
    joints: skin.joints ?? [],
    inverseBindMatrices: readMat4Array(doc, buffers, skin.inverseBindMatrices, skin.joints?.length ?? 0),
  }));

  const runtimeClips: RuntimeAnimationClip[] = [];
  for (let i = 0; i < animations.length; i++) {
    const animation = animations[i];
    const runtimeSamplers = (animation.samplers ?? []).map((sampler): RuntimeAnimationSampler => {
      const input = readAccessorComponents(doc, buffers, sampler.input);
      const output = readAccessorComponents(doc, buffers, sampler.output);
      return {
        input: input.values,
        output: output.values,
        componentCount: output.componentCount,
        interpolation: sampler.interpolation ?? "LINEAR",
      };
    });

    const channels: RuntimeAnimationChannel[] = [];
    for (const channel of animation.channels ?? []) {
      const targetNode = channel.target.node;
      const path = channel.target.path;
      const sampler = runtimeSamplers[channel.sampler];
      if (targetNode === undefined || !path || !sampler || path === "weights") continue;
      channels.push({ sampler, targetNode, path });
    }
    const duration = channels.reduce((max, channel) => {
      const times = channel.sampler.input;
      return Math.max(max, times[times.length - 1] ?? 0);
    }, 0);
    runtimeClips.push({
      info: {
        index: i,
        name: animation.name ?? `animation_${i}`,
        duration,
        channelCount: channels.length,
      },
      channels,
    });
  }

  const clips = runtimeClips.map((clip) => clip.info);
  if (clips.length === 0) return undefined;

  const sourceMasksFromPolygonFilter = (
    indices: readonly number[],
  ): RuntimeSourceTriangleMask[] | undefined => {
    const masks = sources.map((source) => new Array(source.triangleMask.length).fill(false));
    for (const index of indices) {
      const ref = polygonRefs[index];
      if (!ref) return undefined;
      const sourceMask = masks[ref.sourceIndex];
      if (!sourceMask || ref.triangleIndex < 0 || ref.triangleIndex >= sourceMask.length) return undefined;
      sourceMask[ref.triangleIndex] = true;
    }

    return masks.map((triangleMask, sourceIndex): RuntimeSourceTriangleMask => {
      const source = sources[sourceIndex]!;
      const used = new Set<number>();
      let triangleOrdinal = 0;
      for (let i = 0; i + 2 < source.indices.length; i += 3, triangleOrdinal++) {
        if (!triangleMask[triangleOrdinal]) continue;
        used.add(source.indices[i]!);
        used.add(source.indices[i + 1]!);
        used.add(source.indices[i + 2]!);
      }
      return {
        triangleMask,
        activeVertices: Array.from(used).sort((a, b) => a - b),
      };
    });
  };

  const polygonFromWorldTri = (
    v0World: Vec3,
    v1World: Vec3,
    v2World: Vec3,
    color: string,
    texture: string | undefined,
    textureWrap: PolyTextureWrap | undefined,
    textureAlphaMode: PolyTextureAlphaMode | undefined,
    doubleSided: boolean | undefined,
    uvs: Vec2[] | undefined,
  ): Polygon | null => {
    const v0 = project(v0World);
    const v1 = project(v1World);
    const v2 = project(v2World);
    const polygon: Polygon = { vertices: [v0, v1, v2], color };
    if (texture) polygon.texture = texture;
    if (texture && textureWrap) polygon.textureWrap = textureWrap;
    if (texture && textureAlphaMode) polygon.textureAlphaMode = textureAlphaMode;
    if (doubleSided) polygon.doubleSided = true;
    if (uvs) polygon.uvs = uvs;
    return polygon;
  };

  const createController = (
    sourceMaskOverrides?: RuntimeSourceTriangleMask[],
  ): ParseAnimationController => {
    const activeTriangleCapacity = sources.reduce((sum, source, sourceIndex) => {
      const mask = sourceMaskOverrides?.[sourceIndex]?.triangleMask ?? source.triangleMask;
      let count = 0;
      for (let i = 0; i < mask.length; i++) {
        if (mask[i]) count++;
      }
      return sum + count;
    }, 0);
    let triangleFrameVertices = new Float64Array(Math.max(0, activeTriangleCapacity * 9));
    let triangleFrameColors: Array<string | undefined> = new Array(activeTriangleCapacity);
    let triangleFrameTextureFlags: boolean[] = new Array(activeTriangleCapacity).fill(false);
    const triangleFrame: PolyAnimationTriangleFrame = {
      polygonCount: 0,
      vertices: triangleFrameVertices,
      colors: triangleFrameColors,
      textureFlags: triangleFrameTextureFlags,
      solidTriangles: true,
    };

    const sampleWorldMatrices = (clipRef: number | string, timeSecondsIn: number): Mat4[] | null => {
      const clip = typeof clipRef === "number"
        ? runtimeClips[clipRef]
        : runtimeClips.find((candidate) => candidate.info.name === clipRef);
      if (!clip) return null;
      const duration = clip.info.duration;
      const timeSeconds = duration > 0
        ? ((timeSecondsIn % duration) + duration) % duration
        : Math.max(0, timeSecondsIn);

      const poses = basePoses.map((pose): NodePose => ({
        translation: pose.translation.slice(),
        rotation: pose.rotation.slice(),
        scale: pose.scale.slice(),
        matrix: pose.matrix ? pose.matrix.slice() as Mat4 : undefined,
      }));

      for (const channel of clip.channels) {
        const pose = poses[channel.targetNode];
        if (!pose) continue;
        const value = sampleAnimationChannel(channel.sampler, timeSeconds, channel.path);
        // Animated TRS channels override matrix-based locals per glTF's node
        // animation model; converting arbitrary matrices to TRS is intentionally
        // out of scope for this minimal runtime.
        pose.matrix = undefined;
        if (channel.path === "translation") pose.translation = value.slice(0, 3);
        else if (channel.path === "rotation") pose.rotation = normalizeQuat(value.slice(0, 4));
        else if (channel.path === "scale") pose.scale = value.slice(0, 3);
      }

      return computeWorldMatrices(doc, poses.map(poseLocalMatrix));
    };

    const computeSourceWorldPositions = (
      source: AnimatedPrimitiveSource,
      sourceMask: RuntimeSourceTriangleMask | undefined,
      worldMatrices: Mat4[],
    ): Array<Vec3 | undefined> => {
      const activeVertices = sourceMask?.activeVertices;
      const worldPositions: Array<Vec3 | undefined> = new Array(source.positions.length);
      if (
        source.skinIndex !== undefined &&
        source.joints &&
        source.weights &&
        skins[source.skinIndex]
      ) {
        const skin = skins[source.skinIndex];
        const sourceJoints = source.joints;
        const sourceWeights = source.weights;
        const skinVertex = (i: number): void => {
          const bindPosition = source.positions[i];
          let blended: Vec3 = [0, 0, 0];
          let weightSum = 0;
          const joints = sourceJoints[i] ?? [];
          const weights = sourceWeights[i] ?? [];
          for (let j = 0; j < 4; j++) {
            const weight = weights[j] ?? 0;
            if (weight <= 0) continue;
            const jointSlot = Math.round(joints[j] ?? 0);
            const jointNode = skin.joints[jointSlot];
            const jointWorld = worldMatrices[jointNode];
            const inverseBind = skin.inverseBindMatrices[jointSlot];
            if (!jointWorld || !inverseBind) continue;
            const jointMatrix = mulMat4(jointWorld, inverseBind);
            blended = addVec3(blended, scaleVec3(transformPoint(jointMatrix, bindPosition), weight));
            weightSum += weight;
          }
          worldPositions[i] = weightSum > 0
            ? scaleVec3(blended, 1 / weightSum)
            : transformPoint(source.meshBindWorld, bindPosition);
        };
        if (activeVertices) {
          for (const vertexIndex of activeVertices) skinVertex(vertexIndex);
        } else {
          for (let i = 0; i < source.positions.length; i++) skinVertex(i);
        }
      } else {
        const meshWorld = source.meshNode !== null
          ? (worldMatrices[source.meshNode] ?? source.meshBindWorld)
          : source.meshBindWorld;
        const transformVertex = (i: number): void => {
          worldPositions[i] = transformPoint(meshWorld, source.positions[i]);
        };
        if (activeVertices) {
          for (const vertexIndex of activeVertices) transformVertex(vertexIndex);
        } else {
          for (let i = 0; i < source.positions.length; i++) transformVertex(i);
        }
      }
      return worldPositions;
    };

    const sample = (clipRef: number | string, timeSecondsIn: number): Polygon[] => {
      const worldMatrices = sampleWorldMatrices(clipRef, timeSecondsIn);
      if (!worldMatrices) return [];
      const polygons: Polygon[] = [];

      for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
        const source = sources[sourceIndex]!;
        const sourceMask = sourceMaskOverrides?.[sourceIndex];
        const triangleMask = sourceMask?.triangleMask ?? source.triangleMask;
        const worldPositions = computeSourceWorldPositions(source, sourceMask, worldMatrices);

        let triangleOrdinal = 0;
        for (let i = 0; i + 2 < source.indices.length; i += 3, triangleOrdinal++) {
          if (!triangleMask[triangleOrdinal]) continue;
          const i0 = source.indices[i];
          const i1 = source.indices[i + 1];
          const i2 = source.indices[i + 2];
          const v0 = worldPositions[i0];
          const v1 = worldPositions[i1];
          const v2 = worldPositions[i2];
          if (!v0 || !v1 || !v2) continue;
          let triUvs: Vec2[] | undefined;
          if (source.uvs && source.texture) {
            const u0 = source.uvs[i0], u1 = source.uvs[i1], u2 = source.uvs[i2];
            if (u0 && u1 && u2) triUvs = [u0, u1, u2];
          }
          const polygon = polygonFromWorldTri(
            v0,
            v1,
            v2,
            source.color,
            source.texture,
            source.textureWrap,
            source.textureAlphaMode,
            source.doubleSided,
            triUvs,
          );
          if (polygon) polygons.push(polygon);
        }
      }
      return polygons;
    };

    const sampleTriangleFrame = (
      clipRef: number | string,
      timeSecondsIn: number,
    ): PolyAnimationTriangleFrame | null => {
      const worldMatrices = sampleWorldMatrices(clipRef, timeSecondsIn);
      if (!worldMatrices) return null;
      if (triangleFrameVertices.length < activeTriangleCapacity * 9) {
        triangleFrameVertices = new Float64Array(activeTriangleCapacity * 9);
        triangleFrame.vertices = triangleFrameVertices;
      }
      if (triangleFrameColors.length < activeTriangleCapacity) {
        triangleFrameColors = new Array(activeTriangleCapacity);
        triangleFrame.colors = triangleFrameColors;
      }
      if (triangleFrameTextureFlags.length < activeTriangleCapacity) {
        triangleFrameTextureFlags = new Array(activeTriangleCapacity).fill(false);
        triangleFrame.textureFlags = triangleFrameTextureFlags;
      }
      let polygonCount = 0;
      let writeOffset = 0;
      let hasTexture = false;

      for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
        const source = sources[sourceIndex]!;
        const sourceMask = sourceMaskOverrides?.[sourceIndex];
        const triangleMask = sourceMask?.triangleMask ?? source.triangleMask;
        const worldPositions = computeSourceWorldPositions(source, sourceMask, worldMatrices);

        let triangleOrdinal = 0;
        for (let i = 0; i + 2 < source.indices.length; i += 3, triangleOrdinal++) {
          if (!triangleMask[triangleOrdinal]) continue;
          const i0 = source.indices[i]!;
          const i1 = source.indices[i + 1]!;
          const i2 = source.indices[i + 2]!;
          const v0 = worldPositions[i0];
          const v1 = worldPositions[i1];
          const v2 = worldPositions[i2];
          if (!v0 || !v1 || !v2) continue;
          projectFrameVertex(v0, triangleFrameVertices, writeOffset);
          projectFrameVertex(v1, triangleFrameVertices, writeOffset + 3);
          projectFrameVertex(v2, triangleFrameVertices, writeOffset + 6);
          triangleFrameColors[polygonCount] = source.color;
          const textured = !!source.texture;
          triangleFrameTextureFlags[polygonCount] = textured;
          if (textured) hasTexture = true;
          polygonCount++;
          writeOffset += 9;
        }
      }

      triangleFrame.polygonCount = polygonCount;
      triangleFrame.solidTriangles = !hasTexture;
      return triangleFrame;
    };

    const controller: GltfAnimationController = { clips, sample };
    controller[POLY_ANIMATION_TRIANGLE_FRAME_SOURCE] = sampleTriangleFrame;
    controller[GLTF_ANIMATION_RUNTIME_INFO] = {
      withPolygonFilter(indices) {
        const masks = sourceMasksFromPolygonFilter(indices);
        return masks ? createController(masks) : undefined;
      },
    };
    return controller;
  };

  return createController();
}

export function parseGltf(input: ArrayBuffer | Uint8Array, options?: GltfParseOptions): ParseResult {
  const targetSize = options?.targetSize ?? 60;
  const gridShift = options?.gridShift ?? 1;
  const defaultColor = options?.defaultColor ?? "#888888";
  const materialOverrides = options?.materialColors ?? {};
  const materialTextureOverrides = options?.materialTextures ?? {};

  const buf: ArrayBuffer = input instanceof Uint8Array
    ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer
    : input;
  const sourceBytes = buf.byteLength;

  let doc: GltfDoc;
  let glbBin: Uint8Array | null = null;
  if (buf.byteLength >= 4 && new DataView(buf).getUint32(0, true) === GLB_MAGIC) {
    const parsed = parseGlbContainer(buf);
    doc = parsed.doc;
    glbBin = parsed.bin;
  } else {
    doc = JSON.parse(decodeUtf8(new Uint8Array(buf)));
  }
  validateGltfAsset(doc);
  const buffers = resolveBuffers(doc, glbBin, options?.resolveBuffer);

  const { urls: imageUrls, objectUrls } = extractImageUrls(doc, buffers, options?.baseUrl);
  const matTexMap = buildMaterialTextureMap(doc, imageUrls);
  const warnings: string[] = [];
  const warningKeys = new Set<string>();
  const requiredExtensions = new Set(doc.extensionsRequired ?? []);

  function pushWarningOnce(key: string, warning: string): void {
    if (warningKeys.has(key)) return;
    warningKeys.add(key);
    warnings.push(warning);
  }

  interface RawTri {
    v0: Vec3;
    v1: Vec3;
    v2: Vec3;
    color: string;
    texture?: string;
    textureWrap?: PolyTextureWrap;
    textureAlphaMode?: PolyTextureAlphaMode;
    doubleSided?: boolean;
    uvs?: Vec2[];
    source?: AnimatedPrimitiveSource;
    sourceIndex?: number;
    sourceTriangleIndex?: number;
  }
  const rawTris: RawTri[] = [];
  const animatedSources: AnimatedPrimitiveSource[] = [];
  const animatedPolygonRefs: Array<AnimatedPolygonSourceRef | undefined> = [];
  const meshNames: string[] = (doc.meshes ?? []).map((m, i) => m.name ?? `mesh_${i}`);
  const materialNames: string[] = (doc.materials ?? []).map((m, i) => m.name ?? `material_${i}`);

  function triangulatePrimitiveIndices(indices: number[], mode: number): number[] {
    if (mode === 4) return indices;
    const out: number[] = [];
    if (mode === 5) {
      for (let i = 0; i + 2 < indices.length; i++) {
        out.push(indices[i], indices[i + 1 + (i % 2)], indices[i + 2 - (i % 2)]);
      }
    } else if (mode === 6) {
      for (let i = 0; i + 2 < indices.length; i++) {
        out.push(indices[i + 1], indices[i + 2], indices[0]);
      }
    }
    return out;
  }

  function makeDoubleSidedTriangleIndices(indices: number[]): number[] {
    const out: number[] = [];
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const i0 = indices[i];
      const i1 = indices[i + 1];
      const i2 = indices[i + 2];
      out.push(i0, i1, i2, i0, i2, i1);
    }
    return out;
  }

  function emitMesh(meshIdx: number, world: Mat4, meshNode: number | null): void {
    const mesh = doc.meshes?.[meshIdx];
    if (!mesh) return;
    for (const prim of mesh.primitives) {
      const mode = prim.mode ?? 4;
      if (mode !== 4 && mode !== 5 && mode !== 6) continue;
      if (prim.extensions?.KHR_draco_mesh_compression && requiredExtensions.has("KHR_draco_mesh_compression")) {
        pushWarningOnce(
          "KHR_draco_mesh_compression",
          "Skipped primitives with unsupported required extension KHR_draco_mesh_compression",
        );
        continue;
      }
      if (prim.attributes.POSITION === undefined) {
        pushWarningOnce(
          `missing-position:${meshIdx}`,
          `Mesh ${mesh.name ?? meshIdx}: skipped primitive without POSITION attribute`,
        );
        continue;
      }

      const material = prim.material !== undefined ? doc.materials?.[prim.material] : undefined;
      const materialAlphaMode = gltfAlphaMode(material?.alphaMode);
      const matName = material?.name;
      const matOverride = matName ? materialOverrides[matName] : undefined;
      const color = matOverride ?? colorFromMaterial(
        material,
        defaultColor,
        materialAlphaMode,
      );
      const doubleSided = material?.doubleSided === true;
      const materialTextureInfo = prim.material !== undefined ? matTexMap.get(prim.material) : undefined;
      const texture = matName && materialTextureOverrides[matName]
        ? materialTextureOverrides[matName]
        : prim.material !== undefined
          ? materialTextureInfo?.url
          : undefined;
      const textureWrap = texture && prim.material !== undefined
        ? materialTextureInfo?.wrap
        : undefined;
      const textureAlphaMode = texture
        ? materialTextureInfo?.alphaMode ?? materialAlphaMode
        : undefined;
      const textureTexCoord = texture ? materialTextureInfo?.texCoord ?? 0 : 0;

      const { array: posArr, count: vertCount } = readAccessor(doc, buffers, prim.attributes.POSITION);
      if (!(posArr instanceof Float32Array)) continue;
      const localPositions: Vec3[] = [];
      const positions: Vec3[] = [];
      for (let i = 0; i < vertCount; i++) {
        const local: Vec3 = [posArr[i * 3], posArr[i * 3 + 1], posArr[i * 3 + 2]];
        localPositions.push(local);
        positions.push(transformPoint(world, local));
      }

      let uvs: Vec2[] | null = null;
      const uvAccIdx = prim.attributes[`TEXCOORD_${textureTexCoord}`];
      if (texture && uvAccIdx !== undefined) {
        const { array: uvArr, count: uvCount } = readAccessor(doc, buffers, uvAccIdx);
        uvs = [];
        let scale = 1;
        if (uvArr instanceof Uint8Array) scale = 1 / 255;
        else if (uvArr instanceof Uint16Array) scale = 1 / 65535;
        for (let i = 0; i < uvCount; i++) {
          const u = uvArr[i * 2] * scale;
          const v = uvArr[i * 2 + 1] * scale;
          uvs.push([u, 1 - v]);
        }
      }

      let indices: number[];
      if (prim.indices !== undefined) {
        const { array: idxArr, count: idxCount } = readAccessor(doc, buffers, prim.indices);
        indices = [];
        for (let i = 0; i < idxCount; i++) indices.push(Number(idxArr[i]));
      } else {
        indices = positions.map((_, i) => i);
      }
      indices = triangulatePrimitiveIndices(indices, mode);
      if (doubleSided) indices = makeDoubleSidedTriangleIndices(indices);

      let animatedSource: AnimatedPrimitiveSource | undefined;
      if ((doc.animations?.length ?? 0) > 0) {
        const joints = readAccessorTupleArray(doc, buffers, prim.attributes.JOINTS_0, 4, vertCount);
        const weights = readAccessorTupleArray(doc, buffers, prim.attributes.WEIGHTS_0, 4, vertCount);
        animatedSource = {
          sourceIndex: animatedSources.length,
          meshNode,
          meshBindWorld: world,
          skinIndex: meshNode !== null ? doc.nodes?.[meshNode]?.skin : undefined,
          positions: localPositions,
          indices,
          triangleMask: [],
          color,
          texture,
          textureWrap,
          textureAlphaMode,
          doubleSided,
          uvs: uvs ?? undefined,
          joints,
          weights,
        };
        animatedSources.push(animatedSource);
      }

      for (let i = 0; i + 2 < indices.length; i += 3) {
        const sourceTriangleIndex = animatedSource ? animatedSource.triangleMask.length : undefined;
        if (animatedSource) animatedSource.triangleMask.push(false);
        const v0 = positions[indices[i]];
        const v1 = positions[indices[i + 1]];
        const v2 = positions[indices[i + 2]];
        if (!v0 || !v1 || !v2) continue;
        let triUvs: Vec2[] | undefined;
        if (uvs && texture) {
          const u0 = uvs[indices[i]], u1 = uvs[indices[i + 1]], u2 = uvs[indices[i + 2]];
          if (u0 && u1 && u2) triUvs = [u0, u1, u2];
        }
        rawTris.push({
          v0,
          v1,
          v2,
          color,
          texture,
          textureWrap,
          textureAlphaMode,
          doubleSided,
          uvs: triUvs,
          source: animatedSource,
          sourceIndex: animatedSource?.sourceIndex,
          sourceTriangleIndex,
        });
      }
    }
  }

  function walkNode(nodeIdx: number, parentWorld: Mat4): void {
    const node = doc.nodes?.[nodeIdx];
    if (!node) return;
    const world = mulMat4(parentWorld, nodeLocalMatrix(node));
    if (typeof node.mesh === "number") emitMesh(node.mesh, world, nodeIdx);
    for (const child of node.children ?? []) walkNode(child, world);
  }

  const sceneIdx = doc.scene ?? 0;
  const sceneRoots = doc.scenes?.[sceneIdx]?.nodes;
  if (sceneRoots && sceneRoots.length > 0) {
    for (const r of sceneRoots) walkNode(r, IDENTITY4);
  } else {
    for (let i = 0; i < (doc.meshes?.length ?? 0); i++) emitMesh(i, IDENTITY4, null);
  }

  const dispose = makeDispose(objectUrls);

  if (rawTris.length === 0) {
    return {
      polygons: [],
      objectUrls,
      dispose,
      warnings,
      metadata: {
        triangleCount: 0,
        meshes: meshNames,
        materials: materialNames,
        sourceBytes,
      },
    };
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of rawTris) {
    for (const v of [t.v0, t.v1, t.v2]) {
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
  }
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const scale = maxDim > 0 ? targetSize / maxDim : 1;

  const round = (n: number) => Math.round(n * 1000) / 1000;
  const upAxis = options?.upAxis ?? "y";
  const project: (v: Vec3) => Vec3 = upAxis === "z"
    ? ([x, y, z]) => [
        round((x - minX) * scale + gridShift),
        round((y - minY) * scale + gridShift),
        round((z - minZ) * scale + gridShift),
      ]
    : ([x, y, z]) => [
        round((z - minZ) * scale + gridShift),
        round((x - minX) * scale + gridShift),
        round((y - minY) * scale + gridShift),
      ];
  const projectFrameVertex = upAxis === "z"
    ? (v: Vec3, out: Float64Array, offset: number): void => {
        out[offset] = round((v[0] - minX) * scale + gridShift);
        out[offset + 1] = round((v[1] - minY) * scale + gridShift);
        out[offset + 2] = round((v[2] - minZ) * scale + gridShift);
      }
    : (v: Vec3, out: Float64Array, offset: number): void => {
        out[offset] = round((v[2] - minZ) * scale + gridShift);
        out[offset + 1] = round((v[0] - minX) * scale + gridShift);
        out[offset + 2] = round((v[1] - minY) * scale + gridShift);
      };
  const polygons: Polygon[] = [];
  for (const t of rawTris) {
    const v0 = project(t.v0);
    const v1 = project(t.v1);
    const v2 = project(t.v2);
    const degenerate = isDegenerateProjectedTriangle(v0, v1, v2);
    if (t.source && t.sourceTriangleIndex !== undefined) {
      t.source.triangleMask[t.sourceTriangleIndex] = !degenerate;
    }
    if (degenerate) continue;
    const p: Polygon = {
      vertices: [v0, v1, v2],
      color: t.color,
    };
    if (t.texture) p.texture = t.texture;
    if (t.texture && t.textureWrap) p.textureWrap = t.textureWrap;
    if (t.texture && t.textureAlphaMode) p.textureAlphaMode = t.textureAlphaMode;
    if (t.doubleSided) p.doubleSided = true;
    if (t.uvs) p.uvs = t.uvs;
    polygons.push(p);
    animatedPolygonRefs.push(
      t.sourceIndex !== undefined && t.sourceTriangleIndex !== undefined
        ? { sourceIndex: t.sourceIndex, triangleIndex: t.sourceTriangleIndex }
        : undefined,
    );
  }
  const animation = buildAnimationController(
    doc,
    buffers,
    animatedSources,
    animatedPolygonRefs,
    project,
    projectFrameVertex,
  );

  return {
    polygons,
    animation,
    objectUrls,
    dispose,
    warnings,
    metadata: {
      triangleCount: polygons.length,
      meshes: meshNames,
      materials: materialNames,
      animations: animation?.clips,
      sourceBytes,
    },
  };
}

/**
 * Build an idempotent disposer that revokes each minted blob URL exactly
 * once. Subsequent calls are no-ops, so component unmount paths can call
 * `dispose()` defensively without worrying about double-revoke errors.
 */
function makeDispose(objectUrls: string[]): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const URL = (globalThis as unknown as { URL?: { revokeObjectURL?: (url: string) => void } }).URL;
    if (!URL?.revokeObjectURL) return;
    for (const url of objectUrls) {
      try { URL.revokeObjectURL(url); } catch { /* swallow — best effort */ }
    }
  };
}
