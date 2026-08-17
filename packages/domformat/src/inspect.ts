import { sha256Hex } from "./hash.js";
import type { DomBindingTarget, DomReadResult, DomStateChannel } from "./public-types.js";

interface EffectsPacketSummarySource {
  readonly frameCount: number;
  readonly stars: readonly unknown[];
  readonly emitters: readonly Readonly<{ poolSize: number }>[];
  readonly spawnStream: Readonly<{ count: number }>;
}

interface InteractionPacketSummarySource {
  readonly controls: readonly Readonly<{
    mode: string;
    closure: Readonly<{
      vertexRows: readonly unknown[];
      weightScalars: readonly unknown[];
      leafRows: readonly unknown[];
    }>;
  }>[];
  readonly leaves: readonly unknown[];
}

interface PlaybackPacketSummarySource {
  readonly frameRows: readonly unknown[];
  readonly shapeCount: number;
  readonly leafCount: number;
  readonly transforms: Readonly<{ count: number }>;
}

interface PagedPlaybackPacketSummarySource {
  readonly shapeCount: number;
  readonly leafCount: number;
  readonly pages: readonly Readonly<{
    endFrame: number;
    transformCount: number;
    shapeChangeCount: number;
    leafChangeCount: number;
    materializedByteLength: number;
  }>[];
}

function stateDetails(channel: DomStateChannel): Record<string, number> | undefined {
  const packet = channel.data.packet;
  if (channel.codec === "polycss-effects-prepared@0" && packet) {
    const prepared = packet as unknown as EffectsPacketSummarySource;
    return {
      frames: prepared.frameCount,
      stars: prepared.stars.length,
      emitters: prepared.emitters.length,
      particles: prepared.emitters.reduce((sum, emitter) => sum + emitter.poolSize, 0),
      spawnTuples: prepared.spawnStream.count,
    };
  }
  if (channel.codec === "polycss-pointer-grab-prepared@0" && packet) {
    const prepared = packet as unknown as InteractionPacketSummarySource;
    return {
      controls: prepared.controls.length,
      grabControls: prepared.controls.filter((control) => control.mode === "grab").length,
      eyeFollowControls: prepared.controls.filter((control) => control.mode === "eye-follow").length,
      leafPlans: prepared.leaves.length,
      sparseVertices: prepared.controls.reduce((sum, control) => sum + control.closure.vertexRows.length / 4, 0),
      sparseWeights: prepared.controls.reduce((sum, control) => sum + control.closure.weightScalars.length, 0),
      sparseLeafRows: prepared.controls.reduce((sum, control) => sum + control.closure.leafRows.length / 4, 0),
    };
  }
  if (channel.codec === "polycss-playback-packed@0" && packet) {
    const prepared = packet as unknown as PlaybackPacketSummarySource;
    return {
      frames: prepared.frameRows.length,
      shapes: prepared.shapeCount,
      leaves: prepared.leafCount,
      transforms: prepared.transforms.count,
    };
  }
  if (channel.codec === "polycss-paged-playback@0" && packet) {
    const prepared = packet as unknown as PagedPlaybackPacketSummarySource;
    return {
      frames: prepared.pages.at(-1)?.endFrame ?? 0,
      shapes: prepared.shapeCount,
      leaves: prepared.leafCount,
      pages: prepared.pages.length,
      transforms: prepared.pages.reduce((sum, page) => sum + page.transformCount, 0),
      shapeChanges: prepared.pages.reduce((sum, page) => sum + page.shapeChangeCount, 0),
      leafChanges: prepared.pages.reduce((sum, page) => sum + page.leafChangeCount, 0),
      materializedBytes: prepared.pages.reduce((sum, page) => sum + page.materializedByteLength, 0),
    };
  }
  return undefined;
}

function targetCount(value: DomBindingTarget): number {
  if (typeof value === "string") return value === "$host" ? 0 : 1;
  if (Array.isArray(value)) return value.reduce((sum, entry) => sum + targetCount(entry), 0);
  if (value && typeof value === "object") return Object.values(value).reduce((sum, entry) => sum + targetCount(entry), 0);
  return 0;
}

export function inspection(result: DomReadResult) {
  const { document, externalMissing = [] } = result;
  const { transport } = result;
  const nodes = document.tree.nodes;
  const tags: Record<string, number> = Object.fromEntries([...new Set(nodes.map((node) => node.name))].sort().map((tag) => [tag, nodes.filter((node) => node.name === tag).length]));
  const resources = document.resources.resources.map((record) => ({
    id: record.id,
    kind: record.kind,
    mediaType: record.mediaType,
    bytes: record.byteLength,
    dimensions: record.dimensions,
    digest: record.digest.value,
    ...(record.kind === "state-page" ? {
      codec: record.codec,
      encoding: record.encoding,
      decodedBytes: record.decodedByteLength,
      decodedDigest: record.decodedDigest?.value,
    } : {}),
    path: record.path,
    verified: !externalMissing.includes(record.id),
  }));
  return {
    format: document.meta.format,
    profile: document.meta.profile,
    title: document.meta.title,
    fileBytes: transport.totalLength,
    fileSha256: sha256Hex(transport.bytes),
    transport: {
      encoding: transport.encoding,
      decodedBytes: transport.decodedLength,
    },
    tree: {
      nodes: nodes.length,
      roots: nodes.filter((node) => node.parent === -1).length,
      tags,
      stableIds: nodes.length,
    },
    state: {
      channels: document.state.channels.map((channel) => ({
        id: channel.id,
        codec: channel.codec,
        ...(stateDetails(channel) ? { details: stateDetails(channel) } : {}),
      })),
    },
    bindings: document.bindings.channels.map(({ id, interpreter, status, inputs, targets, sinks, parameters }) => ({
      id,
      interpreter,
      status,
      inputs,
      targetCount: targetCount(targets),
      sinks,
      ...(parameters ? { parameters } : {}),
    })),
    resources,
    allResourcesVerified: externalMissing.length === 0,
  };
}

export function formatInspection(value: ReturnType<typeof inspection>): string {
  const lines = [
    `${value.format} / ${value.profile}`,
    `${value.title}`,
    `${value.fileBytes.toLocaleString("en-US")} bytes, sha256 ${value.fileSha256}`,
    `${value.tree.nodes.toLocaleString("en-US")} stable nodes; tags ${Object.entries(value.tree.tags).map(([tag, count]) => `${tag}:${count}`).join(", ")}`,
    `transport: ${value.transport.encoding} ${value.fileBytes} bytes`,
    `state: ${value.state.channels.map((channel) => `${channel.id}=${channel.codec}${channel.details ? ` ${JSON.stringify(channel.details)}` : ""}`).join(", ")}`,
    `bindings: ${value.bindings.map((binding) => `${binding.id}=${binding.interpreter}/${binding.status} targets:${binding.targetCount}`).join(", ")}`,
    `resources: ${value.resources.length} (${value.allResourcesVerified ? "all verified" : "external bytes not loaded"})`,
  ];
  return `${lines.join("\n")}\n`;
}
