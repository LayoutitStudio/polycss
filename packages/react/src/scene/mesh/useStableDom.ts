/**
 * useStableDom — the imperative PolyMeshHandle (setPolygons / updatePolygon /
 * rebakeAtlas / whenTexturesReady), the wrapper-element registry wiring, and
 * the `updateStableTriangleDom` same-topology fast path used by
 * `setPolygons`. Extracted verbatim from PolyMesh.tsx.
 */
import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { ForwardedRef, ReactNode } from "react";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
import { updateStableTriangleDom } from "../atlas";
import {
  registerMeshElement,
  unregisterMeshElement,
  type PolyMeshHandle,
} from "../events";
import { recenterPolygons } from "./useMeshGeometry";
import type { MeshLighting } from "./useMeshLighting";

export interface UseStableDomOptions {
  id?: string;
  forwardedRef: ForwardedRef<PolyMeshHandle>;
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  autoCenter?: boolean;
  polygons: Polygon[];
  renderPolygon: ((polygon: Polygon, index: number) => ReactNode) | null;
  setLocalPolygons: (next: Polygon[] | null) => void;
  lighting: MeshLighting;
  whenTexturesReady: () => Promise<void>;
}

export function useStableDom({
  id,
  forwardedRef,
  position,
  scale,
  rotation,
  autoCenter,
  polygons,
  renderPolygon,
  setLocalPolygons,
  lighting,
  whenTexturesReady,
}: UseStableDomOptions) {
  const {
    effectiveTextureLighting,
    effectiveStrategies,
    effectiveSeamBleed,
    effectiveAmbient,
    setBakedRotation,
    bakedDirectional,
    bakedPointLights,
  } = lighting;

  // ── Imperative ref handle + DOM registry ──────────────────────────────
  // The handle is a stable object whose getters always read the latest
  // props. Refs keep getters cheap without rebuilding the handle on every
  // render. The DOM-element registry lets <Select> and <TransformControls>
  // resolve a click target back to its owning mesh in O(depth).
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef({ position, scale, rotation });
  propsRef.current = { position, scale, rotation };
  const polygonsRef = useRef(polygons);
  polygonsRef.current = polygons;

  const stableTriangleColorFrameRef = useRef(0);
  const setPolygonsImplRef = useRef<(next: Polygon[]) => void>(() => {});

  const handle = useMemo<PolyMeshHandle>(() => ({
    get element() { return wrapperRef.current; },
    id,
    getPosition: () => propsRef.current.position,
    getRotation: () => propsRef.current.rotation,
    getScale: () => propsRef.current.scale,
    getPolygons: () => polygonsRef.current,
    setPolygons(nextPolygons: Polygon[]) {
      setPolygonsImplRef.current(nextPolygons);
    },
    rebakeAtlas: () => setBakedRotation(propsRef.current.rotation),
    whenTexturesReady,
    updatePolygon(target: Polygon | number, partial: Partial<Polygon>) {
      const current = polygonsRef.current;
      const idx = typeof target === "number"
        ? target
        : current.indexOf(target);
      if (idx < 0 || idx >= current.length) return;
      Object.assign(current[idx], partial);
      // Shallow-copy the array to produce a new identity, which causes the
      // sourcePolygons → polygons useMemo chain to re-run and re-render.
      setLocalPolygons([...current]);
    },
  }), [id]);

  useImperativeHandle(forwardedRef, () => handle, [handle]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    registerMeshElement(el, handle);
    return () => unregisterMeshElement(el);
  }, [handle]);

  setPolygonsImplRef.current = (nextPolygons: Polygon[]) => {
    const nextRenderedPolygons = autoCenter ? recenterPolygons(nextPolygons) : nextPolygons;
    polygonsRef.current = nextRenderedPolygons;
    const root = wrapperRef.current;
    if (
      root &&
      !renderPolygon &&
      updateStableTriangleDom(root, nextRenderedPolygons, {
        directionalLight: bakedDirectional,
        ambientLight: effectiveAmbient,
        pointLights: bakedPointLights,
        textureLighting: effectiveTextureLighting,
        strategies: effectiveStrategies,
        seamBleed: effectiveSeamBleed,
        colorFrame: ++stableTriangleColorFrameRef.current,
        // Animated low-poly triangles can swing face normals sharply; keep the
        // mounted baked color pinned and animate transforms only.
        colorFreezeFrames: 0,
      })
    ) {
      return;
    }
    setLocalPolygons([...nextPolygons]);
  };

  return { wrapperRef, handle };
}
