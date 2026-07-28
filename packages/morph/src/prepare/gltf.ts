import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { PolyMorphMat4, PolyMorphVec3 } from "../contracts/index.js";
import { failPolyMorphPrepare } from "./error.js";
import type {
  PolyMorphGltfDocument,
  PolyMorphGltfInstance,
  PolyMorphGltfMaterial,
  PolyMorphGltfPrimitive,
} from "./types.js";

type JsonObject = Record<string, any>;

const COMPONENT_COUNTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

const COMPONENT_BYTES: Readonly<Record<number, number>> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJson(bytes: Uint8Array, path: string): JsonObject {
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      failPolyMorphPrepare("invalid-gltf", path, "expected a JSON object");
    }
    return value as JsonObject;
  } catch (error) {
    if (error instanceof Error && error.name === "PolyMorphPrepareError") throw error;
    failPolyMorphPrepare("invalid-gltf", path, "expected UTF-8 JSON");
  }
}

function decodeGlb(bytes: Uint8Array): {
  readonly json: JsonObject;
  readonly binary: Uint8Array | null;
} {
  if (bytes.byteLength < 20) {
    failPolyMorphPrepare("invalid-glb", "$.source", "GLB is truncated");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67
    || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== bytes.byteLength
  ) {
    failPolyMorphPrepare("invalid-glb", "$.source", "invalid GLB header");
  }
  let offset = 12;
  let json: JsonObject | null = null;
  let binary: Uint8Array | null = null;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      failPolyMorphPrepare("invalid-glb", "$.source", "truncated GLB chunk header");
    }
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (length % 4 !== 0 || end > bytes.byteLength) {
      failPolyMorphPrepare("invalid-glb", "$.source", "invalid GLB chunk bounds");
    }
    if (type === 0x4e4f534a) {
      if (json) {
        failPolyMorphPrepare("invalid-glb", "$.source", "duplicate JSON chunk");
      }
      json = parseJson(bytes.subarray(start, end), "$.source.json");
    } else if (type === 0x004e4942) {
      if (binary) {
        failPolyMorphPrepare("invalid-glb", "$.source", "duplicate binary chunk");
      }
      binary = bytes.subarray(start, end);
    } else {
      failPolyMorphPrepare(
        "invalid-glb",
        "$.source",
        `unsupported GLB chunk type ${type}`,
      );
    }
    offset = end;
  }
  if (!json) {
    failPolyMorphPrepare("invalid-glb", "$.source", "missing JSON chunk");
  }
  return { json, binary };
}

function normalizedRelativePath(value: unknown, path: string): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || isAbsolute(value)
    || value.includes("\\")
    || value.includes("?")
    || value.includes("#")
    || value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    failPolyMorphPrepare(
      "unsafe-path",
      path,
      "expected a normalized source-relative path",
    );
  }
  return value;
}

function dataUriBytes(uri: string, path: string): Uint8Array {
  const match = /^data:application\/(?:octet-stream|gltf-buffer);base64,([A-Za-z0-9+/]*={0,2})$/u.exec(uri);
  if (!match) {
    failPolyMorphPrepare(
      "unsupported-uri",
      path,
      "expected a base64 glTF buffer data URI",
    );
  }
  return Uint8Array.from(Buffer.from(match[1], "base64"));
}

async function loadBuffers(
  json: JsonObject,
  sourcePath: string,
  glbBinary: Uint8Array | null,
): Promise<{
  readonly buffers: readonly Uint8Array[];
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
}> {
  const rows = Array.isArray(json.buffers) ? json.buffers as JsonObject[] : [];
  if (rows.length === 0) {
    failPolyMorphPrepare("missing-buffer", "$.source.buffers", "expected at least one buffer");
  }
  const sourceRoot = dirname(sourcePath);
  const buffers: Uint8Array[] = [];
  const files: { path: string; sha256: string }[] = [];
  for (const [index, row] of rows.entries()) {
    const path = `$.source.buffers[${index}]`;
    if (!Number.isSafeInteger(row?.byteLength) || row.byteLength < 0) {
      failPolyMorphPrepare("invalid-buffer", path, "invalid byteLength");
    }
    let bytes: Uint8Array;
    let identity: string;
    if (row.uri === undefined) {
      if (index !== 0 || !glbBinary) {
        failPolyMorphPrepare("missing-buffer", path, "missing URI or GLB binary chunk");
      }
      bytes = glbBinary;
      identity = "<glb-bin>";
    } else if (typeof row.uri === "string" && row.uri.startsWith("data:")) {
      bytes = dataUriBytes(row.uri, `${path}.uri`);
      identity = "<embedded-base64>";
    } else {
      const sourceRelative = normalizedRelativePath(row.uri, `${path}.uri`);
      const absolute = resolve(sourceRoot, sourceRelative);
      const rel = relative(sourceRoot, absolute);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        failPolyMorphPrepare("unsafe-path", `${path}.uri`, "buffer escapes source directory");
      }
      bytes = new Uint8Array(await readFile(absolute));
      identity = sourceRelative;
    }
    const declaredLength = row.byteLength as number;
    if (bytes.byteLength < declaredLength || bytes.byteLength - declaredLength > 3) {
      failPolyMorphPrepare("invalid-buffer", path, "buffer length disagrees with byteLength");
    }
    const exact = bytes.subarray(0, declaredLength);
    buffers.push(exact);
    files.push({ path: identity, sha256: sha256(exact) });
  }
  return { buffers, files };
}

