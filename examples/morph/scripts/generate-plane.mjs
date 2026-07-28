import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = resolve(root, "source/plane.spec.json");
const generatedRoot = resolve(root, "source/.generated");

function targetName(column, row, direction) {
  return `Pin C${String(column).padStart(2, "0")} R${String(row).padStart(2, "0")} ${direction}`;
}

function targetId(column, row, direction) {
  return `pin-c${String(column).padStart(2, "0")}-r${String(row).padStart(2, "0")}-${direction.toLowerCase()}`;
}

function align4(value) {
  return (value + 3) & ~3;
}

function extrema(values, components) {
  const minimum = Array.from({ length: components }, () => Infinity);
  const maximum = Array.from({ length: components }, () => -Infinity);
  for (let offset = 0; offset < values.length; offset += components) {
    for (let component = 0; component < components; component += 1) {
      const value = values[offset + component];
      minimum[component] = Math.min(minimum[component], value);
      maximum[component] = Math.max(maximum[component], value);
    }
  }
  return { minimum, maximum };
}

function buildPlaneSource(spec) {
  const vertexColumns = spec.columns + 1;
  const vertexRows = spec.rows + 1;
  const positions = [];
  for (let row = 0; row < vertexRows; row += 1) {
    const y = -spec.height / 2 + (row / spec.rows) * spec.height;
    for (let column = 0; column < vertexColumns; column += 1) {
      const x = -spec.width / 2 + (column / spec.columns) * spec.width;
      positions.push(x, y, 0);
    }
  }

  const vertexIndex = (column, row) => row * vertexColumns + column;
  const indices = [];
  for (let row = 0; row < spec.rows; row += 1) {
    for (let column = 0; column < spec.columns; column += 1) {
      const topLeft = vertexIndex(column, row);
      const topRight = vertexIndex(column + 1, row);
      const bottomLeft = vertexIndex(column, row + 1);
      const bottomRight = vertexIndex(column + 1, row + 1);
      if ((column + row) % 2 === 0) {
        indices.push(topLeft, topRight, bottomRight, topLeft, bottomRight, bottomLeft);
      } else {
        indices.push(topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft);
      }
    }
  }

  const targetRows = [];
  for (const row of spec.controlRows) {
    for (const column of spec.controlColumns) {
      for (const [direction, height] of [["Lift", spec.lift], ["Press", spec.press]]) {
        const deltas = [];
        for (let vertexRow = 0; vertexRow < vertexRows; vertexRow += 1) {
          for (let vertexColumn = 0; vertexColumn < vertexColumns; vertexColumn += 1) {
            const distance = Math.hypot(vertexColumn - column, vertexRow - row);
            const falloff = distance >= spec.radius
              ? 0
              : (1 - distance / spec.radius) ** 2;
            const boundary = Math.min(
              1,
              vertexColumn / 1.5,
              (spec.columns - vertexColumn) / 1.5,
              vertexRow / 1.5,
              (spec.rows - vertexRow) / 1.5,
            );
            const influence = falloff * Math.max(0, boundary);
            deltas.push(0, 0, height * influence);
          }
        }
        targetRows.push({
          id: targetId(column, row, direction),
          name: targetName(column, row, direction),
          values: deltas,
        });
      }
    }
  }

  const bufferViews = [];
  const accessors = [];
  const chunks = [];
  let byteLength = 0;

  function append(values, componentType, type, target, includeBounds = false) {
    const TypedArray = componentType === 5123 ? Uint16Array : Float32Array;
    const typed = new TypedArray(values);
    const alignedOffset = align4(byteLength);
    if (alignedOffset > byteLength) chunks.push(Buffer.alloc(alignedOffset - byteLength));
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const bufferView = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: alignedOffset,
      byteLength: bytes.byteLength,
      target,
    });
    chunks.push(bytes);
    byteLength = alignedOffset + bytes.byteLength;
    const components = type === "SCALAR" ? 1 : 3;
    const accessor = accessors.length;
    const row = {
      bufferView,
      componentType,
      count: typed.length / components,
      type,
    };
    if (includeBounds) {
      const { minimum, maximum } = extrema(typed, components);
      row.min = minimum;
      row.max = maximum;
    }
    accessors.push(row);
    return accessor;
  }

  const positionAccessor = append(positions, 5126, "VEC3", 34962, true);
  const indexAccessor = append(indices, 5123, "SCALAR", 34963, true);
  const targetAccessors = targetRows.map((target) =>
    append(target.values, 5126, "VEC3", 34962));
  const buffer = Buffer.concat(chunks);

  const gltf = {
    asset: {
      version: "2.0",
      generator: "polycss-morph-plane-fixture",
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "Morph Plane" }],
    buffers: [{
      byteLength: buffer.byteLength,
      uri: `data:application/octet-stream;base64,${buffer.toString("base64")}`,
    }],
    bufferViews,
    accessors,
    materials: [{
      name: "Morph terrain",
      pbrMetallicRoughness: {
        baseColorFactor: [0.57, 0.56, 0.51, 1],
        metallicFactor: 0,
        roughnessFactor: 0.72,
      },
    }],
    meshes: [{
      name: "Tessellated Plane",
      extras: {
        targetNames: targetRows.map((target) => target.name),
      },
      primitives: [{
        attributes: { POSITION: positionAccessor },
        indices: indexAccessor,
        material: 0,
        mode: 4,
        targets: targetAccessors.map((accessor) => ({ POSITION: accessor })),
      }],
    }],
  };

  const prepare = {
    schema: "polycss-morph.prepare@1",
    identity: {
      id: "morph-plane",
      name: "Morph Plane",
      revision: "1.0.0",
    },
    profile: "morph-regions",
    source: {
      path: "morph-plane.gltf",
      id: "generated-morph-plane",
      kind: "generated",
      uri: "urn:polycss:example:morph-plane",
      license: "MIT",
    },
    transform: {
      axes: ["x", "y", "z"],
      signs: [1, 1, 1],
      scale: 120,
      center: true,
    },
    morphAliases: Object.fromEntries(targetRows.map((target) => [target.name, target.id])),
    controls: [],
    springs: [],
    animations: [],
    budgets: {
      maxVertices: vertexColumns * vertexRows,
      maxPolygons: spec.columns * spec.rows * 2,
      maxLeaves: spec.columns * spec.rows * 2,
      maxFrames: 1,
      maxJoints: 1,
      maxResources: 4,
      maxBytes: 8000000,
    },
  };

  return { gltf, prepare };
}

export async function generatePlaneFixture() {
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  if (spec.schema !== "polycss-morph.plane-fixture@1") {
    throw new Error(`Unsupported plane fixture schema: ${String(spec.schema)}`);
  }
  const generated = buildPlaneSource(spec);
  await mkdir(generatedRoot, { recursive: true });
  const gltfPath = resolve(generatedRoot, "morph-plane.gltf");
  const configPath = resolve(generatedRoot, "prepare.json");
  await Promise.all([
    writeFile(gltfPath, `${JSON.stringify(generated.gltf)}\n`),
    writeFile(configPath, `${JSON.stringify(generated.prepare, null, 2)}\n`),
  ]);
  return { configPath, gltfPath, spec };
}
