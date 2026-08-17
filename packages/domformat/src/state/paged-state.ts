import { invariant } from "../errors.js";
import { pagedPlaybackLiveRowCeiling, pagedPlaybackPublicationWorkspaceBytes, pagedVariantPublicationWorkspaceBytes, statePageValidationWorkspaceBytes, validatePagedPlaybackBoundaryFromCanonical, validatePagedPlaybackPageBytesAsync, validatePagedVariantPageBytes, type DecodedPagedPlaybackPage, type DecodedPagedVariantPage, type DecodedStatePage } from "../state-pages.js";
import type { DomBindingChannel, DomDocument, DomPagedPlaybackPageDescriptor, DomPagedVariantPageDescriptor, DomResourceRecord, DomStateChannel } from "../public-types.js";
import type { DomLimits } from "../constants.js";
import type { MountedTree } from "../retained-dom.js";

interface PagedPlaybackPacket {
  readonly shapeCount: number;
  readonly leafCount: number;
  readonly appearances: readonly (readonly [string, number, number])[];
  readonly initial: Readonly<{ sourceFrame: number; appearance: number }>;
  readonly pages: readonly DomPagedPlaybackPageDescriptor[];
  readonly lookaheadPages: number;
  readonly maxResidentPages: number;
}

interface PagedVariantPacket {
  readonly frameCount: number;
  readonly classes: readonly string[];
  readonly initial: Readonly<{ frame: number; classIndicesBase64: string }>;
  readonly pages: readonly DomPagedVariantPageDescriptor[];
  readonly lookaheadPages: number;
  readonly maxResidentPages: number;
}

type PagePacket = Pick<PagedPlaybackPacket | PagedVariantPacket, "pages" | "lookaheadPages" | "maxResidentPages">;
type StatePageBytesLoader = (record: DomResourceRecord, signal?: AbortSignal) => Promise<Uint8Array>;

export interface PagedPlaybackStage {
  readonly frame: number;
  readonly complete: boolean;
  readonly appearance: number;
  readonly modelTransform?: string;
  readonly shapeTargets: Uint32Array;
  readonly shapeTransforms: readonly string[];
  readonly shapeVisibility: Uint8Array;
  readonly leafTargets: Uint32Array;
  readonly leafTransforms: readonly string[];
}

export interface PagedVariantStage {
  readonly frame: number;
  readonly complete: boolean;
  readonly targets: Uint16Array;
  readonly classes: Uint16Array;
}

export interface PagedStateStage {
  readonly frame: number;
  readonly playback: PagedPlaybackStage | null;
  readonly variants: PagedVariantStage | null;
}

export interface PagedPlaybackCanonical {
  readonly frame: number;
  readonly appearance: number;
  readonly modelTransform: string;
  readonly shapeTransforms: readonly string[];
  readonly shapeVisibility: Uint8Array;
  readonly leafTransforms: readonly string[];
}

export interface PolycssPagedState {
  readonly hasPlayback: boolean;
  readonly hasVariants: boolean;
  readonly residentResources: readonly string[];
  readonly peakResidentPages: number;
  readonly peakDecodedBytes: number;
  readonly peakMaterializedBytes: number;
  readonly peakDocumentStateBytes: number;
  readonly frame: number;
  readonly activeFramePin: number;
  readonly initialPlayback: PagedPlaybackCanonical | null;
  prepareInitial(signal?: AbortSignal): Promise<void>;
  ensureFrame(frame: number, signal?: AbortSignal): Promise<void>;
  isFrameReady(frame: number): boolean;
  assertFrameReady(frame: number): void;
  stage(frame: number, includePlayback?: boolean): PagedStateStage;
  commit(stage: PagedStateStage, publishVariants?: boolean): number;
  publishVariants(frame: number): number;
  setActiveFramePin(frame: number): void;
  preloadAfter(frame: number): void;
  cancelPending(): void;
  resetPreload(frame: number): void;
  destroy(): boolean;
}

