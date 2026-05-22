/**
 * Smoke tests: buildAtlasPages canvas pipeline (Vue atlasBrowser copy)
 *
 * Mirrors React's atlasBrowser.buildAtlasPages.test.ts.
 * happy-dom's canvas stub returns null from getContext("2d"), so pixel-level
 * verification is not possible. We verify:
 *   - the function does not throw on valid plan input
 *   - it returns the correct number of TextureAtlasPage objects
 *   - each page carries the expected width/height from the packed page
 *   - empty plan input produces empty output
 *   - isCancelled() early-exit is respected
 *
 * Note: `url` will be null in the happy-dom environment because canvas.getContext
 * returns null, so `buildAtlasPage` returns `{ url: null }`. That is the
 * expected fall-through in environments without a real 2D canvas context.
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "@layoutit/polycss-core";
import { computeTextureAtlasPlanPublic } from "@layoutit/polycss-core";
import { buildAtlasPages, packTextureAtlasPlansWithScale } from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDesktopDoc(): Document {
  return {
    defaultView: {
      navigator: { userAgent: "Mozilla/5.0 Chrome/120" },
      CSS: { supports: () => false },
      matchMedia: (query: string) => ({
        matches: query.includes("pointer: fine") || query.includes("hover: hover"),
      }),
    },
    createElement: document.createElement.bind(document),
  } as unknown as Document;
}

function neverCancelled(): boolean {
  return false;
}

// ---------------------------------------------------------------------------
// Polygon fixtures
// ---------------------------------------------------------------------------

const SOLID_RECT: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
  color: "#ff0000",
};

const SOLID_TRIANGLE: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  color: "#00ff00",
};

// ---------------------------------------------------------------------------
// Helpers: build a packed atlas from solid polygons
// ---------------------------------------------------------------------------

function buildPacked(polygons: Polygon[]): ReturnType<typeof packTextureAtlasPlansWithScale> {
  const plans = polygons.map((p, i) => computeTextureAtlasPlanPublic(p, i));
  return packTextureAtlasPlansWithScale(plans, 1, makeDesktopDoc());
}

// ---------------------------------------------------------------------------
// Tests: buildAtlasPages smoke
// ---------------------------------------------------------------------------

describe("buildAtlasPages — smoke tests", () => {
  it("returns an empty array for empty pages input", async () => {
    const result = await buildAtlasPages([], "baked", document, 1, neverCancelled);
    expect(result).toEqual([]);
  });

  it("does not throw for a single solid-polygon page", async () => {
    const { packed, atlasScale } = buildPacked([SOLID_RECT]);
    await expect(
      buildAtlasPages(packed.pages, "baked", document, atlasScale, neverCancelled),
    ).resolves.toBeDefined();
  });

  it("returns one TextureAtlasPage per packed page", async () => {
    const { packed, atlasScale } = buildPacked([SOLID_RECT, SOLID_TRIANGLE]);
    const pages = await buildAtlasPages(packed.pages, "baked", document, atlasScale, neverCancelled);
    expect(pages.length).toBe(packed.pages.length);
  });

  it("each returned page has width and height matching the packed page", async () => {
    const { packed, atlasScale } = buildPacked([SOLID_RECT]);
    const pages = await buildAtlasPages(packed.pages, "baked", document, atlasScale, neverCancelled);
    for (let i = 0; i < pages.length; i++) {
      expect(pages[i].width).toBe(packed.pages[i].width);
      expect(pages[i].height).toBe(packed.pages[i].height);
    }
  });

  it("isCancelled early-exit: returns fewer pages when cancelled after first", async () => {
    const { packed, atlasScale } = buildPacked([SOLID_RECT, SOLID_TRIANGLE]);
    if (packed.pages.length < 2) {
      return;
    }
    let callCount = 0;
    const cancelAfterFirst = () => {
      callCount++;
      return callCount > 1;
    };
    const pages = await buildAtlasPages(packed.pages, "baked", document, atlasScale, cancelAfterFirst);
    expect(pages.length).toBeLessThan(packed.pages.length);
  });

  it("does not throw for dynamic lighting mode", async () => {
    const { packed, atlasScale } = buildPacked([SOLID_RECT]);
    await expect(
      buildAtlasPages(packed.pages, "dynamic", document, atlasScale, neverCancelled),
    ).resolves.toBeDefined();
  });

  it("url field is present on each returned page (may be null in stub env)", async () => {
    const { packed, atlasScale } = buildPacked([SOLID_RECT]);
    const pages = await buildAtlasPages(packed.pages, "baked", document, atlasScale, neverCancelled);
    for (const page of pages) {
      expect(page.url === null || typeof page.url === "string").toBe(true);
    }
  });
});