function readComponent(
  view: DataView,
  componentType: number,
  offset: number,
): number {
  switch (componentType) {
    case 5120: return view.getInt8(offset);
    case 5121: return view.getUint8(offset);
    case 5122: return view.getInt16(offset, true);
    case 5123: return view.getUint16(offset, true);
    case 5125: return view.getUint32(offset, true);
    case 5126: return view.getFloat32(offset, true);
    default:
      failPolyMorphPrepare(
        "invalid-accessor",
        "$.source.accessors",
        `unsupported component type ${componentType}`,
      );
  }
}

function normalizedComponent(value: number, componentType: number): number {
  switch (componentType) {
    case 5120: return Math.max(-1, value / 127);
    case 5121: return value / 255;
    case 5122: return Math.max(-1, value / 32767);
    case 5123: return value / 65535;
    case 5125: return value / 4294967295;
    default: return value;
  }
}

function createAccessorReader(
  json: JsonObject,
  buffers: readonly Uint8Array[],
): (accessorIndex: number, path: string) => readonly (number | readonly number[])[] {
  const accessors = Array.isArray(json.accessors) ? json.accessors as JsonObject[] : [];
  const views = Array.isArray(json.bufferViews) ? json.bufferViews as JsonObject[] : [];
  return (accessorIndex, path) => {
    const accessor = accessors[accessorIndex];
    if (
      !accessor
      || accessor.sparse !== undefined
      || !Number.isSafeInteger(accessor.count)
      || accessor.count < 0
    ) {
      failPolyMorphPrepare("invalid-accessor", path, "missing, sparse, or invalid accessor");
    }
    const components = COMPONENT_COUNTS[accessor.type];
    const bytesPerComponent = COMPONENT_BYTES[accessor.componentType];
    const bufferView = views[accessor.bufferView];
    if (
      !components
      || !bytesPerComponent
      || !bufferView
      || !Number.isSafeInteger(bufferView.buffer)
    ) {
      failPolyMorphPrepare("invalid-accessor", path, "unsupported accessor metadata");
    }
    const buffer = buffers[bufferView.buffer];
    if (!buffer) {
      failPolyMorphPrepare("invalid-accessor", path, "references an absent buffer");
    }
    const itemBytes = components * bytesPerComponent;
    const stride = bufferView.byteStride ?? itemBytes;
    const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    if (
      !Number.isSafeInteger(stride)
      || stride < itemBytes
      || stride % bytesPerComponent !== 0
      || !Number.isSafeInteger(start)
      || start < 0
      || start + Math.max(0, accessor.count - 1) * stride + itemBytes > buffer.byteLength
    ) {
      failPolyMorphPrepare("invalid-accessor", path, "invalid accessor byte layout");
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const result: (number | readonly number[])[] = [];
    for (let index = 0; index < accessor.count; index += 1) {
      const values: number[] = [];
      for (let component = 0; component < components; component += 1) {
        const raw = readComponent(
          view,
          accessor.componentType,
          start + index * stride + component * bytesPerComponent,
        );
        const value = accessor.normalized
          ? normalizedComponent(raw, accessor.componentType)
          : raw;
        if (!Number.isFinite(value)) {
          failPolyMorphPrepare(
            "invalid-accessor",
            `${path}[${index}][${component}]`,
            "non-finite component",
          );
        }
        values.push(Object.is(value, -0) ? 0 : value);
      }
      result.push(components === 1 ? values[0]! : values);
    }
    return result;
  };
}

function vec3Rows(
  values: readonly (number | readonly number[])[],
  path: string,
): readonly PolyMorphVec3[] {
  return values.map((value, index) => {
    if (!Array.isArray(value) || value.length !== 3) {
      failPolyMorphPrepare("invalid-accessor", `${path}[${index}]`, "expected VEC3");
    }
    return [value[0]!, value[1]!, value[2]!] as const;
  });
}

function triangleIndices(
  mode: number,
  values: readonly (number | readonly number[])[],
  path: string,
): readonly (readonly [number, number, number])[] {
  const indices = values.map((value, index) => {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      failPolyMorphPrepare("invalid-index", `${path}[${index}]`, "expected an unsigned integer");
    }
    return value as number;
  });
  const triangles: [number, number, number][] = [];
  if (mode === 4) {
    if (indices.length % 3 !== 0) {
      failPolyMorphPrepare("invalid-primitive", path, "incomplete triangle list");
    }
    for (let index = 0; index < indices.length; index += 3) {
      triangles.push([indices[index]!, indices[index + 1]!, indices[index + 2]!]);
    }
  } else if (mode === 5) {
    for (let index = 2; index < indices.length; index += 1) {
      triangles.push(index % 2 === 0
        ? [indices[index - 2]!, indices[index - 1]!, indices[index]!]
        : [indices[index - 1]!, indices[index - 2]!, indices[index]!]);
    }
  } else if (mode === 6) {
    for (let index = 2; index < indices.length; index += 1) {
      triangles.push([indices[0]!, indices[index - 1]!, indices[index]!]);
    }
  } else {
    failPolyMorphPrepare(
      "unsupported-primitive",
      path,
      `mode ${mode} is not triangles, triangle strip, or triangle fan`,
    );
  }
  return triangles.filter(([a, b, c]) => a !== b && b !== c && a !== c);
}

