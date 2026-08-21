// Contract objects are deeply readonly on purpose. Tests deliberately corrupt
// cloned fixtures to exercise validation, so test-side clones expose a deeply
// mutable view. The cast is honest: a fresh JSON clone really is mutable, and
// the mutations intentionally produce invalid data.
export type PolyMorphDeepMutable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { -readonly [K in keyof T]: PolyMorphDeepMutable<T[K]> }
    : T;

export function mutable<T>(value: T): PolyMorphDeepMutable<T> {
  return value as PolyMorphDeepMutable<T>;
}
