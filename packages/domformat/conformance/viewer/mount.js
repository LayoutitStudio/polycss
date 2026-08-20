import {
  createInteractionInput,
  createLifecycle,
  createPolycssCompositorTiming,
  createPolycssEffects,
  createPolycssInteraction,
  createPolycssOrbitInput,
  createPolycssPagedState,
  createPolycssPlayback,
  createStaticPresentation,
  DEFAULT_LIMITS,
  invariant,
  materializePolycssState,
} from "../../dist/internal-conformance.js";

const MAX_CATCH_UP_TICKS = 8;

// This deliberately stays outside the package exports. It challenges the
// production viewer's mount shell while sharing the profile's one normative
// set of state interpreters.

const REQUIRED_INTERPRETERS = Object.freeze([
  "static-presentation@0",
]);
const KNOWN_CAPABILITIES = new Set([
  "css-semantic-closure",
  "deterministic-json",
  "explicit-retained-tree",
  "logical-assets",
  "prepared-particle-effects",
  "prepared-compositor-timing",
  "prepared-orbit-input",
  "prepared-paged-state",
  "prepared-playback",
  "prepared-pointer-grab-interaction",
  "prepared-surface-lighting",
  "prepared-variants",
  "prepared-viewport-profiles",
]);
const BOUNDARY_STYLES = Object.freeze({
  display: "block",
  position: "relative",
  inset: "0",
  width: "100%",
  height: "100%",
  maxWidth: "none",
  margin: "0",
  padding: "0",
  border: "0",
  boxSizing: "border-box",
  overflow: "hidden",
  contain: "strict",
  isolation: "isolate",
  transform: "none",
  zIndex: "auto",
  opacity: "1",
  visibility: "visible",
  pointerEvents: "auto",
});
const SNAPSHOT_STYLE_PROPERTIES = Object.freeze([
  "backgroundColor", "backgroundImage", "backgroundPosition", "backgroundPositionY",
  "backgroundRepeat", "backgroundSize", "border", "borderBottomLeftRadius",
  "borderBottomRightRadius", "borderShape", "borderTopLeftRadius", "borderTopRightRadius",
  "boxSizing", "color", "contain", "cornerBottomLeftShape", "cornerBottomRightShape",
  "cornerTopLeftShape", "cornerTopRightShape", "display",
  "height", "inset", "isolation", "left", "margin", "maxWidth", "objectFit",
  "objectPosition", "opacity", "overflow", "padding", "perspective", "perspectiveOrigin",
  "pointerEvents", "position", "top", "transform", "transformOrigin", "transformStyle",
  "transition", "visibility", "width", "zIndex",
]);
let scopeSequence = 0;

function aborted(signal) {
  invariant(!signal?.aborted, "OPERATION_ABORTED", "The conformance viewer operation was aborted by its host.");
}

function bytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  invariant(false, "INVALID_RESOURCE_BYTES", `${label} is not a byte buffer.`);
}

async function digestHex(value) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", value));
  return [...digest].map((entry) => entry.toString(16).padStart(2, "0")).join("");
}

function captureHost(host) {
  const children = [...host.childNodes];
  const tabindex = { present: host.hasAttribute("tabindex"), value: host.getAttribute("tabindex") };
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    host.replaceChildren(...children);
    if (tabindex.present) host.setAttribute("tabindex", tabindex.value);
    else host.removeAttribute("tabindex");
  };
}

function styleMap(element, declarations) {
  for (const [name, value] of Object.entries(declarations ?? {})) element.style[name] = value;
}

function resourceValue(binding, urls) {
  const url = urls.get(binding.resource);
  invariant(typeof url === "string", "MISSING_RESOURCE_URL", `Resource URL ${binding.resource} is unavailable.`);
  if (binding.syntax === "url") return `url(${JSON.stringify(url)})`;
  const alpha = 1 - binding.overlayOpacity;
  return `linear-gradient(rgba(0,0,0,${alpha}),rgba(0,0,0,${alpha})),url(${JSON.stringify(url)})`;
}

function resourceStyles(element, declarations, urls) {
  for (const [name, binding] of Object.entries(declarations ?? {})) element.style[name] = resourceValue(binding, urls);
}

function constructTree(ownerDocument, surface, tree) {
  surface.replaceChildren();
  for (const [name, value] of tree.mount.attributes) surface.setAttribute(name, value);
  styleMap(surface, tree.mount.styles);
  const elements = [];
  const byId = new Map();
  for (const node of tree.nodes) {
    const element = ownerDocument.createElementNS(node.namespace, node.name);
    element.setAttribute("data-domformat-node", String(node.index));
    if (node.classes?.length) element.classList.add(...node.classes);
    for (const [name, value] of Object.entries(node.attributes ?? {})) element.setAttribute(name, value);
    styleMap(element, node.styles);
    (node.parent === -1 ? surface : elements[node.parent]).appendChild(element);
    elements.push(element);
    byId.set(node.id, element);
  }
  return Object.freeze({ host: surface, tree, elements: Object.freeze(elements), byId });
}

