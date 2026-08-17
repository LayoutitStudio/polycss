import { requireContract as require } from "./errors.js";
import { assertResourceId, validateResourceCatalog } from "./resources.js";

const XHTML = "http://www.w3.org/1999/xhtml";
const STABLE_ID = /^[a-z][A-Za-z0-9._:/-]{0,127}$/u;
const CLASS = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u;
const DATA_ATTRIBUTE = /^data-[a-z][a-z0-9._:-]{0,63}$/u;
const SHORT_TOKEN = /^[a-z][a-z0-9-]{0,63}$/u;
const GENERATOR_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const GENERATOR_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ELEMENTS = new Set(["b", "div", "i", "img", "s", "span", "u"]);
const ATTRIBUTES = new Set(["alt", "aria-hidden", "class", "decoding", "draggable", "height", "role", "width"]);
const NODE_STYLES = new Set(`backgroundColor backgroundPosition backgroundPositionY backgroundRepeat backgroundSize borderBottomLeftRadius borderBottomRightRadius borderShape borderTopLeftRadius borderTopRightRadius color cornerBottomLeftShape cornerBottomRightShape cornerTopLeftShape cornerTopRightShape height left objectFit objectPosition opacity perspective perspectiveOrigin position top transform transformOrigin transformStyle visibility width`.split(" "));
const MOUNT_STYLES = new Set(["backgroundColor", "backgroundPosition", "backgroundRepeat", "backgroundSize", "position"]);
const INLINE_FUNCTIONS = new Set(`abs acos asin atan atan2 calc clamp color color-mix cos exp hsl hsla hwb hypot lab lch linear-gradient log matrix matrix3d max min mod oklab oklch polygon pow radial-gradient rem rgb rgba rotate rotate3d rotatex rotatey rotatez round scale scale3d scalex scaley scalez sign sin skew skewx skewy sqrt tan translate translate3d translatex translatey translatez`.split(" "));
const VIEWER_ATTRIBUTES = new Set(["data-domformat-instance", "data-domformat-mount-surface", "data-domformat-node"]);
const VARIANT_EFFECT_PROPERTIES = Object.freeze({
  backgroundColor: "style.backgroundColor",
  backgroundPositionX: "style.backgroundPositionX",
  color: "style.color",
  display: "style.display",
  outlineColor: "style.outlineColor",
});
const CODECS = new Map([
  ["polycss-compositor-timing@0", "polycss-compositor-timing-prepared@0"],
  ["polycss-effects@0", "polycss-effects-prepared@0"],
  ["polycss-orbit-input@0", "polycss-orbit-input-prepared@0"],
  ["polycss-paged-playback@0", "polycss-paged-playback@0"],
  ["polycss-paged-variants@0", "polycss-paged-variants@0"],
  ["polycss-playback@0", "polycss-playback-packed@0"],
  ["polycss-pointer-grab@0", "polycss-pointer-grab-prepared@0"],
  ["polycss-surface@0", "polycss-surface-packed@0"],
  ["polycss-variants@0", "polycss-variants-packed@0"],
  ["polycss-viewport-profiles@0", "polycss-viewport-profiles-packed@0"],
  ["static-presentation@0", "static-presentation@0"],
]);
const INPUTS = Object.freeze({
  "polycss-compositor-timing@0": ["time.source-frame", "time.tick"],
  "polycss-effects@0": ["interaction.grab-active", "interaction.grab-x", "interaction.grab-y", "interaction.grab-z", "time.source-frame"],
  "polycss-orbit-input@0": ["orbit.pitch", "orbit.yaw", "orbit.zoom"],
  "polycss-paged-playback@0": ["time.tick"],
  "polycss-paged-variants@0": ["time.source-frame"],
  "polycss-playback@0": ["time.tick"],
  "polycss-pointer-grab@0": ["axis.x", "axis.y", "button.hold", "pointer.positioned", "pointer.pressed", "pointer.x", "pointer.y"],
  "polycss-surface@0": ["time.source-frame"],
  "polycss-variants@0": ["time.source-frame"],
  "polycss-viewport-profiles@0": ["viewport.height", "viewport.width"],
  "static-presentation@0": ["viewport.height", "viewport.width"],
});
const SINKS = Object.freeze({
  "polycss-compositor-timing@0": ["style.transform"],
  "polycss-effects@0": ["style.backgroundPosition", "style.opacity", "style.transform", "style.visibility"],
  "polycss-orbit-input@0": ["style.backgroundPosition", "style.transform"],
  "polycss-paged-playback@0": ["style.transform", "style.visibility"],
  "polycss-paged-variants@0": null,
  "polycss-playback@0": ["style.transform", "style.visibility"],
  "polycss-pointer-grab@0": ["style.transform", "style.visibility"],
  "polycss-surface@0": null,
  "polycss-variants@0": null,
  "polycss-viewport-profiles@0": ["style.transform", "style.visibility"],
  "static-presentation@0": null,
});
const BASE_CAPABILITIES = ["css-semantic-closure", "deterministic-json", "explicit-retained-tree", "logical-assets"];
const CAPABILITY_ORDER = [
  ["polycss-effects@0", "prepared-particle-effects"],
  ["polycss-compositor-timing@0", "prepared-compositor-timing"],
  ["polycss-orbit-input@0", "prepared-orbit-input"],
  ["polycss-paged-playback@0", "prepared-playback"],
  ["polycss-paged-variants@0", "prepared-variants"],
  ["polycss-pointer-grab@0", "prepared-pointer-grab-interaction"],
  ["polycss-playback@0", "prepared-playback"],
  ["polycss-surface@0", "prepared-surface-lighting"],
  ["polycss-variants@0", "prepared-variants"],
  ["polycss-viewport-profiles@0", "prepared-viewport-profiles"],
];
const CONFORMANCE_ORDER = [
  ["polycss-effects@0", "particle-effects"],
  ["polycss-compositor-timing@0", "compositor-timing"],
  ["polycss-orbit-input@0", "orbit-input"],
  ["polycss-paged-variants@0", "paged-variants"],
  ["polycss-paged-playback@0", "paged-playback"],
  ["polycss-playback@0", "playback"],
  ["polycss-pointer-grab@0", "pointer-grab-interaction"],
  ["static-presentation@0", "presentation"],
  ["polycss-surface@0", "surface-lighting"],
  ["polycss-variants@0", "variants"],
  ["polycss-viewport-profiles@0", "viewport-profiles"],
];

function exactObject(value, allowed, code, label, required = allowed) {
  require(value && typeof value === "object" && !Array.isArray(value), code, `${label} must be an object.`);
  for (const key of Object.keys(value)) require(allowed.includes(key), code, `${label} contains unknown field ${key}.`);
  for (const key of required) require(Object.hasOwn(value, key), code, `${label} is missing ${key}.`);
  return value;
}

function plainObject(value, code, label) {
  require(value && typeof value === "object" && !Array.isArray(value), code, `${label} must be an object.`);
  return value;
}

function exactArray(value, expected, code, label) {
  require(Array.isArray(value) && value.length === expected.length && value.every((entry, index) => entry === expected[index]), code, `${label} differs from the fixed profile order.`);
}

function uniqueArray(value, maximum, code, label, predicate = () => true) {
  require(Array.isArray(value) && value.length <= maximum && new Set(value).size === value.length && value.every(predicate), code, `${label} is invalid or excessive.`);
  return value;
}

function closedObject(value, allowed, code, label) {
  return exactObject(value, allowed, code, label, []);
}

function finiteF32(value) {
  return typeof value === "number" && Number.isFinite(value) && Number.isFinite(Math.fround(value));
}

function finiteF32Array(value, length, code, label) {
  require(Array.isArray(value) && value.length === length && value.every(finiteF32), code, `${label} must contain ${length} finite binary32 values.`);
  return value;
}

function gcd(left, right) {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function validateTickCadence(parameters, code, label) {
  const hasRate = Object.hasOwn(parameters, "tickRateHz");
  const hasInterval = Object.hasOwn(parameters, "tickIntervalUs");
  require(hasRate !== hasInterval, code, `${label} must declare exactly one cadence.`);
  if (hasRate) {
    require(typeof parameters.tickRateHz === "number" && Number.isFinite(parameters.tickRateHz) && parameters.tickRateHz >= 1 && parameters.tickRateHz <= 240, code, `${label} tickRateHz is invalid.`);
    return;
  }
  const interval = parameters.tickIntervalUs;
  require(Array.isArray(interval) && interval.length === 2 && interval.every((value) => Number.isSafeInteger(value) && value > 0), code, `${label} tickIntervalUs is invalid.`);
  require(interval[0] / interval[1] >= 1_000_000 / 240 && interval[0] / interval[1] <= 1_000_000 && gcd(interval[0], interval[1]) === 1, code, `${label} tickIntervalUs is invalid or noncanonical.`);
}

function sameTickCadence(left, right) {
  if (Object.hasOwn(left, "tickRateHz") || Object.hasOwn(right, "tickRateHz")) return left.tickRateHz === right.tickRateHz;
  return left.tickIntervalUs?.[0] === right.tickIntervalUs?.[0] && left.tickIntervalUs?.[1] === right.tickIntervalUs?.[1];
}

function multiplyF32Matrices(left, right) {
  const output = new Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let value = Math.fround(Math.fround(left[row * 4]) * Math.fround(right[column]));
      for (let index = 1; index < 4; index += 1) {
        value = Math.fround(value + Math.fround(Math.fround(left[row * 4 + index]) * Math.fround(right[index * 4 + column])));
      }
      output[row * 4 + column] = value;
    }
  }
  return output;
}

function inverseMatrixPair(left, right) {
  for (const product of [multiplyF32Matrices(left, right), multiplyF32Matrices(right, left)]) {
    if (!product.every(Number.isFinite)) return false;
    if (!product.every((value, index) => Math.abs(value - (index % 5 === 0 ? 1 : 0)) <= 1e-4)) return false;
  }
  return true;
}

function operationF32(value) {
  const result = Math.fround(value);
  return Number.isFinite(result) ? result : Number.NaN;
}

function addF32(left, right) {
  return operationF32(operationF32(left) + operationF32(right));
}

function multiplyF32(left, right) {
  return operationF32(operationF32(left) * operationF32(right));
}

function transformF32(value, matrix) {
  return [0, 1, 2].map((column) => {
    let result = multiplyF32(matrix[column], value[0]);
    result = addF32(result, multiplyF32(matrix[4 + column], value[1]));
    return addF32(result, multiplyF32(matrix[8 + column], value[2]));
  });
}

function grabDisplacementBounds(input, source) {
  const spanX = operationF32(input.cursorBounds[1] - input.cursorBounds[0]);
  const spanY = operationF32(input.cursorBounds[3] - input.cursorBounds[2]);
  if (!Number.isFinite(spanX) || !Number.isFinite(spanY)) return null;
  const bounds = [0, 0, 0];
  for (const deltaX of [-spanX, spanX]) {
    for (const deltaY of [-spanY, spanY]) {
      const transformed = transformF32([
        multiplyF32(deltaX, source.displacementMagnitude),
        multiplyF32(deltaY, source.displacementMagnitude),
        0,
      ], source.inverseCameraMatrix);
      if (!transformed.every(Number.isFinite)) return null;
      for (let component = 0; component < 3; component += 1) bounds[component] = Math.max(bounds[component], Math.abs(transformed[component]));
    }
  }
  return bounds;
}

function projectedF32(position, source) {
  const camera = transformF32(position, source.cameraViewMatrix);
  for (let component = 0; component < 3; component += 1) camera[component] = addF32(camera[component], source.cameraViewMatrix[12 + component]);
  if (!camera.every(Number.isFinite) || Math.abs(camera[2]) <= 1e-6) return null;
  const xScale = operationF32(source.projection.scale / operationF32(-camera[2]));
  const yScale = operationF32(source.projection.scale / camera[2]);
  const projected = [
    addF32(multiplyF32(camera[0], xScale), source.projection.origin[0]),
    addF32(multiplyF32(camera[1], yScale), source.projection.origin[1]),
  ];
  return projected.every(Number.isFinite) ? projected : null;
}

function finiteMagnitudeF32(value) {
  let squared = multiplyF32(value[0], value[0]);
  squared = addF32(squared, multiplyF32(value[1], value[1]));
  squared = addF32(squared, multiplyF32(value[2], value[2]));
  return Number.isFinite(squared) && squared >= 0 && Number.isFinite(operationF32(Math.sqrt(squared)));
}

function reconstructionIsFinite(closure, row, component, offsetBound) {
  const weightOffset = closure.vertexRows[row * 4 + 2];
  const weightCount = closure.vertexRows[row * 4 + 3];
  for (const offset of [-offsetBound, 0, offsetBound]) {
    let value = operationF32(closure.vertexPositions[row * 3 + component]);
    for (let index = weightOffset; index < weightOffset + weightCount; index += 1) {
      const translation = addF32(
        closure.weightBaseTranslations[index * 3 + component],
        closure.weightActiveFlags[index] === 1 ? offset : 0,
      );
      const contribution = addF32(closure.weightLinearContributions[index * 3 + component], translation);
      value = addF32(value, multiplyF32(contribution, closure.weightScalars[index]));
      if (!Number.isFinite(value)) return false;
    }
  }
  return true;
}

function eyeMatrixIsFinite(rotation, inverse, offsetBound) {
  const offsets = offsetBound === 0 ? [0] : [-offsetBound, offsetBound];
  for (const x of offsets) {
    for (const y of offsets) {
      for (const z of offsets) {
        const translated = [...rotation];
        translated[12] = addF32(translated[12], x);
        translated[13] = addF32(translated[13], y);
        translated[14] = addF32(translated[14], z);
        if (!translated.every(Number.isFinite) || !multiplyF32Matrices(translated, inverse).every(Number.isFinite)) return false;
      }
    }
  }
  return true;
}

function integerArray(value, maximum, code, label, options = {}) {
  const minimum = options.minimum ?? Number.MIN_SAFE_INTEGER;
  const upper = options.upper ?? Number.MAX_SAFE_INTEGER;
  require(Array.isArray(value) && value.length <= maximum && value.every((entry) => Number.isSafeInteger(entry) && entry >= minimum && entry <= upper), code, `${label} is invalid or excessive.`);
  if (options.unique) require(new Set(value).size === value.length, code, `${label} contains duplicates.`);
  return value;
}

function base64Value(character) {
  const code = character.charCodeAt(0);
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (character === "+") return 62;
  if (character === "/") return 63;
  return -1;
}

function base64Integers(value, width, maximum, code, label) {
  require(typeof value === "string" && value.length % 4 === 0, code, `${label} is not canonical base64.`);
  let padding = 0;
  if (value.endsWith("==")) padding = 2;
  else if (value.endsWith("=")) padding = 1;
  const contentLength = value.length - padding;
  for (let index = 0; index < contentLength; index += 1) require(base64Value(value[index]) >= 0, code, `${label} is not canonical base64.`);
  for (let index = contentLength; index < value.length; index += 1) require(value[index] === "=", code, `${label} has misplaced padding.`);
  if (padding === 2) require(contentLength >= 2 && (base64Value(value[contentLength - 1]) & 15) === 0, code, `${label} has nonzero padding bits.`);
  if (padding === 1) require(contentLength >= 3 && (base64Value(value[contentLength - 1]) & 3) === 0, code, `${label} has nonzero padding bits.`);
  const decodedLength = value.length / 4 * 3 - padding;
  require(Number.isSafeInteger(decodedLength) && decodedLength % width === 0 && decodedLength / width <= maximum, code, `${label} is truncated or excessive.`);
  let binary;
  try { binary = globalThis.atob(value); }
  catch { require(false, code, `${label} is not valid base64.`); }
  require(binary.length === decodedLength, code, `${label} decoded length is noncanonical.`);
  return Array.from({ length: decodedLength / width }, (_, index) => {
    let result = 0;
    for (let byte = 0; byte < width; byte += 1) result += binary.charCodeAt(index * width + byte) * 2 ** (byte * 8);
    return result;
  });
}

function base64Float64(value, maximum, code, label) {
  const bytes = base64Integers(value, 1, maximum * 8, code, label);
  require(bytes.length % 8 === 0 && bytes.length / 8 <= maximum, code, `${label} is truncated or excessive.`);
  const input = Uint8Array.from(bytes);
  const view = new DataView(input.buffer);
  return Array.from({ length: bytes.length / 8 }, (_, index) => view.getFloat64(index * 8, true));
}

function cumulativeReferences(deltas, count, code, label) {
  integerArray(deltas, count, code, label);
  require(deltas.length === count, code, `${label} cardinality differs from its declaration.`);
  let current = 0;
  return deltas.map((delta) => {
    current += delta;
    require(Number.isSafeInteger(current) && current >= 0, code, `${label} contains an invalid reference.`);
    return current;
  });
}

function uniqueTargets(values, label) {
  require(Array.isArray(values) && new Set(values).size === values.length, "TARGET_CARDINALITY_MISMATCH", `${label} targets must be unique.`);
  values.forEach((value, index) => stableId(value, `${label} target ${index}`));
  return values;
}

function stableId(value, label) {
  require(typeof value === "string" && STABLE_ID.test(value) && !value.includes("..") && !value.includes("//"), "INVALID_STABLE_ID", `${label} is invalid.`);
  return value;
}

function safeStyle(value, label) {
  require(typeof value === "string" && value.length <= 4096, "INVALID_STYLE_VALUE", `${label} is not a bounded string.`);
  require(!/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/u.test(value), "INVALID_STYLE_VALUE", `${label} contains a forbidden control character.`);
  const lower = value.toLowerCase();
  require(!/[\\;{}]/u.test(value) && !value.includes("/*") && !value.includes("*/") && !value.includes("--") && !lower.includes("url(") && !lower.includes("javascript:") && !lower.includes("expression(") && !lower.includes("@import") && !lower.includes("!important"), "UNSAFE_STYLE_VALUE", `${label} contains unsafe CSS.`);
  let quote = "";
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) { if (character === quote) quote = ""; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    require(depth >= 0, "UNSAFE_STYLE_VALUE", `${label} has unmatched parentheses.`);
    if (!/[A-Za-z_-]/u.test(character)) continue;
    let end = index + 1;
    while (/[A-Za-z0-9_-]/u.test(value[end] ?? "")) end += 1;
    let open = end;
    while (/[\t\n\f\r ]/u.test(value[open] ?? "")) open += 1;
    if (value[open] === "(") {
      require(open === end, "UNSAFE_STYLE_VALUE", `${label} separates a function name from its opening parenthesis.`);
      require(INLINE_FUNCTIONS.has(value.slice(index, end).toLowerCase()), "UNSAFE_STYLE_VALUE", `${label} uses an unsupported function.`);
    }
    index = end - 1;
  }
  require(!quote && depth === 0, "UNSAFE_STYLE_VALUE", `${label} has unterminated CSS syntax.`);
}

function attribute(name, value, mount, label) {
  require(typeof name === "string" && !VIEWER_ATTRIBUTES.has(name) && (ATTRIBUTES.has(name) || DATA_ATTRIBUTE.test(name)), "UNSAFE_ATTRIBUTE", `${label} attribute ${name} is unsupported.`);
  require(mount || (name !== "class" && name !== "srcdoc" && name !== "style" && !name.toLowerCase().startsWith("on")), "UNSAFE_ATTRIBUTE", `${label} attribute ${name} is forbidden.`);
  require(typeof value === "string" && value.length <= 1024, "INVALID_ATTRIBUTE", `${label} attribute ${name} is invalid.`);
}

function resourceStyles(value, records, label) {
  exactObject(value ?? Object.create(null), ["backgroundImage"], "INVALID_RESOURCE_STYLES", `${label} resource styles`, []);
  for (const [property, binding] of Object.entries(value ?? {})) {
    require(property === "backgroundImage", "UNSAFE_STYLE_PROPERTY", `${label} resource style is unsupported.`);
    exactObject(binding, ["resource", "syntax", "overlayOpacity"], "INVALID_RESOURCE_STYLE", `${label} resource binding`, ["resource", "syntax"]);
    const record = records.get(assertResourceId(binding.resource, `${label} resource`));
    require(record?.kind === "image", "RESOURCE_ROLE_MISMATCH", `${label} resource binding is not an image.`);
    require(binding.syntax === "url" || binding.syntax === "overlay-url", "INVALID_RESOURCE_STYLE", `${label} resource syntax is invalid.`);
    if (binding.syntax === "overlay-url") require(typeof binding.overlayOpacity === "number" && Number.isFinite(binding.overlayOpacity) && binding.overlayOpacity >= 0 && binding.overlayOpacity <= 1, "INVALID_RESOURCE_STYLE", `${label} overlay opacity is invalid.`);
    else require(!Object.hasOwn(binding, "overlayOpacity"), "INVALID_RESOURCE_STYLE", `${label} plain URL declares overlay opacity.`);
  }
}

function validateMeta(meta) {
  exactObject(meta, ["format", "profile", "title", "generator", "capabilities", "optionalCapabilities", "initialExperience", "conformance", "counts", "artifacts", "claims"], "INVALID_META", "META", ["format", "profile", "title", "generator", "capabilities", "conformance"]);
  require(meta.format === "domformat@0", "UNSUPPORTED_FORMAT", "META format is unsupported.");
  require(meta.profile === "polycss-3d@0", "UNSUPPORTED_PROFILE", "META profile is unsupported.");
  require(typeof meta.title === "string" && [...meta.title].length > 0 && [...meta.title].length <= 256, "INVALID_TITLE", "META title is invalid.");
  exactObject(meta.generator, ["name", "version"], "INVALID_META", "META generator");
  require(typeof meta.generator.name === "string" && GENERATOR_NAME.test(meta.generator.name) && typeof meta.generator.version === "string" && GENERATOR_VERSION.test(meta.generator.version), "INVALID_META", "META generator identity is invalid.");
  uniqueArray(meta.capabilities, 128, "INVALID_META", "META capabilities", (value) => typeof value === "string" && SHORT_TOKEN.test(value));
  for (const capability of meta.capabilities) require([...BASE_CAPABILITIES, "prepared-paged-state", ...CAPABILITY_ORDER.map(([, value]) => value)].includes(capability), "UNSUPPORTED_REQUIRED_CAPABILITY", `Required capability ${capability} is unknown.`);
  if (meta.optionalCapabilities !== undefined) {
    uniqueArray(meta.optionalCapabilities, 128, "INVALID_META", "META optional capabilities", (value) => typeof value === "string" && SHORT_TOKEN.test(value));
    require(meta.optionalCapabilities.every((value, index) => !meta.capabilities.includes(value) && (index === 0 || meta.optionalCapabilities[index - 1] < value)), "INVALID_META", "META optional capabilities overlap or are unsorted.");
  }
  if (meta.initialExperience !== undefined) require(meta.initialExperience === "animation" || meta.initialExperience === "interaction", "INVALID_META", "META initial experience is invalid.");
  exactObject(meta.conformance, ["executable", "declaredOnly"], "INVALID_META", "META conformance");
  uniqueArray(meta.conformance.executable, 128, "INVALID_META", "META executable conformance", (value) => typeof value === "string" && SHORT_TOKEN.test(value));
  uniqueArray(meta.conformance.declaredOnly, 128, "INVALID_META", "META declared conformance", (value) => typeof value === "string" && SHORT_TOKEN.test(value));
  require(meta.conformance.declaredOnly.length === 0, "CONFORMANCE_CLOSURE_MISMATCH", "Declared-only conformance is unsupported.");
  if (meta.counts !== undefined) {
    exactObject(meta.counts, ["nodes", "shapes", "leaves", "sourceFrames"], "INVALID_META", "META counts", []);
    require(Object.values(meta.counts).every((value) => Number.isSafeInteger(value) && value >= 0), "INVALID_META", "META counts are invalid.");
  }
  const artifactIds = new Set();
  if (meta.artifacts !== undefined) {
    require(Array.isArray(meta.artifacts) && meta.artifacts.length > 0 && meta.artifacts.length <= 64, "INVALID_META", "META artifacts are invalid.");
    let previous = "";
    for (const [index, artifact] of meta.artifacts.entries()) {
      exactObject(artifact, ["id", "role", "byteLength", "decodedByteLength", "digest"], "INVALID_META", `META artifact ${index}`);
      require(typeof artifact.id === "string" && SHORT_TOKEN.test(artifact.id) && artifact.id > previous, "INVALID_META", "META artifacts are not canonically ordered.");
      previous = artifact.id;
      artifactIds.add(artifact.id);
      require(typeof artifact.role === "string" && SHORT_TOKEN.test(artifact.role), "INVALID_META", `META artifact ${artifact.id} role is invalid.`);
      require(Number.isSafeInteger(artifact.byteLength) && artifact.byteLength >= 0 && Number.isSafeInteger(artifact.decodedByteLength) && artifact.decodedByteLength >= 0, "INVALID_META", `META artifact ${artifact.id} sizes are invalid.`);
      exactObject(artifact.digest, ["algorithm", "value"], "INVALID_META", `META artifact ${artifact.id} digest`);
      require(artifact.digest.algorithm === "sha256" && SHA256.test(artifact.digest.value), "INVALID_META", `META artifact ${artifact.id} digest is invalid.`);
    }
  }
  if (meta.claims !== undefined) {
    require(Array.isArray(meta.claims) && meta.claims.length > 0 && meta.claims.length <= 128 && artifactIds.size > 0, "INVALID_META", "META claims are invalid.");
    const kinds = new Set(["license", "locator", "qualification", "redistribution", "revision"]);
    let previous = "";
    for (const [index, claim] of meta.claims.entries()) {
      exactObject(claim, ["artifact", "kind", "value"], "INVALID_META", `META claim ${index}`);
      const key = `${claim.artifact}\0${claim.kind}`;
      require(artifactIds.has(claim.artifact) && kinds.has(claim.kind) && key > previous, "INVALID_META", "META claims are not canonically ordered.");
      previous = key;
      require(typeof claim.value === "string" && [...claim.value].length > 0 && [...claim.value].length <= 512 && !/[\u0000-\u001f\u007f]/u.test(claim.value), "INVALID_META", "META claim value is invalid.");
      require(!/^(?:\/|\\|[A-Za-z]:[\\/]|file:)/u.test(claim.value) && !/(?:\/Users\/|\/home\/|\\Users\\)/u.test(claim.value), "META_LOCAL_PATH", "META claim leaks a local path.");
      if (claim.kind === "locator") {
        let locator;
        try { locator = new URL(claim.value); } catch { require(false, "INVALID_META", "META locator is not an absolute URL."); }
        require(locator.protocol === "https:" && !locator.username && !locator.password && !locator.hash, "INVALID_META", "META locator is unsafe.");
      }
    }
  }
}