function uint16(value: string): Uint16Array {
  const binary = globalThis.atob(value);
  invariant(binary.length % 2 === 0, "TRUNCATED_VARIANTS", "Paged variant initial row is truncated.");
  return Uint16Array.from({ length: binary.length / 2 }, (_, index) => binary.charCodeAt(index * 2) | (binary.charCodeAt(index * 2 + 1) << 8));
}

function pageIndex(packet: PagePacket, frame: number): number {
  return packet.pages.findIndex((page) => frame >= page.startFrame && frame <= page.endFrame);
}

function pageAt<T extends PagePacket>(packet: T, frame: number): T["pages"][number] {
  const descriptor = packet.pages[pageIndex(packet, frame)];
  invariant(descriptor, "FRAME_RANGE", `Prepared frame ${frame} has no state page.`);
  return descriptor;
}

function contract<T>(document: DomDocument, codec: string, interpreter: string): Readonly<{ state: DomStateChannel; binding: DomBindingChannel; packet: T }> | null {
  const state = document.state.channels.find((channel) => channel.codec === codec);
  if (!state) return null;
  const binding = document.bindings.channels.find((channel) => channel.interpreter === interpreter);
  invariant(binding, "MISSING_POLYCSS_BINDING", `${interpreter} requires a matching binding.`);
  return Object.freeze({ state, binding, packet: (state.data as unknown as { readonly packet: T }).packet });
}

function transformLiveBytes(playback: PagedPlaybackCanonical | null, variants: Uint16Array | null, publishedVariants: Uint16Array | null): number {
  if (!playback) return (variants?.byteLength ?? 0) + (publishedVariants?.byteLength ?? 0);
  let total = 8 + playback.modelTransform.length * 2 + playback.shapeVisibility.byteLength + (variants?.byteLength ?? 0) + (publishedVariants?.byteLength ?? 0);
  for (const transform of playback.shapeTransforms) total += 8 + transform.length * 2;
  for (const transform of playback.leafTransforms) total += 8 + transform.length * 2;
  return total;
}

function playbackCanonical(page: DecodedPagedPlaybackPage, frame: number): PagedPlaybackCanonical {
  const localTarget = frame - page.startFrame;
  let appearance = page.keyframe.appearance;
  let modelTransform = page.transforms[page.keyframe.modelTransform];
  const shapeTransforms = Array.from(page.keyframe.shapeTransforms, (index) => page.transforms[index]);
  const shapeVisibility = page.keyframe.shapeVisibility.slice();
  const leafTransforms = Array.from(page.keyframe.leafTransforms, (index) => page.transforms[index]);
  for (let local = 1; local <= localTarget; local += 1) {
    appearance = page.appearances[local];
    if (page.modelTransforms[local] !== 0xffffffff) modelTransform = page.transforms[page.modelTransforms[local]];
    for (let cursor = page.shapeOffsets[local]; cursor < page.shapeOffsets[local + 1]; cursor += 1) {
      const target = page.shapeTargets[cursor];
      shapeTransforms[target] = page.transforms[page.shapeTransforms[cursor]];
      shapeVisibility[target] = page.shapeVisibility[cursor];
    }
    for (let cursor = page.leafOffsets[local]; cursor < page.leafOffsets[local + 1]; cursor += 1) {
      const target = page.leafTargets[cursor];
      leafTransforms[target] = page.transforms[page.leafTransforms[cursor]];
    }
  }
  return Object.freeze({ frame, appearance, modelTransform, shapeTransforms: Object.freeze(shapeTransforms), shapeVisibility, leafTransforms: Object.freeze(leafTransforms) });
}

function playbackFullStage(page: DecodedPagedPlaybackPage, frame: number): PagedPlaybackStage {
  const row = playbackCanonical(page, frame);
  return Object.freeze({ frame, complete: true, appearance: row.appearance, modelTransform: row.modelTransform, shapeTargets: Uint32Array.from({ length: row.shapeTransforms.length }, (_, index) => index), shapeTransforms: row.shapeTransforms, shapeVisibility: row.shapeVisibility, leafTargets: Uint32Array.from({ length: row.leafTransforms.length }, (_, index) => index), leafTransforms: row.leafTransforms });
}

