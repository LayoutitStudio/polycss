import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isPolyMorphId,
  isPolyMorphResourcePath,
  PolyMorphContractError,
  validatePolyMorphModel,
} from "./index.js";
import {
  clonePolyMorphFixture,
  createPolyMorphModelFixture,
  POLY_MORPH_IDENTITY_MATRIX,
} from "../testing/modelFixture.js";
import { createPolyMorphSkinningFixture } from "../testing/skinningFixture.js";

function expectCode(value: unknown, code: string): void {
  try {
    validatePolyMorphModel(value);
  } catch (error) {
    expect(error).toBeInstanceOf(PolyMorphContractError);
    expect((error as PolyMorphContractError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}.`);
}

describe("validatePolyMorphModel", () => {
  it.each([
    "static-prepared",
    "morph-regions",
    "joint-skin",
    "prepared-playback",
  ] as const)("accepts a complete %s fixture", (profile) => {
    const fixture = createPolyMorphModelFixture(profile);
    const model = validatePolyMorphModel(fixture);
    expect(model.profile).toBe(profile);
    expect(model.render.leaves[0]?.id).toBe("gem-panel-leaf");
  });

  it("rejects undeclared keys at every strict object boundary", () => {
    const fixture = createPolyMorphModelFixture() as unknown as Record<string, unknown>;
    fixture.extra = true;
    expectCode(fixture, "invalid-keys");

    const nested = clonePolyMorphFixture(createPolyMorphModelFixture()) as unknown as {
      identity: Record<string, unknown>;
    };
    nested.identity.extra = true;
    expectCode(nested, "invalid-keys");
  });

  it("accepts only normalized ids and package-relative resource paths", () => {
    expect(isPolyMorphId("gem-panel")).toBe(true);
    expect(isPolyMorphId("Gem_Panel")).toBe(false);
    expect(isPolyMorphResourcePath("assets/gem.webp")).toBe(true);
    expect(isPolyMorphResourcePath("../assets/gem.webp")).toBe(false);
    expect(isPolyMorphResourcePath("/assets/gem.webp")).toBe(false);
    expect(isPolyMorphResourcePath("http:evil.example/manifest.json")).toBe(false);
    expect(isPolyMorphResourcePath("javascript:alert.js")).toBe(false);
    expect(isPolyMorphResourcePath("%2e%2e/%2e%2e/secret.json")).toBe(false);
    expect(isPolyMorphResourcePath("assets/%2e%2e/secret.json")).toBe(false);

    const fixture = clonePolyMorphFixture(createPolyMorphModelFixture());
    fixture.identity.id = "Gem_Panel";
    expectCode(fixture, "invalid-id");

    const textured = clonePolyMorphFixture(createPolyMorphModelFixture());
    textured.render.leaves[0]!.strategy = "atlas-slice";
    textured.render.leaves[0]!.atlas = {
      resourcePath: "../atlas.webp",
      x: 0,
      y: 0,
      width: 4,
      height: 4,
      pageWidth: 4,
      pageHeight: 4,
    };
    expectCode(textured, "invalid-path");

    const fallback = clonePolyMorphFixture(createPolyMorphModelFixture());
    fallback.render.leaves[0]!.fallback = {
      width: 7,
      height: 5,
      matrixFromLeaf: POLY_MORPH_IDENTITY_MATRIX,
      atlas: {
        resourcePath: "../solid-triangle.png",
        x: 0,
        y: 0,
        width: 7,
        height: 5,
        pageWidth: 7,
        pageHeight: 5,
      },
    };
    expectCode(fallback, "invalid-path");
  });

  it("validates a local-size fallback slice on each solid triangle", () => {
    const fixture = clonePolyMorphFixture(createPolyMorphModelFixture());
    fixture.render.leaves[0]!.fallback = {
      width: 7,
      height: 5,
      matrixFromLeaf: POLY_MORPH_IDENTITY_MATRIX,
      atlas: {
        resourcePath: "assets/solid-triangles-000.png",
        x: 1,
        y: 2,
        width: 7,
        height: 5,
        pageWidth: 20,
        pageHeight: 10,
      },
    };
    expect(
      validatePolyMorphModel(fixture).render.leaves[0]!.fallback,
    ).toEqual(fixture.render.leaves[0]!.fallback);

    fixture.render.leaves[0]!.fallback!.width = 8;
    expectCode(fixture, "invalid-size");
  });

  it("pins one stable retained leaf to every polygon", () => {
    const missing = clonePolyMorphFixture(createPolyMorphModelFixture());
    missing.render.leaves = [];
    expectCode(missing, "unstable-topology");

    const duplicate = clonePolyMorphFixture(createPolyMorphModelFixture());
    duplicate.topology.polygons.push({
      id: "second-panel",
      vertexIndices: [0, 2, 1],
      normalIndices: [0, 2, 1],
    });
    duplicate.render.leaves.push({
      ...duplicate.render.leaves[0]!,
      id: "second-leaf",
    });
    expectCode(duplicate, "duplicate-id");
  });

  it("bounds sparse deltas and requires actual changes", () => {
    const outOfRange = clonePolyMorphFixture(createPolyMorphModelFixture("morph-regions"));
    outOfRange.deformation.targets[0]!.deltas[0]!.vertexIndex = 3;
    expectCode(outOfRange, "out-of-range");

    const empty = clonePolyMorphFixture(createPolyMorphModelFixture("morph-regions"));
    empty.deformation.targets[0]!.deltas[0]!.position = null;
    empty.deformation.targets[0]!.deltas[0]!.normal = null;
    expectCode(empty, "empty-delta");
  });

  it("bounds semantic controls and resolves their morph targets", () => {
    const fixture = clonePolyMorphFixture(createPolyMorphModelFixture("morph-regions"));
    fixture.capabilities = [
      "morph-targets",
      "retained-render",
      "semantic-controls",
      "sparse-updates",
      "springs",
    ];
    fixture.controls = [
      {
        id: "stretch-control",
        anchor: [0, 0, 0],
        axis: [0, 1, 0],
        radius: 2,
        minimum: -1,
        maximum: 1,
        initial: 0,
        targets: [{ targetId: "stretch", scale: 1 }],
      },
    ];
    fixture.springs = [
      {
        id: "stretch-return",
        controlId: "stretch-control",
        stiffness: 80,
        damping: 12,
      },
    ];
    expect(validatePolyMorphModel(fixture).controls).toHaveLength(1);

    fixture.controls[0]!.initial = 2;
    expectCode(fixture, "invalid-control-bounds");
    fixture.controls[0]!.initial = 0;
    fixture.controls[0]!.targets[0]!.targetId = "unknown-target";
    expectCode(fixture, "unknown-reference");
  });

  it("requires profile-specific sections and capabilities", () => {
    const mismatched = clonePolyMorphFixture(createPolyMorphModelFixture("morph-regions"));
    mismatched.deformation = { kind: "none" };
    expectCode(mismatched, "profile-mismatch");

    const missingPlayback = clonePolyMorphFixture(createPolyMorphModelFixture("prepared-playback"));
    missingPlayback.playback = null;
    expectCode(missingPlayback, "profile-mismatch");

    const missingCapability = clonePolyMorphFixture(createPolyMorphModelFixture("joint-skin"));
    missingCapability.capabilities = ["retained-render", "sparse-updates"];
    expectCode(missingCapability, "missing-capability");
  });

  it("validates animation references, sample shapes, and ordered time", () => {
    const fixture = clonePolyMorphFixture(createPolyMorphModelFixture("morph-regions"));
    fixture.capabilities = ["animation", "morph-targets", "retained-render", "sparse-updates"];
    fixture.animations = [
      {
        id: "pulse",
        durationMs: 1000,
        loop: true,
        channels: [
          {
            target: "morph-weight",
            targetId: "stretch",
            interpolation: "linear",
            timesMs: [0, 500, 1000],
            values: [[0], [1], [0]],
          },
        ],
      },
    ];
    expect(validatePolyMorphModel(fixture).animations[0]?.id).toBe("pulse");
    fixture.animations[0]!.channels[0]!.timesMs = [0, 500, 500];
    expectCode(fixture, "invalid-animation-time");
  });

  it("requires step interpolation for matrices and non-zero quaternions", () => {
    const matrixFixture = clonePolyMorphFixture(
      createPolyMorphModelFixture("morph-regions"),
    );
    matrixFixture.capabilities = [
      "animation",
      "morph-targets",
      "retained-render",
      "sparse-updates",
    ];
    matrixFixture.animations = [{
      id: "shape-step",
      durationMs: 1000,
      loop: false,
      channels: [{
        target: "shape-matrix",
        targetId: "gem",
        interpolation: "linear",
        timesMs: [0, 1000],
        values: [
          [...POLY_MORPH_IDENTITY_MATRIX],
          [...POLY_MORPH_IDENTITY_MATRIX],
        ],
      }],
    }];
    expectCode(matrixFixture, "invalid-interpolation");

    const quaternionFixture = clonePolyMorphFixture(
      createPolyMorphSkinningFixture(),
    );
    quaternionFixture.animations[0]!.channels[0]!.values[0] = [0, 0, 0, 0];
    expectCode(quaternionFixture, "invalid-animation-value");
  });

  it("rejects removed render strategies", () => {
    const fixture = clonePolyMorphFixture(createPolyMorphModelFixture());
    (fixture.render.leaves[0] as { strategy: string }).strategy = "solid-clipped";
    expectCode(fixture, "invalid-strategy");
  });

  it("validates ordered prepared playback updates against retained ids", () => {
    const fixture = clonePolyMorphFixture(createPolyMorphModelFixture("prepared-playback"));
    fixture.playback!.frames.push({
      timeMs: 500,
      modelMatrix: POLY_MORPH_IDENTITY_MATRIX,
      shapes: [{ shapeId: "gem", matrix: POLY_MORPH_IDENTITY_MATRIX }],
      leaves: [
        {
          leafId: "gem-panel-leaf",
          matrix: POLY_MORPH_IDENTITY_MATRIX,
          visible: null,
          opacity: 0.5,
          atlasRow: 1,
        },
      ],
    });
    expect(validatePolyMorphModel(fixture).playback?.frames).toHaveLength(2);
    fixture.playback!.frames[1]!.leaves[0]!.leafId = "unknown-leaf";
    expectCode(fixture, "unknown-reference");
  });

  it("keeps internal leaf tags out of the public contracts", () => {
    const publicFiles = ["types.ts", "validation.ts", "index.ts"].map((name) =>
      readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8").toLowerCase());
    for (const source of publicFiles) {
      expect(source).not.toMatch(/<(?:b|i|s|u)>/);
    }
  });

  it("validates joint hierarchy, references, coverage, and normalized weights", () => {
    const unknownJoint = clonePolyMorphFixture(createPolyMorphModelFixture("joint-skin"));
    unknownJoint.deformation.vertices[0]!.influences[0]!.jointId = "missing";
    expectCode(unknownJoint, "unknown-reference");

    const badWeight = clonePolyMorphFixture(createPolyMorphModelFixture("joint-skin"));
    badWeight.deformation.vertices[1]!.influences[0]!.weight = 0.6;
    expectCode(badWeight, "invalid-weight");

    const cycle = clonePolyMorphFixture(createPolyMorphModelFixture("joint-skin"));
    cycle.deformation.joints[0]!.parentId = "tip";
    expectCode(cycle, "invalid-hierarchy");

    const missingVertex = clonePolyMorphFixture(createPolyMorphModelFixture("joint-skin"));
    missingVertex.deformation.vertices.pop();
    expectCode(missingVertex, "missing-skin-vertex");
  });
});
