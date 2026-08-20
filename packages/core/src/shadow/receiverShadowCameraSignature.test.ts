import { describe, it, expect } from "vitest";
import {
  prepareReceiverFacePlanes,
  receiverShadowCameraSignature,
} from "./computeReceiverShadows";
import type { Polygon, Vec3 } from "../types";

// The receiver-shadow pipeline reads the camera at exactly one predicate — is
// this face plane turned toward the camera — and that one bit decides both
// whether the face paints at all and whether its creases may bleed. The
// signature is that bit vector, so renderers can re-emit on boundary crossings
// instead of every frame (or, as before this, never).
const floor: Polygon = {
  vertices: [[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]],
  color: "#888888",
};
const wall: Polygon = {
  vertices: [[-2, 2, 0], [2, 2, 0], [2, 2, 3], [-2, 2, 3]],
  color: "#888888",
};

/** A closed box: six faces whose normals span all six axis directions, so an
 *  orbit is guaranteed to cross facing boundaries. */
function boxPolys(): Polygon[] {
  const H = 2;
  return ([
    [[-H, -H, H], [H, -H, H], [H, H, H], [-H, H, H]],
    [[H, -H, -H], [H, H, -H], [H, H, H], [H, -H, H]],
    [[H, H, -H], [-H, H, -H], [-H, H, H], [H, H, H]],
    [[-H, -H, -H], [-H, -H, H], [-H, H, H], [-H, H, -H]],
    [[-H, -H, -H], [H, -H, -H], [H, -H, H], [-H, -H, H]],
    [[-H, -H, -H], [-H, H, -H], [H, H, -H], [H, -H, -H]],
  ] as Vec3[][]).map((vertices) => ({ vertices, color: "#888888" }));
}

const planesFor = (polys: readonly Polygon[]) =>
  prepareReceiverFacePlanes(polys, [0, 0, 0], 1, new Set(), 0.05, null);

describe("receiverShadowCameraSignature", () => {
  it("is stable for an unchanged camera", () => {
    const planes = planesFor(boxPolys());
    const a = receiverShadowCameraSignature(planes, { rotX: 55, rotY: 20 });
    const b = receiverShadowCameraSignature(planes, { rotX: 55, rotY: 20 });
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("changes when the camera crosses a facing boundary", () => {
    const planes = planesFor(boxPolys());
    const front = receiverShadowCameraSignature(planes, { rotX: 55, rotY: 20 });
    const back = receiverShadowCameraSignature(planes, { rotX: 55, rotY: 200 });
    expect(back).not.toBe(front);
  });

  it("does not change for a rotation that crosses no boundary", () => {
    // A degree of azimuth on a box moves no normal across the horizon.
    const planes = planesFor(boxPolys());
    const a = receiverShadowCameraSignature(planes, { rotX: 55, rotY: 20 });
    const b = receiverShadowCameraSignature(planes, { rotX: 55, rotY: 21 });
    expect(b).toBe(a);
  });

  it("ignores mesh rotation — plane normals are already in world frame", () => {
    const planes = planesFor(boxPolys());
    const bare = receiverShadowCameraSignature(planes, { rotX: 55, rotY: 20 });
    const withMesh = receiverShadowCameraSignature(planes, {
      rotX: 55, rotY: 20, meshRotation: [30, 40, 50],
    });
    expect(withMesh).toBe(bare);
  });

  it("counts one boundary crossing at a time over a full orbit", () => {
    const planes = planesFor(boxPolys());
    let crossings = 0;
    let prev = receiverShadowCameraSignature(planes, { rotX: 55, rotY: 0 });
    for (let ry = 1; ry <= 360; ry++) {
      const next = receiverShadowCameraSignature(planes, { rotX: 55, rotY: ry });
      if (next !== prev) crossings++;
      prev = next;
    }
    // A box has four side normals in the azimuth plane: an orbit crosses a
    // boundary a handful of times, nowhere near once per step.
    expect(crossings).toBeGreaterThan(0);
    expect(crossings).toBeLessThan(20);
  });

  it("omits planes no light can reach", () => {
    // Straight down: the floor is lit, the wall is exactly edge-on. An unlit
    // plane fails `L·n` in every pass, so it emits nothing at any camera angle
    // and its facing bit must not invent a boundary crossing.
    const polys = [floor, wall];
    const planes = planesFor(polys);
    expect(planes.length).toBe(2);
    const lights = { lightDir: [0, 0, 1] as Vec3 };
    const litOnly = planes.filter((p) => p.n[2] > 1e-6);
    expect(litOnly.length).toBe(1);

    for (const rotY of [0, 45, 90, 180, 270]) {
      const cam = { rotX: 55, rotY };
      expect(receiverShadowCameraSignature(planes, cam, lights))
        .toBe(receiverShadowCameraSignature(litOnly, cam, lights));
    }
  });

  it("keeps a plane a point light reaches", () => {
    const planes = planesFor([floor, wall]);
    const cam = { rotX: 55, rotY: 20 };
    // No directional pass, one point light above and in front of the wall:
    // both planes stay in the signature.
    const withPoint = receiverShadowCameraSignature(planes, cam, {
      lightDir: null,
      pointLightPositions: [[0, -400, 400]],
    });
    const dirOnly = receiverShadowCameraSignature(planes, cam, { lightDir: [0, 0, 1] as Vec3 });
    expect(withPoint.length).toBeGreaterThanOrEqual(dirOnly.length);
  });

  it("is conservative when no lights are supplied", () => {
    // Without light information every plane contributes a bit — a signature
    // that over-reports crossings is safe; one that under-reports is not.
    const planes = planesFor([floor, wall]);
    const cam = { rotX: 55, rotY: 20 };
    const all = receiverShadowCameraSignature(planes, cam);
    const vertical = receiverShadowCameraSignature(planes, cam, { lightDir: [0, 0, 1] as Vec3 });
    expect(all).not.toBe("");
    expect(vertical).not.toBe("");
  });
});