function playbackSparseStage(page: DecodedPagedPlaybackPage, frame: number, local: number): PagedPlaybackStage {
  const model = page.modelTransforms[local];
  const shapeStart = page.shapeOffsets[local];
  const shapeEnd = page.shapeOffsets[local + 1];
  const leafStart = page.leafOffsets[local];
  const leafEnd = page.leafOffsets[local + 1];
  return Object.freeze({
    frame,
    complete: false,
    appearance: page.appearances[local],
    ...(model === 0xffffffff ? {} : { modelTransform: page.transforms[model] }),
    shapeTargets: page.shapeTargets.slice(shapeStart, shapeEnd),
    shapeTransforms: Object.freeze(Array.from(page.shapeTransforms.subarray(shapeStart, shapeEnd), (index) => page.transforms[index])),
    shapeVisibility: page.shapeVisibility.slice(shapeStart, shapeEnd),
    leafTargets: page.leafTargets.slice(leafStart, leafEnd),
    leafTransforms: Object.freeze(Array.from(page.leafTransforms.subarray(leafStart, leafEnd), (index) => page.transforms[index])),
  });
}

function variantRow(page: DecodedPagedVariantPage, frame: number): Uint16Array {
  const row = page.keyframe.slice();
  for (let local = 1; local <= frame - page.startFrame; local += 1) for (let cursor = page.offsets[local]; cursor < page.offsets[local + 1]; cursor += 1) row[page.targets[cursor]] = page.classes[cursor];
  return row;
}

