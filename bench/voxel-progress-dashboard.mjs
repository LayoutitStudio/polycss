#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const resultDir = process.argv[2] ?? join(repoRoot, "bench/results");
const outputPath = process.argv[3] ?? join(repoRoot, "bench/voxel-progress-dashboard.html");

const RESULT_FILE = /^(?:(a\d+)-)?(.+)-rotation-compare\.json$/i;
const BASELINE_ITERATION = "a31";
const PALETTE = [
  "#2563eb",
  "#dc2626",
  "#059669",
  "#7c3aed",
  "#ea580c",
  "#0891b2",
  "#be123c",
  "#4d7c0f",
  "#9333ea",
  "#0f766e",
  "#b45309",
  "#1d4ed8",
];

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmt(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "";
}

function maybeNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function median(values) {
  return quantile(values, 0.5);
}

function iterationRank(id) {
  const match = /^a(\d+)$/i.exec(id);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function iterationLabel(id) {
  if (id === BASELINE_ITERATION) return "Baseline";
  return id.toUpperCase();
}

function strategyLabel(id) {
  return id
    .replace(/^polycss-voxlocal-/, "")
    .replace(/^polycss-/, "")
    .replace(/^direct-matrix-screen-/, "screen:")
    .replace(/^direct-matrix-source-/, "source:")
    .replace(/^direct-matrix-/, "")
    .replaceAll("screen-tile", "screen:tile")
    .replaceAll("source-block", "source:block");
}

function fileIteration(prefix) {
  return prefix ? prefix.toLowerCase() : BASELINE_ITERATION;
}

function cellColor(value, domain) {
  if (!Number.isFinite(value)) {
    return "background: #f3f4f6; color: #9ca3af;";
  }
  const [min, max] = domain;
  const t = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0.5;
  const hue = 8 + t * 132;
  const light = 94 - t * 12;
  return `background: hsl(${hue.toFixed(1)} 68% ${light.toFixed(1)}%); color: #111827;`;
}

function deltaClass(delta) {
  if (!Number.isFinite(delta)) return "";
  if (delta > 0.25) return "good";
  if (delta < -0.25) return "bad";
  return "flat";
}

function summarizeCase(id, entry) {
  const aggregate = entry.aggregate ?? {};
  const runs = Array.isArray(entry.runs) ? entry.runs : [];
  return {
    id,
    label: strategyLabel(id),
    p50: maybeNumber(aggregate.fps_p50_median),
    p95: maybeNumber(aggregate.fps_p95_median),
    p99FrameMs: maybeNumber(aggregate.frame_time_p99_ms_median),
    nodes: maybeNumber(aggregate.nodes_median),
    leaves: median(runs.map((run) => run.dom?.leaves ?? run.domSamples?.at?.(0)?.leaves)),
    runs: runs.length,
  };
}

function summarizeResult(data, file, mtime) {
  const cases = Object.entries(data.cases ?? {})
    .map(([id, entry]) => summarizeCase(id, entry))
    .filter((entry) => Number.isFinite(entry.p95));

  cases.sort((a, b) => {
    const delta = b.p95 - a.p95;
    return delta !== 0 ? delta : a.label.localeCompare(b.label);
  });

  return {
    file,
    mtime,
    model: data.model ?? file.replace(/-rotation-compare\.json$/i, ""),
    viewport: data.viewport ?? null,
    caseCount: cases.length,
    best: cases[0] ?? null,
    cases,
  };
}

async function discoverResults() {
  if (!existsSync(resultDir)) {
    throw new Error(`Result directory not found: ${resultDir}`);
  }

  const candidates = [];
  for (const file of await readdir(resultDir)) {
    const match = RESULT_FILE.exec(file);
    if (!match) continue;
    candidates.push({
      prefix: match[1]?.toLowerCase() ?? null,
      slug: match[2],
      file,
      path: join(resultDir, file),
      mtime: (await stat(join(resultDir, file))).mtimeMs,
    });
  }

  const iteratedSlugs = new Set(candidates.filter((entry) => entry.prefix).map((entry) => entry.slug));
  const selected = new Map();
  for (const entry of candidates) {
    if (!entry.prefix && !iteratedSlugs.has(entry.slug)) continue;
    const iteration = fileIteration(entry.prefix);
    const key = `${entry.slug}:${iteration}`;
    const current = selected.get(key);
    if (!current || entry.mtime > current.mtime) selected.set(key, { ...entry, iteration });
  }

  const models = new Map();
  const iterations = new Map();
  for (const entry of selected.values()) {
    const data = JSON.parse(await readFile(entry.path, "utf8"));
    const summary = summarizeResult(data, entry.file, entry.mtime);
    if (!summary.best) continue;

    iterations.set(entry.iteration, {
      id: entry.iteration,
      label: iterationLabel(entry.iteration),
      rank: iterationRank(entry.iteration),
    });

    const model = models.get(entry.slug) ?? {
      slug: entry.slug,
      name: String(summary.model),
      results: new Map(),
    };
    model.name = String(summary.model);
    model.results.set(entry.iteration, summary);
    models.set(entry.slug, model);
  }

  const sortedIterations = [...iterations.values()].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const sortedModels = [...models.values()]
    .filter((model) => sortedIterations.some((iteration) => model.results.has(iteration.id)))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { iterations: sortedIterations, models: sortedModels };
}

function valueDomain(models, iterations, pickValue) {
  const values = [];
  for (const model of models) {
    for (const iteration of iterations) {
      const value = pickValue(model, iteration);
      if (Number.isFinite(value)) values.push(value);
    }
  }
  if (values.length === 0) return [0, 1];
  const min = Math.floor(Math.min(...values) / 5) * 5;
  const max = Math.ceil(Math.max(...values) / 5) * 5;
  return min === max ? [min - 1, max + 1] : [min, max];
}

function renderLineChart(models, iterations) {
  const width = 1080;
  const height = 360;
  const pad = { top: 26, right: 28, bottom: 70, left: 54 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const domain = valueDomain(models, iterations, (model, iteration) => model.results.get(iteration.id)?.best?.p95);
  const [minY, maxY] = domain;
  const xFor = (index) => pad.left + (iterations.length <= 1 ? plotWidth / 2 : (index / (iterations.length - 1)) * plotWidth);
  const yFor = (value) => pad.top + ((maxY - value) / (maxY - minY)) * plotHeight;
  const lines = [];

  for (let i = 0; i <= 4; i += 1) {
    const value = minY + ((maxY - minY) * i) / 4;
    const y = yFor(value);
    lines.push(`<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="grid"/>`);
    lines.push(`<text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" class="axis">${fmt(value, 0)}</text>`);
  }

  iterations.forEach((iteration, index) => {
    const x = xFor(index);
    lines.push(`<line x1="${x}" y1="${pad.top}" x2="${x}" y2="${height - pad.bottom}" class="grid vertical"/>`);
    lines.push(`<text x="${x}" y="${height - 32}" text-anchor="middle" class="axis strong">${esc(iteration.label)}</text>`);
  });

  const averages = iterations.map((iteration) => {
    const values = models
      .map((model) => model.results.get(iteration.id)?.best?.p95)
      .filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  });
  const avgPoints = averages
    .map((value, index) => (Number.isFinite(value) ? `${xFor(index)},${yFor(value)}` : null))
    .filter(Boolean)
    .join(" ");
  if (avgPoints) lines.push(`<polyline points="${avgPoints}" class="avg-line"/>`);

  models.forEach((model, modelIndex) => {
    const color = PALETTE[modelIndex % PALETTE.length];
    const points = iterations
      .map((iteration, index) => {
        const value = model.results.get(iteration.id)?.best?.p95;
        return Number.isFinite(value) ? `${xFor(index)},${yFor(value)}` : null;
      })
      .filter(Boolean)
      .join(" ");
    if (points.includes(" ")) {
      lines.push(`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.55" opacity="0.72"/>`);
    }

    iterations.forEach((iteration, index) => {
      const value = model.results.get(iteration.id)?.best?.p95;
      if (!Number.isFinite(value)) return;
      lines.push(
        `<circle cx="${xFor(index)}" cy="${yFor(value)}" r="3.6" fill="${color}" opacity="0.95"><title>${esc(
          `${model.name} ${iteration.label}: ${fmt(value)} p95`,
        )}</title></circle>`,
      );
    });
  });

  const legend = models
    .map((model, index) => {
      const color = PALETTE[index % PALETTE.length];
      return `<span class="legend-item"><span class="swatch" style="background:${color}"></span>${esc(model.name)}</span>`;
    })
    .join("");

  return `
    <div class="chart-shell">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Best p95 FPS by iteration">
        <text x="${pad.left}" y="18" class="chart-title">best p95 FPS by benchmark iteration</text>
        ${lines.join("\n")}
        <text x="${width - pad.right}" y="18" text-anchor="end" class="axis">thick line = corpus average</text>
      </svg>
      <div class="legend">${legend}</div>
    </div>
  `;
}

function renderProgressHeatmap(models, iterations) {
  const domain = valueDomain(models, iterations, (model, iteration) => model.results.get(iteration.id)?.best?.p95);
  const header = iterations.map((iteration) => `<th>${esc(iteration.label)}</th>`).join("");
  const rows = models
    .map((model) => {
      const cells = iterations
        .map((iteration) => {
          const best = model.results.get(iteration.id)?.best;
          const title = best ? `${best.label}, ${best.runs} runs` : "missing";
          return `<td class="num" style="${cellColor(best?.p95, domain)}" title="${esc(title)}">${fmt(best?.p95)}</td>`;
        })
        .join("");
      const first = model.results.get(iterations[0]?.id)?.best?.p95;
      const latest = model.results.get(iterations.at(-1)?.id)?.best?.p95;
      const delta = Number.isFinite(first) && Number.isFinite(latest) ? latest - first : null;
      return `<tr><th>${esc(model.name)}</th>${cells}<td class="num ${deltaClass(delta)}">${Number.isFinite(delta) ? `${delta >= 0 ? "+" : ""}${fmt(delta)}` : ""}</td></tr>`;
    })
    .join("");

  return `
    <table>
      <thead><tr><th>Model</th>${header}<th>Delta</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function latestStrategies(models, latestIteration) {
  const byLabel = new Map();
  for (const model of models) {
    for (const resultCase of model.results.get(latestIteration.id)?.cases ?? []) {
      byLabel.set(resultCase.label, resultCase);
    }
  }
  return [...byLabel.keys()].sort((a, b) => a.localeCompare(b));
}

function renderStrategyHeatmap(models, latestIteration) {
  if (!latestIteration) return "";
  const strategies = latestStrategies(models, latestIteration);
  if (strategies.length === 0) return "";

  const values = [];
  for (const model of models) {
    for (const resultCase of model.results.get(latestIteration.id)?.cases ?? []) {
      if (Number.isFinite(resultCase.p95)) values.push(resultCase.p95);
    }
  }
  const domain = values.length
    ? [Math.floor(Math.min(...values) / 5) * 5, Math.ceil(Math.max(...values) / 5) * 5]
    : [0, 1];
  const header = strategies.map((label) => `<th class="strategy-head">${esc(label)}</th>`).join("");
  const rows = models
    .map((model) => {
      const byStrategy = new Map((model.results.get(latestIteration.id)?.cases ?? []).map((entry) => [entry.label, entry]));
      const cells = strategies
        .map((strategy) => {
          const entry = byStrategy.get(strategy);
          const title = entry ? `${entry.id}, ${entry.runs} runs` : "missing";
          return `<td class="num" style="${cellColor(entry?.p95, domain)}" title="${esc(title)}">${fmt(entry?.p95)}</td>`;
        })
        .join("");
      return `<tr><th>${esc(model.name)}</th>${cells}</tr>`;
    })
    .join("");

  return `
    <div class="scroll-x">
      <table class="strategy-table">
        <thead><tr><th>Model</th>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderModelTable(models, iterations, latestIteration) {
  const previousIteration = iterations.at(-2) ?? null;
  const baselineIteration = iterations[0] ?? null;
  const rows = models
    .map((model) => {
      const baseline = baselineIteration ? model.results.get(baselineIteration.id)?.best : null;
      const previous = previousIteration ? model.results.get(previousIteration.id)?.best : null;
      const latest = latestIteration ? model.results.get(latestIteration.id)?.best : null;
      const deltaBaseline =
        Number.isFinite(baseline?.p95) && Number.isFinite(latest?.p95) ? latest.p95 - baseline.p95 : null;
      const deltaPrevious =
        Number.isFinite(previous?.p95) && Number.isFinite(latest?.p95) ? latest.p95 - previous.p95 : null;
      return `
        <tr>
          <th>${esc(model.name)}</th>
          <td class="num">${fmt(baseline?.p95)}</td>
          <td class="num">${fmt(previous?.p95)}</td>
          <td class="num">${fmt(latest?.p95)}</td>
          <td class="num ${deltaClass(deltaBaseline)}">${Number.isFinite(deltaBaseline) ? `${deltaBaseline >= 0 ? "+" : ""}${fmt(deltaBaseline)}` : ""}</td>
          <td class="num ${deltaClass(deltaPrevious)}">${Number.isFinite(deltaPrevious) ? `${deltaPrevious >= 0 ? "+" : ""}${fmt(deltaPrevious)}` : ""}</td>
          <td>${esc(latest?.label ?? "")}</td>
          <td class="num">${fmt(latest?.nodes, 0)}</td>
          <td class="num">${fmt(latest?.leaves, 0)}</td>
          <td class="num">${latest?.caseCount ?? model.results.get(latestIteration?.id)?.caseCount ?? ""}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th>Model</th>
          <th>${esc(baselineIteration?.label ?? "Base")}</th>
          <th>${esc(previousIteration?.label ?? "Prev")}</th>
          <th>${esc(latestIteration?.label ?? "Latest")}</th>
          <th>Delta base</th>
          <th>Delta prev</th>
          <th>Latest best case</th>
          <th>Nodes</th>
          <th>Leaves</th>
          <th>Cases</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function averageLatest(models, latestIteration) {
  const values = models
    .map((model) => model.results.get(latestIteration?.id)?.best?.p95)
    .filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function improvedCount(models, baselineIteration, latestIteration) {
  let improved = 0;
  let comparable = 0;
  for (const model of models) {
    const baseline = model.results.get(baselineIteration?.id)?.best?.p95;
    const latest = model.results.get(latestIteration?.id)?.best?.p95;
    if (!Number.isFinite(baseline) || !Number.isFinite(latest)) continue;
    comparable += 1;
    if (latest > baseline + 0.25) improved += 1;
  }
  return { improved, comparable };
}

function renderDashboard(data) {
  const { models, iterations } = data;
  const latestIteration = iterations.at(-1) ?? null;
  const baselineIteration = iterations[0] ?? null;
  const previousIteration = iterations.at(-2) ?? null;
  const latestAverage = averageLatest(models, latestIteration);
  const previousAverage = averageLatest(models, previousIteration);
  const averageDelta =
    Number.isFinite(latestAverage) && Number.isFinite(previousAverage) ? latestAverage - previousAverage : null;
  const improved = improvedCount(models, baselineIteration, latestIteration);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Voxel Renderer Progress</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f8fafc;
      --ink: #111827;
      --muted: #64748b;
      --line: #d8dee9;
      --panel: #ffffff;
      --good: #047857;
      --bad: #b91c1c;
      --flat: #6b7280;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.45;
    }
    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 24px auto 56px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      align-items: end;
      margin-bottom: 18px;
    }
    h1, h2 {
      margin: 0;
      letter-spacing: 0;
    }
    h1 {
      font-size: 24px;
      line-height: 1.1;
    }
    h2 {
      font-size: 15px;
      margin-bottom: 10px;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
      text-align: right;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }
    .metric, section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .metric {
      padding: 12px 14px;
    }
    .metric b {
      display: block;
      font-size: 24px;
      line-height: 1.1;
      margin-bottom: 4px;
    }
    .metric span {
      color: var(--muted);
      font-size: 12px;
    }
    section {
      padding: 14px;
      margin-top: 12px;
      overflow: hidden;
    }
    .chart-shell {
      overflow: hidden;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
    }
    .grid {
      stroke: #e5e7eb;
      stroke-width: 1;
    }
    .grid.vertical {
      stroke-dasharray: 3 4;
    }
    .axis {
      fill: #64748b;
      font-size: 12px;
    }
    .axis.strong {
      fill: #111827;
      font-weight: 650;
    }
    .chart-title {
      fill: #111827;
      font-size: 13px;
      font-weight: 700;
    }
    .avg-line {
      fill: none;
      stroke: #111827;
      stroke-width: 3.25;
      opacity: 0.86;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin-top: -12px;
      padding: 0 6px 4px;
      color: var(--muted);
      font-size: 12px;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }
    .swatch {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
    }
    .scroll-x {
      overflow-x: auto;
      padding-bottom: 2px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      border-bottom: 1px solid #e5e7eb;
      padding: 7px 8px;
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
    }
    thead th {
      color: #334155;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #f8fafc;
      border-bottom-color: #cbd5e1;
    }
    tbody th {
      font-weight: 650;
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .good { color: var(--good); font-weight: 700; }
    .bad { color: var(--bad); font-weight: 700; }
    .flat { color: var(--flat); font-weight: 650; }
    .strategy-table {
      min-width: 940px;
    }
    .strategy-head {
      max-width: 148px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @media (max-width: 760px) {
      main { width: min(100vw - 20px, 1180px); margin-top: 14px; }
      header { display: block; }
      .meta { text-align: left; margin-top: 6px; }
      .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Voxel renderer progress</h1>
      </div>
      <div class="meta">
        generated ${esc(data.generatedAt)}<br>
        source ${esc(resultDir)}
      </div>
    </header>

    <div class="summary">
      <div class="metric"><b>${esc(models.length)}</b><span>models with iterated results</span></div>
      <div class="metric"><b>${esc(iterations.map((iteration) => iteration.label).join(" / "))}</b><span>iterations</span></div>
      <div class="metric"><b>${fmt(latestAverage)}</b><span>${esc(latestIteration?.label ?? "latest")} average best p95${Number.isFinite(averageDelta) ? ` (${averageDelta >= 0 ? "+" : ""}${fmt(averageDelta)} vs ${esc(previousIteration?.label ?? "previous")})` : ""}</span></div>
      <div class="metric"><b>${esc(`${improved.improved}/${improved.comparable}`)}</b><span>models above ${esc(baselineIteration?.label ?? "baseline")}</span></div>
    </div>

    <section>
      <h2>Progress</h2>
      ${renderLineChart(models, iterations)}
    </section>

    <section>
      <h2>Best p95 heatmap</h2>
      ${renderProgressHeatmap(models, iterations)}
    </section>

    <section>
      <h2>${esc(latestIteration?.label ?? "Latest")} strategy heatmap</h2>
      ${renderStrategyHeatmap(models, latestIteration)}
    </section>

    <section>
      <h2>Model table</h2>
      ${renderModelTable(models, iterations, latestIteration)}
    </section>
  </main>
</body>
</html>
`;
}

const data = await discoverResults();
const html = renderDashboard({
  ...data,
  generatedAt: new Date().toISOString(),
});

await writeFile(outputPath, html, "utf8");
console.log(`wrote ${outputPath}`);
