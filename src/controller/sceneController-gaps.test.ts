import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sceneController, type SceneController } from "./sceneController";
import type { SceneState } from "./sceneBindings";

function makeSceneState(overrides: Partial<SceneState> = {}): SceneState {
  return {
    voxels: [],
    showWalls: false,
    showFloor: false,
    projection: "cubic",
    mergeVoxels: false,
    ...overrides,
  };
}

describe("sceneController — gap coverage", () => {
  // =========================================================================
  // Lines 60-63: nowMs() using performance.now()
  // This is exercised when __voxcssProfile is set and applySceneState is called.
  // =========================================================================
  describe("profiling support (__voxcssProfile)", () => {
    afterEach(() => {
      delete (globalThis as any).__voxcssProfile;
    });

    it("records profiling data when __voxcssProfile is set", () => {
      // Set up the profile object
      (globalThis as any).__voxcssProfile = {};

      const ctrl = sceneController();

      // Apply scene state — this should populate profile
      ctrl.applySceneState(makeSceneState({
        voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }]
      }));

      const profile = (globalThis as any).__voxcssProfile;
      expect(profile.sceneController).toBeDefined();
      expect(typeof profile.sceneController.totalMs).toBe("number");
      expect(typeof profile.sceneController.resolveMs).toBe("number");
      expect(typeof profile.sceneController.buildSceneMs).toBe("number");
      expect(profile.sceneController.needsRebuild).toBe(true);
    });

    it("uses existing sceneController profile entry if present", () => {
      // Set up profile with existing sceneController entry
      const existingEntry: Record<string, number | boolean> = { customField: true };
      (globalThis as any).__voxcssProfile = { sceneController: existingEntry };

      const ctrl = sceneController();
      ctrl.applySceneState(makeSceneState({
        voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }]
      }));

      const profile = (globalThis as any).__voxcssProfile;
      // Should reuse the existing entry object
      expect(profile.sceneController).toBe(existingEntry);
      expect(profile.sceneController.totalMs).toBeDefined();
    });

    // Line 315: profile.buildSceneMs = 0 when needsRebuild is false
    it("records buildSceneMs=0 when scene does not need rebuild", () => {
      (globalThis as any).__voxcssProfile = {};

      const ctrl = sceneController();

      const state = makeSceneState({
        voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }]
      });

      // First call — needs rebuild
      ctrl.applySceneState(state);

      const profile1 = (globalThis as any).__voxcssProfile;
      expect(profile1.sceneController.needsRebuild).toBe(true);
      expect(profile1.sceneController.buildSceneMs).toBeGreaterThanOrEqual(0);

      // Second call with same state — does NOT need rebuild
      ctrl.applySceneState(state);

      const profile2 = (globalThis as any).__voxcssProfile;
      expect(profile2.sceneController.needsRebuild).toBe(false);
      expect(profile2.sceneController.buildSceneMs).toBe(0);
    });
  });

  // =========================================================================
  // Lines 67-71: getSceneProfile() creating the entry
  // =========================================================================
  describe("getSceneProfile edge cases", () => {
    afterEach(() => {
      delete (globalThis as any).__voxcssProfile;
    });

    it("creates sceneController entry when __voxcssProfile exists but has no sceneController", () => {
      (globalThis as any).__voxcssProfile = {};

      const ctrl = sceneController();
      ctrl.applySceneState(makeSceneState({
        voxels: [{ x: 0, y: 0, z: 0 }]
      }));

      expect((globalThis as any).__voxcssProfile.sceneController).toBeDefined();
    });

    it("handles null __voxcssProfile gracefully", () => {
      (globalThis as any).__voxcssProfile = null;

      const ctrl = sceneController();
      // Should not crash
      ctrl.applySceneState(makeSceneState({
        voxels: [{ x: 0, y: 0, z: 0 }]
      }));
    });

    it("handles non-object __voxcssProfile gracefully", () => {
      (globalThis as any).__voxcssProfile = 42;

      const ctrl = sceneController();
      // Should not crash
      ctrl.applySceneState(makeSceneState({
        voxels: [{ x: 0, y: 0, z: 0 }]
      }));
    });
  });

  // =========================================================================
  // Camera rotation update where walls DON'T change but rotX/rotY do
  // (line 222-223: the else-if branch in updateCamera)
  // =========================================================================
  describe("camera rotation without wall mask change", () => {
    it("updates context rotX/rotY even when wall mask stays the same", () => {
      const ctrl = sceneController({ camera: { rotX: 60, rotY: 45 } });

      const listener = vi.fn();
      ctrl.subscribeSnapshot(listener);
      listener.mockClear();

      // Small rotation that stays in the same quadrant (no wall mask change)
      ctrl.updateCamera({ rotX: 62, rotY: 47 });

      expect(listener).toHaveBeenCalled();
      const snap = listener.mock.calls[0][0];
      expect(snap.camera.rotX).toBe(62);
      expect(snap.camera.rotY).toBe(47);
      expect(snap.cameraOnly).toBe(true);
    });
  });

  // =========================================================================
  // applySceneState: voxels.length change triggers rebuild
  // =========================================================================
  describe("applySceneState rebuild detection", () => {
    it("rebuilds when voxels array length changes", () => {
      const ctrl = sceneController();

      const state1 = makeSceneState({
        voxels: [{ x: 0, y: 0, z: 0 }]
      });
      ctrl.applySceneState(state1);

      const state2 = makeSceneState({
        voxels: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]
      });
      const result = ctrl.applySceneState(state2);

      // Should have rebuilt with the new voxels
      expect(result.layers).toBeDefined();
    });

    it("rebuilds when rows changes", () => {
      const ctrl = sceneController();

      const state1 = makeSceneState({
        voxels: [{ x: 0, y: 0, z: 0 }],
        rows: 5
      });
      ctrl.applySceneState(state1);

      const state2 = makeSceneState({
        voxels: [{ x: 0, y: 0, z: 0 }],
        rows: 10
      });
      const result = ctrl.applySceneState(state2);

      expect(result.context.rows).toBeGreaterThanOrEqual(10);
    });

    it("rebuilds when cols changes", () => {
      const ctrl = sceneController();

      const state1 = makeSceneState({
        voxels: [{ x: 0, y: 0, z: 0 }],
        cols: 5
      });
      ctrl.applySceneState(state1);

      const state2 = makeSceneState({
        voxels: [{ x: 0, y: 0, z: 0 }],
        cols: 10
      });
      const result = ctrl.applySceneState(state2);

      expect(result.context.cols).toBeGreaterThanOrEqual(10);
    });

    it("rebuilds when depth changes", () => {
      const ctrl = sceneController();

      const state1 = makeSceneState({
        voxels: [{ x: 0, y: 0, z: 0 }],
        depth: 3
      });
      ctrl.applySceneState(state1);

      const state2 = makeSceneState({
        voxels: [{ x: 0, y: 0, z: 0 }],
        depth: 8
      });
      const result = ctrl.applySceneState(state2);

      expect(result.context.depth).toBeGreaterThanOrEqual(8);
    });
  });

  // =========================================================================
  // resolveGrid caching — non-cube voxels
  // =========================================================================
  describe("resolveGrid with non-cube shapes", () => {
    it("detects non-cube-only voxels correctly", () => {
      const ctrl = sceneController();

      const state = makeSceneState({
        voxels: [
          { x: 0, y: 0, z: 0, shape: "ramp", color: "#ff0000" },
          { x: 1, y: 0, z: 0, shape: "cube", color: "#00ff00" }
        ]
      });

      const result = ctrl.applySceneState(state);
      expect(result).toBeDefined();
    });
  });
});