const IDENTITY: PolyMorphMat4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function multiply(left: PolyMorphMat4, right: PolyMorphMat4): PolyMorphMat4 {
  const output = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let axis = 0; axis < 4; axis += 1) {
        output[column * 4 + row]! +=
          left[axis * 4 + row]! * right[column * 4 + axis]!;
      }
    }
  }
  return output as unknown as PolyMorphMat4;
}

function nodeMatrix(node: JsonObject, path: string): PolyMorphMat4 {
  if (node.matrix !== undefined) {
    if (
      !Array.isArray(node.matrix)
      || node.matrix.length !== 16
      || node.matrix.some((value: unknown) =>
        typeof value !== "number" || !Number.isFinite(value))
      || node.translation !== undefined
      || node.rotation !== undefined
      || node.scale !== undefined
    ) {
      failPolyMorphPrepare("invalid-node", path, "invalid or ambiguous node matrix");
    }
    return node.matrix as unknown as PolyMorphMat4;
  }
  const translation = node.translation ?? [0, 0, 0];
  const rotation = node.rotation ?? [0, 0, 0, 1];
  const scale = node.scale ?? [1, 1, 1];
  if (
    !Array.isArray(translation)
    || translation.length !== 3
    || !Array.isArray(rotation)
    || rotation.length !== 4
    || !Array.isArray(scale)
    || scale.length !== 3
    || [...translation, ...rotation, ...scale].some(
      (value) => typeof value !== "number" || !Number.isFinite(value),
    )
  ) {
    failPolyMorphPrepare("invalid-node", path, "invalid node TRS");
  }
  const [x, y, z, w] = rotation as number[];
  const length = Math.hypot(x!, y!, z!, w!);
  if (!(length > 0)) {
    failPolyMorphPrepare("invalid-node", `${path}.rotation`, "zero quaternion");
  }
  const qx = x! / length;
  const qy = y! / length;
  const qz = z! / length;
  const qw = w! / length;
  const [sx, sy, sz] = scale as number[];
  const [tx, ty, tz] = translation as number[];
  return [
    (1 - 2 * (qy * qy + qz * qz)) * sx!,
    (2 * (qx * qy + qz * qw)) * sx!,
    (2 * (qx * qz - qy * qw)) * sx!,
    0,
    (2 * (qx * qy - qz * qw)) * sy!,
    (1 - 2 * (qx * qx + qz * qz)) * sy!,
    (2 * (qy * qz + qx * qw)) * sy!,
    0,
    (2 * (qx * qz + qy * qw)) * sz!,
    (2 * (qy * qz - qx * qw)) * sz!,
    (1 - 2 * (qx * qx + qy * qy)) * sz!,
    0,
    tx!, ty!, tz!, 1,
  ];
}

