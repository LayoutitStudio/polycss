import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BASE_TILE,
  PolyMesh,
  PolyOrthographicCamera,
  PolyPerspectiveCamera,
  PolyScene,
} from "@layoutit/polycss-react";
import type { Vec3 } from "@layoutit/polycss-react";
import type { Polygon } from "@layoutit/polycss-react";
import { exportPolySceneSnapshot } from "@layoutit/polycss";
import GUI from "lil-gui";
import { StatsOverlay } from "../StatsOverlay";
import {
  composeText,
  listGoogleFonts,
  loadFont,
  loadGoogleFont,
  pickWeight,
  type ExtrudeProfile,
  type FontEntry,
  type ParsedFont,
  type WarpShape,
} from "@layoutit/polycss-fonts";
import "./wordart.css";

type Align = "left" | "center" | "right";

interface Preset {
  label: string;
  profile: ExtrudeProfile;
  depth: number;
  color: string;
  sideColor: string;
  /** Back-face color (layered look when different + offset > 0). */
  backColor?: string;
  /** Diagonal back offset for the layered block (down-right). */
  offset?: number;
  warp?: { shape: WarpShape; amount: number };
}

// Left-rail style presets — each is a full "look": extrusion, layered front/back,
// and/or a baked-in WordArt warp (like the builder's shape tiles).
const PRESETS: Preset[] = [
  { label: "Gold Bevel", profile: "bevel", depth: 26, color: "#d4a82a", sideColor: "#7c5e16" },
  { label: "Chrome Round", profile: "round", depth: 32, color: "#cdd3da", sideColor: "#5f6772" },
  { label: "Retro Block", profile: "flat", depth: 6, color: "#ff4d6d", sideColor: "#3a0ca3", backColor: "#3a0ca3", offset: 16 },
  { label: "Comic Pop", profile: "flat", depth: 6, color: "#ffd166", sideColor: "#1d3557", backColor: "#1d3557", offset: 13 },
  { label: "Arch Gold", profile: "bevel", depth: 22, color: "#e9b949", sideColor: "#8a5a12", warp: { shape: "arch", amount: 0.6 } },
  { label: "Wave Mint", profile: "round", depth: 24, color: "#7cffb2", sideColor: "#2f8f5e", warp: { shape: "wave", amount: 0.55 } },
  { label: "Arc Crimson", profile: "flat", depth: 16, color: "#ff5470", sideColor: "#9c2740", warp: { shape: "arc", amount: 0.7 } },
  { label: "Ink Shadow", profile: "flat", depth: 4, color: "#e8edf2", sideColor: "#2b313b", backColor: "#2b313b", offset: 12 },
];

function applyCase(text: string, mode: "as-typed" | "upper" | "lower" | "title"): string {
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  if (mode === "title") return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return text;
}

