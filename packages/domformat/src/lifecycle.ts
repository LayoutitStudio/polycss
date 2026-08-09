import { invariant } from "./errors.js";
import type { DomLifecyclePhase } from "./public-types.js";

export const LIFECYCLE_PHASES = Object.freeze([
  "validate",
  "construct",
  "bind",
  "initialize",
  "publish",
  "destroy",
]) satisfies readonly DomLifecyclePhase[];

export function createLifecycle(onPhase?: (phase: DomLifecyclePhase) => void) {
  invariant(onPhase === undefined || typeof onPhase === "function", "INVALID_LIFECYCLE_OBSERVER", "onLifecyclePhase must be a function.");
  let phase: DomLifecyclePhase | null = null;
  let pending: Exclude<DomLifecyclePhase, "destroy"> | null = null;
  const history: DomLifecyclePhase[] = [];
  const view = Object.freeze({
    get phase() { return phase; },
    get history() { return Object.freeze([...history]); },
  });

  const complete = (next: Exclude<DomLifecyclePhase, "destroy">) => {
    history.push(next);
    phase = next;
    onPhase?.(next);
  };

  const expectedPhase = () => {
    const completed = history.at(-1) ?? null;
    return completed === null ? "validate" : LIFECYCLE_PHASES[LIFECYCLE_PHASES.indexOf(completed) + 1];
  };

  return Object.freeze({
    view,
    get phase() { return phase; },
    get history() { return Object.freeze([...history]); },
    isDestroyed() { return phase === "destroy"; },
    begin(next: Exclude<DomLifecyclePhase, "destroy">) {
      invariant(LIFECYCLE_PHASES.includes(next), "INVALID_LIFECYCLE_PHASE", `Unknown lifecycle phase ${String(next)}.`);
      invariant(pending === null && next === expectedPhase(), "LIFECYCLE_ORDER", `Lifecycle cannot begin ${next} after ${history.at(-1) ?? "start"}; expected ${expectedPhase()}.`);
      phase = next;
      pending = next;
      return next;
    },
    advance(next: Exclude<DomLifecyclePhase, "destroy">) {
      invariant(LIFECYCLE_PHASES.includes(next), "INVALID_LIFECYCLE_PHASE", `Unknown lifecycle phase ${String(next)}.`);
      const expected = pending ?? expectedPhase();
      invariant(next === expected, "LIFECYCLE_ORDER", `Lifecycle cannot advance from ${phase ?? "start"} to ${next}; expected ${expected}.`);
      pending = null;
      complete(next);
      return next;
    },
    destroy() {
      if (phase === "destroy") return false;
      history.push("destroy");
      phase = "destroy";
      pending = null;
      try { onPhase?.("destroy"); } catch {}
      return true;
    },
    assertPublished() {
      invariant(phase === "publish" && pending === null && history.at(-1) === "publish", "LIFECYCLE_PRECONDITION", `Operation requires completed publish phase; current phase is ${phase ?? "start"}.`);
    },
  });
}
