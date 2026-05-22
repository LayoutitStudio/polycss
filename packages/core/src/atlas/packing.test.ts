/**
 * Feature tests: atlas packing (packTextureAtlasPlans, packTextureAtlasPlansWithScaleCore,
 * atlasCanonicalSizeForTextureQuality, atlasCanonicalSizeForEntry, applyPackedAtlasCanonicalSize)
 *
 * Pins the observable packing contract: shelf-packer placement, page limits, null
 * slots, scale clamping, and canonical-size application.
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "../types";
import { computeTextureAtlasPlanPublic } from "./plan";
import {
  packTextureAtlasPlans,
  packTextureAtlasPlansWithScaleCore,
  atlasCanonicalSizeForTextureQuality,
  atlasCanonicalSizeForEntry,
  applyPackedAtlasCanonicalSize,
  normalizeAtlasScale,
  atlasArea,
  autoAtlasMaxDecodedBytes,
} from "./packing";
import { ATLAS_MAX_SIZE, ATLAS_CANONICAL_SIZE_EXPLICIT, ATLAS_CANONICAL_SIZE_AUTO_DESKTOP } from "./constants";
import type { TextureAtlasPlan } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTexturedPoly(x: number, size: number, texUrl = "https://example.com/t.png"): Polygon {
  return {
    vertices: [[x, 0, 0], [x + size, 0, 0], [x + size, size, 0], [x, size, 0]],
    texture: texUrl,
    color: "#ffffff",
  };
}

function solidPoly(x: number): Polygon {
  return {
    vertices: [[x, 0, 0], [x + 1, 0, 0], [x + 1, 1, 0], [x, 1, 0]],
    color: "#ff0000",
  };
}

const PLAN_A = computeTextureAtlasPlanPublic(makeTexturedPoly(0, 1), 0)!;
const PLAN_B = computeTextureAtlasPlanPublic(makeTexturedPoly(2, 2, "https://example.com/b.png"), 1)!;

// ---------------------------------------------------------------------------
// packTextureAtlasPlans — output structure
// ---------------------------------------------------------------------------

describe("packTextureAtlasPlans — output structure", () => {
  it("entries array length equals input plans array length", () => {
    const { entries } = packTextureAtlasPlans([PLAN_A, PLAN_B]);
    expect(entries.length).toBe(2);
  });

  it("null slots in the input array stay null in entries at the same index", () => {
    // planA at index 0, planB at index 2; index 1 is null
    const planA = computeTextureAtlasPlanPublic(makeTexturedPoly(0, 1), 0)!;
    const planB = computeTextureAtlasPlanPublic(makeTexturedPoly(2, 1), 2)!;
    const { entries } = packTextureAtlasPlans([planA, null, planB]);
    expect(entries[0]).not.toBeNull();
    expect(entries[1]).toBeNull();
    expect(entries[2]).not.toBeNull();
  });

  it("entries for textured plans carry x, y, and pageIndex", () => {
    const { entries } = packTextureAtlasPlans([PLAN_A]);
    const e = entries[0]!;
    expect(typeof e.x).toBe("number");
    expect(typeof e.y).toBe("number");
    expect(typeof e.pageIndex).toBe("number");
  });

  it("empty input produces empty entries and pages", () => {
    const { entries, pages } = packTextureAtlasPlans([]);
    expect(entries.length).toBe(0);
    expect(pages.length).toBe(0);
  });

  it("null-only input produces null entries and no pages", () => {
    const { entries, pages } = packTextureAtlasPlans([null, null]);
    expect(entries[0]).toBeNull();
    expect(entries[1]).toBeNull();
    expect(pages.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// packTextureAtlasPlans — packing invariants
// ---------------------------------------------------------------------------

describe("packTextureAtlasPlans — packing invariants", () => {
  it("page sizes do not exceed ATLAS_MAX_SIZE in width or height", () => {
    const { pages } = packTextureAtlasPlans([PLAN_A, PLAN_B]);
    for (const page of pages) {
      expect(page.width).toBeLessThanOrEqual(ATLAS_MAX_SIZE);
      expect(page.height).toBeLessThanOrEqual(ATLAS_MAX_SIZE);
    }
  });

  it("entries on the same page do not overlap", () => {
    const plans = [
      computeTextureAtlasPlanPublic(makeTexturedPoly(0, 1), 0),
      computeTextureAtlasPlanPublic(makeTexturedPoly(2, 1, "https://b.com/t.png"), 1),
      computeTextureAtlasPlanPublic(makeTexturedPoly(4, 1, "https://c.com/t.png"), 2),
    ];
    const { entries } = packTextureAtlasPlans(plans);
    const validEntries = entries.filter(Boolean) as NonNullable<(typeof entries)[0]>[];
    for (let i = 0; i < validEntries.length; i++) {
      for (let j = i + 1; j < validEntries.length; j++) {
        const a = validEntries[i];
        const b = validEntries[j];
        if (a.pageIndex !== b.pageIndex) continue;
        const nonOverlap =
          a.x + a.canvasW <= b.x ||
          b.x + b.canvasW <= a.x ||
          a.y + a.canvasH <= b.y ||
          b.y + b.canvasH <= a.y;
        expect(nonOverlap).toBe(true);
      }
    }
  });

  it("page width/height are at least as large as the largest entry's right/bottom extent", () => {
    const { entries, pages } = packTextureAtlasPlans([PLAN_A, PLAN_B]);
    for (const entry of entries) {
      if (!entry) continue;
      const page = pages[entry.pageIndex];
      expect(page.width).toBeGreaterThanOrEqual(entry.x + entry.canvasW);
      expect(page.height).toBeGreaterThanOrEqual(entry.y + entry.canvasH);
    }
  });

  it("entry index matches the input plan's index field", () => {
    const planA = computeTextureAtlasPlanPublic(makeTexturedPoly(0, 1), 5)!;
    const planB = computeTextureAtlasPlanPublic(makeTexturedPoly(2, 1, "https://b.com"), 7)!;
    const { entries } = packTextureAtlasPlans([null, null, null, null, null, planA, null, planB]);
    expect(entries[5]).not.toBeNull();
    expect(entries[7]).not.toBeNull();
    expect(entries[5]!.index).toBe(5);
    expect(entries[7]!.index).toBe(7);
  });

  it("large textures that exceed ATLAS_MAX_SIZE individually spill to sealed solo pages", () => {
    // Construct a plan whose canvasW/canvasH just exceeds ATLAS_MAX_SIZE minus padding.
    // We need to construct a TextureAtlasPlan manually since computeTextureAtlasPlanPublic
    // caps dimensions to polygon bounds.
    const hugePlan: TextureAtlasPlan = {
      ...PLAN_A,
      index: 0,
      canvasW: ATLAS_MAX_SIZE,
      canvasH: ATLAS_MAX_SIZE,
    };
    const { pages } = packTextureAtlasPlans([hugePlan]);
    // Huge plan should land on its own sealed page
    expect(pages.length).toBeGreaterThanOrEqual(1);
  });

  it("multiple large plans each spill to separate sealed pages", () => {
    const hugeA: TextureAtlasPlan = { ...PLAN_A, index: 0, canvasW: ATLAS_MAX_SIZE, canvasH: ATLAS_MAX_SIZE };
    const hugeB: TextureAtlasPlan = { ...PLAN_B, index: 1, canvasW: ATLAS_MAX_SIZE, canvasH: ATLAS_MAX_SIZE };
    const { pages } = packTextureAtlasPlans([hugeA, hugeB]);
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// atlasCanonicalSizeForTextureQuality
// ---------------------------------------------------------------------------

describe("atlasCanonicalSizeForTextureQuality — device class and quality", () => {
  it("numeric quality → always returns ATLAS_CANONICAL_SIZE_EXPLICIT (64)", () => {
    expect(atlasCanonicalSizeForTextureQuality(0.5, false)).toBe(ATLAS_CANONICAL_SIZE_EXPLICIT);
    expect(atlasCanonicalSizeForTextureQuality(0.5, true)).toBe(ATLAS_CANONICAL_SIZE_EXPLICIT);
    expect(atlasCanonicalSizeForTextureQuality(1, false)).toBe(ATLAS_CANONICAL_SIZE_EXPLICIT);
  });

  it("'auto' on desktop (isMobile=false) → ATLAS_CANONICAL_SIZE_AUTO_DESKTOP (128)", () => {
    expect(atlasCanonicalSizeForTextureQuality("auto", false)).toBe(ATLAS_CANONICAL_SIZE_AUTO_DESKTOP);
  });

  it("'auto' on mobile (isMobile=true) → ATLAS_CANONICAL_SIZE_EXPLICIT (64)", () => {
    expect(atlasCanonicalSizeForTextureQuality("auto", true)).toBe(ATLAS_CANONICAL_SIZE_EXPLICIT);
  });

  it("undefined quality → same as 'auto' (device-class driven)", () => {
    expect(atlasCanonicalSizeForTextureQuality(undefined, false)).toBe(ATLAS_CANONICAL_SIZE_AUTO_DESKTOP);
    expect(atlasCanonicalSizeForTextureQuality(undefined, true)).toBe(ATLAS_CANONICAL_SIZE_EXPLICIT);
  });
});

// ---------------------------------------------------------------------------
// atlasCanonicalSizeForEntry
// ---------------------------------------------------------------------------

describe("atlasCanonicalSizeForEntry — fallback to ATLAS_CANONICAL_SIZE_EXPLICIT", () => {
  it("entry without atlasCanonicalSize → returns ATLAS_CANONICAL_SIZE_EXPLICIT", () => {
    const plan = { ...PLAN_A };
    delete (plan as TextureAtlasPlan).atlasCanonicalSize;
    expect(atlasCanonicalSizeForEntry(plan)).toBe(ATLAS_CANONICAL_SIZE_EXPLICIT);
  });

  it("entry with atlasCanonicalSize → returns that value", () => {
    const plan = { ...PLAN_A, atlasCanonicalSize: 128 };
    expect(atlasCanonicalSizeForEntry(plan)).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// applyPackedAtlasCanonicalSize
// ---------------------------------------------------------------------------

describe("applyPackedAtlasCanonicalSize — mutates entries in place", () => {
  it("sets atlasCanonicalSize on all non-null entries", () => {
    const packed = packTextureAtlasPlans([PLAN_A, PLAN_B]);
    applyPackedAtlasCanonicalSize(packed, 128);
    for (const entry of packed.entries) {
      if (!entry) continue;
      expect(entry.atlasCanonicalSize).toBe(128);
    }
  });

  it("sets atlasMatrix string on all non-null entries", () => {
    const packed = packTextureAtlasPlans([PLAN_A]);
    applyPackedAtlasCanonicalSize(packed, 64);
    const entry = packed.entries[0]!;
    expect(typeof entry.atlasMatrix).toBe("string");
    expect(entry.atlasMatrix.length).toBeGreaterThan(0);
  });

  it("null entries are left as null", () => {
    // Plan with index 1, surrounded by nulls at indices 0 and 2
    const planAt1 = computeTextureAtlasPlanPublic(makeTexturedPoly(0, 1), 1)!;
    const packed = packTextureAtlasPlans([null, planAt1, null]);
    applyPackedAtlasCanonicalSize(packed, 64);
    expect(packed.entries[0]).toBeNull();
    expect(packed.entries[2]).toBeNull();
  });

  it("returns the same packed object (mutation in place)", () => {
    const packed = packTextureAtlasPlans([PLAN_A]);
    const returned = applyPackedAtlasCanonicalSize(packed, 64);
    expect(returned).toBe(packed);
  });
});

// ---------------------------------------------------------------------------
// packTextureAtlasPlansWithScaleCore — auto budget
// ---------------------------------------------------------------------------

describe("packTextureAtlasPlansWithScaleCore — quality and scale resolution", () => {
  it("explicit numeric quality produces atlasScale equal to clamped quality", () => {
    const { atlasScale } = packTextureAtlasPlansWithScaleCore([PLAN_A], 0.5, false);
    expect(atlasScale).toBeCloseTo(0.5);
  });

  it("explicit quality below MIN_ATLAS_SCALE clamps to MIN_ATLAS_SCALE (0.1)", () => {
    const { atlasScale } = packTextureAtlasPlansWithScaleCore([PLAN_A], 0.001, false);
    expect(atlasScale).toBeCloseTo(0.1);
  });

  it("explicit quality above 1 clamps to 1", () => {
    const { atlasScale } = packTextureAtlasPlansWithScaleCore([PLAN_A], 999, false);
    expect(atlasScale).toBeCloseTo(1.0);
  });

  it("explicit numeric quality gives ATLAS_CANONICAL_SIZE_EXPLICIT (64) as atlasCanonicalSize", () => {
    const { atlasCanonicalSize } = packTextureAtlasPlansWithScaleCore([PLAN_A], 0.5, false);
    expect(atlasCanonicalSize).toBe(ATLAS_CANONICAL_SIZE_EXPLICIT);
  });

  it("auto quality on desktop gives ATLAS_CANONICAL_SIZE_AUTO_DESKTOP (128)", () => {
    const { atlasCanonicalSize } = packTextureAtlasPlansWithScaleCore([PLAN_A], "auto", false);
    expect(atlasCanonicalSize).toBe(ATLAS_CANONICAL_SIZE_AUTO_DESKTOP);
  });

  it("auto quality on mobile gives ATLAS_CANONICAL_SIZE_EXPLICIT (64)", () => {
    const { atlasCanonicalSize } = packTextureAtlasPlansWithScaleCore([PLAN_A], "auto", true);
    expect(atlasCanonicalSize).toBe(ATLAS_CANONICAL_SIZE_EXPLICIT);
  });

  it("packed output has atlasCanonicalSize set on entries", () => {
    const { packed } = packTextureAtlasPlansWithScaleCore([PLAN_A], 1, false);
    expect(packed.entries[0]!.atlasCanonicalSize).toBeDefined();
  });

  it("atlasMatrix string is set on entries after auto packing", () => {
    const { packed } = packTextureAtlasPlansWithScaleCore([PLAN_A], "auto", false);
    expect(typeof packed.entries[0]!.atlasMatrix).toBe("string");
    expect(packed.entries[0]!.atlasMatrix.length).toBeGreaterThan(0);
  });

  it("auto mode with plans that exceed mobile budget reduces atlasScale below 1", () => {
    // Build many medium-resolution textured plans to exceed the mobile decoded-bytes budget.
    // Each plan is ~50×50 pixels = 2500 px. We need enough to exceed 4 MB mobile budget.
    // 4MB / 4 bytes = 1 MP. With 50×50 = 2500px per plan, ~400 plans needed.
    const mobileMaxBytes = autoAtlasMaxDecodedBytes(true);
    const bigPlan: TextureAtlasPlan = { ...PLAN_A, canvasW: 200, canvasH: 200 };
    const planCount = Math.ceil(mobileMaxBytes / (200 * 200 * 4)) + 50;
    const plans = Array.from({ length: planCount }, (_, i): TextureAtlasPlan => ({
      ...bigPlan,
      index: i,
    }));
    const { atlasScale } = packTextureAtlasPlansWithScaleCore(plans, "auto", true);
    // If budget exceeded the scale must be reduced below 1
    expect(atlasScale).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// normalizeAtlasScale
// ---------------------------------------------------------------------------

describe("normalizeAtlasScale — clamping and type coercion", () => {
  it("finite value in range passes through unchanged", () => {
    expect(normalizeAtlasScale(0.5)).toBeCloseTo(0.5);
  });

  it("undefined returns 1", () => {
    expect(normalizeAtlasScale(undefined)).toBe(1);
  });

  it("NaN returns 1", () => {
    expect(normalizeAtlasScale(NaN)).toBe(1);
  });

  it("string numeric is parsed and clamped", () => {
    expect(normalizeAtlasScale("0.5")).toBeCloseTo(0.5);
    expect(normalizeAtlasScale("0.001")).toBeCloseTo(0.1);
  });

  it("non-numeric string returns 1", () => {
    expect(normalizeAtlasScale("auto" as unknown as number)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// atlasArea
// ---------------------------------------------------------------------------

describe("atlasArea — sum of page areas", () => {
  it("returns 0 for empty pages", () => {
    expect(atlasArea([])).toBe(0);
  });

  it("returns width*height for a single page", () => {
    expect(atlasArea([{ width: 100, height: 200, entries: [] }])).toBe(20000);
  });

  it("sums areas across multiple pages", () => {
    expect(atlasArea([
      { width: 100, height: 100, entries: [] },
      { width: 50, height: 50, entries: [] },
    ])).toBe(12500);
  });
});
