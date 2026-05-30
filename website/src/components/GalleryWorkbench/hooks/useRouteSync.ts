import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { SceneOptionsState } from "../../types";

const MODEL_PARAM = "model";
const SCENE_PARAM = "scene";

type SceneTarget = SceneOptionsState["target"];
type SerializedGallerySceneOptionKey = keyof SerializedGallerySceneOptions;

interface SerializedGallerySceneOptions {
  r?: SceneOptionsState["renderer"];
  ap?: boolean;
  ats?: number;
  c?: boolean;
  i?: boolean;
  ar?: boolean;
  axes?: boolean;
  sel?: boolean;
  hov?: boolean;
  helper?: boolean;
  z?: number;
  rx?: number;
  ry?: number;
  p?: number | false;
  az?: number;
  el?: number;
  key?: number;
  kc?: string;
  amb?: number;
  amc?: string;
  tl?: SceneOptionsState["textureLighting"];
  tq?: SceneOptionsState["textureQuality"];
  solid?: boolean;
  mp?: SceneOptionsState["matrixPrecision"];
  bp?: SceneOptionsState["borderShapePrecision"];
  mr?: SceneOptionsState["meshResolution"];
  fill?: boolean;
  outline?: boolean;
  drag?: SceneOptionsState["dragMode"];
  t?: SceneTarget;
  ds?: string;
  shadow?: boolean;
  reach?: number;
  ground?: boolean;
  gc?: string;
  fl?: boolean;
  fm?: boolean;
  fj?: boolean;
  fc?: boolean;
  fms?: number;
  fjv?: number;
  fg?: number;
  feh?: number;
  fch?: number;
  fls?: number;
  fiy?: boolean;
  frd?: number;
}

interface SerializedGalleryScene {
  v: 1;
  o?: SerializedGallerySceneOptions;
}

const STRATEGY_ORDER = ["b", "i", "u"] as const;
const COMPACT_SCENE_VERSION = "2";
const COMPACT_NUMBER_SCALE = 10000;
const COMPACT_KEY_BY_OPTION: Record<SerializedGallerySceneOptionKey, string> = {
  r: "r",
  ap: "P",
  ats: "A",
  c: "c",
  i: "i",
  ar: "n",
  axes: "x",
  sel: "s",
  hov: "h",
  helper: "l",
  z: "z",
  rx: "X",
  ry: "Y",
  p: "p",
  az: "a",
  el: "e",
  key: "k",
  kc: "K",
  amb: "m",
  amc: "M",
  tl: "T",
  tq: "q",
  solid: "o",
  mp: "u",
  bp: "v",
  mr: "w",
  fill: "f",
  outline: "O",
  drag: "d",
  t: "t",
  ds: "b",
  shadow: "S",
  reach: "E",
  ground: "g",
  gc: "G",
  fl: "L",
  fm: "V",
  fj: "J",
  fc: "C",
  fms: "1",
  fjv: "2",
  fg: "3",
  feh: "4",
  fch: "5",
  fls: "6",
  fiy: "7",
  frd: "8",
};
const COMPACT_OPTION_BY_KEY = Object.fromEntries(
  Object.entries(COMPACT_KEY_BY_OPTION).map(([key, compact]) => [compact, key]),
) as Record<string, SerializedGallerySceneOptionKey>;
const DOTTED_COMPACT_OPTION_BY_KEY: Record<string, SerializedGallerySceneOptionKey> = {
  ...COMPACT_OPTION_BY_KEY,
  ms: "fms",
  jv: "fjv",
  fg: "fg",
  eh: "feh",
  ch: "fch",
  ls: "fls",
  iy: "fiy",
  rd: "frd",
};
const BOOLEAN_OPTIONS = new Set<SerializedGallerySceneOptionKey>([
  "ap", "c", "i", "ar", "axes", "sel", "hov", "helper",
  "solid", "fill", "outline", "shadow", "ground",
  "fl", "fm", "fj", "fc", "fiy",
]);

