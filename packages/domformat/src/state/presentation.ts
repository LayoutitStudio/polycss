import { invariant } from "../errors.js";
import { cssNumber } from "./numeric.js";
import type { DomBindings } from "../public-types.js";
import type { MountedTree } from "../retained-dom.js";

interface PresentationParameters {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly fitWidth: number;
  readonly fitHeight: number;
  readonly profileSelection?: "viewport-width" | "landscape-first-portrait-width";
  readonly profiles?: readonly PresentationProfile[];
}

interface PresentationProfile {
  readonly id: string;
  readonly maxViewportWidth?: number;
  readonly fit: "contain" | "cover";
  readonly quarterTurns: number;
  readonly bounds: readonly number[];
  readonly safeInset: number;
  readonly bias: readonly number[];
}

type BoundPresentationTargets = Readonly<Record<string, HTMLElement>>;

export interface StaticPresentation extends PresentationParameters {
  readonly profileId: string;
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
  let profileId = "default";

  const rotate = (x: number, y: number, quarterTurns: number): readonly [number, number] => {
    if (quarterTurns === 1) return [-y, x];
    if (quarterTurns === 2) return [-x, -y];
    if (quarterTurns === 3) return [y, -x];
    return [x, y];
  };
  const cleanCoordinate = (value: number): number => {
    const rounded = Math.round(value);
    return Math.abs(value - rounded) <= 1e-12 ? rounded === 0 ? 0 : rounded : value;
  };

  const profileFor = (width: number, height: number): PresentationProfile | undefined => {
    const profiles = parameters.profiles;
    if (!profiles) return undefined;
    if (parameters.profileSelection === "landscape-first-portrait-width" && width > height) return profiles[0];
    const rows = parameters.profileSelection === "landscape-first-portrait-width" ? profiles.slice(1) : profiles;
    return rows.find((profile) => profile.maxViewportWidth === undefined || width < profile.maxViewportWidth);
  };

  const layout = (width: number, height: number) => {
    const profile = profileFor(width, height);
    if (profile) {
      profileId = profile.id;
      const [minX, minY, maxX, maxY] = profile.bounds;
      const sourceCenterX = parameters.sourceWidth / 2;
      const sourceCenterY = parameters.sourceHeight / 2;
      const [rotatedBoundsCenterX, rotatedBoundsCenterY] = rotate(
        (minX + maxX) / 2 - sourceCenterX,
        (minY + maxY) / 2 - sourceCenterY,
        profile.quarterTurns,
      );
      const oddQuarterTurn = profile.quarterTurns % 2 === 1;
      const boundsWidth = oddQuarterTurn ? maxY - minY : maxX - minX;
      const boundsHeight = oddQuarterTurn ? maxX - minX : maxY - minY;
      const availableWidth = Math.max(1, width - profile.safeInset * 2);
      const availableHeight = Math.max(1, height - profile.safeInset * 2);
      const fitScale = profile.fit === "contain"
        ? Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight)
        : Math.max(availableWidth / boundsWidth, availableHeight / boundsHeight);
      const scale = fitScale * appearanceScale;
      let centerX = width / 2 + profile.bias[0] * width;
      let centerY = height / 2 + profile.bias[1] * height + appearanceTranslateY * fitScale;
      if (profile.fit === "contain") {
        const halfWidth = boundsWidth * scale / 2;
        const halfHeight = boundsHeight * scale / 2;
        const minimumX = profile.safeInset + halfWidth;
        const maximumX = width - profile.safeInset - halfWidth;
        const minimumY = profile.safeInset + halfHeight;
        const maximumY = height - profile.safeInset - halfHeight;
        if (minimumX <= maximumX) centerX = Math.min(maximumX, Math.max(minimumX, centerX));
        if (minimumY <= maximumY) centerY = Math.min(maximumY, Math.max(minimumY, centerY));
      }
      return {
        left: centerX - sourceCenterX - rotatedBoundsCenterX * scale,
        profileId: profile.id,
        quarterTurns: profile.quarterTurns,
        scale,
        top: centerY - sourceCenterY - rotatedBoundsCenterY * scale,
      };
    }
    profileId = "default";
    const sourceScale = Math.min(width / parameters.fitWidth, height / parameters.fitHeight);
    const scale = sourceScale * appearanceScale;
    return {
      left: width / 2 - parameters.sourceWidth * scale / 2,
      profileId: "default",
      quarterTurns: 0,
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
    camera.style.transform = [
      next.quarterTurns === 0 ? "" : `rotate(${next.quarterTurns * 90}deg)`,
      next.scale === 1 ? "" : `scale(${cssNumber(next.scale)})`,
    ].filter(Boolean).join(" ");
  };

  return Object.freeze({
    ...parameters,
    get profileId() { return profileId; },
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
      if (next.profileId === "default") return Object.freeze({ x: (x - next.left) / next.scale, y: (y - next.top) / next.scale });
      const sourceCenterX = parameters.sourceWidth / 2;
      const sourceCenterY = parameters.sourceHeight / 2;
      const transformedX = (x - next.left - sourceCenterX) / next.scale;
      const transformedY = (y - next.top - sourceCenterY) / next.scale;
      const [sourceX, sourceY] = rotate(transformedX, transformedY, (4 - next.quarterTurns) % 4);
      return Object.freeze({ x: cleanCoordinate(sourceCenterX + sourceX), y: cleanCoordinate(sourceCenterY + sourceY) });
    },
    viewportPoint(x: number, y: number, width: number, height: number) {
      const next = layout(width, height);
      if (next.profileId === "default") return Object.freeze({ x: next.left + x * next.scale, y: next.top + y * next.scale, scale: next.scale });
      const sourceCenterX = parameters.sourceWidth / 2;
      const sourceCenterY = parameters.sourceHeight / 2;
      const [rotatedX, rotatedY] = rotate(x - sourceCenterX, y - sourceCenterY, next.quarterTurns);
      return Object.freeze({
        x: cleanCoordinate(next.left + sourceCenterX + rotatedX * next.scale),
        y: cleanCoordinate(next.top + sourceCenterY + rotatedY * next.scale),
        scale: next.scale,
      });
    },
  });
}
