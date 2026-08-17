import { NVersionError, requireContract as require } from "./errors.js";
import { parseJsonBytes } from "./json.js";

const RESOURCE_ID = /^[a-z][a-z0-9._-]{0,63}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u;
const CSS_PROPERTIES = new Set(`
  -webkit-backface-visibility backface-visibility background background-clip
  background-color background-image background-position-x background-position-y
  background-repeat background-size border border-bottom-left-radius
  border-bottom-right-radius border-color border-shape border-top-left-radius
  border-top-right-radius box-sizing color contain corner-bottom-left-shape
  corner-bottom-right-shape corner-top-left-shape corner-top-right-shape cursor display font font-style font-weight height
  image-rendering inset isolation left line-height margin max-width object-fit
  object-position opacity overflow padding pointer-events position text-decoration
  top touch-action transform transform-origin transform-style user-select
  visibility width will-change z-index
`.trim().split(/\s+/u));
const CSS_FUNCTIONS = new Set(`
  abs acos asin atan atan2 blur brightness calc circle clamp color color-mix
  conic-gradient contrast cos cubic-bezier drop-shadow ellipse
  exp fit-content grayscale hsl hsla hwb hypot hue-rotate inset invert is lab
  lch light-dark linear-gradient log matrix matrix3d max min minmax mod not
  nth-child nth-last-child nth-last-of-type nth-of-type oklab oklch opacity path
  perspective polygon pow radial-gradient rem repeat repeating-conic-gradient
  repeating-linear-gradient repeating-radial-gradient rgb rgba rotate rotate3d
  rotatex rotatey rotatez round saturate scale scale3d scalex scaley scalez
  sepia sign sin skew skewx skewy sqrt steps tan translate translate3d
  translatex translatey translatez url where
`.trim().split(/\s+/u));

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function exactKeys(value, allowed, code, label, required = allowed) {
  require(value && typeof value === "object" && !Array.isArray(value), code, `${label} must be an object.`);
  for (const key of Object.keys(value)) require(allowed.includes(key), code, `${label} contains unknown field ${key}.`);
  for (const key of required) require(Object.hasOwn(value, key), code, `${label} is missing ${key}.`);
  return value;
}

function uint24Le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function uint32(bytes, offset, littleEndian) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, littleEndian);
}

function ascii(bytes, offset, length) {
  let value = "";
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index]);
  return value;
}

export function assertResourceId(value, label = "resource id") {
  require(typeof value === "string" && RESOURCE_ID.test(value), "INVALID_RESOURCE_ID", `${label} is invalid.`);
  return value;
}