function getRoutePresetValue(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get(MODEL_PARAM) || "";
}

function getRouteSceneValue(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get(SCENE_PARAM) || "";
}

function hashStringToUint32(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function routeIdForPresetId(presetId: string): string {
  return String(hashStringToUint32(presetId));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function roundVec3(value: SceneTarget): SceneTarget {
  return [round(value[0]), round(value[1]), round(value[2])];
}

function sameNumber(a: number, b: number): boolean {
  return round(a) === round(b);
}

function sameVec3(a: SceneTarget, b: SceneTarget): boolean {
  return sameNumber(a[0], b[0]) && sameNumber(a[1], b[1]) && sameNumber(a[2], b[2]);
}

function samePerspective(
  a: SceneOptionsState["perspective"],
  b: SceneOptionsState["perspective"],
): boolean {
  if (a === false || b === false) return a === b;
  if (typeof a === "number" || typeof b === "number") {
    return typeof a === "number" && typeof b === "number" && sameNumber(a, b);
  }
  return a === b;
}

function sameTextureQuality(
  a: SceneOptionsState["textureQuality"],
  b: SceneOptionsState["textureQuality"],
): boolean {
  if (typeof a === "number" || typeof b === "number") {
    return typeof a === "number" && typeof b === "number" && sameNumber(a, b);
  }
  return a === b;
}

function addBoolean<K extends keyof SerializedGallerySceneOptions>(
  out: SerializedGallerySceneOptions,
  key: K,
  value: boolean,
  defaultValue: boolean,
): void {
  if (value !== defaultValue) out[key] = value as SerializedGallerySceneOptions[K];
}

function addNumber<K extends keyof SerializedGallerySceneOptions>(
  out: SerializedGallerySceneOptions,
  key: K,
  value: number,
  defaultValue: number,
): void {
  if (!sameNumber(value, defaultValue)) out[key] = round(value) as SerializedGallerySceneOptions[K];
}

function addString<K extends keyof SerializedGallerySceneOptions, T extends string>(
  out: SerializedGallerySceneOptions,
  key: K,
  value: T,
  defaultValue: T,
): void {
  if (value !== defaultValue) out[key] = value as SerializedGallerySceneOptions[K];
}

function strategiesPayload(strategies: SceneOptionsState["disableStrategies"]): string {
  return STRATEGY_ORDER.filter((strategy) => strategies.includes(strategy)).join("");
}

function sceneOptionsPayload(
  options: SceneOptionsState,
  defaults: SceneOptionsState,
): SerializedGallerySceneOptions | undefined {
  const out: SerializedGallerySceneOptions = {};
  addString(out, "r", options.renderer, defaults.renderer);
  addBoolean(out, "ap", options.animationPaused, defaults.animationPaused);
  addNumber(out, "ats", options.animationTimeScale, defaults.animationTimeScale);
  addBoolean(out, "c", options.autoCenter, defaults.autoCenter);
  addBoolean(out, "i", options.interactive, defaults.interactive);
  addBoolean(out, "ar", options.animate, defaults.animate);
  addBoolean(out, "axes", options.showAxes, defaults.showAxes);
  addBoolean(out, "sel", options.selection, defaults.selection);
  addBoolean(out, "hov", options.hoverEffects, defaults.hoverEffects);
  addBoolean(out, "helper", options.showLight, defaults.showLight);
  addNumber(out, "z", options.zoom, defaults.zoom);
  addNumber(out, "rx", options.rotX, defaults.rotX);
  addNumber(out, "ry", options.rotY, defaults.rotY);
  if (!samePerspective(options.perspective, defaults.perspective)) {
    if (options.perspective === false) out.p = false;
    else if (typeof options.perspective === "number") out.p = round(options.perspective);
  }
  addNumber(out, "az", options.lightAzimuth, defaults.lightAzimuth);
  addNumber(out, "el", options.lightElevation, defaults.lightElevation);
  addNumber(out, "key", options.lightIntensity, defaults.lightIntensity);
  addString(out, "kc", options.lightColor, defaults.lightColor);
  addNumber(out, "amb", options.ambientIntensity, defaults.ambientIntensity);
  addString(out, "amc", options.ambientColor, defaults.ambientColor);
  addString(out, "tl", options.textureLighting, defaults.textureLighting);
  if (!sameTextureQuality(options.textureQuality, defaults.textureQuality)) {
    out.tq = typeof options.textureQuality === "number" ? round(options.textureQuality) : options.textureQuality;
  }
  addBoolean(out, "solid", options.solidMaterials, defaults.solidMaterials);
  addString(out, "mp", options.matrixPrecision, defaults.matrixPrecision);
  addString(out, "bp", options.borderShapePrecision, defaults.borderShapePrecision);
  addString(out, "mr", options.meshResolution, defaults.meshResolution);
  addBoolean(out, "fill", options.interiorFill, defaults.interiorFill);
  addBoolean(out, "outline", options.outlinePolygons, defaults.outlinePolygons);
  addString(out, "drag", options.dragMode, defaults.dragMode);
  if (!sameVec3(options.target, defaults.target)) out.t = roundVec3(options.target);
  const currentStrategies = strategiesPayload(options.disableStrategies);
  if (currentStrategies !== strategiesPayload(defaults.disableStrategies)) out.ds = currentStrategies;
  addBoolean(out, "shadow", options.castShadow, defaults.castShadow);
  addNumber(out, "reach", options.shadowMaxExtend, defaults.shadowMaxExtend);
  addBoolean(out, "ground", options.showGround, defaults.showGround);
  addString(out, "gc", options.groundColor, defaults.groundColor);
  addBoolean(out, "fl", options.fpvLook, defaults.fpvLook);
  addBoolean(out, "fm", options.fpvMove, defaults.fpvMove);
  addBoolean(out, "fj", options.fpvJump, defaults.fpvJump);
  addBoolean(out, "fc", options.fpvCrouch, defaults.fpvCrouch);
  addNumber(out, "fms", options.fpvMoveSpeed, defaults.fpvMoveSpeed);
  addNumber(out, "fjv", options.fpvJumpVelocity, defaults.fpvJumpVelocity);
  addNumber(out, "fg", options.fpvGravity, defaults.fpvGravity);
  addNumber(out, "feh", options.fpvEyeHeight, defaults.fpvEyeHeight);
  addNumber(out, "fch", options.fpvCrouchHeight, defaults.fpvCrouchHeight);
  addNumber(out, "fls", options.fpvLookSensitivity, defaults.fpvLookSensitivity);
  addBoolean(out, "fiy", options.fpvInvertY, defaults.fpvInvertY);
  addNumber(out, "frd", options.fpvRenderDistance, defaults.fpvRenderDistance);
  return Object.keys(out).length > 0 ? out : undefined;
}

function encodeCompactNumber(value: number): string {
  return Math.round(round(value) * COMPACT_NUMBER_SCALE).toString(36);
}

function decodeCompactNumber(value: string): number | undefined {
  if (!/^-?[0-9a-z]+$/i.test(value)) return undefined;
  const sign = value.startsWith("-") ? -1 : 1;
  const digits = sign === -1 ? value.slice(1) : value;
  const parsed = Number.parseInt(digits, 36);
  if (!Number.isFinite(parsed)) return undefined;
  return round((sign * parsed) / COMPACT_NUMBER_SCALE);
}

function encodePackedNumber(value: number): string {
  const encoded = encodeCompactNumber(value);
  return `${encoded.length.toString(36)}${encoded}`;
}

function encodeCompactColor(value: string): string | undefined {
  const hex = value.replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex)) return undefined;
  return Number.parseInt(hex, 16).toString(36).padStart(5, "0");
}

