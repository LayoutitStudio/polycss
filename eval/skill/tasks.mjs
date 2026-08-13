/**
 * Skill evaluation tasks, ordered by difficulty.
 *
 * Each task is a prompt plus objective checks over what actually rendered. A
 * check returns `true` to pass or a string explaining the failure. Checks never
 * inspect the agent's prose — only the built bundle and the live DOM — so a
 * confident wrong answer scores zero.
 *
 * Checks grade painted pixels plus a few structural DOM facts. Pixels are the
 * load-bearing evidence: leaves other than `<b>` are `backface-visibility:
 * hidden`, so a reversed face keeps its box while painting nothing.
 */

const hueOf = ([r, g, b]) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
};

const hueDistance = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const hexToRgb = (hex) => {
  const s = hex.replace("#", "");
  const full = s.length === 3 ? [...s].map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

/**
 * Everything below grades PAINTED PIXELS, not DOM boxes.
 *
 * Leaf strategies other than `<b>` carry `backface-visibility: hidden`, so a
 * back-facing leaf keeps a bounding rect while painting nothing. Reading rects
 * would score a fully reversed mesh as visible — measured, not assumed. Pixel
 * samples are the only evidence that survives that.
 */

/**
 * The page background, measured rather than assumed. A PolyCSS scene is DOM on
 * a white page; a WebGL control track paints whatever clear color it chose. The
 * four corners are background in every framing this suite grades, so their
 * modal color is the ground truth for "not scene content".
 */
function backgroundOf(snapshot) {
  if (snapshot.__bg) return snapshot.__bg;
  const { cols, rows, rgb } = snapshot.pixels;
  const block = 6;
  const counts = new Map();
  for (const [ox, oy] of [
    [0, 0],
    [cols - block, 0],
    [0, rows - block],
    [cols - block, rows - block],
  ]) {
    for (let y = 0; y < block; y += 1) {
      for (let x = 0; x < block; x += 1) {
        const c = rgb[(oy + y) * cols + (ox + x)];
        const key = c.map((v) => Math.round(v / 8) * 8).join(",");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
  snapshot.__bg = best;
  return best;
}

const isBackgroundOf = (rgb, bg) =>
  Math.abs(rgb[0] - bg[0]) + Math.abs(rgb[1] - bg[1]) + Math.abs(rgb[2] - bg[2]) <= 30;

const paintedPixels = (snapshot) => {
  const bg = backgroundOf(snapshot);
  return snapshot.pixels.rgb.filter((rgb) => !isBackgroundOf(rgb, bg));
};

const paintedFraction = (snapshot) =>
  paintedPixels(snapshot).length / snapshot.pixels.rgb.length;

/**
 * Lambert shading multiplies every channel by the same factor under a white
 * light, so hue survives baking. A colored light shifts it, which is why the
 * color tasks ask for default lighting.
 */
const pixelsWithHue = (snapshot, hex, tolerance = 30) => {
  const target = hueOf(hexToRgb(hex));
  if (target === null) return [];
  const { cols } = snapshot.pixels;
  const bg = backgroundOf(snapshot);
  const out = [];
  snapshot.pixels.rgb.forEach((rgb, index) => {
    if (isBackgroundOf(rgb, bg)) return;
    const hue = hueOf(rgb);
    if (hue === null || hueDistance(hue, target) > tolerance) return;
    out.push({ rgb, x: index % cols, y: Math.floor(index / cols) });
  });
  return out;
};

/** At 120x80 a shape worth seeing covers well over 40 samples. */
const hasHue = (snapshot, hex, minPixels = 40) =>
  pixelsWithHue(snapshot, hex).length >= minPixels;

const boundsOf = (pixels) => ({
  x0: Math.min(...pixels.map((p) => p.x)),
  x1: Math.max(...pixels.map((p) => p.x)),
  y0: Math.min(...pixels.map((p) => p.y)),
  y1: Math.max(...pixels.map((p) => p.y)),
});

/** How many samples changed between the two captures. */
function changedFraction(a, b) {
  const left = a.pixels.rgb;
  const right = b.pixels.rgb;
  if (left.length !== right.length) return 1;
  let changed = 0;
  for (let i = 0; i < left.length; i += 1) {
    const d =
      Math.abs(left[i][0] - right[i][0]) +
      Math.abs(left[i][1] - right[i][1]) +
      Math.abs(left[i][2] - right[i][2]);
    if (d > 24) changed += 1;
  }
  return changed / left.length;
}

const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const percentile = (sorted, p) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

/**
 * Brightness of the surface painted in `hex`, as the median luma of its
 * pixels. A scene whose light points away from every visible face still paints
 * the right hue at near-black, and a blown-out one washes to white — both are
 * "the right color" to a hue test and wrong to a human.
 */
function surfaceBrightness(snapshot, hex) {
  const lumas = pixelsWithHue(snapshot, hex)
    .map((p) => luma(p.rgb))
    .sort((a, b) => a - b);
  return { count: lumas.length, median: percentile(lumas, 0.5) };
}

/**
 * Shadow contrast, measured on the receiver rather than on the shadow markup.
 * Counting `<path>` nodes proves a shadow was emitted, not that it darkens
 * anything — `opacity: 0` emits the same paths. Comparing the receiver's dark
 * tail against its own median is what separates a visible shadow from a
 * technically-present one.
 *
 * `excludeHex` drops the caster's own pixels so the statistics describe the
 * ground, not the object standing on it.
 */
function receiverContrast(snapshot, excludeHex) {
  const target = excludeHex === null ? null : hueOf(hexToRgb(excludeHex));
  const bg = backgroundOf(snapshot);
  const lumas = [];
  for (const rgb of snapshot.pixels.rgb) {
    if (isBackgroundOf(rgb, bg)) continue;
    if (target !== null) {
      const hue = hueOf(rgb);
      if (hue !== null && hueDistance(hue, target) <= 30) continue;
    }
    lumas.push(luma(rgb));
  }
  lumas.sort((a, b) => a - b);
  const median = percentile(lumas, 0.5);
  const dark = percentile(lumas, 0.1);
  const threshold = median * 0.85;
  const darkShare = lumas.length === 0 ? 0 : lumas.filter((l) => l < threshold).length / lumas.length;
  return { count: lumas.length, median, dark, ratio: median === 0 ? 1 : dark / median, darkShare };
}

/**
 * Distinct Lambert shading levels within one hue. Each differently-oriented
 * face of a solid gets its own brightness, so this counts how many faces of a
 * shape are actually being painted — the signal that separates correct winding
 * from a mesh whose faces are all wound inward.
 */
function shadeLevels(snapshot, hex, minPixels = 15) {
  const buckets = new Map();
  for (const { rgb } of pixelsWithHue(snapshot, hex)) {
    const luma = Math.round((0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 12);
    buckets.set(luma, (buckets.get(luma) ?? 0) + 1);
  }
  return [...buckets.values()].filter((n) => n >= minPixels).length;
}

/* ── shared checks ────────────────────────────────────────────────── */

const mountsCleanly = {
  id: "mounts",
  describe: "mounts with no console errors or exceptions",
  run: ({ errors }) => (errors.length === 0 ? true : `runtime errors: ${errors.join(" / ")}`),
};

const hasScene = {
  id: "scene",
  describe: "renders exactly one PolyCSS scene inside a camera",
  run: ({ first }) => {
    if (first.sceneCount !== 1) return `expected 1 .polycss-scene, found ${first.sceneCount}`;
    if (first.cameraCount < 1) return "no .polycss-camera ancestor — camera must wrap the scene";
    return true;
  },
};

const paintsSomething = (minFraction = 0.03) => ({
  id: "paints",
  describe: `paints at least ${Math.round(minFraction * 100)}% of the viewport`,
  run: ({ first }) => {
    const covered = paintedFraction(first);
    return covered >= minFraction
      ? true
      : `only ${(covered * 100).toFixed(1)}% of the viewport is painted (${first.leafTotal} leaves mounted)`;
  },
});

/**
 * Framing, as a band rather than a floor. `zoom` is CSS pixels per world unit,
 * so the on-screen size of a shape is set by TWO numbers — its world size and
 * the camera zoom — and getting either wrong is invisible to a floor-only
 * check: a cube scaled past the viewport edges paints ~100% and "passes".
 */
const framedWithin = (hex, minFraction, maxFraction) => ({
  id: "scale",
  describe: `the subject fills between ${Math.round(minFraction * 100)}% and ${Math.round(maxFraction * 100)}% of the viewport`,
  run: ({ first }) => {
    // Measured on the SUBJECT's own hue, not on "anything not background".
    // A shape scaled past every edge becomes the background by definition —
    // corner sampling would call the cube the page and report ~0% painted.
    const covered = pixelsWithHue(first, hex).length / first.pixels.rgb.length;
    if (covered < minFraction) {
      return `the ${hex} subject fills only ${(covered * 100).toFixed(1)}% of the viewport - too small, or scaled so far past the edges that it fills the frame; raise or lower both the shape size and the camera zoom`;
    }
    if (covered > maxFraction) {
      return `the ${hex} subject fills ${(covered * 100).toFixed(1)}% of the viewport - overscaled and running past the edges; lower the shape size or the camera zoom`;
    }
    return true;
  },
});

/**
 * The surface is actually lit. A hue test alone passes a cube whose every
 * visible face points away from the light (correct hue, near-black) and one
 * blown out to white — both read as "the right color" to a hue check.
 */
const litWithin = (hex, minLuma, maxLuma) => ({
  id: "brightness",
  describe: `paints ${hex} at a usable brightness`,
  run: ({ first }) => {
    const { count, median } = surfaceBrightness(first, hex);
    if (count < 40) return `not enough ${hex} surface to judge brightness (${count} samples)`;
    if (median < minLuma) {
      return `${hex} surfaces average luma ${median.toFixed(0)} - too dark; the light points away from every visible face, or ambient is too low`;
    }
    if (median > maxLuma) {
      return `${hex} surfaces average luma ${median.toFixed(0)} - blown out; lower the light or ambient intensity`;
    }
    return true;
  },
});

/** A lit solid shows a different Lambert shade per face orientation. */
const isShaded = (hex, minShades = 2) => ({
  id: "shaded",
  describe: "faces are individually shaded rather than flat-filled",
  run: ({ first }) => {
    const levels = shadeLevels(first, hex);
    return levels >= minShades
      ? true
      : `only ${levels} distinct shade(s) of ${hex} - the faces are not being lit separately`;
  },
});

const colorMatches = (hex) => ({
  id: `color${hex}`,
  describe: `paints a visible surface in the requested color (${hex})`,
  run: ({ first }) => {
    const n = pixelsWithHue(first, hex).length;
    return n >= 40 ? true : `only ${n} painted samples near the hue of ${hex}`;
  },
});

const isStill = {
  id: "still",
  describe: "camera does not move on its own",
  run: ({ first, second }) => {
    const changed = changedFraction(first, second);
    return changed < 0.01
      ? true
      : `${(changed * 100).toFixed(1)}% of the image changed between samples — the task asked for a fixed camera`;
  },
};

const isMoving = {
  id: "moving",
  describe: "camera orbits over time",
  run: ({ first, second }) => {
    const changed = changedFraction(first, second);
    return changed >= 0.02
      ? true
      : `only ${(changed * 100).toFixed(1)}% of the image changed between samples — nothing is animating`;
  },
};

/**
 * The shadow must DARKEN the receiver, not merely exist in the markup. An
 * `opacity: 0` shadow, or one z-fighting with the surface it lands on, emits
 * exactly the same `<path>` nodes as a working one — which is how a
 * renderer-wide invisible-shadow default survived until this check existed.
 */
const shadowDarkensReceiver = (casterHex) => ({
  id: "shadow-contrast",
  describe: "the cast shadow visibly darkens the receiver",
  run: ({ first }) => {
    const c = receiverContrast(first, casterHex);
    if (c.count < 200) return `not enough receiver surface to measure (${c.count} samples)`;
    return c.ratio <= 0.95
      ? true
      : `the receiver's dark tail is ${(c.ratio * 100).toFixed(0)}% of its median brightness - shadow paths are emitted but nothing is darker`;
  },
});

/* ── tasks ────────────────────────────────────────────────────────── */

export const TASKS = [
  {
    id: "01-static-cube",
    title: "Static colored cube",
    prompt: `Build a PolyCSS scene showing a single cube.

- The cube must be orange: #ff8c1a.
- The camera is fixed — it must not rotate, orbit, or animate.
- Light it with a plain white directional light plus ambient fill, so the cube
  reads clearly as its own color and each face is shaded differently.
- Frame it so the cube fills roughly a third of the 900x600 viewport: clearly
  more than a speck, and not running off the edges. Remember that on-screen
  size comes from BOTH the shape's world size and the camera zoom.`,
    visual: [
      mountsCleanly,
      framedWithin("#ff8c1a", 0.05, 0.55),
      colorMatches("#ff8c1a"),
      litWithin("#ff8c1a", 40, 210),
      isShaded("#ff8c1a", 2),
      isStill,
    ],
    native: [
      hasScene,
      {
        id: "one-mesh",
        describe: "adds exactly one mesh",
        run: ({ first }) =>
          first.meshCount === 1 ? true : `expected 1 mesh, found ${first.meshCount}`,
      },
      {
        id: "cheap-leaves",
        describe: "a box renders as solid quad leaves, not atlas slices",
        run: ({ first }) =>
          first.strategies.s === 0
            ? true
            : `${first.strategies.s} atlas leaves — an untextured box should be solid quads`,
      },
    ],
  },

  {
    id: "02-orbiting-cube",
    title: "Cube with an orbiting camera",
    prompt: `Build a PolyCSS scene showing a single cube.

- The cube must be teal: #14b8a6.
- The camera must orbit the cube continuously on its own, without any user
  input, at a slow speed.
- The user should also be able to drag to rotate and use the wheel to zoom.
- Light it with a plain white directional light plus ambient fill.
- Frame it so the cube fills roughly a third of the 900x600 viewport: clearly
  more than a speck, and not running off the edges. Remember that on-screen
  size comes from BOTH the shape's world size and the camera zoom.`,
    visual: [
      mountsCleanly,
      framedWithin("#14b8a6", 0.05, 0.55),
      colorMatches("#14b8a6"),
      litWithin("#14b8a6", 25, 190),
      isMoving,
    ],
    native: [
      hasScene,
      {
        id: "no-raf-loop",
        describe: "does not hand-roll a per-polygon animation loop",
        run: ({ source }) =>
          /requestAnimationFrame/.test(source) && !/createPolyOrbitControls|OrbitControls/.test(source)
            ? "hand-rolled requestAnimationFrame loop instead of orbit controls"
            : true,
      },
    ],
  },

  {
    id: "03-cube-with-shadow",
    title: "Cube casting a shadow",
    prompt: `Build a PolyCSS scene showing a single cube resting above a flat ground
surface, lit by a directional light.

- The cube must be amber: #fbbf24.
- The cube must cast a visible shadow onto the ground.
- The camera is fixed.`,
    visual: [
      mountsCleanly,
      paintsSomething(),
      colorMatches("#fbbf24"),
      shadowDarkensReceiver("#fbbf24"),
    ],
    native: [
      hasScene,
      {
        id: "shadow-drawn",
        describe: "a cast shadow is actually painted",
        run: ({ first }) =>
          first.shadow.pathCount > 0 && first.shadow.area > 100
            ? true
            : `no shadow geometry rendered (${first.shadow.svgCount} svg, ${first.shadow.pathCount} paths, area ${first.shadow.area})`,
      },
      {
        id: "receiver",
        describe: "a receiver exists — vanilla has no ground-shadow fallback",
        run: ({ source }) =>
          /receiveShadow/.test(source)
            ? true
            : "no receiveShadow anywhere; in vanilla a caster with no receiver draws nothing",
      },
    ],
  },

  {
    id: "04-two-shapes",
    title: "Two shapes side by side",
    prompt: `Build a PolyCSS scene showing two different shapes side by side, clearly
separated so neither hides the other:

- a cube in indigo #6366f1
- a sphere in rose #f43f5e

The camera is fixed. Use the default lighting.`,
    visual: [
      mountsCleanly,
      paintsSomething(0.04),
      colorMatches("#6366f1"),
      colorMatches("#f43f5e"),
      {
        id: "separated",
        describe: "the two shapes do not overlap on screen",
        run: ({ first }) => {
          const indigo = pixelsWithHue(first, "#6366f1");
          const rose = pixelsWithHue(first, "#f43f5e");
          if (indigo.length < 40 || rose.length < 40) {
            return `one shape is missing (${indigo.length} vs ${rose.length} samples)`;
          }
          const a = boundsOf(indigo);
          const b = boundsOf(rose);
          const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
          const overlapY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
          return overlapX < 0 || overlapY < 0
            ? true
            : `painted regions overlap by ${overlapX + 1}x${overlapY + 1} samples`;
        },
      },
    ],
    native: [
      hasScene,
      {
        id: "two-meshes",
        describe: "adds two separate meshes",
        run: ({ first }) =>
          first.meshCount === 2 ? true : `expected 2 meshes, found ${first.meshCount}`,
      },
    ],
  },

  {
    id: "05-hand-authored-polygons",
    title: "Hand-authored polygons",
    prompt: `Build a PolyCSS scene showing a flat 2x2 checkerboard of four square
tiles lying on the ground, seen from above at an angle.

- Author the four tiles yourself as a plain array of polygon objects. Do not
  use any built-in shape helper or generator, and do not load a model file.
- Every tile is lime: #84cc16.
- All four tiles must be visible from the camera looking down at them.
- Leave a small gap between the tiles so the four squares read separately.`,
    visual: [
      mountsCleanly,
      colorMatches("#84cc16"),
      {
        id: "faces-visible",
        describe: "all four tiles face the camera (correct winding)",
        run: ({ first }) => {
          // Four flat tiles share one normal, so they share one Lambert shade
          // and the only question is how much of that shade is painted. A tile
          // wound the other way is backface-culled and paints nothing at all,
          // so lost coverage counts the tiles that got their vertex order
          // wrong. Four tiles were measured at ~9% of the viewport; require
          // enough for all four rather than a bare majority.
          const painted = pixelsWithHue(first, "#84cc16").length;
          const total = first.pixels.rgb.length;
          const share = painted / total;
          return share >= 0.055
            ? true
            : `only ${(share * 100).toFixed(1)}% of the viewport is lime - tiles wound away from the camera are backface-culled and paint nothing`;
        },
      },
    ],
    native: [
      hasScene,
      {
        id: "authored",
        describe: "geometry is hand-authored, not generated by a helper",
        run: ({ source }) =>
          /(box|sphere|cone|cylinder|plane|torus|tetrahedron|octahedron|icosahedron|dodecahedron)Polygons|createPoly(Box|Sphere|Cone|Cylinder|Plane|Torus|Tetrahedron|Octahedron|Icosahedron|Dodecahedron)/i.test(
            source,
          )
            ? "used a built-in shape helper instead of authoring polygons"
            : true,
      },
      {
        id: "no-named-colors",
        describe: "uses a parseable color format",
        run: ({ source }) =>
          /color:\s*["'](?!#|rgb)[a-z]+["']/i.test(source)
            ? "used a CSS named color; PolyCSS parses only hex, rgb() and rgba()"
            : true,
      },
    ],
  },

  {
    id: "06-composed-scene",
    title: "Composed scene",
    prompt: `Build a small PolyCSS scene that composes several things together:

- A flat ground surface in slate #64748b.
- Three shapes standing on the ground, spread out so all three are visible:
  a cube in red #ef4444, a cylinder in blue #3b82f6, and a torus in
  yellow #eab308.
- A directional light plus some ambient fill.
- All three shapes cast shadows onto the ground.
- The user can drag to orbit and use the wheel to zoom.`,
    visual: [
      mountsCleanly,
      paintsSomething(0.15),
      colorMatches("#ef4444"),
      colorMatches("#3b82f6"),
      colorMatches("#eab308"),
      shadowDarkensReceiver(null),
    ],
    native: [
      hasScene,
      {
        id: "four-meshes",
        describe: "ground plus three shapes are separate meshes",
        run: ({ first }) =>
          first.meshCount >= 4 ? true : `expected at least 4 meshes, found ${first.meshCount}`,
      },
      {
        id: "shadow-drawn",
        describe: "shadows are painted on the ground",
        run: ({ first }) =>
          first.shadow.pathCount > 0 && first.shadow.area > 100
            ? true
            : `no shadow geometry rendered (${first.shadow.pathCount} paths, area ${first.shadow.area})`,
      },
      {
        id: "controls",
        describe: "uses the built-in controls rather than manual input handling",
        run: ({ source }) =>
          /createPolyOrbitControls|createPolyMapControls/.test(source)
            ? true
            : "no PolyCSS controls; drag/wheel should not be hand-wired",
      },
    ],
  },
];

export const TASK_IDS = TASKS.map((t) => t.id);

/** Every check a task can run, for reporting totals. */
export const allChecks = (task) => [...task.visual, ...task.native];

export function selectTasks(ids) {
  if (ids.length === 0) return TASKS;
  const unknown = ids.filter((id) => !TASK_IDS.includes(id));
  if (unknown.length > 0) {
    throw new Error(`unknown task(s): ${unknown.join(", ")}\nknown: ${TASK_IDS.join(", ")}`);
  }
  return TASKS.filter((t) => ids.includes(t.id));
}

export const __testing = {
  luma,
  surfaceBrightness,
  receiverContrast,
  hueOf,
  hueDistance,
  hexToRgb,
  hasHue,
  pixelsWithHue,
  paintedFraction,
  changedFraction,
  shadeLevels,
  boundsOf,
};
