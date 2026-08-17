import { invariant } from "./errors.js";
import type { DomBindings, DomDocument, DomState } from "./public-types.js";

export const DOMFORMAT_NODE_ATTRIBUTE = "data-domformat-node";
export const NO_VARIANT_EFFECT_TARGET = 0xffff;

export const VARIANT_EFFECT_PROPERTIES = Object.freeze({
  backgroundColor: Object.freeze({ css: "background-color", sink: "style.backgroundColor" }),
  backgroundPositionX: Object.freeze({ css: "background-position-x", sink: "style.backgroundPositionX" }),
  color: Object.freeze({ css: "color", sink: "style.color" }),
  display: Object.freeze({ css: "display", sink: "style.display" }),
  outlineColor: Object.freeze({ css: "outline-color", sink: "style.outlineColor" }),
});

export type VariantEffectProperty = keyof typeof VARIANT_EFFECT_PROPERTIES;

interface VariantEffect {
  readonly classIndex: number;
  readonly ownerIndex: number;
  readonly targetIndex: number;
  readonly styles: Readonly<Partial<Record<VariantEffectProperty, string>>>;
}

interface VariantPacketWithEffects {
  readonly classes: readonly string[];
  readonly effects: readonly VariantEffect[];
}

interface VariantTargetsWithEffects {
  readonly nodes: readonly string[];
  readonly effectNodes: readonly string[];
}

function variantPacket(state: DomState): VariantPacketWithEffects | null {
  const channel = state.channels.find((entry) => entry.codec === "polycss-variants-packed@0" || entry.codec === "polycss-paged-variants@0");
  if (!channel) return null;
  return (channel.data as unknown as { readonly packet: VariantPacketWithEffects }).packet;
}

export function preparedVariantClassTokens(state: DomState): ReadonlySet<string> {
  return new Set(variantPacket(state)?.classes ?? []);
}

export function materializeVariantEffectsCss(document: DomDocument, scope: string): string {
  const packet = variantPacket(document.state);
  if (!packet) return "";
  const binding = document.bindings.channels.find((entry) => entry.interpreter === "polycss-variants@0" || entry.interpreter === "polycss-paged-variants@0");
  invariant(binding, "MISSING_POLYCSS_BINDING", "Prepared variant effects require a matching binding.");
  const targets = binding.targets as unknown as VariantTargetsWithEffects;
  const nodesById = new Map(document.tree.nodes.map((node) => [node.id, node]));
  const rules: string[] = [];
  for (const effect of packet.effects) {
    const owner = nodesById.get(targets.nodes[effect.ownerIndex]);
    const target = effect.targetIndex === NO_VARIANT_EFFECT_TARGET
      ? owner
      : nodesById.get(targets.effectNodes[effect.targetIndex]);
    invariant(owner && target, "INVALID_VARIANT_EFFECT", "Prepared variant effect targets are absent after validation.");
    const ownerSelector = `[${DOMFORMAT_NODE_ATTRIBUTE}="${owner.index}"].${packet.classes[effect.classIndex]}`;
    const targetSelector = target === owner ? ownerSelector : `${ownerSelector} [${DOMFORMAT_NODE_ATTRIBUTE}="${target.index}"]`;
    const declarations = Object.entries(effect.styles).map(([property, value]) => {
      const definition = VARIANT_EFFECT_PROPERTIES[property as VariantEffectProperty];
      invariant(definition && typeof value === "string", "INVALID_VARIANT_EFFECT", "Prepared variant effect styles are invalid after validation.");
      return `${definition.css}:${value}`;
    });
    rules.push(`${scope} ${targetSelector}{${declarations.join(";")}}`);
  }
  return rules.join("\n");
}

export function variantBindingTargets(bindings: DomBindings): VariantTargetsWithEffects | null {
  const binding = bindings.channels.find((entry) => entry.interpreter === "polycss-variants@0" || entry.interpreter === "polycss-paged-variants@0");
  return binding ? binding.targets as unknown as VariantTargetsWithEffects : null;
}
