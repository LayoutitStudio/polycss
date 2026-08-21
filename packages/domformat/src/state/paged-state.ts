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

export interface PolycssPublicationDiagnostics {
  playbackCanonicalReconstructions: number;
  playbackCanonicalShapeVisits: number;
  playbackCanonicalLeafVisits: number;
  playbackBoundaryShapeVisits: number;
  playbackBoundaryLeafVisits: number;
  playbackPublicationShapeVisits: number;
  playbackPublicationLeafVisits: number;
  variantCanonicalReconstructions: number;
  variantLogicalTargetVisits: number;
  variantComparisonTargetVisits: number;
  variantDomWrites: number;
  surfaceFullReconstructions: number;
  surfaceLightingTargetVisits: number;
  surfaceVisibilityTargetVisits: number;
}

export function createPolycssPublicationDiagnostics(): PolycssPublicationDiagnostics {
  return {
    playbackCanonicalReconstructions: 0,
    playbackCanonicalShapeVisits: 0,
    playbackCanonicalLeafVisits: 0,
    playbackBoundaryShapeVisits: 0,
    playbackBoundaryLeafVisits: 0,
    playbackPublicationShapeVisits: 0,
    playbackPublicationLeafVisits: 0,
    variantCanonicalReconstructions: 0,
    variantLogicalTargetVisits: 0,
    variantComparisonTargetVisits: 0,
    variantDomWrites: 0,
    surfaceFullReconstructions: 0,
    surfaceLightingTargetVisits: 0,
    surfaceVisibilityTargetVisits: 0,
  };
}

interface PagedPlaybackRangeStage {
  readonly frame: number;
  readonly kind: "range";
  readonly appearance: number;
  readonly modelTransform?: string;
  readonly page: DecodedPagedPlaybackPage;
  readonly shapeStart: number;
  readonly shapeEnd: number;
  readonly leafStart: number;
  readonly leafEnd: number;
}

interface PagedPlaybackCompleteStage {
  readonly frame: number;
  readonly kind: "complete";
  readonly appearance: number;
  readonly modelTransform: string;
  readonly shapeTransforms: string[];
  readonly shapeVisibility: Uint8Array;
  readonly leafTransforms: string[];
}

export interface PagedPlaybackMaterializedStage {
  readonly frame: number;
  readonly kind: "materialized";
  readonly appearance: number;
  readonly modelTransform?: string;
  readonly shapeTargets: Uint32Array;
  readonly shapeTransforms: readonly string[];
  readonly shapeVisibility: Uint8Array;
  readonly leafTargets: Uint32Array;
  readonly leafTransforms: readonly string[];
}

export type PagedPlaybackStage = PagedPlaybackRangeStage | PagedPlaybackCompleteStage | PagedPlaybackMaterializedStage;

interface PagedVariantRangeStage {
  readonly frame: number;
  readonly kind: "range";
  readonly page: DecodedPagedVariantPage;
  readonly start: number;
  readonly end: number;
}

interface PagedVariantCompleteStage {
  readonly frame: number;
  readonly kind: "complete";
  readonly row: Uint16Array;
}

export type PagedVariantStage = PagedVariantRangeStage | PagedVariantCompleteStage;

export interface PagedStateStage {
  readonly frame: number;
  readonly playback: PagedPlaybackStage | null;
  readonly variants: PagedVariantStage | null;
}

