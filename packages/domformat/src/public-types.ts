export type DomJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly DomJsonValue[]
  | { readonly [key: string]: DomJsonValue };

import type { DomLimitOverrides as LimitOverrides } from "./constants.js";

export type DomLimitOverrides = LimitOverrides;
export type DomBytes = ArrayBuffer | ArrayBufferView;
export type DomResourceInputBytes = string | DomBytes;

export interface DomMeta {
  readonly format: "domformat@0";
  readonly profile: "polycss-3d@0";
  readonly title: string;
  readonly generator: Readonly<{ name: string; version: string }>;
  readonly capabilities: readonly string[];
  readonly optionalCapabilities?: readonly string[];
  readonly initialExperience?: "animation" | "interaction";
  readonly conformance: Readonly<{
    executable: readonly string[];
    declaredOnly: readonly string[];
  }>;
  readonly counts?: Readonly<{
    nodes?: number;
    shapes?: number;
    leaves?: number;
    sourceFrames?: number;
  }>;
  readonly sourceArtifact?: Readonly<{
    byteLength: number;
    decodedByteLength: number;
    digest: Readonly<{ algorithm: "sha256"; value: string }>;
    status: string;
  }>;
}

export interface DomTreeNode {
  readonly id: string;
  readonly index: number;
  readonly parent: number;
  readonly sibling: number;
  readonly namespace: string;
  readonly name: string;
  readonly classes?: readonly string[];
  readonly attributes?: Readonly<Record<string, string>>;
  readonly styles?: Readonly<Record<string, string>>;
  readonly resourceAttributes?: Readonly<Record<string, string>>;
  readonly resourceStyles?: Readonly<Record<string, Readonly<{
    resource: string;
    syntax: "url" | "overlay-url";
    overlayOpacity?: number;
  }>>>;
}

export interface DomTree {
  readonly version: 0;
  readonly mount: Readonly<{
    behavior: "replace-children";
    attributes: readonly (readonly [string, string])[];
    styles?: Readonly<Record<string, string>>;
    resourceStyles?: DomTreeNode["resourceStyles"];
  }>;
  readonly nodes: readonly DomTreeNode[];
}

export interface DomStylesheetBinding {
  readonly id: string;
  readonly resource: string;
  readonly scope: string;
  readonly assetTokens: readonly Readonly<{ token: string; resource: string }>[];
}

export interface DomCssBinding {
  readonly version: 0;
  readonly stylesheets: readonly DomStylesheetBinding[];
}

export interface DomStateChannel {
  readonly id: string;
  readonly codec: string;
  readonly data: Readonly<Record<string, DomJsonValue>>;
}

export interface DomState {
  readonly version: 0;
  readonly channels: readonly DomStateChannel[];
}

export interface DomBindingTargetGroup {
  readonly [key: string]: DomBindingTarget;
}

export type DomBindingTarget = string | readonly DomBindingTarget[] | DomBindingTargetGroup;

export interface DomBindingInput {
  readonly id: string;
  readonly type: "boolean" | "float" | "uint";
  readonly default?: boolean | number;
}

export interface DomBindingChannel {
  readonly id: string;
  readonly state: string;
  readonly interpreter: string;
  readonly status: "executable";
  readonly inputs: readonly string[];
  readonly targets: Readonly<Record<string, DomBindingTarget>>;
  readonly sinks: readonly string[];
  readonly parameters?: Readonly<Record<string, DomJsonValue>>;
}

export interface DomBindings {
  readonly version: 0;
  readonly inputs: readonly DomBindingInput[];
  readonly channels: readonly DomBindingChannel[];
}

export interface DomResourceRecord {
  readonly id: string;
  readonly kind: "stylesheet" | "image";
  readonly mediaType: string;
  readonly byteLength: number;
  readonly digest: Readonly<{ algorithm: "sha256"; value: string }>;
  readonly path: string;
  readonly dimensions?: Readonly<{ width: number; height: number }>;
}

export interface DomResourceCatalog {
  readonly version: 0;
  readonly resources: readonly DomResourceRecord[];
}

export interface DomDocument {
  readonly meta: DomMeta;
  readonly tree: DomTree;
  readonly cssBinding: DomCssBinding;
  readonly state: DomState;
  readonly bindings: DomBindings;
  readonly resources: DomResourceCatalog;
}

export interface DomWriterInput {
  readonly meta: Omit<DomMeta, "format" | "profile" | "generator">;
  readonly tree: DomTree;
  readonly cssBinding: DomCssBinding;
  readonly state: DomState;
  readonly bindings: DomBindings;
  readonly resourceInputs: readonly Readonly<{
    id: string;
    kind: "stylesheet" | "image";
    mediaType: string;
    path: string;
    bytes: DomResourceInputBytes;
  }>[];
}

export interface DomTransport {
  readonly encoding: "json";
  readonly totalLength: number;
  readonly decodedLength: number;
  readonly bytes: Uint8Array;
}

export interface DomReadResult {
  readonly transport: DomTransport;
  readonly document: DomDocument;
  readonly resourceBytes: Map<string, Uint8Array>;
  readonly externalMissing: readonly string[];
}

export interface DomBrowserReadResult extends Omit<DomReadResult, "externalMissing"> {}

export interface DomBuildResult {
  readonly bytes: Uint8Array;
  readonly document: DomDocument;
  readonly externalResources: Map<string, Uint8Array>;
}

export interface DomReadOptions {
  readonly limits?: DomLimitOverrides;
  readonly externalResources?: Map<string, DomBytes>;
  readonly requireResources?: boolean;
}

export interface DomReadFileOptions {
  readonly limits?: DomLimitOverrides;
  readonly loadExternal?: boolean;
  readonly requireResources?: boolean;
}

export interface DomBrowserReadOptions {
  readonly limits?: DomLimitOverrides;
  readonly signal?: AbortSignal;
  readonly externalResources?: Map<string, DomBytes>;
  readonly loadExternalResource?: (record: DomResourceRecord) => DomBytes | Promise<DomBytes>;
}

export interface DomBrowserUrlOptions extends DomBrowserReadOptions {
  readonly baseUrl?: string | URL;
  readonly fetch?: typeof fetch;
}

export type DomLifecyclePhase = "validate" | "construct" | "bind" | "initialize" | "publish" | "destroy";
export type DomExperienceMode = "animation" | "interaction";

export interface DomMountOptions {
  readonly animate?: boolean;
  readonly mode?: DomExperienceMode;
  readonly signal?: AbortSignal;
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
  readonly onLifecyclePhase?: (phase: DomLifecyclePhase) => void;
}

export interface DomMountRuntime {
  readonly lifecycle: Readonly<{
    readonly phase: DomLifecyclePhase;
    readonly history: readonly DomLifecyclePhase[];
  }>;
  readonly mode: DomExperienceMode;
  readonly sourceFrame: number;
  seek(frame: number): number;
  setMode(mode: DomExperienceMode): DomExperienceMode;
  destroy(): boolean;
}