export function assertSafePath(value, label = "resource path") {
  require(typeof value === "string" && value.length > 0 && value.length <= 240, "UNSAFE_RESOURCE_PATH", `${label} is not a short relative path.`);
  require(!value.startsWith("/") && !value.startsWith("\\") && !value.includes("\\") && !/[:%?#]/u.test(value), "UNSAFE_RESOURCE_PATH", `${label} is URL-like or nonportable.`);
  require(value.split("/").every((part) => {
    const stem = part.split(".", 1)[0].toLowerCase();
    return part !== "." && part !== ".." && SEGMENT.test(part) && !part.endsWith(".") && !WINDOWS_DEVICE.test(stem);
  }), "UNSAFE_RESOURCE_PATH", `${label} has an unsafe or nonportable segment.`);
  return value;
}

export function validateResourceCatalog(catalog, limits) {
  exactKeys(catalog, ["version", "resources"], "INVALID_RESOURCES", "RCRD");
  require(catalog.version === 0, "UNSUPPORTED_RESOURCE_SCHEMA", "RCRD version must be 0.");
  require(Array.isArray(catalog.resources) && catalog.resources.length <= limits.maxResources + limits.maxStatePages, "RESOURCE_COUNT_LIMIT", "RCRD resource count exceeds the combined eager and state-page ceilings.");
  const records = new Map();
  const paths = new Set();
  let previous = "";
  let eagerResources = 0;
  let statePages = 0;
  let eagerBytes = 0;
  let statePageBytes = 0;
  let pixels = 0;
  let decodedStateBytes = 0;
  for (const [index, record] of catalog.resources.entries()) {
    exactKeys(record, ["id", "kind", "mediaType", "byteLength", "dimensions", "digest", "path", "encoding", "decodedByteLength", "decodedDigest", "codec"], "INVALID_RESOURCE", `Resource ${index}`, ["id", "kind", "mediaType", "byteLength", "digest", "path"]);
    const id = assertResourceId(record.id, `Resource ${index} id`);
    require(id > previous && !records.has(id), "RESOURCE_ORDER", "Resources must have unique sorted ids.");
    previous = id;
    require(record.kind === "image" || record.kind === "stylesheet" || record.kind === "state-page", "INVALID_RESOURCE_KIND", `Resource ${id} has an invalid kind.`);
    require((record.kind === "stylesheet" && record.mediaType === "text/css;charset=utf-8") || (record.kind === "image" && (record.mediaType === "image/png" || record.mediaType === "image/webp")) || (record.kind === "state-page" && record.mediaType === "application/vnd.layoutit.domformat-state-page+json"), "RESOURCE_KIND_MEDIA_MISMATCH", `Resource ${id} has an invalid media pairing.`);
    require(Number.isSafeInteger(record.byteLength) && record.byteLength >= 0 && record.byteLength <= limits.maxResourceBytes, "INVALID_RESOURCE_SIZE", `Resource ${id} length is invalid.`);
    if (record.kind === "state-page") {
      statePages += 1;
      statePageBytes += record.byteLength;
      require(statePages <= limits.maxStatePages, "RESOURCE_COUNT_LIMIT", "State-page resource count exceeds its limit.");
      require(statePageBytes <= limits.maxAggregateStatePageBytes, "AGGREGATE_RESOURCE_LIMIT", "Aggregate encoded state-page bytes exceed their limit.");
    } else {
      eagerResources += 1;
      eagerBytes += record.byteLength;
      require(eagerResources <= limits.maxResources, "RESOURCE_COUNT_LIMIT", "Eager resource count exceeds its limit.");
      require(eagerBytes <= limits.maxAggregateResourceBytes, "AGGREGATE_RESOURCE_LIMIT", "Aggregate eager resource bytes exceed their limit.");
    }
    if (record.kind === "image") {
      exactKeys(record.dimensions, ["width", "height"], "INVALID_RESOURCE_DIMENSIONS", `Resource ${id} dimensions`);
      const { width, height } = record.dimensions;
      require(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= limits.maxImageWidth && height <= limits.maxImageHeight && width * height <= limits.maxImagePixels, "IMAGE_DIMENSION_LIMIT", `Resource ${id} dimensions exceed limits.`);
      pixels += width * height;
      require(pixels <= limits.maxAggregateImagePixels, "AGGREGATE_IMAGE_PIXEL_LIMIT", "Aggregate decoded pixels exceed their limit.");
    } else require(record.dimensions === undefined, "UNEXPECTED_RESOURCE_DIMENSIONS", `Non-image resource ${id} declares dimensions.`);
    exactKeys(record.digest, ["algorithm", "value"], "INVALID_RESOURCE_DIGEST", `Resource ${id} digest`);
    require(record.digest.algorithm === "sha256" && typeof record.digest.value === "string" && DIGEST.test(record.digest.value), "INVALID_RESOURCE_DIGEST", `Resource ${id} digest is invalid.`);
    if (record.kind === "state-page") {
      require(record.encoding === "identity" || record.encoding === "gzip", "INVALID_STATE_PAGE_RESOURCE", `State page ${id} encoding is unsupported.`);
      require(Number.isSafeInteger(record.decodedByteLength) && record.decodedByteLength >= 0 && record.decodedByteLength <= limits.maxResourceBytes, "INVALID_STATE_PAGE_RESOURCE", `State page ${id} decoded length is invalid.`);
      decodedStateBytes += record.decodedByteLength;
      require(decodedStateBytes <= limits.maxDecodedInputBytes, "AGGREGATE_DECODED_LIMIT", "Decoded state-page bytes exceed their aggregate limit.");
      exactKeys(record.decodedDigest, ["algorithm", "value"], "INVALID_STATE_PAGE_RESOURCE", `State page ${id} decoded digest`);
      require(record.decodedDigest.algorithm === "sha256" && DIGEST.test(record.decodedDigest.value), "INVALID_STATE_PAGE_RESOURCE", `State page ${id} decoded digest is invalid.`);
      require(record.codec === "polycss-paged-variants-page@0" || record.codec === "polycss-paged-playback-page@0", "INVALID_STATE_PAGE_RESOURCE", `State page ${id} codec is unsupported.`);
      if (record.encoding === "identity") require(record.byteLength === record.decodedByteLength && record.digest.value === record.decodedDigest.value, "INVALID_STATE_PAGE_RESOURCE", `Identity state page ${id} encoded and decoded identities differ.`);
    } else require(record.encoding === undefined && record.decodedByteLength === undefined && record.decodedDigest === undefined && record.codec === undefined, "INVALID_RESOURCE", `Non-state resource ${id} declares state-page fields.`);
    const path = assertSafePath(record.path, `Resource ${id} path`);
    const portablePath = path.toLowerCase();
    require(!paths.has(portablePath), "DUPLICATE_RESOURCE_PATH", `Resource path ${path} has a case-insensitive alias.`);
    for (const existing of paths) require(!portablePath.startsWith(`${existing}/`) && !existing.startsWith(`${portablePath}/`), "RESOURCE_PATH_COLLISION", `Resource path ${path} collides with a file/directory path.`);
    paths.add(portablePath);
    records.set(id, record);
  }
  return records;
}

async function sha256(bytes) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  let value = "";
  for (const byte of digest) value += byte.toString(16).padStart(2, "0");
  return value;
}

function pngDimensions(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  require(bytes.length >= 45 && signature.every((byte, index) => bytes[index] === byte), "IMAGE_MEDIA_MISMATCH", "PNG signature is invalid.");
  let offset = 8;
  let dimensions = null;
  let sawPalette = false;
  let sawImageData = false;
  let imageDataEnded = false;
  let sawEnd = false;
  let colorType = -1;
  while (offset < bytes.length) {
    require(offset + 12 <= bytes.length, "IMAGE_MEDIA_MISMATCH", "PNG chunk header is truncated.");
    const length = uint32(bytes, offset, false);
    const type = ascii(bytes, offset + 4, 4);
    const payload = offset + 8;
    const end = payload + length;
    require(end + 4 <= bytes.length && crc32(bytes.subarray(offset + 4, end)) === uint32(bytes, end, false), "IMAGE_MEDIA_MISMATCH", `PNG ${type} chunk is invalid.`);
    if (!dimensions) {
      require(type === "IHDR" && length === 13, "IMAGE_MEDIA_MISMATCH", "PNG IHDR is invalid.");
      dimensions = { width: uint32(bytes, payload, false), height: uint32(bytes, payload + 4, false) };
      const bitDepth = bytes[payload + 8];
      colorType = bytes[payload + 9];
      const depths = new Map([
        [0, new Set([1, 2, 4, 8, 16])],
        [2, new Set([8, 16])],
        [3, new Set([1, 2, 4, 8])],
        [4, new Set([8, 16])],
        [6, new Set([8, 16])],
      ]);
      require(dimensions.width > 0 && dimensions.height > 0 && depths.get(colorType)?.has(bitDepth), "IMAGE_MEDIA_MISMATCH", "PNG dimensions, color type, or bit depth are invalid.");
      require(bytes[payload + 10] === 0 && bytes[payload + 11] === 0 && (bytes[payload + 12] === 0 || bytes[payload + 12] === 1), "IMAGE_MEDIA_MISMATCH", "PNG compression, filtering, or interlace method is invalid.");
    } else if (["acTL", "fcTL", "fdAT"].includes(type)) throw new NVersionError("IMAGE_ANIMATION_UNSUPPORTED", "Animated PNG is unsupported.");
    else if (type === "PLTE") {
      require(!sawPalette && !sawImageData && length > 0 && length % 3 === 0 && length <= 768, "IMAGE_MEDIA_MISMATCH", "PNG palette is invalid or out of order.");
      sawPalette = true;
    } else if (type === "IDAT") {
      require(!imageDataEnded && length > 0, "IMAGE_MEDIA_MISMATCH", "PNG image-data chunks must be nonempty and consecutive.");
      sawImageData = true;
    } else if (type === "IEND") {
      require(length === 0 && sawImageData && end + 4 === bytes.length, "IMAGE_MEDIA_MISMATCH", "PNG IEND is invalid.");
      sawEnd = true;
    } else {
      if (sawImageData) imageDataEnded = true;
      require(type !== "IHDR" && !(type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90), "IMAGE_MEDIA_MISMATCH", `PNG critical chunk ${type} is unsupported.`);
    }
    offset = end + 4;
    if (sawEnd) break;
  }
  require(sawEnd && sawImageData && (colorType !== 3 || sawPalette), "IMAGE_MEDIA_MISMATCH", "PNG is incomplete.");
  return dimensions;
}

function webpDimensions(bytes) {
  require(bytes.length >= 26 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP" && uint32(bytes, 4, true) + 8 === bytes.length, "IMAGE_MEDIA_MISMATCH", "WebP RIFF envelope is invalid.");
  let offset = 12;
  let canvas = null;
  let primary = null;
  let primaryType = null;
  const auxiliary = new Set(["ALPH", "ICCP", "EXIF", "XMP "]);
  while (offset < bytes.length) {
    require(offset + 8 <= bytes.length, "IMAGE_MEDIA_MISMATCH", "WebP chunk is truncated.");
    const type = ascii(bytes, offset, 4);
    const length = uint32(bytes, offset + 4, true);
    const payload = offset + 8;
    const end = payload + length;
    require(Number.isSafeInteger(end) && end <= bytes.length && end + (length & 1) <= bytes.length, "IMAGE_MEDIA_MISMATCH", `WebP ${type} exceeds the RIFF envelope.`);
    if (length & 1) require(bytes[end] === 0, "IMAGE_MEDIA_MISMATCH", `WebP ${type} padding is nonzero.`);
    if (type === "VP8X") {
      require(offset === 12 && length === 10 && !canvas && !primary, "IMAGE_MEDIA_MISMATCH", "WebP VP8X is invalid.");
      require((bytes[payload] & 0x02) === 0, "IMAGE_ANIMATION_UNSUPPORTED", "Animated WebP is unsupported.");
      require((bytes[payload] & 0xc1) === 0 && bytes[payload + 1] === 0 && bytes[payload + 2] === 0 && bytes[payload + 3] === 0, "IMAGE_MEDIA_MISMATCH", "WebP VP8X reserved bits are invalid.");
      canvas = { width: uint24Le(bytes, payload + 4) + 1, height: uint24Le(bytes, payload + 7) + 1 };
    } else if (type === "VP8L") {
      require(!primary && length >= 6 && bytes[payload] === 0x2f, "IMAGE_MEDIA_MISMATCH", "WebP VP8L is invalid.");
      const bits = uint32(bytes, payload + 1, true);
      require((bits >>> 29) === 0, "IMAGE_MEDIA_MISMATCH", "WebP VP8L version is invalid.");
      primary = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      primaryType = type;
    } else if (type === "VP8 ") {
      require(!primary && length >= 11, "IMAGE_MEDIA_MISMATCH", "WebP VP8 frame is truncated or duplicated.");
      const frameTag = bytes[payload] | (bytes[payload + 1] << 8) | (bytes[payload + 2] << 16);
      const firstPartitionLength = frameTag >>> 5;
      require((frameTag & 1) === 0 && (frameTag & 0x10) !== 0 && firstPartitionLength > 0 && 10 + firstPartitionLength <= length, "IMAGE_MEDIA_MISMATCH", "WebP VP8 frame tag is invalid.");
      require(bytes[payload + 3] === 0x9d && bytes[payload + 4] === 1 && bytes[payload + 5] === 0x2a, "IMAGE_MEDIA_MISMATCH", "WebP VP8 key-frame header is invalid.");
      const view = new DataView(bytes.buffer, bytes.byteOffset + payload + 6, 4);
      primary = { width: view.getUint16(0, true) & 0x3fff, height: view.getUint16(2, true) & 0x3fff };
      require(primary.width > 0 && primary.height > 0, "IMAGE_MEDIA_MISMATCH", "WebP VP8 dimensions are invalid.");
      primaryType = type;
    } else require(canvas && auxiliary.has(type), "IMAGE_MEDIA_MISMATCH", `WebP chunk ${type} is unsupported.`);
    offset = end + (length & 1);
  }
  require(offset === bytes.length && primary && primary.width > 0 && primary.height > 0, "IMAGE_MEDIA_MISMATCH", "WebP primary image is missing.");
  if (canvas) require(canvas.width === primary.width && canvas.height === primary.height, "IMAGE_MEDIA_MISMATCH", `WebP canvas and ${primaryType} dimensions disagree.`);
  return canvas ?? primary;
}

function splitTopLevel(value, delimiter) {
  const output = [];
  let start = 0;
  let quote = "";
  let parens = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) { if (character === quote) quote = ""; continue; }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parens += 1;
    else if (character === ")") { parens -= 1; require(parens >= 0, "UNSAFE_CSS", "CSS has unmatched parentheses."); }
    else if (character === delimiter && parens === 0) { output.push(value.slice(start, index)); start = index + 1; }
  }
  require(!quote && parens === 0, "UNSAFE_CSS", "CSS has unterminated strings or functions.");
  output.push(value.slice(start));
  return output;
}