function decodeCompactColor(value: string): string | undefined {
  if (!/^[0-9a-z]{5}$/i.test(value)) return undefined;
  const parsed = Number.parseInt(value, 36);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xffffff) return undefined;
  return `#${parsed.toString(16).padStart(6, "0")}`;
}

function readPackedNumber(value: string, index: number): { value: number; next: number } | undefined {
  const length = Number.parseInt(value[index] ?? "", 36);
  if (!Number.isFinite(length) || length <= 0) return undefined;
  const start = index + 1;
  const end = start + length;
  if (end > value.length) return undefined;
  const decoded = decodeCompactNumber(value.slice(start, end));
  return decoded === undefined ? undefined : { value: decoded, next: end };
}

function encodeEnum<T extends string>(value: T, values: Record<T, string>): string {
  return values[value];
}

function decodeEnum<T extends string>(value: string, values: Record<T, string>): T | undefined {
  for (const [decoded, encoded] of Object.entries(values)) {
    if (encoded === value) return decoded as T;
  }
  return undefined;
}

function strategiesMask(strategies: string): string {
  let mask = 0;
  if (strategies.includes("b")) mask |= 1;
  if (strategies.includes("i")) mask |= 2;
  if (strategies.includes("u")) mask |= 4;
  return mask.toString(36);
}

