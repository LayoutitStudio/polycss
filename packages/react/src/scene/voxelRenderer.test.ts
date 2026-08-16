/**
 * Feature tests: direct voxel renderer painter order.
 *
 * Pins the D-fix that item ordering projects brush centers through the
 * wrapper's ACTUAL CSS rotation (world↔CSS conjugation via
 * rotateVec3InWrapperCssFrame) — not a plain world-frame rotateVec3 — so
 * painter order matches what the browser composites. A world rotation of
 * [0, 0, rz] maps to CSS rotateZ(-rz); the drifted plain rotation applied
 * rotateZ(+rz) and produced the opposite ordering.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { Polygon } from "@layoutit/polycss-core";
import { createPolyVoxelRenderer } from "./voxelRenderer";

// Two same-face ("t", CSS normal [0,0,1]) axis-aligned unit quads.
// CSS centers: RED at (0.5T, 0.5T, 0), BLUE at (0.5T, 2.5T, 0).
const RED_QUAD: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
  color: "#ff0000",
};
const BLUE_QUAD: Polygon = {
  vertices: [[2, 0, 0], [3, 0, 0], [3, 1, 0], [2, 1, 0]],
  color: "#0000ff",
};

function dominantChannel(cssColor: string): "r" | "b" {
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cssColor);
  if (rgb) return Number(rgb[1]) >= Number(rgb[3]) ? "r" : "b";
  const hex = /^#([0-9a-f]{2})[0-9a-f]{2}([0-9a-f]{2})$/i.exec(cssColor);
  if (!hex) throw new Error(`unparsable color: ${cssColor}`);
  return parseInt(hex[1], 16) >= parseInt(hex[2], 16) ? "r" : "b";
}

function renderOrder(meshRotation: [number, number, number]): Array<"r" | "b"> {
  const wrapper = document.createElement("div");
  document.body.appendChild(wrapper);
  // Source order intentionally [BLUE, RED] so a renderer that ignores the
  // rotation entirely still has to reorder to pass.
  const renderer = createPolyVoxelRenderer({
    doc: document,
    wrapper,
    polygons: [BLUE_QUAD, RED_QUAD],
  });
  expect(renderer).not.toBeNull();
  renderer!.render({ rotX: 0, rotY: 0, meshRotation });
  const brushes = Array.from(wrapper.querySelectorAll(".polycss-voxel-face > b"));
  expect(brushes.length).toBe(2);
  const order = brushes.map((el) => dominantChannel((el as HTMLElement).style.color));
  renderer!.dispose();
  wrapper.remove();
  return order;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("voxel painter order — wrapper CSS-frame mesh rotation", () => {
  it("orders by the conjugated rotation for meshRotation [0,0,90]", () => {
    // Conjugated CSS rotateZ(-90): RED projects to smaller x → paints first.
    // The drifted plain world rotation (rotateZ(+90)) yields BLUE first.
    expect(renderOrder([0, 0, 90])).toEqual(["r", "b"]);
  });

  it("orders by the conjugated rotation for meshRotation [0,0,-90]", () => {
    // Mirror case: conjugated CSS rotateZ(+90) puts BLUE first; the drifted
    // plain rotation puts RED first.
    expect(renderOrder([0, 0, -90])).toEqual(["b", "r"]);
  });
});