export interface PagedPlaybackCanonical {
  frame: number;
  appearance: number;
  modelTransform: string;
  shapeTransforms: string[];
  shapeVisibility: Uint8Array;
  leafTransforms: string[];
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
  readonly canonicalPlayback: PagedPlaybackCanonical | null;
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

function transformBytes(transform: string): number {
  const value = 8 + transform.length * 2;
  invariant(Number.isSafeInteger(value), "STATE_PAGE_RESIDENCY_LIMIT", "Paged playback transform byte accounting overflowed.");
  return value;
}

function addBytes(left: number, right: number, label: string): number {
  const value = left + right;
  invariant(Number.isSafeInteger(value) && value >= 0, "STATE_PAGE_RESIDENCY_LIMIT", `${label} byte accounting overflowed.`);
  return value;
}

function replaceTransformBytes(total: number, previous: string, next: string): number {
  const retained = total - transformBytes(previous);
  invariant(Number.isSafeInteger(retained) && retained >= 0, "STATE_PAGE_RESIDENCY_LIMIT", "Paged playback live-row byte accounting underflowed.");
  return addBytes(retained, transformBytes(next), "Paged playback live-row");
}

function playbackLiveBytes(playback: PagedPlaybackCanonical): number {
  let total = addBytes(transformBytes(playback.modelTransform), playback.shapeVisibility.byteLength, "Paged playback live-row");
  for (const transform of playback.shapeTransforms) total = addBytes(total, transformBytes(transform), "Paged playback live-row");
  for (const transform of playback.leafTransforms) total = addBytes(total, transformBytes(transform), "Paged playback live-row");
  return total;
}

function playbackCanonical(page: DecodedPagedPlaybackPage, frame: number, diagnostics?: PolycssPublicationDiagnostics): PagedPlaybackCanonical {
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
  if (diagnostics) {
    diagnostics.playbackCanonicalReconstructions += 1;
    diagnostics.playbackCanonicalShapeVisits += shapeTransforms.length;
    diagnostics.playbackCanonicalLeafVisits += leafTransforms.length;
  }
  return { frame, appearance, modelTransform, shapeTransforms, shapeVisibility, leafTransforms };
}

function playbackFullStage(page: DecodedPagedPlaybackPage, frame: number, diagnostics?: PolycssPublicationDiagnostics): PagedPlaybackStage {
  const row = playbackCanonical(page, frame, diagnostics);
  return Object.freeze({ frame, kind: "complete", appearance: row.appearance, modelTransform: row.modelTransform, shapeTransforms: row.shapeTransforms, shapeVisibility: row.shapeVisibility, leafTransforms: row.leafTransforms });
}

function playbackSparseStage(page: DecodedPagedPlaybackPage, frame: number, local: number): PagedPlaybackStage {
  const model = page.modelTransforms[local];
  const shapeStart = page.shapeOffsets[local];
  const shapeEnd = page.shapeOffsets[local + 1];
  const leafStart = page.leafOffsets[local];
  const leafEnd = page.leafOffsets[local + 1];
  return Object.freeze({
    frame,
    kind: "range",
    appearance: page.appearances[local],
    ...(model === 0xffffffff ? {} : { modelTransform: page.transforms[model] }),
    page,
    shapeStart,
    shapeEnd,
    leafStart,
    leafEnd,
  });
}

function variantRow(page: DecodedPagedVariantPage, frame: number, diagnostics?: PolycssPublicationDiagnostics): Uint16Array {
  const row = page.keyframe.slice();
  for (let local = 1; local <= frame - page.startFrame; local += 1) for (let cursor = page.offsets[local]; cursor < page.offsets[local + 1]; cursor += 1) row[page.targets[cursor]] = page.classes[cursor];
  if (diagnostics) diagnostics.variantCanonicalReconstructions += 1;
  return row;
}

export function createPolycssPagedState(
  document: DomDocument,
  mounted: MountedTree,
  limits: DomLimits,
  load: StatePageBytesLoader,
  options: { readonly boundTargets?: ReadonlyMap<string, Readonly<{ targets: unknown }>>; readonly onLateFailure?: (error: unknown) => void; readonly diagnostics?: PolycssPublicationDiagnostics } = {},
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
  let variantsSynchronized = true;
  let variantFrame = variants?.packet.initial.frame ?? playbackInitial;
  let currentPlayback: PagedPlaybackCanonical | null = null;
  let currentPlaybackBytes = 0;
  const variantLiveBytes = addBytes(currentVariants?.byteLength ?? 0, publishedVariants?.byteLength ?? 0, "Paged variant retained-row");
  let activeStage: PagedStateStage | null = null;
  let activePlaybackStageResource: string | null = null;
  let activeVariantStageResource: string | null = null;
  let activeStageBytes = 0;
  let resident = new Map<string, DecodedStatePage>();
  let controller: AbortController | null = null;
  let generation = 0;
  let destroyed = false;
  let peakResidentPages = 0;
  let peakDecodedBytes = 0;
  let peakMaterializedBytes = 0;
  let peakDocumentStateBytes = 0;

  const liveBytes = () => addBytes(currentPlaybackBytes, variantLiveBytes, "Paged state live-row");
  const residentMaterialized = (excluded?: ReadonlySet<string>): number => {
    let total = 0;
    for (const [resource, page] of resident) if (!excluded?.has(resource)) total = addBytes(total, page.materializedByteLength, "Paged state residency");
    return total;
  };
  const measure = ({
    validationBytes = 0,
    transientMaterialized = 0,
    incomingMaterialized = 0,
    residentBytes = residentMaterialized(),
    residentPages = resident.size,
    retainedLiveBytes = liveBytes(),
  }: {
    readonly validationBytes?: number;
    readonly transientMaterialized?: number;
    readonly incomingMaterialized?: number;
    readonly residentBytes?: number;
    readonly residentPages?: number;
    readonly retainedLiveBytes?: number;
  } = {}): void => {
    const decoded = validationBytes;
    const materialized = addBytes(addBytes(addBytes(residentBytes, transientMaterialized, "Paged state materialization"), incomingMaterialized, "Paged state materialization"), activeStageBytes, "Paged state materialization");
    const total = addBytes(addBytes(addBytes(addBytes(decoded, residentBytes, "Paged state aggregate"), transientMaterialized, "Paged state aggregate"), activeStageBytes, "Paged state aggregate"), retainedLiveBytes, "Paged state aggregate");
    invariant(Number.isSafeInteger(residentPages) && residentPages >= 0, "STATE_PAGE_RESIDENCY_LIMIT", "Paged state resident-page accounting overflowed.");
    peakResidentPages = Math.max(peakResidentPages, residentPages);
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
    if (activePlaybackStageResource) resources.add(activePlaybackStageResource);
    if (activeVariantStageResource) resources.add(activeVariantStageResource);
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
    const evictions: string[] = [];
    for (const candidate of resident.keys()) {
      if (resident.size - evictions.length < maxResidentPages) break;
      if (!protectedResources.has(candidate)) evictions.push(candidate);
    }
    invariant(resident.size - evictions.length < maxResidentPages, "STATE_PAGE_RESIDENCY_LIMIT", "Paged state cannot reserve capacity without evicting a protected page.");
    const owner = descriptors.get(resource);
    const record = records.get(resource);
    invariant(owner && record?.kind === "state-page" && record.decodedByteLength !== undefined, "MISSING_EXTERNAL_RESOURCE", `State page ${resource} is undeclared.`);
    const validationBytes = statePageValidationWorkspaceBytes(record.decodedByteLength, owner.descriptor.materializedByteLength);
    const excluded = new Set(evictions);
    measure({
      validationBytes,
      incomingMaterialized: owner.descriptor.materializedByteLength,
      residentBytes: residentMaterialized(excluded),
      residentPages: resident.size - evictions.length + 1,
    });
    for (const candidate of evictions) resident.delete(candidate);
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
        if (options.diagnostics) {
          options.diagnostics.playbackBoundaryShapeVisits += page.keyframe.shapeTransforms.length + page.shapeOffsets[1] - page.shapeOffsets[0];
          options.diagnostics.playbackBoundaryLeafVisits += page.keyframe.leafTransforms.length + page.leafOffsets[1] - page.leafOffsets[0];
        }
      }
      return playbackSparseStage(page, frame, local);
    }
    return playbackFullStage(page, frame, options.diagnostics);
  };
  const stageVariants = (frame: number): PagedVariantStage | null => {
    if (!variants) return null;
    const page = variantPage(frame);
    const expected = variantFrame === variants.packet.frameCount ? 1 : variantFrame + 1;
    if (frame === expected && frame > page.startFrame) {
      const local = frame - page.startFrame;
      return Object.freeze({ frame, kind: "range", page, start: page.offsets[local], end: page.offsets[local + 1] });
    }
    return Object.freeze({ frame, kind: "complete", row: variantRow(page, frame, options.diagnostics) });
  };
  const playbackStageWorkspace = (frame: number, includePlayback: boolean): number => {
    if (!playback || !includePlayback) return 0;
    const page = playbackPage(frame);
    const expected = currentPlayback ? (currentPlayback.frame === playback.packet.pages.at(-1)!.endFrame ? 1 : currentPlayback.frame + 1) : -1;
    return currentPlayback && frame === expected
      ? 0
      : pagedPlaybackPublicationWorkspaceBytes(page.materializedByteLength, playback.packet.shapeCount, playback.packet.leafCount);
  };
  const variantStageWorkspace = (frame: number): number => {
    if (!variants) return 0;
    const page = variantPage(frame);
    const expected = variantFrame === variants.packet.frameCount ? 1 : variantFrame + 1;
    return frame === expected && frame > page.startFrame ? 0 : pagedVariantPublicationWorkspaceBytes(variantNodes.length);
  };
  const publishVariantTarget = (index: number, value: number): void => {
    invariant(publishedVariants && variants, "INVALID_VARIANT_PUBLICATION", "Paged variant row has no owner.");
    const previous = publishedVariants[index];
    if (previous === value) return;
    if (previous !== 0xffff) { variantNodes[index].classList.remove(variants.packet.classes[previous]); if (options.diagnostics) options.diagnostics.variantDomWrites += 1; }
    if (value !== 0xffff) { variantNodes[index].classList.add(variants.packet.classes[value]); if (options.diagnostics) options.diagnostics.variantDomWrites += 1; }
    publishedVariants[index] = value;
  };
  const publishVariantRow = (): void => {
    invariant(currentVariants && publishedVariants && variants, "INVALID_VARIANT_PUBLICATION", "Paged variant row has no owner.");
    if (options.diagnostics) options.diagnostics.variantComparisonTargetVisits += currentVariants.length;
    for (let index = 0; index < currentVariants.length; index += 1) {
      const value = currentVariants[index];
      publishVariantTarget(index, value);
    }
    variantsSynchronized = true;
  };
  const applyVariantStage = (stage: PagedVariantStage, publish: boolean): void => {
    invariant(currentVariants && variants, "INVALID_VARIANT_PUBLICATION", "Paged variant stage has no owner.");
    if (stage.kind === "complete") {
      if (options.diagnostics) options.diagnostics.variantLogicalTargetVisits += stage.row.length;
      currentVariants.set(stage.row);
    } else {
      if (options.diagnostics) options.diagnostics.variantLogicalTargetVisits += stage.end - stage.start;
      for (let cursor = stage.start; cursor < stage.end; cursor += 1) {
        const index = stage.page.targets[cursor];
        const value = stage.page.classes[cursor];
        currentVariants[index] = value;
      }
    }
    variantFrame = stage.frame;
    if (!publish) { variantsSynchronized = false; return; }
    if (stage.kind === "complete" || !variantsSynchronized) { publishVariantRow(); return; }
    if (options.diagnostics) options.diagnostics.variantComparisonTargetVisits += stage.end - stage.start;
    for (let cursor = stage.start; cursor < stage.end; cursor += 1) {
      const index = stage.page.targets[cursor];
      publishVariantTarget(index, currentVariants[index]);
    }
  };
  const playbackBytesAfterStage = (stage: PagedPlaybackStage): number => {
    invariant(playback, "INVALID_PLAYBACK_PUBLICATION", "Paged playback stage has no owner.");
    if (stage.kind === "complete") {
      invariant(stage.shapeTransforms.length === playback.packet.shapeCount && stage.shapeVisibility.length === playback.packet.shapeCount && stage.leafTransforms.length === playback.packet.leafCount, "INVALID_PLAYBACK_PUBLICATION", "Complete paged playback stage is incomplete.");
      return playbackLiveBytes(stage);
    }
    invariant(currentPlayback && stage.kind === "range", "INVALID_PLAYBACK_PUBLICATION", "Paged playback sparse stage is invalid.");
    let total = currentPlaybackBytes;
    if (stage.modelTransform !== undefined) total = replaceTransformBytes(total, currentPlayback.modelTransform, stage.modelTransform);
    for (let cursor = stage.shapeStart; cursor < stage.shapeEnd; cursor += 1) {
      const target = stage.page.shapeTargets[cursor];
      total = replaceTransformBytes(total, currentPlayback.shapeTransforms[target], stage.page.transforms[stage.page.shapeTransforms[cursor]]);
    }
    for (let cursor = stage.leafStart; cursor < stage.leafEnd; cursor += 1) {
      const target = stage.page.leafTargets[cursor];
      total = replaceTransformBytes(total, currentPlayback.leafTransforms[target], stage.page.transforms[stage.page.leafTransforms[cursor]]);
    }
    return total;
  };
  const applyPlaybackStage = (stage: PagedPlaybackStage, nextPlaybackBytes: number): void => {
    invariant(playback, "INVALID_PLAYBACK_PUBLICATION", "Paged playback stage has no owner.");
    if (stage.kind === "complete") {
      if (!currentPlayback) {
        currentPlayback = { frame: stage.frame, appearance: stage.appearance, modelTransform: stage.modelTransform, shapeTransforms: [...stage.shapeTransforms], shapeVisibility: stage.shapeVisibility.slice(), leafTransforms: [...stage.leafTransforms] };
      } else {
        currentPlayback.frame = stage.frame;
        currentPlayback.appearance = stage.appearance;
        currentPlayback.modelTransform = stage.modelTransform;
        for (let index = 0; index < stage.shapeTransforms.length; index += 1) currentPlayback.shapeTransforms[index] = stage.shapeTransforms[index];
        currentPlayback.shapeVisibility.set(stage.shapeVisibility);
        for (let index = 0; index < stage.leafTransforms.length; index += 1) currentPlayback.leafTransforms[index] = stage.leafTransforms[index];
      }
      currentPlaybackBytes = nextPlaybackBytes;
      return;
    }
    invariant(currentPlayback && stage.kind === "range", "INVALID_PLAYBACK_PUBLICATION", "Paged playback sparse stage is invalid.");
    currentPlayback.frame = stage.frame;
    currentPlayback.appearance = stage.appearance;
    if (stage.modelTransform !== undefined) {
      currentPlayback.modelTransform = stage.modelTransform;
    }
    if (options.diagnostics) {
      options.diagnostics.playbackCanonicalShapeVisits += stage.shapeEnd - stage.shapeStart;
      options.diagnostics.playbackCanonicalLeafVisits += stage.leafEnd - stage.leafStart;
    }
    for (let cursor = stage.shapeStart; cursor < stage.shapeEnd; cursor += 1) {
      const target = stage.page.shapeTargets[cursor];
      const transform = stage.page.transforms[stage.page.shapeTransforms[cursor]];
      currentPlayback.shapeTransforms[target] = transform;
      currentPlayback.shapeVisibility[target] = stage.page.shapeVisibility[cursor];
    }
    for (let cursor = stage.leafStart; cursor < stage.leafEnd; cursor += 1) {
      const target = stage.page.leafTargets[cursor];
      const transform = stage.page.transforms[stage.page.leafTransforms[cursor]];
      currentPlayback.leafTransforms[target] = transform;
    }
    currentPlaybackBytes = nextPlaybackBytes;
  };
  const discardActiveStage = (): void => {
    activeStage = null;
    activePlaybackStageResource = null;
    activeVariantStageResource = null;
    activeStageBytes = 0;
  };
  const installActiveStage = (stage: PagedStateStage): PagedStateStage => {
    // Range stages borrow resident typed columns, so their page pins must survive until synchronous commit or failure cleanup.
    activeStage = stage;
    activePlaybackStageResource = stage.playback?.kind === "range" ? pageAt(playback!.packet, stage.frame).resource : null;
    activeVariantStageResource = stage.variants?.kind === "range" ? pageAt(variants!.packet, stage.frame).resource : null;
    return stage;
  };
  const isActiveStage = (stage: PagedStateStage): boolean => Boolean(activeStage
    && stage.frame === activeStage.frame
    && stage.playback === activeStage.playback
    && stage.variants === activeStage.variants);

  return Object.freeze({
    get hasPlayback() { return Boolean(playback); }, get hasVariants() { return Boolean(variants); },
    get residentResources() { return Object.freeze([...resident.keys()]); }, get peakResidentPages() { return peakResidentPages; }, get peakDecodedBytes() { return peakDecodedBytes; }, get peakMaterializedBytes() { return peakMaterializedBytes; }, get peakDocumentStateBytes() { return peakDocumentStateBytes; },
    get frame() { return currentPlayback?.frame ?? variantFrame; }, get activeFramePin() { return activeFramePin; }, get canonicalPlayback() { return currentPlayback; },
    async prepareInitial(signal?: AbortSignal) {
      invariant(!signal?.aborted, "OPERATION_ABORTED", "Paged state initial request was aborted.");
      const request = startRequest();
      const abort = () => { if (request.id === generation) controller?.abort(); };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await loadWindow(playbackInitial, request.signal, false);
        invariant(request.id === generation && !request.signal.aborted, "OPERATION_ABORTED", "Paged state initial request was superseded.");
        const initialPlaybackPage = playback ? playbackPage(playback.packet.initial.sourceFrame) : null;
        const initialWorkspace = addBytes(
          initialPlaybackPage && playback ? pagedPlaybackLiveRowCeiling(initialPlaybackPage.materializedByteLength, playback.packet.shapeCount, playback.packet.leafCount) : 0,
          variants ? pagedVariantPublicationWorkspaceBytes(variantNodes.length) : 0,
          "Paged state initial publication",
        );
        measure({ transientMaterialized: initialWorkspace });
        let preparedPlayback: PagedPlaybackCanonical | null = null;
        if (playback) {
          const initial = playbackCanonical(initialPlaybackPage!, playback.packet.initial.sourceFrame, options.diagnostics);
          invariant(initial.appearance === playback.packet.initial.appearance, "STATE_PAGE_INITIAL_MISMATCH", "Paged playback initial page disagrees with its shell appearance.");
          const base = (playback.binding.parameters as unknown as { readonly baseSceneTransform: string }).baseSceneTransform;
          const expectedModel = initial.modelTransform === "" ? base : `${base} ${initial.modelTransform}`;
          invariant(playbackModel!.style.transform === cssTransform(expectedModel), "STATE_PAGE_INITIAL_MISMATCH", "Paged playback initial model transform disagrees with TREE.");
          for (let index = 0; index < playbackShapes.length; index += 1) invariant(playbackShapes[index].style.transform === cssTransform(initial.shapeTransforms[index]) && playbackShapes[index].style.visibility === (initial.shapeVisibility[index] === 1 ? "visible" : "hidden"), "STATE_PAGE_INITIAL_MISMATCH", `Paged playback initial shape ${index} disagrees with TREE.`);
          for (let index = 0; index < playbackLeaves.length; index += 1) invariant(playbackLeaves[index].style.transform === cssTransform(initial.leafTransforms[index]), "STATE_PAGE_INITIAL_MISMATCH", `Paged playback initial leaf ${index} disagrees with TREE.`);
          preparedPlayback = initial;
        }
        if (variants) {
          const initial = variantRow(variantPage(variants.packet.initial.frame), variants.packet.initial.frame, options.diagnostics);
          invariant(initial.length === currentVariants!.length && initial.every((value, index) => value === currentVariants![index]), "STATE_PAGE_INITIAL_MISMATCH", "Paged variant initial page disagrees with its shell/TREE row.");
        }
        if (preparedPlayback) {
          currentPlaybackBytes = playbackLiveBytes(preparedPlayback);
          currentPlayback = preparedPlayback;
        }
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
      discardActiveStage();
      try {
        activeStageBytes = addBytes(playbackStageWorkspace(frame, includePlayback), variantStageWorkspace(frame), "Paged state publication workspace");
        measure();
        const playbackStage = includePlayback ? stagePlayback(frame) : null;
        const variantStage = stageVariants(frame);
        return installActiveStage(Object.freeze({ frame, playback: playbackStage, variants: variantStage }));
      } catch (error) {
        discardActiveStage();
        throw error;
      }
    },
    commit(stage: PagedStateStage, publishVariants = true) {
      invariant(isActiveStage(stage), "INVALID_PLAYBACK_PUBLICATION", "Paged state commit does not own the active staged row.");
      try {
        const nextPlaybackBytes = stage.playback ? playbackBytesAfterStage(stage.playback) : currentPlaybackBytes;
        measure({ retainedLiveBytes: addBytes(nextPlaybackBytes, variantLiveBytes, "Paged state projected live-row") });
        if (stage.playback) applyPlaybackStage(stage.playback, nextPlaybackBytes);
        if (stage.variants) applyVariantStage(stage.variants, publishVariants);
        else if (publishVariants && variants) publishVariantRow();
        return stage.frame;
      } finally { discardActiveStage(); }
    },
    publishVariants(frame: number) {
      invariant(ready(frame), "STATE_PAGE_NOT_READY", `Every paged state channel must be resident before frame ${frame} variant publication.`);
      discardActiveStage();
      if (variants && frame === variantFrame) {
        measure();
        publishVariantRow();
        return frame;
      }
      const workspace = variantStageWorkspace(frame);
      measure({ transientMaterialized: workspace });
      const variantStage = stageVariants(frame);
      if (variantStage) applyVariantStage(variantStage, true);
      return frame;
    },
    setActiveFramePin(frame: number) { invariant(Number.isSafeInteger(frame) && frame >= 1 && ready(frame), "STATE_PAGE_NOT_READY", `Prepared bank entry frame ${frame} must be resident before it can be pinned.`); activeFramePin = frame; },
    preloadAfter(frame: number) { const request = startRequest(); void loadWindow(frame, request.signal).catch((error) => { if (!destroyed && request.id === generation && !request.signal.aborted) options.onLateFailure?.(error); }); },
    cancelPending() { controller?.abort(); controller = null; generation += 1; },
    resetPreload(frame: number) { controller?.abort(); controller = null; generation += 1; const request = startRequest(); void loadWindow(frame, request.signal).catch((error) => { if (!destroyed && request.id === generation && !request.signal.aborted) options.onLateFailure?.(error); }); },
    destroy() { if (destroyed) return false; destroyed = true; controller?.abort(); controller = null; generation += 1; discardActiveStage(); resident.clear(); currentPlayback = null; currentPlaybackBytes = 0; currentVariants = null; publishedVariants = null; return true; },
  });
}

export type { StatePageBytesLoader };
