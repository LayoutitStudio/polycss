import { invariant } from "../errors.js";
import type { DomBindings, DomState } from "../public-types.js";
import type { MountedTree } from "../retained-dom.js";
import type { MaterializedPolycssState } from "./polycss.js";

type PublicationKind = "initial" | "advance" | "wrap" | "seek" | "catch-up" | "restart";

interface TimingTarget {
  readonly kind: "cycle" | "transition";
  readonly owner: "model" | "shape" | "leaf";
  readonly index: number;
  readonly durationTicks: number;
  readonly keyframes?: readonly Readonly<{ tick: number; transformIndex: number }>[];
}

interface TimingPacket {
  readonly timing: "linear";
  readonly targets: readonly TimingTarget[];
}

interface AnimationLike {
  currentTime: number | CSSNumericValue | null;
  cancel(): void;
  pause(): void;
  play(): void;
}

export interface PolycssCompositorTiming {
  before(kind: PublicationKind, tick: number): void;
  after(kind: PublicationKind, tick: number): void;
  publishInitial(tick: number): void;
  setActive(active: boolean): boolean;
  destroy(): boolean;
}

export function createPolycssCompositorTiming(
  state: DomState,
  bindings: DomBindings,
  materialized: MaterializedPolycssState,
  mounted: MountedTree,
  options: { readonly boundTargets?: ReadonlyMap<string, Readonly<{ targets: unknown }>> } = {},
): PolycssCompositorTiming | null {
  const channel = state.channels.find((entry) => entry.codec === "polycss-compositor-timing-prepared@0");
  if (!channel) return null;
  const binding = bindings.channels.find((entry) => entry.interpreter === "polycss-compositor-timing@0");
  const playbackBinding = bindings.channels.find((entry) => entry.interpreter === "polycss-playback@0");
  invariant(binding && playbackBinding && materialized.playback, "MISSING_POLYCSS_BINDING", "Compositor timing requires prepared playback.");
  invariant(materialized.playback.kind === "inline", "TARGET_OWNERSHIP_CONFLICT", "Compositor timing version 0 cannot reference page-local transforms.");
  const playback = materialized.playback;
  const packet = (channel.data as unknown as { readonly packet: TimingPacket }).packet;
  const ids = (binding.targets as unknown as { readonly nodes: readonly string[] }).nodes;
  const bound = options.boundTargets?.get(binding.id)?.targets as Readonly<{ nodes?: readonly HTMLElement[] }> | undefined;
  const elements = bound?.nodes ?? ids.map((id) => mounted.byId.get(id));
  invariant(elements.every(Boolean), "MISSING_TARGET_NODE", "Compositor timing targets are not mounted.");
  const nodes = elements as readonly HTMLElement[];
  const parameters = playbackBinding.parameters as unknown as {
    readonly baseSceneTransform: string;
    readonly frameCount: number;
    readonly tickRateHz?: number;
    readonly tickIntervalUs?: readonly [number, number];
  };
  const tickMs = parameters.tickIntervalUs
    ? parameters.tickIntervalUs[0] / parameters.tickIntervalUs[1] / 1000
    : 1000 / parameters.tickRateHz!;
  const animations = new Map<number, AnimationLike>();
  let active = true;
  let initialized = false;
  let destroyed = false;

  const transitionValue = (target: TimingTarget): string => `transform ${target.durationTicks * tickMs}ms linear`;
  const animationTime = (target: TimingTarget, tick: number): number => (tick % target.durationTicks) * tickMs;
  const snapCycles = (tick: number): void => {
    for (const [index, target] of packet.targets.entries()) {
      if (target.kind !== "cycle") continue;
      const animation = animations.get(index);
      if (!animation) continue;
      animation.pause();
      animation.currentTime = animationTime(target, tick);
    }
  };
  const restore = (): void => {
    for (const [index, target] of packet.targets.entries()) {
      if (target.kind === "transition") nodes[index].style.transition = active ? transitionValue(target) : "none";
      else if (active) animations.get(index)?.play();
    }
  };

  return Object.freeze({
    before(kind: PublicationKind, tick: number) {
      invariant(!destroyed, "MOUNT_DESTROYED", "Compositor timing runtime is destroyed.");
      if (!initialized) return;
      const sequential = kind === "advance" && active;
      for (const [index, target] of packet.targets.entries()) if (target.kind === "transition") nodes[index].style.transition = sequential ? transitionValue(target) : "none";
      if (!sequential) snapCycles(tick);
    },
    after(kind: PublicationKind, _tick: number) {
      invariant(!destroyed, "MOUNT_DESTROYED", "Compositor timing runtime is destroyed.");
      if (initialized && kind !== "advance") restore();
    },
    publishInitial(tick: number) {
      invariant(!destroyed, "MOUNT_DESTROYED", "Compositor timing runtime is destroyed.");
      if (initialized) return;
      for (const [index, target] of packet.targets.entries()) {
        if (target.kind === "transition") {
          nodes[index].style.transition = active ? transitionValue(target) : "none";
          continue;
        }
        invariant(typeof nodes[index].animate === "function", "MISSING_BROWSER_API", "Closed compositor cycles require Web Animations support.");
        const keyframes = target.keyframes!.map((row) => ({
          offset: row.tick / target.durationTicks,
          transform: `${parameters.baseSceneTransform}${playback.transforms[row.transformIndex] ? ` ${playback.transforms[row.transformIndex]}` : ""}`,
        }));
        const animation = nodes[index].animate(keyframes, {
          duration: target.durationTicks * tickMs,
          easing: packet.timing,
          fill: "both",
          iterations: Infinity,
        }) as unknown as AnimationLike;
        animation.pause();
        animation.currentTime = animationTime(target, tick);
        animations.set(index, animation);
      }
      initialized = true;
      restore();
    },
    setActive(next: boolean) {
      invariant(!destroyed, "MOUNT_DESTROYED", "Compositor timing runtime is destroyed.");
      active = next;
      if (!initialized) return active;
      if (active) restore();
      else {
        for (const [index, target] of packet.targets.entries()) {
          if (target.kind === "transition") nodes[index].style.transition = "none";
          else animations.get(index)?.pause();
        }
      }
      return active;
    },
    destroy() {
      if (destroyed) return false;
      destroyed = true;
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
      for (const [index, target] of packet.targets.entries()) if (target.kind === "transition") nodes[index].style.transition = "";
      return true;
    },
  });
}
