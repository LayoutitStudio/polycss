import { describe, expect, it } from "vitest";
import { shadowOptsEqual, strategiesEqual, vec3Equal } from "./equality";

describe("strategiesEqual", () => {
  it("two undefined are equal", () => {
    expect(strategiesEqual(undefined, undefined)).toBe(true);
  });
  it("undefined and empty disable list are equal", () => {
    expect(strategiesEqual(undefined, { disable: [] })).toBe(true);
  });
  it("same disable list (any order) is equal", () => {
    expect(strategiesEqual({ disable: ["b", "u"] }, { disable: ["u", "b"] })).toBe(true);
  });
  it("different length disable lists are NOT equal", () => {
    expect(strategiesEqual({ disable: ["b"] }, { disable: ["b", "u"] })).toBe(false);
  });
  it("different members are NOT equal", () => {
    expect(strategiesEqual({ disable: ["b"] }, { disable: ["u"] })).toBe(false);
  });
});

describe("vec3Equal", () => {
  it("reference equality short-circuits", () => {
    const v: [number, number, number] = [1, 2, 3];
    expect(vec3Equal(v, v)).toBe(true);
  });
  it("two undefined are equal (both treated as absent)", () => {
    expect(vec3Equal(undefined, undefined)).toBe(true);
  });
  it("one undefined, one defined is NOT equal", () => {
    expect(vec3Equal(undefined, [0, 0, 0])).toBe(false);
    expect(vec3Equal([0, 0, 0], undefined)).toBe(false);
  });
  it("structurally equal vectors are equal", () => {
    expect(vec3Equal([1, 2, 3], [1, 2, 3])).toBe(true);
  });
  it("any differing component breaks equality", () => {
    expect(vec3Equal([1, 2, 3], [1, 2, 4])).toBe(false);
  });
});

describe("shadowOptsEqual", () => {
  it("two undefined are equal (both pick defaults)", () => {
    expect(shadowOptsEqual(undefined, undefined)).toBe(true);
  });
  it("undefined vs explicit-defaults are equal", () => {
    expect(
      shadowOptsEqual(undefined, { color: "#000000", opacity: 0.25, lift: 0.05, maxExtend: 2000 }),
    ).toBe(true);
  });
  it("any single field difference breaks equality", () => {
    expect(shadowOptsEqual({ color: "#000" }, { color: "#fff" })).toBe(false);
    expect(shadowOptsEqual({ opacity: 0.25 }, { opacity: 0.5 })).toBe(false);
    expect(shadowOptsEqual({ lift: 0.05 }, { lift: 0.1 })).toBe(false);
    expect(shadowOptsEqual({ maxExtend: 2000 }, { maxExtend: 5000 })).toBe(false);
  });
  it("reference equality short-circuits", () => {
    const o = { color: "#000", opacity: 0.5, lift: 0.1, maxExtend: 500 };
    expect(shadowOptsEqual(o, o)).toBe(true);
  });
});