function declarationColon(value) {
  let quote = "";
  let parens = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) { if (character === quote) quote = ""; continue; }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parens += 1;
    else if (character === ")") parens -= 1;
    else if (character === ":" && parens === 0) return index;
  }
  return -1;
}

function mentionsPreparedToken(selector, tokens) {
  for (const token of tokens) {
    let start = selector.indexOf(token);
    while (start >= 0) {
      const before = selector[start - 1];
      const after = selector[start + token.length];
      if (!before?.match(/[A-Za-z0-9_-]/u) && !after?.match(/[A-Za-z0-9_-]/u)) return token;
      start = selector.indexOf(token, start + token.length);
    }
  }
  return null;
}

export function validateStylesheet(bytes, binding, resources, limits, forbiddenClassTokens = new Set()) {
  require(bytes.length <= limits.maxCssBytes, "CSS_SIZE_LIMIT", "Stylesheet exceeds its byte limit.");
  let css;
  try { css = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new NVersionError("MALFORMED_UTF8", `Stylesheet ${binding.id} is not strict UTF-8.`); }
  require(css.charCodeAt(0) !== 0xfeff, "MALFORMED_UTF8", `Stylesheet ${binding.id} begins with a byte-order mark.`);
  require(!css.includes("\\"), "UNSAFE_CSS_ESCAPE", "Stylesheet contains a CSS escape.");
  require(!css.includes("/*") && !css.includes("*/"), "UNSAFE_CSS_COMMENT", "Stylesheet contains a CSS comment.");
  require(!css.includes("@"), "UNSAFE_CSS_AT_RULE", "Stylesheet contains an at-rule.");
  require(!css.includes("!"), "UNSAFE_CSS_IMPORTANT", "Stylesheet contains a priority annotation.");
  require(!css.includes("<!--") && !css.includes("-->"), "UNSAFE_CSS", "Stylesheet contains CDO/CDC syntax.");
  const tokens = new Map(binding.assetTokens.map((entry) => [entry.token, entry.resource]));
  const used = new Set();
  let cursor = 0;
  let rules = 0;
  let selectors = 0;
  let declarations = 0;
  while (cursor < css.length) {
    while (/\s/u.test(css[cursor] ?? "")) cursor += 1;
    if (cursor === css.length) break;
    const open = css.indexOf("{", cursor);
    require(open >= 0, "UNSAFE_CSS", "Stylesheet rule is truncated.");
    const selectorText = css.slice(cursor, open);
    for (const raw of splitTopLevel(selectorText, ",")) {
      const selector = raw.trim();
      selectors += 1;
      require(selector.length > 0 && new TextEncoder().encode(selector).length <= limits.maxCssSelectorBytes, "CSS_SELECTOR_LIMIT", "CSS selector is empty or over limit.");
      require(selector.startsWith(binding.scope), "CSS_SCOPE_ESCAPE", "Selector does not begin with its declared scope.");
      const preparedToken = mentionsPreparedToken(selector, forbiddenClassTokens);
      require(preparedToken === null, "UNDECLARED_VARIANT_EFFECT", `Stylesheet selector mentions prepared variant token ${preparedToken}.`);
      const suffix = selector.slice(binding.scope.length).trimStart();
      require(!suffix.startsWith("+") && !suffix.startsWith("~") && !suffix.startsWith("||"), "CSS_SCOPE_ESCAPE", "Selector escapes through a sibling combinator.");
    }
    const close = css.indexOf("}", open + 1);
    const nestedOpen = css.indexOf("{", open + 1);
    require(close >= 0 && (nestedOpen === -1 || nestedOpen > close), "UNSAFE_CSS_NESTING", "Nested CSS is forbidden.");
    const block = css.slice(open + 1, close);
    for (const raw of splitTopLevel(block, ";")) {
      if (!raw.trim()) continue;
      declarations += 1;
      const colon = declarationColon(raw);
      require(colon > 0, "UNSAFE_CSS", "CSS declaration is malformed.");
      const property = raw.slice(0, colon).trim().toLowerCase();
      const value = raw.slice(colon + 1).trim();
      require(CSS_PROPERTIES.has(property) && value.length > 0, "UNSAFE_CSS_PROPERTY", `CSS property ${property} is unsupported.`);
      const functionPattern = /([A-Za-z][A-Za-z0-9-]*)\s*\(/gy;
      for (let index = 0; index < value.length;) {
        const quote = value[index] === '"' || value[index] === "'" ? value[index] : "";
        if (quote) {
          const end = value.indexOf(quote, index + 1);
          require(end >= 0, "UNSAFE_CSS", "CSS string is unterminated.");
          index = end + 1;
          continue;
        }
        functionPattern.lastIndex = index;
        const match = functionPattern.exec(value);
        if (!match) { index += 1; continue; }
        const name = match[1].toLowerCase();
        require(match[0].length === match[1].length + 1, "UNSAFE_CSS", "CSS function names must immediately precede '('.");
        require(CSS_FUNCTIONS.has(name), "UNSAFE_CSS_FUNCTION", `CSS function ${name} is unsupported.`);
        if (name === "url") {
          const end = value.indexOf(")", functionPattern.lastIndex);
          require(end >= 0, "UNSAFE_CSS_URL", "CSS url() is truncated.");
          let token = value.slice(functionPattern.lastIndex, end).trim();
          if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
          require(token.startsWith("dom-asset:"), "UNSAFE_CSS", "CSS url() is not a logical asset token.");
          require(tokens.has(token) && resources.get(tokens.get(token))?.kind === "image", "UNBOUND_CSS_URL", `CSS token ${token} is not declared.`);
          used.add(token);
          index = end + 1;
        } else index = functionPattern.lastIndex;
      }
    }
    rules += 1;
    require(rules <= limits.maxCssRules && selectors <= limits.maxCssSelectors && declarations <= limits.maxCssDeclarations, "CSS_STRUCTURE_LIMIT", "Stylesheet structure exceeds limits.");
    cursor = close + 1;
  }
  require([...tokens.keys()].every((token) => used.has(token)), "UNUSED_CSS_TOKEN", "A declared CSS token is unused.");
  return css;
}

function imageDimensions(bytes, mediaType) {
  return mediaType === "image/png" ? pngDimensions(bytes) : webpDimensions(bytes);
}

function packedIntegers(value, width, maximum, label) {
  require(typeof value === "string" && value.length <= Math.ceil(maximum * width / 3) * 4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value), "INVALID_STATE_PAGE", `${label} is not canonical base64.`);
  let binary;
  try { binary = globalThis.atob(value); } catch { require(false, "INVALID_STATE_PAGE", `${label} is not valid base64.`); }
  require(globalThis.btoa(binary) === value && binary.length % width === 0 && binary.length / width <= maximum, "INVALID_STATE_PAGE", `${label} is truncated or excessive.`);
  const output = width === 1 ? new Uint8Array(binary.length) : width === 2 ? new Uint16Array(binary.length / 2) : new Uint32Array(binary.length / 4);
  for (let index = 0; index < output.length; index += 1) {
    let result = 0;
    for (let byte = 0; byte < width; byte += 1) result += binary.charCodeAt(index * width + byte) * 2 ** (byte * 8);
    output[index] = result;
  }
  return output;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

async function decodeStatePage(record, encoded, signal) {
  require(!signal?.aborted, "OPERATION_ABORTED", `State page ${record.id} request was aborted.`);
  if (record.encoding === "identity") return encoded.slice();
  require(typeof globalThis.DecompressionStream === "function", "MISSING_BROWSER_API", "Gzip state pages require DecompressionStream.");
  let reader;
  try {
    reader = new Blob([encoded]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      require(!signal?.aborted, "OPERATION_ABORTED", `State page ${record.id} request was aborted.`);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      require(total <= record.decodedByteLength, "STATE_PAGE_DECODED_SIZE_MISMATCH", `State page ${record.id} decoded length exceeds RCRD.`);
      chunks.push(value);
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return output;
  } catch (error) {
    if (signal?.aborted) {
      try { await reader?.cancel(); } catch {}
    }
    if (error instanceof NVersionError) throw error;
    throw new NVersionError("STATE_PAGE_DECODE_FAILED", `State page ${record.id} gzip decoding failed.`);
  } finally {
    try { reader?.releaseLock(); } catch {}
  }
}

function cssNumber(value) {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function matrix(value, label) {
  require(value.startsWith("matrix3d(") && value.endsWith(")"), "INVALID_STATE_PAGE", `${label} is not a matrix3d transform.`);
  const tokens = value.slice(9, -1).split(",");
  require(tokens.length === 16, "INVALID_STATE_PAGE", `${label} must contain sixteen matrix3d components.`);
  const components = tokens.map((token) => {
    require(token.length > 0 && token === String(Number(token)), "INVALID_STATE_PAGE", `${label} contains a noncanonical CSS number.`);
    const component = Math.fround(Number(token));
    require(Number.isFinite(component) && cssNumber(component) === token, "INVALID_STATE_PAGE", `${label} contains a noncanonical binary32 component.`);
    return component;
  });
  require(components[3] === 0 && components[7] === 0 && components[11] === 0 && components[15] === 1, "INVALID_STATE_PAGE", `${label} is not an affine prepared matrix.`);
  require(value !== "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)", "INVALID_STATE_PAGE", `${label} must encode identity as null.`);
  return value;
}

function bitset(value, count, label) {
  const packed = packedIntegers(value, 1, Math.ceil(count / 8), label);
  require(packed.length === Math.ceil(count / 8), "STATE_COLUMN_MISMATCH", `${label} is truncated.`);
  if (count % 8 !== 0 && packed.length > 0) require((packed.at(-1) >> (count % 8)) === 0, "INVALID_STATE_PAGE", `${label} has nonzero unused bits.`);
  const output = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) output[index] = (packed[index >> 3] >> (index & 7)) & 1;
  return output;
}

function validateVariantStatePage(document, record, descriptor, state, binding, page, limits) {
  exactKeys(page, ["version", "codec", "channel", "startFrame", "endFrame", "keyframeClassIndicesBase64", "sequential"], "INVALID_STATE_PAGE", `State page ${record.id}`);
  require(page.version === 0 && page.codec === record.codec && page.channel === state.id, "INVALID_STATE_PAGE", `State page ${record.id} identity is invalid.`);
  require(page.startFrame === descriptor.startFrame && page.endFrame === descriptor.endFrame, "STATE_PAGE_COVERAGE_MISMATCH", `State page ${record.id} coverage differs from its descriptor.`);
  const frameCount = page.endFrame - page.startFrame + 1;
  require(Number.isSafeInteger(frameCount) && frameCount > 0 && frameCount <= limits.maxStatePageFrames, "STATE_PAGE_COVERAGE_MISMATCH", `State page ${record.id} coverage is invalid.`);
  const targetCount = binding.targets.nodes.length;
  const keyframe = packedIntegers(page.keyframeClassIndicesBase64, 2, targetCount, `State page ${record.id} keyframe`);
  require(keyframe.length === targetCount && keyframe.every((value) => value === 0xffff || value < state.data.packet.classes.length), "STATE_COLUMN_MISMATCH", `State page ${record.id} keyframe is invalid.`);
  exactKeys(page.sequential, ["offsetsBase64", "targetIndicesBase64", "classIndicesBase64"], "INVALID_STATE_PAGE", `State page ${record.id} transitions`);
  const offsets = packedIntegers(page.sequential.offsetsBase64, 4, frameCount + 1, `State page ${record.id} offsets`);
  const targets = packedIntegers(page.sequential.targetIndicesBase64, 2, limits.maxPreparedChanges, `State page ${record.id} targets`);
  const classes = packedIntegers(page.sequential.classIndicesBase64, 2, limits.maxPreparedChanges, `State page ${record.id} classes`);
  require(offsets.length === frameCount + 1 && offsets[0] === 0 && offsets[1] === 0 && offsets.at(-1) === targets.length && offsets.every((value, index) => index === 0 || value >= offsets[index - 1]), "STATE_COLUMN_MISMATCH", `State page ${record.id} offsets are invalid.`);
  require(targets.length === classes.length && targets.length === descriptor.changeCount, "STATE_COLUMN_MISMATCH", `State page ${record.id} transition columns or declared count disagree.`);
  const row = keyframe.slice();
  for (let localFrame = 1; localFrame < frameCount; localFrame += 1) {
    let previous = -1;
    for (let cursor = offsets[localFrame]; cursor < offsets[localFrame + 1]; cursor += 1) {
      require(targets[cursor] > previous && targets[cursor] < targetCount && (classes[cursor] === 0xffff || classes[cursor] < state.data.packet.classes.length) && row[targets[cursor]] !== classes[cursor], "INVALID_STATE_PAGE", `State page ${record.id} transition is invalid.`);
      row[targets[cursor]] = classes[cursor];
      previous = targets[cursor];
    }
  }
  const materializedByteLength = targetCount * 2 + (frameCount + 1) * 4 + targets.length * 4;
  require(materializedByteLength === descriptor.materializedByteLength, "STATE_PAGE_MATERIALIZED_SIZE_MISMATCH", `State page ${record.id} materialized size disagrees with its descriptor.`);
  return { codec: record.codec, channel: state.id, startFrame: page.startFrame, endFrame: page.endFrame, materializedByteLength, keyframe, offsets, targets, classes };
}

const PLAYBACK_VALIDATION_SLICE_OPERATIONS = 256;
const PLAYBACK_INITIAL_VALIDATION_SLICE_OPERATIONS = 64;

async function yieldPlaybackPageValidation(signal) {
  require(!signal?.aborted, "OPERATION_ABORTED", "State-page validation was aborted.");
  await new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      signal?.removeEventListener("abort", done);
      resolve();
    };
    signal?.addEventListener("abort", done, { once: true });
    if (globalThis.requestIdleCallback) globalThis.requestIdleCallback(done, { timeout: 16 });
    else setTimeout(done, 0);
  });
  require(!signal?.aborted, "OPERATION_ABORTED", "State-page validation was aborted.");
}

