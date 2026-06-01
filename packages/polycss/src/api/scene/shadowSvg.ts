/**
 * Shadow SVG primitives — small helpers + a mutable state container for the
 * global ground-shadow SVG. Extracted from createPolyScene.ts so the bulk
 * shadow emit logic can be lifted out next.
 *
 * Why a class for ground state: the original code used three `let` bindings
 * (`groundShadowSvg`, `groundShadowVisible`, `currentGroundCssZ`) inside the
 * createPolyScene closure. Wrapping them in a class instance lets us pass a
 * single reference to extracted helpers that need to read AND write them.
 */
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Mutable bag of ground-shadow SVG state. Created once per `createPolyScene`
 * call and passed into any helper that needs to read or mutate it. Equivalent
 * to the original `let` bindings, just hoisted into a referenceable object.
 */
export class ShadowSvgState {
  /** The shared ground-shadow SVG element. `null` until `ensureGroundShadow`
   *  creates it lazily on first emit. */
  groundSvg: SVGSVGElement | null = null;
  /** Tracks whether `groundSvg.style.display` is currently `block`. We toggle
   *  to `none` instead of removing+reinserting between frames so the
   *  compositor layer stays warm. */
  groundVisible = false;
  /** CSS-Z of the shadow ground plane. Set by recomputeShadowGround. In
   *  dynamic mode flows into `--shadow-ground-cssz` (drives `--shadow-proj`);
   *  in baked mode is read by `emitShadowLeaves` for the per-leaf inline
   *  projection matrix. `null` = no casting mesh yet, suppress emission. */
  currentGroundCssZ: number | null = null;
}

/** Remove the ground-shadow SVG from the DOM and reset the state bag.
 *  Idempotent. */
export function disposeGroundShadow(state: ShadowSvgState): void {
  if (state.groundSvg?.parentNode) state.groundSvg.parentNode.removeChild(state.groundSvg);
  state.groundSvg = null;
  state.groundVisible = false;
}

/** Hide the ground-shadow SVG by toggling `display: none` (keeps it in the
 *  DOM so the layer stays warm). Idempotent. */
export function hideGroundShadow(state: ShadowSvgState): void {
  if (state.groundSvg && state.groundVisible) {
    state.groundSvg.style.display = "none";
    state.groundVisible = false;
  }
}

/**
 * Lazily create the ground-shadow SVG inside `sceneEl` (insert as first child
 * so it composites under everything else) and toggle it visible. Reuses the
 * existing element across emits.
 */
export function ensureGroundShadow(
  state: ShadowSvgState,
  doc: Document,
  sceneEl: HTMLElement,
): { svg: SVGSVGElement } {
  let svg = state.groundSvg;
  if (!svg) {
    svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "polycss-shadow polycss-shadow-svg");
    svg.setAttribute("data-poly-shadow-type", "ground");
    svg.setAttribute("data-poly-shadow-receiver", "ground");
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";
    svg.style.display = "block";
    svg.style.overflow = "hidden";
    svg.style.transformOrigin = "0 0";
    svg.style.pointerEvents = "none";
    svg.style.willChange = "transform";
    state.groundSvg = svg;
    const sceneFirst = sceneEl.firstChild;
    if (sceneFirst) sceneEl.insertBefore(svg, sceneFirst);
    else sceneEl.appendChild(svg);
  } else if (!svg.parentNode) {
    const sceneFirst = sceneEl.firstChild;
    if (sceneFirst) sceneEl.insertBefore(svg, sceneFirst);
    else sceneEl.appendChild(svg);
  }
  if (!state.groundVisible) {
    svg.style.display = "block";
    state.groundVisible = true;
  }
  return { svg };
}

/**
 * Ensure an SVG has exactly `count` child `<path>` elements (creates or
 * removes as needed). Returns the current ordered list. Used by both ground
 * and receiver-face shadow emitters to keep one path per contributing caster
 * — letting each path carry a `data-poly-shadow-caster` attribute that
 * mirrors the caster mesh's `data-poly-mesh-id` / `data-poly-mesh-index` for
 * DevTools cross-ref.
 *
 * `withStroke` enables the same-color stroke the ground emitter uses to
 * anti-alias the silhouette edge — receiver-face emitters MUST omit it,
 * otherwise per-polygon clip remnants (degenerate slivers, hairline
 * triangles) render as visible outlines.
 */
export function syncShadowPaths(
  svg: SVGSVGElement,
  doc: Document,
  count: number,
  withStroke: boolean,
): SVGPathElement[] {
  const out: SVGPathElement[] = [];
  let existing = svg.firstChild as SVGPathElement | null;
  for (let i = 0; i < count; i++) {
    let path = existing as SVGPathElement | null;
    if (path && path.tagName === "path") {
      existing = path.nextSibling as SVGPathElement | null;
    } else {
      path = doc.createElementNS(SVG_NS, "path");
      path.setAttribute("fill-rule", "nonzero");
      if (withStroke) {
        // 3 px stroke (= 1.5 px outside the path) to cover:
        //  - float-precision sub-pixel gaps from SH-clipping
        //  - configurable seam-bleed leaves overscanning into shadow zone
        //  - residual CSS-compositor sub-pixel overlap that survives even
        //    seamBleed:0 (each leaf is a separate matrix3d layer, browser
        //    rasterises each independently with its own rounding direction
        //    → adjacent edges can round different ways producing 1 px of
        //    lit-color leak into a neighbour's shadow surface; no per-
        //    polygon seamBleed setting can fully prevent this)
        // Reads as soft penumbra at shadow boundaries, similar to
        // Three.js's PCF shadow falloff.
        path.setAttribute("stroke-width", "3");
        path.setAttribute("stroke-linejoin", "round");
      }
      svg.insertBefore(path, existing);
    }
    out.push(path);
  }
  while (existing) {
    const next = existing.nextSibling as SVGPathElement | null;
    svg.removeChild(existing);
    existing = next;
  }
  return out;
}