function sceneInstances(json: JsonObject): readonly {
  readonly nodeIndex: number;
  readonly nodeName: string;
  readonly meshIndex: number;
  readonly matrix: PolyMorphMat4;
}[] {
  const nodes = Array.isArray(json.nodes) ? json.nodes as JsonObject[] : [];
  const scenes = Array.isArray(json.scenes) ? json.scenes as JsonObject[] : [];
  let roots: readonly number[];
  if (scenes.length > 0) {
    const sceneIndex = json.scene ?? 0;
    const selected = scenes[sceneIndex]?.nodes;
    if (!Array.isArray(selected)) {
      failPolyMorphPrepare("invalid-scene", "$.source.scene", "default scene has no nodes");
    }
    roots = selected;
  } else {
    const children = new Set<number>(
      nodes.flatMap((node) => Array.isArray(node.children) ? node.children : []),
    );
    roots = nodes.map((_, index) => index).filter((index) => !children.has(index));
  }
  const instances: {
    nodeIndex: number;
    nodeName: string;
    meshIndex: number;
    matrix: PolyMorphMat4;
  }[] = [];
  const visit = (
    nodeIndex: number,
    parentMatrix: PolyMorphMat4,
    ancestry: ReadonlySet<number>,
  ): void => {
    if (!Number.isSafeInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodes.length) {
      failPolyMorphPrepare("invalid-node", "$.source.nodes", `unknown node ${nodeIndex}`);
    }
    if (ancestry.has(nodeIndex)) {
      failPolyMorphPrepare("invalid-node", "$.source.nodes", `node cycle at ${nodeIndex}`);
    }
    const node = nodes[nodeIndex]!;
    const matrix = multiply(parentMatrix, nodeMatrix(node, `$.source.nodes[${nodeIndex}]`));
    if (node.mesh !== undefined) {
      if (!Number.isSafeInteger(node.mesh) || node.mesh < 0) {
        failPolyMorphPrepare(
          "invalid-node",
          `$.source.nodes[${nodeIndex}].mesh`,
          "invalid mesh index",
        );
      }
      instances.push({
        nodeIndex,
        nodeName: typeof node.name === "string" && node.name.length > 0
          ? node.name
          : `node-${nodeIndex}`,
        meshIndex: node.mesh,
        matrix,
      });
    }
    const next = new Set(ancestry).add(nodeIndex);
    const children = node.children ?? [];
    if (!Array.isArray(children)) {
      failPolyMorphPrepare(
        "invalid-node",
        `$.source.nodes[${nodeIndex}].children`,
        "expected an array",
      );
    }
    for (const child of children) visit(child, matrix, next);
  };
  for (const root of roots) visit(root, IDENTITY, new Set());
  return instances;
}

function parseMaterials(json: JsonObject): readonly PolyMorphGltfMaterial[] {
  const rows = Array.isArray(json.materials) ? json.materials as JsonObject[] : [];
  return rows.map((material, sourceIndex) => {
    const raw = material?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
    if (
      !Array.isArray(raw)
      || raw.length !== 4
      || raw.some((value: unknown) =>
        typeof value !== "number"
        || !Number.isFinite(value)
        || value < 0
        || value > 1)
    ) {
      failPolyMorphPrepare(
        "invalid-material",
        `$.source.materials[${sourceIndex}]`,
        "baseColorFactor must have four unit components",
      );
    }
    return {
      sourceIndex,
      name: typeof material.name === "string" && material.name.length > 0
        ? material.name
        : `material-${sourceIndex}`,
      color: [raw[0], raw[1], raw[2], raw[3]],
    };
  });
}