async function validatePlaybackStatePage(record, descriptor, state, page, limits, signal) {
  let sliceOperations = 0;
  let sliceLimit = PLAYBACK_INITIAL_VALIDATION_SLICE_OPERATIONS;
  const sliceBoundary = async () => {
    sliceOperations += 1;
    if (sliceOperations < sliceLimit) return;
    sliceOperations = 0;
    sliceLimit = PLAYBACK_VALIDATION_SLICE_OPERATIONS;
    await yieldPlaybackPageValidation(signal);
  };
  exactKeys(page, ["version", "codec", "channel", "startFrame", "endFrame", "transforms", "keyframe", "sequential"], "INVALID_STATE_PAGE", `State page ${record.id}`);
  require(page.version === 0 && page.codec === record.codec && page.channel === state.id, "INVALID_STATE_PAGE", `State page ${record.id} identity is invalid.`);
  require(page.startFrame === descriptor.startFrame && page.endFrame === descriptor.endFrame, "STATE_PAGE_COVERAGE_MISMATCH", `State page ${record.id} coverage differs from its descriptor.`);
  const frameCount = page.endFrame - page.startFrame + 1;
  require(Number.isSafeInteger(frameCount) && frameCount > 0 && frameCount <= limits.maxStatePageFrames, "STATE_PAGE_COVERAGE_MISMATCH", `State page ${record.id} coverage is invalid.`);
  require(Array.isArray(page.transforms) && page.transforms.length === descriptor.transformCount && page.transforms.length > 0 && page.transforms.length <= limits.maxPreparedTransforms, "TRANSFORM_ALLOCATION_LIMIT", `State page ${record.id} transform dictionary is invalid.`);
  const transforms = [];
  for (let index = 0; index < page.transforms.length; index += 1) {
    const value = page.transforms[index];
    require(value === null || typeof value === "string", "INVALID_STATE_PAGE", `State page ${record.id} transform ${index} is invalid.`);
    transforms.push(value === null ? "" : matrix(value, `State page ${record.id} transform ${index}`));
    await sliceBoundary();
  }
  exactKeys(page.keyframe, ["appearance", "modelTransform", "shapeTransformIndicesBase64", "shapeVisibilityBitsBase64", "leafTransformIndicesBase64"], "INVALID_STATE_PAGE", `State page ${record.id} keyframe`);
  const packet = state.data.packet;
  require(Number.isSafeInteger(page.keyframe.appearance) && page.keyframe.appearance >= 0 && page.keyframe.appearance < packet.appearances.length && Number.isSafeInteger(page.keyframe.modelTransform) && page.keyframe.modelTransform >= 0 && page.keyframe.modelTransform < transforms.length, "INVALID_STATE_PAGE", `State page ${record.id} keyframe is invalid.`);
  const keyframeShapeTransforms = packedIntegers(page.keyframe.shapeTransformIndicesBase64, 4, packet.shapeCount, `State page ${record.id} keyframe shape transforms`);
  const keyframeShapeVisibility = bitset(page.keyframe.shapeVisibilityBitsBase64, packet.shapeCount, `State page ${record.id} keyframe shape visibility`);
  const keyframeLeafTransforms = packedIntegers(page.keyframe.leafTransformIndicesBase64, 4, packet.leafCount, `State page ${record.id} keyframe leaf transforms`);
  require(keyframeShapeTransforms.length === packet.shapeCount && keyframeShapeTransforms.every((value) => value < transforms.length) && keyframeLeafTransforms.length === packet.leafCount && keyframeLeafTransforms.every((value) => value < transforms.length), "STATE_COLUMN_MISMATCH", `State page ${record.id} keyframe columns are invalid.`);
  exactKeys(page.sequential, ["appearanceIndicesBase64", "modelTransformIndicesBase64", "shapeOffsetsBase64", "shapeTargetIndicesBase64", "shapeTransformIndicesBase64", "shapeVisibilityBase64", "leafOffsetsBase64", "leafTargetIndicesBase64", "leafTransformIndicesBase64"], "INVALID_STATE_PAGE", `State page ${record.id} sequential transitions`);
  const appearances = packedIntegers(page.sequential.appearanceIndicesBase64, 2, frameCount, `State page ${record.id} appearances`);
  const modelTransforms = packedIntegers(page.sequential.modelTransformIndicesBase64, 4, frameCount, `State page ${record.id} model transforms`);
  const shapeOffsets = packedIntegers(page.sequential.shapeOffsetsBase64, 4, frameCount + 1, `State page ${record.id} shape offsets`);
  const shapeTargets = packedIntegers(page.sequential.shapeTargetIndicesBase64, 4, limits.maxPreparedChanges, `State page ${record.id} shape targets`);
  const shapeTransforms = packedIntegers(page.sequential.shapeTransformIndicesBase64, 4, limits.maxPreparedChanges, `State page ${record.id} shape transforms`);
  const shapeVisibility = packedIntegers(page.sequential.shapeVisibilityBase64, 1, limits.maxPreparedChanges, `State page ${record.id} shape visibility`);
  const leafOffsets = packedIntegers(page.sequential.leafOffsetsBase64, 4, frameCount + 1, `State page ${record.id} leaf offsets`);
  const leafTargets = packedIntegers(page.sequential.leafTargetIndicesBase64, 4, limits.maxPreparedChanges, `State page ${record.id} leaf targets`);
  const leafTransforms = packedIntegers(page.sequential.leafTransformIndicesBase64, 4, limits.maxPreparedChanges, `State page ${record.id} leaf transforms`);
  require(appearances.length === frameCount && appearances.every((value) => value < packet.appearances.length) && appearances[0] === page.keyframe.appearance, "STATE_COLUMN_MISMATCH", `State page ${record.id} appearances are invalid.`);
  require(modelTransforms.length === frameCount && modelTransforms.every((value) => value === 0xffffffff || value < transforms.length), "STATE_COLUMN_MISMATCH", `State page ${record.id} model transforms are invalid.`);
  require(shapeOffsets.length === frameCount + 1 && shapeOffsets[0] === 0 && shapeOffsets.at(-1) === shapeTargets.length && shapeOffsets.every((value, index) => index === 0 || value >= shapeOffsets[index - 1]), "STATE_COLUMN_MISMATCH", `State page ${record.id} shape offsets are invalid.`);
  require(leafOffsets.length === frameCount + 1 && leafOffsets[0] === 0 && leafOffsets.at(-1) === leafTargets.length && leafOffsets.every((value, index) => index === 0 || value >= leafOffsets[index - 1]), "STATE_COLUMN_MISMATCH", `State page ${record.id} leaf offsets are invalid.`);
  require(shapeTargets.length === shapeTransforms.length && shapeTargets.length === shapeVisibility.length && shapeTargets.length === descriptor.shapeChangeCount, "STATE_COLUMN_MISMATCH", `State page ${record.id} shape columns or declared count disagree.`);
  require(leafTargets.length === leafTransforms.length && leafTargets.length === descriptor.leafChangeCount, "STATE_COLUMN_MISMATCH", `State page ${record.id} leaf columns or declared count disagree.`);
  const owners = new Map();
  const values = new Map();
  let nextFirstUse = 0;
  const claim = (index, owner, label) => {
    require(index >= 0 && index < transforms.length, "INVALID_STATE_PAGE", `${label} references a missing transform.`);
    const existingOwner = owners.get(index);
    if (existingOwner === undefined) {
      require(index === nextFirstUse, "TRANSFORM_GROUP_MISMATCH", `${label} violates canonical transform first-use order.`);
      owners.set(index, owner);
      nextFirstUse += 1;
    } else require(existingOwner === owner, "TRANSFORM_GROUP_MISMATCH", `${label} aliases a transform across incompatible owners.`);
    const valueKey = `${owner}\0${transforms[index]}`;
    const existingIndex = values.get(valueKey);
    require(existingIndex === undefined || existingIndex === index, "TRANSFORM_GROUP_MISMATCH", `${label} duplicates a transform within one owner domain.`);
    values.set(valueKey, index);
  };
  claim(page.keyframe.modelTransform, "model", `State page ${record.id} keyframe model`);
  await sliceBoundary();
  for (let index = 0; index < keyframeShapeTransforms.length; index += 1) {
    claim(keyframeShapeTransforms[index], "shape", `State page ${record.id} keyframe shape ${index}`);
    await sliceBoundary();
  }
  for (let index = 0; index < keyframeLeafTransforms.length; index += 1) {
    claim(keyframeLeafTransforms[index], `leaf:${index}`, `State page ${record.id} keyframe leaf ${index}`);
    await sliceBoundary();
  }
  let currentModel = page.keyframe.modelTransform;
  const currentShapes = keyframeShapeTransforms.slice();
  const currentVisibility = keyframeShapeVisibility.slice();
  const currentLeaves = keyframeLeafTransforms.slice();
  for (let localFrame = 0; localFrame < frameCount; localFrame += 1) {
    const model = modelTransforms[localFrame];
    if (model !== 0xffffffff) {
      claim(model, "model", `State page ${record.id} frame ${page.startFrame + localFrame} model`);
      if (localFrame > 0) { require(model !== currentModel, "INVALID_STATE_PAGE", `State page ${record.id} contains a no-op model transition.`); currentModel = model; }
      await sliceBoundary();
    }
    let previousShape = -1;
    for (let cursor = shapeOffsets[localFrame]; cursor < shapeOffsets[localFrame + 1]; cursor += 1) {
      const target = shapeTargets[cursor];
      const transform = shapeTransforms[cursor];
      const visibility = shapeVisibility[cursor];
      require(target > previousShape && target < packet.shapeCount && visibility <= 1, "INVALID_STATE_PAGE", `State page ${record.id} shape transition is invalid.`);
      claim(transform, "shape", `State page ${record.id} frame ${page.startFrame + localFrame} shape ${target}`);
      if (localFrame > 0) { require(currentShapes[target] !== transform || currentVisibility[target] !== visibility, "INVALID_STATE_PAGE", `State page ${record.id} contains a no-op shape transition.`); currentShapes[target] = transform; currentVisibility[target] = visibility; }
      previousShape = target;
      await sliceBoundary();
    }
    let previousLeaf = -1;
    for (let cursor = leafOffsets[localFrame]; cursor < leafOffsets[localFrame + 1]; cursor += 1) {
      const target = leafTargets[cursor];
      const transform = leafTransforms[cursor];
      require(target > previousLeaf && target < packet.leafCount, "INVALID_STATE_PAGE", `State page ${record.id} leaf transition is invalid.`);
      claim(transform, `leaf:${target}`, `State page ${record.id} frame ${page.startFrame + localFrame} leaf ${target}`);
      if (localFrame > 0) { require(currentLeaves[target] !== transform, "INVALID_STATE_PAGE", `State page ${record.id} contains a no-op leaf transition.`); currentLeaves[target] = transform; }
      previousLeaf = target;
      await sliceBoundary();
    }
  }
  require(owners.size === transforms.length, "TRANSFORM_GROUP_MISMATCH", `State page ${record.id} transform dictionary contains an unreferenced row.`);
  let transformBytes = 0;
  for (const transform of transforms) {
    transformBytes += 8 + transform.length * 2;
    await sliceBoundary();
  }
  const materializedByteLength = transformBytes + keyframeShapeTransforms.length * 4 + keyframeShapeVisibility.length + keyframeLeafTransforms.length * 4 + appearances.length * 2 + modelTransforms.length * 4 + shapeOffsets.length * 4 + shapeTargets.length * 4 + shapeTransforms.length * 4 + shapeVisibility.length + leafOffsets.length * 4 + leafTargets.length * 4 + leafTransforms.length * 4;
  require(materializedByteLength === descriptor.materializedByteLength, "STATE_PAGE_MATERIALIZED_SIZE_MISMATCH", `State page ${record.id} materialized size disagrees with its descriptor.`);
  return { codec: record.codec, channel: state.id, startFrame: page.startFrame, endFrame: page.endFrame, materializedByteLength, transforms, keyframe: { appearance: page.keyframe.appearance, modelTransform: page.keyframe.modelTransform, shapeTransforms: keyframeShapeTransforms, shapeVisibility: keyframeShapeVisibility, leafTransforms: keyframeLeafTransforms }, appearances, modelTransforms, shapeOffsets, shapeTargets, shapeTransforms, shapeVisibility, leafOffsets, leafTargets, leafTransforms };
}