function strategiesFromMask(value: string): string | undefined {
  if (!/^[0-7]$/.test(value)) return undefined;
  const mask = Number.parseInt(value, 36);
  return STRATEGY_ORDER.filter((strategy, index) => (mask & (1 << index)) !== 0).join("");
}

function encodeCompactValue(key: SerializedGallerySceneOptionKey, value: SerializedGallerySceneOptions[SerializedGallerySceneOptionKey]): string | undefined {
  if (typeof value === "boolean") return value ? "" : "0";
  if (typeof value === "number") return encodePackedNumber(value);
  if (key === "p") return value === false ? "n" : typeof value === "number" ? encodePackedNumber(value) : undefined;
  if (key === "t" && isVec3(value)) return value.map(encodePackedNumber).join("");
  if (key === "kc" || key === "amc" || key === "gc") return typeof value === "string" ? encodeCompactColor(value) : undefined;
  if (key === "ds") return typeof value === "string" ? strategiesMask(value) : undefined;
  if (key === "r" && (value === "react" || value === "vanilla")) return encodeEnum(value, { react: "r", vanilla: "v" });
  if (key === "tl" && (value === "baked" || value === "dynamic")) return encodeEnum(value, { baked: "b", dynamic: "d" });
  if (key === "tq") {
    if (value === "auto") return "a";
    return typeof value === "number" ? encodePackedNumber(value) : undefined;
  }
  if (key === "mp" || key === "bp") return value === "exact" ? "e" : typeof value === "string" ? value : undefined;
  if (key === "mr" && (value === "lossless" || value === "lossy" || value === "disabled")) {
    return encodeEnum(value, { lossless: "x", lossy: "y", disabled: "d" });
  }
  if (key === "drag" && (value === "orbit" || value === "pan" || value === "fpv")) {
    return encodeEnum(value, { orbit: "o", pan: "p", fpv: "f" });
  }
  return typeof value === "string" ? value : undefined;
}