function validateTree(tree, records, limits) {
  exactObject(tree, ["version", "mount", "nodes"], "INVALID_TREE", "TREE");
  require(tree.version === 0, "UNSUPPORTED_TREE_SCHEMA", "TREE version must be 0.");
  exactObject(tree.mount, ["behavior", "attributes", "styles", "resourceStyles"], "INVALID_MOUNT", "TREE mount", ["behavior", "attributes"]);
  require(tree.mount.behavior === "replace-children", "INVALID_MOUNT", "TREE mount behavior is unsupported.");
  require(Array.isArray(tree.mount.attributes) && tree.mount.attributes.length <= limits.maxAttributesPerNode, "INVALID_MOUNT", "TREE mount attributes are excessive.");
  const mountNames = new Set();
  for (const entry of tree.mount.attributes) {
    require(Array.isArray(entry) && entry.length === 2, "INVALID_MOUNT", "TREE mount attribute is malformed.");
    attribute(entry[0], entry[1], true, "Mount");
    require(!mountNames.has(entry[0]), "INVALID_ATTRIBUTE", "TREE mount attribute is duplicated.");
    mountNames.add(entry[0]);
  }
  exactObject(tree.mount.styles ?? Object.create(null), [...MOUNT_STYLES], "INVALID_MOUNT", "TREE mount styles", []);
  for (const [name, value] of Object.entries(tree.mount.styles ?? {})) {
    require(MOUNT_STYLES.has(name), "UNSAFE_STYLE_PROPERTY", `Mount style ${name} is unsupported.`);
    safeStyle(value, `Mount style ${name}`);
    if (name === "position") require(value === "relative", "INVALID_MOUNT", "Mount position must be relative.");
  }
  resourceStyles(tree.mount.resourceStyles, records, "Mount");
  require(Array.isArray(tree.nodes) && tree.nodes.length <= limits.maxNodes, "NODE_COUNT_LIMIT", "TREE has too many nodes.");
  const ids = new Set();
  const byId = new Map();
  const siblings = new Map();
  const parentIndices = new Set();
  const depths = [];
  for (const [index, node] of tree.nodes.entries()) {
    exactObject(node, ["index", "id", "parent", "sibling", "namespace", "name", "classes", "attributes", "styles", "resourceAttributes", "resourceStyles"], "INVALID_NODE", `TREE node ${index}`, ["index", "id", "parent", "sibling", "namespace", "name"]);
    require(node.index === index, "NODE_INDEX", `TREE node ${index} index is noncanonical.`);
    const id = stableId(node.id, `TREE node ${index} id`);
    require(!ids.has(id), "DUPLICATE_NODE_ID", `TREE node ${id} is duplicated.`);
    ids.add(id);
    byId.set(id, node);
    require(node.namespace === XHTML, "UNSUPPORTED_NAMESPACE", `TREE node ${id} namespace is unsupported.`);
    require(ELEMENTS.has(node.name), "FORBIDDEN_ELEMENT", `TREE node ${id} element is unsupported.`);
    require(Number.isSafeInteger(node.parent) && node.parent >= -1 && node.parent < index, "INVALID_PARENT", `TREE node ${id} parent is invalid.`);
    if (node.parent >= 0) parentIndices.add(node.parent);
    const expectedSibling = siblings.get(node.parent) ?? 0;
    require(node.sibling === expectedSibling, "INVALID_SIBLING", `TREE node ${id} sibling is not ${expectedSibling}.`);
    siblings.set(node.parent, expectedSibling + 1);
    const depth = node.parent === -1 ? 1 : depths[node.parent] + 1;
    require(depth <= limits.maxTreeDepth, "TREE_DEPTH_LIMIT", `TREE node ${id} is too deep.`);
    depths.push(depth);
    uniqueArray(node.classes ?? [], limits.maxClassesPerNode, "INVALID_CLASS", `TREE node ${id} classes`, (value) => typeof value === "string" && CLASS.test(value));
    plainObject(node.attributes ?? Object.create(null), "INVALID_ATTRIBUTES", `TREE node ${id} attributes`);
    require(Object.keys(node.attributes ?? {}).length <= limits.maxAttributesPerNode, "ATTRIBUTE_COUNT_LIMIT", `TREE node ${id} has too many attributes.`);
    for (const [name, value] of Object.entries(node.attributes ?? {})) attribute(name, value, false, `TREE node ${id}`);
    exactObject(node.styles ?? Object.create(null), [...NODE_STYLES], "INVALID_STYLES", `TREE node ${id} styles`, []);
    require(Object.keys(node.styles ?? {}).length <= limits.maxStylesPerNode, "STYLE_COUNT_LIMIT", `TREE node ${id} has too many styles.`);
    for (const [name, value] of Object.entries(node.styles ?? {})) { require(NODE_STYLES.has(name), "UNSAFE_STYLE_PROPERTY", `TREE node ${id} style ${name} is unsupported.`); safeStyle(value, `TREE node ${id} style ${name}`); }
    exactObject(node.resourceAttributes ?? Object.create(null), ["src"], "INVALID_RESOURCE_ATTRIBUTES", `TREE node ${id} resource attributes`, []);
    for (const [name, resource] of Object.entries(node.resourceAttributes ?? {})) require(name === "src" && records.get(resource)?.kind === "image", "RESOURCE_ROLE_MISMATCH", `TREE node ${id} resource attribute is invalid.`);
    resourceStyles(node.resourceStyles, records, `TREE node ${id}`);
  }
  for (const node of tree.nodes) if (!parentIndices.has(node.index)) require(node.attributes?.["aria-hidden"] === "true", "ACCESSIBILITY_REQUIRED", `Terminal visual node ${node.id} must be aria-hidden.`);
  return { ids, byId };
}

function validateCssBinding(cssBinding, records, mount, limits) {
  exactObject(cssBinding, ["version", "stylesheets"], "INVALID_CSS_BINDING", "CSSB");
  require(cssBinding.version === 0, "UNSUPPORTED_CSS_BINDING_SCHEMA", "CSSB version must be 0.");
  require(Array.isArray(cssBinding.stylesheets) && cssBinding.stylesheets.length > 0 && cssBinding.stylesheets.length <= records.size, "INVALID_CSS_BINDING", "CSSB stylesheets are invalid.");
  const ids = new Set();
  for (const binding of cssBinding.stylesheets) {
    exactObject(binding, ["id", "resource", "scope", "assetTokens"], "INVALID_CSS_BINDING", "Stylesheet binding");
    assertResourceId(binding.id, "Stylesheet binding id");
    require(!ids.has(binding.id) && records.get(binding.resource)?.kind === "stylesheet", "RESOURCE_ROLE_MISMATCH", `Stylesheet binding ${binding.id} is duplicated or not a stylesheet.`);
    ids.add(binding.id);
    const scope = /^\[([a-z0-9-]{1,64})="([A-Za-z0-9._-]{1,64})"\]$/u.exec(binding.scope);
    require(scope && mount.attributes.some(([name, value]) => name === scope[1] && value === scope[2]), "CSS_SCOPE_MISMATCH", `Stylesheet ${binding.id} scope does not match TREE.`);
    require(Array.isArray(binding.assetTokens) && binding.assetTokens.length <= limits.maxCssAssetTokens, "CSS_TOKEN_LIMIT", `Stylesheet ${binding.id} tokens are excessive.`);
    const tokens = new Set();
    for (const token of binding.assetTokens) {
      exactObject(token, ["token", "resource"], "INVALID_CSS_BINDING", `Stylesheet ${binding.id} token`);
      require(typeof token.token === "string" && /^dom-asset:[a-z][a-z0-9._-]{0,63}$/u.test(token.token) && !tokens.has(token.token) && records.get(token.resource)?.kind === "image", "INVALID_CSS_TOKEN", `Stylesheet ${binding.id} token is invalid.`);
      tokens.add(token.token);
    }
  }
}

function collectTargets(value, maximum, depthLimit) {
  const output = [];
  const stack = [{ value, depth: 0 }];
  let containers = 0;
  let entries = 0;
  const structuralLimit = maximum * 4 + depthLimit;
  while (stack.length) {
    const current = stack.pop();
    if (typeof current.value === "string") { output.push(current.value); require(output.length <= maximum, "TARGET_CARDINALITY_MISMATCH", "Binding targets exceed their limit."); continue; }
    require(current.value && typeof current.value === "object" && current.depth < depthLimit, "INVALID_TARGETS", "Binding target graph is invalid or too deep.");
    containers += 1;
    require(containers <= structuralLimit, "TARGET_CARDINALITY_MISMATCH", "Binding target containers exceed their limit.");
    const values = Array.isArray(current.value) ? current.value : Object.values(current.value);
    entries += values.length;
    require(entries <= structuralLimit, "TARGET_CARDINALITY_MISMATCH", "Binding target entries exceed their limit.");
    for (let index = values.length - 1; index >= 0; index -= 1) stack.push({ value: values[index], depth: current.depth + 1 });
  }
  return output;
}

function validateStateAndBindings(state, bindings, nodeIds, limits) {
  exactObject(state, ["version", "channels"], "INVALID_STATE", "STAT");
  require(state.version === 0 && Array.isArray(state.channels) && state.channels.length <= limits.maxStateChannels, "STATE_CHANNEL_LIMIT", "STAT is invalid or excessive.");
  const states = new Map();
  let previous = "";
  for (const channel of state.channels) {
    exactObject(channel, ["id", "codec", "data"], "INVALID_STATE", "State channel");
    const id = stableId(channel.id, "State channel id");
    require(id > previous && !states.has(id) && [...CODECS.values()].includes(channel.codec), "STATE_CHANNEL_ORDER", "State channels are unsorted, duplicated, or unsupported.");
    previous = id;
    states.set(id, channel);
  }
  exactObject(bindings, ["version", "inputs", "channels"], "INVALID_BINDINGS", "BIND");
  require(bindings.version === 0 && Array.isArray(bindings.inputs) && bindings.inputs.length <= limits.maxBindingInputs && Array.isArray(bindings.channels) && bindings.channels.length <= limits.maxBindingChannels, "INVALID_BINDINGS", "BIND is invalid or excessive.");
  const inputs = new Map();
  previous = "";
  for (const input of bindings.inputs) {
    exactObject(input, ["id", "type", "default"], "INVALID_BINDINGS", "Binding input", ["id", "type"]);
    const id = stableId(input.id, "Binding input id");
    require(id > previous && !inputs.has(id) && ["boolean", "float", "uint"].includes(input.type), "INPUT_ORDER", "Binding inputs are unsorted, duplicated, or mistyped.");
    previous = id;
    if (Object.hasOwn(input, "default")) require(input.type === "boolean" ? typeof input.default === "boolean" : input.type === "float" ? typeof input.default === "number" && Number.isFinite(input.default) : Number.isSafeInteger(input.default) && input.default >= 0, "INVALID_INPUT_DEFAULT", `Input ${id} default is invalid.`);
    inputs.set(id, input);
  }
  const channels = new Map();
  const interpreters = new Set();
  const boundStates = new Set();
  const usedInputs = new Set();
  previous = "";
  for (const channel of bindings.channels) {
    exactObject(channel, ["id", "state", "interpreter", "status", "inputs", "targets", "sinks", "parameters"], "INVALID_BINDINGS", "Binding channel", ["id", "state", "interpreter", "status", "inputs", "targets", "sinks"]);
    const id = stableId(channel.id, "Binding channel id");
    const stateChannel = states.get(channel.state);
    require(id > previous && !channels.has(id), "BINDING_CHANNEL_ORDER", "Binding channels are unsorted or duplicated.");
    previous = id;
    require(stateChannel && CODECS.get(channel.interpreter) === stateChannel.codec && !interpreters.has(channel.interpreter) && !boundStates.has(channel.state), "STATE_INTERPRETER_MISMATCH", `Binding ${id} does not uniquely match its state codec.`);
    require(channel.status === "executable", "INVALID_BINDING_STATUS", `Binding ${id} is not executable.`);
    exactArray(channel.inputs, INPUTS[channel.interpreter], "INVALID_BINDING_INPUTS", `Binding ${id} inputs`);
    if (SINKS[channel.interpreter]) exactArray(channel.sinks, SINKS[channel.interpreter], "UNSUPPORTED_SINK", `Binding ${id} sinks`);
    for (const input of channel.inputs) { require(inputs.has(input), "MISSING_INPUT", `Binding ${id} input ${input} is undeclared.`); usedInputs.add(input); }
    const targets = collectTargets(channel.targets, nodeIds.size + 1, limits.maxTreeDepth);
    require((targets.length > 0 || channel.interpreter === "polycss-surface@0") && new Set(targets).size === targets.length, "DUPLICATE_TARGET", `Binding ${id} targets are empty or duplicated.`);
    for (const target of targets) require(target === "$host" || nodeIds.has(target), "MISSING_TARGET_NODE", `Binding ${id} target ${target} is missing.`);
    interpreters.add(channel.interpreter);
    boundStates.add(channel.state);
    channels.set(id, channel);
  }
  require(states.size === boundStates.size && [...states.keys()].every((id) => boundStates.has(id)), "UNBOUND_STATE_CHANNEL", "A state channel is not bound exactly once.");
  require(inputs.size === usedInputs.size && [...inputs.keys()].every((id) => usedInputs.has(id)), "UNUSED_INPUT", "A declared input is unused.");
  return { states, channels, inputs, interpreters };
}

function samePlaybackTimeline(left, right, profile = false) {
  return (!profile || left.profileId === right.profileId)
    && left.introTicks === right.introTicks
    && left.loopTicks === right.loopTicks
    && exactEqualArray(left.frames, right.frames)
    && ((left.deadlineMicros === undefined && right.deadlineMicros === undefined)
      || (left.deadlineMicros !== undefined && right.deadlineMicros !== undefined && exactEqualArray(left.deadlineMicros, right.deadlineMicros)));
}

function validatePlaybackBanks(packet, initial, parameters, validateTimeline, timeline, timelineTickCount, limits, code, label) {
  const hasInitialBankId = Object.hasOwn(packet, "initialBankId");
  const hasBanks = Object.hasOwn(packet, "banks");
  require(hasInitialBankId === hasBanks, code, `${label} initialBankId and banks must be declared together.`);
  if (!hasBanks) return timelineTickCount;
  const initialBankId = stableId(packet.initialBankId, `${label} initial bank id`);
  require(Array.isArray(packet.banks) && packet.banks.length > 0 && packet.banks.length <= 64, code, `${label} banks are missing or excessive.`);
  const bankIds = new Set();
  const entryFrames = new Set();
  let previousBankId = "";
  let initialBank;
  for (const [bankIndex, value] of packet.banks.entries()) {
    const bank = exactObject(value, ["id", "entryFrame", "timeline", "profileTimelines"], code, `${label} bank ${bankIndex}`, ["id", "entryFrame", "timeline"]);
    const id = stableId(bank.id, `${label} bank ${bankIndex} id`);
    require(id > previousBankId, code, `${label} banks must be ordered by id without duplicates.`);
    previousBankId = id;
    bankIds.add(id);
    require(Number.isSafeInteger(bank.entryFrame) && bank.entryFrame >= 1 && bank.entryFrame <= parameters.frameCount && !entryFrames.has(bank.entryFrame), code, `${label} bank ${id} entry frame is invalid or duplicated.`);
    entryFrames.add(bank.entryFrame);
    const bankTimeline = validateTimeline(bank.timeline, `${label} bank ${id} timeline`, false, bank.entryFrame);
    timelineTickCount += bankTimeline.frames.length;
    let bankProfiles;
    if (bank.profileTimelines !== undefined) {
      require(Array.isArray(bank.profileTimelines) && bank.profileTimelines.length > 0 && bank.profileTimelines.length <= 16, code, `${label} bank ${id} profile timelines are missing or excessive.`);
      bankProfiles = [];
      const profileIds = new Set();
      for (const [profileIndex, value] of bank.profileTimelines.entries()) {
        const profileTimeline = validateTimeline(value, `${label} bank ${id} profile timeline ${profileIndex}`, true, bank.entryFrame);
        require(!profileIds.has(profileTimeline.profileId), code, `${label} bank ${id} profile timeline id ${profileTimeline.profileId} is duplicated.`);
        profileIds.add(profileTimeline.profileId);
        bankProfiles.push(profileTimeline);
        timelineTickCount += profileTimeline.frames.length;
      }
    }
    require(timelineTickCount <= limits.maxTimelineTicks, "TIMELINE_LIMIT", `${label} bank timelines exceed the aggregate tick limit.`);
    if (id === initialBankId) initialBank = { ...bank, timeline: bankTimeline, ...(bankProfiles === undefined ? {} : { profileTimelines: bankProfiles }) };
  }
  require(bankIds.has(initialBankId) && initialBank?.entryFrame === initial.sourceFrame, code, `${label} initial bank is missing or does not own the canonical initial frame.`);
  require(samePlaybackTimeline(initialBank.timeline, timeline), code, `${label} initial bank timeline does not match the canonical top-level timeline.`);
  const topProfiles = packet.profileTimelines ?? [];
  const initialProfiles = initialBank.profileTimelines ?? [];
  require(initialProfiles.length === topProfiles.length && initialProfiles.every((profile, index) => samePlaybackTimeline(profile, topProfiles[index], true)), code, `${label} initial bank profile timelines do not match the canonical top-level profile timelines.`);
  return timelineTickCount;
}

