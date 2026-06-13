/**
 * PolyScene — Vue 3 equivalent of React's PolyScene.
 * Must be used inside a <PolyCamera>.
 *
 * Renders a polycss-scene wrapper containing all polygons and children.
 * Transform (position/scale/rotation) compose with PolyCamera's camera
 * transform via CSS preserve-3d nested DOM.
 */
import {
  defineComponent,
  h,
  inject,
  provide,
  computed,
  ref,
  watch,
  watchEffect,
  onMounted,
  onUpdated,
  onBeforeUnmount,
} from "vue";
import type { PropType } from "vue";
import type {
  Polygon,
  PolyDirectionalLight,
  PolyAmbientLight,
  PolyTextureBackend,
  PolyTextureImageRendering,
  PolyTextureLeafSizing,
  PolyTextureLightingMode,
  PolyTextureProjection,
  Vec3,
} from "@layoutit/polycss-core";
import {
  DEFAULT_SEAM_BLEED,
  parseHexColor,
  resolvePolyTextureLeafGeometry,
  worldDirectionToCss,
} from "@layoutit/polycss-core";
import { PolyCameraContextKey } from "../camera";
import { usePolySceneContext } from "./useSceneContext";
import { injectPolyBaseStyles } from "../styles";
import {
  PolySceneContextKey,
  type PolyReceiverRegistry,
  type PolyShadowOptions,
  type PolyShadowRegistry,
  type ShadowCasterRegistration,
} from "./sceneContext";
import {
  buildSeamBleedPolygonEdges,
  buildTextureEdgeRepairSets,
  computeTextureAtlasPlan,
  isProjectiveQuadPlan,
  isSolidTrianglePlan,
  type TextureQuality,
  type PolySeamBleed,
  type PolyRenderStrategiesOption,
  renderTextureBorderShapePoly,
  renderTextureAtlasPoly,
  renderTextureImagePoly,
  renderTextureProjectiveSolidPoly,
  renderTextureTrianglePoly,
  useTextureAtlas,
} from "./atlas";

export interface PolySceneProps {
  polygons?: Polygon[];
  centerPolygons?: Polygon[];
  perspective?: number;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  textureLighting?: PolyTextureLightingMode;
  /** Atlas bitmap budget and CSS sprite size. `"auto"` (default) uses a
   *  device-appropriate memory budget (~4 MB mobile / ~16 MB desktop) and
   *  desktop/mobile sprite sizing. Numeric values 0.1..1 force an explicit
   *  raster scale and the 64px sprite. */
  textureQuality?: TextureQuality;
  /** Atlas leaf CSS primitive sizing. Defaults to canonical browser-fast sizing. */
  textureLeafSizing?: PolyTextureLeafSizing;
  /** Default image filtering for atlas and direct image texture leaves. */
  textureImageRendering?: PolyTextureImageRendering;
  /** Default texture backend request. Defaults to "auto". */
  textureBackend?: PolyTextureBackend;
  /** Default texture projection request. Defaults to "affine". */
  textureProjection?: PolyTextureProjection;
  /** Solid seam overscan. `"auto"` computes a fitted per-edge amount from the polygon plan. */
  seamBleed?: PolySeamBleed;
  /** Opt out of specific render strategies. Disabled strategies fall through the chain (b→i→s, u→i→s, i→s). `<s>` cannot be disabled. */
  strategies?: PolyRenderStrategiesOption;
  /**
   * When `true`, rotation pivots around the mesh's bbox center instead of
   * world (0,0,0). Polygon data is not mutated — a wrapper div translates
   * the polygons so the bbox center coincides with the scene anchor (0,0,0).
   * Mirrors React's PolyScene autoCenter prop.
   */
  autoCenter?: boolean;
  /**
   * Shadow appearance for meshes with `castShadow: true`. Works in both
   * lighting modes. Shadows emit as SVG paths and reproject when light,
   * ground, or mesh geometry changes. Defaults:
   * `{ color: "#000000", opacity: 0.25, lift: 0.05, maxExtend: 2000 }`.
   */
  shadow?: PolyShadowOptions;
  class?: string;
  // TransformProps
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  // Debug
  debugShowLabels?: boolean;
  debugShowBackfaces?: boolean;
}