function encodeCompactScene(payload: SerializedGallerySceneOptions): string {
  const tokens: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(payload)) {
    const key = rawKey as SerializedGallerySceneOptionKey;
    const compactKey = COMPACT_KEY_BY_OPTION[key];
    const value = encodeCompactValue(key, rawValue as SerializedGallerySceneOptions[SerializedGallerySceneOptionKey]);
    if (!compactKey || value === undefined) continue;
    tokens.push(`${compactKey}${value}`);
  }
  return `${COMPACT_SCENE_VERSION}${tokens.join("")}`;
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(value: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isRenderer(value: unknown): value is SceneOptionsState["renderer"] {
  return value === "react" || value === "vanilla";
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isTextureLighting(value: unknown): value is SceneOptionsState["textureLighting"] {
  return value === "baked" || value === "dynamic";
}

function isTextureQuality(value: unknown): value is SceneOptionsState["textureQuality"] {
  return value === "auto" || (isFiniteNumber(value) && value >= 0.1 && value <= 1);
}

function isMatrixPrecision(value: unknown): value is SceneOptionsState["matrixPrecision"] {
  return value === "exact" || value === "2" || value === "3" || value === "4" || value === "5" || value === "6";
}

function isBorderShapePrecision(value: unknown): value is SceneOptionsState["borderShapePrecision"] {
  return isMatrixPrecision(value);
}

function isMeshResolution(value: unknown): value is SceneOptionsState["meshResolution"] {
  return value === "lossless" || value === "lossy" || value === "disabled";
}

function isDragMode(value: unknown): value is SceneOptionsState["dragMode"] {
  return value === "orbit" || value === "pan" || value === "fpv";
}

function isVec3(value: unknown): value is SceneTarget {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function routeStrategies(value: unknown): SceneOptionsState["disableStrategies"] | undefined {
  if (typeof value !== "string") return undefined;
  const strategies = STRATEGY_ORDER.filter((strategy) => value.includes(strategy));
  return strategies.length > 0 ? [...strategies] : [];
}

function sceneOptionsFromPayload(o: SerializedGallerySceneOptions): Partial<SceneOptionsState> {
  const disableStrategies = routeStrategies(o.ds);
  return {
    ...(isRenderer(o.r) ? { renderer: o.r } : null),
    ...(isBoolean(o.ap) ? { animationPaused: o.ap } : null),
    ...(isFiniteNumber(o.ats) ? { animationTimeScale: o.ats } : null),
    ...(isBoolean(o.c) ? { autoCenter: o.c } : null),
    ...(isBoolean(o.i) ? { interactive: o.i } : null),
    ...(isBoolean(o.ar) ? { animate: o.ar } : null),
    ...(isBoolean(o.axes) ? { showAxes: o.axes } : null),
    ...(isBoolean(o.sel) ? { selection: o.sel } : null),
    ...(isBoolean(o.hov) ? { hoverEffects: o.hov } : null),
    ...(isBoolean(o.helper) ? { showLight: o.helper } : null),
    ...(isFiniteNumber(o.z) ? { zoom: o.z } : null),
    ...(isFiniteNumber(o.rx) ? { rotX: o.rx } : null),
    ...(isFiniteNumber(o.ry) ? { rotY: o.ry } : null),
    ...((o.p === false || isFiniteNumber(o.p)) ? { perspective: o.p } : null),
    ...(isFiniteNumber(o.az) ? { lightAzimuth: o.az } : null),
    ...(isFiniteNumber(o.el) ? { lightElevation: o.el } : null),
    ...(isFiniteNumber(o.key) ? { lightIntensity: o.key } : null),
    ...(isHexColor(o.kc) ? { lightColor: o.kc.toLowerCase() } : null),
    ...(isFiniteNumber(o.amb) ? { ambientIntensity: o.amb } : null),
    ...(isHexColor(o.amc) ? { ambientColor: o.amc.toLowerCase() } : null),
    ...(isTextureLighting(o.tl) ? { textureLighting: o.tl } : null),
    ...(isTextureQuality(o.tq) ? { textureQuality: o.tq } : null),
    ...(isBoolean(o.solid) ? { solidMaterials: o.solid } : null),
    ...(isMatrixPrecision(o.mp) ? { matrixPrecision: o.mp } : null),
    ...(isBorderShapePrecision(o.bp) ? { borderShapePrecision: o.bp } : null),
    ...(isMeshResolution(o.mr) ? { meshResolution: o.mr } : null),
    ...(isBoolean(o.fill) ? { interiorFill: o.fill } : null),
    ...(isBoolean(o.outline) ? { outlinePolygons: o.outline } : null),
    ...(isDragMode(o.drag) ? { dragMode: o.drag } : null),
    ...(isVec3(o.t) ? { target: roundVec3(o.t) } : null),
    ...(disableStrategies ? { disableStrategies } : null),
    ...(isBoolean(o.shadow) ? { castShadow: o.shadow } : null),
    ...(isFiniteNumber(o.reach) ? { shadowMaxExtend: o.reach } : null),
    ...(isBoolean(o.ground) ? { showGround: o.ground } : null),
    ...(isHexColor(o.gc) ? { groundColor: o.gc.toLowerCase() } : null),
    ...(isBoolean(o.fl) ? { fpvLook: o.fl } : null),
    ...(isBoolean(o.fm) ? { fpvMove: o.fm } : null),
    ...(isBoolean(o.fj) ? { fpvJump: o.fj } : null),
    ...(isBoolean(o.fc) ? { fpvCrouch: o.fc } : null),
    ...(isFiniteNumber(o.fms) ? { fpvMoveSpeed: o.fms } : null),
    ...(isFiniteNumber(o.fjv) ? { fpvJumpVelocity: o.fjv } : null),
    ...(isFiniteNumber(o.fg) ? { fpvGravity: o.fg } : null),
    ...(isFiniteNumber(o.feh) ? { fpvEyeHeight: o.feh } : null),
    ...(isFiniteNumber(o.fch) ? { fpvCrouchHeight: o.fch } : null),
    ...(isFiniteNumber(o.fls) ? { fpvLookSensitivity: o.fls } : null),
    ...(isBoolean(o.fiy) ? { fpvInvertY: o.fiy } : null),
    ...(isFiniteNumber(o.frd) ? { fpvRenderDistance: o.frd } : null),
  };
}

function decodeDottedCompactValue(key: SerializedGallerySceneOptionKey, value: string): SerializedGallerySceneOptions[SerializedGallerySceneOptionKey] | undefined {
  if (BOOLEAN_OPTIONS.has(key)) return value === "" || value === "1" ? true : value === "0" ? false : undefined;
  if (key === "p") return value === "n" ? false : decodeCompactNumber(value);
  if (key === "t") {
    const values = value.split("_").map(decodeCompactNumber);
    return values.length === 3 && values.every((entry) => entry !== undefined)
      ? values as SceneTarget
      : undefined;
  }
  if (key === "kc" || key === "amc" || key === "gc") return /^[0-9a-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : undefined;
  if (key === "ds") return strategiesFromMask(value) ?? (value === "-" ? "" : value);
  if (key === "r") return decodeEnum(value, { react: "r", vanilla: "v" });
  if (key === "tl") return decodeEnum(value, { baked: "b", dynamic: "d" });
  if (key === "tq") return value === "a" ? "auto" : decodeCompactNumber(value);
  if (key === "mp" || key === "bp") return value === "e" ? "exact" : value;
  if (key === "mr") return decodeEnum(value, { lossless: "x", lossy: "y", disabled: "d" });
  if (key === "drag") return decodeEnum(value, { orbit: "o", pan: "p", fpv: "f" });
  return decodeCompactNumber(value) ?? value;
}

function decodeDottedCompactRouteSceneOptions(routeValue: string): Partial<SceneOptionsState> | null {
  const tokens = routeValue.split(".");
  if (tokens[0] !== COMPACT_SCENE_VERSION || tokens.length < 2) return null;
  const payload: SerializedGallerySceneOptions = {};
  for (const token of tokens.slice(1)) {
    const compactKey = Object.keys(DOTTED_COMPACT_OPTION_BY_KEY)
      .sort((a, b) => b.length - a.length)
      .find((key) => token.startsWith(key));
    if (!compactKey) continue;
    const optionKey = DOTTED_COMPACT_OPTION_BY_KEY[compactKey];
    const encodedValue = token.slice(compactKey.length);
    if (!optionKey) continue;
    const decodedValue = decodeDottedCompactValue(optionKey, encodedValue);
    if (decodedValue !== undefined) {
      (payload as Record<string, unknown>)[optionKey] = decodedValue;
    }
  }
  return Object.keys(payload).length > 0 ? sceneOptionsFromPayload(payload) : null;
}

function readPackedValue(
  key: SerializedGallerySceneOptionKey,
  routeValue: string,
  index: number,
): { value: SerializedGallerySceneOptions[SerializedGallerySceneOptionKey]; next: number } | undefined {
  if (BOOLEAN_OPTIONS.has(key)) {
    return routeValue[index] === "0"
      ? { value: false, next: index + 1 }
      : { value: true, next: index };
  }
  if (key === "p") {
    if (routeValue[index] === "n") return { value: false, next: index + 1 };
    return readPackedNumber(routeValue, index);
  }
  if (key === "t") {
    const x = readPackedNumber(routeValue, index);
    if (!x) return undefined;
    const y = readPackedNumber(routeValue, x.next);
    if (!y) return undefined;
    const z = readPackedNumber(routeValue, y.next);
    return z ? { value: [x.value, y.value, z.value], next: z.next } : undefined;
  }
  if (key === "kc" || key === "amc" || key === "gc") {
    const color = decodeCompactColor(routeValue.slice(index, index + 5));
    return color ? { value: color, next: index + 5 } : undefined;
  }
  if (key === "ds") {
    const strategies = strategiesFromMask(routeValue[index] ?? "");
    return strategies === undefined ? undefined : { value: strategies, next: index + 1 };
  }
  if (key === "r") {
    const value = decodeEnum(routeValue[index] ?? "", { react: "r", vanilla: "v" });
    return value ? { value, next: index + 1 } : undefined;
  }
  if (key === "tl") {
    const value = decodeEnum(routeValue[index] ?? "", { baked: "b", dynamic: "d" });
    return value ? { value, next: index + 1 } : undefined;
  }
  if (key === "tq") {
    if (routeValue[index] === "a") return { value: "auto", next: index + 1 };
    return readPackedNumber(routeValue, index);
  }
  if (key === "mp" || key === "bp") {
    const value = routeValue[index];
    return value ? { value: value === "e" ? "exact" : value, next: index + 1 } : undefined;
  }
  if (key === "mr") {
    const value = decodeEnum(routeValue[index] ?? "", { lossless: "x", lossy: "y", disabled: "d" });
    return value ? { value, next: index + 1 } : undefined;
  }
  if (key === "drag") {
    const value = decodeEnum(routeValue[index] ?? "", { orbit: "o", pan: "p", fpv: "f" });
    return value ? { value, next: index + 1 } : undefined;
  }
  return readPackedNumber(routeValue, index);
}

function decodePackedCompactRouteSceneOptions(routeValue: string): Partial<SceneOptionsState> | null {
  if (!routeValue.startsWith(COMPACT_SCENE_VERSION) || routeValue.startsWith(`${COMPACT_SCENE_VERSION}.`)) return null;
  const payload: SerializedGallerySceneOptions = {};
  let index = COMPACT_SCENE_VERSION.length;
  while (index < routeValue.length) {
    const optionKey = COMPACT_OPTION_BY_KEY[routeValue[index]];
    index += 1;
    if (!optionKey) return null;
    const decoded = readPackedValue(optionKey, routeValue, index);
    if (!decoded) return null;
    (payload as Record<string, unknown>)[optionKey] = decoded.value;
    index = decoded.next;
  }
  return Object.keys(payload).length > 0 ? sceneOptionsFromPayload(payload) : null;
}

function decodeLegacyRouteSceneOptions(routeValue: string): Partial<SceneOptionsState> | null {
  try {
    const decoded = decodeJson(routeValue);
    if (!decoded || typeof decoded !== "object") return null;
    const scene = decoded as Partial<SerializedGalleryScene>;
    if (scene.v !== 1 || !scene.o || typeof scene.o !== "object") return null;
    return sceneOptionsFromPayload(scene.o);
  } catch {
    return null;
  }
}

function decodeRouteSceneOptions(routeValue: string): Partial<SceneOptionsState> | null {
  if (!routeValue) return null;
  return decodePackedCompactRouteSceneOptions(routeValue) ??
    decodeDottedCompactRouteSceneOptions(routeValue) ??
    decodeLegacyRouteSceneOptions(routeValue);
}

function writeRouteParams(params: URLSearchParams): void {
  if (typeof window === "undefined") return;
  const newSearch = params.toString();
  const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ""}${window.location.hash}`;
  if (newUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, "", newUrl);
  }
}

function resolveRoutePresetId(routeValue: string, presetIds: string[]): string {
  const value = typeof routeValue === "string" ? routeValue.trim() : "";
  if (!value) return "";

  if (/^\d+$/.test(value)) {
    const found = presetIds.find((id) => routeIdForPresetId(id) === value);
    if (found) return found;
  }

  return presetIds.find((id) => id === value) ?? "";
}

export function setRoutePresetId(presetId: string | null): void {
  if (typeof window === "undefined") return;
  const next = presetId ? routeIdForPresetId(presetId) : "";
  const current = getRoutePresetValue();
  if (next === current) return;

  const params = new URLSearchParams(window.location.search);
  if (next) params.set(MODEL_PARAM, next);
  else params.delete(MODEL_PARAM);

  writeRouteParams(params);
}

export function routeInitialSceneOptions(): Partial<SceneOptionsState> {
  return decodeRouteSceneOptions(getRouteSceneValue()) ?? {};
}

export function routeHasSceneOptions(): boolean {
  return decodeRouteSceneOptions(getRouteSceneValue()) !== null;
}

export function setRouteSceneOptions({
  sceneOptions,
  sceneDefaults,
  presetId,
}: {
  sceneOptions: SceneOptionsState;
  sceneDefaults: SceneOptionsState;
  presetId: string | null;
}): void {
  if (typeof window === "undefined") return;
  const payload = sceneOptionsPayload(sceneOptions, sceneDefaults);
  const params = new URLSearchParams(window.location.search);
  if (presetId) params.set(MODEL_PARAM, routeIdForPresetId(presetId));
  else params.delete(MODEL_PARAM);
  if (payload) params.set(SCENE_PARAM, encodeCompactScene(payload));
  else params.delete(SCENE_PARAM);
  writeRouteParams(params);
}

export function clearRouteSceneOptions(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.delete(SCENE_PARAM);
  writeRouteParams(params);
}

export function routeInitialPresetId(presetIds: string[]): string {
  const routeValue = getRoutePresetValue();
  return resolveRoutePresetId(routeValue, presetIds);
}

export interface UseRouteSyncOptions {
  presetId: string;
  presetIds: string[];
  resetToPreset: (id: string) => void;
  sceneDefaultsForPreset?: (id: string) => SceneOptionsState;
  setSceneOptions?: Dispatch<SetStateAction<SceneOptionsState>>;
}

export function useRouteSync({
  presetId,
  presetIds,
  resetToPreset,
  sceneDefaultsForPreset,
  setSceneOptions,
}: UseRouteSyncOptions): void {
  useEffect(() => {
    const routeValue = getRoutePresetValue();
    if (routeValue) {
      const routePresetId = resolveRoutePresetId(routeValue, presetIds);
      if (routePresetId) {
        setRoutePresetId(routePresetId);
      } else {
        setRoutePresetId(null);
      }
    }

    const handlePopState = () => {
      const nextRouteValue = getRoutePresetValue();
      const nextPresetId = nextRouteValue ? resolveRoutePresetId(nextRouteValue, presetIds) : "";
      if (nextRouteValue && !nextPresetId) {
        setRoutePresetId(null);
        return;
      }
      if (nextPresetId && nextPresetId !== presetId) {
        resetToPreset(nextPresetId);
      }
      const nextSceneOptions = decodeRouteSceneOptions(getRouteSceneValue());
      if (nextSceneOptions && setSceneOptions) {
        setSceneOptions((current) => ({
          ...(nextPresetId && sceneDefaultsForPreset ? sceneDefaultsForPreset(nextPresetId) : current),
          ...nextSceneOptions,
        }));
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [presetId, presetIds, resetToPreset, sceneDefaultsForPreset, setSceneOptions]);
}