function validatePlayback(state, binding, inputs, limits) {
  const tick = inputs.get("time.tick");
  require(tick?.type === "uint" && !Object.hasOwn(tick, "default"), "INVALID_PLAYBACK_BINDING", "Playback time.tick must be an un-defaulted uint.");
  const targets = exactObject(binding.targets, ["model", "shapes", "leaves"], "INVALID_PLAYBACK_BINDING", "Playback targets");
  stableId(targets.model, "Playback model target");
  uniqueTargets(targets.shapes, "Playback shape");
  uniqueTargets(targets.leaves, "Playback leaf");
  const parameterFields = ["frameCount", "baseSceneTransform", "tickRateHz", "tickIntervalUs", "catchUpPolicy"];
  const parameters = exactObject(binding.parameters, parameterFields, "INVALID_PLAYBACK_BINDING", "Playback parameters", ["frameCount", "baseSceneTransform"]);
  require(Number.isSafeInteger(parameters.frameCount) && parameters.frameCount > 0 && parameters.frameCount <= limits.maxFrames, "FRAME_CARDINALITY_MISMATCH", "Playback frameCount is invalid or excessive.");
  validateTickCadence(parameters, "INVALID_PLAYBACK_BINDING", "Playback");
  require(parameters.catchUpPolicy === undefined || ["bounded", "single-step", "elapsed"].includes(parameters.catchUpPolicy), "INVALID_PLAYBACK_BINDING", "Playback catchUpPolicy is invalid.");
  safeStyle(parameters.baseSceneTransform, "Playback base scene transform");

  exactObject(state.data, ["packet", "leafFit"], "INVALID_PLAYBACK_STATE", "Playback state");
  const packetFields = ["version", "layout", "shapeCount", "leafCount", "appearances", "timeline", "profileTimelines", "initialBankId", "banks", "initial", "frameRows", "shapeChanges", "leafChanges", "transforms"];
  const packet = exactObject(state.data.packet, packetFields, "INVALID_PLAYBACK_STATE", "Playback packet", packetFields.filter((field) => !["profileTimelines", "initialBankId", "banks"].includes(field)));
  require(packet.version === 0 && packet.layout === "delta-component-streams@0", "INVALID_PLAYBACK_STATE", "Playback version/layout is invalid.");
  require(Number.isSafeInteger(packet.shapeCount) && packet.shapeCount >= 0 && packet.shapeCount <= limits.maxNodes, "TARGET_CARDINALITY_MISMATCH", "Playback shapeCount is invalid.");
  require(Number.isSafeInteger(packet.leafCount) && packet.leafCount >= 0 && packet.leafCount <= Math.min(limits.maxNodes, 65_536), "TARGET_CARDINALITY_MISMATCH", "Playback leafCount is invalid.");
  require(packet.shapeCount === targets.shapes.length && packet.leafCount === targets.leaves.length, "TARGET_CARDINALITY_MISMATCH", "Playback target counts disagree.");
  require(packet.leafCount * parameters.frameCount <= limits.maxVisibilityCells, "VISIBILITY_ALLOCATION_LIMIT", "Playback visibility allocation is excessive.");
  require(Array.isArray(state.data.leafFit) && state.data.leafFit.length === packet.leafCount, "TARGET_CARDINALITY_MISMATCH", "Playback leafFit differs from leafCount.");
  for (const [index, fit] of state.data.leafFit.entries()) {
    exactObject(fit, ["canonicalSize"], "INVALID_PLAYBACK_STATE", `Playback leafFit ${index}`);
    require(Number.isSafeInteger(fit.canonicalSize) && fit.canonicalSize > 0 && fit.canonicalSize <= 65_535, "INVALID_PLAYBACK_STATE", `Playback leafFit ${index} is invalid.`);
  }

  require(Array.isArray(packet.appearances) && packet.appearances.length > 0 && packet.appearances.length <= limits.maxFrames, "INVALID_PLAYBACK_STATE", "Playback appearances are invalid or excessive.");
  const appearanceIds = new Set();
  for (const [index, appearance] of packet.appearances.entries()) {
    require(Array.isArray(appearance) && appearance.length === 3, "INVALID_PLAYBACK_STATE", `Playback appearance ${index} is malformed.`);
    const id = stableId(appearance[0], `Playback appearance ${index} id`);
    require(!appearanceIds.has(id) && finiteF32(appearance[1]) && appearance[1] > 0 && finiteF32(appearance[2]), "INVALID_PLAYBACK_STATE", `Playback appearance ${index} is invalid.`);
    appearanceIds.add(id);
  }

  const transforms = exactObject(packet.transforms, ["count", "groups"], "INVALID_PLAYBACK_STATE", "Playback transforms");
  require(Number.isSafeInteger(transforms.count) && transforms.count > 0 && transforms.count <= limits.maxPreparedTransforms, "TRANSFORM_ALLOCATION_LIMIT", "Playback transform count is invalid or excessive.");
  require(Array.isArray(transforms.groups) && transforms.groups.length <= limits.maxNodes, "TRANSFORM_ALLOCATION_LIMIT", "Playback transform groups are invalid or excessive.");

  const initial = exactObject(packet.initial, ["sourceFrame", "appearance", "modelTransform", "shapes", "leaves"], "INVALID_PLAYBACK_STATE", "Playback initial state");
  require(Number.isSafeInteger(initial.sourceFrame) && initial.sourceFrame >= 1 && initial.sourceFrame <= parameters.frameCount, "FRAME_CARDINALITY_MISMATCH", "Playback initial source frame is invalid.");
  require(Number.isSafeInteger(initial.appearance) && initial.appearance >= 0 && initial.appearance < packet.appearances.length, "INVALID_PLAYBACK_STATE", "Playback initial appearance is invalid.");
  require(Number.isSafeInteger(initial.modelTransform) && initial.modelTransform >= 0 && initial.modelTransform < transforms.count, "INVALID_PLAYBACK_STATE", "Playback initial model transform is invalid.");
  const initialShapes = exactObject(initial.shapes, ["count", "transforms", "visibility"], "INVALID_PLAYBACK_STATE", "Playback initial shapes");
  require(initialShapes.count === packet.shapeCount, "TARGET_CARDINALITY_MISMATCH", "Playback initial shape count differs.");
  const initialShapeTransforms = cumulativeReferences(initialShapes.transforms, packet.shapeCount, "INVALID_PLAYBACK_STATE", "Playback initial shape transforms");
  integerArray(initialShapes.visibility, packet.shapeCount, "INVALID_PLAYBACK_STATE", "Playback initial shape visibility", { minimum: 0, upper: 1 });
  require(initialShapes.visibility.length === packet.shapeCount, "TARGET_CARDINALITY_MISMATCH", "Playback initial visibility differs from shapeCount.");
  const initialLeaves = exactObject(initial.leaves, ["count", "transforms"], "INVALID_PLAYBACK_STATE", "Playback initial leaves");
  require(initialLeaves.count === packet.leafCount, "TARGET_CARDINALITY_MISMATCH", "Playback initial leaf count differs.");
  const initialLeafTransforms = cumulativeReferences(initialLeaves.transforms, packet.leafCount, "INVALID_PLAYBACK_STATE", "Playback initial leaf transforms");
  require([...initialShapeTransforms, ...initialLeafTransforms].every((index) => index < transforms.count), "INVALID_PLAYBACK_STATE", "Playback initial state references an absent transform.");

  const validateTimeline = (value, label, profile, entryFrame = initial.sourceFrame) => {
    const required = profile ? ["profileId", "introTicks", "loopTicks", "frames"] : ["introTicks", "loopTicks", "frames"];
    const timeline = exactObject(value, [...required, "deadlineMicros"], "INVALID_PLAYBACK_STATE", label, required);
    if (profile) stableId(timeline.profileId, `${label} profile id`);
    require(Number.isSafeInteger(timeline.introTicks) && timeline.introTicks >= 0 && Number.isSafeInteger(timeline.loopTicks) && timeline.loopTicks > 0, "TIMELINE_LIMIT", `${label} ranges are invalid.`);
    integerArray(timeline.frames, limits.maxTimelineTicks, "TIMELINE_LIMIT", `${label} frames`, { minimum: 1, upper: parameters.frameCount });
    require(timeline.frames.length === timeline.introTicks + timeline.loopTicks && timeline.frames[0] === entryFrame, "TIMELINE_LIMIT", `${label} coverage or entry frame is invalid.`);
    if (timeline.deadlineMicros !== undefined) {
      integerArray(timeline.deadlineMicros, limits.maxTimelineTicks + 1, "TIMELINE_LIMIT", `${label} deadlines`, { minimum: 0 });
      require(timeline.deadlineMicros.length === timeline.frames.length + 1 && timeline.deadlineMicros[0] === 0 && timeline.deadlineMicros.every((deadline, index) => index === 0 || deadline > timeline.deadlineMicros[index - 1]), "TIMELINE_LIMIT", `${label} deadlines are incomplete or unordered.`);
      require(timeline.deadlineMicros.every((deadline, index) => index === 0 || deadline - timeline.deadlineMicros[index - 1] <= 2_147_483_647_000), "TIMELINE_LIMIT", `${label} deadline interval exceeds the browser timer bound.`);
    }
    return timeline;
  };
  const timeline = validateTimeline(packet.timeline, "Playback timeline", false);
  let timelineTickCount = timeline.frames.length;
  if (packet.profileTimelines !== undefined) {
    require(Array.isArray(packet.profileTimelines) && packet.profileTimelines.length > 0 && packet.profileTimelines.length <= 16, "INVALID_PLAYBACK_STATE", "Playback profile timelines are missing or excessive.");
    const profileIds = new Set();
    for (const [index, value] of packet.profileTimelines.entries()) {
      const profileTimeline = validateTimeline(value, `Playback profile timeline ${index}`, true);
      require(!profileIds.has(profileTimeline.profileId), "INVALID_PLAYBACK_STATE", `Playback profile timeline id ${profileTimeline.profileId} is duplicated.`);
      profileIds.add(profileTimeline.profileId);
      timelineTickCount += profileTimeline.frames.length;
      require(timelineTickCount <= limits.maxTimelineTicks, "TIMELINE_LIMIT", "Playback baseline and profile timelines exceed the aggregate tick limit.");
    }
  }
  timelineTickCount = validatePlaybackBanks(packet, initial, parameters, validateTimeline, timeline, timelineTickCount, limits, "INVALID_PLAYBACK_STATE", "Playback");

  const shapeChanges = exactObject(packet.shapeChanges, ["sources", "transforms", "visibility"], "INVALID_PLAYBACK_STATE", "Playback shape changes");
  const leafChanges = exactObject(packet.leafChanges, ["sources", "transforms"], "INVALID_PLAYBACK_STATE", "Playback leaf changes");
  integerArray(shapeChanges.sources, limits.maxPreparedChanges, "STATE_CHANGE_LIMIT", "Playback shape sources");
  integerArray(shapeChanges.transforms, limits.maxPreparedChanges, "STATE_CHANGE_LIMIT", "Playback shape transforms");
  integerArray(shapeChanges.visibility, limits.maxPreparedChanges, "STATE_CHANGE_LIMIT", "Playback shape visibility", { minimum: 0, upper: 1 });
  integerArray(leafChanges.sources, limits.maxPreparedChanges, "STATE_CHANGE_LIMIT", "Playback leaf sources");
  integerArray(leafChanges.transforms, limits.maxPreparedChanges, "STATE_CHANGE_LIMIT", "Playback leaf transforms");
  require(shapeChanges.sources.length === shapeChanges.transforms.length && shapeChanges.sources.length === shapeChanges.visibility.length && leafChanges.sources.length === leafChanges.transforms.length, "STATE_COLUMN_MISMATCH", "Playback change columns differ in length.");
  require(Array.isArray(packet.frameRows) && packet.frameRows.length === parameters.frameCount, "FRAME_CARDINALITY_MISMATCH", "Playback frame rows differ from frameCount.");

  const owners = new Array(transforms.count);
  const claim = (index, owner) => {
    require(Number.isSafeInteger(index) && index >= 0 && index < transforms.count, "INVALID_PLAYBACK_STATE", "Playback references an absent transform.");
    if (owners[index] === undefined) owners[index] = owner;
    else require(owners[index] === owner || (owners[index].startsWith("shape:") && owner.startsWith("shape:")), "TRANSFORM_GROUP_MISMATCH", "Playback transform aliases incompatible owners.");
  };
  claim(initial.modelTransform, "model");
  initialShapeTransforms.forEach((transform, index) => claim(transform, `shape:${index}`));
  initialLeafTransforms.forEach((transform, index) => claim(transform, `leaf:${index}`));
  let shapeCursor = 0;
  let leafCursor = 0;
  let shapeTransform = 0;
  let leafTransform = 0;
  for (const [index, row] of packet.frameRows.entries()) {
    require(Array.isArray(row) && row.length === 7 && row.every(Number.isSafeInteger) && row[0] === index + 1, "INVALID_FRAME_ROW", `Playback frame row ${index} is malformed.`);
    require(row[1] >= 0 && row[1] < packet.appearances.length && (row[2] === -1 || (row[2] >= 0 && row[2] < transforms.count)), "INVALID_FRAME_ROW", `Playback frame row ${index} references invalid state.`);
    if (row[2] !== -1) claim(row[2], "model");
    require(row[3] === shapeCursor && row[4] >= 0 && row[3] + row[4] <= shapeChanges.sources.length, "STATE_COLUMN_MISMATCH", `Playback frame row ${index} shape range is noncanonical.`);
    let shape = 0;
    for (let cursor = row[3]; cursor < row[3] + row[4]; cursor += 1) {
      shape += shapeChanges.sources[cursor];
      shapeTransform += shapeChanges.transforms[cursor];
      require(shape >= 0 && shape < packet.shapeCount, "STATE_COLUMN_MISMATCH", `Playback frame row ${index} has an invalid shape.`);
      claim(shapeTransform, `shape:${shape}`);
    }
    shapeCursor += row[4];
    require(row[5] === leafCursor && row[6] >= 0 && row[5] + row[6] <= leafChanges.sources.length, "STATE_COLUMN_MISMATCH", `Playback frame row ${index} leaf range is noncanonical.`);
    let leaf = 0;
    for (let cursor = row[5]; cursor < row[5] + row[6]; cursor += 1) {
      leaf += leafChanges.sources[cursor];
      leafTransform += leafChanges.transforms[cursor];
      require(leaf >= 0 && leaf < packet.leafCount, "STATE_COLUMN_MISMATCH", `Playback frame row ${index} has an invalid leaf.`);
      claim(leafTransform, `leaf:${leaf}`);
    }
    leafCursor += row[6];
  }
  require(shapeCursor === shapeChanges.sources.length && leafCursor === leafChanges.sources.length, "STATE_COLUMN_MISMATCH", "Playback change tables contain unreferenced rows.");
  const inferredGroups = new Map();
  for (let index = 0; index < owners.length; index += 1) {
    const owner = owners[index];
    require(typeof owner === "string", "TRANSFORM_GROUP_MISMATCH", `Playback transform ${index} is unowned.`);
    if (!inferredGroups.has(owner)) inferredGroups.set(owner, []);
    inferredGroups.get(owner).push(index);
  }
  require(transforms.groups.length === inferredGroups.size, "TRANSFORM_GROUP_MISMATCH", "Playback transform groups differ from inferred owners.");
  for (const [groupIndex, [owner, indices]] of [...inferredGroups].entries()) {
    const group = exactObject(transforms.groups[groupIndex], ["encoding", "empty", "scales", "columns"], "INVALID_PLAYBACK_STATE", `Playback transform group ${groupIndex}`);
    require(group.encoding === "decimal-component-streams" || group.encoding === "source-milli-fitted-leaf", "INVALID_PLAYBACK_STATE", `Playback transform group ${groupIndex} encoding is unsupported.`);
    if (group.encoding === "source-milli-fitted-leaf") require(owner.startsWith("leaf:"), "TRANSFORM_GROUP_MISMATCH", `Playback fitted group ${groupIndex} is not leaf-owned.`);
    integerArray(group.empty, indices.length, "INVALID_PLAYBACK_STATE", `Playback transform group ${groupIndex} empty rows`, { minimum: 0, upper: Math.max(0, indices.length - 1), unique: true });
    require(group.empty.every((value, index) => index === 0 || group.empty[index - 1] < value), "INVALID_PLAYBACK_STATE", `Playback transform group ${groupIndex} empty rows are unsorted.`);
    require(Array.isArray(group.scales) && group.scales.length === 12 && group.scales.every((scale) => Number.isSafeInteger(scale) && scale >= 0), "INVALID_PLAYBACK_STATE", `Playback transform group ${groupIndex} scales are invalid.`);
    if (group.encoding === "source-milli-fitted-leaf") require(group.scales.every((scale) => scale === 1000), "INVALID_PLAYBACK_STATE", `Playback fitted group ${groupIndex} scales are invalid.`);
    const presentCount = indices.length - group.empty.length;
    require(Array.isArray(group.columns) && group.columns.length === 12, "INVALID_PLAYBACK_STATE", `Playback transform group ${groupIndex} must have 12 columns.`);
    group.columns.forEach((column, columnIndex) => {
      require(Array.isArray(column) && column.length === presentCount && column.every((value) => typeof value === "number" && Number.isFinite(value)), "INVALID_PLAYBACK_STATE", `Playback transform group ${groupIndex} column ${columnIndex} is invalid.`);
      if (group.scales[columnIndex] > 0) {
        let current = 0;
        for (const delta of column) {
          require(Number.isSafeInteger(delta), "INVALID_PLAYBACK_STATE", `Playback transform group ${groupIndex} scaled column is noninteger.`);
          current += delta;
          require(Number.isSafeInteger(current) && Number.isFinite(current / group.scales[columnIndex]), "INVALID_PLAYBACK_STATE", `Playback transform group ${groupIndex} column overflows.`);
        }
      }
    });
  }
  return packet;
}

function validatePagedPlayback(state, binding, inputs, limits) {
  const tick = inputs.get("time.tick");
  require(tick?.type === "uint" && !Object.hasOwn(tick, "default"), "INVALID_PLAYBACK_BINDING", "Paged playback time.tick must be an un-defaulted uint.");
  const targets = exactObject(binding.targets, ["model", "shapes", "leaves"], "INVALID_PLAYBACK_BINDING", "Paged playback targets");
  stableId(targets.model, "Paged playback model target");
  uniqueTargets(targets.shapes, "Paged playback shape");
  uniqueTargets(targets.leaves, "Paged playback leaf");
  const parameterFields = ["frameCount", "baseSceneTransform", "tickRateHz", "tickIntervalUs", "catchUpPolicy"];
  const parameters = exactObject(binding.parameters, parameterFields, "INVALID_PLAYBACK_BINDING", "Paged playback parameters", ["frameCount", "baseSceneTransform"]);
  require(Number.isSafeInteger(parameters.frameCount) && parameters.frameCount > 0 && parameters.frameCount <= limits.maxPagedFrames, "FRAME_CARDINALITY_MISMATCH", "Paged playback frameCount is invalid or excessive.");
  validateTickCadence(parameters, "INVALID_PLAYBACK_BINDING", "Paged playback");
  require(parameters.catchUpPolicy === undefined || ["bounded", "single-step", "elapsed"].includes(parameters.catchUpPolicy), "INVALID_PLAYBACK_BINDING", "Paged playback catchUpPolicy is invalid.");
  safeStyle(parameters.baseSceneTransform, "Paged playback base scene transform");

  exactObject(state.data, ["packet"], "INVALID_PAGED_PLAYBACK_STATE", "Paged playback state");
  const packet = exactObject(state.data.packet, ["version", "shapeCount", "leafCount", "appearances", "timeline", "profileTimelines", "initialBankId", "banks", "initial", "pages", "lookaheadPages", "maxResidentPages"], "INVALID_PAGED_PLAYBACK_STATE", "Paged playback packet", ["version", "shapeCount", "leafCount", "appearances", "timeline", "initial", "pages", "lookaheadPages", "maxResidentPages"]);
  require(packet.version === 0, "INVALID_PAGED_PLAYBACK_STATE", "Paged playback version must be zero.");
  require(Number.isSafeInteger(packet.shapeCount) && packet.shapeCount >= 0 && packet.shapeCount <= limits.maxNodes, "TARGET_CARDINALITY_MISMATCH", "Paged playback shapeCount is invalid.");
  require(Number.isSafeInteger(packet.leafCount) && packet.leafCount >= 0 && packet.leafCount <= Math.min(limits.maxNodes, 65_536), "TARGET_CARDINALITY_MISMATCH", "Paged playback leafCount is invalid.");
  require(packet.shapeCount === targets.shapes.length && packet.leafCount === targets.leaves.length, "TARGET_CARDINALITY_MISMATCH", "Paged playback target counts disagree.");

  require(Array.isArray(packet.appearances) && packet.appearances.length > 0 && packet.appearances.length <= limits.maxFrames, "INVALID_PAGED_PLAYBACK_STATE", "Paged playback appearances are invalid or excessive.");
  const appearanceIds = new Set();
  for (const [index, appearance] of packet.appearances.entries()) {
    require(Array.isArray(appearance) && appearance.length === 3, "INVALID_PAGED_PLAYBACK_STATE", `Paged playback appearance ${index} is malformed.`);
    const id = stableId(appearance[0], `Paged playback appearance ${index} id`);
    require(!appearanceIds.has(id) && finiteF32(appearance[1]) && appearance[1] > 0 && finiteF32(appearance[2]), "INVALID_PAGED_PLAYBACK_STATE", `Paged playback appearance ${index} is invalid.`);
    appearanceIds.add(id);
  }
  const initial = exactObject(packet.initial, ["sourceFrame", "appearance"], "INVALID_PAGED_PLAYBACK_STATE", "Paged playback initial state");
  require(Number.isSafeInteger(initial.sourceFrame) && initial.sourceFrame >= 1 && initial.sourceFrame <= parameters.frameCount, "FRAME_CARDINALITY_MISMATCH", "Paged playback initial source frame is invalid.");
  require(Number.isSafeInteger(initial.appearance) && initial.appearance >= 0 && initial.appearance < packet.appearances.length, "INVALID_PAGED_PLAYBACK_STATE", "Paged playback initial appearance is invalid.");

  const validateTimeline = (value, label, profile, entryFrame = initial.sourceFrame) => {
    const required = profile ? ["profileId", "introTicks", "loopTicks", "frames"] : ["introTicks", "loopTicks", "frames"];
    const timeline = exactObject(value, [...required, "deadlineMicros"], "INVALID_PAGED_PLAYBACK_STATE", label, required);
    if (profile) stableId(timeline.profileId, `${label} profile id`);
    require(Number.isSafeInteger(timeline.introTicks) && timeline.introTicks >= 0 && Number.isSafeInteger(timeline.loopTicks) && timeline.loopTicks > 0, "TIMELINE_LIMIT", `${label} ranges are invalid.`);
    integerArray(timeline.frames, limits.maxTimelineTicks, "TIMELINE_LIMIT", `${label} frames`, { minimum: 1, upper: parameters.frameCount });
    require(timeline.frames.length === timeline.introTicks + timeline.loopTicks && timeline.frames[0] === entryFrame, "TIMELINE_LIMIT", `${label} coverage or entry frame is invalid.`);
    if (timeline.deadlineMicros !== undefined) {
      integerArray(timeline.deadlineMicros, limits.maxTimelineTicks + 1, "TIMELINE_LIMIT", `${label} deadlines`, { minimum: 0 });
      require(timeline.deadlineMicros.length === timeline.frames.length + 1 && timeline.deadlineMicros[0] === 0 && timeline.deadlineMicros.every((deadline, index) => index === 0 || deadline > timeline.deadlineMicros[index - 1]), "TIMELINE_LIMIT", `${label} deadlines are incomplete or unordered.`);
      require(timeline.deadlineMicros.every((deadline, index) => index === 0 || deadline - timeline.deadlineMicros[index - 1] <= 2_147_483_647_000), "TIMELINE_LIMIT", `${label} deadline interval exceeds the browser timer bound.`);
    }
    return timeline;
  };
  let timelineTickCount = validateTimeline(packet.timeline, "Paged playback timeline", false).frames.length;
  if (packet.profileTimelines !== undefined) {
    require(Array.isArray(packet.profileTimelines) && packet.profileTimelines.length > 0 && packet.profileTimelines.length <= 16, "INVALID_PAGED_PLAYBACK_STATE", "Paged playback profile timelines are missing or excessive.");
    const profileIds = new Set();
    for (const [index, value] of packet.profileTimelines.entries()) {
      const profileTimeline = validateTimeline(value, `Paged playback profile timeline ${index}`, true);
      require(!profileIds.has(profileTimeline.profileId), "INVALID_PAGED_PLAYBACK_STATE", `Paged playback profile timeline id ${profileTimeline.profileId} is duplicated.`);
      profileIds.add(profileTimeline.profileId);
      timelineTickCount += profileTimeline.frames.length;
      require(timelineTickCount <= limits.maxTimelineTicks, "TIMELINE_LIMIT", "Paged playback baseline and profile timelines exceed the aggregate tick limit.");
    }
  }
  timelineTickCount = validatePlaybackBanks(packet, initial, parameters, validateTimeline, packet.timeline, timelineTickCount, limits, "INVALID_PAGED_PLAYBACK_STATE", "Paged playback");

  require(Number.isSafeInteger(packet.lookaheadPages) && packet.lookaheadPages >= 1 && packet.lookaheadPages <= 4 && Number.isSafeInteger(packet.maxResidentPages) && packet.maxResidentPages >= packet.lookaheadPages + 1 && packet.maxResidentPages <= 16, "STATE_PAGE_RESIDENCY_LIMIT", "Paged playback residency is invalid.");
  require(Array.isArray(packet.pages) && packet.pages.length > 0 && packet.pages.length <= limits.maxStatePages, "STATE_PAGE_COVERAGE_MISMATCH", "Paged playback descriptors are missing or excessive.");
  const resources = new Set();
  let expectedFrame = 1;
  for (const [index, page] of packet.pages.entries()) {
    exactObject(page, ["resource", "startFrame", "endFrame", "transformCount", "shapeChangeCount", "leafChangeCount", "materializedByteLength"], "INVALID_PAGED_PLAYBACK_STATE", `Paged playback descriptor ${index}`);
    assertResourceId(page.resource, `Paged playback descriptor ${index} resource`);
    require(!resources.has(page.resource) && page.startFrame === expectedFrame && Number.isSafeInteger(page.endFrame) && page.endFrame >= page.startFrame && page.endFrame <= parameters.frameCount, "STATE_PAGE_COVERAGE_MISMATCH", `Paged playback descriptor ${index} is invalid or noncontiguous.`);
    require(page.endFrame - page.startFrame + 1 <= limits.maxStatePageFrames, "STATE_PAGE_COVERAGE_MISMATCH", `Paged playback descriptor ${index} exceeds the per-page frame limit.`);
    require(Number.isSafeInteger(page.transformCount) && page.transformCount > 0 && page.transformCount <= limits.maxPreparedTransforms, "TRANSFORM_ALLOCATION_LIMIT", `Paged playback descriptor ${index} transform count is invalid or excessive.`);
    require(Number.isSafeInteger(page.shapeChangeCount) && page.shapeChangeCount >= 0 && page.shapeChangeCount <= limits.maxPreparedChanges && Number.isSafeInteger(page.leafChangeCount) && page.leafChangeCount >= 0 && page.leafChangeCount <= limits.maxPreparedChanges, "STATE_CHANGE_LIMIT", `Paged playback descriptor ${index} change count is invalid or excessive.`);
    require(Number.isSafeInteger(page.materializedByteLength) && page.materializedByteLength > 0 && page.materializedByteLength <= limits.maxDecodedInputBytes, "STATE_PAGE_RESIDENCY_LIMIT", `Paged playback descriptor ${index} materialized size is invalid or excessive.`);
    resources.add(page.resource);
    expectedFrame = page.endFrame + 1;
  }
  require(expectedFrame === parameters.frameCount + 1, "STATE_PAGE_COVERAGE_MISMATCH", "Paged playback descriptors do not cover the playback frame range exactly.");
  return { ...packet, frameCount: parameters.frameCount };
}

function surfaceStateAt(sourceFrames, frameIndex) {
  let lower = 0;
  let upper = sourceFrames.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (sourceFrames[middle] <= frameIndex) lower = middle + 1;
    else upper = middle;
  }
  return lower - 1;
}