const VARIANT_EFFECT_CSS_PROPERTIES = Object.freeze({
  backgroundColor: "background-color",
  backgroundPositionX: "background-position-x",
  color: "color",
  display: "display",
  outlineColor: "outline-color",
});

function preparedVariantCss(document, runtimeSelector) {
  const state = document.state.channels.find((channel) => channel.codec === "polycss-variants-packed@0" || channel.codec === "polycss-paged-variants@0");
  if (!state) return "";
  const interpreter = state.codec === "polycss-paged-variants@0" ? "polycss-paged-variants@0" : "polycss-variants@0";
  const binding = document.bindings.channels.find((channel) => channel.interpreter === interpreter);
  invariant(binding, "MISSING_POLYCSS_BINDING", "Prepared variants require a binding.");
  const packet = state.data.packet;
  const byId = new Map(document.tree.nodes.map((node) => [node.id, node]));
  return packet.effects.map((effect) => {
    const owner = byId.get(binding.targets.nodes[effect.ownerIndex]);
    const target = effect.targetIndex === 0xffff ? owner : byId.get(binding.targets.effectNodes[effect.targetIndex]);
    invariant(owner && target, "INVALID_VARIANT_EFFECT", "Prepared variant effect target is absent.");
    const ownerSelector = `[data-domformat-node="${owner.index}"].${packet.classes[effect.classIndex]}`;
    const selector = target === owner ? ownerSelector : `${ownerSelector} [data-domformat-node="${target.index}"]`;
    const declarations = Object.entries(effect.styles).map(([property, value]) => `${VARIANT_EFFECT_CSS_PROPERTIES[property]}:${value}`);
    return `${runtimeSelector} ${selector}{${declarations.join(";")}}`;
  }).join("\n");
}

async function decodeStatePage(record, encoded, signal) {
  invariant(record.kind === "state-page" && record.decodedByteLength !== undefined && record.decodedDigest, "INVALID_STATE_PAGE_RESOURCE", `Resource ${record.id} is not a complete state page.`);
  aborted(signal);
  if (record.encoding === "identity") return encoded.slice();
  const DecompressionStreamClass = globalThis.DecompressionStream;
  invariant(typeof DecompressionStreamClass === "function", "MISSING_BROWSER_API", "Gzip state pages require DecompressionStream support.");
  let reader;
  try {
    reader = new Blob([encoded]).stream().pipeThrough(new DecompressionStreamClass("gzip")).getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      aborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = bytes(value, `Decoded state page ${record.id}`);
      length += chunk.length;
      invariant(length <= record.decodedByteLength, "STATE_PAGE_DECODED_SIZE_MISMATCH", `State page ${record.id} exceeds its declared decoded length.`);
      chunks.push(chunk.slice());
    }
    invariant(length === record.decodedByteLength, "STATE_PAGE_DECODED_SIZE_MISMATCH", `State page ${record.id} decoded length does not match RCRD.`);
    const decoded = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      decoded.set(chunk, offset);
      offset += chunk.length;
    }
    invariant(await digestHex(decoded) === record.decodedDigest.value, "STATE_PAGE_DECODED_DIGEST_MISMATCH", `State page ${record.id} decoded digest does not match RCRD.`);
    return decoded;
  } catch (error) {
    try { await reader?.cancel(); } catch {}
    if (error?.name === "DomFormatError") throw error;
    invariant(false, "STATE_PAGE_DECODE_FAILED", `State page ${record.id} gzip decoding failed.`);
  }
}

function bindResources(mounted, urls) {
  resourceStyles(mounted.host, mounted.tree.mount.resourceStyles, urls);
  for (const node of mounted.tree.nodes) {
    const element = mounted.elements[node.index];
    for (const [name, id] of Object.entries(node.resourceAttributes ?? {})) {
      invariant(urls.has(id), "MISSING_RESOURCE_URL", `Resource URL ${id} is unavailable.`);
      element.setAttribute(name, urls.get(id));
    }
    resourceStyles(element, node.resourceStyles, urls);
  }
}

function boundary(surface) {
  for (const [name, value] of Object.entries(BOUNDARY_STYLES)) {
    const kebab = name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
    if (typeof surface.style.setProperty === "function") surface.style.setProperty(kebab, value, "important");
    else surface.style[name] = value;
  }
  surface.setAttribute("data-domformat-mount-surface", "");
}

