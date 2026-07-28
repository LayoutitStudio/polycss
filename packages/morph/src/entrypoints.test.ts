import { describe, expect, it } from "vitest";

describe("package entry points", () => {
  it("loads the browser entry in a DOM environment", async () => {
    const runtime = await import("./index.js");
    expect(runtime.validatePolyMorphModel).toBeTypeOf("function");
    expect(document.createElement("div")).toBeInstanceOf(HTMLElement);
  });

  it("loads the preparation entry independently", async () => {
    const prepare = await import("./prepare.js");
    expect(prepare.validatePolyMorphModel).toBeTypeOf("function");
    expect(prepare.preparePolyMorphModel).toBeTypeOf("function");
  });
});