function parsePrimitives(
  json: JsonObject,
  buffers: readonly Uint8Array[],
  instances: ReturnType<typeof sceneInstances>,
): readonly PolyMorphGltfInstance[] {
  const readAccessor = createAccessorReader(json, buffers);
  const meshes = Array.isArray(json.meshes) ? json.meshes as JsonObject[] : [];
  return instances.map((instance) => {
    const mesh = meshes[instance.meshIndex];
    if (!mesh || !Array.isArray(mesh.primitives) || mesh.primitives.length === 0) {
      failPolyMorphPrepare(
        "invalid-mesh",
        `$.source.meshes[${instance.meshIndex}]`,
        "mesh has no primitives",
      );
    }
    const targetNames = Array.isArray(mesh.extras?.targetNames)
      ? mesh.extras.targetNames.map(String)
      : [];
    const primitives: PolyMorphGltfPrimitive[] = mesh.primitives.map(
      (primitive: JsonObject, primitiveIndex: number) => {
        const path = `$.source.meshes[${instance.meshIndex}].primitives[${primitiveIndex}]`;
        if (!primitive?.attributes || !Number.isSafeInteger(primitive.attributes.POSITION)) {
          failPolyMorphPrepare("invalid-primitive", path, "missing POSITION accessor");
        }
        const positions = vec3Rows(
          readAccessor(primitive.attributes.POSITION, `${path}.POSITION`),
          `${path}.POSITION`,
        );
        const sourceIndices = primitive.indices === undefined
          ? positions.map((_, index) => index)
          : readAccessor(primitive.indices, `${path}.indices`);
        const triangles = triangleIndices(primitive.mode ?? 4, sourceIndices, `${path}.indices`);
        if (
          triangles.length === 0
          || triangles.some((triangle) =>
            triangle.some((index) => index >= positions.length))
        ) {
          failPolyMorphPrepare("invalid-index", path, "triangle indices are empty or out of range");
        }
        const targets = Array.isArray(primitive.targets)
          ? primitive.targets.map((target: JsonObject, targetIndex: number) => {
            if (!Number.isSafeInteger(target.POSITION)) {
              failPolyMorphPrepare(
                "invalid-morph",
                `${path}.targets[${targetIndex}]`,
                "missing POSITION accessor",
              );
            }
            const positionDeltas = vec3Rows(
              readAccessor(
                target.POSITION,
                `${path}.targets[${targetIndex}].POSITION`,
              ),
              `${path}.targets[${targetIndex}].POSITION`,
            );
            if (positionDeltas.length !== positions.length) {
              failPolyMorphPrepare(
                "invalid-morph",
                `${path}.targets[${targetIndex}]`,
                "target does not cover POSITION",
              );
            }
            return {
              index: targetIndex,
              name: targetNames[targetIndex] ?? `morph-${targetIndex}`,
              positionDeltas,
            };
          })
          : [];
        const materialIndex = primitive.material ?? -1;
        if (!Number.isSafeInteger(materialIndex) || materialIndex < -1) {
          failPolyMorphPrepare(
            "invalid-material",
            `${path}.material`,
            "invalid material index",
          );
        }
        return {
          primitiveIndex,
          materialIndex,
          positions,
          triangles,
          targets,
        };
      },
    );
    return {
      ...instance,
      meshName: typeof mesh.name === "string" && mesh.name.length > 0
        ? mesh.name
        : `mesh-${instance.meshIndex}`,
      primitives,
    };
  });
}

export async function loadPolyMorphGltf(
  sourcePath: string,
): Promise<PolyMorphGltfDocument> {
  const absolute = resolve(sourcePath);
  const source = new Uint8Array(await readFile(absolute));
  const extension = extname(absolute).toLowerCase();
  let format: "glb" | "gltf";
  let json: JsonObject;
  let binary: Uint8Array | null = null;
  if (extension === ".glb") {
    format = "glb";
    ({ json, binary } = decodeGlb(source));
  } else if (extension === ".gltf") {
    format = "gltf";
    json = parseJson(source, "$.source");
  } else {
    failPolyMorphPrepare(
      "unsupported-format",
      "$.source.path",
      "expected .gltf or .glb",
    );
  }
  if (
    json.asset?.version !== "2.0"
    || (Array.isArray(json.extensionsRequired) && json.extensionsRequired.length > 0)
  ) {
    failPolyMorphPrepare(
      "unsupported-gltf",
      "$.source",
      "expected core glTF 2.0 without required extensions",
    );
  }
  const loaded = await loadBuffers(json, absolute, binary);
  const instances = parsePrimitives(
    json,
    loaded.buffers,
    sceneInstances(json),
  );
  if (instances.length === 0) {
    failPolyMorphPrepare("empty-model", "$.source", "default scene has no mesh instances");
  }
  const sourceSha256 = sha256(source);
  const contentSha256 = sha256(new TextEncoder().encode(JSON.stringify({
    source: sourceSha256,
    buffers: loaded.files,
  })));
  return {
    format,
    sourceBytes: source.byteLength,
    sourceSha256,
    contentSha256,
    materials: parseMaterials(json),
    instances,
  };
}