export const PolyScene = defineComponent({
  name: "PolyScene",
  inheritAttrs: false,
  props: {
    polygons: { type: Array as PropType<Polygon[]>, default: undefined },
    centerPolygons: { type: Array as PropType<Polygon[]>, default: undefined },
    perspective: { type: Number },
    rotX: { type: Number },
    rotY: { type: Number },
    zoom: { type: Number },
    directionalLight: {
      type: Object as PropType<PolyDirectionalLight>,
      default: undefined,
    },
    ambientLight: {
      type: Object as PropType<PolyAmbientLight>,
      default: undefined,
    },
    textureLighting: {
      type: String as PropType<PolyTextureLightingMode>,
      default: "baked",
    },
    textureQuality: { type: [Number, String] as PropType<TextureQuality>, default: undefined },
    textureLeafSizing: { type: String as PropType<PolyTextureLeafSizing>, default: undefined },
    textureImageRendering: { type: String as PropType<PolyTextureImageRendering>, default: undefined },
    textureBackend: { type: String as PropType<PolyTextureBackend>, default: undefined },
    textureProjection: { type: String as PropType<PolyTextureProjection>, default: undefined },
    seamBleed: { type: [Number, String] as PropType<PolySeamBleed>, default: undefined },
    strategies: { type: Object as PropType<PolyRenderStrategiesOption>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    shadow: { type: Object as PropType<PolyShadowOptions>, default: undefined },
    class: { type: String },
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: {
      type: [Number, Array] as unknown as PropType<number | Vec3>,
      default: undefined,
    },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    debugShowLabels: { type: Boolean },
    debugShowBackfaces: { type: Boolean },
  },
  setup(props, { slots, attrs }) {
    const cameraCtx = inject(PolyCameraContextKey);
    if (!cameraCtx) {
      throw new Error("polycss: PolyScene must be used inside a PolyCamera.");
    }

    const { sceneElRef, applyTransformDirect } = cameraCtx;

    // Shadow registry: child PolyMesh components register their full caster
    // data (polygons + position + scale + rotation) when castShadow=true. The
    // scene reads registered casters to compute --shadow-ground-cssz, and
    // receiver meshes iterate the same registry to project per-face shadows.
    const shadowRegistryVersion = ref(0);
    const shadowRegistryMap = new Map<symbol, () => ShadowCasterRegistration>();
    const shadowRegistry: PolyShadowRegistry = {
      register(id, getData) {
        shadowRegistryMap.set(id, getData);
        shadowRegistryVersion.value++;
      },
      unregister(id) {
        shadowRegistryMap.delete(id);
        shadowRegistryVersion.value++;
      },
      version: shadowRegistryVersion,
      getEntries() {
        return Array.from(shadowRegistryMap.values());
      },
    };

    // Receiver registry. Tracks whether any mesh has receiveShadow=true so
    // casters can drop their ground-shadow fallback (Three.js parity: only
    // receivers paint shadows when at least one receiver exists).
    const receiverIds = new Set<symbol>();
    const hasAnyReceiver = ref(false);
    const receiverRegistry: PolyReceiverRegistry = {
      register(id) {
        receiverIds.add(id);
        hasAnyReceiver.value = receiverIds.size > 0;
      },
      unregister(id) {
        receiverIds.delete(id);
        hasAnyReceiver.value = receiverIds.size > 0;
      },
      hasAny: hasAnyReceiver,
    };

    // Reactive ground-plane CSS-Z. Dynamic mode also mirrors this into
    // the `--shadow-ground-cssz` CSS var (the watchEffect below); baked
    // mode reads it via context to bake each leaf's inline matrix3d.
    const groundCssZ = ref<number | null>(null);

    const sceneElLocalRef = ref<HTMLElement | null>(null);

    // Propagate scene-level rendering options to descendants (PolyMesh /
    // helpers) so they pick up the same dynamic mode + lights as the
    // scene. Without this, a helper PolyMesh would default to baked
    // rendering while the scene's global CSS rule paints over it with
    // the dynamic calc — producing corrupt tints.
    const sceneCtxValue = computed(() => ({
      textureLighting: props.textureLighting ?? "baked",
      directionalLight: props.directionalLight,
      ambientLight: props.ambientLight,
      strategies: props.strategies,
      seamBleed: props.seamBleed ?? DEFAULT_SEAM_BLEED,
      textureLeafSizing: props.textureLeafSizing,
      textureImageRendering: props.textureImageRendering,
      textureBackend: props.textureBackend,
      textureProjection: props.textureProjection,
      shadow: props.shadow,
      shadowRegistry,
      receiverRegistry,
      groundCssZ: groundCssZ.value,
      sceneEl: sceneElLocalRef.value,
    }));
    provide(PolySceneContextKey, sceneCtxValue);

    // Sync local ref to camera context's sceneElRef so controls that call
    // applyTransformDirect can reach the element.
    watch(sceneElLocalRef, (el) => {
      sceneElRef.value = el;
    });

    // Inject base styles once
    let injected = false;
    onMounted(() => {
      if (injected) return;
      if (typeof document !== "undefined") {
        injectPolyBaseStyles(document);
        injected = true;
      }
    });

    // Retain the debug class for external tooling. The atlas renderer no
    // longer emits separate backface elements.
    watch(
      () => props.debugShowBackfaces,
      (val) => {
        const el = sceneElLocalRef.value;
        if (!el) return;
        el.classList.toggle("polycss-debug-show-backfaces", !!val);
      }
    );

    const inputPolygons = computed(() => props.polygons ?? []);
    const centerInputPolygons = computed(() => props.centerPolygons ?? null);

    const sceneContextOptions = computed(() => ({
      directionalLight: props.directionalLight,
    }));

    const sceneResult = usePolySceneContext(inputPolygons, sceneContextOptions);
    const centerPolygons = computed(() => centerInputPolygons.value ?? inputPolygons.value);
    const centerSceneResult = usePolySceneContext(centerPolygons, sceneContextOptions);

    // Scene transform is applied imperatively via applyTransformDirect, not via
    // Vue's reactive style binding. The sceneStyle computed previously read
    // autoCenterOffset (reactive) but used cameraState (plain snapshot), so any
    // write to autoCenterOffset — even to the same value — would trigger a Vue
    // re-render that patched a stale transform onto the DOM, overwriting the
    // current value that applyTransformDirect had written on the previous rAF
    // tick. Solid-triangle <u> elements are always visible (no opacity:0 phase),
    // so the one-frame stale transform is immediately perceivable as flicker.
    //
    // The watch on sceneElLocalRef syncs the element to the camera context ref
    // asynchronously (next tick after mount). To ensure applyTransformDirect has
    // the element on the very first mounted call, we sync sceneElRef.value
    // directly here before calling it.
    onMounted(() => {
      sceneElRef.value = sceneElLocalRef.value;
      applyTransformDirect();
    });
    // On subsequent re-renders the ref is already synced; applyTransformDirect
    // writes the current camera state to the DOM before the browser paints,
    // correcting any stale transform committed by Vue's patch.
    onUpdated(applyTransformDirect);

    // Per-polygon context: lighting + scene units.
    const polyContext = computed(() => {
      const tileSize = 50;
      return {
        tileSize,
        layerElevation: tileSize,
        directionalLight: props.directionalLight,
        textureLighting: props.textureLighting,
        textureQuality: props.textureQuality,
        textureLeafSizing: props.textureLeafSizing,
        textureImageRendering: props.textureImageRendering,
      };
    });

    // In dynamic mode the atlas is light-independent (CSS does the
    // shading), so we deliberately drop both lights from the plan inputs
    // — that prevents the atlas from rebuilding (and the polygons from
    // blanking) every time the user moves a light slider.
    const textureAtlasPlans = computed(() => {
      const dynamic = props.textureLighting === "dynamic";
      const directionalForAtlas = dynamic ? undefined : props.directionalLight;
      const ambientForAtlas = dynamic ? undefined : props.ambientLight;
      const repairEdges = buildTextureEdgeRepairSets(sceneResult.value.polygons);
      const seamBleed = props.seamBleed ?? DEFAULT_SEAM_BLEED;
      const seamBleedEdges = seamBleed === "auto" || (
        typeof seamBleed === "number" &&
        Number.isFinite(seamBleed) &&
        seamBleed > 0
      )
        ? buildSeamBleedPolygonEdges(sceneResult.value.polygons, {
            tileSize: polyContext.value.tileSize,
            layerElevation: polyContext.value.layerElevation,
            directionalLight: directionalForAtlas,
            ambientLight: ambientForAtlas,
          })
        : null;
      return sceneResult.value.polygons.map((p, i) =>
        computeTextureAtlasPlan(p, i, {
          tileSize: polyContext.value.tileSize,
          layerElevation: polyContext.value.layerElevation,
          directionalLight: directionalForAtlas,
          ambientLight: ambientForAtlas,
          seamBleed: seamBleedEdges?.has(i) ? seamBleed : undefined,
          seamEdges: seamBleedEdges?.get(i),
          textureEdgeRepairEdges: repairEdges[i],
        })
      );
    });
    const atlasTextureLighting = computed<PolyTextureLightingMode>(() => props.textureLighting ?? "baked");
    const atlasTextureQuality = computed(() => props.textureQuality);
    const atlasTextureLeafSizing = computed(() => props.textureLeafSizing);
    const atlasTextureBackend = computed(() => props.textureBackend);
    const atlasTextureImageRendering = computed(() => props.textureImageRendering);
    const atlasTextureProjection = computed(() => props.textureProjection);
    const atlasStrategies = computed(() => props.strategies);
    const textureAtlas = useTextureAtlas(
      textureAtlasPlans,
      atlasTextureLighting,
      atlasTextureQuality,
      atlasTextureLeafSizing,
      atlasTextureBackend,
      atlasTextureImageRendering,
      atlasTextureProjection,
      atlasStrategies,
    );

    // Dynamic mode plumbing: emit normalized light direction + light/ambient
    // color/intensity as CSS custom properties on the scene root. They cascade
    // into every polygon, where a per-element calc resolves the Lambert dot
    // product and tints via background-blend-mode.
    const dynamicLightVars = computed<Record<string, string> | null>(() => {
      if (props.textureLighting !== "dynamic") return null;
      // World→CSS axis swap (X↔Y). Polygon normals (--pnx/--pny/--pnz) are
      // in CSS frame, so the Lambert dot product needs --plx/--ply/--plz in
      // the same frame. Vanilla applies this swap inside applyLightingVars.
      const userDir = props.directionalLight?.direction ?? [0.4, -0.7, 0.59];
      const dir = worldDirectionToCss(userDir as [number, number, number]);
      const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const lx = dir[0] / len, ly = dir[1] / len, lz = dir[2] / len;
      const lightRgb = parseHexColor(props.directionalLight?.color ?? "#ffffff")?.rgb ?? [255, 255, 255];
      const ambRgb = parseHexColor(props.ambientLight?.color ?? "#ffffff")?.rgb ?? [255, 255, 255];
      const lightIntensity = props.directionalLight?.intensity ?? 1;
      const ambientIntensity = props.ambientLight?.intensity ?? 0.4;
      const ch = (n: number) => (n / 255).toFixed(4);
      // Clamp clz away from zero — the shadow projection divides by clz
      // (the up-axis component), so a near-horizontal light would project
      // shadows to infinity.
      const rawClz = lz;
      const clz = Math.sign(rawClz || 1) * Math.max(Math.abs(rawClz), 0.01);
      // Quantize direction-derived vars to 0.01 (~0.57° angular resolution).
      // Matches the vanilla H10 fix in scene/lightingVars.ts: at toFixed(4)
      // every 0.5°/frame drag tick wrote new strings, triggering ~53ms style
      // recalc on dynamic-mode leaves with calc()-driven Lambert. At
      // toFixed(2) ~half of drag ticks land on the same rounded value →
      // Vue's reactivity sees no change → no recalc.
      return {
        "--plx": lx.toFixed(2),
        "--ply": ly.toFixed(2),
        "--plz": lz.toFixed(2),
        "--clx": lx.toFixed(2),
        "--cly": ly.toFixed(2),
        "--clz": clz.toFixed(2),
        "--plr": ch(lightRgb[0]),
        "--plg": ch(lightRgb[1]),
        "--plb": ch(lightRgb[2]),
        "--pli": lightIntensity.toFixed(4),
        "--par": ch(ambRgb[0]),
        "--pag": ch(ambRgb[1]),
        "--pab": ch(ambRgb[2]),
        "--pai": ambientIntensity.toFixed(4),
      };
    });

    const DEFAULT_TILE = 50;

    // Shadow ground plane: derived from the min world-Z of all casting
    // meshes + scene.shadow.lift. Drives the `--shadow-ground-cssz` CSS
    // var in dynamic mode and the `groundCssZ` scene-context value
    // (used by baked-mode meshes to bake their inline matrix3d). A
    // watchEffect is used because child PolyMesh components register
    // after the parent's first render — watchEffect re-runs after
    // registration because it reads shadowRegistryVersion.
    watchEffect(() => {
      const el = sceneElLocalRef.value;
      void shadowRegistryVersion.value;
      const entries = shadowRegistry.getEntries();
      if (entries.length === 0) {
        if (el) el.style.removeProperty("--shadow-ground-cssz");
        if (groundCssZ.value !== null) groundCssZ.value = null;
        return;
      }
      let minWorldZ = Infinity;
      for (const getData of entries) {
        const data = getData();
        for (const poly of data.polygons) {
          for (const v of poly.vertices) {
            const z = v[2] + (data.position[2] ?? 0);
            if (z < minWorldZ) minWorldZ = z;
          }
        }
      }
      if (!Number.isFinite(minWorldZ)) {
        if (el) el.style.removeProperty("--shadow-ground-cssz");
        if (groundCssZ.value !== null) groundCssZ.value = null;
        return;
      }
      const lift = props.shadow?.lift ?? 0.05;
      const next = (minWorldZ + lift) * DEFAULT_TILE;
      if (groundCssZ.value !== next) groundCssZ.value = next;
      if (!el) return;
      if (props.textureLighting === "dynamic") {
        el.style.setProperty("--shadow-ground-cssz", next.toFixed(3));
      } else {
        el.style.removeProperty("--shadow-ground-cssz");
      }
    });

    // Bbox-center of all centerable meshes in world coords. Folded into the
    // scene camera transform (alongside `target`) so the camera orbits the
    // model's visible center without adding a DOM wrapper or shifting polygon
    // coordinates. [0,0,0] when autoCenter is false or there are no polygons.
    // Written to cameraCtx.autoCenterOffset so applyTransformDirect (called
    // by orbit/map controls) picks it up on every pointer-driven camera move.
    const autoCenterOffset = computed<Vec3>(() => {
      if (!props.autoCenter) return [0, 0, 0];
      const bbox = centerSceneResult.value.sceneBbox;
      return [
        (bbox.min[0] + bbox.max[0]) / 2,
        (bbox.min[1] + bbox.max[1]) / 2,
        (bbox.min[2] + bbox.max[2]) / 2,
      ];
    });

    // Keep the camera context's autoCenterOffset in sync so controls that
    // call applyTransformDirect also include the bbox-center contribution.
    watchEffect(() => {
      cameraCtx.autoCenterOffset.value = autoCenterOffset.value;
    });

    // Cleanup hook placeholder — nothing to unsubscribe in PolyScene currently.
    onBeforeUnmount(() => {
      // no-op: reserved for future store subscriptions
    });

    return () => {
      const computedClass = `polycss-scene${props.class ? ` ${props.class}` : ""}`;

      const ctx = polyContext.value;

      const polyNodes = textureAtlas.entries.value.map((entry, index) => {
        if (entry) {
          return renderTextureAtlasPoly({
            entry,
            page: textureAtlas.pages.value[entry.pageIndex],
            textureLighting: ctx.textureLighting ?? "baked",
            textureImageRendering: props.textureImageRendering,
          });
        }
        const plan = textureAtlasPlans.value[index];
        const imageGeometry = plan
          ? resolvePolyTextureLeafGeometry(plan, {
              imageRendering: props.textureImageRendering,
              backend: props.textureBackend,
              projection: props.textureProjection,
            })
          : null;
        if (plan && imageGeometry) {
          return renderTextureImagePoly({
            plan,
            geometry: imageGeometry,
          });
        }
        if (!plan || plan.texture) return null;
        if (textureAtlas.useStableTriangle.value && isSolidTrianglePlan(plan)) {
          return renderTextureTrianglePoly({
            entry: plan,
            textureLighting: ctx.textureLighting ?? "baked",
          });
        }
        if (textureAtlas.useProjectiveQuad.value && isProjectiveQuadPlan(plan)) {
          return renderTextureProjectiveSolidPoly({
            entry: plan,
            textureLighting: ctx.textureLighting ?? "baked",
          });
        }
        if (textureAtlas.useBorderShape.value || textureAtlas.useFullRectSolid.value) {
          return renderTextureBorderShapePoly({
            entry: plan,
            textureLighting: ctx.textureLighting ?? "baked",
            forceBorderShape: !textureAtlas.useFullRectSolid.value,
          });
        }
        return null;
      });

      const slotChildren = slots.default?.() ?? [];

      return h(
        "div",
        {
          ref: sceneElLocalRef,
          class: computedClass,
          "data-polycss-lighting": ctx.textureLighting ?? "baked",
          "aria-hidden": "true",
          style: {
            ...(dynamicLightVars.value ?? null),
            ...(attrs.style as Record<string, unknown> | undefined),
          },
          ...Object.fromEntries(
            Object.entries(attrs).filter(([k]) => k !== "style" && k !== "class")
          ),
        },
        [...polyNodes, ...slotChildren]
      );
    };
  },
});
