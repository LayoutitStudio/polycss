export const CSSGRAPHICS_REVISION = "bb2d0b030b9a5b15f2268d8221b57b56fb61be30";

export const STABLE_CSSGRAPHICS_BROWSER_CONTRACTS = Object.freeze([
  Object.freeze({
    id: "3dpipes",
    label: "3D Pipes",
    cadence: Object.freeze({ tickIntervalUs: Object.freeze([50_000, 3]), catchUpPolicy: "single-step" }),
    techniques: Object.freeze(["paged-playback", "paged-variants", "responsive-profiles", "prepared-banks"]),
    expected: Object.freeze({ initial: { className: "leaf material-a", visibility: "hidden" }, sought: { className: "leaf material-b", visibility: "hidden" }, selected: { className: "leaf material-a", sourceFrame: 3 }, final: { visibility: "visible" } }),
    source: Object.freeze([
      "src/adapters/3dpipes/src/prepare/csspipes/endlessTubes.mjs:217-222",
      "src/adapters/3dpipes/src/csspipes/prebakedPlayback.mjs:165-209,226-327",
      "src/adapters/3dpipes/src/csspipes/presentation.mjs:15-50,106-147",
    ]),
  }),
  Object.freeze({
    id: "electropaint",
    label: "ElectroPaint",
    cadence: Object.freeze({ tickIntervalUs: Object.freeze([50_000, 3]), catchUpPolicy: "single-step" }),
    techniques: Object.freeze(["paged-playback", "paged-variants", "large-paged-closure"]),
    expected: Object.freeze({ initial: { className: "leaf material-a", color: "rgb(255, 0, 0)" }, sought: { className: "leaf material-b", color: "rgb(0, 255, 0)", sourceFrame: 2 } }),
    source: Object.freeze([
      "src/adapters/electropaint/README.md:3-12,34-39",
      "src/adapters/electropaint/src/cssselectropaint/preparedPlayback.mjs:61-105,117-132,176-234",
    ]),
  }),
  Object.freeze({
    id: "gears",
    label: "Gears",
    cadence: Object.freeze({ tickIntervalUs: Object.freeze([30_000, 1]), catchUpPolicy: "single-step" }),
    techniques: Object.freeze(["prepared-playback", "prepared-variants", "responsive-profiles", "prepared-banks"]),
    expected: Object.freeze({ initial: { className: "leaf material-a", visibility: "hidden" }, sought: { className: "leaf material-b", visibility: "hidden" }, selected: { className: "leaf material-a", sourceFrame: 3 }, final: { visibility: "visible" } }),
    source: Object.freeze([
      "src/adapters/gears/src/cssgears/preparedPlayback.mjs:98-126,169-208,424-443",
      "src/adapters/gears/src/cssgears/stagePresentation.mjs:16-65",
      "src/adapters/gears/tools/prepare-polycss-snapshot.mjs:156-161",
    ]),
  }),
  Object.freeze({
    id: "gravitywell",
    label: "Gravity Well",
    cadence: Object.freeze({ tickIntervalUs: Object.freeze([30_000, 1]), catchUpPolicy: "single-step" }),
    techniques: Object.freeze(["paged-playback", "paged-variants", "responsive-profiles", "profile-frame-visibility", "prepared-banks"]),
    expected: Object.freeze({ initial: { className: "leaf material-a", color: "rgb(255, 0, 0)", visibility: "hidden" }, sought: { className: "leaf material-b", color: "rgb(0, 255, 0)", visibility: "visible" }, selected: { className: "leaf material-a", color: "rgb(255, 0, 0)", sourceFrame: 3 }, final: { color: "rgb(255, 0, 0)", visibility: "visible" } }),
    source: Object.freeze([
      "src/adapters/gravitywell/src/cssgravitywell/preparedPlayback.mjs:131-250,253-327,359-367,571-594",
      "src/adapters/gravitywell/src/cssgravitywell/preparedAssets.mjs:115-160,185-253,273-338,430-438",
    ]),
  }),
  Object.freeze({
    id: "maze",
    label: "Maze",
    cadence: Object.freeze({ tickIntervalUs: Object.freeze([20_000, 1]), catchUpPolicy: "single-step" }),
    techniques: Object.freeze(["prepared-playback", "compositor-timing", "prepared-banks"]),
    expected: Object.freeze({ initial: { transform: "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)" }, sought: { transform: "matrix3d(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 10, 0, 0, 1)" }, selected: { transform: "matrix3d(3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 3, 0, 10, 0, 0, 1)", sourceFrame: 3 }, final: { animationCount: 1 } }),
    source: Object.freeze([
      "src/adapters/maze/src/prepare/cssmaze/sceneBuilder.mjs:279-295",
      "src/adapters/maze/src/cssmaze/preparedPlayback.mjs:119-145",
      "src/adapters/maze/src/cssmaze/client.mjs:104-159",
    ]),
  }),
  Object.freeze({
    id: "menger",
    label: "Menger",
    cadence: Object.freeze({ tickIntervalUs: Object.freeze([30_000, 1]), catchUpPolicy: "elapsed" }),
    techniques: Object.freeze(["prepared-playback", "prepared-surface", "compositor-timing", "elapsed-catch-up"]),
    expected: Object.freeze({ initial: { address: "0px 0px" }, sought: { address: "-16px -16px", sourceFrame: 2 }, final: { animationCount: 1 } }),
    source: Object.freeze([
      "src/adapters/menger/README.md:5-18",
      "src/adapters/menger/src/cssmenger/preparedPlayback.mjs:188-231,250-318,347-350",
    ]),
  }),
  Object.freeze({
    id: "solitaire",
    label: "Solitaire",
    cadence: Object.freeze({ tickIntervalUs: Object.freeze([125_000, 3]), catchUpPolicy: "elapsed", deadlineMicros: true }),
    techniques: Object.freeze(["prepared-playback", "prepared-surface", "responsive-profiles", "profile-timelines", "responsive-affine", "prepared-banks", "elapsed-catch-up"]),
    expected: Object.freeze({ initial: { address: "0px", transform: "matrix(0, 2, -3, 0, 36, 59)" }, sought: { address: "-32px", sourceFrame: 2 }, selected: { address: "-64px", sourceFrame: 3 }, final: { transform: "matrix(0, 2, -3, 0, 84, 131)" } }),
    source: Object.freeze([
      "src/adapters/solitaire/src/prepare/csssolitaire/prepare.mjs:23-29,406-497",
      "src/adapters/solitaire/src/csssolitaire/preparedPlayback.mjs:71-138,190-208,249-325,472-505",
    ]),
  }),
]);

export const CSSGRAPHICS_OUT_OF_SCOPE_ADAPTERS = Object.freeze([
  Object.freeze({
    id: "super-mario-64",
    ownership: "custom-morph-prepared-package",
    reason: "The pinned repository exports a browser adapter, but its custom/Morph prepared-package and product path is outside this DOMFORMAT mechanism claim and has no top-level stable browser-demo contract.",
  }),
]);