function validateSurface(state, binding, playback, inputs, limits) {
  const sourceFrame = inputs.get("time.source-frame");
  require(sourceFrame?.type === "uint" && !Object.hasOwn(sourceFrame, "default"), "INVALID_SURFACE_BINDING", "Surface time.source-frame must be an un-defaulted uint.");
  require(!Object.hasOwn(binding, "parameters"), "INVALID_SURFACE_BINDING", "Surface binding has no parameters.");
  const targets = exactObject(binding.targets, ["leaves"], "INVALID_SURFACE_BINDING", "Surface targets");
  uniqueTargets(targets.leaves, "Surface leaf");
  require(playback && exactEqualArray(targets.leaves, playback.binding.targets.leaves), "TARGET_CARDINALITY_MISMATCH", "Surface leaves must exactly match playback leaves.");

  exactObject(state.data, ["packet"], "INVALID_SURFACE_STATE", "Surface state");
  const packet = exactObject(state.data.packet, ["version", "frameCount", "surface", "transitions", "visibility"], "INVALID_SURFACE_STATE", "Surface packet");
  require(packet.version === 0 && packet.frameCount === playback.binding.parameters.frameCount, "FRAME_CARDINALITY_MISMATCH", "Surface version/frameCount differs from playback.");
  const surface = exactObject(packet.surface, ["faces", "statePacking"], "INVALID_SURFACE_STATE", "Surface table");
  require(Array.isArray(surface.faces) && surface.faces.length === playback.packet.leafCount, "TARGET_CARDINALITY_MISMATCH", "Surface faces differ from playback leaves.");
  const packing = exactObject(surface.statePacking, ["stateCount", "sourceFrameDeltas", "positionDictionary", "positionIndicesBase64"], "INVALID_SURFACE_STATE", "Surface state packing", ["stateCount", "sourceFrameDeltas"]);
  require(Number.isSafeInteger(packing.stateCount) && packing.stateCount >= 0 && packing.stateCount <= limits.maxPreparedStates, "SURFACE_STATE_LIMIT", "Surface state count is invalid or excessive.");
  integerArray(packing.sourceFrameDeltas, limits.maxPreparedStates, "SURFACE_STATE_LIMIT", "Surface source-frame deltas", { minimum: 0, upper: packet.frameCount - 1 });
  require(packing.sourceFrameDeltas.length === packing.stateCount, "STATE_COLUMN_MISMATCH", "Surface source-frame deltas differ from stateCount.");
  const hasPositionDictionary = Object.hasOwn(packing, "positionDictionary");
  const hasPositionIndices = Object.hasOwn(packing, "positionIndicesBase64");
  require(hasPositionDictionary === hasPositionIndices, "INVALID_SURFACE_STATE", "Surface prepared position dictionary and indices must appear together.");
  const preparedPositions = hasPositionDictionary;
  exactArray(binding.sinks, [preparedPositions ? "style.backgroundPosition" : "style.backgroundPositionY", "style.visibility"], "INVALID_SURFACE_BINDING", "Surface sinks");
  if (preparedPositions) {
    require(Array.isArray(packing.positionDictionary) && packing.positionDictionary.length > 0 && packing.positionDictionary.length <= Math.min(packing.stateCount, 65_535), "SURFACE_STATE_LIMIT", "Surface position dictionary is missing or excessive.");
    let previousX = Number.MIN_SAFE_INTEGER;
    let previousY = Number.MIN_SAFE_INTEGER;
    packing.positionDictionary.forEach((position, index) => {
      require(Array.isArray(position) && position.length === 2 && position.every((coordinate) => Number.isSafeInteger(coordinate) && !Object.is(coordinate, -0) && coordinate >= -0x80000000 && coordinate <= 0x7fffffff), "INVALID_SURFACE_STATE", `Surface position dictionary row ${index} is invalid.`);
      const [x, y] = position;
      require(index === 0 || x > previousX || (x === previousX && y > previousY), "INVALID_SURFACE_STATE", "Surface position dictionary is not strictly lexicographically sorted.");
      previousX = x;
      previousY = y;
    });
    const positionIndices = base64Integers(packing.positionIndicesBase64, 2, limits.maxPreparedStates, "INVALID_SURFACE_STATE", "Surface position indices");
    require(positionIndices.length === packing.stateCount && positionIndices.every((index) => index < packing.positionDictionary.length), "STATE_COLUMN_MISMATCH", "Surface position indices do not match the state table or dictionary.");
    require(new Set(positionIndices).size === packing.positionDictionary.length, "INVALID_SURFACE_STATE", "Surface position dictionary contains an unreferenced row.");
  }
  const faceIds = new Set();
  const sourceFramesByFace = [];
  let stateOffset = 0;
  for (const [index, face] of surface.faces.entries()) {
    exactObject(face, ["faceId", "sourceOrder", "stateOffset", "stateCount", "leafWidth", "leafHeight"], "INVALID_SURFACE_STATE", `Surface face ${index}`);
    const id = stableId(face.faceId, `Surface face ${index} id`);
    require(!faceIds.has(id) && face.sourceOrder === index, "INVALID_SURFACE_STATE", `Surface face ${index} identity/order is invalid.`);
    faceIds.add(id);
    require(face.stateOffset === stateOffset && Number.isSafeInteger(face.stateCount) && face.stateCount > 0 && stateOffset + face.stateCount <= packing.stateCount, "STATE_COLUMN_MISMATCH", `Surface face ${index} state range is noncanonical.`);
    require(Number.isSafeInteger(face.leafWidth) && face.leafWidth > 0 && face.leafWidth <= 65_535 && Number.isSafeInteger(face.leafHeight) && face.leafHeight > 0 && face.leafHeight <= 65_535, "INVALID_SURFACE_STATE", `Surface face ${index} dimensions are invalid.`);
    let frame = 0;
    const frames = [];
    for (let local = 0; local < face.stateCount; local += 1) {
      const delta = packing.sourceFrameDeltas[stateOffset + local];
      require(local === 0 ? delta === 0 : delta > 0, "INVALID_SURFACE_STATE", `Surface face ${index} deltas are noncanonical.`);
      frame += delta;
      require(frame < packet.frameCount, "INVALID_SURFACE_STATE", `Surface face ${index} state exceeds frameCount.`);
      frames.push(frame);
    }
    sourceFramesByFace.push(frames);
    stateOffset += face.stateCount;
  }
  require(stateOffset === packing.stateCount, "STATE_COLUMN_MISMATCH", "Surface state rows are unreferenced.");

  const transitions = exactObject(packet.transitions, ["initialFrame", "sequential", "nonInteractiveJumps"], "INVALID_SURFACE_STATE", "Surface transitions");
  require(transitions.initialFrame === 1 && transitions.initialFrame === playback.packet.initial.sourceFrame, "FRAME_CARDINALITY_MISMATCH", "Surface initial frame differs from playback frame 1.");
  const sequential = exactObject(transitions.sequential, ["offsetsBase64", "faceIndexDeltas", "stateIndexDeltas"], "INVALID_SURFACE_STATE", "Surface sequential transitions");
  integerArray(sequential.faceIndexDeltas, limits.maxPreparedChanges, "STATE_CHANGE_LIMIT", "Surface face deltas", { minimum: 0, upper: Math.max(0, playback.packet.leafCount - 1) });
  integerArray(sequential.stateIndexDeltas, limits.maxPreparedChanges, "STATE_CHANGE_LIMIT", "Surface state deltas", { minimum: 0, upper: 65_535 });
  require(sequential.faceIndexDeltas.length === sequential.stateIndexDeltas.length, "STATE_COLUMN_MISMATCH", "Surface transition columns differ in length.");
  const offsets = base64Integers(sequential.offsetsBase64, 4, packet.frameCount + 1, "INVALID_SURFACE_STATE", "Surface transition offsets");
  require(offsets.length === packet.frameCount + 1 && offsets[0] === 0 && offsets.at(-1) === sequential.faceIndexDeltas.length && offsets.every((offset, index) => index === 0 || offsets[index - 1] <= offset), "STATE_COLUMN_MISMATCH", "Surface transition offsets are invalid.");
  const currentStates = new Uint32Array(playback.packet.leafCount);
  const lightingSegments = [];
  for (let frame = 0; frame < packet.frameCount; frame += 1) {
    let face = 0;
    let previous = -1;
    const faces = [];
    const states = [];
    for (let cursor = offsets[frame]; cursor < offsets[frame + 1]; cursor += 1) {
      face += sequential.faceIndexDeltas[cursor];
      require(face >= 0 && face < surface.faces.length && face > previous, "INVALID_SURFACE_STATE", `Surface transition ${frame} face order is invalid.`);
      currentStates[face] += sequential.stateIndexDeltas[cursor];
      require(currentStates[face] < surface.faces[face].stateCount, "INVALID_SURFACE_STATE", `Surface transition ${frame} exceeds state count.`);
      faces.push(face);
      states.push(currentStates[face]);
      previous = face;
    }
    lightingSegments.push({ faces, states });
  }
  require(Array.isArray(transitions.nonInteractiveJumps) && transitions.nonInteractiveJumps.length <= packet.frameCount, "INVALID_SURFACE_STATE", "Surface jumps are invalid or excessive.");
  const jumpPairs = new Set();
  const lightingJumps = new Map();
  for (const [index, jump] of transitions.nonInteractiveJumps.entries()) {
    exactObject(jump, ["fromFrame", "toFrame", "faceIndicesBase64", "stateIndicesBase64"], "INVALID_SURFACE_STATE", `Surface jump ${index}`);
    require(Number.isSafeInteger(jump.fromFrame) && jump.fromFrame >= 1 && jump.fromFrame <= packet.frameCount && Number.isSafeInteger(jump.toFrame) && jump.toFrame >= 1 && jump.toFrame <= packet.frameCount && jump.fromFrame !== jump.toFrame, "INVALID_SURFACE_STATE", `Surface jump ${index} frames are invalid.`);
    const pair = `${jump.fromFrame}>${jump.toFrame}`;
    require(!jumpPairs.has(pair), "INVALID_SURFACE_STATE", `Surface jump ${pair} is duplicated.`);
    jumpPairs.add(pair);
    const faces = base64Integers(jump.faceIndicesBase64, 2, playback.packet.leafCount, "INVALID_SURFACE_STATE", `Surface jump ${index} faces`);
    const states = base64Integers(jump.stateIndicesBase64, 2, playback.packet.leafCount, "INVALID_SURFACE_STATE", `Surface jump ${index} states`);
    require(faces.length === states.length && faces.every((face, cursor) => face < surface.faces.length && (cursor === 0 || faces[cursor - 1] < face) && states[cursor] < surface.faces[face].stateCount), "INVALID_SURFACE_STATE", `Surface jump ${index} rows are invalid.`);
    lightingJumps.set(pair, { faces, states });
  }

  const visibility = exactObject(packet.visibility, ["initialFrame", "initialVisibleBitsBase64", "sequential", "nonInteractiveJumps"], "INVALID_SURFACE_STATE", "Surface visibility");
  require(visibility.initialFrame === transitions.initialFrame, "FRAME_CARDINALITY_MISMATCH", "Surface visibility initial frame differs.");
  const initialBits = base64Integers(visibility.initialVisibleBitsBase64, 1, Math.ceil(playback.packet.leafCount / 8), "INVALID_SURFACE_STATE", "Surface initial visibility");
  require(initialBits.length === Math.ceil(playback.packet.leafCount / 8), "INVALID_SURFACE_STATE", "Surface initial visibility is truncated.");
  for (let index = playback.packet.leafCount; index < initialBits.length * 8; index += 1) require(((initialBits[index >> 3] >> (index & 7)) & 1) === 0, "INVALID_SURFACE_STATE", "Surface visibility has nonzero unused bits.");
  const visibilitySequential = exactObject(visibility.sequential, ["offsetsBase64", "faceIndicesBase64"], "INVALID_SURFACE_STATE", "Surface sequential visibility");
  const visibilityOffsets = base64Integers(visibilitySequential.offsetsBase64, 4, packet.frameCount + 1, "INVALID_SURFACE_STATE", "Surface visibility offsets");
  const visibilityFaces = base64Integers(visibilitySequential.faceIndicesBase64, 2, limits.maxPreparedChanges, "INVALID_SURFACE_STATE", "Surface visibility faces");
  require(visibilityOffsets.length === packet.frameCount + 1 && visibilityOffsets[0] === 0 && visibilityOffsets.at(-1) === visibilityFaces.length && visibilityOffsets.every((offset, index) => index === 0 || visibilityOffsets[index - 1] <= offset), "STATE_COLUMN_MISMATCH", "Surface visibility offsets are invalid.");
  for (let frame = 0; frame < packet.frameCount; frame += 1) for (let cursor = visibilityOffsets[frame]; cursor < visibilityOffsets[frame + 1]; cursor += 1) require(visibilityFaces[cursor] < playback.packet.leafCount && (cursor === visibilityOffsets[frame] || visibilityFaces[cursor - 1] < visibilityFaces[cursor]), "INVALID_SURFACE_STATE", `Surface visibility segment ${frame} is invalid.`);
  const initialVisibility = Uint8Array.from({ length: playback.packet.leafCount }, (_, index) => (initialBits[index >> 3] >> (index & 7)) & 1);
  require(Array.isArray(visibility.nonInteractiveJumps) && visibility.nonInteractiveJumps.length <= packet.frameCount, "INVALID_SURFACE_STATE", "Surface visibility jumps are invalid or excessive.");
  const visibilityPairs = new Set();
  const visibilityJumps = new Map();
  for (const [index, jump] of visibility.nonInteractiveJumps.entries()) {
    exactObject(jump, ["fromFrame", "toFrame", "faceIndicesBase64"], "INVALID_SURFACE_STATE", `Surface visibility jump ${index}`);
    const pair = `${jump.fromFrame}>${jump.toFrame}`;
    require(Number.isSafeInteger(jump.fromFrame) && jump.fromFrame >= 1 && jump.fromFrame <= packet.frameCount && Number.isSafeInteger(jump.toFrame) && jump.toFrame >= 1 && jump.toFrame <= packet.frameCount && jump.fromFrame !== jump.toFrame && !visibilityPairs.has(pair), "INVALID_SURFACE_STATE", `Surface visibility jump ${index} is invalid or duplicated.`);
    visibilityPairs.add(pair);
    const faces = base64Integers(jump.faceIndicesBase64, 2, playback.packet.leafCount, "INVALID_SURFACE_STATE", `Surface visibility jump ${index} faces`);
    require(faces.every((face, cursor) => face < playback.packet.leafCount && (cursor === 0 || faces[cursor - 1] < face)), "INVALID_SURFACE_STATE", `Surface visibility jump ${index} faces are invalid.`);
    visibilityJumps.set(pair, faces);
  }
  require([...jumpPairs].every((pair) => visibilityPairs.has(pair)) && [...visibilityPairs].every((pair) => jumpPairs.has(pair)), "INVALID_SURFACE_STATE", "Surface lighting and visibility jump pairs differ.");

  const expectedTransition = (fromFrame, toFrame, fromVisibility, toVisibility) => {
    const changedVisibility = [];
    const changedFaces = [];
    const changedStates = [];
    for (let face = 0; face < playback.packet.leafCount; face += 1) {
      const fromVisible = fromVisibility[face];
      const toVisible = toVisibility[face];
      if (fromVisible !== toVisible) changedVisibility.push(face);
      const fromState = surfaceStateAt(sourceFramesByFace[face], fromFrame - 1);
      const toState = surfaceStateAt(sourceFramesByFace[face], toFrame - 1);
      if (toVisible === 1 && (fromVisible === 0 || fromState !== toState)) { changedFaces.push(face); changedStates.push(toState); }
    }
    return { changedVisibility, changedFaces, changedStates };
  };
  const endpointFrames = new Set();
  for (const pair of jumpPairs) for (const frame of pair.split(">").map(Number)) endpointFrames.add(frame);
  require(endpointFrames.size * Math.max(1, playback.packet.leafCount) <= limits.maxVisibilityCells, "VISIBILITY_ALLOCATION_LIMIT", "Surface jump endpoint visibility rows exceed the allocation limit.");
  const endpointRows = new Map();
  if (endpointFrames.has(1)) endpointRows.set(1, initialVisibility.slice());
  let previousVisibility = initialVisibility.slice();
  for (let toFrame = 2; toFrame <= packet.frameCount; toFrame += 1) {
    const nextVisibility = previousVisibility.slice();
    for (let cursor = visibilityOffsets[toFrame - 1]; cursor < visibilityOffsets[toFrame]; cursor += 1) nextVisibility[visibilityFaces[cursor]] ^= 1;
    const expected = expectedTransition(toFrame - 1, toFrame, previousVisibility, nextVisibility);
    const actualLighting = lightingSegments[toFrame - 1];
    const actualVisibility = visibilityFaces.slice(visibilityOffsets[toFrame - 1], visibilityOffsets[toFrame]);
    require(exactEqualArray(actualLighting.faces, expected.changedFaces) && exactEqualArray(actualLighting.states, expected.changedStates), "SURFACE_TRANSITION_MISMATCH", `Surface lighting transition ${toFrame - 1}>${toFrame} is not closed.`);
    require(exactEqualArray(actualVisibility, expected.changedVisibility), "SURFACE_TRANSITION_MISMATCH", `Surface visibility transition ${toFrame - 1}>${toFrame} is not closed.`);
    previousVisibility = nextVisibility;
    if (endpointFrames.has(toFrame)) endpointRows.set(toFrame, nextVisibility.slice());
  }
  const wrapped = previousVisibility.slice();
  for (let cursor = visibilityOffsets[0]; cursor < visibilityOffsets[1]; cursor += 1) wrapped[visibilityFaces[cursor]] ^= 1;
  require(wrapped.every((value, index) => value === initialVisibility[index]), "SURFACE_TRANSITION_MISMATCH", "Surface visibility wrap does not reproduce frame 1.");
  const wrapExpected = expectedTransition(packet.frameCount, 1, previousVisibility, initialVisibility);
  require(exactEqualArray(lightingSegments[0].faces, wrapExpected.changedFaces) && exactEqualArray(lightingSegments[0].states, wrapExpected.changedStates), "SURFACE_TRANSITION_MISMATCH", `Surface lighting transition ${packet.frameCount}>1 is not closed.`);
  require(exactEqualArray(visibilityFaces.slice(visibilityOffsets[0], visibilityOffsets[1]), wrapExpected.changedVisibility), "SURFACE_TRANSITION_MISMATCH", `Surface visibility transition ${packet.frameCount}>1 is not closed.`);
  for (const pair of jumpPairs) {
    const [fromFrame, toFrame] = pair.split(">").map(Number);
    const expected = expectedTransition(fromFrame, toFrame, endpointRows.get(fromFrame), endpointRows.get(toFrame));
    const lighting = lightingJumps.get(pair);
    require(exactEqualArray(lighting.faces, expected.changedFaces) && exactEqualArray(lighting.states, expected.changedStates), "SURFACE_JUMP_MISMATCH", `Surface lighting jump ${pair} contradicts target state.`);
    require(exactEqualArray(visibilityJumps.get(pair), expected.changedVisibility), "SURFACE_JUMP_MISMATCH", `Surface visibility jump ${pair} contradicts target state.`);
  }
  return packet;
}

