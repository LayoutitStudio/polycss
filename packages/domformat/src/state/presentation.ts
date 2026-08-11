import { invariant } from "../errors.js";
import { cssNumber } from "./numeric.js";
import type { DomBindings } from "../public-types.js";
import type { MountedTree } from "../retained-dom.js";

interface PresentationParameters {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly fitWidth: number;
  readonly fitHeight: number;
}

type BoundPresentationTargets = Readonly<Record<string, HTMLElement>>;

export interface StaticPresentation extends PresentationParameters {
  publishAppearance(appearance: unknown): void;
  resize(): void;
  sourcePoint(x: number, y: number, width: number, height: number): Readonly<{ x: number; y: number }>;
  viewportPoint(x: number, y: number, width: number, height: number): Readonly<{ x: number; y: number; scale: number }>;
}

export function createStaticPresentation(
  bindings: DomBindings,
  mounted: MountedTree,
  options: {
    readonly boundTargets?: ReadonlyMap<string, Readonly<{ targets: unknown }>>;
    readonly viewportWidth?: number;
    readonly viewportHeight?: number;
  } = {},
): StaticPresentation {
  const binding = bindings.channels.find((channel) => channel.interpreter === "static-presentation@0");
  invariant(binding, "MISSING_POLYCSS_BINDING", "Executable presentation binding is required.");
  const bound = options.boundTargets?.get(binding.id)?.targets as BoundPresentationTargets | undefined;
  const host = bound?.host ?? mounted.host;
  const cameraTarget = binding.targets.camera;
  invariant(typeof cameraTarget === "string", "MISSING_TARGET_NODE", "Presentation camera target is invalid.");
  const camera = bound?.camera ?? mounted.byId.get(cameraTarget);
  invariant(host && camera, "MISSING_TARGET_NODE", "Presentation host and camera targets are not mounted.");
  const parameters = binding.parameters as unknown as PresentationParameters;
  let appearanceScale = 1;
  let appearanceTranslateY = 0;

  const layout = (width: number, height: number) => {
    const sourceScale = Math.min(width / parameters.fitWidth, height / parameters.fitHeight);
    const scale = sourceScale * appearanceScale;
    return {
      left: width / 2 - parameters.sourceWidth * scale / 2,
      scale,
      top: height / 2 - parameters.sourceHeight * scale / 2 + appearanceTranslateY * sourceScale,
    };
  };

  const apply = () => {
    const width = host.clientWidth || options.viewportWidth || parameters.sourceWidth;
    const height = host.clientHeight || options.viewportHeight || parameters.sourceHeight;
    const next = layout(width, height);
    camera.style.left = `${cssNumber(next.left)}px`;
    camera.style.top = `${cssNumber(next.top)}px`;
    camera.style.width = `${parameters.sourceWidth}px`;
    camera.style.height = `${parameters.sourceHeight}px`;
    camera.style.transform = next.scale === 1 ? "" : `scale(${cssNumber(next.scale)})`;
  };

  return Object.freeze({
    ...parameters,
    publishAppearance(appearance: unknown) {
      invariant(Array.isArray(appearance), "INVALID_PRESENTATION_PUBLICATION", "Presentation appearance is invalid.");
      const values = appearance as unknown[];
      invariant(values.length === 3 && typeof values[1] === "number" && Number.isFinite(values[1]) && values[1] > 0 && typeof values[2] === "number" && Number.isFinite(values[2]), "INVALID_PRESENTATION_PUBLICATION", "Presentation appearance is invalid.");
      appearanceScale = values[1];
      appearanceTranslateY = values[2];
      apply();
    },
    resize: apply,
    sourcePoint(x: number, y: number, width: number, height: number) {
      const next = layout(width, height);
      return Object.freeze({ x: (x - next.left) / next.scale, y: (y - next.top) / next.scale });
    },
    viewportPoint(x: number, y: number, width: number, height: number) {
      const next = layout(width, height);
      return Object.freeze({ x: next.left + x * next.scale, y: next.top + y * next.scale, scale: next.scale });
    },
  });
}
