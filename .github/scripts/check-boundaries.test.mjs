import assert from "node:assert/strict";
import test from "node:test";

import { extractSpecifiers } from "./check-boundaries.mjs";

test("extracts static import specifiers", () => {
  const source = `
import { a } from "@layoutit/polycss-core";
import type { B } from "./local";
import * as ns from "../up";
import "side-effect";
export { c } from "@layoutit/polycss-core/three";
export * from "./barrel";
`;
  assert.deepEqual(extractSpecifiers(source), [
    "@layoutit/polycss-core",
    "./local",
    "../up",
    "side-effect",
    "@layoutit/polycss-core/three",
    "./barrel",
  ]);
});

test("extracts dynamic import and require specifiers", () => {
  const source = `
const mod = await import("node:fs");
const legacy = require("earcut");
`;
  assert.deepEqual(extractSpecifiers(source), ["node:fs", "earcut"]);
});

test("does not treat property access named import as a specifier", () => {
  const source = `const x = foo.import("not-an-import");`;
  assert.deepEqual(extractSpecifiers(source), []);
});