async function validateStatePage(document, record, decoded, limits, signal) {
  const ownerCodec = record.codec === "polycss-paged-variants-page@0" ? "polycss-paged-variants@0" : record.codec === "polycss-paged-playback-page@0" ? "polycss-paged-playback@0" : null;
  require(ownerCodec, "INVALID_STATE_PAGE_RESOURCE", `State page ${record.id} codec is unsupported.`);
  const state = document.state.channels.find((channel) => channel.codec === ownerCodec);
  const binding = document.bindings.channels.find((channel) => channel.interpreter === ownerCodec);
  require(state && binding, "UNEXPECTED_STATE_PAGE", `State page ${record.id} has no matching paged channel.`);
  const descriptor = state.data.packet.pages.find((page) => page.resource === record.id);
  require(descriptor, "UNEXPECTED_STATE_PAGE", `State page ${record.id} is not referenced by its matching channel.`);
  if (record.codec === "polycss-paged-playback-page@0") await yieldPlaybackPageValidation(signal);
  const page = parseJsonBytes(decoded, limits, `State page ${record.id}`);
  require(new TextDecoder().decode(decoded) === canonicalJson(page), "NONCANONICAL_STATE_PAGE", `State page ${record.id} is not canonical JSON.`);
  return record.codec === "polycss-paged-variants-page@0"
    ? validateVariantStatePage(document, record, descriptor, state, binding, page, limits)
    : await validatePlaybackStatePage(record, descriptor, state, page, limits, signal);
}

