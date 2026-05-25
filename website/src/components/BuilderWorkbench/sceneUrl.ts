import type { Vec3 } from "@layoutit/polycss-react";
import type { SceneOptionsState } from "../types";
import { DEFAULT_SCENE } from "./defaults";
import type { PlacedItem } from "./types";

const SCENE_PARAM = "scene";

interface SerializedBuilderItem {
  p: string;
  x: number;
  y: number;
  s?: number;
  z?: number;
  c?: string;
  r?: Vec3;
}

export interface SerializedBuilderScene {
  v: 1;
  i: SerializedBuilderItem[];
  o?: {
    g?: number;
    snap?: boolean;
    ground?: boolean;
    shadow?: boolean;
    helper?: boolean;
    key?: number;
    amb?: number;
    zoom?: number;
    rx?: number;
    ry?: number;
    t?: Vec3;
    gt?: SceneOptionsState["gridTone"];
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function roundVec3(value: Vec3): Vec3 {
  return [round(value[0]), round(value[1]), round(value[2])];
}

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isGridTone(value: unknown): value is SceneOptionsState["gridTone"] {
  return value === "gray" || value === "dark";
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeJson(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson(value: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

function sceneOptionsPayload(sceneOptions: SceneOptionsState): SerializedBuilderScene["o"] {
  const out: NonNullable<SerializedBuilderScene["o"]> = {};
  if (sceneOptions.gridResolution !== DEFAULT_SCENE.gridResolution) out.g = round(sceneOptions.gridResolution);
  if (sceneOptions.gridTone !== DEFAULT_SCENE.gridTone) out.gt = sceneOptions.gridTone;
  if (sceneOptions.snapToGrid !== DEFAULT_SCENE.snapToGrid) out.snap = sceneOptions.snapToGrid;
  if (sceneOptions.showGround !== DEFAULT_SCENE.showGround) out.ground = sceneOptions.showGround;
  if (sceneOptions.castShadow !== DEFAULT_SCENE.castShadow) out.shadow = sceneOptions.castShadow;
  if (sceneOptions.showLight !== DEFAULT_SCENE.showLight) out.helper = sceneOptions.showLight;
  if (sceneOptions.lightIntensity !== DEFAULT_SCENE.lightIntensity) out.key = round(sceneOptions.lightIntensity);
  if (sceneOptions.ambientIntensity !== DEFAULT_SCENE.ambientIntensity) out.amb = round(sceneOptions.ambientIntensity);
  if (sceneOptions.zoom !== DEFAULT_SCENE.zoom) out.zoom = round(sceneOptions.zoom);
  if (sceneOptions.rotX !== DEFAULT_SCENE.rotX) out.rx = round(sceneOptions.rotX);
  if (sceneOptions.rotY !== DEFAULT_SCENE.rotY) out.ry = round(sceneOptions.rotY);
  if (
    sceneOptions.target[0] !== DEFAULT_SCENE.target[0] ||
    sceneOptions.target[1] !== DEFAULT_SCENE.target[1] ||
    sceneOptions.target[2] !== DEFAULT_SCENE.target[2]
  ) {
    out.t = roundVec3(sceneOptions.target);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isSerializableBuilderItem(item: PlacedItem): boolean {
  return item.preset.id.startsWith("builder-shape-");
}

export function serializeBuilderSceneToParam(
  placedItems: PlacedItem[],
  sceneOptions: SceneOptionsState,
): string | null {
  const options = sceneOptionsPayload(sceneOptions);
  const serializableItems = placedItems.filter(isSerializableBuilderItem);
  if (serializableItems.length === 0 && !options) return null;
  const payload: SerializedBuilderScene = {
    v: 1,
    i: serializableItems.map((item) => ({
      p: item.preset.id,
      x: round(item.worldX),
      y: round(item.worldY),
      ...(item.scale !== 1 ? { s: round(item.scale) } : null),
      ...(item.elevation !== 0 ? { z: round(item.elevation) } : null),
      ...(item.color ? { c: item.color } : null),
      ...(item.rotation[0] !== 0 || item.rotation[1] !== 0 || item.rotation[2] !== 0
        ? { r: roundVec3(item.rotation) }
        : null),
    })),
    o: options,
  };
  return encodeJson(payload);
}

export function updateBuilderSceneUrl(param: string | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (param) url.searchParams.set(SCENE_PARAM, param);
  else url.searchParams.delete(SCENE_PARAM);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, "", next);
  }
}

export function readBuilderSceneFromUrl(): SerializedBuilderScene | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(SCENE_PARAM);
  if (!value) return null;
  try {
    const decoded = decodeJson(value);
    if (!decoded || typeof decoded !== "object") return null;
    const scene = decoded as Partial<SerializedBuilderScene>;
    if (scene.v !== 1 || !Array.isArray(scene.i)) return null;
    const items = scene.i.filter((item): item is SerializedBuilderItem => {
      if (!item || typeof item !== "object") return false;
      const entry = item as Partial<SerializedBuilderItem>;
      return typeof entry.p === "string" &&
        typeof entry.x === "number" &&
        Number.isFinite(entry.x) &&
        typeof entry.y === "number" &&
        Number.isFinite(entry.y);
    });
    return {
      v: 1,
      i: items.map((item) => ({
        p: item.p,
        x: item.x,
        y: item.y,
        ...(typeof item.s === "number" && Number.isFinite(item.s) ? { s: item.s } : null),
        ...(typeof item.z === "number" && Number.isFinite(item.z) ? { z: item.z } : null),
        ...(isHexColor(item.c) ? { c: item.c.toLowerCase() } : null),
        ...(isVec3(item.r) ? { r: item.r } : null),
      })),
      o: scene.o && typeof scene.o === "object" ? scene.o : undefined,
    };
  } catch {
    return null;
  }
}

export function sceneOptionsFromSerialized(
  scene: SerializedBuilderScene,
): Partial<SceneOptionsState> {
  const options = scene.o;
  if (!options) return {};
  return {
    ...(typeof options.g === "number" && Number.isFinite(options.g) ? { gridResolution: options.g } : null),
    ...(isGridTone(options.gt) ? { gridTone: options.gt } : null),
    ...(typeof options.snap === "boolean" ? { snapToGrid: options.snap } : null),
    ...(typeof options.ground === "boolean" ? { showGround: options.ground } : null),
    ...(typeof options.shadow === "boolean" ? { castShadow: options.shadow } : null),
    ...(typeof options.helper === "boolean" ? { showLight: options.helper } : null),
    ...(typeof options.key === "number" && Number.isFinite(options.key) ? { lightIntensity: options.key } : null),
    ...(typeof options.amb === "number" && Number.isFinite(options.amb) ? { ambientIntensity: options.amb } : null),
    ...(typeof options.zoom === "number" && Number.isFinite(options.zoom) ? { zoom: options.zoom } : null),
    ...(typeof options.rx === "number" && Number.isFinite(options.rx) ? { rotX: options.rx } : null),
    ...(typeof options.ry === "number" && Number.isFinite(options.ry) ? { rotY: options.ry } : null),
    ...(isVec3(options.t) ? { target: options.t } : null),
  };
}