function validatePresentation(state, binding, records, inputs) {
  const viewportHeight = inputs.get("viewport.height");
  const viewportWidth = inputs.get("viewport.width");
  require(viewportHeight?.type === "float" && viewportWidth?.type === "float" && !Object.hasOwn(viewportHeight, "default") && !Object.hasOwn(viewportWidth, "default"), "INVALID_PRESENTATION_BINDING", "Presentation viewport inputs must be un-defaulted floats.");
  exactObject(state.data, ["packet"], "INVALID_PRESENTATION_STATE", "Presentation state");
  const packet = exactObject(state.data.packet, ["version", "camera", "background"], "INVALID_PRESENTATION_STATE", "Presentation packet", ["version", "camera"]);
  exactObject(packet.camera, ["baseSceneTransform", "fitWidth", "fitHeight", "sourceWidth", "sourceHeight", "perspective", "profileSelection", "profiles"], "INVALID_PRESENTATION_STATE", "Presentation camera", ["baseSceneTransform", "fitWidth", "fitHeight", "sourceWidth", "sourceHeight", "perspective"]);
  exactObject(binding.targets, ["host", "camera", "cursorLayer", "cursorStates"], "INVALID_PRESENTATION_BINDING", "Presentation targets", ["host", "camera"]);
  exactObject(binding.parameters, ["fitWidth", "fitHeight", "sourceWidth", "sourceHeight", "profileSelection", "profiles"], "INVALID_PRESENTATION_BINDING", "Presentation parameters", ["fitWidth", "fitHeight", "sourceWidth", "sourceHeight"]);
  stableId(binding.targets.camera, "Presentation camera target");
  const hasCursorLayer = Object.hasOwn(binding.targets, "cursorLayer");
  const hasCursorStates = Object.hasOwn(binding.targets, "cursorStates");
  require(hasCursorLayer === hasCursorStates, "INVALID_PRESENTATION_BINDING", "Presentation cursor layer and states must appear together.");
  if (hasCursorLayer) {
    exactObject(binding.targets.cursorStates, ["open", "closed"], "INVALID_PRESENTATION_BINDING", "Presentation cursor states");
    stableId(binding.targets.cursorLayer, "Presentation cursor layer target");
    stableId(binding.targets.cursorStates.open, "Presentation open cursor target");
    stableId(binding.targets.cursorStates.closed, "Presentation closed cursor target");
    require(binding.targets.cursorStates.open !== binding.targets.cursorStates.closed, "INVALID_PRESENTATION_BINDING", "Presentation cursor targets must be distinct.");
  }
  require(packet.version === 0 && binding.targets.host === "$host" && ["fitWidth", "fitHeight", "sourceWidth", "sourceHeight"].every((name) => Number.isSafeInteger(packet.camera[name]) && packet.camera[name] > 0 && packet.camera[name] === binding.parameters[name]) && typeof packet.camera.perspective === "number" && Number.isFinite(packet.camera.perspective) && packet.camera.perspective > 0, "INVALID_PRESENTATION_STATE", "Presentation packet/binding is invalid.");
  safeStyle(packet.camera.baseSceneTransform, "Presentation base scene transform");
  const validateProfiles = (profiles, selection, code, label) => {
    if (profiles === undefined) {
      require(selection === undefined, code, `${label} selection requires profiles.`);
      return undefined;
    }
    require(selection === "viewport-width" || selection === "landscape-first-portrait-width", code, `${label} selection is unsupported.`);
    require(Array.isArray(profiles) && profiles.length > 0 && profiles.length <= 16, code, `${label} are missing or excessive.`);
    require(selection !== "landscape-first-portrait-width" || profiles.length >= 2, code, `${label} landscape-first selection requires a landscape row and at least one portrait row.`);
    const ids = new Set();
    let maximum = 0;
    for (const [index, profile] of profiles.entries()) {
      exactObject(profile, ["id", "maxViewportWidth", "fit", "quarterTurns", "bounds", "safeInset", "bias"], code, `${label} ${index}`, ["id", "fit", "quarterTurns", "bounds", "safeInset", "bias"]);
      const id = stableId(profile.id, `${label} ${index} id`);
      require(!ids.has(id), code, `${label} ids are duplicated.`);
      ids.add(id);
      const landscape = selection === "landscape-first-portrait-width" && index === 0;
      if (landscape || index === profiles.length - 1) require(!Object.hasOwn(profile, "maxViewportWidth"), code, `${label} ${landscape ? "landscape" : "final"} profile must be unbounded.`);
      else {
        require(Number.isSafeInteger(profile.maxViewportWidth) && profile.maxViewportWidth > maximum && profile.maxViewportWidth <= 1_000_000, code, `${label} breakpoints are invalid.`);
        maximum = profile.maxViewportWidth;
      }
      require((profile.fit === "contain" || profile.fit === "cover") && Number.isSafeInteger(profile.quarterTurns) && profile.quarterTurns >= 0 && profile.quarterTurns <= 3, code, `${label} fit or rotation is invalid.`);
      require(Array.isArray(profile.bounds) && profile.bounds.length === 4 && profile.bounds.every((value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000) && profile.bounds[2] > profile.bounds[0] && profile.bounds[3] > profile.bounds[1], code, `${label} bounds are invalid.`);
      require(typeof profile.safeInset === "number" && Number.isFinite(profile.safeInset) && profile.safeInset >= 0 && profile.safeInset <= 1_000_000 && Array.isArray(profile.bias) && profile.bias.length === 2 && profile.bias.every((value) => typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1), code, `${label} inset or bias is invalid.`);
    }
    return profiles;
  };
  const stateProfiles = validateProfiles(packet.camera.profiles, packet.camera.profileSelection, "INVALID_PRESENTATION_STATE", "Presentation camera profiles");
  const bindingProfiles = validateProfiles(binding.parameters.profiles, binding.parameters.profileSelection, "INVALID_PRESENTATION_BINDING", "Presentation binding profiles");
  require(packet.camera.profileSelection === binding.parameters.profileSelection, "INVALID_PRESENTATION_STATE", "Presentation profile selection differs between state and binding.");
  require((stateProfiles === undefined && bindingProfiles === undefined) || (stateProfiles && bindingProfiles && JSON.stringify(stateProfiles) === JSON.stringify(bindingProfiles)), "INVALID_PRESENTATION_STATE", "Presentation profiles differ between state and binding.");
  const hasBackground = Object.hasOwn(packet, "background");
  if (hasBackground) {
    exactObject(packet.background, ["resource", "opacity", "position", "repeat", "size"], "INVALID_PRESENTATION_STATE", "Presentation background");
    assertResourceId(packet.background.resource, "Presentation background resource");
    require(records.get(packet.background.resource)?.kind === "image", "RESOURCE_ROLE_MISMATCH", "Presentation background must be an image.");
    require(typeof packet.background.opacity === "number" && Number.isFinite(packet.background.opacity) && packet.background.opacity >= 0 && packet.background.opacity <= 1, "INVALID_PRESENTATION_STATE", "Presentation background opacity is invalid.");
    for (const name of ["position", "repeat", "size"]) safeStyle(packet.background[name], `Presentation background ${name}`);
  }
  exactArray(binding.sinks, [
    "style.height", "style.left", "style.top", "style.transform",
    ...(hasCursorLayer ? ["style.visibility"] : []),
    "style.width",
  ], "INVALID_PRESENTATION_BINDING", "Presentation sinks");
  return packet;
}

function validatePlaybackProfileTimelineClosure(playbackPacket, presentationPacket) {
  const timelineGroups = [playbackPacket.profileTimelines, ...(playbackPacket.banks?.map((bank) => bank.profileTimelines) ?? [])].filter(Boolean);
  if (timelineGroups.length === 0) return;
  const profiles = presentationPacket.camera.profiles;
  require(profiles, "MISSING_POLYCSS_CHANNEL", "Playback profile timelines require static-presentation profiles.");
  const profileIndices = new Map(profiles.map((profile, index) => [profile.id, index]));
  for (const timelines of timelineGroups) {
    let previousIndex = -1;
    for (const timeline of timelines) {
      const profileIndex = profileIndices.get(timeline.profileId);
      require(profileIndex !== undefined, "INVALID_PLAYBACK_STATE", `Playback profile timeline ${timeline.profileId} has no static-presentation profile.`);
      require(profileIndex > previousIndex, "INVALID_PLAYBACK_STATE", "Playback profile timelines do not follow static-presentation profile order.");
      previousIndex = profileIndex;
    }
  }
}

function validateEffects(state, binding, playback, inputs, limits) {
  exactObject(state.data, ["packet"], "INVALID_EFFECTS_STATE", "Effects state");
  const packet = exactObject(state.data.packet, ["version", "arithmetic", "frameCount", "biases", "particle", "spawnStream", "stars", "emitters"], "INVALID_EFFECTS_STATE", "Effects packet");
  exactObject(binding.targets, ["stars", "emitters"], "INVALID_EFFECTS_BINDING", "Effects targets");
  exactObject(binding.parameters, ["frameCount"], "INVALID_EFFECTS_BINDING", "Effects parameters");
  const inputDefinitions = [
    ["interaction.grab-active", "boolean", false],
    ["interaction.grab-x", "float", 0],
    ["interaction.grab-y", "float", 0],
    ["interaction.grab-z", "float", 0],
    ["time.source-frame", "uint", undefined],
  ];
  for (const [id, type, defaultValue] of inputDefinitions) {
    const input = inputs.get(id);
    require(input?.type === type && (defaultValue === undefined ? !Object.hasOwn(input, "default") : input.default === defaultValue), "INVALID_EFFECTS_BINDING", `Effects input ${id} is invalid.`);
  }
  require(playback && packet.version === 0 && packet.arithmetic === "ieee754-f32-per-operation" && Number.isSafeInteger(packet.frameCount) && packet.frameCount > 0 && packet.frameCount <= limits.maxFrames && packet.frameCount === binding.parameters.frameCount && packet.frameCount === playback.binding.parameters.frameCount, "FRAME_CARDINALITY_MISMATCH", "Effects frame closure is invalid.");
  const biases = exactObject(packet.biases, ["continuous", "grab"], "INVALID_EFFECTS_STATE", "Effects biases");
  finiteF32Array(biases.continuous, 3, "INVALID_EFFECTS_STATE", "Effects continuous bias");
  finiteF32Array(biases.grab, 3, "INVALID_EFFECTS_STATE", "Effects grab bias");
  const particle = exactObject(packet.particle, ["damping", "gravityY", "sparkleFrameTable"], "INVALID_EFFECTS_STATE", "Effects particle contract");
  require(finiteF32(particle.damping) && particle.damping >= 0 && particle.damping <= 1 && finiteF32(particle.gravityY), "INVALID_EFFECTS_STATE", "Effects particle arithmetic is invalid.");
  require(Array.isArray(particle.sparkleFrameTable) && particle.sparkleFrameTable.length > 0 && particle.sparkleFrameTable.length <= 256 && particle.sparkleFrameTable.every((value) => Number.isSafeInteger(value) && value >= 0), "INVALID_EFFECTS_STATE", "Effects sparkle frames are invalid.");
  const spawn = exactObject(packet.spawnStream, ["count", "tuples"], "INVALID_EFFECTS_STATE", "Effects spawn stream");
  require(Number.isSafeInteger(spawn.count) && spawn.count > 0 && spawn.count <= limits.maxEffectSpawnTuples && Array.isArray(spawn.tuples) && spawn.tuples.length === spawn.count, "EFFECT_STATE_LIMIT", "Effects spawn stream is invalid or excessive.");
  for (const [index, tuple] of spawn.tuples.entries()) {
    finiteF32Array(tuple, 4, "INVALID_EFFECTS_STATE", `Effects spawn tuple ${index}`);
    require(tuple[0] > 0 && Math.trunc(tuple[0]) <= particle.sparkleFrameTable.length, "INVALID_EFFECTS_STATE", `Effects spawn tuple ${index} lifetime is invalid.`);
    for (const bias of [biases.continuous, biases.grab]) require([0, 1, 2].every((component) => Number.isFinite(Math.fround(tuple[component + 1] + bias[component]))), "INVALID_EFFECTS_STATE", `Effects spawn tuple ${index} overflows with a bias.`);
  }
  require(Array.isArray(packet.stars) && packet.stars.length <= limits.maxNodes && packet.stars.length === binding.targets.stars.length, "TARGET_CARDINALITY_MISMATCH", "Effects stars differ from targets.");
  require(Array.isArray(packet.emitters) && packet.emitters.length > 0 && packet.emitters.length <= limits.maxNodes && packet.emitters.length === binding.targets.emitters.length, "TARGET_CARDINALITY_MISMATCH", "Effects emitters differ from targets.");
  uniqueTargets(binding.targets.stars, "Effects star");
  let totalParticles = 0;
  for (const [index, emitter] of packet.emitters.entries()) {
    closedObject(emitter, ["mode", "sourceStar", "poolSize", "backgroundPositions"], "INVALID_EFFECTS_STATE", `Effects emitter ${index}`);
    require(Object.hasOwn(emitter, "mode") && Object.hasOwn(emitter, "poolSize") && Object.hasOwn(emitter, "backgroundPositions"), "INVALID_EFFECTS_STATE", `Effects emitter ${index} is incomplete.`);
    require(emitter.mode === "grab" || emitter.mode === "follow-star", "INVALID_EFFECTS_STATE", `Effects emitter ${index} mode is unsupported.`);
    if (emitter.mode === "grab") require(!Object.hasOwn(emitter, "sourceStar"), "INVALID_EFFECTS_STATE", `Grab emitter ${index} declares sourceStar.`);
    else require(Number.isSafeInteger(emitter.sourceStar) && emitter.sourceStar >= 0 && emitter.sourceStar < packet.stars.length, "INVALID_EFFECTS_STATE", `Follow-star emitter ${index} source is invalid.`);
    require(Number.isSafeInteger(emitter.poolSize) && emitter.poolSize > 0, "INVALID_EFFECTS_STATE", `Effects emitter ${index} pool size is invalid.`);
    totalParticles += emitter.poolSize;
    require(totalParticles <= limits.maxEffectParticles, "EFFECT_PARTICLE_LIMIT", "Effects particle count is excessive.");
    require(Array.isArray(emitter.backgroundPositions) && emitter.backgroundPositions.length > 0 && emitter.backgroundPositions.length <= 256, "INVALID_EFFECTS_STATE", `Effects emitter ${index} background positions are invalid.`);
    emitter.backgroundPositions.forEach((value) => safeStyle(value, `Effects emitter ${index} background position`));
    require(particle.sparkleFrameTable.every((frame) => frame < emitter.backgroundPositions.length), "INVALID_EFFECTS_STATE", `Effects emitter ${index} lacks a sparkle frame.`);
    uniqueTargets(binding.targets.emitters[index], `Effects emitter ${index}`);
    require(binding.targets.emitters[index].length === emitter.poolSize, "TARGET_CARDINALITY_MISMATCH", `Effects emitter ${index} pool differs from targets.`);
  }
  for (const [index, star] of packet.stars.entries()) {
    exactObject(star, ["positions", "transforms", "frameIndices", "backgroundPositions"], "INVALID_EFFECTS_STATE", `Effects star ${index}`);
    finiteF32Array(star.positions, packet.frameCount * 3, "INVALID_EFFECTS_STATE", `Effects star ${index} positions`);
    require(Array.isArray(star.transforms) && star.transforms.length === packet.frameCount, "FRAME_CARDINALITY_MISMATCH", `Effects star ${index} transforms differ from frameCount.`);
    star.transforms.forEach((value) => safeStyle(value, `Effects star ${index} transform`));
    require(Array.isArray(star.backgroundPositions) && star.backgroundPositions.length > 0 && star.backgroundPositions.length <= limits.maxFrames, "INVALID_EFFECTS_STATE", `Effects star ${index} background positions are invalid.`);
    star.backgroundPositions.forEach((value) => safeStyle(value, `Effects star ${index} background position`));
    require(Array.isArray(star.frameIndices) && star.frameIndices.length === packet.frameCount && star.frameIndices.every((frame) => Number.isSafeInteger(frame) && frame >= 0 && frame < star.backgroundPositions.length), "FRAME_CARDINALITY_MISMATCH", `Effects star ${index} frame indices are invalid.`);
  }
  let maximumMovementSteps = 0;
  const maximumVelocity = [0, 0, 0];
  for (const tuple of spawn.tuples) {
    maximumMovementSteps = Math.max(maximumMovementSteps, Math.ceil(tuple[0]) + 1);
    for (let component = 0; component < 3; component += 1) maximumVelocity[component] = Math.max(maximumVelocity[component], Math.abs(Math.fround(tuple[component + 1] + biases.continuous[component])));
  }
  const maximumStart = [0, 0, 0];
  for (const star of packet.stars) for (let index = 0; index < star.positions.length; index += 1) maximumStart[index % 3] = Math.max(maximumStart[index % 3], Math.abs(star.positions[index]));
  for (let component = 0; component < 3; component += 1) {
    const gravity = component === 1 ? Math.abs(particle.gravityY) * maximumMovementSteps * (maximumMovementSteps - 1) / 2 : 0;
    require(Number.isFinite(Math.fround(maximumStart[component] + maximumVelocity[component] * maximumMovementSteps + gravity)), "INVALID_EFFECTS_STATE", `Effects component ${component} can overflow.`);
  }
  return packet;
}

function validateInteraction(state, binding, playback, presentation, inputs, limits) {
  exactObject(state.data, ["packet"], "INVALID_INTERACTION_STATE", "Interaction state");
  const packet = exactObject(state.data.packet, ["version", "arithmetic", "input", "animator", "source", "triangle", "objects", "shapes", "leaves", "controls"], "INVALID_INTERACTION_STATE", "Interaction packet");
  exactObject(binding.targets, ["shapes", "leaves", "cursorLayer", "cursorStates"], "INVALID_INTERACTION_BINDING", "Interaction targets");
  exactObject(binding.targets.cursorStates, ["open", "closed"], "INVALID_INTERACTION_BINDING", "Interaction cursor states");
  exactObject(binding.parameters, ["initialFrame", "tickRateHz", "tickIntervalUs"], "INVALID_INTERACTION_BINDING", "Interaction parameters", ["initialFrame"]);
  validateTickCadence(binding.parameters, "INVALID_INTERACTION_BINDING", "Interaction");
  uniqueTargets(binding.targets.shapes, "Interaction shape");
  uniqueTargets(binding.targets.leaves, "Interaction leaf");
  stableId(binding.targets.cursorLayer, "Interaction cursor layer");
  stableId(binding.targets.cursorStates.open, "Interaction open cursor");
  stableId(binding.targets.cursorStates.closed, "Interaction closed cursor");
  require(binding.targets.cursorStates.open !== binding.targets.cursorStates.closed, "INVALID_INTERACTION_BINDING", "Interaction cursor binding is invalid.");
  const defaultInputs = [
    ["axis.x", "float", 0],
    ["axis.y", "float", 0],
    ["button.hold", "boolean", false],
    ["pointer.positioned", "boolean", false],
    ["pointer.pressed", "boolean", false],
  ];
  for (const [id, type, defaultValue] of defaultInputs) {
    const input = inputs.get(id);
    require(input?.type === type && input.default === defaultValue, "INVALID_INTERACTION_BINDING", `Interaction input ${id} is invalid.`);
  }
  require(packet.version === 0 && packet.arithmetic === "ieee754-f32-per-operation", "INVALID_INTERACTION_STATE", "Interaction version or arithmetic is unsupported.");
  require(exactEqualArray(binding.targets.shapes, playback.binding.targets.shapes) && exactEqualArray(binding.targets.leaves, playback.binding.targets.leaves), "INTERACTION_TARGET_MISMATCH", "Interaction and playback target order differs.");

  const input = exactObject(packet.input, ["sourceWidth", "sourceHeight", "cursorBounds", "cursorInitial", "pointerQuantization", "stickRange", "stickDeadzone", "stickScale", "grabButton", "holdButton", "hitRadius", "cursorVisibleTicks", "mirrorX"], "INVALID_INTERACTION_STATE", "Interaction input contract");
  require(Number.isSafeInteger(input.sourceWidth) && input.sourceWidth > 0 && Number.isSafeInteger(input.sourceHeight) && input.sourceHeight > 0, "INVALID_INTERACTION_STATE", "Interaction viewport is invalid.");
  const pointerDefaults = [["pointer.x", input.sourceWidth / 2], ["pointer.y", input.sourceHeight / 2]];
  for (const [id, defaultValue] of pointerDefaults) {
    const definition = inputs.get(id);
    require(definition?.type === "float" && definition.default === defaultValue, "INVALID_INTERACTION_BINDING", `Interaction input ${id} does not use the source-centre default.`);
  }
  finiteF32Array(input.cursorBounds, 4, "INVALID_INTERACTION_STATE", "Interaction cursor bounds");
  finiteF32Array(input.cursorInitial, 2, "INVALID_INTERACTION_STATE", "Interaction initial cursor");
  require(input.cursorBounds[0] <= input.cursorBounds[1] && input.cursorBounds[2] <= input.cursorBounds[3]
    && input.cursorInitial[0] === pointerDefaults[0][1] && input.cursorInitial[1] === pointerDefaults[1][1]
    && input.cursorInitial[0] >= input.cursorBounds[0] && input.cursorInitial[0] <= input.cursorBounds[1]
    && input.cursorInitial[1] >= input.cursorBounds[2] && input.cursorInitial[1] <= input.cursorBounds[3], "INVALID_INTERACTION_STATE", "Interaction cursor bounds or initial position are invalid.");
  require(input.pointerQuantization === "trunc-toward-zero-then-clamp", "INVALID_INTERACTION_STATE", "Interaction pointer quantization is unsupported.");
  finiteF32Array(input.stickRange, 2, "INVALID_INTERACTION_STATE", "Interaction stick range");
  require(input.stickRange[0] === -128 && input.stickRange[1] === 127
    && finiteF32(input.stickDeadzone) && input.stickDeadzone >= 0
    && finiteF32(input.stickScale) && input.stickScale > 0, "INVALID_INTERACTION_STATE", "Interaction stick contract is invalid.");
  require(Number.isSafeInteger(input.grabButton) && input.grabButton > 0 && input.grabButton <= 0xffff
    && Number.isSafeInteger(input.holdButton) && input.holdButton > 0 && input.holdButton <= 0xffff
    && (input.grabButton & input.holdButton) === 0, "INVALID_INTERACTION_STATE", "Interaction button masks are invalid.");
  require(finiteF32(input.hitRadius) && input.hitRadius > 0
    && Number.isSafeInteger(input.cursorVisibleTicks) && input.cursorVisibleTicks > 0
    && finiteF32(input.mirrorX), "INVALID_INTERACTION_STATE", "Interaction picking or cursor timing is invalid.");
  if (presentation) require(input.sourceWidth === presentation.packet.camera.sourceWidth && input.sourceHeight === presentation.packet.camera.sourceHeight
    && binding.targets.cursorLayer === presentation.binding.targets.cursorLayer
    && binding.targets.cursorStates.open === presentation.binding.targets.cursorStates.open
    && binding.targets.cursorStates.closed === presentation.binding.targets.cursorStates.closed, "PRESENTATION_TREE_MISMATCH", "Interaction and presentation closure differs.");

  const animatorKeys = ["dozeState", "sleepState", "wakeState", "convergeState", "exitEyeState", "eyeState", "dozeLoopCount", "dozeLoopStartFrame", "dozeLoopEndFrame", "sleepEndFrame", "wakeStartFrame", "eyeFrame", "convergeStillTicks", "eyeStillTicks"];
  const animator = exactObject(packet.animator, animatorKeys, "INVALID_INTERACTION_STATE", "Interaction animator");
  require(animatorKeys.every((key) => Number.isSafeInteger(animator[key]) && animator[key] >= 0), "INVALID_INTERACTION_STATE", "Interaction animator contains invalid integers.");
  const stateIds = [animator.dozeState, animator.sleepState, animator.wakeState, animator.convergeState, animator.exitEyeState, animator.eyeState];
  const frameCount = playback?.binding.parameters.frameCount ?? limits.maxFrames;
  require(new Set(stateIds).size === stateIds.length
    && animator.eyeFrame > 0 && animator.eyeFrame <= frameCount
    && animator.dozeLoopCount > 0 && animator.dozeLoopStartFrame > 0 && animator.dozeLoopStartFrame < animator.dozeLoopEndFrame && animator.dozeLoopEndFrame <= frameCount
    && animator.sleepEndFrame > 0 && animator.sleepEndFrame <= frameCount
    && animator.wakeStartFrame > 0 && animator.wakeStartFrame <= frameCount
    && animator.convergeStillTicks > 0 && animator.eyeStillTicks > 0
    && binding.parameters.initialFrame === animator.eyeFrame, "INVALID_INTERACTION_STATE", "Interaction animator state or timing closure is invalid.");

  const source = exactObject(packet.source, ["cameraViewMatrix", "cameraWorldPosition", "inverseCameraMatrix", "projection", "displacementMagnitude", "eyeGain", "eyeMaximumOffset", "spring"], "INVALID_INTERACTION_STATE", "Interaction source contract");
  finiteF32Array(source.cameraViewMatrix, 16, "INVALID_INTERACTION_STATE", "Interaction camera view matrix");
  finiteF32Array(source.inverseCameraMatrix, 16, "INVALID_INTERACTION_STATE", "Interaction inverse camera matrix");
  finiteF32Array(source.cameraWorldPosition, 3, "INVALID_INTERACTION_STATE", "Interaction camera world position");
  require(inverseMatrixPair(source.cameraViewMatrix, source.inverseCameraMatrix), "INVALID_INTERACTION_STATE", "Interaction camera matrices are not a finite inverse pair.");
  const projection = exactObject(source.projection, ["scale", "origin"], "INVALID_INTERACTION_STATE", "Interaction projection");
  require(finiteF32(projection.scale) && projection.scale > 0, "INVALID_INTERACTION_STATE", "Interaction projection scale is invalid.");
  finiteF32Array(projection.origin, 2, "INVALID_INTERACTION_STATE", "Interaction projection origin");
  require(finiteF32(source.displacementMagnitude) && source.displacementMagnitude > 0
    && finiteF32(source.eyeGain) && source.eyeGain > 0
    && finiteF32(source.eyeMaximumOffset) && source.eyeMaximumOffset >= 0, "INVALID_INTERACTION_STATE", "Interaction displacement or eye-follow values are invalid.");
  const springKeys = ["cursorResistance", "grabbedFlag", "pickedResistance", "releaseAcceleration", "snapOffsetL1", "snapVelocityL1", "velocityDecay"];
  const spring = exactObject(source.spring, springKeys, "INVALID_INTERACTION_STATE", "Interaction spring");
  for (const key of springKeys.filter((key) => key !== "grabbedFlag")) require(finiteF32(spring[key]), "INVALID_INTERACTION_STATE", `Interaction spring ${key} is invalid.`);
  require(spring.cursorResistance >= 0 && spring.cursorResistance <= 1
    && spring.pickedResistance >= -1 && spring.pickedResistance < 0
    && spring.releaseAcceleration > 0 && spring.releaseAcceleration <= 1
    && spring.velocityDecay > 0 && spring.velocityDecay < 1
    && spring.snapOffsetL1 >= 0 && spring.snapVelocityL1 >= 0
    && Number.isSafeInteger(spring.grabbedFlag) && spring.grabbedFlag > 0, "INVALID_INTERACTION_STATE", "Interaction spring constraints are invalid.");
  const displacementBounds = grabDisplacementBounds(input, source);
  require(displacementBounds, "INVALID_INTERACTION_STATE", "Interaction cursor displacement overflows binary32 arithmetic.");
  const selectedOffsetBounds = displacementBounds.map((bound) => operationF32(bound / -spring.pickedResistance));
  require(selectedOffsetBounds.every(Number.isFinite), "INVALID_INTERACTION_STATE", "Interaction selected-grab envelope overflows binary32 arithmetic.");

  const triangle = exactObject(packet.triangle, ["basisEpsilon", "primitive", "fallbackAmount", "sharedEdgeAmount"], "INVALID_INTERACTION_STATE", "Interaction triangle kernel");
  require(triangle.basisEpsilon === 1e-9 && triangle.primitive === "corner-bevel"
    && finiteF32(triangle.fallbackAmount) && triangle.fallbackAmount >= 0
    && finiteF32(triangle.sharedEdgeAmount) && triangle.sharedEdgeAmount >= 0, "INVALID_INTERACTION_STATE", "Interaction triangle kernel is unsupported.");
  const objects = exactObject(packet.objects, ["rotationMatrices"], "INVALID_INTERACTION_STATE", "Interaction objects");
  require(Array.isArray(objects.rotationMatrices) && objects.rotationMatrices.length % 16 === 0
    && objects.rotationMatrices.length / 16 <= limits.maxInteractionObjects
    && objects.rotationMatrices.every(finiteF32), "INTERACTION_STATE_LIMIT", "Interaction object matrices are invalid or excessive.");
  const objectCount = objects.rotationMatrices.length / 16;
  const shapes = exactObject(packet.shapes, ["baseMatrices"], "INVALID_INTERACTION_STATE", "Interaction shapes");
  require(Array.isArray(shapes.baseMatrices) && shapes.baseMatrices.length === binding.targets.shapes.length * 16 && shapes.baseMatrices.every(finiteF32), "TARGET_CARDINALITY_MISMATCH", "Interaction shape matrices differ from targets.");
  require(Array.isArray(packet.leaves) && packet.leaves.length === binding.targets.leaves.length && packet.leaves.length <= limits.maxNodes, "TARGET_CARDINALITY_MISMATCH", "Interaction leaf plans differ from targets.");
  for (const [index, leaf] of packet.leaves.entries()) {
    exactObject(leaf, ["basis", "canonicalSize", "matrixDecimals", "seamEdgeMask", "width", "height"], "INVALID_INTERACTION_STATE", `Interaction leaf ${index}`);
    require(Array.isArray(leaf.basis) && [[0, 1, 2], [1, 2, 0], [2, 0, 1]].some((basis) => exactEqualArray(leaf.basis, basis))
      && leaf.canonicalSize === 32
      && Number.isSafeInteger(leaf.matrixDecimals) && leaf.matrixDecimals >= 0 && leaf.matrixDecimals <= 6
      && Number.isSafeInteger(leaf.seamEdgeMask) && leaf.seamEdgeMask >= 0 && leaf.seamEdgeMask <= 7
      && Number.isSafeInteger(leaf.width) && leaf.width > 0
      && Number.isSafeInteger(leaf.height) && leaf.height > 0, "INVALID_INTERACTION_STATE", `Interaction leaf ${index} is invalid.`);
    if (playback?.kind === "inline") require(playback.state.data.leafFit[index].canonicalSize === 32, "INTERACTION_TARGET_MISMATCH", `Interaction leaf ${index} does not match playback's fixed triangle basis.`);
  }

  require(Array.isArray(packet.controls) && packet.controls.length > 0 && packet.controls.length <= limits.maxInteractionControls, "INTERACTION_STATE_LIMIT", "Interaction controls are missing or excessive.");
  const ids = new Set();
  const roles = new Set();
  let totalVertices = 0;
  let totalWeights = 0;
  let totalReferences = 0;
  let totalLeafRows = 0;
  let grabControls = 0;
  for (const [controlIndex, control] of packet.controls.entries()) {
    exactObject(control, ["id", "role", "mode", "sourceOrder", "sourcePosition", "screenPosition", "cameraDistance", "attachmentObjectIndices", "closure"], "INVALID_INTERACTION_STATE", `Interaction control ${controlIndex}`);
    const id = stableId(control.id, `Interaction control ${controlIndex} id`);
    const role = stableId(control.role, `Interaction control ${controlIndex} role`);
    require(!ids.has(id) && !roles.has(role) && control.sourceOrder === controlIndex && (control.mode === "grab" || control.mode === "eye-follow"), "INVALID_INTERACTION_STATE", `Interaction control ${controlIndex} identity, order, or mode is invalid.`);
    ids.add(id);
    roles.add(role);
    if (control.mode === "grab") grabControls += 1;
    finiteF32Array(control.sourcePosition, 3, "INVALID_INTERACTION_STATE", `Interaction control ${controlIndex} source position`);
    finiteF32Array(control.screenPosition, 2, "INVALID_INTERACTION_STATE", `Interaction control ${controlIndex} screen position`);
    require(finiteF32(control.cameraDistance) && control.cameraDistance > 0, "INVALID_INTERACTION_STATE", `Interaction control ${controlIndex} camera distance is invalid.`);
    integerArray(control.attachmentObjectIndices, limits.maxInteractionObjects, "INTERACTION_STATE_LIMIT", `Interaction control ${controlIndex} attachments`, { minimum: 0, upper: Math.max(0, objectCount - 1), unique: true });
    require(control.attachmentObjectIndices.length > 0 && (control.mode !== "eye-follow" || control.attachmentObjectIndices.length === 1), "INVALID_INTERACTION_STATE", `Interaction control ${controlIndex} attachments are invalid.`);
    const closure = exactObject(control.closure, ["shapeIndices", "vertexRows", "vertexPositions", "weightActiveFlags", "weightScalars", "weightLinearContributions", "weightBaseTranslations", "leafIndices", "leafRows", "safeVisibleLeafIndices", "rigidRootInverseMatrix"], "INVALID_INTERACTION_STATE", `Interaction control ${controlIndex} closure`);
    integerArray(closure.shapeIndices, binding.targets.shapes.length, "INTERACTION_STATE_LIMIT", `Interaction control ${controlIndex} shape indices`, { minimum: 0, upper: Math.max(0, binding.targets.shapes.length - 1), unique: true });
    require(closure.shapeIndices.length > 0 && Array.isArray(closure.vertexRows) && closure.vertexRows.length % 4 === 0, "INVALID_INTERACTION_STATE", `Interaction control ${controlIndex} shape or vertex closure is invalid.`);
    const vertexCount = closure.vertexRows.length / 4;
    totalVertices += vertexCount;
    require(totalVertices <= limits.maxInteractionVertices && Array.isArray(closure.vertexPositions) && closure.vertexPositions.length === vertexCount * 3 && closure.vertexPositions.every(finiteF32), "INTERACTION_STATE_LIMIT", `Interaction control ${controlIndex} vertices are invalid or excessive.`);
    const shapeSet = new Set(closure.shapeIndices);
    let maximumWeight = 0;
    for (let row = 0; row < vertexCount; row += 1) {
      const offset = row * 4;
      const rowValues = closure.vertexRows.slice(offset, offset + 4);
      require(rowValues.every(Number.isSafeInteger) && shapeSet.has(rowValues[0]) && rowValues[1] >= 0 && rowValues[2] >= 0 && rowValues[3] >= 0, "INVALID_INTERACTION_STATE", `Interaction control ${controlIndex} vertex row ${row} is invalid.`);
      const rowEnd = rowValues[2] + rowValues[3];
      require(Number.isSafeInteger(rowEnd), "INVALID_INTERACTION_STATE", `Interaction control ${controlIndex} vertex row ${row} overflows.`);
      maximumWeight = Math.max(maximumWeight, rowEnd);
      totalReferences += rowValues[3];
      require(Number.isSafeInteger(totalReferences) && totalReferences <= limits.maxInteractionWeightReferences, "INTERACTION_STATE_LIMIT", "Interaction weight references are excessive.");
    }
    require(Array.isArray(closure.weightScalars) && Array.isArray(closure.weightActiveFlags) && Array.isArray(closure.weightLinearContributions) && Array.isArray(closure.weightBaseTranslations), "INTERACTION_STATE_LIMIT", `Interaction control ${controlIndex} weight tables are missing.`);
    const weightCount = closure.weightScalars.length;
    totalWeights += weightCount;
    require(Number.isSafeInteger(weightCount) && totalWeights <= limits.maxInteractionWeights && maximumWeight <= weightCount
      && closure.weightActiveFlags.length === weightCount
      && closure.weightLinearContributions.length === weightCount * 3
      && closure.weightBaseTranslations.length === weightCount * 3
      && closure.weightScalars.every(finiteF32)
      && closure.weightLinearContributions.every(finiteF32)
      && closure.weightBaseTranslations.every(finiteF32)
      && closure.weightActiveFlags.every((flag) => flag === 0 || flag === 1), "INTERACTION_STATE_LIMIT", `Interaction control ${controlIndex} weight tables are invalid or excessive.`);
    const reconstructionBounds = control.mode === "eye-follow"
      ? [source.eyeMaximumOffset, source.eyeMaximumOffset, source.eyeMaximumOffset]
      : selectedOffsetBounds;
    for (let row = 0; row < vertexCount; row += 1) {
      for (let component = 0; component < 3; component += 1) {
        require(reconstructionIsFinite(closure, row, component, reconstructionBounds[component]), "INVALID_INTERACTION_STATE", `Interaction control ${controlIndex} vertex ${row} reconstruction can overflow.`);
      }
    }
    integerArray(closure.leafIndices, packet.leaves.length, "INTERACTION_STATE_LIMIT", `Interaction control ${controlIndex} leaf indices`, { minimum: 0, upper: Math.max(0, packet.leaves.length - 1), unique: true });
    require(Array.isArray(closure.leafRows) && closure.leafRows.length === closure.leafIndices.length * 4, "INVALID_INTERACTION_STATE", `Interaction control ${controlIndex} leaf rows are invalid.`);
    totalLeafRows += closure.leafIndices.length;
    require(totalLeafRows <= limits.maxInteractionLeafRows, "INTERACTION_STATE_LIMIT", "Interaction leaf rows are excessive.");
    for (let row = 0; row < closure.leafIndices.length; row += 1) {
      const values = closure.leafRows.slice(row * 4, row * 4 + 4);
      require(values.every(Number.isSafeInteger) && values[0] === closure.leafIndices[row] && values.slice(1).every((value) => value >= 0 && value < vertexCount), "INVALID_INTERACTION_STATE", `Interaction control ${controlIndex} leaf row ${row} is invalid.`);
    }
    integerArray(closure.safeVisibleLeafIndices, closure.leafIndices.length, "INTERACTION_STATE_LIMIT", `Interaction control ${controlIndex} safe-visible leaves`, { minimum: 0, upper: Math.max(0, packet.leaves.length - 1), unique: true });
    const leafSet = new Set(closure.leafIndices);
    require(closure.safeVisibleLeafIndices.every((index) => leafSet.has(index)), "INVALID_INTERACTION_STATE", `Interaction control ${controlIndex} safe-visible leaves escape its closure.`);
    if (control.mode === "eye-follow") finiteF32Array(closure.rigidRootInverseMatrix, 16, "INVALID_INTERACTION_STATE", `Interaction control ${controlIndex} rigid inverse matrix`);
    else require(Array.isArray(closure.rigidRootInverseMatrix) && closure.rigidRootInverseMatrix.length === 0, "INVALID_INTERACTION_STATE", `Grab control ${controlIndex} declares a rigid inverse matrix.`);
    if (control.mode === "eye-follow") {
      const rotationOffset = control.attachmentObjectIndices[0] * 16;
      const rotation = packet.objects.rotationMatrices.slice(rotationOffset, rotationOffset + 16);
      require(eyeMatrixIsFinite(rotation, closure.rigidRootInverseMatrix, source.eyeMaximumOffset), "INVALID_INTERACTION_STATE", `Interaction eye control ${controlIndex} matrix envelope can overflow.`);
      const projected = projectedF32(control.sourcePosition, source);
      require(projected, "INVALID_INTERACTION_STATE", `Interaction eye control ${controlIndex} projection overflows.`);
      for (const cursorX of [input.cursorBounds[0], input.cursorBounds[1]]) {
        for (const cursorY of [input.cursorBounds[2], input.cursorBounds[3]]) {
          const eyeOffset = [multiplyF32(addF32(cursorX, -projected[0]), source.eyeGain), multiplyF32(addF32(projected[1], -cursorY), source.eyeGain), 0];
          require(eyeOffset.every(Number.isFinite) && finiteMagnitudeF32(eyeOffset), "INVALID_INTERACTION_STATE", `Interaction eye control ${controlIndex} offset overflows.`);
        }
      }
      const cameraPlane = [
        Math.fround(Math.fround(source.cameraViewMatrix[2] * control.sourcePosition[0]) + Math.fround(source.cameraViewMatrix[6] * control.sourcePosition[1])),
        source.cameraViewMatrix[10] * control.sourcePosition[2],
        source.cameraViewMatrix[14],
      ].reduce((value, component) => Math.fround(value + Math.fround(component)), 0);
      require(Number.isFinite(cameraPlane) && Math.abs(cameraPlane) > 1e-6, "INVALID_INTERACTION_STATE", `Interaction eye control ${controlIndex} lies on the camera plane.`);
    } else {
      for (let component = 0; component < 3; component += 1) require(Number.isFinite(addF32(control.sourcePosition[component], selectedOffsetBounds[component])) && Number.isFinite(addF32(control.sourcePosition[component], -selectedOffsetBounds[component])), "INVALID_INTERACTION_STATE", `Interaction grab control ${controlIndex} position envelope overflows.`);
    }
  }
  require(grabControls > 0, "INVALID_INTERACTION_STATE", "Interaction requires a grab control.");
  return packet;
}

function exactEqualArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function validateTargetOwnership(channels, limits) {
  const byInterpreter = new Map([...channels.values()].map((channel) => [channel.interpreter, channel]));
  const targetsOf = (channel) => new Set(collectTargets(channel.targets, limits.maxNodes + 1, limits.maxTreeDepth));
  const effects = byInterpreter.get("polycss-effects@0");
  if (effects) {
    const owned = targetsOf(effects);
    for (const channel of channels.values()) {
      if (channel === effects) continue;
      for (const target of targetsOf(channel)) require(!owned.has(target), "TARGET_OWNERSHIP_CONFLICT", `Effects target ${target} is also owned by ${channel.interpreter}.`);
    }
  }
  const playback = byInterpreter.get("polycss-playback@0") ?? byInterpreter.get("polycss-paged-playback@0");
  const presentation = byInterpreter.get("static-presentation@0");
  if (playback && presentation) {
    const owned = targetsOf(playback);
    for (const target of targetsOf(presentation)) if (target !== "$host") require(!owned.has(target), "TARGET_OWNERSHIP_CONFLICT", `Presentation target ${target} overlaps playback ownership.`);
  }
}

function validateInitialSurfaceClosure(packet, playback, tree) {
  const packed = Uint8Array.from(globalThis.atob(packet.visibility.initialVisibleBitsBase64), (character) => character.charCodeAt(0));
  const targetFrame = packet.transitions.initialFrame - 1;
  const positionDictionary = packet.surface.statePacking.positionDictionary;
  const positionIndices = positionDictionary
    ? base64Integers(packet.surface.statePacking.positionIndicesBase64, 2, packet.surface.statePacking.stateCount, "INVALID_SURFACE_STATE", "Surface position indices")
    : undefined;
  const coordinate = (value) => value === 0 ? "0" : `${value}px`;
  for (const [index, target] of playback.binding.targets.leaves.entries()) {
    const node = tree.byId.get(target);
    const expectedVisibility = ((packed[index >> 3] >> (index & 7)) & 1) === 1 ? "visible" : "hidden";
    require(node?.styles?.visibility === expectedVisibility, "SURFACE_TREE_MISMATCH", `Surface leaf ${index} initial visibility differs from TREE.`);
    const face = packet.surface.faces[index];
    let sourceFrame = 0;
    let selectedFrame = 0;
    let selectedState = 0;
    for (let local = 0; local < face.stateCount; local += 1) {
      sourceFrame += packet.surface.statePacking.sourceFrameDeltas[face.stateOffset + local];
      if (sourceFrame > targetFrame) break;
      selectedFrame = sourceFrame;
      selectedState = local;
    }
    const actual = positionDictionary ? node.styles.backgroundPosition : node.styles.backgroundPositionY;
    const expected = positionDictionary
      ? positionDictionary[positionIndices[face.stateOffset + selectedState]].map(coordinate).join(" ")
      : selectedFrame === 0 ? "0" : `${-selectedFrame * face.leafHeight}px`;
    require(positionDictionary ? actual === expected : selectedFrame === 0 ? actual === undefined || actual === "0" || actual === "0px" || actual === "0%" : actual === expected, "SURFACE_TREE_MISMATCH", `Surface leaf ${index} initial atlas position differs from TREE.`);
  }
}

function validateVariants(state, binding, playback, inputs, tree, limits, surfaceBinding) {
  const sourceFrame = inputs.get("time.source-frame");
  require(sourceFrame?.type === "uint" && !Object.hasOwn(sourceFrame, "default"), "INVALID_VARIANT_BINDING", "Variant time.source-frame must be an un-defaulted uint.");
  require(!Object.hasOwn(binding, "parameters"), "INVALID_VARIANT_BINDING", "Variant binding has no parameters.");
  const targets = exactObject(binding.targets, ["effectNodes", "nodes"], "INVALID_VARIANT_BINDING", "Variant targets");
  uniqueTargets(targets.nodes, "Variant node");
  uniqueTargets(targets.effectNodes, "Variant effect node");
  require(targets.nodes.length > 0 && targets.nodes.length <= 65_535, "TARGET_CARDINALITY_MISMATCH", "Variant target count is invalid.");
  require(targets.effectNodes.length < 65_535, "TARGET_CARDINALITY_MISMATCH", "Variant effect target count is invalid.");

  exactObject(state.data, ["packet"], "INVALID_VARIANT_STATE", "Variant state");
  const packet = exactObject(state.data.packet, ["version", "frameCount", "classes", "effects", "initial", "sequential", "nonInteractiveJumps"], "INVALID_VARIANT_STATE", "Variant packet");
  require(packet.version === 0 && packet.frameCount === playback.binding.parameters.frameCount, "FRAME_CARDINALITY_MISMATCH", "Variant version/frameCount differs from playback.");
  require(targets.nodes.length * packet.frameCount <= limits.maxVisibilityCells, "VARIANT_STATE_LIMIT", "Prepared variant state matrix is excessive.");
  require(Array.isArray(packet.classes) && packet.classes.length > 0 && packet.classes.length < 65_535 && packet.classes.length <= limits.maxPreparedStates, "VARIANT_STATE_LIMIT", "Prepared variant classes are invalid or excessive.");
  packet.classes.forEach((token, index) => require(typeof token === "string" && CLASS.test(token) && (index === 0 || packet.classes[index - 1] < token), "INVALID_VARIANT_STATE", `Prepared variant class ${index} is invalid or noncanonical.`));
  require(Array.isArray(packet.effects) && packet.effects.length > 0 && packet.effects.length <= limits.maxPreparedChanges, "VARIANT_EFFECT_LIMIT", "Prepared variant effect table is missing or excessive.");
  const effectClasses = new Set();
  const ownership = new Map();
  let previousEffect = "";
  const treeNodes = [...tree.byId.values()];
  const sinks = new Set(["class.prepared"]);
  for (const [index, effect] of packet.effects.entries()) {
    exactObject(effect, ["classIndex", "ownerIndex", "styles", "targetIndex"], "INVALID_VARIANT_EFFECT", `Variant effect ${index}`);
    require(Number.isSafeInteger(effect.classIndex) && effect.classIndex >= 0 && effect.classIndex < packet.classes.length, "INVALID_VARIANT_EFFECT", `Variant effect ${index} class is invalid.`);
    require(Number.isSafeInteger(effect.ownerIndex) && effect.ownerIndex >= 0 && effect.ownerIndex < targets.nodes.length, "INVALID_VARIANT_EFFECT", `Variant effect ${index} owner is invalid.`);
    require(Number.isSafeInteger(effect.targetIndex) && (effect.targetIndex === 65_535 || (effect.targetIndex >= 0 && effect.targetIndex < targets.effectNodes.length)), "INVALID_VARIANT_EFFECT", `Variant effect ${index} target is invalid.`);
    const key = `${String(effect.classIndex).padStart(5, "0")}:${String(effect.ownerIndex).padStart(5, "0")}:${String(effect.targetIndex).padStart(5, "0")}`;
    require(key > previousEffect, "INVALID_VARIANT_EFFECT", "Variant effects are not unique and canonical.");
    previousEffect = key;
    effectClasses.add(effect.classIndex);
    const ownerId = targets.nodes[effect.ownerIndex];
    const ownerNode = tree.byId.get(ownerId);
    const targetId = effect.targetIndex === 65_535 ? ownerId : targets.effectNodes[effect.targetIndex];
    const targetNode = tree.byId.get(targetId);
    if (effect.targetIndex !== 65_535) {
      let parent = targetNode.parent;
      let descendant = false;
      while (parent >= 0) {
        if (parent === ownerNode.index) { descendant = true; break; }
        parent = treeNodes[parent].parent;
      }
      require(descendant, "INVALID_VARIANT_EFFECT", `Variant effect ${index} target is not below its owner.`);
    }
    exactObject(effect.styles, Object.keys(VARIANT_EFFECT_PROPERTIES), "INVALID_VARIANT_EFFECT", `Variant effect ${index} styles`, []);
    const entries = Object.entries(effect.styles);
    require(entries.length > 0 && entries.length <= Object.keys(VARIANT_EFFECT_PROPERTIES).length, "INVALID_VARIANT_EFFECT", `Variant effect ${index} styles are empty or excessive.`);
    for (const [property, value] of entries) {
      require(Object.hasOwn(VARIANT_EFFECT_PROPERTIES, property) && typeof value === "string" && value.length > 0, "INVALID_VARIANT_EFFECT", `Variant effect ${index} style ${property} is invalid.`);
      safeStyle(value, `Variant effect ${index} style ${property}`);
      if (property === "display") require(value === "block" || value === "none", "INVALID_VARIANT_EFFECT", `Variant effect ${index} display is unsupported.`);
      if (property === "backgroundPositionX") require(/^(?:0|-?[1-9][0-9]*px)$/u.test(value), "INVALID_VARIANT_EFFECT", `Variant effect ${index} backgroundPositionX is noncanonical.`);
      const conflicts = property === "backgroundPositionX" ? ["backgroundPosition", "backgroundPositionX"] : [property];
      require(!conflicts.some((name) => Object.hasOwn(targetNode.styles ?? {}, name)), "VARIANT_TREE_MISMATCH", `Variant effect ${index} is shadowed by TREE inline state.`);
      const sink = VARIANT_EFFECT_PROPERTIES[property];
      if (sink === "style.backgroundPositionX" && surfaceBinding?.sinks.includes("style.backgroundPosition")) {
        const surfaceTargets = new Set(collectTargets(surfaceBinding.targets, limits.maxNodes + 1, limits.maxTreeDepth));
        require(!surfaceTargets.has(targetId), "TARGET_OWNERSHIP_CONFLICT", `Variant effect ${index} conflicts with full prepared surface ownership.`);
      }
      sinks.add(sink);
      const ownershipKey = `${targetId}\0${sink}`;
      require(!ownership.has(ownershipKey) || ownership.get(ownershipKey) === effect.ownerIndex, "TARGET_OWNERSHIP_CONFLICT", `Variant effect ${index} has multiple owners.`);
      ownership.set(ownershipKey, effect.ownerIndex);
    }
  }
  require(effectClasses.size === packet.classes.length, "INVALID_VARIANT_EFFECT", "Every variant class must declare an effect.");
  exactArray(binding.sinks, [...sinks].sort(), "INVALID_VARIANT_BINDING", "Variant sinks");
  const variantClasses = new Set(packet.classes);
  const validClass = (value) => value === 65_535 || value < packet.classes.length;

  const initial = exactObject(packet.initial, ["frame", "classIndicesBase64"], "INVALID_VARIANT_STATE", "Variant initial state");
  require(initial.frame === 1 && initial.frame === playback.packet.initial.sourceFrame, "FRAME_CARDINALITY_MISMATCH", "Variant initial frame differs from playback frame 1.");
  const initialIndices = base64Integers(initial.classIndicesBase64, 2, targets.nodes.length, "INVALID_VARIANT_STATE", "Variant initial classes");
  require(initialIndices.length === targets.nodes.length && initialIndices.every(validClass), "INVALID_VARIANT_STATE", "Variant initial classes are invalid.");
  for (const [index, target] of targets.nodes.entries()) {
    const active = (tree.byId.get(target)?.classes ?? []).filter((token) => variantClasses.has(token));
    const expected = initialIndices[index] === 65_535 ? [] : [packet.classes[initialIndices[index]]];
    require(exactEqualArray(active, expected), "VARIANT_TREE_MISMATCH", `Variant node ${index} initial class differs from TREE.`);
  }

  const sequential = exactObject(packet.sequential, ["offsetsBase64", "targetIndicesBase64", "classIndicesBase64"], "INVALID_VARIANT_STATE", "Variant sequential transitions");
  const offsets = base64Integers(sequential.offsetsBase64, 4, packet.frameCount + 1, "INVALID_VARIANT_STATE", "Variant offsets");
  const targetIndices = base64Integers(sequential.targetIndicesBase64, 2, limits.maxPreparedChanges, "VARIANT_STATE_LIMIT", "Variant targets");
  const classIndices = base64Integers(sequential.classIndicesBase64, 2, limits.maxPreparedChanges, "VARIANT_STATE_LIMIT", "Variant classes");
  require(offsets.length === packet.frameCount + 1 && offsets[0] === 0 && offsets.at(-1) === targetIndices.length && offsets.every((offset, index) => index === 0 || offsets[index - 1] <= offset), "STATE_COLUMN_MISMATCH", "Variant offsets are invalid.");
  require(targetIndices.length === classIndices.length, "STATE_COLUMN_MISMATCH", "Variant transition columns differ in length.");
  const applySegment = (row, segment, label) => {
    let previous = -1;
    for (let cursor = offsets[segment]; cursor < offsets[segment + 1]; cursor += 1) {
      const target = targetIndices[cursor];
      const classIndex = classIndices[cursor];
      require(target < targets.nodes.length && target > previous && validClass(classIndex), "INVALID_VARIANT_STATE", `${label} is invalid.`);
      require(row[target] !== classIndex, "INVALID_VARIANT_STATE", `${label} contains a no-op.`);
      row[target] = classIndex;
      previous = target;
    }
  };
  require(Array.isArray(packet.nonInteractiveJumps) && packet.nonInteractiveJumps.length <= packet.frameCount, "INVALID_VARIANT_STATE", "Variant jumps are invalid or excessive.");
  const pairs = new Set();
  const jumpEndpoints = new Set();
  const decodedJumps = [];
  for (const [index, jump] of packet.nonInteractiveJumps.entries()) {
    exactObject(jump, ["fromFrame", "toFrame", "targetIndicesBase64", "classIndicesBase64"], "INVALID_VARIANT_STATE", `Variant jump ${index}`);
    require(Number.isSafeInteger(jump.fromFrame) && jump.fromFrame >= 1 && jump.fromFrame <= packet.frameCount && Number.isSafeInteger(jump.toFrame) && jump.toFrame >= 1 && jump.toFrame <= packet.frameCount && jump.fromFrame !== jump.toFrame, "INVALID_VARIANT_STATE", `Variant jump ${index} frames are invalid.`);
    const pair = `${jump.fromFrame}>${jump.toFrame}`;
    require(!pairs.has(pair), "INVALID_VARIANT_STATE", `Variant jump ${pair} is duplicated.`);
    pairs.add(pair);
    const jumpTargets = base64Integers(jump.targetIndicesBase64, 2, targets.nodes.length, "INVALID_VARIANT_STATE", `Variant jump ${index} targets`);
    const jumpClasses = base64Integers(jump.classIndicesBase64, 2, targets.nodes.length, "INVALID_VARIANT_STATE", `Variant jump ${index} classes`);
    require(jumpTargets.length === jumpClasses.length && jumpTargets.every((target, cursor) => target < targets.nodes.length && (cursor === 0 || jumpTargets[cursor - 1] < target) && validClass(jumpClasses[cursor])), "INVALID_VARIANT_STATE", `Variant jump ${index} rows are invalid.`);
    jumpEndpoints.add(jump.fromFrame);
    jumpEndpoints.add(jump.toFrame);
    decodedJumps.push({ pair, fromFrame: jump.fromFrame, toFrame: jump.toFrame, targets: jumpTargets, classes: jumpClasses });
  }
  const endpointRows = new Map();
  if (jumpEndpoints.has(1)) endpointRows.set(1, initialIndices);
  const current = initialIndices.slice();
  for (let frame = 2; frame <= packet.frameCount; frame += 1) {
    applySegment(current, frame - 1, `Variant transition ${frame - 1}>${frame}`);
    if (jumpEndpoints.has(frame)) endpointRows.set(frame, current.slice());
  }
  applySegment(current, 0, `Variant transition ${packet.frameCount}>1`);
  require(exactEqualArray(current, initialIndices), "VARIANT_TRANSITION_MISMATCH", "Variant wrap transition does not reproduce frame 1.");
  for (const jump of decodedJumps) {
    const expectedTargets = [];
    const expectedClasses = [];
    const from = endpointRows.get(jump.fromFrame);
    const to = endpointRows.get(jump.toFrame);
    for (let target = 0; target < targets.nodes.length; target += 1) if (from[target] !== to[target]) {
      expectedTargets.push(target);
      expectedClasses.push(to[target]);
    }
    require(exactEqualArray(jump.targets, expectedTargets) && exactEqualArray(jump.classes, expectedClasses), "VARIANT_JUMP_MISMATCH", `Variant jump ${jump.pair} contradicts canonical target state.`);
  }
  return packet;
}

function desiredPageResources(packet, frame, pinnedFrames) {
  const current = packet.pages.findIndex((page) => frame >= page.startFrame && frame <= page.endFrame);
  require(current >= 0, "STATE_PAGE_COVERAGE_MISMATCH", `Prepared frame ${frame} has no state page descriptor.`);
  const resources = new Set([packet.pages[current].resource]);
  for (const pinnedFrame of pinnedFrames) {
    const page = packet.pages.find((descriptor) => pinnedFrame >= descriptor.startFrame && pinnedFrame <= descriptor.endFrame);
    require(page, "STATE_PAGE_COVERAGE_MISMATCH", `Pinned prepared frame ${pinnedFrame} has no state page descriptor.`);
    resources.add(page.resource);
  }
  for (let offset = 1; offset <= packet.lookaheadPages; offset += 1) resources.add(packet.pages[(current + offset) % packet.pages.length].resource);
  return resources;
}

function requiredDocumentStateResidency(packets, pinnedFrames, activeFramePins = []) {
  let required = 0;
  const candidateFrames = [...new Set(packets.flatMap((packet) => packet.pages.map((page) => page.startFrame)))];
  const candidatePins = activeFramePins.length === 0 ? [undefined] : activeFramePins;
  for (const frame of candidateFrames) {
    for (const activeFramePin of candidatePins) {
      const resources = new Set();
      const pins = activeFramePin === undefined ? pinnedFrames : [...pinnedFrames, activeFramePin];
      for (const packet of packets) for (const resource of desiredPageResources(packet, frame, pins)) resources.add(resource);
      required = Math.max(required, resources.size);
    }
  }
  return required;
}

function validatePagedVariants(state, binding, playback, inputs, tree, limits, surfaceBinding) {
  exactObject(state.data, ["packet"], "INVALID_PAGED_VARIANT_STATE", "Paged variant state");
  const packet = exactObject(state.data.packet, ["version", "frameCount", "classes", "effects", "initial", "pages", "lookaheadPages", "maxResidentPages"], "INVALID_PAGED_VARIANT_STATE", "Paged variant packet");
  require(packet.version === 0 && Number.isSafeInteger(packet.frameCount) && packet.frameCount > 0 && packet.frameCount === playback.binding.parameters.frameCount, "STATE_PAGE_COVERAGE_MISMATCH", "Paged variant frame count differs from playback.");
  const zero = globalThis.btoa("\0".repeat((packet.frameCount + 1) * 4));
  validateVariants({ ...state, data: { packet: { version: 0, frameCount: packet.frameCount, classes: packet.classes, effects: packet.effects, initial: packet.initial, sequential: { offsetsBase64: zero, targetIndicesBase64: "", classIndicesBase64: "" }, nonInteractiveJumps: [] } } }, binding, playback, inputs, tree, limits, surfaceBinding);
  require(Number.isSafeInteger(packet.lookaheadPages) && packet.lookaheadPages >= 1 && packet.lookaheadPages <= 4 && Number.isSafeInteger(packet.maxResidentPages) && packet.maxResidentPages >= packet.lookaheadPages + 1 && packet.maxResidentPages <= 16, "STATE_PAGE_RESIDENCY_LIMIT", "Paged variant residency is invalid.");
  require(Array.isArray(packet.pages) && packet.pages.length > 0 && packet.pages.length <= limits.maxStatePages, "STATE_PAGE_COVERAGE_MISMATCH", "Paged variant descriptors are missing or excessive.");
  const resources = new Set();
  let expected = 1;
  for (const [index, page] of packet.pages.entries()) {
    exactObject(page, ["resource", "startFrame", "endFrame", "changeCount", "materializedByteLength"], "INVALID_PAGED_VARIANT_STATE", `Paged variant descriptor ${index}`);
    assertResourceId(page.resource, `Paged variant descriptor ${index} resource`);
    require(!resources.has(page.resource) && page.startFrame === expected && Number.isSafeInteger(page.endFrame) && page.endFrame >= page.startFrame && page.endFrame <= packet.frameCount, "STATE_PAGE_COVERAGE_MISMATCH", `Paged variant descriptor ${index} is invalid or noncontiguous.`);
    require(page.endFrame - page.startFrame + 1 <= limits.maxStatePageFrames, "STATE_PAGE_COVERAGE_MISMATCH", `Paged variant descriptor ${index} exceeds the per-page frame limit.`);
    require(Number.isSafeInteger(page.changeCount) && page.changeCount >= 0 && page.changeCount <= limits.maxPreparedChanges, "STATE_CHANGE_LIMIT", `Paged variant descriptor ${index} change count is invalid or excessive.`);
    require(Number.isSafeInteger(page.materializedByteLength) && page.materializedByteLength > 0 && page.materializedByteLength <= limits.maxDecodedInputBytes, "STATE_PAGE_RESIDENCY_LIMIT", `Paged variant descriptor ${index} materialized size is invalid or excessive.`);
    resources.add(page.resource);
    expected = page.endFrame + 1;
  }
  require(expected === packet.frameCount + 1, "STATE_PAGE_COVERAGE_MISMATCH", "Paged variant descriptors do not cover playback exactly.");
  return packet;
}

function validateCompositorTiming(state, binding, playback, inputs, limits) {
  const sourceFrame = inputs.get("time.source-frame");
  const tick = inputs.get("time.tick");
  require(sourceFrame?.type === "uint" && tick?.type === "uint" && !Object.hasOwn(sourceFrame, "default") && !Object.hasOwn(tick, "default"), "INVALID_COMPOSITOR_TIMING_BINDING", "Compositor timing inputs must be un-defaulted uints.");
  exactObject(binding.targets, ["nodes"], "INVALID_COMPOSITOR_TIMING_BINDING", "Compositor timing targets");
  uniqueTargets(binding.targets.nodes, "Compositor timing");
  exactObject(binding.parameters, ["frameCount", "tickRateHz", "tickIntervalUs"], "INVALID_COMPOSITOR_TIMING_BINDING", "Compositor timing parameters", ["frameCount"]);
  validateTickCadence(binding.parameters, "INVALID_COMPOSITOR_TIMING_BINDING", "Compositor timing");
  require(binding.parameters.frameCount === playback.binding.parameters.frameCount && sameTickCadence(binding.parameters, playback.binding.parameters), "INVALID_COMPOSITOR_TIMING_BINDING", "Compositor timing cadence differs from playback.");
  require([
    playback.packet.timeline,
    ...(playback.packet.profileTimelines ?? []),
    ...(playback.packet.banks?.flatMap((bank) => [bank.timeline, ...(bank.profileTimelines ?? [])]) ?? []),
  ].every((timeline) => timeline.deadlineMicros === undefined), "INVALID_COMPOSITOR_TIMING_BINDING", "Compositor timing requires fixed playback cadence.");
  exactObject(state.data, ["packet"], "INVALID_COMPOSITOR_TIMING_STATE", "Compositor timing state");
  const packet = exactObject(state.data.packet, ["version", "timing", "targets"], "INVALID_COMPOSITOR_TIMING_STATE", "Compositor timing packet");
  require(packet.version === 0 && packet.timing === "linear" && Array.isArray(packet.targets) && packet.targets.length > 0 && packet.targets.length <= Math.min(limits.maxNodes, 1024), "INVALID_COMPOSITOR_TIMING_STATE", "Compositor timing packet is invalid or excessive.");
  require(packet.targets.length === binding.targets.nodes.length, "TARGET_CARDINALITY_MISMATCH", "Compositor timing target counts differ.");
  let keyframes = 0;
  for (const [targetIndex, target] of packet.targets.entries()) {
    require(target && typeof target === "object" && !Array.isArray(target), "INVALID_COMPOSITOR_TIMING_STATE", `Compositor target ${targetIndex} is invalid.`);
    const expectedNode = target.owner === "model" ? (target.index === 0 ? playback.binding.targets.model : undefined) : target.owner === "shape" ? playback.binding.targets.shapes[target.index] : target.owner === "leaf" ? playback.binding.targets.leaves[target.index] : undefined;
    require(expectedNode === binding.targets.nodes[targetIndex], "INVALID_COMPOSITOR_TIMING_BINDING", `Compositor target ${targetIndex} is not its playback owner.`);
    if (target.kind === "cycle") {
      exactObject(target, ["kind", "owner", "index", "durationTicks", "iterations", "closure", "keyframes"], "INVALID_COMPOSITOR_TIMING_STATE", `Compositor cycle ${targetIndex}`);
      require(target.owner === "model" && target.index === 0 && target.iterations === "infinite" && target.closure === "closed" && Number.isSafeInteger(target.durationTicks) && target.durationTicks >= 2 && target.durationTicks <= limits.maxTimelineTicks && Array.isArray(target.keyframes) && target.keyframes.length >= 3 && target.keyframes.length <= 256, "INVALID_COMPOSITOR_TIMING_STATE", `Compositor cycle ${targetIndex} is invalid.`);
      let previous = -1;
      for (const [index, row] of target.keyframes.entries()) {
        exactObject(row, ["tick", "transformIndex"], "INVALID_COMPOSITOR_TIMING_STATE", `Compositor keyframe ${index}`);
        require(Number.isSafeInteger(row.tick) && row.tick > previous && row.tick <= target.durationTicks && Number.isSafeInteger(row.transformIndex) && row.transformIndex >= 0 && row.transformIndex < playback.packet.transforms.count, "INVALID_COMPOSITOR_TIMING_STATE", `Compositor keyframe ${index} is invalid.`);
        previous = row.tick;
      }
      require(target.keyframes[0].tick === 0 && target.keyframes.at(-1).tick === target.durationTicks && target.keyframes[0].transformIndex === target.keyframes.at(-1).transformIndex && playback.packet.frameRows.every((row) => row[2] === -1), "TARGET_OWNERSHIP_CONFLICT", `Compositor cycle ${targetIndex} is not closed or races playback.`);
      keyframes += target.keyframes.length;
    } else {
      exactObject(target, ["kind", "owner", "index", "durationTicks"], "INVALID_COMPOSITOR_TIMING_STATE", `Compositor transition ${targetIndex}`);
      require(target.kind === "transition" && Number.isSafeInteger(target.durationTicks) && target.durationTicks >= 1 && target.durationTicks <= 8, "INVALID_COMPOSITOR_TIMING_STATE", `Compositor transition ${targetIndex} is invalid.`);
    }
  }
  require(keyframes <= 4096, "COMPOSITOR_TIMING_LIMIT", "Compositor keyframes are excessive.");
}

function validateViewportProfiles(state, binding, playback, presentation, inputs, limits) {
  for (const id of ["viewport.height", "viewport.width"]) require(inputs.get(id)?.type === "float" && !Object.hasOwn(inputs.get(id), "default"), "INVALID_VIEWPORT_PROFILE_BINDING", "Viewport profile inputs must be un-defaulted floats.");
  require(!Object.hasOwn(binding, "parameters"), "INVALID_VIEWPORT_PROFILE_BINDING", "Viewport profiles have no parameters.");
  exactObject(binding.targets, ["leaves"], "INVALID_VIEWPORT_PROFILE_BINDING", "Viewport profile targets");
  uniqueTargets(binding.targets.leaves, "Viewport profile leaf");
  require(exactEqualArray(binding.targets.leaves, playback.binding.targets.leaves), "TARGET_CARDINALITY_MISMATCH", "Viewport profile leaves differ from playback.");
  exactObject(state.data, ["packet"], "INVALID_VIEWPORT_PROFILE_STATE", "Viewport profile state");
  const packet = exactObject(state.data.packet, ["version", "selection", "transforms", "profiles"], "INVALID_VIEWPORT_PROFILE_STATE", "Viewport profile packet");
  require(packet.version === 0, "INVALID_VIEWPORT_PROFILE_STATE", "Viewport profile version must be zero.");
  exactObject(packet.selection, ["mode"], "INVALID_VIEWPORT_PROFILE_STATE", "Viewport profile selection");
  require(packet.selection.mode === "presentation-profile" || packet.selection.mode === "smallest-covering", "INVALID_VIEWPORT_PROFILE_STATE", "Viewport profile selection is unsupported.");
  require(Array.isArray(packet.transforms) && packet.transforms.length < 65_535 && packet.transforms.length <= limits.maxPreparedTransforms, "TRANSFORM_ALLOCATION_LIMIT", "Viewport transform dictionary is excessive.");
  let previousTransform;
  for (const transform of packet.transforms) {
    require(Array.isArray(transform) && transform.length === 12 && transform.every((value) => typeof value === "number" && Number.isFinite(value)), "INVALID_VIEWPORT_PROFILE_STATE", "Viewport transform is invalid.");
    if (previousTransform) {
      const difference = transform.findIndex((value, index) => value !== previousTransform[index]);
      require(difference >= 0 && transform[difference] > previousTransform[difference], "INVALID_VIEWPORT_PROFILE_STATE", "Viewport transforms are not lexicographically sorted.");
    }
    previousTransform = transform;
  }
  require(Array.isArray(packet.profiles) && packet.profiles.length > 0 && packet.profiles.length <= 256 && packet.profiles.length * Math.max(1, playback.packet.leafCount) <= limits.maxVisibilityCells, "VIEWPORT_PROFILE_LIMIT", "Viewport profiles are missing or excessive.");
  const presentationProfiles = presentation.packet.camera.profiles;
  if (packet.selection.mode === "presentation-profile") require(presentationProfiles && packet.profiles.length === presentationProfiles.length, "INVALID_VIEWPORT_PROFILE_STATE", "Viewport profiles differ from presentation profiles.");
  const ids = new Set();
  const referenced = new Set();
  let previousKey;
  let visibilityChangeCount = 0;
  let responsiveCoefficientCount = 0;
  for (const [index, profile] of packet.profiles.entries()) {
    exactObject(profile, ["id", "width", "height", "transformIndicesBase64", "visibleBitsBase64", "visibilityChanges", "responsiveAffine"], "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index}`, ["id", "transformIndicesBase64", "visibleBitsBase64"]);
    const id = stableId(profile.id, `Viewport profile ${index} id`);
    require(!ids.has(id), "INVALID_VIEWPORT_PROFILE_STATE", "Viewport profile ids are duplicated.");
    ids.add(id);
    if (packet.selection.mode === "presentation-profile") require(!Object.hasOwn(profile, "width") && !Object.hasOwn(profile, "height") && id === presentationProfiles[index].id, "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} differs from presentation order.`);
    else {
      require(Number.isSafeInteger(profile.width) && profile.width > 0 && profile.width <= 1_000_000 && Number.isSafeInteger(profile.height) && profile.height > 0 && profile.height <= 1_000_000, "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} dimensions are invalid.`);
      const key = [profile.width * profile.height, profile.width + profile.height, profile.width, profile.height];
      if (previousKey) { const difference = key.findIndex((value, cursor) => value !== previousKey[cursor]); require(difference >= 0 && key[difference] > previousKey[difference], "INVALID_VIEWPORT_PROFILE_STATE", "Viewport covering profiles are not sorted."); }
      previousKey = key;
    }
    const transforms = base64Integers(profile.transformIndicesBase64, 2, playback.packet.leafCount, "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} transforms`);
    require(transforms.length === playback.packet.leafCount && transforms.every((value) => value === 65_535 || value < packet.transforms.length), "STATE_COLUMN_MISMATCH", `Viewport profile ${index} transforms are invalid.`);
    transforms.forEach((value) => { if (value !== 65_535) referenced.add(value); });
    const bits = base64Integers(profile.visibleBitsBase64, 1, Math.ceil(playback.packet.leafCount / 8), "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} visibility`);
    require(bits.length === Math.ceil(playback.packet.leafCount / 8) && (playback.packet.leafCount % 8 === 0 || bits.length === 0 || (bits.at(-1) >> (playback.packet.leafCount % 8)) === 0), "STATE_COLUMN_MISMATCH", `Viewport profile ${index} visibility is invalid.`);
    if (profile.visibilityChanges !== undefined) {
      exactObject(profile.visibilityChanges, ["offsetsBase64", "leafIndicesBase64"], "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} visibility changes`);
      const frameCount = playback.binding.parameters.frameCount;
      const offsets = base64Integers(profile.visibilityChanges.offsetsBase64, 4, frameCount + 1, "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} visibility offsets`);
      const leaves = base64Integers(profile.visibilityChanges.leafIndicesBase64, 2, limits.maxPreparedChanges, "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} visibility leaves`);
      require(offsets.length === frameCount + 1 && offsets[0] === 0 && offsets.at(-1) === leaves.length && offsets.every((offset, cursor) => cursor === 0 || offset >= offsets[cursor - 1]), "STATE_COLUMN_MISMATCH", `Viewport profile ${index} visibility offsets are invalid.`);
      for (let frame = 0; frame < frameCount; frame += 1) {
        let previousLeaf = -1;
        for (let cursor = offsets[frame]; cursor < offsets[frame + 1]; cursor += 1) {
          require(leaves[cursor] < playback.packet.leafCount && leaves[cursor] > previousLeaf, "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} visibility frame is unsorted or out of range.`);
          previousLeaf = leaves[cursor];
        }
      }
      visibilityChangeCount += leaves.length;
      require(Number.isSafeInteger(visibilityChangeCount) && visibilityChangeCount <= limits.maxPreparedChanges, "VIEWPORT_PROFILE_LIMIT", "Viewport profile visibility changes are excessive.");
      const reconstructed = Uint8Array.from({ length: playback.packet.leafCount }, (_, leaf) => (bits[leaf >> 3] >> (leaf & 7)) & 1);
      for (let frame = 1; frame < frameCount; frame += 1) for (let cursor = offsets[frame]; cursor < offsets[frame + 1]; cursor += 1) reconstructed[leaves[cursor]] ^= 1;
      for (let cursor = offsets[0]; cursor < offsets[1]; cursor += 1) reconstructed[leaves[cursor]] ^= 1;
      require(reconstructed.every((visible, leaf) => visible === ((bits[leaf >> 3] >> (leaf & 7)) & 1)), "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} visibility cycle does not close.`);
    }
    if (profile.responsiveAffine !== undefined) {
      exactObject(profile.responsiveAffine, ["scale", "presentBitsBase64", "coefficientsBase64"], "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} responsive affine`);
      exactObject(profile.responsiveAffine.scale, ["baseWidth", "baseHeight", "multiplier", "max"], "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} responsive affine scale`, ["baseWidth", "baseHeight", "multiplier"]);
      for (const key of ["baseWidth", "baseHeight", "multiplier"]) require(typeof profile.responsiveAffine.scale[key] === "number" && Number.isFinite(profile.responsiveAffine.scale[key]) && profile.responsiveAffine.scale[key] > 0 && profile.responsiveAffine.scale[key] <= 1_000_000, "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} responsive affine scale is invalid.`);
      if (Object.hasOwn(profile.responsiveAffine.scale, "max")) require(typeof profile.responsiveAffine.scale.max === "number" && Number.isFinite(profile.responsiveAffine.scale.max) && profile.responsiveAffine.scale.max > 0 && profile.responsiveAffine.scale.max <= 1_000_000, "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} responsive affine maximum is invalid.`);
      const present = base64Integers(profile.responsiveAffine.presentBitsBase64, 1, Math.ceil(playback.packet.leafCount / 8), "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} responsive affine presence`);
      require(present.length === Math.ceil(playback.packet.leafCount / 8) && (playback.packet.leafCount % 8 === 0 || present.length === 0 || (present.at(-1) >> (playback.packet.leafCount % 8)) === 0), "STATE_COLUMN_MISMATCH", `Viewport profile ${index} responsive affine presence is invalid.`);
      const presentCount = Array.from({ length: playback.packet.leafCount }, (_, leaf) => (present[leaf >> 3] >> (leaf & 7)) & 1).reduce((sum, value) => sum + value, 0);
      require(presentCount > 0, "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} responsive affine has no targets.`);
      const coefficientCount = presentCount * 16;
      responsiveCoefficientCount += coefficientCount;
      require(Number.isSafeInteger(responsiveCoefficientCount) && responsiveCoefficientCount <= limits.maxPreparedStates, "VIEWPORT_PROFILE_LIMIT", "Viewport profile responsive coefficients are excessive.");
      const coefficients = base64Float64(profile.responsiveAffine.coefficientsBase64, coefficientCount, "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} responsive affine coefficients`);
      require(coefficients.length === coefficientCount && coefficients.every((value) => Number.isFinite(value) && !Object.is(value, -0) && Math.abs(value) <= 1_000_000_000), "INVALID_VIEWPORT_PROFILE_STATE", `Viewport profile ${index} responsive affine coefficients are invalid.`);
    }
  }
  require(referenced.size === packet.transforms.length, "INVALID_VIEWPORT_PROFILE_STATE", "Viewport transform dictionary contains an unreferenced row.");
}

function validateOrbit(state, binding, presentation, inputs, tree, limits) {
  require(presentation, "MISSING_POLYCSS_CHANNEL", "Prepared orbit requires static presentation.");
  require(!Object.hasOwn(binding, "parameters"), "INVALID_ORBIT_BINDING", "Prepared orbit has no parameters.");
  const targets = exactObject(binding.targets, ["model", "leaves"], "INVALID_ORBIT_BINDING", "Prepared orbit targets");
  stableId(targets.model, "Prepared orbit model");
  uniqueTargets(targets.leaves, "Prepared orbit leaf");
  require(targets.leaves.length > 0 && targets.leaves.length < 65_535 && !targets.leaves.includes(targets.model), "TARGET_CARDINALITY_MISMATCH", "Prepared orbit targets are invalid.");
  exactObject(state.data, ["packet"], "INVALID_ORBIT_STATE", "Prepared orbit state");
  const packet = exactObject(state.data.packet, ["version", "initial", "ranges", "model", "surface"], "INVALID_ORBIT_STATE", "Prepared orbit packet");
  require(packet.version === 0, "INVALID_ORBIT_STATE", "Prepared orbit version must be zero.");
  exactObject(packet.initial, ["pitch", "yaw", "zoom"], "INVALID_ORBIT_STATE", "Prepared orbit initial inputs");
  exactObject(packet.ranges, ["pitch", "yaw", "zoom"], "INVALID_ORBIT_STATE", "Prepared orbit ranges");
  for (const name of ["pitch", "yaw", "zoom"]) {
    const range = packet.ranges[name];
    require(Array.isArray(range) && range.length === 2 && range.every((value) => typeof value === "number" && Number.isFinite(value)) && range[0] < range[1] && typeof packet.initial[name] === "number" && Number.isFinite(packet.initial[name]) && packet.initial[name] >= range[0] && packet.initial[name] <= range[1] && inputs.get(`orbit.${name}`)?.type === "float" && inputs.get(`orbit.${name}`).default === packet.initial[name], "INVALID_ORBIT_STATE", `Prepared orbit ${name} contract is invalid.`);
  }
  require(packet.ranges.pitch[0] >= -90 && packet.ranges.pitch[1] <= 90 && packet.ranges.yaw[0] >= -360 && packet.ranges.yaw[1] <= 360 && packet.ranges.zoom[0] > 0 && packet.ranges.zoom[1] <= 16, "INVALID_ORBIT_STATE", "Prepared orbit ranges exceed the interpreter domain.");
  exactObject(packet.model, ["translation", "scale"], "INVALID_ORBIT_STATE", "Prepared orbit model");
  require(Array.isArray(packet.model.translation) && packet.model.translation.length === 3 && packet.model.translation.every((value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000) && Array.isArray(packet.model.scale) && packet.model.scale.length === 3 && packet.model.scale.every((value) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 16), "INVALID_ORBIT_STATE", "Prepared orbit model values are invalid.");
  const number = (value) => Object.is(value, -0) ? "0" : String(value);
  const expectedTransform = `translate3d(${packet.model.translation.map(number).join("px, ")}px) rotateX(${number(packet.initial.pitch)}deg) rotateY(${number(packet.initial.yaw)}deg) scale3d(${packet.model.scale.map((value) => number(value * packet.initial.zoom)).join(", ")})`;
  require(tree.byId.get(targets.model)?.styles?.transform === expectedTransform, "ORBIT_TREE_MISMATCH", "Prepared orbit model transform differs from TREE.");
  const surface = exactObject(packet.surface, ["stateCount", "positionDictionary", "initialPositionIndicesBase64", "transitions"], "INVALID_ORBIT_STATE", "Prepared orbit surface");
  require(Number.isSafeInteger(surface.stateCount) && surface.stateCount >= 2 && surface.stateCount <= 360 && Math.round((((packet.initial.yaw % 360) + 360) % 360) * surface.stateCount / 360) % surface.stateCount === 0, "ORBIT_STATE_LIMIT", "Prepared orbit state count or initial yaw is invalid.");
  require(Array.isArray(surface.positionDictionary) && surface.positionDictionary.length > 0 && surface.positionDictionary.length < 65_535 && surface.positionDictionary.length <= limits.maxPreparedStates, "ORBIT_STATE_LIMIT", "Prepared orbit position dictionary is invalid or excessive.");
  let previous;
  for (const position of surface.positionDictionary) {
    require(Array.isArray(position) && position.length === 2 && position.every((value) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= -0x7fffffff && value <= 0x7fffffff), "INVALID_ORBIT_STATE", "Prepared orbit position is invalid.");
    if (previous) require(position[0] > previous[0] || position[0] === previous[0] && position[1] > previous[1], "INVALID_ORBIT_STATE", "Prepared orbit positions are not sorted.");
    previous = position;
  }
  const initial = base64Integers(surface.initialPositionIndicesBase64, 2, targets.leaves.length, "INVALID_ORBIT_STATE", "Prepared orbit initial positions");
  require(initial.length === targets.leaves.length && initial.every((value) => value < surface.positionDictionary.length), "STATE_COLUMN_MISMATCH", "Prepared orbit initial positions are invalid.");
  const positionText = (position) => position.map((value) => value === 0 ? "0" : `${value}px`).join(" ");
  for (let index = 0; index < targets.leaves.length; index += 1) require(tree.byId.get(targets.leaves[index])?.styles?.backgroundPosition === positionText(surface.positionDictionary[initial[index]]), "ORBIT_TREE_MISMATCH", `Prepared orbit leaf ${index} differs from TREE.`);
  const transitions = exactObject(surface.transitions, ["offsetsBase64", "leafIndicesBase64", "forwardPositionIndicesBase64", "backwardPositionIndicesBase64"], "INVALID_ORBIT_STATE", "Prepared orbit transitions");
  const offsets = base64Integers(transitions.offsetsBase64, 4, surface.stateCount + 1, "INVALID_ORBIT_STATE", "Prepared orbit offsets");
  require(offsets.length === surface.stateCount + 1 && offsets[0] === 0 && offsets.every((value, index) => index === 0 || value >= offsets[index - 1]) && offsets.at(-1) <= limits.maxPreparedChanges, "INVALID_ORBIT_STATE", "Prepared orbit offsets are invalid.");
  const count = offsets.at(-1);
  const leaves = base64Integers(transitions.leafIndicesBase64, 2, count, "INVALID_ORBIT_STATE", "Prepared orbit leaves");
  const forward = base64Integers(transitions.forwardPositionIndicesBase64, 2, count, "INVALID_ORBIT_STATE", "Prepared orbit forward positions");
  const backward = base64Integers(transitions.backwardPositionIndicesBase64, 2, count, "INVALID_ORBIT_STATE", "Prepared orbit backward positions");
  require(leaves.length === count && forward.length === count && backward.length === count, "STATE_COLUMN_MISMATCH", "Prepared orbit transition columns differ.");
  require(surface.stateCount * targets.leaves.length <= limits.maxVisibilityCells, "ORBIT_STATE_LIMIT", "Prepared orbit canonical rows exceed their allocation limit.");
  const referenced = new Set(initial);
  const apply = (row, edge, values) => {
    let previousLeaf = -1;
    for (let cursor = offsets[edge]; cursor < offsets[edge + 1]; cursor += 1) {
      require(leaves[cursor] > previousLeaf && leaves[cursor] < targets.leaves.length && forward[cursor] < surface.positionDictionary.length && backward[cursor] < surface.positionDictionary.length && row[leaves[cursor]] !== values[cursor], "INVALID_ORBIT_STATE", `Prepared orbit edge ${edge} is invalid.`);
      row[leaves[cursor]] = values[cursor];
      previousLeaf = leaves[cursor];
      referenced.add(forward[cursor]); referenced.add(backward[cursor]);
    }
  };
  let row = initial.slice();
  for (let stateIndex = 1; stateIndex < surface.stateCount; stateIndex += 1) {
    const previous = row.slice();
    apply(row, stateIndex, forward);
    const reverse = row.slice();
    apply(reverse, stateIndex, backward);
    require(exactEqualArray(reverse, previous), "ORBIT_TRANSITION_MISMATCH", `Prepared orbit backward edge ${stateIndex} is invalid.`);
  }
  const finalRow = row.slice();
  apply(row, 0, forward);
  require(exactEqualArray(row, initial), "ORBIT_TRANSITION_MISMATCH", "Prepared orbit forward cycle does not close.");
  const reverse = row.slice();
  apply(reverse, 0, backward);
  require(exactEqualArray(reverse, finalRow), "ORBIT_TRANSITION_MISMATCH", "Prepared orbit backward edge 0 is invalid.");
  require(referenced.size === surface.positionDictionary.length, "INVALID_ORBIT_STATE", "Prepared orbit dictionary contains an unreferenced row.");
}

function validateCodecClosure(document, context, tree, records, limits) {
  const byInterpreter = new Map([...context.channels.values()].map((binding) => [binding.interpreter, { binding, state: context.states.get(binding.state) }]));
  require(!(byInterpreter.has("polycss-playback@0") && byInterpreter.has("polycss-paged-playback@0")), "TARGET_OWNERSHIP_CONFLICT", "Inline and paged playback are mutually exclusive.");
  let playback = null;
  if (byInterpreter.has("polycss-playback@0")) {
    const value = byInterpreter.get("polycss-playback@0");
    playback = { ...value, kind: "inline", packet: validatePlayback(value.state, value.binding, context.inputs, limits) };
  } else if (byInterpreter.has("polycss-paged-playback@0")) {
    const value = byInterpreter.get("polycss-paged-playback@0");
    playback = { ...value, kind: "paged", packet: validatePagedPlayback(value.state, value.binding, context.inputs, limits) };
  }
  let presentation = null;
  if (byInterpreter.has("static-presentation@0")) {
    const value = byInterpreter.get("static-presentation@0");
    presentation = { ...value, packet: validatePresentation(value.state, value.binding, records, context.inputs) };
  }
  if (playback && (playback.packet.profileTimelines !== undefined || playback.packet.banks?.some((bank) => bank.profileTimelines !== undefined))) {
    require(presentation, "MISSING_POLYCSS_CHANNEL", "Playback profile timelines require static presentation.");
    validatePlaybackProfileTimelineClosure(playback.packet, presentation.packet);
  }
  if (byInterpreter.has("polycss-compositor-timing@0")) {
    require(playback, "MISSING_POLYCSS_CHANNEL", "Compositor timing requires executable playback.");
    require(playback.kind === "inline", "TARGET_OWNERSHIP_CONFLICT", "Compositor timing version 0 cannot reference page-local playback transforms.");
    const value = byInterpreter.get("polycss-compositor-timing@0");
    validateCompositorTiming(value.state, value.binding, playback, context.inputs, limits);
  }
  let surface = null;
  if (byInterpreter.has("polycss-surface@0")) {
    require(playback, "MISSING_POLYCSS_CHANNEL", "Prepared surface requires executable playback.");
    const value = byInterpreter.get("polycss-surface@0");
    surface = { ...value, packet: validateSurface(value.state, value.binding, playback, context.inputs, limits) };
  }
  if (playback?.packet.leafCount > 0) require(surface, "MISSING_POLYCSS_CHANNEL", "Playback with leaf targets requires prepared surface state and binding.");
  if (byInterpreter.has("polycss-variants@0")) {
    require(playback, "MISSING_POLYCSS_CHANNEL", "Prepared variants require executable playback.");
    const value = byInterpreter.get("polycss-variants@0");
    validateVariants(value.state, value.binding, playback, context.inputs, tree, limits, surface?.binding);
  }
  let pagedVariants = null;
  if (byInterpreter.has("polycss-paged-variants@0")) {
    require(playback, "MISSING_POLYCSS_CHANNEL", "Paged variants require executable playback.");
    require(!byInterpreter.has("polycss-variants@0"), "TARGET_OWNERSHIP_CONFLICT", "Inline and paged variants cannot race class ownership.");
    const value = byInterpreter.get("polycss-paged-variants@0");
    pagedVariants = { ...value, packet: validatePagedVariants(value.state, value.binding, playback, context.inputs, tree, limits, surface?.binding) };
  }
  const pagedPackets = [playback?.kind === "paged" ? playback.packet : null, pagedVariants?.packet].filter(Boolean);
  if (pagedPackets.length > 0) {
    const sharedCeiling = pagedPackets[0].maxResidentPages;
    const bankEntryFrames = playback.packet.banks?.map((bank) => bank.entryFrame) ?? [];
    require(pagedPackets.every((packet) => packet.maxResidentPages === sharedCeiling), "STATE_PAGE_RESIDENCY_LIMIT", "Every paged state channel must declare the same document-wide resident-page ceiling.");
    require(sharedCeiling >= requiredDocumentStateResidency(pagedPackets, [playback.packet.initial.sourceFrame], bankEntryFrames), "STATE_PAGE_RESIDENCY_LIMIT", "Paged state channels cannot satisfy the combined lookahead, fixed-pin, and prepared-bank transfer window within the document-wide resident-page ceiling.");
  }
  let effects = null;
  if (byInterpreter.has("polycss-effects@0")) {
    require(playback, "MISSING_POLYCSS_CHANNEL", "Prepared effects require executable playback.");
    require(playback.binding.parameters.catchUpPolicy !== "elapsed", "INVALID_EFFECTS_BINDING", "Prepared effects do not support collapsed elapsed catch-up.");
    const value = byInterpreter.get("polycss-effects@0");
    effects = { ...value, packet: validateEffects(value.state, value.binding, playback, context.inputs, limits) };
  }
  if (byInterpreter.has("polycss-pointer-grab@0")) {
    require(playback && presentation && effects, "MISSING_POLYCSS_CHANNEL", "Prepared pointer interaction requires playback, presentation, and effects.");
    const value = byInterpreter.get("polycss-pointer-grab@0");
    validateInteraction(value.state, value.binding, playback, presentation, context.inputs, limits);
    require(sameTickCadence(value.binding.parameters, playback.binding.parameters) && playback.binding.parameters.catchUpPolicy !== "elapsed", "INVALID_INTERACTION_BINDING", "Interaction and playback timing is incompatible.");
    if (pagedPackets.length > 0) {
      const requiredResidentPages = requiredDocumentStateResidency(pagedPackets, [playback.packet.initial.sourceFrame, value.binding.parameters.initialFrame], playback.packet.banks?.map((bank) => bank.entryFrame) ?? []);
      require(pagedPackets[0].maxResidentPages >= requiredResidentPages, "STATE_PAGE_RESIDENCY_LIMIT", "Paged state with interaction must reserve the playback and interaction entry pages in addition to every combined cyclic lookahead window.");
    }
  }
  if (byInterpreter.has("polycss-orbit-input@0")) {
    require(!playback, "TARGET_OWNERSHIP_CONFLICT", "Prepared orbit version 0 cannot race playback.");
    const value = byInterpreter.get("polycss-orbit-input@0");
    validateOrbit(value.state, value.binding, presentation, context.inputs, tree, limits);
  }
  if (byInterpreter.has("polycss-viewport-profiles@0")) {
    require(playback && presentation, "MISSING_POLYCSS_CHANNEL", "Viewport profiles require playback and presentation.");
    const value = byInterpreter.get("polycss-viewport-profiles@0");
    validateViewportProfiles(value.state, value.binding, playback, presentation, context.inputs, limits);
  }
  validateTargetOwnership(context.channels, limits);
  if (surface) validateInitialSurfaceClosure(surface.packet, playback, tree);

  if (presentation) {
    const { packet, binding } = presentation;
    const mountResource = document.tree.mount.resourceStyles?.backgroundImage;
    if (packet.background) {
      require(mountResource?.resource === packet.background.resource && mountResource.syntax === "overlay-url" && mountResource.overlayOpacity === packet.background.opacity && document.tree.mount.styles?.backgroundPosition === packet.background.position && document.tree.mount.styles?.backgroundRepeat === packet.background.repeat && document.tree.mount.styles?.backgroundSize === packet.background.size, "PRESENTATION_TREE_MISMATCH", "Presentation background does not match TREE mount.");
    } else {
      require(mountResource === undefined && ["backgroundPosition", "backgroundRepeat", "backgroundSize"].every((name) => document.tree.mount.styles?.[name] === undefined), "PRESENTATION_TREE_MISMATCH", "Presentation without a background cannot declare TREE mount background bindings.");
    }
    const camera = tree.byId.get(binding.targets.camera);
    require(camera?.styles?.perspective === `${packet.camera.perspective}px` && camera.styles.perspectiveOrigin === `${packet.camera.sourceWidth / 2}px ${packet.camera.sourceHeight / 2}px` && camera.styles.position === "relative" && camera.styles.width === `${packet.camera.sourceWidth}px` && camera.styles.height === `${packet.camera.sourceHeight}px` && camera.styles.transformOrigin === undefined && camera.styles.transformStyle === undefined, "PRESENTATION_TREE_MISMATCH", "Presentation camera does not match TREE.");
    if (playback) {
      require(playback.binding.parameters.baseSceneTransform === packet.camera.baseSceneTransform, "PRESENTATION_TREE_MISMATCH", "Presentation scene transform differs from playback.");
      if (playback.kind === "inline") require(tree.byId.get(playback.binding.targets.model)?.styles?.transform === packet.camera.baseSceneTransform, "PRESENTATION_TREE_MISMATCH", "Presentation scene transform differs from playback/TREE.");
    }
    const interaction = byInterpreter.get("polycss-pointer-grab@0");
    if (interaction) require(Object.hasOwn(binding.targets, "cursorLayer") && Object.hasOwn(binding.targets, "cursorStates") && interaction.binding.targets.cursorLayer === binding.targets.cursorLayer && interaction.binding.targets.cursorStates.open === binding.targets.cursorStates.open && interaction.binding.targets.cursorStates.closed === binding.targets.cursorStates.closed, "PRESENTATION_TREE_MISMATCH", "Presentation and interaction cursor targets differ.");
  }

  if (document.meta.counts) {
    if (Object.hasOwn(document.meta.counts, "nodes")) require(document.meta.counts.nodes === document.tree.nodes.length, "META_COUNT_MISMATCH", "META node count is inaccurate.");
    if (playback) for (const [name, value] of [["shapes", playback.binding.targets.shapes.length], ["leaves", playback.binding.targets.leaves.length], ["sourceFrames", playback.binding.parameters.frameCount]]) if (Object.hasOwn(document.meta.counts, name)) require(document.meta.counts[name] === value, "META_COUNT_MISMATCH", `META ${name} count is inaccurate.`);
  }

  const expectedCapabilities = [...BASE_CAPABILITIES];
  let includedPagedState = false;
  for (const [interpreter, capability] of CAPABILITY_ORDER) {
    if (!context.interpreters.has(interpreter)) continue;
    if ((interpreter === "polycss-paged-playback@0" || interpreter === "polycss-paged-variants@0") && !includedPagedState) {
      expectedCapabilities.push("prepared-paged-state");
      includedPagedState = true;
    }
    expectedCapabilities.push(capability);
  }
  exactArray(document.meta.capabilities, expectedCapabilities, "CAPABILITY_CLOSURE_MISMATCH", "META capabilities");
  const expectedConformance = ["retained-tree", ...CONFORMANCE_ORDER.filter(([interpreter]) => context.interpreters.has(interpreter)).map(([, role]) => role)];
  exactArray(document.meta.conformance.executable, expectedConformance, "CONFORMANCE_CLOSURE_MISMATCH", "META conformance");
  if (document.meta.initialExperience === "interaction") require(context.interpreters.has("polycss-pointer-grab@0") && document.meta.capabilities.includes("prepared-pointer-grab-interaction"), "MISSING_INITIAL_EXPERIENCE", "Interaction initial experience is not executable.");

  const used = new Set();
  const useResourceStyles = (styles) => { for (const binding of Object.values(styles ?? {})) used.add(binding.resource); };
  useResourceStyles(document.tree.mount.resourceStyles);
  for (const node of document.tree.nodes) {
    for (const resource of Object.values(node.resourceAttributes ?? {})) used.add(resource);
    useResourceStyles(node.resourceStyles);
  }
  for (const binding of document.cssBinding.stylesheets) {
    used.add(binding.resource);
    for (const token of binding.assetTokens) used.add(token.resource);
  }
  if (presentation?.packet.background) used.add(presentation.packet.background.resource);
  const paged = byInterpreter.get("polycss-paged-variants@0");
  if (paged) for (const page of paged.state.data.packet.pages) {
    require(records.get(page.resource)?.kind === "state-page" && records.get(page.resource)?.codec === "polycss-paged-variants-page@0", "RESOURCE_ROLE_MISMATCH", `Paged variant resource ${page.resource} is not a matching state page.`);
    used.add(page.resource);
  }
  const pagedPlayback = byInterpreter.get("polycss-paged-playback@0");
  if (pagedPlayback) for (const page of pagedPlayback.state.data.packet.pages) {
    require(records.get(page.resource)?.kind === "state-page" && records.get(page.resource)?.codec === "polycss-paged-playback-page@0", "RESOURCE_ROLE_MISMATCH", `Paged playback resource ${page.resource} is not a matching state page.`);
    used.add(page.resource);
  }
  if (pagedPackets.length > 0) {
    const materializedBytes = new Map();
    for (const packet of pagedPackets) for (const page of packet.pages) materializedBytes.set(page.resource, page.materializedByteLength);
    const interaction = byInterpreter.get("polycss-pointer-grab@0");
    const pins = [playback.packet.initial.sourceFrame, interaction?.binding.parameters.initialFrame].filter((frame) => frame !== undefined);
    const playbackPacket = pagedPlayback?.state.data.packet ?? null;
    const variantTargetCount = paged?.binding.targets.nodes.length ?? 0;
    const retainedLiveCeiling = (playbackPacket
      ? Math.max(...playbackPacket.pages.map((page) => page.materializedByteLength + 16 + (playbackPacket.shapeCount + playbackPacket.leafCount) * 8 + playbackPacket.shapeCount))
      : 0) + variantTargetCount * 4;
    require(Number.isSafeInteger(retainedLiveCeiling), "STATE_PAGE_RESIDENCY_LIMIT", "Paged state retained live-row accounting overflowed.");
    let peakBytes = 0;
    for (let frame = 1; frame <= playback.binding.parameters.frameCount; frame += 1) {
      const desired = new Set();
      for (const packet of pagedPackets) for (const resource of desiredPageResources(packet, frame, pins)) desired.add(resource);
      let residentBytes = 0;
      for (const resource of desired) {
        const materialized = materializedBytes.get(resource);
        residentBytes += materialized;
        require(Number.isSafeInteger(residentBytes), "STATE_PAGE_RESIDENCY_LIMIT", "Paged state byte accounting overflowed.");
      }
      const playbackCurrent = playbackPacket?.pages.find((page) => frame >= page.startFrame && frame <= page.endFrame);
      const publicationWorkspace = (playbackCurrent
        ? playbackCurrent.materializedByteLength + 16
          + (playbackPacket.shapeCount + playbackPacket.leafCount) * 8 + playbackPacket.shapeCount
          + (playbackPacket.shapeCount + playbackPacket.leafCount) * 12 + playbackPacket.shapeCount
        : 0) + variantTargetCount * 4;
      require(Number.isSafeInteger(publicationWorkspace), "STATE_PAGE_RESIDENCY_LIMIT", "Paged state publication workspace accounting overflowed.");
      peakBytes = Math.max(peakBytes, residentBytes + retainedLiveCeiling + publicationWorkspace);
      for (const resource of desired) {
        const record = records.get(resource);
        const materialized = materializedBytes.get(resource);
        require(record?.kind === "state-page" && Number.isSafeInteger(record.decodedByteLength), "RESOURCE_ROLE_MISMATCH", `Paged state resource ${resource} is not a bounded state page.`);
        const validationPeak = residentBytes - materialized + record.decodedByteLength * 10 + materialized * 2 + retainedLiveCeiling;
        require(Number.isSafeInteger(validationPeak), "STATE_PAGE_RESIDENCY_LIMIT", "Paged state validation byte accounting overflowed.");
        peakBytes = Math.max(peakBytes, validationPeak);
      }
    }
    require(peakBytes <= limits.maxDecodedInputBytes, "STATE_PAGE_RESIDENCY_LIMIT", "Paged state decoded, materialized, and live-row window exceeds the document-wide decoded byte ceiling.");
  }
  require(records.size === used.size && [...records.keys()].every((id) => used.has(id)), "UNUSED_RESOURCE", "RCRD contains an unreachable resource.");
}

export function validateNVersionDocument(document, limits) {
  exactObject(document, ["meta", "tree", "cssBinding", "state", "bindings", "resources"], "INVALID_DOCUMENT", "Decoded document", ["meta", "tree", "cssBinding", "state", "bindings", "resources"]);
  validateMeta(document.meta);
  const records = validateResourceCatalog(document.resources, limits);
  const tree = validateTree(document.tree, records, limits);
  validateCssBinding(document.cssBinding, records, document.tree.mount, limits);
  const context = validateStateAndBindings(document.state, document.bindings, tree.ids, limits);
  validateCodecClosure(document, context, tree, records, limits);
  return Object.freeze({ records, tree, context });
}