function variantRow(page, frame) {
  const row = page.keyframe.slice();
  for (let local = 1; local <= frame - page.startFrame; local += 1) for (let cursor = page.offsets[local]; cursor < page.offsets[local + 1]; cursor += 1) row[page.targets[cursor]] = page.classes[cursor];
  return row;
}

function playbackRow(page, localFrame) {
  let appearance = page.keyframe.appearance;
  let modelTransform = page.transforms[page.keyframe.modelTransform];
  const shapeTransforms = Array.from(page.keyframe.shapeTransforms, (index) => page.transforms[index]);
  const shapeVisibility = [...page.keyframe.shapeVisibility];
  const leafTransforms = Array.from(page.keyframe.leafTransforms, (index) => page.transforms[index]);
  for (let frame = 1; frame <= localFrame; frame += 1) {
    appearance = page.appearances[frame];
    if (page.modelTransforms[frame] !== 0xffffffff) modelTransform = page.transforms[page.modelTransforms[frame]];
    for (let cursor = page.shapeOffsets[frame]; cursor < page.shapeOffsets[frame + 1]; cursor += 1) { const target = page.shapeTargets[cursor]; shapeTransforms[target] = page.transforms[page.shapeTransforms[cursor]]; shapeVisibility[target] = page.shapeVisibility[cursor]; }
    for (let cursor = page.leafOffsets[frame]; cursor < page.leafOffsets[frame + 1]; cursor += 1) { const target = page.leafTargets[cursor]; leafTransforms[target] = page.transforms[page.leafTransforms[cursor]]; }
  }
  return { appearance, modelTransform, shapeTransforms, shapeVisibility, leafTransforms };
}