function readable(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#000";
  const n = parseInt(m[1], 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? "#0b0f18" : "#ffffff";
}

function fitZoom(polygons: Polygon[], stageW: number, stageH: number): number {
  if (!polygons.length) return 0.06;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of polygons) {
    for (const v of p.vertices) {
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
  }
  // Flat text: Y = width (screen-right), X = height (screen-down), Z = depth.
  // As the mesh turntables, width swings into depth, so fit the larger of the two.
  const horizontal = Math.max(maxY - minY, maxZ - minZ);
  const vertical = maxX - minX;
  const fitW = (stageW * 0.7) / (Math.max(horizontal, 1) * BASE_TILE);
  const fitH = (stageH * 0.68) / (Math.max(vertical, 1) * BASE_TILE);
  return Math.max(0.01, Math.min(0.2, Math.min(fitW, fitH)));
}

function codePenPayload(snapshotHtml: string, title: string): string {
  const parsed = new DOMParser().parseFromString(snapshotHtml, "text/html");
  const css = Array.from(parsed.querySelectorAll("style")).map((s) => s.textContent ?? "").filter(Boolean).join("\n\n");
  const html = parsed.body.innerHTML.trim() || snapshotHtml;
  return JSON.stringify({ title, html, css, editors: "100", layout: "left" });
}

function openCodePen(html: string, title: string): void {
  const form = document.createElement("form");
  form.action = "https://codepen.io/pen/define";
  form.method = "POST";
  form.target = "_blank";
  form.setAttribute("rel", "noopener noreferrer");
  form.style.display = "none";
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "data";
  input.value = codePenPayload(html, title);
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

// All controls persist to the URL query string so any look is a shareable link.
const URL_SEARCH = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
const qs = (k: string, d: string) => URL_SEARCH.get(k) ?? d;
const qn = (k: string, d: number) => (URL_SEARCH.has(k) ? Number(URL_SEARCH.get(k)) : d);
const qb = (k: string, d: boolean) => (URL_SEARCH.has(k) ? URL_SEARCH.get(k) === "1" : d);

export function WordArtWorkbench() {
  const [font, setFont] = useState<ParsedFont | null>(null);
  const [catalog, setCatalog] = useState<FontEntry[]>([]);
  const [entry, setEntry] = useState<FontEntry | null>(null);
  const [familyInput, setFamilyInput] = useState(() => qs("font", ""));
  const [weight, setWeight] = useState(() => qn("weight", 700));
  const [italic, setItalic] = useState(() => qb("italic", false));
  const [status, setStatus] = useState("");

  const [text, setText] = useState(() => qs("text", "Poly\nCSS"));
  const [textCase, setTextCase] = useState<"as-typed" | "upper" | "lower" | "title">(() => qs("case", "as-typed") as "as-typed");
  const [scaleX, setScaleX] = useState(() => qn("sx", 100));
  const [scaleY, setScaleY] = useState(() => qn("sy", 100));
  const [profile, setProfile] = useState<ExtrudeProfile>(() => qs("profile", "bevel") as ExtrudeProfile);
  const [depth, setDepth] = useState(() => qn("depth", 26));
  const [letterSpacing, setLetterSpacing] = useState(() => qn("ls", 0));
  const [lineHeight, setLineHeight] = useState(() => qn("lh", 1.15));
  const [align, setAlign] = useState<Align>(() => qs("align", "center") as Align);
  const [underline, setUnderline] = useState(() => qb("ul", false));
  const [strike, setStrike] = useState(() => qb("st", false));
  const [color, setColor] = useState(() => qs("color", "#d4a82a"));
  const [sideColor, setSideColor] = useState(() => qs("side", "#7c5e16"));
  const [backColor, setBackColor] = useState(() => qs("back", "#7c5e16"));
  const [offset, setOffset] = useState(() => qn("offset", 0));
  const [curveSegments, setCurveSegments] = useState(() => qn("curve", 4));
  const [simplify, setSimplify] = useState(() => qn("simplify", 2));
  const [merge, setMerge] = useState(() => qb("merge", false));
  const [profileSegments, setProfileSegments] = useState(() => qn("edge", 3));
  const [warpShape, setWarpShape] = useState<WarpShape>(() => qs("warp", "none") as WarpShape);
  const [warpAmount, setWarpAmount] = useState(() => qn("bend", 0.5));
  const [spin, setSpin] = useState(() => qb("spin", true));
  // Camera + lighting (gallery-style)
  const [perspective, setPerspective] = useState(() => qb("persp", true));
  const [zoomScale, setZoomScale] = useState(() => qn("zoom", 1));
  const [lightIntensity, setLightIntensity] = useState(() => qn("li", 0.95));
  const [ambient, setAmbient] = useState(() => qn("amb", 0.5));
  const [lightColor, setLightColor] = useState(() => qs("lc", "#ffffff"));
  const [lightAz, setLightAz] = useState(() => qn("laz", -25));
  const [lightEl, setLightEl] = useState(() => qn("lel", 45));
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const handleCodePen = async () => {
    const el = document.querySelector<HTMLElement>(".wa-stage .polycss-camera")
      ?? document.querySelector<HTMLElement>(".wa-stage .polycss-scene");
    if (!el || exporting) return;
    setExporting(true);
    try {
      const html = await exportPolySceneSnapshot(el);
      openCodePen(html, `PolyCSS WordArt — ${text.replace(/\n/g, " ")}`);
    } catch (e) {
      setStatus(`CodePen export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  // Default bundled font + Google catalog. If the URL named a font, select it
  // once the catalog is in.
  useEffect(() => {
    loadFont("/fonts/default.ttf").then(setFont).catch((e) => setStatus(String(e)));
    listGoogleFonts()
      .then((c) => {
        setCatalog(c);
        const wanted = qs("font", "").trim().toLowerCase();
        if (wanted) {
          const f = c.find((e) => e.family.toLowerCase() === wanted);
          if (f) setEntry(f);
        }
      })
      .catch(() => {});
  }, []);

  // Persist every control to the URL (non-defaults only, for short links).
  useEffect(() => {
    const p = new URLSearchParams();
    const ss = (k: string, v: string, d: string) => { if (v !== d) p.set(k, v); };
    const sn = (k: string, v: number, d: number) => { if (v !== d) p.set(k, String(v)); };
    p.set("text", text);
    if (entry) p.set("font", entry.family);
    sn("weight", weight, 700);
    if (italic) p.set("italic", "1");
    ss("case", textCase, "as-typed");
    sn("sx", scaleX, 100);
    sn("sy", scaleY, 100);
    ss("profile", profile, "bevel");
    sn("depth", depth, 26);
    sn("ls", letterSpacing, 0);
    sn("lh", lineHeight, 1.15);
    ss("align", align, "center");
    if (underline) p.set("ul", "1");
    if (strike) p.set("st", "1");
    ss("color", color, "#d4a82a");
    ss("side", sideColor, "#7c5e16");
    ss("back", backColor, "#7c5e16");
    sn("offset", offset, 0);
    sn("curve", curveSegments, 1);
    sn("simplify", simplify, 2);
    if (merge) p.set("merge", "1");
    sn("edge", profileSegments, 3);
    ss("warp", warpShape, "none");
    sn("bend", warpAmount, 0.5);
    if (!spin) p.set("spin", "0");
    if (!perspective) p.set("persp", "0");
    sn("zoom", zoomScale, 1);
    sn("li", lightIntensity, 0.95);
    sn("amb", ambient, 0.5);
    ss("lc", lightColor, "#ffffff");
    sn("laz", lightAz, -25);
    sn("lel", lightEl, 45);
    const search = p.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
  }, [text, entry, weight, italic, textCase, scaleX, scaleY, profile, depth, letterSpacing, lineHeight, align, underline, strike, color, sideColor, backColor, offset, curveSegments, simplify, merge, profileSegments, warpShape, warpAmount, spin, perspective, zoomScale, lightIntensity, ambient, lightColor, lightAz, lightEl]);

  // Load the picked Google font whenever family / weight / style changes.
  useEffect(() => {
    if (!entry) return;
    let alive = true;
    setStatus(`loading ${entry.family}…`);
    loadGoogleFont(entry, weight, italic ? "italic" : "normal")
      .then((f) => {
        if (alive) {
          setFont(f);
          setStatus(`${entry.family} ${weight}${italic ? " italic" : ""}`);
        }
      })
      .catch((e) => alive && setStatus(`couldn't load ${entry.family}: ${e}`));
    return () => {
      alive = false;
    };
  }, [entry, weight, italic]);

  const polygons = useMemo<Polygon[]>(() => {
    if (!font) return [];
    return composeText(font, applyCase(text, textCase), {
      size: 100,
      depth,
      profile,
      letterSpacing,
      lineHeight,
      align,
      scaleX: scaleX / 100,
      scaleY: scaleY / 100,
      underline,
      strike,
      color,
      sideColor,
      backColor,
      oblique: offset ? [offset, -offset] : undefined,
      curveSteps: curveSegments,
      simplify,
      merge,
      profileSegments,
      warp: { shape: warpShape, amount: warpAmount },
    });
  }, [font, text, textCase, scaleX, scaleY, depth, profile, letterSpacing, lineHeight, align, underline, strike, color, sideColor, backColor, offset, curveSegments, simplify, merge, profileSegments, warpShape, warpAmount]);

  // Directional light direction from azimuth (left/right) + elevation (height),
  // always biased toward the front so the face stays lit.
  const lightDir = useMemo<Vec3>(() => {
    const a = (lightAz * Math.PI) / 180;
    const e = (lightEl * Math.PI) / 180;
    return [Math.sin(e), Math.sin(a) * Math.cos(e), -Math.max(0.25, Math.cos(e))];
  }, [lightAz, lightEl]);

  function pickFamily(value: string) {
    setFamilyInput(value);
    const f = catalog.find((e) => e.family.toLowerCase() === value.trim().toLowerCase());
    if (f) {
      setEntry(f);
      setWeight(pickWeight(f, weight));
    }
  }

  function applyPreset(p: Preset) {
    setProfile(p.profile);
    setDepth(p.depth);
    setColor(p.color);
    setSideColor(p.sideColor);
    setBackColor(p.backColor ?? p.color);
    setOffset(p.offset ?? 0);
    setWarpShape(p.warp?.shape ?? "none");
    setWarpAmount(p.warp?.amount ?? 0.5);
    setActivePreset(p.label);
  }

  const leftValues: LeftValues = { weight, italic, underline, strike, textCase, align, color, sideColor, backColor };
  const leftSet = (k: keyof LeftValues, v: number | string | boolean) => {
    switch (k) {
      case "weight": setWeight(v as number); break;
      case "italic": setItalic(v as boolean); break;
      case "underline": setUnderline(v as boolean); break;
      case "strike": setStrike(v as boolean); break;
      case "textCase": setTextCase(v as "as-typed" | "upper" | "lower" | "title"); break;
      case "align": setAlign(v as Align); break;
      case "color": setColor(v as string); break;
      case "sideColor": setSideColor(v as string); break;
      case "backColor": setBackColor(v as string); break;
    }
  };

  const guiValues: GuiValues = {
    profile, warp: warpShape, bend: warpAmount,
    depth, letterSpacing, lineHeight, scaleX, scaleY,
    curveSegments, simplify, merge, profileSegments, offset,
    perspective, zoom: zoomScale, spin,
    light: lightIntensity, ambient, az: lightAz, el: lightEl, lightColor,
  };
  const guiSet = (k: keyof GuiValues, v: number | string | boolean) => {
    switch (k) {
      case "profile": setProfile(v as ExtrudeProfile); break;
      case "warp": setWarpShape(v as WarpShape); break;
      case "bend": setWarpAmount(v as number); break;
      case "depth": setDepth(v as number); break;
      case "letterSpacing": setLetterSpacing(v as number); break;
      case "lineHeight": setLineHeight(v as number); break;
      case "scaleX": setScaleX(v as number); break;
      case "scaleY": setScaleY(v as number); break;
      case "curveSegments": setCurveSegments(v as number); break;
      case "simplify": setSimplify(v as number); break;
      case "merge": setMerge(v as boolean); break;
      case "profileSegments": setProfileSegments(v as number); break;
      case "offset": setOffset(v as number); break;
      case "perspective": setPerspective(v as boolean); break;
      case "zoom": setZoomScale(v as number); break;
      case "spin": setSpin(v as boolean); break;
      case "light": setLightIntensity(v as number); break;
      case "ambient": setAmbient(v as number); break;
      case "az": setLightAz(v as number); break;
      case "el": setLightEl(v as number); break;
      case "lightColor": setLightColor(v as string); break;
    }
  };

  return (
    <div className="wa-root">
      <StatsOverlay />
      <Stage
        polygons={polygons}
        zoomScale={zoomScale}
        setZoomScale={setZoomScale}
        perspective={perspective}
        lightDir={lightDir}
        lightIntensity={lightIntensity}
        lightColor={lightColor}
        ambient={ambient}
        spin={spin}
        status={status}
      />

      <aside className="wa-card wa-left" aria-label="Text and presets">
        <div className="wa-card__body">
          <label className="wa-field">
            <span>Text</span>
            <textarea
              className="wa-input"
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
          </label>

          <label className="wa-field">
            <span>Google font</span>
            <FontPicker catalog={catalog} value={familyInput} onPick={pickFamily} />
          </label>

          <LeftGuiPanel values={leftValues} set={leftSet} />

          <div className="wa-section">Presets</div>
          <div className="wa-grid">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className={`wa-tile ${activePreset === p.label ? "is-active" : ""}`} onClick={() => applyPreset(p)}>
                <span className="wa-tile__thumb" style={{ background: p.color, color: readable(p.color) }}>Aa</span>
                <span className="wa-tile__label">{p.label}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <GuiPanel values={guiValues} set={guiSet} />

      <button type="button" className="wa-codepen" onClick={handleCodePen} disabled={exporting}>
        {exporting ? "Exporting…" : "Open in CodePen"}
      </button>
    </div>
  );
}

interface StageProps {
  polygons: Polygon[];
  zoomScale: number;
  setZoomScale: (updater: (prev: number) => number) => void;
  perspective: boolean;
  lightDir: Vec3;
  lightIntensity: number;
  lightColor: string;
  ambient: number;
  spin: boolean;
  status: string;
}

/**
 * Isolated render surface. The auto-spin updates state every frame — keeping it
 * in this small component means only the camera/scene/mesh re-render per frame,
 * not the parent's controls + 2000-option font datalist (which tanked FPS).
 */
function Stage({ polygons, zoomScale, setZoomScale, perspective, lightDir, lightIntensity, lightColor, ambient, spin, status }: StageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 900, h: 600 });
  // Rotation lives in refs and is written straight to the DOM — no React state,
  // so spinning/dragging never re-renders React (keeps it at full frame rate).
  const spinRef = useRef(0);
  const tiltRef = useRef(8);
  const draggingRef = useRef(false);
  const lastPtr = useRef({ x: 0, y: 0 });

  const applyRotation = () => {
    const el = wrapRef.current;
    if (el) el.style.transform = `rotateX(${tiltRef.current}deg) rotateY(${spinRef.current}deg)`;
  };
  useLayoutEffect(applyRotation); // re-assert after any re-render (e.g. new geometry)

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Camera stays dead-on front; the wrapper spins/tilts in 3D (grab-an-object feel).
  useEffect(() => {
    if (!spin) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (!draggingRef.current) {
        spinRef.current = (spinRef.current - dt * 32) % 360;
        applyRotation();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spin]);

  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    lastPtr.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastPtr.current.x;
    const dy = e.clientY - lastPtr.current.y;
    lastPtr.current = { x: e.clientX, y: e.clientY };
    spinRef.current += dx * 0.4;
    tiltRef.current = Math.max(-85, Math.min(85, tiltRef.current - dy * 0.4));
    applyRotation();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  // Wheel drives the same zoomScale the sidebar slider does (so they agree and
  // share one min/max), instead of the orbit-control's separate camera zoom.
  const onWheel = (e: React.WheelEvent) => {
    const factor = Math.pow(0.95, e.deltaY * 0.012);
    setZoomScale((z) => Math.max(0.1, Math.min(6, z * factor)));
  };

  const zoom = fitZoom(polygons, stage.w, stage.h) * zoomScale;
  const Cam = perspective ? PolyPerspectiveCamera : PolyOrthographicCamera;

  return (
    <div
      className="wa-stage"
      ref={stageRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{ cursor: "grab", touchAction: "none" }}
    >
      <Cam zoom={zoom} rotX={0} rotY={0}>
        <PolyScene
          autoCenter
          directionalLight={{ direction: lightDir, intensity: lightIntensity, color: lightColor }}
          ambientLight={{ intensity: ambient }}
        >
          <div ref={wrapRef} style={{ transformStyle: "preserve-3d" }}>
            <PolyMesh polygons={polygons} seamBleed={0.3} />
          </div>
        </PolyScene>
      </Cam>
      <div className="wa-stage-foot">
        {polygons.length.toLocaleString()} polygons{status ? ` · ${status}` : ""}
      </div>
    </div>
  );
}

interface GuiValues {
  profile: string; warp: string; bend: number;
  depth: number; letterSpacing: number; lineHeight: number; scaleX: number; scaleY: number;
  curveSegments: number; simplify: number; merge: boolean; profileSegments: number; offset: number;
  perspective: boolean; zoom: number; spin: boolean;
  light: number; ambient: number; az: number; el: number; lightColor: string;
}

/**
 * Right-hand control panel built with the SAME library the /gallery uses
 * (lil-gui), themed with the gallery's exact CSS variables — so the controls
 * are identical, not a CSS approximation. lil-gui is imperative, so we mount it
 * once and bridge its onChange → React, and React state → updateDisplay().
 */
function GuiPanel({ values, set }: { values: GuiValues; set: (k: keyof GuiValues, v: number | string | boolean) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cfgRef = useRef<GuiValues>({ ...values });
  const ctrlRef = useRef<Record<string, ReturnType<GUI["add"]>>>({});

  useEffect(() => {
    const cfg = cfgRef.current;
    const c = ctrlRef.current;
    const gui = new GUI({ container: hostRef.current!, title: "Settings", width: 300 });
    const on = (k: keyof GuiValues) => (v: number | string | boolean) => set(k, v);

    const shape = gui.addFolder("Shape");
    c.profile = shape.add(cfg, "profile", { "Flat (slab)": "flat", "Round (bullnose)": "round", "Bevel (rounded edge)": "bevel" }).name("Profile").onChange(on("profile"));
    c.warp = shape.add(cfg, "warp", { None: "none", "Arch up": "arch", "Arch down": "archDown", "Arc (circle)": "arc", Wave: "wave", Bulge: "bulge", "Cone (taper)": "cone", "Slant up": "slantUp", "Slant down": "slantDown" }).name("Warp").onChange(on("warp"));
    c.bend = shape.add(cfg, "bend", 0, 1, 0.02).name("Bend").onChange(on("bend"));

    const layout = gui.addFolder("Layout");
    c.depth = layout.add(cfg, "depth", 2, 80, 1).name("Depth").onChange(on("depth"));
    c.letterSpacing = layout.add(cfg, "letterSpacing", -20, 60, 1).name("Letter spacing").onChange(on("letterSpacing"));
    c.lineHeight = layout.add(cfg, "lineHeight", 0.8, 2.5, 0.05).name("Line height").onChange(on("lineHeight"));
    c.scaleX = layout.add(cfg, "scaleX", 40, 200, 1).name("Width %").onChange(on("scaleX"));
    c.scaleY = layout.add(cfg, "scaleY", 40, 200, 1).name("Height %").onChange(on("scaleY"));
    c.curveSegments = layout.add(cfg, "curveSegments", 1, 12, 1).name("Curve segments").onChange(on("curveSegments"));
    c.simplify = layout.add(cfg, "simplify", 0, 8, 0.5).name("Simplify").onChange(on("simplify"));
    c.merge = layout.add(cfg, "merge").name("Merge polygons").onChange(on("merge"));
    c.profileSegments = layout.add(cfg, "profileSegments", 2, 10, 1).name("Edge segments").onChange(on("profileSegments"));
    c.offset = layout.add(cfg, "offset", 0, 32, 1).name("Layer offset").onChange(on("offset"));

    const cam = gui.addFolder("Camera");
    c.perspective = cam.add(cfg, "perspective").name("Perspective").onChange(on("perspective"));
    c.zoom = cam.add(cfg, "zoom", 0.1, 6, 0.05).name("Zoom").onChange(on("zoom"));
    c.spin = cam.add(cfg, "spin").name("Auto-spin").onChange(on("spin"));

    const lighting = gui.addFolder("Lighting");
    c.light = lighting.add(cfg, "light", 0, 2, 0.05).name("Light").onChange(on("light"));
    c.ambient = lighting.add(cfg, "ambient", 0, 1, 0.05).name("Ambient").onChange(on("ambient"));
    c.az = lighting.add(cfg, "az", -90, 90, 1).name("Angle").onChange(on("az"));
    c.el = lighting.add(cfg, "el", 0, 90, 1).name("Elev.").onChange(on("el"));
    c.lightColor = lighting.addColor(cfg, "lightColor").name("Light color").onChange(on("lightColor"));

    return () => gui.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push React state back into the GUI display + toggle conditional controllers.
  useEffect(() => {
    Object.assign(cfgRef.current, values);
    for (const ctrl of Object.values(ctrlRef.current)) ctrl?.updateDisplay();
    ctrlRef.current.bend?.[values.warp !== "none" ? "show" : "hide"]();
    ctrlRef.current.profileSegments?.[values.profile === "round" ? "show" : "hide"]();
  });

  return <div className="wa-gui" ref={hostRef} />;
}

interface LeftValues {
  weight: number; italic: boolean; underline: boolean; strike: boolean;
  textCase: string; align: string; color: string; sideColor: string; backColor: string;
}

/** lil-gui typography + color panel for the left card (blends in, borderless). */
function LeftGuiPanel({ values, set }: { values: LeftValues; set: (k: keyof LeftValues, v: number | string | boolean) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cfgRef = useRef<LeftValues>({ ...values });
  const ctrlRef = useRef<Record<string, ReturnType<GUI["add"]>>>({});
  const segRef = useRef<Record<string, (v: string) => void>>({});

  useEffect(() => {
    const cfg = cfgRef.current;
    const c = ctrlRef.current;
    const gui = new GUI({ container: hostRef.current!, title: "", width: 300 });
    const on = (k: keyof LeftValues) => (v: number | string | boolean) => set(k, v);

    // Inject a segmented button-group into a lil-gui row's widget (lil-gui has
    // no native one — the gallery injects custom widgets the same way).
    const segmented = (folder: GUI, name: string, key: keyof LeftValues, options: [string, string, string][]) => {
      const ctrl = folder.add({ _: "" }, "_").name(name);
      const widget = ctrl.domElement.querySelector<HTMLElement>(".widget");
      if (!widget) return;
      widget.replaceChildren();
      widget.classList.add("wa-seg");
      const btns: Record<string, HTMLButtonElement> = {};
      for (const [value, label, title] of options) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener("click", () => set(key, value));
        widget.appendChild(btn);
        btns[value] = btn;
      }
      segRef.current[key] = (v: string) => {
        for (const k in btns) btns[k].classList.toggle("is-on", k === v);
      };
    };

    const type = gui.addFolder("Type");
    c.weight = type.add(cfg, "weight", [100, 200, 300, 400, 500, 600, 700, 800, 900]).name("Weight").onChange(on("weight"));
    c.italic = type.add(cfg, "italic").name("Italic").onChange(on("italic"));
    c.underline = type.add(cfg, "underline").name("Underline").onChange(on("underline"));
    c.strike = type.add(cfg, "strike").name("Strikethrough").onChange(on("strike"));
    segmented(type, "Case", "textCase", [["as-typed", "Aa", "As typed"], ["upper", "AB", "UPPERCASE"], ["lower", "ab", "lowercase"], ["title", "Ab", "Title Case"]]);
    segmented(type, "Align", "align", [["left", "L", "Left"], ["center", "C", "Center"], ["right", "R", "Right"]]);

    const col = gui.addFolder("Color");
    c.color = col.addColor(cfg, "color").name("Face").onChange(on("color"));
    c.sideColor = col.addColor(cfg, "sideColor").name("Sides").onChange(on("sideColor"));
    c.backColor = col.addColor(cfg, "backColor").name("Back").onChange(on("backColor"));

    return () => gui.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    Object.assign(cfgRef.current, values);
    for (const ctrl of Object.values(ctrlRef.current)) ctrl?.updateDisplay();
    segRef.current.textCase?.(values.textCase);
    segRef.current.align?.(values.align);
  });

  return <div className="wa-gui wa-gui--inline" ref={hostRef} />;
}

/** Searchable font dropdown — filters the catalog as you type, styled list. */
function FontPicker({ catalog, value, onPick }: { catalog: FontEntry[]; value: string; onPick: (family: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setQuery(value); }, [value]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? catalog.filter((f) => f.family.toLowerCase().includes(q)) : catalog).slice(0, 80);
  }, [query, catalog]);
  useEffect(() => {
    const h = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, []);
  return (
    <div className="wa-fontpick" ref={wrapRef}>
      <input
        className="wa-input"
        type="text"
        spellCheck={false}
        placeholder={catalog.length ? `search ${catalog.length} fonts…` : "loading…"}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
      />
      {open && results.length > 0 && (
        <ul className="wa-fontpick__list">
          {results.map((f) => (
            <li
              key={f.id}
              className={`wa-fontpick__item ${f.family === value ? "is-active" : ""}`}
              onPointerDown={() => { onPick(f.family); setQuery(f.family); setOpen(false); }}
            >
              {f.family}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}