export function createPolycssPagedState(
  document: DomDocument,
  mounted: MountedTree,
  limits: DomLimits,
  load: StatePageBytesLoader,
  options: { readonly boundTargets?: ReadonlyMap<string, Readonly<{ targets: unknown }>>; readonly onLateFailure?: (error: unknown) => void } = {},
): PolycssPagedState | null {
  const playback = contract<PagedPlaybackPacket>(document, "polycss-paged-playback@0", "polycss-paged-playback@0");
  const variants = contract<PagedVariantPacket>(document, "polycss-paged-variants@0", "polycss-paged-variants@0");
  if (!playback && !variants) return null;
  const packets = [playback?.packet, variants?.packet].filter((packet): packet is PagedPlaybackPacket | PagedVariantPacket => Boolean(packet));
  const maxResidentPages = packets[0].maxResidentPages;
  invariant(packets.every((packet) => packet.maxResidentPages === maxResidentPages), "STATE_PAGE_RESIDENCY_LIMIT", "Paged state channels must share one resident-page ceiling.");
  const records = new Map(document.resources.resources.map((record): [string, DomResourceRecord] => [record.id, record]));
  const descriptors = new Map<string, { readonly packet: PagePacket; readonly descriptor: DomPagedPlaybackPageDescriptor | DomPagedVariantPageDescriptor; readonly channel: string; readonly kind: "playback" | "variants" }>();
  if (playback) for (const descriptor of playback.packet.pages) descriptors.set(descriptor.resource, { packet: playback.packet, descriptor, channel: playback.state.id, kind: "playback" });
  if (variants) for (const descriptor of variants.packet.pages) descriptors.set(descriptor.resource, { packet: variants.packet, descriptor, channel: variants.state.id, kind: "variants" });
  const playbackInitial = playback?.packet.initial.sourceFrame ?? Number((document.state.channels.find((channel) => channel.codec === "polycss-playback-packed@0")?.data.packet as { readonly initial?: { readonly sourceFrame?: number } } | undefined)?.initial?.sourceFrame ?? 1);
  const interactionFrame = Number((document.bindings.channels.find((channel) => channel.interpreter === "polycss-pointer-grab@0")?.parameters as { readonly initialFrame?: number } | undefined)?.initialFrame ?? playbackInitial);
  const fixedPins = [...new Set([playbackInitial, interactionFrame])];
  let activeFramePin = playbackInitial;
  const variantIds = variants ? (variants.binding.targets as unknown as { readonly nodes: readonly string[] }).nodes : [];
  const variantBound = variants ? options.boundTargets?.get(variants.binding.id)?.targets as { readonly nodes?: readonly HTMLElement[] } | undefined : undefined;
  const variantNodes = (variantBound?.nodes ?? variantIds.map((id) => mounted.byId.get(id))) as readonly HTMLElement[];
  invariant(variantNodes.every(Boolean), "MISSING_TARGET_NODE", "Paged variant targets are not mounted.");
  const playbackTargets = playback ? playback.binding.targets as unknown as { readonly model: string; readonly shapes: readonly string[]; readonly leaves: readonly string[] } : null;
  const playbackBound = playback ? options.boundTargets?.get(playback.binding.id)?.targets as { readonly model?: HTMLElement; readonly shapes?: readonly HTMLElement[]; readonly leaves?: readonly HTMLElement[] } | undefined : undefined;
  const playbackModel = playbackTargets ? playbackBound?.model ?? mounted.byId.get(playbackTargets.model) : undefined;
  const playbackShapes = playbackTargets ? (playbackBound?.shapes ?? playbackTargets.shapes.map((id) => mounted.byId.get(id))) as readonly HTMLElement[] : [];
  const playbackLeaves = playbackTargets ? (playbackBound?.leaves ?? playbackTargets.leaves.map((id) => mounted.byId.get(id))) as readonly HTMLElement[] : [];
  invariant(!playback || (playbackModel && playbackShapes.every(Boolean) && playbackLeaves.every(Boolean)), "MISSING_TARGET_NODE", "Paged playback targets are not mounted.");
  const transformProbe = playbackModel?.ownerDocument.createElement("div");
  const cssTransform = (value: string): string => {
    invariant(transformProbe, "MISSING_TARGET_NODE", "Paged playback has no mounted transform target.");
    transformProbe.style.transform = value;
    return transformProbe.style.transform;
  };
  let currentVariants = variants ? uint16(variants.packet.initial.classIndicesBase64) : null;
  let publishedVariants = currentVariants?.slice() ?? null;
  let variantFrame = variants?.packet.initial.frame ?? playbackInitial;
  let currentPlayback: PagedPlaybackCanonical | null = null;
  let resident = new Map<string, DecodedStatePage>();
  let controller: AbortController | null = null;
  let generation = 0;
  let destroyed = false;
  let peakResidentPages = 0;
  let peakDecodedBytes = 0;
  let peakMaterializedBytes = 0;
  let peakDocumentStateBytes = 0;

  const liveBytes = () => transformLiveBytes(currentPlayback, currentVariants, publishedVariants);
  const residentMaterialized = () => [...resident.values()].reduce((total, page) => total + page.materializedByteLength, 0);
  const measure = (validationBytes = 0, transientMaterialized = 0, incomingPage = false, incomingMaterialized = 0): void => {
    const decoded = validationBytes;
    const residentBytes = residentMaterialized();
    const materialized = residentBytes + transientMaterialized + incomingMaterialized;
    const total = decoded + residentBytes + transientMaterialized + liveBytes();
    peakResidentPages = Math.max(peakResidentPages, resident.size + (incomingPage ? 1 : 0));
    peakDecodedBytes = Math.max(peakDecodedBytes, decoded);
    peakMaterializedBytes = Math.max(peakMaterializedBytes, materialized);
    peakDocumentStateBytes = Math.max(peakDocumentStateBytes, total);
    invariant(total <= limits.maxAggregateDecodedBytes, "STATE_PAGE_RESIDENCY_LIMIT", "Paged state validation, materialization, residency, and live rows exceed the document-wide byte ceiling.");
  };
  const desiredResources = (frame: number, includeLookahead = true): string[] => {
    const resources = new Set<string>();
    const currentPages = packets.map((packet) => {
      const current = pageIndex(packet, frame);
      invariant(current >= 0, "FRAME_RANGE", `Prepared frame ${frame} has no state page.`);
      resources.add(packet.pages[current].resource);
      return current;
    });
    for (const pin of new Set([...fixedPins, activeFramePin])) for (const packet of packets) resources.add(pageAt(packet, pin).resource);
    if (playback && currentPlayback) resources.add(pageAt(playback.packet, currentPlayback.frame).resource);
    if (variants) resources.add(pageAt(variants.packet, variantFrame).resource);
    if (includeLookahead) for (let offset = 1; offset <= Math.max(...packets.map((packet) => packet.lookaheadPages)); offset += 1) {
      for (let index = 0; index < packets.length; index += 1) {
        const packet = packets[index];
        if (offset <= packet.lookaheadPages) resources.add(packet.pages[(currentPages[index] + offset) % packet.pages.length].resource);
      }
    }
    invariant(resources.size <= maxResidentPages, "STATE_PAGE_RESIDENCY_LIMIT", "Paged state desired window exceeds its document-wide resident-page ceiling.");
    return [...resources];
  };
  const touch = (resource: string, page: DecodedStatePage) => { resident.delete(resource); resident.set(resource, page); };
  const loadPage = async (resource: string, protectedResources: ReadonlySet<string>, signal?: AbortSignal): Promise<DecodedStatePage> => {
    const cached = resident.get(resource);
    if (cached) { touch(resource, cached); return cached; }
    while (resident.size >= maxResidentPages) {
      const candidate = [...resident.keys()].find((entry) => !protectedResources.has(entry));
      invariant(candidate, "STATE_PAGE_RESIDENCY_LIMIT", "Paged state cannot reserve capacity without evicting a protected page.");
      resident.delete(candidate);
    }
    const owner = descriptors.get(resource);
    const record = records.get(resource);
    invariant(owner && record?.kind === "state-page" && record.decodedByteLength !== undefined, "MISSING_EXTERNAL_RESOURCE", `State page ${resource} is undeclared.`);
    const validationBytes = statePageValidationWorkspaceBytes(record.decodedByteLength, owner.descriptor.materializedByteLength);
    measure(validationBytes, 0, true, owner.descriptor.materializedByteLength);
    let bytes: Uint8Array;
    try {
      bytes = await load(record, signal);
    } catch (error) {
      if (signal?.aborted) invariant(false, "OPERATION_ABORTED", `State page ${resource} request was aborted.`);
      throw error;
    }
    invariant(!destroyed && !signal?.aborted, "OPERATION_ABORTED", `State page ${resource} request was aborted.`);
    const page = owner.kind === "playback"
      ? await validatePagedPlaybackPageBytesAsync(bytes, { ...(owner.descriptor as DomPagedPlaybackPageDescriptor), channel: owner.channel }, playback!.packet.shapeCount, playback!.packet.leafCount, playback!.packet.appearances.length, limits, signal)
      : validatePagedVariantPageBytes(bytes, { ...(owner.descriptor as DomPagedVariantPageDescriptor), channel: owner.channel }, variantNodes.length, variants!.packet.classes.length, limits);
    invariant(!destroyed && !signal?.aborted, "OPERATION_ABORTED", `State page ${resource} request was aborted.`);
    touch(resource, page);
    measure();
    invariant(resident.size <= maxResidentPages, "STATE_PAGE_RESIDENCY_LIMIT", "Paged state residency exceeded its document-wide page ceiling.");
    return page;
  };
  const loadWindow = async (frame: number, signal?: AbortSignal, includeLookahead = true): Promise<void> => {
    const desired = desiredResources(frame, includeLookahead);
    const protectedResources = new Set(desired);
    for (const resource of desired) await loadPage(resource, protectedResources, signal);
  };
  const startRequest = () => {
    controller?.abort();
    controller = new AbortController();
    generation += 1;
    return { id: generation, signal: controller.signal };
  };
  const ready = (frame: number): boolean => packets.every((packet) => resident.has(pageAt(packet, frame).resource));
  const playbackPage = (frame: number): DecodedPagedPlaybackPage => {
    const page = resident.get(pageAt(playback!.packet, frame).resource);
    invariant(page?.codec === "polycss-paged-playback-page@0", "STATE_PAGE_NOT_READY", `Paged playback frame ${frame} is not resident.`);
    return page;
  };
  const variantPage = (frame: number): DecodedPagedVariantPage => {
    const page = resident.get(pageAt(variants!.packet, frame).resource);
    invariant(page?.codec === "polycss-paged-variants-page@0", "STATE_PAGE_NOT_READY", `Paged variant frame ${frame} is not resident.`);
    return page;
  };
  const stagePlayback = (frame: number): PagedPlaybackStage | null => {
    if (!playback) return null;
    const page = playbackPage(frame);
    const expected = currentPlayback ? (currentPlayback.frame === playback.packet.pages.at(-1)!.endFrame ? 1 : currentPlayback.frame + 1) : -1;
    if (currentPlayback && frame === expected) {
      const local = frame - page.startFrame;
      if (local === 0) {
        validatePagedPlaybackBoundaryFromCanonical(currentPlayback, page);
      }
      return playbackSparseStage(page, frame, local);
    }
    return playbackFullStage(page, frame);
  };
  const stageVariants = (frame: number): PagedVariantStage | null => {
    if (!variants) return null;
    const page = variantPage(frame);
    const expected = variantFrame === variants.packet.frameCount ? 1 : variantFrame + 1;
    if (frame === expected && frame > page.startFrame) {
      const local = frame - page.startFrame;
      return Object.freeze({ frame, complete: false, targets: page.targets.slice(page.offsets[local], page.offsets[local + 1]), classes: page.classes.slice(page.offsets[local], page.offsets[local + 1]) });
    }
    const row = variantRow(page, frame);
    return Object.freeze({ frame, complete: true, targets: Uint16Array.from({ length: row.length }, (_, index) => index), classes: row });
  };
  const publishVariantRow = (): void => {
    invariant(currentVariants && publishedVariants && variants, "INVALID_VARIANT_PUBLICATION", "Paged variant row has no owner.");
    for (let index = 0; index < currentVariants.length; index += 1) {
      const value = currentVariants[index];
      const previous = publishedVariants[index];
      if (previous === value) continue;
      if (previous !== 0xffff) variantNodes[index].classList.remove(variants.packet.classes[previous]);
      if (value !== 0xffff) variantNodes[index].classList.add(variants.packet.classes[value]);
      publishedVariants[index] = value;
    }
  };
  const applyVariantStage = (stage: PagedVariantStage, publish: boolean): void => {
    invariant(currentVariants && variants, "INVALID_VARIANT_PUBLICATION", "Paged variant stage has no owner.");
    for (let cursor = 0; cursor < stage.targets.length; cursor += 1) {
      const index = stage.targets[cursor];
      const value = stage.classes[cursor];
      const previous = currentVariants[index];
      if (previous === value) continue;
      currentVariants[index] = value;
    }
    variantFrame = stage.frame;
    if (publish) publishVariantRow();
  };
  const applyPlaybackStage = (stage: PagedPlaybackStage): void => {
    invariant(playback, "INVALID_PLAYBACK_PUBLICATION", "Paged playback stage has no owner.");
    if (!currentPlayback || stage.complete) {
      invariant(stage.modelTransform !== undefined && stage.shapeTargets.length === playback.packet.shapeCount && stage.leafTargets.length === playback.packet.leafCount, "INVALID_PLAYBACK_PUBLICATION", "Complete paged playback stage is incomplete.");
      currentPlayback = Object.freeze({ frame: stage.frame, appearance: stage.appearance, modelTransform: stage.modelTransform, shapeTransforms: Object.freeze([...stage.shapeTransforms]), shapeVisibility: stage.shapeVisibility.slice(), leafTransforms: Object.freeze([...stage.leafTransforms]) });
      return;
    }
    const shapeTransforms = [...currentPlayback.shapeTransforms];
    const shapeVisibility = currentPlayback.shapeVisibility.slice();
    const leafTransforms = [...currentPlayback.leafTransforms];
    for (let cursor = 0; cursor < stage.shapeTargets.length; cursor += 1) { const target = stage.shapeTargets[cursor]; shapeTransforms[target] = stage.shapeTransforms[cursor]; shapeVisibility[target] = stage.shapeVisibility[cursor]; }
    for (let cursor = 0; cursor < stage.leafTargets.length; cursor += 1) leafTransforms[stage.leafTargets[cursor]] = stage.leafTransforms[cursor];
    currentPlayback = Object.freeze({ frame: stage.frame, appearance: stage.appearance, modelTransform: stage.modelTransform ?? currentPlayback.modelTransform, shapeTransforms: Object.freeze(shapeTransforms), shapeVisibility, leafTransforms: Object.freeze(leafTransforms) });
  };

  return Object.freeze({
    get hasPlayback() { return Boolean(playback); }, get hasVariants() { return Boolean(variants); },
    get residentResources() { return Object.freeze([...resident.keys()]); }, get peakResidentPages() { return peakResidentPages; }, get peakDecodedBytes() { return peakDecodedBytes; }, get peakMaterializedBytes() { return peakMaterializedBytes; }, get peakDocumentStateBytes() { return peakDocumentStateBytes; },
    get frame() { return currentPlayback?.frame ?? variantFrame; }, get activeFramePin() { return activeFramePin; }, get initialPlayback() { return currentPlayback; },
    async prepareInitial(signal?: AbortSignal) {
      invariant(!signal?.aborted, "OPERATION_ABORTED", "Paged state initial request was aborted.");
      const request = startRequest();
      const abort = () => { if (request.id === generation) controller?.abort(); };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await loadWindow(playbackInitial, request.signal, false);
        invariant(request.id === generation && !request.signal.aborted, "OPERATION_ABORTED", "Paged state initial request was superseded.");
        if (playback) {
          const initialPage = playbackPage(playback.packet.initial.sourceFrame);
          measure(0, pagedPlaybackLiveRowCeiling(initialPage.materializedByteLength, playback.packet.shapeCount, playback.packet.leafCount));
          const initial = playbackCanonical(initialPage, playback.packet.initial.sourceFrame);
          invariant(initial.appearance === playback.packet.initial.appearance, "STATE_PAGE_INITIAL_MISMATCH", "Paged playback initial page disagrees with its shell appearance.");
          const base = (playback.binding.parameters as unknown as { readonly baseSceneTransform: string }).baseSceneTransform;
          const expectedModel = initial.modelTransform === "" ? base : `${base} ${initial.modelTransform}`;
          invariant(playbackModel!.style.transform === cssTransform(expectedModel), "STATE_PAGE_INITIAL_MISMATCH", "Paged playback initial model transform disagrees with TREE.");
          for (let index = 0; index < playbackShapes.length; index += 1) invariant(playbackShapes[index].style.transform === cssTransform(initial.shapeTransforms[index]) && playbackShapes[index].style.visibility === (initial.shapeVisibility[index] === 1 ? "visible" : "hidden"), "STATE_PAGE_INITIAL_MISMATCH", `Paged playback initial shape ${index} disagrees with TREE.`);
          for (let index = 0; index < playbackLeaves.length; index += 1) invariant(playbackLeaves[index].style.transform === cssTransform(initial.leafTransforms[index]), "STATE_PAGE_INITIAL_MISMATCH", `Paged playback initial leaf ${index} disagrees with TREE.`);
          currentPlayback = initial;
        }
        if (variants) {
          const initial = variantRow(variantPage(variants.packet.initial.frame), variants.packet.initial.frame);
          invariant(initial.length === currentVariants!.length && initial.every((value, index) => value === currentVariants![index]), "STATE_PAGE_INITIAL_MISMATCH", "Paged variant initial page disagrees with its shell/TREE row.");
        }
        measure();
      } finally { signal?.removeEventListener("abort", abort); }
    },
    async ensureFrame(frame: number, signal?: AbortSignal) {
      invariant(Number.isSafeInteger(frame) && frame >= 1, "FRAME_RANGE", `Paged state frame ${frame} is invalid.`);
      invariant(!signal?.aborted, "OPERATION_ABORTED", `Paged state frame ${frame} request was aborted.`);
      const residentIds = [...resident.keys()];
      const request = startRequest();
      const abort = () => { if (request.id === generation) controller?.abort(); };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await loadWindow(frame, request.signal);
        invariant(request.id === generation && !request.signal.aborted, "OPERATION_ABORTED", "Paged state request was superseded.");
      } catch (error) {
        if (!destroyed && request.id === generation) {
          const restore = startRequest();
          try {
            const protectedResources = new Set(residentIds);
            for (const resource of residentIds) if (!resident.has(resource)) await loadPage(resource, protectedResources, restore.signal);
            for (const resource of [...resident.keys()]) if (!protectedResources.has(resource)) resident.delete(resource);
            const restored = new Map<string, DecodedStatePage>();
            for (const resource of residentIds) {
              const page = resident.get(resource);
              invariant(page, "STATE_PAGE_ROLLBACK_FAILED", `State page ${resource} could not be restored after a failed transaction.`);
              restored.set(resource, page);
            }
            resident = restored;
          } catch (rollbackError) {
            if (destroyed || restore.id !== generation || restore.signal.aborted) invariant(false, "OPERATION_ABORTED", "Paged state transaction rollback was superseded.");
            invariant(false, "STATE_PAGE_ROLLBACK_FAILED", `Paged state transaction rollback failed: ${String(rollbackError)}`);
          }
        }
        throw error;
      } finally { signal?.removeEventListener("abort", abort); }
    },
    isFrameReady(frame: number) { invariant(Number.isSafeInteger(frame) && frame >= 1, "FRAME_RANGE", `Paged state frame ${frame} is invalid.`); return ready(frame); },
    assertFrameReady(frame: number) { invariant(ready(frame), "STATE_PAGE_NOT_READY", `Every paged state channel must be resident before frame ${frame} publication.`); },
    stage(frame: number, includePlayback = true) {
      invariant(ready(frame), "STATE_PAGE_NOT_READY", `Every paged state channel must be resident before frame ${frame} staging.`);
      const playbackWorkspace = includePlayback && playback
        ? pagedPlaybackPublicationWorkspaceBytes(playbackPage(frame).materializedByteLength, playback.packet.shapeCount, playback.packet.leafCount)
        : 0;
      measure(0, playbackWorkspace + pagedVariantPublicationWorkspaceBytes(variantNodes.length));
      return Object.freeze({ frame, playback: includePlayback ? stagePlayback(frame) : null, variants: stageVariants(frame) });
    },
    commit(stage: PagedStateStage, publishVariants = true) { if (stage.playback) applyPlaybackStage(stage.playback); if (stage.variants) applyVariantStage(stage.variants, publishVariants); else if (publishVariants && variants) publishVariantRow(); measure(); return stage.frame; },
    publishVariants(frame: number) { invariant(ready(frame), "STATE_PAGE_NOT_READY", `Every paged state channel must be resident before frame ${frame} variant publication.`); measure(0, pagedVariantPublicationWorkspaceBytes(variantNodes.length)); const staged = Object.freeze({ frame, playback: null, variants: stageVariants(frame) }); if (staged.variants) applyVariantStage(staged.variants, true); measure(); return frame; },
    setActiveFramePin(frame: number) { invariant(Number.isSafeInteger(frame) && frame >= 1 && ready(frame), "STATE_PAGE_NOT_READY", `Prepared bank entry frame ${frame} must be resident before it can be pinned.`); activeFramePin = frame; },
    preloadAfter(frame: number) { const request = startRequest(); void loadWindow(frame, request.signal).catch((error) => { if (!destroyed && request.id === generation && !request.signal.aborted) options.onLateFailure?.(error); }); },
    cancelPending() { controller?.abort(); controller = null; generation += 1; },
    resetPreload(frame: number) { controller?.abort(); controller = null; generation += 1; const request = startRequest(); void loadWindow(frame, request.signal).catch((error) => { if (!destroyed && request.id === generation && !request.signal.aborted) options.onLateFailure?.(error); }); },
    destroy() { if (destroyed) return false; destroyed = true; controller?.abort(); controller = null; generation += 1; resident.clear(); currentPlayback = null; currentVariants = null; publishedVariants = null; return true; },
  });
}

export type { StatePageBytesLoader };