function validatePlaybackBoundaryFromCanonical(from, target) {
  const to = playbackRow(target, 0);
  require(target.appearances[0] === to.appearance, "STATE_PAGE_BOUNDARY_MISMATCH", `State page ${target.channel}/${target.startFrame} boundary appearance disagrees with its keyframe.`);
  const expectedModel = from.modelTransform === to.modelTransform ? 0xffffffff : target.keyframe.modelTransform;
  require(target.modelTransforms[0] === expectedModel, "STATE_PAGE_BOUNDARY_MISMATCH", `State page ${target.channel}/${target.startFrame} boundary model delta is incomplete or excessive.`);
  const expectedShapes = [];
  for (let index = 0; index < to.shapeTransforms.length; index += 1) {
    if (from.shapeTransforms[index] !== to.shapeTransforms[index] || from.shapeVisibility[index] !== to.shapeVisibility[index]) expectedShapes.push(index);
  }
  const actualShapes = [...target.shapeTargets.subarray(target.shapeOffsets[0], target.shapeOffsets[1])];
  require(actualShapes.length === expectedShapes.length && actualShapes.every((value, index) => value === expectedShapes[index]), "STATE_PAGE_BOUNDARY_MISMATCH", `State page ${target.channel}/${target.startFrame} boundary shape targets are incomplete or excessive.`);
  for (let cursor = target.shapeOffsets[0]; cursor < target.shapeOffsets[1]; cursor += 1) {
    const shape = target.shapeTargets[cursor];
    require(target.transforms[target.shapeTransforms[cursor]] === to.shapeTransforms[shape] && target.shapeVisibility[cursor] === to.shapeVisibility[shape], "STATE_PAGE_BOUNDARY_MISMATCH", `State page ${target.channel}/${target.startFrame} boundary shape ${shape} disagrees with its keyframe.`);
  }
  const expectedLeaves = [];
  for (let index = 0; index < to.leafTransforms.length; index += 1) if (from.leafTransforms[index] !== to.leafTransforms[index]) expectedLeaves.push(index);
  const actualLeaves = [...target.leafTargets.subarray(target.leafOffsets[0], target.leafOffsets[1])];
  require(actualLeaves.length === expectedLeaves.length && actualLeaves.every((value, index) => value === expectedLeaves[index]), "STATE_PAGE_BOUNDARY_MISMATCH", `State page ${target.channel}/${target.startFrame} boundary leaf targets are incomplete or excessive.`);
  for (let cursor = target.leafOffsets[0]; cursor < target.leafOffsets[1]; cursor += 1) {
    const leaf = target.leafTargets[cursor];
    require(target.transforms[target.leafTransforms[cursor]] === to.leafTransforms[leaf], "STATE_PAGE_BOUNDARY_MISMATCH", `State page ${target.channel}/${target.startFrame} boundary leaf ${leaf} disagrees with its keyframe.`);
  }
}

