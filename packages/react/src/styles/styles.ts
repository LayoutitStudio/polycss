const POLYCSS_STYLE_ID = "polycss-styles";

export function injectPolyBaseStyles(doc: Document = typeof document !== "undefined" ? document : (null as unknown as Document)): void {
  if (!doc || doc.getElementById(POLYCSS_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = POLYCSS_STYLE_ID;
  style.textContent = CORE_BASE_STYLES;
  doc.head.appendChild(style);
}

const CORE_BASE_STYLES = `
/* ── Scene container ────────────────────────────────────────────────────── */

.polycss-scene,
.polycss-scene *,
.polycss-scene *::before,
.polycss-scene *::after {
  box-sizing: border-box;
}

.polycss-scene {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
  perspective: none;
  /* Promote the scene to its own GPU compositing layer. Without this the
     browser re-rasterizes every descendant leaf when the scene transform
     updates each animation frame, causing visible flicker on solid-shape
     meshes (triangles, quads) that have no opacity:0 loading phase to
     hide the re-paint. Matches the same declaration in the vanilla
     polycss stylesheet. */
  will-change: transform;
}

/* ── Camera wrapper ──────────────────────────────────────────────────────── */

/* Matches vanilla .polycss-camera: a simple positioned block that fills the
   host. PolyPerspectiveCamera / PolyOrthographicCamera apply perspective
   inline (driven by their perspective prop), so the CSS file does not bake a
   default. Earlier React/Vue copies added flex centering, overflow:hidden,
   contain:paint, isolation:isolate which shifted layout vs vanilla; removed
   so cross-renderer iframes lay out identically. */
.polycss-camera {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
}
/* React-only descendant default: applies preserve-3d to controls + helpers
   that ride on the camera; vanilla does not need this because every internal
   element sets the property directly. Kept here so user-supplied wrapper
   divs inside PolyCamera still participate in 3D layout. */
.polycss-camera * {
  transform-style: preserve-3d;
  position: absolute;
}

/* ── First-person controls perspective context ──────────────────────────── */

/* PolyFirstPersonControls toggles this class on its host element (the camera
   wrapper). FPV needs a real perspective context so scene Z translation
   produces visible depth motion - without it, walking forward looks like a
   planar pan. The class wins over inline perspective styles (e.g.
   PolyOrthographicCamera's perspective: none) via !important. The actual
   perspective value is set inline by the controls as the
   --polycss-fpv-perspective custom property; the default of 2000px matches
   the controls' lookOffset fallback so the FPV math and visual perspective
   stay in sync. */
.polycss-fpv-host {
  perspective: var(--polycss-fpv-perspective, 2000px) !important;
  transform-style: preserve-3d !important;
}

/* ── Mesh wrapper ───────────────────────────────────────────────────────── */

.polycss-mesh {
  position: absolute;
  transform-style: preserve-3d;
  /* Pivot at wrapper local (0,0,0) for three.js mesh.position/rotation/scale
     parity. Geometry is positioned by the parser (bbox-min-at-origin by
     default, or pre-centered via loadMesh { center: true }). */
  transform-origin: 0 0 0;
}

/* ── Polygon leaf element ───────────────────────────────────────────────── */

/*
 * Polygon faces render as internal leaf elements inside .polycss-scene.
 * The element is positioned absolutely within the scene root; its
 * transform: matrix3d(...) carries the full world-space placement.
 */
.polycss-scene b,
.polycss-scene i,
.polycss-scene s,
.polycss-scene u {
  position: absolute;
  display: block;
  transform-origin: 0 0;
  transform-style: preserve-3d;
  margin: 0;
  padding: 0;
  font: inherit;
  font-weight: normal;
  font-style: normal;
  line-height: 0;
  quotes: none;
  text-decoration: none;
  backface-visibility: hidden;
  background-repeat: no-repeat;
}

.polycss-scene b,
.polycss-scene i,
.polycss-scene u {
  color: var(--polycss-paint, currentColor);
}

.polycss-scene b {
  background: currentColor;
  width: 64px;
  height: 64px;
}

.polycss-mesh.polycss-voxel-mesh > .polycss-voxel-face {
  position: absolute;
  display: block;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
  transform-origin: 0 0;
  margin: 0;
  padding: 0;
  font: inherit;
  line-height: 0;
  pointer-events: none;
}

.polycss-mesh.polycss-voxel-mesh > .polycss-voxel-face > b {
  top: 0;
  left: 0;
  width: var(--polycss-voxel-primitive, 1px);
  height: var(--polycss-voxel-primitive, 1px);
  backface-visibility: visible;
  pointer-events: none;
}

.polycss-scene i {
  width: 16px;
  height: 16px;
  border-color: currentColor;
}

.polycss-scene s {
  width: var(--polycss-atlas-size, 64px);
  height: var(--polycss-atlas-size, 64px);
}

.polycss-scene u {
  width: 0;
  height: 0;
  background: transparent;
  box-sizing: content-box;
  border: 0 solid transparent;
  border-color: transparent transparent currentColor transparent;
  border-width: 0 16px 32px 16px;
}

@supports (corner-top-left-shape: bevel) and (corner-top-right-shape: bevel) {
  .polycss-scene > u,
  .polycss-mesh > u,
  .polycss-bucket > u {
    border-width: 0;
    width: 32px;
    height: 32px;
    background-color: currentColor;
    border-top-left-radius: 50% 100%;
    border-top-right-radius: 50% 100%;
    corner-top-left-shape: bevel;
    corner-top-right-shape: bevel;
  }

  .polycss-scene > u.polycss-corner-shape-solid,
  .polycss-mesh > u.polycss-corner-shape-solid,
  .polycss-bucket > u.polycss-corner-shape-solid {
    width: 16px;
    height: 16px;
    box-sizing: border-box;
    border: 0;
    background: currentColor;
    border-radius: 0;
    corner-top-left-shape: initial;
    corner-top-right-shape: initial;
    corner-bottom-right-shape: initial;
    corner-bottom-left-shape: initial;
  }
}

/* ── Gizmo override ─────────────────────────────────────────────────────── */

/*
 * <TransformControls> renders 3D arrows using the same polygon pipeline
 * as user content, but the gizmo is a UI affordance — both faces of
 * every polygon should remain visible regardless of which way the
 * camera is looking. Otherwise the cuboid shafts and pyramid heads end
 * up half-culled (you see only the side faces, not the caps), and the
 * arrow looks like a flat strip instead of a 3D bar.
 *
 * Transitions on color, border-color, and background-color smooth the
 * idle → hover → drag alpha changes across rect, border-shape, triangle,
 * and atlas paths.
 */
.polycss-transform-controls i,
.polycss-transform-controls b,
.polycss-transform-controls s,
.polycss-transform-controls u {
  backface-visibility: visible;
  transition: color 150ms ease-out, border-color 150ms ease-out, background-color 150ms ease-out;
}

/*
 * Rotate rings are rendered as a single square quad per ring, then masked
 * to a donut via a radial-gradient. --ring-inner-ratio is set inline by
 * <PolyTransformControls> (= innerR / outerR, where outerR is the edge of
 * the quad mapped to 50%). Hit-testing also uses the donut shape — see
 * the ring-aware path in TransformControls.tsx. Single DOM node per ring.
 */
.polycss-transform-ring i,
.polycss-transform-ring b,
.polycss-transform-ring s,
.polycss-transform-ring u {
  --ring-inner-r: calc(var(--ring-inner-ratio, 0.92) * 50%);
  --ring-outer-r: calc(var(--ring-outer-ratio, 1) * 50%);
  -webkit-mask: radial-gradient(circle at 50% 50%,
    transparent 0%,
    transparent var(--ring-inner-r),
    black var(--ring-inner-r),
    black var(--ring-outer-r),
    transparent var(--ring-outer-r));
          mask: radial-gradient(circle at 50% 50%,
    transparent 0%,
    transparent var(--ring-inner-r),
    black var(--ring-inner-r),
    black var(--ring-outer-r),
    transparent var(--ring-outer-r));
}

/* ── Dynamic lighting cascade vars (scene root → polygons) ─────────────── */

/*
 * Dynamic mode: PolyScene writes the directional + ambient light setup to
 * these custom properties on the scene root. Each polygon leaf bakes its
 * own normal directly into an inline calc() that reads these vars to
 * resolve the Lambert dot product and per-channel tint. Sliding the light
 * only writes these scene-root vars — no JS, no atlas redraw.
 *
 * Registering with @property forces the browser to parse the values as
 * <number>s instead of opaque token streams; that makes the polygon-level
 * calc() expressions resolve reliably across engines.
 */

@property --plx { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --ply { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --plz { syntax: "<number>"; inherits: true; initial-value: 1; }

/* CSS-space light components (world-Y→cssX, world-X→cssY, world-Z→cssZ).
   Used by the shadow projection matrix. --clz is clamped away from 0 in JS
   to avoid divide-by-zero when the light is near-horizontal. */
@property --clx { syntax: "<number>"; inherits: true; initial-value: 0.01; }
@property --cly { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --clz { syntax: "<number>"; inherits: true; initial-value: 1; }

/* Ground-plane position in CSS pixels along the CSS-Z axis (= world-Z, the
   up axis in PolyCSS's world convention). Stored as a <number> so it can be
   used directly inside matrix3d() calc() expressions (matrix3d requires
   dimensionless entries — no px units).
   Set by PolyScene from the min world-Z of casting meshes. */
@property --shadow-ground-cssz { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --plr { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --plg { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --plb { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pli { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --par { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pag { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pab { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pai { syntax: "<number>"; inherits: true; initial-value: 0.4; }

/* Per-polygon surface normal — set inline by the renderer. Base RGB channels
   may be hoisted to a mesh wrapper, so they inherit unless overridden inline. */
@property --pnx { syntax: "<number>"; inherits: false; initial-value: 0; }
@property --pny { syntax: "<number>"; inherits: false; initial-value: 0; }
@property --pnz { syntax: "<number>"; inherits: false; initial-value: 1; }
@property --psr { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --psg { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --psb { syntax: "<number>"; inherits: true; initial-value: 1; }

/* Calc-driven Lambert + tint, scoped to dynamic-lighting scenes. Lives
   here (not inline per polygon) so each leaf only carries its tiny normal
   declarations — ~12× smaller per-polygon style payload on big meshes. */
.polycss-scene[data-polycss-lighting="dynamic"] s {
  /*
   * Three.js MeshLambertMaterial parity for textured surfaces. See
   * packages/polycss/src/styles/styles.ts for derivation and probe data.
   * Kept in lockstep across renderer copies per cross-package discipline.
   */
  background-color: rgb(
    calc(255 * max(0, 1.055 * pow(min(1, (
      pow((var(--par) + 0.055) / 1.055, 2.4) * var(--pai) +
      pow((var(--plr) + 0.055) / 1.055, 2.4) * var(--pli) * max(0,
        var(--pnx) * var(--plx) +
        var(--pny) * var(--ply) +
        var(--pnz) * var(--plz))
    ) / 3.14159265), 0.4167) - 0.055))
    calc(255 * max(0, 1.055 * pow(min(1, (
      pow((var(--pag) + 0.055) / 1.055, 2.4) * var(--pai) +
      pow((var(--plg) + 0.055) / 1.055, 2.4) * var(--pli) * max(0,
        var(--pnx) * var(--plx) +
        var(--pny) * var(--ply) +
        var(--pnz) * var(--plz))
    ) / 3.14159265), 0.4167) - 0.055))
    calc(255 * max(0, 1.055 * pow(min(1, (
      pow((var(--pab) + 0.055) / 1.055, 2.4) * var(--pai) +
      pow((var(--plb) + 0.055) / 1.055, 2.4) * var(--pli) * max(0,
        var(--pnx) * var(--plx) +
        var(--pny) * var(--ply) +
        var(--pnz) * var(--plz))
    ) / 3.14159265), 0.4167) - 0.055))
  );
  background-blend-mode: multiply;
  background-image: var(--polycss-atlas-url);
  background-position: var(--polycss-atlas-position);
  background-repeat: no-repeat;
  background-size: var(--polycss-atlas-image-size);
  mask-image: var(--polycss-atlas-url);
  mask-mode: alpha;
  mask-position: var(--polycss-atlas-position);
  mask-repeat: no-repeat;
  mask-size: var(--polycss-atlas-image-size);
  -webkit-mask-image: var(--polycss-atlas-url);
  -webkit-mask-position: var(--polycss-atlas-position);
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-size: var(--polycss-atlas-image-size);
}

.polycss-scene[data-polycss-lighting="dynamic"] b,
.polycss-scene[data-polycss-lighting="dynamic"] i,
.polycss-scene[data-polycss-lighting="dynamic"] u {
  /*
   * Three.js MeshLambertMaterial parity (default useLegacyLights=false,
   * physically-correct pipeline). See packages/polycss/src/styles/styles.ts
   * for the derivation and probe data — kept in lockstep across the three
   * renderer copies per cross-package discipline.
   */
  color: rgb(
    calc(255 * max(0, 1.055 * pow(min(1,
      pow((var(--psr) + 0.055) / 1.055, 2.4) * (
        pow((var(--par) + 0.055) / 1.055, 2.4) * var(--pai) +
        pow((var(--plr) + 0.055) / 1.055, 2.4) * var(--pli) * max(0,
          var(--pnx) * var(--plx) +
          var(--pny) * var(--ply) +
          var(--pnz) * var(--plz))
      ) / 3.14159265
    ), 0.4167) - 0.055))
    calc(255 * max(0, 1.055 * pow(min(1,
      pow((var(--psg) + 0.055) / 1.055, 2.4) * (
        pow((var(--pag) + 0.055) / 1.055, 2.4) * var(--pai) +
        pow((var(--plg) + 0.055) / 1.055, 2.4) * var(--pli) * max(0,
          var(--pnx) * var(--plx) +
          var(--pny) * var(--ply) +
          var(--pnz) * var(--plz))
      ) / 3.14159265
    ), 0.4167) - 0.055))
    calc(255 * max(0, 1.055 * pow(min(1,
      pow((var(--psb) + 0.055) / 1.055, 2.4) * (
        pow((var(--pab) + 0.055) / 1.055, 2.4) * var(--pai) +
        pow((var(--plb) + 0.055) / 1.055, 2.4) * var(--pli) * max(0,
          var(--pnx) * var(--plx) +
          var(--pny) * var(--ply) +
          var(--pnz) * var(--plz))
      ) / 3.14159265
    ), 0.4167) - 0.055))
  );
}

/* Reserved internal <q> shadow element rules. Current shadow emission uses SVG
   surfaces; these rules keep any retained <q> markup styled as a plain
   border-shape leaf instead of inheriting UA quote styling. */
.polycss-scene q {
  position: absolute;
  display: block;
  transform-origin: 0 0;
  transform-style: preserve-3d;
  margin: 0;
  padding: 0;
  font: inherit;
  font-weight: normal;
  font-style: normal;
  line-height: 0;
  text-decoration: none;
  backface-visibility: visible;
  border-color: currentColor;
  pointer-events: none;
  will-change: transform;
}
.polycss-scene q::before,
.polycss-scene q::after {
  content: none;
}

/* ── Retained <q> shadow projection (dynamic-mode CSS path) ─────────────── */

/*
 * Projection matrix for retained internal <q> shadow leaves. Projects any
 * 3D point P onto the horizontal ground plane (cssZ ≈ G) along the CSS-space
 * light direction (--clx/y/z).
 *
 * In PolyCSS's world convention world Z is up (red-green plane is the
 * floor in the axes helper). After the world→CSS swap (Y↔X), world Z stays
 * as CSS Z, so the ground plane normal in CSS space is +cssZ.
 *
 * The strict projection formula would set m22=0 (output.z is a constant G,
 * the polygon is exactly flat). But Chromium SKIPS rendering elements
 * whose composed transform matrix is non-invertible (singular). m22=0
 * makes the matrix singular, so the shadow paints nothing even though it
 * has a valid layout box. The fix: collapse along z by a near-zero
 * scale (Z_SQUASH = 0.01) instead of exactly zero — output.z is then
 * approximately G with ~1% drift from the input, full-rank and renderable.
 * The result still looks flat to the eye (the drift is sub-pixel for
 * any realistic scene size).
 *
 *   out.cssX = P.cssX - (--clx/--clz) * (P.cssZ - G)
 *   out.cssY = P.cssY - (--cly/--clz) * (P.cssZ - G)
 *   out.cssZ = Z_SQUASH * P.cssZ + (1 - Z_SQUASH) * G
 *
 * As column-major 4×4 (CSS matrix3d order):
 *   col1: [1, 0, 0, 0]
 *   col2: [0, 1, 0, 0]
 *   col3: [-(--clx/--clz), -(--cly/--clz), Z_SQUASH, 0]
 *   col4: [G*(--clx/--clz), G*(--cly/--clz), G*(1-Z_SQUASH), 1]
 */
.polycss-scene[data-polycss-lighting="dynamic"] {
  --shadow-proj: matrix3d(
    1, 0, 0, 0,
    0, 1, 0, 0,
    calc(-1 * var(--clx) / var(--clz)),
    calc(-1 * var(--cly) / var(--clz)),
    0.01,
    0,
    calc(var(--shadow-ground-cssz) * var(--clx) / var(--clz)),
    calc(var(--shadow-ground-cssz) * var(--cly) / var(--clz)),
    calc(var(--shadow-ground-cssz) * 0.99),
    1
  );
}

/* Retained <q> opacity gate. Polygons facing the light cast full shadow;
   polygons facing away cast zero shadow. The * 10 multiplier sharpens the
   cutoff so small positive Lambert values jump quickly to 1. */
.polycss-scene[data-polycss-lighting="dynamic"] q {
  opacity: clamp(0, calc((var(--pnx) * var(--clx) + var(--pny) * var(--cly) + var(--pnz) * var(--clz)) * 10), 1);
}
`;
