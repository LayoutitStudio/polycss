import { invariant } from "./errors.js";
import { DOMFORMAT_NODE_ATTRIBUTE } from "./variant-effects.js";
import type { DomDocument, DomTree, DomTreeNode } from "./public-types.js";

type ResourceStyleBinding = NonNullable<DomTreeNode["resourceStyles"]>[string];

export interface MountedTree {
  readonly document: Document;
  readonly host: HTMLElement;
  readonly tree: DomTree;
  readonly elements: readonly HTMLElement[];
  readonly byId: ReadonlyMap<string, HTMLElement>;
}

function resourceStyleValue(binding: ResourceStyleBinding, urls: ReadonlyMap<string, string>): string {
  const url = urls.get(binding.resource);
  invariant(typeof url === "string" && url.length > 0, "MISSING_RESOURCE_URL", `No URL is resolved for resource ${binding.resource}.`);
  if (binding.syntax === "url") return `url(${JSON.stringify(url)})`;
  invariant(typeof binding.overlayOpacity === "number", "INVALID_RESOURCE_STYLE", "Overlay resource styles require an opacity.");
  const overlay = 1 - binding.overlayOpacity;
  return `linear-gradient(rgba(0,0,0,${overlay}),rgba(0,0,0,${overlay})),url(${JSON.stringify(url)})`;
}

function applyStyleMap(element: HTMLElement, styles: Readonly<Record<string, string>> | undefined): void {
  const declaration = element.style as CSSStyleDeclaration & Record<string, string>;
  for (const [property, value] of Object.entries(styles ?? {})) declaration[property] = value;
}

function applyResourceStyles(
  element: HTMLElement,
  styles: DomTreeNode["resourceStyles"] | undefined,
  urls: ReadonlyMap<string, string>,
): void {
  const declaration = element.style as CSSStyleDeclaration & Record<string, string>;
  for (const [property, binding] of Object.entries(styles ?? {})) declaration[property] = resourceStyleValue(binding, urls);
}

export function applyInitialResources(mounted: MountedTree, urls: ReadonlyMap<string, string>): void {
  const { host, tree, elements } = mounted;
  applyResourceStyles(host, tree.mount.resourceStyles, urls);
  for (const node of tree.nodes) {
    const element = elements[node.index];
    for (const [name, resource] of Object.entries(node.resourceAttributes ?? {})) {
      const url = urls.get(resource);
      invariant(typeof url === "string" && url.length > 0, "MISSING_RESOURCE_URL", `No URL is resolved for resource ${resource}.`);
      element.setAttribute(name, url);
    }
    applyResourceStyles(element, node.resourceStyles, urls);
  }
}

export function instantiateTree(
  document: Document,
  host: HTMLElement,
  options: {
    readonly tree?: DomTree;
    readonly document?: DomDocument;
    readonly resourceUrls?: ReadonlyMap<string, string>;
  } = {},
): MountedTree {
  invariant(document && typeof document.createElementNS === "function", "INVALID_DOCUMENT_HOST", "A DOM Document is required.");
  invariant(host && typeof host.replaceChildren === "function", "INVALID_DOCUMENT_HOST", "A mount host is required.");
  const tree = options.tree ?? options.document?.tree;
  invariant(tree && Array.isArray(tree.nodes), "INVALID_TREE", "A validated TREE section is required.");
  host.replaceChildren();
  for (const [name, value] of tree.mount.attributes) host.setAttribute(name, value);
  applyStyleMap(host, tree.mount.styles);
  const elements: HTMLElement[] = [];
  const byId = new Map<string, HTMLElement>();
  for (const node of tree.nodes) {
    const element = document.createElementNS(node.namespace, node.name) as HTMLElement;
    element.setAttribute(DOMFORMAT_NODE_ATTRIBUTE, String(node.index));
    if (node.classes?.length) element.classList.add(...node.classes);
    if (node.attributes) {
      for (const [name, value] of Object.entries(node.attributes)) {
        invariant(typeof value === "string", "INVALID_ATTRIBUTE", `TREE attribute ${name} is not a string.`);
        element.setAttribute(name, value);
      }
    }
    applyStyleMap(element, node.styles);
    const parent = node.parent === -1 ? host : elements[node.parent];
    parent.appendChild(element);
    elements.push(element);
    byId.set(node.id, element);
  }
  const mounted = Object.freeze({ document, host, tree, elements: Object.freeze(elements), byId });
  if (options.resourceUrls) applyInitialResources(mounted, options.resourceUrls);
  return mounted;
}