function validateLoadedStatePageClosure(document, decoded, resourceId) {
  const state = document.state.channels.find((channel) => channel.id === decoded.channel);
  const packet = state.data.packet;
  const descriptorIndex = packet.pages.findIndex((page) => page.resource === resourceId);
  require(descriptorIndex >= 0, "UNEXPECTED_STATE_PAGE", "Loaded state page is not in its owner descriptor list.");
  if (decoded.codec === "polycss-paged-variants-page@0") {
    if (packet.initial.frame >= decoded.startFrame && packet.initial.frame <= decoded.endFrame) {
      const binding = document.bindings.channels.find((channel) => channel.interpreter === "polycss-paged-variants@0");
      const expected = packedIntegers(packet.initial.classIndicesBase64, 2, binding.targets.nodes.length, "Paged variant shell initial row");
      const actual = variantRow(decoded, packet.initial.frame);
      require(actual.length === expected.length && actual.every((value, index) => value === expected[index]), "STATE_PAGE_INITIAL_MISMATCH", "Paged variant initial page disagrees with its shell/TREE row.");
    }
    return;
  }
  if (packet.initial.sourceFrame >= decoded.startFrame && packet.initial.sourceFrame <= decoded.endFrame) {
    const initial = playbackRow(decoded, packet.initial.sourceFrame - decoded.startFrame);
    require(initial.appearance === packet.initial.appearance, "STATE_PAGE_INITIAL_MISMATCH", "Paged playback initial page disagrees with its shell appearance.");
    const binding = document.bindings.channels.find((channel) => channel.interpreter === "polycss-paged-playback@0");
    const nodes = new Map(document.tree.nodes.map((node) => [node.id, node]));
    const expectedModel = initial.modelTransform === "" ? binding.parameters.baseSceneTransform : `${binding.parameters.baseSceneTransform} ${initial.modelTransform}`;
    require(nodes.get(binding.targets.model)?.styles?.transform === expectedModel, "STATE_PAGE_INITIAL_MISMATCH", "Paged playback initial page disagrees with TREE model transform.");
    for (let index = 0; index < binding.targets.shapes.length; index += 1) { const node = nodes.get(binding.targets.shapes[index]); require(node?.styles?.transform === initial.shapeTransforms[index] && node.styles.visibility === (initial.shapeVisibility[index] === 1 ? "visible" : "hidden"), "STATE_PAGE_INITIAL_MISMATCH", `Paged playback initial page disagrees with TREE shape ${index}.`); }
    for (let index = 0; index < binding.targets.leaves.length; index += 1) require(nodes.get(binding.targets.leaves[index])?.styles?.transform === initial.leafTransforms[index], "STATE_PAGE_INITIAL_MISMATCH", `Paged playback initial page disagrees with TREE leaf ${index}.`);
  }
}

function resourceBytes(value, record) {
  const bytes = value instanceof Uint8Array ? value.slice() : value instanceof ArrayBuffer ? new Uint8Array(value) : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice() : null;
  require(bytes, "INVALID_RESOURCE_BYTES", `External resource ${record.id} is not bytes.`);
  return bytes;
}

async function loadResource(record, options, signal) {
  require(!signal?.aborted, "OPERATION_ABORTED", `Resource ${record.id} request was aborted.`);
  let value = options.externalResources?.get?.(record.id);
  if (value === undefined && typeof options.loadResource === "function") value = await options.loadResource(record, signal);
  require(!signal?.aborted, "OPERATION_ABORTED", `Resource ${record.id} request was aborted.`);
  require(value !== undefined, "MISSING_EXTERNAL_RESOURCE", `External resource ${record.id} is unavailable.`);
  return resourceBytes(value, record);
}

async function verifyIdentity(record, bytes) {
  require(bytes.length === record.byteLength, "RESOURCE_SIZE_MISMATCH", `Resource ${record.id} has the wrong length.`);
  require(await sha256(bytes) === record.digest.value, "RESOURCE_DIGEST_MISMATCH", `Resource ${record.id} has the wrong digest.`);
}

export async function verifyResources(document, records, options, limits) {
  const bytesById = new Map();
  for (const record of records.values()) {
    if (record.kind === "state-page") continue;
    const bytes = await loadResource(record, options, options.signal);
    bytesById.set(record.id, bytes);
  }
  for (const record of records.values()) {
    if (record.kind === "state-page") continue;
    const bytes = bytesById.get(record.id);
    await verifyIdentity(record, bytes);
    if (record.kind === "image") {
      const dimensions = imageDimensions(bytes, record.mediaType);
      require(dimensions.width === record.dimensions.width && dimensions.height === record.dimensions.height, "IMAGE_DIMENSION_MISMATCH", `Resource ${record.id} dimensions disagree.`);
    }
  }
  const variants = document.state.channels.find((channel) => channel.codec === "polycss-variants-packed@0" || channel.codec === "polycss-paged-variants@0");
  const forbiddenClassTokens = new Set(variants?.data?.packet?.classes ?? []);
  for (const binding of document.cssBinding.stylesheets) validateStylesheet(bytesById.get(binding.resource), binding, records, limits, forbiddenClassTokens);
  const loadValidatedStatePage = async (declared, signal) => {
    const encoded = await loadResource(declared, options, signal);
    await verifyIdentity(declared, encoded);
    require(declared.encoding === "identity" || (encoded.length >= 2 && encoded[0] === 0x1f && encoded[1] === 0x8b), "STATE_PAGE_DECODE_FAILED", `State page ${declared.id} encoding does not match its bytes.`);
    const decoded = await decodeStatePage(declared, encoded, signal);
    require(!signal?.aborted, "OPERATION_ABORTED", `Resource ${declared.id} request was aborted.`);
    require(decoded.length === declared.decodedByteLength, "STATE_PAGE_DECODED_SIZE_MISMATCH", `State page ${declared.id} decoded length differs from RCRD.`);
    require(await sha256(decoded) === declared.decodedDigest.value, "STATE_PAGE_DECODED_DIGEST_MISMATCH", `State page ${declared.id} decoded digest differs from RCRD.`);
    require(!signal?.aborted, "OPERATION_ABORTED", `Resource ${declared.id} request was aborted.`);
    const validated = await validateStatePage(document, declared, decoded, limits, signal);
    require(!signal?.aborted, "OPERATION_ABORTED", `Resource ${declared.id} request was aborted.`);
    validateLoadedStatePageClosure(document, validated, declared.id);
    return { decoded, validated };
  };
  const loadStatePage = async (record, signal) => {
    const declared = records.get(record?.id);
    require(declared?.kind === "state-page", "INVALID_STATE_PAGE_RESOURCE", `Resource ${String(record?.id)} is not a declared state page.`);
    if (declared.codec !== "polycss-paged-playback-page@0") return (await loadValidatedStatePage(declared, signal)).decoded;
    const state = document.state.channels.find((channel) => channel.codec === "polycss-paged-playback@0");
    const pages = state?.data?.packet?.pages;
    const descriptorIndex = pages?.findIndex((page) => page.resource === declared.id) ?? -1;
    require(descriptorIndex >= 0, "UNEXPECTED_STATE_PAGE", `State page ${declared.id} is not referenced by its matching channel.`);
    const predecessor = records.get(pages[(descriptorIndex + pages.length - 1) % pages.length].resource);
    require(predecessor?.kind === "state-page" && predecessor.codec === "polycss-paged-playback-page@0", "INVALID_STATE_PAGE_RESOURCE", `State page ${declared.id} has no declared playback predecessor.`);
    if (predecessor.id === declared.id) {
      const loaded = await loadValidatedStatePage(declared, signal);
      validatePlaybackBoundaryFromCanonical(playbackRow(loaded.validated, loaded.validated.endFrame - loaded.validated.startFrame), loaded.validated);
      return loaded.decoded;
    }
    const previous = await loadValidatedStatePage(predecessor, signal);
    const previousRow = playbackRow(previous.validated, previous.validated.endFrame - previous.validated.startFrame);
    const loaded = await loadValidatedStatePage(declared, signal);
    validatePlaybackBoundaryFromCanonical(previousRow, loaded.validated);
    return loaded.decoded;
  };
  return Object.freeze({ resourceBytes: bytesById, loadStatePage });
}