function selectorSegments(css, start, end) {
  const ranges = [];
  let segment = start;
  let depth = 0;
  let quote = null;
  for (let index = start; index < end; index += 1) {
    const character = css[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      ranges.push([segment, index]);
      segment = index + 1;
    }
  }
  ranges.push([segment, end]);
  return ranges;
}

function closingBrace(css, open) {
  let depth = 1;
  let quote = null;
  for (let index = open + 1; index < css.length; index += 1) {
    const character = css[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

function urlArgumentEnd(css, start, blockEnd) {
  let quote = null;
  for (let index = start; index < blockEnd; index += 1) {
    const character = css[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ")") return index;
  }
  return -1;
}

function closedCss(css, binding, urls, runtimeSelector) {
  const replacements = [];
  const tokenResources = new Map(binding.assetTokens.map((entry) => [entry.token, entry.resource]));
  let cursor = 0;
  while (cursor < css.length) {
    while (/\s/u.test(css[cursor] ?? "")) cursor += 1;
    if (cursor >= css.length) break;
    const open = css.indexOf("{", cursor);
    invariant(open >= 0, "INVALID_CSS", "A stylesheet rule is truncated.");
    for (const [start, end] of selectorSegments(css, cursor, open)) {
      let scopeStart = start;
      while (scopeStart < end && /\s/u.test(css[scopeStart])) scopeStart += 1;
      invariant(css.startsWith(binding.scope, scopeStart), "INVALID_CSS_SCOPE", "A selector does not begin with its declared scope.");
      replacements.push([scopeStart, scopeStart + binding.scope.length, runtimeSelector]);
    }
    const close = closingBrace(css, open);
    invariant(close >= 0, "INVALID_CSS", "A stylesheet rule block is truncated.");
    let declarationQuote = null;
    for (let index = open + 1; index < close; index += 1) {
      const character = css[index];
      if (declarationQuote !== null) {
        if (character === declarationQuote) declarationQuote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        declarationQuote = character;
        continue;
      }
      if (css.slice(index, index + 4).toLowerCase() !== "url(") continue;
      const end = urlArgumentEnd(css, index + 4, close);
      invariant(end >= 0, "INVALID_CSS_URL", "A CSS url() is truncated.");
      const raw = css.slice(index + 4, end).trim();
      const token = (raw[0] === '"' && raw.at(-1) === '"') || (raw[0] === "'" && raw.at(-1) === "'")
        ? raw.slice(1, -1)
        : raw;
      const resource = tokenResources.get(token);
      invariant(resource && urls.has(resource), "INVALID_CSS_URL", `CSS token ${token} has no resource URL.`);
      let argumentStart = index + 4;
      while (/\s/u.test(css[argumentStart])) argumentStart += 1;
      let argumentEnd = end;
      while (argumentEnd > argumentStart && /\s/u.test(css[argumentEnd - 1])) argumentEnd -= 1;
      replacements.push([argumentStart, argumentEnd, JSON.stringify(urls.get(resource))]);
      index = end;
    }
    cursor = close + 1;
  }
  replacements.sort((left, right) => right[0] - left[0]);
  let output = css;
  for (const [start, end, value] of replacements) output = output.slice(0, start) + value + output.slice(end);
  return output;
}

function target(value, mounted) {
  if (typeof value === "string") {
    const element = value === "$host" ? mounted.host : mounted.byId.get(value);
    invariant(element, "MISSING_TARGET_NODE", `Binding target ${value} is absent.`);
    return element;
  }
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => target(entry, mounted)));
  const output = {};
  for (const [name, entry] of Object.entries(value)) output[name] = target(entry, mounted);
  return Object.freeze(output);
}

function bindChannels(bindings, mounted) {
  const output = new Map();
  for (const channel of bindings.channels) {
    output.set(channel.id, Object.freeze({ targets: target(channel.targets, mounted), sinks: Object.freeze([...channel.sinks]) }));
  }
  return output;
}

async function decodeImages(document, resourceBytes, win, BlobClass, signal) {
  const decode = win.createImageBitmap ?? globalThis.createImageBitmap;
  invariant(typeof decode === "function", "MISSING_BROWSER_API", "Image decoding is required before publication.");
  for (const record of document.resources.resources) {
    if (record.kind !== "image") continue;
    aborted(signal);
    let bitmap;
    try {
      bitmap = await decode.call(win, new BlobClass([resourceBytes.get(record.id)], { type: record.mediaType }));
    } catch (error) {
      invariant(false, "IMAGE_DECODE_FAILED", `Image decoder rejected ${record.id}: ${String(error)}`);
    }
    try {
      invariant(bitmap.width === record.dimensions.width && bitmap.height === record.dimensions.height, "IMAGE_DIMENSION_MISMATCH", `Image ${record.id} dimensions differ from its record.`);
    } finally {
      try { bitmap?.close?.(); } catch {}
    }
  }
}

function normalized(value, urls) {
  if (typeof value !== "string") return value;
  let output = value;
  for (const [id, url] of urls) output = output.split(url).join(`dom-resource:${id}`);
  return output;
}

function classesOf(element) {
  if (Array.isArray(element.classes)) return [...element.classes];
  if (typeof element.className === "string") return element.className.split(/\s+/u).filter(Boolean);
  return [];
}

function snapshotTree(mounted, urls) {
  const captureStyles = (element) => Object.fromEntries(SNAPSHOT_STYLE_PROPERTIES
    .map((name) => [name, normalized(element.style[name], urls)])
    .filter(([, value]) => value !== undefined && value !== ""));
  return Object.freeze({
    mount: Object.freeze({
      attributes: Object.freeze(mounted.tree.mount.attributes.map(([name]) => [name, mounted.host.getAttribute(name)])),
      styles: Object.freeze(captureStyles(mounted.host)),
    }),
    nodes: Object.freeze(mounted.tree.nodes.map((node) => {
      const element = mounted.elements[node.index];
      const parent = element.parentNode === mounted.host ? -1 : mounted.elements.indexOf(element.parentNode);
      const attributeNames = [...Object.keys(node.attributes ?? {}), ...Object.keys(node.resourceAttributes ?? {})].sort();
      return Object.freeze({
        id: node.id,
        index: node.index,
        parent,
        sibling: element.parentNode?.childNodes?.indexOf?.(element) ?? node.sibling,
        namespace: element.namespaceURI ?? node.namespace,
        name: element.localName,
        classes: Object.freeze(classesOf(element)),
        attributes: Object.freeze(Object.fromEntries(attributeNames.map((name) => [name, normalized(element.getAttribute(name), urls)]))),
        styles: Object.freeze(captureStyles(element)),
      });
    })),
  });
}

export async function mountConformanceDom(result, host, options = {}) {
  const phases = createLifecycle(options.onLifecyclePhase);
  let ownerDocument;
  let win;
  let urlApi;
  let BlobClass;
  let restoreHost = null;
  let hostMutated = false;
  let mounted = null;
  let boundTargets = null;
  let presentationRuntime = null;
  let playback = null;
  let effects = null;
  let interaction = null;
  let orbit = null;
  let pagedState = null;
  let compositorTiming = null;
  let input = null;
  let resizeObserver = null;
  let request = null;
  let timer = null;
  let reschedule = null;
  let mode = null;
  const animateEnabled = options.animate !== false;
  const urls = new Map();
  const styles = [];

  const cleanup = () => {
    if (phases.phase === "destroy") return false;
    const attempt = (operation) => { try { operation?.(); } catch {} };
    if (timer !== null) attempt(() => win?.clearTimeout(timer));
    if (request !== null) attempt(() => win?.cancelAnimationFrame(request));
    timer = null;
    request = null;
    attempt(() => resizeObserver?.disconnect());
    attempt(() => input?.destroy());
    attempt(() => interaction?.destroy());
    attempt(() => effects?.destroy());
    attempt(() => orbit?.destroy());
    attempt(() => pagedState?.destroy());
    attempt(() => compositorTiming?.destroy());
    interaction = null;
    orbit = null;
    pagedState = null;
    compositorTiming = null;
    for (const element of styles) attempt(() => element.remove());
    for (const url of urls.values()) attempt(() => urlApi?.revokeObjectURL(url));
    if (hostMutated) attempt(restoreHost);
    phases.destroy();
    return true;
  };
  const assertPublished = () => {
    invariant(phases.phase !== "destroy", "MOUNT_DESTROYED", "The conformance mount is destroyed.");
    phases.assertPublished();
  };

  try {
    aborted(options.signal);
    invariant(result && typeof result === "object" && result.document && result.resourceBytes instanceof Map, "LIFECYCLE_PRECONDITION", "The conformance viewer requires a browser reader result.");
    const document = result.document;
    const resourceBytes = new Map([...result.resourceBytes].map(([id, value]) => [id, bytes(value, `Resource ${id}`).slice()]));
    invariant(document.meta.format === "domformat@0" && document.meta.profile === "polycss-3d@0", "UNSUPPORTED_PROFILE", "The conformance viewer supports only domformat@0/polycss-3d@0.");
    for (const capability of document.meta.capabilities) invariant(KNOWN_CAPABILITIES.has(capability), "UNSUPPORTED_REQUIRED_CAPABILITY", `Required capability ${capability} is unsupported.`);
    mode = options.mode ?? document.meta.initialExperience ?? "animation";
    invariant(mode === "animation" || mode === "interaction", "INVALID_EXPERIENCE_MODE", "Mode must be animation or interaction.");
    const interpreters = new Set(document.bindings.channels.map((channel) => channel.interpreter));
    invariant(REQUIRED_INTERPRETERS.every((name) => interpreters.has(name)), "UNSUPPORTED_MOUNT_CONTRACT", "Executable static presentation is required.");
    if (mode === "interaction") invariant(interpreters.has("polycss-pointer-grab@0"), "UNSUPPORTED_MOUNT_CONTRACT", "Interaction mode requires the pointer-grab interpreter.");
    const eagerRecords = document.resources.resources.filter((record) => record.kind !== "state-page");
    invariant(eagerRecords.every((record) => resourceBytes.has(record.id)), "RESOURCE_CARDINALITY_MISMATCH", "An eager resource is absent from the reader result.");
    invariant([...resourceBytes.keys()].every((id) => document.resources.resources.some((record) => record.id === id)), "RESOURCE_CARDINALITY_MISMATCH", "The reader result contains an undeclared resource.");
    for (const record of document.resources.resources) {
      if (record.kind === "state-page") continue;
      const value = resourceBytes.get(record.id);
      invariant(value && value.byteLength === record.byteLength, "RESOURCE_SIZE_MISMATCH", `Resource ${record.id} has the wrong length.`);
      invariant(await digestHex(value) === record.digest.value, "RESOURCE_DIGEST_MISMATCH", `Resource ${record.id} has the wrong digest.`);
      aborted(options.signal);
    }
    phases.advance("validate");

    ownerDocument = host?.ownerDocument;
    win = ownerDocument?.defaultView;
    invariant(ownerDocument && win && typeof host?.replaceChildren === "function", "INVALID_DOCUMENT_HOST", "A connected browser host is required.");
    urlApi = win.URL ?? globalThis.URL;
    BlobClass = win.Blob ?? globalThis.Blob;
    invariant(typeof urlApi?.createObjectURL === "function" && typeof urlApi?.revokeObjectURL === "function" && typeof BlobClass === "function", "MISSING_BROWSER_API", "Object URL and Blob support are required.");
    restoreHost = captureHost(host);
    const surface = ownerDocument.createElement("div");
    surface.setAttribute("data-domformat-instance", `c${(scopeSequence++).toString(36)}`);
    mounted = constructTree(ownerDocument, surface, document.tree);
    boundary(surface);
    phases.advance("construct");

    for (const record of document.resources.resources) {
      if (record.kind === "image") urls.set(record.id, urlApi.createObjectURL(new BlobClass([resourceBytes.get(record.id)], { type: record.mediaType })));
    }
    await decodeImages(document, resourceBytes, win, BlobClass, options.signal);
    aborted(options.signal);
    bindResources(mounted, urls);
    const runtimeSelector = `[data-domformat-instance=${JSON.stringify(surface.getAttribute("data-domformat-instance"))}]`;
    for (const binding of document.cssBinding.stylesheets) {
      const element = ownerDocument.createElement("style");
      element.dataset.domformatStylesheet = binding.id;
      const css = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(resourceBytes.get(binding.resource));
      element.textContent = closedCss(css, binding, urls, runtimeSelector);
      ownerDocument.head.appendChild(element);
      styles.push(element);
    }
    const variantCss = preparedVariantCss(document, runtimeSelector);
    if (variantCss) {
      const element = ownerDocument.createElement("style");
      element.dataset.domformatStylesheet = "prepared-variants";
      element.textContent = variantCss;
      ownerDocument.head.appendChild(element);
      styles.push(element);
    }
    boundTargets = bindChannels(document.bindings, mounted);
    phases.advance("bind");

    const materialized = materializePolycssState(document.state);
    presentationRuntime = createStaticPresentation(document.bindings, mounted, { ...options, boundTargets });
    const loadStatePage = async (record, signal) => {
      aborted(signal);
      if (typeof result.loadStatePage === "function") return result.loadStatePage(record, signal);
      const loaded = await options.loadStatePage?.(record, signal);
      aborted(signal);
      invariant(loaded !== undefined, "MISSING_EXTERNAL_RESOURCE", `State page ${record.id} is unavailable.`);
      const encoded = bytes(loaded, `State page ${record.id}`).slice();
      invariant(encoded.length === record.byteLength, "RESOURCE_SIZE_MISMATCH", `State page ${record.id} has the wrong encoded length.`);
      invariant(await digestHex(encoded) === record.digest.value, "RESOURCE_DIGEST_MISMATCH", `State page ${record.id} has the wrong encoded digest.`);
      return decodeStatePage(record, encoded, signal);
    };
    pagedState = createPolycssPagedState(document, mounted, DEFAULT_LIMITS, loadStatePage, {
      boundTargets,
      onLateFailure: cleanup,
    });
    await pagedState?.prepareInitial(options.signal);
    compositorTiming = createPolycssCompositorTiming(document.state, document.bindings, materialized, mounted, { boundTargets });
    playback = createPolycssPlayback(materialized, document.bindings, mounted, {
      ...options,
      boundTargets,
      publishAppearance: presentationRuntime.publishAppearance,
      pagedState,
      assertPagedFrameReady: (frame) => pagedState?.assertFrameReady(frame),
      compositorTiming,
    });
    effects = interpreters.has("polycss-effects@0")
      ? createPolycssEffects(materialized, document.bindings, mounted, { boundTargets })
      : null;
    const publishEffects = (frame, selected = null) => {
      if (selected) effects?.publish(frame, selected);
      else if (effects && effects.sourceFrame !== frame) effects.publish(frame);
      return frame;
    };
    const applyResponsivePlaybackProfile = () => {
      presentationRuntime.resize();
      const changed = playback.selectProfileTimeline(presentationRuntime.profileId);
      if (changed && mode === "animation") {
        const frame = publishEffects(playback.restart());
        reschedule?.();
        pagedState?.resetPreload(frame);
      }
      playback.applyViewportProfile(
        surface.clientWidth || options.viewportWidth || presentationRuntime.sourceWidth,
        surface.clientHeight || options.viewportHeight || presentationRuntime.sourceHeight,
        presentationRuntime.profileId,
      );
    };
    orbit = createPolycssOrbitInput(document.state, document.bindings, mounted, { boundTargets });
    input = interpreters.has("polycss-pointer-grab@0")
      ? createInteractionInput(host, surface, presentationRuntime, options)
      : null;
    const makeInteraction = () => createPolycssInteraction(materialized, document.bindings, mounted, playback, {
      ...options,
      boundTargets,
      presentation: presentationRuntime,
    });
    if (mode === "interaction") interaction = makeInteraction();
    const ResizeObserverClass = win.ResizeObserver;
    resizeObserver = typeof ResizeObserverClass === "function"
      ? new ResizeObserverClass(() => {
          if (phases.history.at(-1) !== "publish") return;
          try {
            applyResponsivePlaybackProfile();
          } catch { cleanup(); }
        })
      : null;
    phases.advance("initialize");
    phases.begin("publish");

    presentationRuntime.resize();
    playback.selectProfileTimeline(presentationRuntime.profileId);
    playback.publishInitial();
    compositorTiming?.publishInitial(playback.tick);
    compositorTiming?.setActive(mode === "animation" && animateEnabled);
    orbit?.publishInitial();
    playback.applyViewportProfile(
      surface.clientWidth || options.viewportWidth || presentationRuntime.sourceWidth,
      surface.clientHeight || options.viewportHeight || presentationRuntime.sourceHeight,
      presentationRuntime.profileId,
    );
    if (mode === "interaction") {
      const binding = document.bindings.channels.find((channel) => channel.interpreter === "polycss-pointer-grab@0");
      pagedState?.assertFrameReady(binding.parameters.initialFrame);
      playback.seek(binding.parameters.initialFrame);
      input?.setEnabled(true);
    } else input?.setEnabled(false);
    effects?.publish(playback.sourceFrame);
    if (mode === "interaction") {
      invariant(interaction, "MISSING_POLYCSS_BINDING", "Interaction mode did not initialize its interpreter.");
      interaction.publishInitial();
    }
    hostMutated = true;
    if (interpreters.has("polycss-pointer-grab@0") && !host.hasAttribute("tabindex")) host.setAttribute("tabindex", "0");
    host.replaceChildren(surface);
    pagedState?.preloadAfter(playback.sourceFrame);
    applyResponsivePlaybackProfile();
    resizeObserver?.observe(host);

    const publishEffectFrames = (frames) => {
      effects?.publishMany(frames);
      return frames.at(-1);
    };
    const stepInteraction = (sample = input?.sample()) => {
      assertPublished();
      invariant(interaction, "INVALID_EXPERIENCE_MODE", "Interaction mode is not active.");
      pagedState?.assertFrameReady(interaction.inspect().sourceFrame);
      const frame = interaction.step(sample);
      publishEffects(frame.sourceFrame, frame.selectedId && frame.selectedMatrix
        ? { active: true, x: frame.selectedMatrix[12], y: frame.selectedMatrix[13], z: frame.selectedMatrix[14] }
        : { active: false, x: 0, y: 0, z: 0 });
      pagedState?.preloadAfter(frame.sourceFrame);
      return frame;
    };
    const playbackBinding = document.bindings.channels.find((channel) => channel.interpreter === "polycss-playback@0" || channel.interpreter === "polycss-paged-playback@0");
    if (animateEnabled && playbackBinding) {
      invariant(
        typeof win.requestAnimationFrame === "function"
        && typeof win.cancelAnimationFrame === "function"
        && typeof win.setTimeout === "function"
        && typeof win.clearTimeout === "function",
        "MISSING_BROWSER_API",
        "Deadline timers and animation-frame support are required.",
      );
      const now = () => win.performance?.now?.() ?? globalThis.performance.now();
      let clockOrigin = now();
      let pageWait = null;
      const cancelScheduled = () => {
        if (timer !== null) win.clearTimeout(timer);
        if (request !== null) win.cancelAnimationFrame(request);
        timer = null;
        request = null;
      };
      const schedule = () => {
        if (phases.phase === "destroy" || pageWait || timer !== null || request !== null) return;
        timer = win.setTimeout(() => {
          timer = null;
          if (phases.phase !== "destroy") request = win.requestAnimationFrame(loop);
        }, Math.max(0, clockOrigin + playback.tickSpan(1) - now() - 1));
      };
      const waitForPage = (frame, resume) => {
        invariant(pagedState && !pagedState.isFrameReady(frame), "INVALID_PLAYBACK_PUBLICATION", "Paged playback wait requires a nonresident target frame.");
        const wait = pagedState.ensureFrame(frame);
        pageWait = wait;
        void wait.then(() => {
          if (pageWait !== wait || phases.phase === "destroy") return;
          pageWait = null;
          try {
            resume();
          } catch {
            cleanup();
            return;
          }
          if (phases.phase !== "destroy") {
            clockOrigin = now();
            schedule();
          }
        }, (error) => {
          if (pageWait !== wait || phases.phase === "destroy") return;
          pageWait = null;
          if (error?.code !== "OPERATION_ABORTED") cleanup();
        });
      };
      const drainPlaybackCatchUp = (count) => {
        let ready = count;
        if (pagedState) {
          ready = 0;
          while (ready < count && pagedState.isFrameReady(playback.frameAfter(ready + 1))) ready += 1;
        }
        if (ready === 1) {
          const frame = publishEffects(playback.advance());
          pagedState?.preloadAfter(frame);
        } else if (ready > 1) {
          const frame = publishEffectFrames(playback.advanceMany(ready));
          pagedState?.preloadAfter(frame);
        }
        const remaining = count - ready;
        if (remaining === 0) return;
        const frame = playback.frameAfter(1);
        const tick = playback.tick;
        const sourceFrame = playback.sourceFrame;
        waitForPage(frame, () => {
          if (mode === "animation" && playback.tick === tick && playback.sourceFrame === sourceFrame) drainPlaybackCatchUp(remaining);
        });
      };
      const drainPlaybackCollapsed = (count) => {
        const frame = playback.frameAfter(count);
        if (pagedState && !pagedState.isFrameReady(frame)) {
          const tick = playback.tick;
          const sourceFrame = playback.sourceFrame;
          waitForPage(frame, () => {
            if (mode === "animation" && playback.tick === tick && playback.sourceFrame === sourceFrame) drainPlaybackCollapsed(count);
          });
          return;
        }
        const nextFrame = publishEffects(playback.advanceCollapsed(count));
        pagedState?.preloadAfter(nextFrame);
      };
      const drainInteractionCatchUp = (count) => {
        let remaining = count;
        while (remaining > 0) {
          invariant(interaction, "INVALID_EXPERIENCE_MODE", "Interaction mode is not active.");
          const activeInteraction = interaction;
          const frame = activeInteraction.inspect().sourceFrame;
          if (pagedState && !pagedState.isFrameReady(frame)) {
            const ticks = activeInteraction.ticks;
            waitForPage(frame, () => {
              if (mode === "interaction" && interaction === activeInteraction && activeInteraction.ticks === ticks) drainInteractionCatchUp(remaining);
            });
            return;
          }
          stepInteraction();
          remaining -= 1;
        }
      };
      const loop = (timestamp) => {
        request = null;
        if (phases.phase === "destroy") return;
        try {
          const policy = playbackBinding.parameters.catchUpPolicy ?? "bounded";
          const maximum = policy === "elapsed" ? Number.MAX_SAFE_INTEGER - playback.tick : MAX_CATCH_UP_TICKS + 1;
          let due = playback.ticksWithin(Math.max(0, timestamp - clockOrigin + 0.5), maximum);
          let resetClock = false;
          if (policy === "single-step" && due > 0) {
            due = 1;
            resetClock = true;
          } else if (policy === "bounded" && due > MAX_CATCH_UP_TICKS) {
            due = 1;
            resetClock = true;
          }
          const elapsed = due > 0 ? playback.tickSpan(due) : 0;
          if (mode === "interaction") {
            drainInteractionCatchUp(due);
            if (pageWait) return;
          } else if (due > 0) {
            if (policy === "elapsed") drainPlaybackCollapsed(due);
            else drainPlaybackCatchUp(due);
            if (pageWait) return;
          }
          if (due > 0) clockOrigin = resetClock ? timestamp : clockOrigin + elapsed;
        } catch (error) {
          cleanup();
          throw error;
        }
        schedule();
      };
      reschedule = () => {
        if (pageWait) {
          pageWait = null;
          pagedState?.cancelPending();
        }
        cancelScheduled();
        clockOrigin = now();
        schedule();
      };
      schedule();
    }
    phases.advance("publish");

    return Object.freeze({
      lifecycle: phases.view,
      get mode() { return mode; },
      get sourceFrame() { assertPublished(); return playback.sourceFrame; },
      get bankId() { assertPublished(); return playback.bankId; },
      advance() {
        assertPublished();
        invariant(mode === "animation", "INVALID_EXPERIENCE_MODE", "Animation mode is not active.");
        const frame = publishEffects(playback.advance());
        pagedState?.preloadAfter(frame);
        return frame;
      },
      seek(frame) {
        assertPublished();
        pagedState?.assertFrameReady(frame);
        const nextFrame = publishEffects(playback.seek(frame));
        reschedule?.();
        pagedState?.preloadAfter(nextFrame);
        interaction?.invalidatePublication();
        return nextFrame;
      },
      async seekAsync(frame) {
        assertPublished();
        try {
          await pagedState?.ensureFrame(frame);
          const nextFrame = publishEffects(playback.seek(frame));
          reschedule?.();
          pagedState?.preloadAfter(nextFrame);
          interaction?.invalidatePublication();
          return nextFrame;
        } catch (error) {
          if (error?.code !== "OPERATION_ABORTED") cleanup();
          throw error;
        }
      },
      selectBank(id) {
        assertPublished();
        invariant(mode === "animation", "INVALID_EXPERIENCE_MODE", "Prepared banks can be selected only in animation mode.");
        const frame = playback.bankEntryFrame(id);
        pagedState?.assertFrameReady(frame);
        const nextFrame = publishEffects(playback.selectBank(id));
        pagedState?.setActiveFramePin(nextFrame);
        reschedule?.();
        pagedState?.resetPreload(nextFrame);
        interaction?.invalidatePublication();
        return nextFrame;
      },
      async selectBankAsync(id) {
        assertPublished();
        invariant(mode === "animation", "INVALID_EXPERIENCE_MODE", "Prepared banks can be selected only in animation mode.");
        const frame = playback.bankEntryFrame(id);
        try {
          await pagedState?.ensureFrame(frame);
          const nextFrame = publishEffects(playback.selectBank(id));
          pagedState?.setActiveFramePin(nextFrame);
          reschedule?.();
          pagedState?.resetPreload(nextFrame);
          interaction?.invalidatePublication();
          return nextFrame;
        } catch (error) {
          if (error?.code !== "OPERATION_ABORTED") cleanup();
          throw error;
        }
      },
      stepInteraction,
      setInput(id, value) {
        assertPublished();
        invariant(orbit, "UNKNOWN_EXTERNAL_INPUT", `External input ${String(id)} is unsupported by this document.`);
        return orbit.setInput(id, value);
      },
      snapshot() { assertPublished(); return snapshotTree(mounted, urls); },
      node(id) { assertPublished(); return mounted.byId.get(id); },
      setMode(next) {
        assertPublished();
        invariant(next === "animation" || next === "interaction", "INVALID_EXPERIENCE_MODE", "Mode must be animation or interaction.");
        if (next === mode) return mode;
        try {
          if (next === "interaction") {
            const binding = document.bindings.channels.find((channel) => channel.interpreter === "polycss-pointer-grab@0");
            invariant(binding, "MISSING_POLYCSS_BINDING", "The pointer interaction binding is absent.");
            const candidate = makeInteraction();
            try {
              playback.seek(binding.parameters.initialFrame);
              publishEffects(playback.sourceFrame);
              input?.setEnabled(true);
              candidate.publishInitial();
            } catch (error) {
              candidate.destroy();
              throw error;
            }
            interaction = candidate;
          } else {
            input?.setEnabled(false);
            const modified = interaction?.restore() ?? { shapeIndices: [], leafIndices: [] };
            interaction?.destroy();
            interaction = null;
            publishEffects(playback.restart(modified.shapeIndices, modified.leafIndices));
          }
          mode = next;
          compositorTiming?.setActive(next === "animation" && animateEnabled);
          reschedule?.();
          pagedState?.resetPreload(playback.sourceFrame);
          return mode;
        } catch (error) {
          cleanup();
          throw error;
        }
      },
      destroy: cleanup,
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}
