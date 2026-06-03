import { cullInteriorPolygons } from "../cull/cullInteriorPolygons";
import { findOverlappingPolygonDuplicates } from "./dedupeOverlappingPolygons";
import type { MeshResolution, Polygon, TextureTriangle, Vec2, Vec3 } from "../types";
import { coverPlanarPolygons, type CoverPlanarPolygonsOptions } from "./coverPlanarPolygons";
import { mergePolygons } from "./mergePolygons";
import { seamOverlapSafetyDiagnostics, type SeamOverlapDiagnostics } from "./seamRepair";
import {
  simplifyTriangleMeshPolygons,
  type SimplifyTriangleMeshPolygonsOptions,
} from "./simplifyTriangleMesh";

const NORMALIZE_MAX_ANGLE_DEG = 3;
const NORMALIZE_MAX_PLANE_DISPLACEMENT = 0.03;
const NORMALIZE_MAX_BOUNDARY_DISPLACEMENT = 0.02;

interface LossyApproximateOptions {
  maxAngleDeg?: number;
  maxPlaneDisplacement?: number;
  maxBoundaryDisplacement?: number;
  isolatedPairs?: boolean;
}

export interface OptimizeMeshPolygonsOptions {
  /** Public quality/resolution intent. Defaults to "lossy". */
  meshResolution?: MeshResolution;
  /**
   * Return as soon as the optimizer finds a result with at most this many
   * polygons. Useful for candidate comparisons where the caller already knows
   * the maximum DOM leaf count it can accept.
   */
  stopAtPolygonCount?: number;
  /**
   * Run the planar cover pass as an exact candidate for untextured coplanar
   * regions. Defaults to true.
   */
  rectCover?: boolean | CoverPlanarPolygonsOptions;
}

interface ResolvedGeometryNormalizeOptions {
  maxAngleDeg: number;
  maxPlaneDisplacement: number;
  maxBoundaryDisplacement: number;
  isolatedPairs: boolean;
}

interface PlaneNormalizeMeta {
  polygon: Polygon;
  normal: Vec3;
  area: number;
  materialKey: string;
}

interface PlaneFit {
  normal: Vec3;
  point: Vec3;
  boundaryVertexKeys?: Set<string>;
}

interface PairCandidate {
  a: number;
  b: number;
  polygon: Polygon;
  vertexMoves: VertexPositionMove[];
  score: number;
}

interface VertexPositionMove {
  key: string;
  target: Vec3;
}

interface PairCandidateRank {
  degree: number;
  score: number;
  index: number;
}

interface PlanePatchCandidate {
  indices: number[];
  source: Polygon[];
  projected: Polygon[];
  vertexMoves: VertexPositionMove[];
  score: number;
}

interface PlaneGroupReplacements {
  polygons: Map<number, Polygon>;
  vertexMoves: VertexPositionMove[];
}

interface TrianglePairSourceCache {
  polygons: Polygon[];
  metas: Array<PlaneNormalizeMeta | null>;
  edgeOwnerPairs: Array<[number, number]>;
  preparedCandidates?: PreparedPairCandidate[];
}

interface PreparedPairCandidate {
  candidate: PairCandidate;
  normalDot: number;
  maxDistance: number;
}

interface TopologySegment {
  index: number;
  key: string;
  polygon: number;
  edge: number;
  a: Vec3;
  b: Vec3;
  dir: Vec3;
  length: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

interface TopologyEdgeStats {
  boundaryKeys: Set<string>;
  internalKeys: Set<string>;
  boundarySegments: TopologySegment[];
  internalSegments: TopologySegment[];
  boundaryLength: number;
  internalIndex?: TopologySegmentIndex;
  internalIndexTolerance?: number;
}

interface TopologySegmentIndex {
  cellSize: number;
  cells: Map<string, TopologySegment[]>;
}

interface TopologyGapDiagnostics {
  tJunctionPairs: number;
  tJunctionLength: number;
}

interface SegmentOverlapInfo {
  overlapLength: number;
  offset: number;
}

interface BestSafetyDiagnostics {
  polygons: Polygon[];
  seam?: SeamOverlapDiagnostics;
  topologyEdges?: TopologyEdgeStats;
  topologySelf?: TopologyGapDiagnostics;
}

interface PreprocessCache {
  skipInteriorCull?: boolean;
  reuseSnappedInteriorCull?: boolean;
  baseline?: Polygon[];
  deduped?: Polygon[];
  dedupedIndices?: IndexFilter;
  interior?: Polygon[];
  interiorIndices?: IndexFilter;
  snapped?: Polygon[];
  snappedInterior?: Polygon[];
  snappedInteriorIndices?: IndexFilter;
  snappedInteriorUsesBaselineFilter?: boolean;
  snappedInteriorExact?: Polygon[];
  snappedInteriorExactIndices?: IndexFilter;
  trianglePairSource?: TrianglePairSourceCache;
}

interface OptimizeMeshPolygonsRunOptions {
  requiredMaxPolygonCount?: number;
  skipInteriorCull?: boolean;
  skipExactRectCover?: boolean;
  simplifiedCandidate?: boolean;
  captureVisiblePolygons?: boolean;
}

interface OptimizeMeshPolygonsRunResult {
  polygons: Polygon[];
  visiblePolygons?: Polygon[];
}

type MeshOptimizationStep =
  | { kind: "baselineCandidates" }
  | { kind: "initialLossyCandidates" }
  | { kind: "finalLossyCandidates" }
  | {
    kind: "staticSimplificationCandidates";
    options: OptimizeStaticSimplificationOptions;
    stopOnAccept: boolean;
  };

interface MeshOptimizationPlan {
  steps: readonly MeshOptimizationStep[];
}

type MeshCandidateAcceptanceMode = "cost" | "dom" | "seamSafe";

interface MeshCandidateSubmission {
  mode: MeshCandidateAcceptanceMode;
  polygons: Polygon[];
  cost?: number;
  sourcePolygonCount?: number;
  maxPolygonCount?: number;
}

interface MeshCandidateEngineConfig {
  acceptor?: MeshCandidateAcceptor;
  costCandidateMode?: Extract<MeshCandidateAcceptanceMode, "cost" | "dom">;
  seamCandidateMode?: Extract<MeshCandidateAcceptanceMode, "dom" | "seamSafe">;
  offerBaseline?: boolean;
}

export interface OptimizeStaticSimplificationOptions {
  simplifyTriangleMeshOptions?: SimplifyTriangleMeshPolygonsOptions;
  earlyStopDropRatio?: number;
}

export interface OptimizeParseMeshPolygonsOptions extends OptimizeMeshPolygonsOptions {
  staticSimplification?: OptimizeStaticSimplificationOptions | false;
  useCandidateFirst?: boolean;
  skipInteriorCull?: boolean;
}

interface StaticSimplificationPlan {
  source: Polygon[];
  vertexKeyMode?: "relaxed" | "source";
  precomputed?: Polygon[] | null;
  skipInteriorCull?: boolean;
}

type IndexFilter = number[] | null;

const DEFAULT_NORMALIZE_OPTIONS: ResolvedGeometryNormalizeOptions = {
  maxAngleDeg: NORMALIZE_MAX_ANGLE_DEG,
  maxPlaneDisplacement: NORMALIZE_MAX_PLANE_DISPLACEMENT,
  maxBoundaryDisplacement: NORMALIZE_MAX_BOUNDARY_DISPLACEMENT,
  isolatedPairs: false,
};

const DEFAULT_LOSSY_APPROXIMATE_OPTIONS: Required<LossyApproximateOptions> = {
  maxAngleDeg: 15,
  maxPlaneDisplacement: 0.35,
  maxBoundaryDisplacement: 0.04,
  isolatedPairs: true,
};

const AGGRESSIVE_LOSSY_APPROXIMATE_VARIANTS: ReadonlyArray<Required<LossyApproximateOptions>> = [
  {
    ...DEFAULT_LOSSY_APPROXIMATE_OPTIONS,
    maxAngleDeg: 30,
  },
  {
    ...DEFAULT_LOSSY_APPROXIMATE_OPTIONS,
    maxAngleDeg: 45,
  },
  {
    ...DEFAULT_LOSSY_APPROXIMATE_OPTIONS,
    maxAngleDeg: 60,
    maxBoundaryDisplacement: 0.06,
  },
];

const AUTOMATIC_RECT_COVER_MAX_POLYGONS = 1800;
const AUTOMATIC_RECT_COVER_MIN_TRIANGLE_RATIO = 0.65;
const AUTOMATIC_APPROXIMATE_RECT_COVER_MIN_SOURCE_POLYGONS = 500;
const AUTOMATIC_APPROXIMATE_RECT_COVER_MAX_SOURCE_POLYGONS = 2200;
const LARGE_LOSSY_RECT_COVER_MIN_POLYGONS = 1000;
const LARGE_LOSSY_RECT_COVER_MAX_POLYGONS = 2200;
const LARGE_LOSSY_RECT_COVER_MAX_BOUNDARY_EDGES = 350;
const WIDE_LOSSY_VARIANT_MAX_SOURCE_POLYGONS = 700;
const PREPARED_PAIR_MAX_ANGLE_DEG = 60;
const PREPARED_PAIR_MAX_BOUNDARY_DISPLACEMENT = 0.06;
const AGGRESSIVE_LOSSY_MIN_RENDER_COST_GAIN = 4;
const AGGRESSIVE_LOSSY_MIN_SOURCE_GAIN_RATIO = 0.003;
const LARGE_BASELINE_AGGRESSIVE_SKIP_MIN_POLYGONS = 4000;
const LARGE_BASELINE_AGGRESSIVE_SKIP_MAX_BEST_POLYGONS = 3000;
const SIMPLIFIED_CANDIDATE_AGGRESSIVE_MAX_POLYGONS = 4500;
const SIMPLIFIED_CANDIDATE_CHAINED_AGGRESSIVE_MIN_POLYGONS = 2400;
const SIMPLIFIED_CANDIDATE_REUSE_CULL_MAX_POLYGONS = 4200;
const REUSED_SNAPPED_CULL_ALWAYS_MAX_BASELINE_POLYGONS = 1800;
const REUSED_SNAPPED_CULL_EXTENDED_MAX_BASELINE_POLYGONS = 5000;
const REUSED_SNAPPED_CULL_EXTENDED_MIN_BASELINE_SOURCE_RATIO = 0.28;
const DEFAULT_STATIC_SIMPLIFY_EARLY_STOP_DROP_RATIO = 0.15;
const MIN_STATIC_SIMPLIFY_BASELINE_SOURCE_RATIO = 0.23;
const SOURCE_FIRST_MIN_BASELINE_POLYGONS = 2000;
const SOURCE_FIRST_MAX_RELAXED_RAW_DROP = 16;
const VISIBLE_FIRST_MIN_SOURCE_POLYGONS = 4000;
const VISIBLE_FIRST_MIN_CULLED_POLYGONS = 900;
const VISIBLE_FIRST_MAX_RELAXED_RAW_DROP = 16;
const VISIBLE_FIRST_MIN_CULL_TO_RELAXED_DROP_RATIO = 1.5;
const TOPOLOGY_GAP_TOLERANCE = 0.045;
const TOPOLOGY_MIN_PARALLEL_DOT = 0.999;
const TOPOLOGY_MIN_OVERLAP = 1e-5;
const DEFAULT_RECT_COVER_SMALL_AUTOMATIC_SKIP_MIN_POLYGONS = 24;
const DEFAULT_RECT_COVER_SMALL_AUTOMATIC_SKIP_MAX_POLYGONS = 50;
const DEFAULT_RECT_COVER_MAX_AUTOMATIC_POLYGONS = 1000;
const DEFAULT_RECT_COVER_MAX_BOUNDARY_EDGES = 1000;

const DEFAULT_RECT_COVER_OPTIONS: CoverPlanarPolygonsOptions = {
  minGroupPolygons: 2,
  maxCandidateAxes: 24,
};

const AUTOMATIC_LOSSY_RECT_COVER_OPTIONS: CoverPlanarPolygonsOptions = {
  ...DEFAULT_RECT_COVER_OPTIONS,
  maxCandidateAxes: 1,
};

const AUTOMATIC_APPROXIMATE_RECT_COVER_OPTIONS: CoverPlanarPolygonsOptions = {
  ...DEFAULT_RECT_COVER_OPTIONS,
  maxCandidateAxes: 2,
};

const LARGE_LOSSY_RECT_COVER_OPTIONS: CoverPlanarPolygonsOptions = {
  ...DEFAULT_RECT_COVER_OPTIONS,
  maxCandidateAxes: 2,
};

const FULL_OPTIMIZATION_PLAN: MeshOptimizationPlan = {
  steps: [
    { kind: "baselineCandidates" },
    { kind: "initialLossyCandidates" },
    { kind: "finalLossyCandidates" },
  ],
};

export function optimizeMeshPolygons(
  polygons: Polygon[],
  options: OptimizeMeshPolygonsOptions = {},
): Polygon[] {
  return optimizeMeshPolygonsInternal(polygons, options).polygons;
}

export function optimizeParseMeshPolygons(
  polygons: Polygon[],
  options: OptimizeParseMeshPolygonsOptions = {},
): Polygon[] {
  const optimizeOptions: OptimizeMeshPolygonsOptions = {
    meshResolution: options.meshResolution,
    stopAtPolygonCount: options.stopAtPolygonCount,
    rectCover: options.rectCover,
  };
  const graph = new MeshOptimizationArtifactGraph();
  const runOptions: OptimizeMeshPolygonsRunOptions = {
    captureVisiblePolygons: true,
    skipInteriorCull: options.skipInteriorCull === true,
  };
  return graph.workspaceFor(polygons, runOptions)
    .createRun(optimizeOptions, runOptions)
    .optimizeParse({
      staticSimplification: options.staticSimplification,
      useCandidateFirst: options.useCandidateFirst === true,
    })
    .polygons;
}

function optimizeMeshPolygonsInternal(
  polygons: Polygon[],
  options: OptimizeMeshPolygonsOptions = {},
  runOptions: OptimizeMeshPolygonsRunOptions = {},
): OptimizeMeshPolygonsRunResult {
  const graph = new MeshOptimizationArtifactGraph();
  return graph.workspaceFor(polygons, runOptions)
    .createRun(options, runOptions)
    .optimize();
}

class MeshOptimizationArtifactGraph {
  private readonly workspaces = new Map<string, WeakMap<Polygon[], MeshOptimizationWorkspace>>();

  workspaceFor(source: Polygon[], runOptions: OptimizeMeshPolygonsRunOptions): MeshOptimizationWorkspace {
    const key = workspaceCacheKey(runOptions);
    let workspacesBySource = this.workspaces.get(key);
    if (!workspacesBySource) {
      workspacesBySource = new WeakMap();
      this.workspaces.set(key, workspacesBySource);
    }
    let workspace = workspacesBySource.get(source);
    if (!workspace) {
      workspace = new MeshOptimizationWorkspace(source, runOptions, this);
      workspacesBySource.set(source, workspace);
    }
    return workspace;
  }
}

function workspaceCacheKey(runOptions: OptimizeMeshPolygonsRunOptions): string {
  return [
    runOptions.skipInteriorCull === true ? "skip-cull" : "cull",
    runOptions.simplifiedCandidate === true ? "simplified" : "source",
  ].join(":");
}

class MeshOptimizationWorkspace {
  private readonly source: Polygon[];
  private readonly preprocessCache: PreprocessCache;
  private readonly graph: MeshOptimizationArtifactGraph;

  constructor(
    source: Polygon[],
    runOptions: OptimizeMeshPolygonsRunOptions,
    graph: MeshOptimizationArtifactGraph,
  ) {
    this.source = source;
    this.graph = graph;
    this.preprocessCache = {
      skipInteriorCull: runOptions.skipInteriorCull === true,
    };
  }

  polygons(): Polygon[] {
    return this.source;
  }

  preprocess(normalizeGeometry: boolean | LossyApproximateOptions): Polygon[] {
    return preprocessModelPolygons(this.source, normalizeGeometry, this.preprocessCache);
  }

  configureSnappedCullReuse(baseline: Polygon[], runOptions: OptimizeMeshPolygonsRunOptions): void {
    const baselineSourceRatio = baseline.length / Math.max(1, this.source.length);
    this.preprocessCache.reuseSnappedInteriorCull = runOptions.simplifiedCandidate === true
      ? this.source.length <= SIMPLIFIED_CANDIDATE_REUSE_CULL_MAX_POLYGONS
      : baseline.length <= REUSED_SNAPPED_CULL_ALWAYS_MAX_BASELINE_POLYGONS ||
        (
          baseline.length <= REUSED_SNAPPED_CULL_EXTENDED_MAX_BASELINE_POLYGONS &&
          baselineSourceRatio >= REUSED_SNAPPED_CULL_EXTENDED_MIN_BASELINE_SOURCE_RATIO
        );
  }

  visiblePolygons(): Polygon[] {
    return this.preprocessCache.interior ?? this.preprocessCache.deduped ?? this.source;
  }

  createRun(
    options: OptimizeMeshPolygonsOptions,
    runOptions: OptimizeMeshPolygonsRunOptions,
  ): MeshCandidateEngine {
    return new MeshCandidateEngine(this, options, runOptions);
  }

  workspaceFor(source: Polygon[], runOptions: OptimizeMeshPolygonsRunOptions): MeshOptimizationWorkspace {
    return this.graph.workspaceFor(source, runOptions);
  }
}

class MeshCandidateEngine {
  private readonly workspace: MeshOptimizationWorkspace;
  private readonly source: Polygon[];
  private readonly options: OptimizeMeshPolygonsOptions;
  private readonly runOptions: OptimizeMeshPolygonsRunOptions;
  private readonly meshResolution: MeshResolution;
  private readonly stopAtPolygonCount?: number;
  private readonly requiredMaxPolygonCount?: number;
  private readonly baseline: Polygon[];
  private readonly visiblePolygons?: Polygon[];
  private readonly acceptor: MeshCandidateAcceptor;
  private readonly costCandidateMode: Extract<MeshCandidateAcceptanceMode, "cost" | "dom">;
  private readonly seamCandidateMode: Extract<MeshCandidateAcceptanceMode, "dom" | "seamSafe">;
  private readonly offerBaseline: boolean;
  private baselineCandidatesComplete = false;
  private initialLossyCandidatesComplete = false;
  private finalLossyCandidatesComplete = false;

  constructor(
    workspace: MeshOptimizationWorkspace,
    options: OptimizeMeshPolygonsOptions,
    runOptions: OptimizeMeshPolygonsRunOptions,
    config: MeshCandidateEngineConfig = {},
  ) {
    this.workspace = workspace;
    this.source = workspace.polygons();
    this.options = options;
    this.runOptions = runOptions;
    this.costCandidateMode = config.costCandidateMode ?? "cost";
    this.seamCandidateMode = config.seamCandidateMode ?? "seamSafe";
    this.offerBaseline = config.offerBaseline === true;
    this.meshResolution = options.meshResolution ?? "lossy";
    this.stopAtPolygonCount = Number.isFinite(options.stopAtPolygonCount)
      ? Math.max(0, Math.floor(options.stopAtPolygonCount!))
      : undefined;
    this.requiredMaxPolygonCount = Number.isFinite(runOptions.requiredMaxPolygonCount)
      ? Math.max(0, Math.floor(runOptions.requiredMaxPolygonCount!))
      : undefined;
    this.baseline = this.preprocess(false);
    this.workspace.configureSnappedCullReuse(this.baseline, runOptions);
    this.visiblePolygons = runOptions.captureVisiblePolygons
      ? this.workspace.visiblePolygons()
      : undefined;
    this.acceptor = config.acceptor ?? new MeshCandidateAcceptor(this.baseline, this.requiredMaxPolygonCount);
  }

  optimize(): OptimizeMeshPolygonsRunResult {
    return this.runPlan(FULL_OPTIMIZATION_PLAN);
  }

  optimizeParse(options: {
    staticSimplification?: OptimizeStaticSimplificationOptions | false;
    useCandidateFirst: boolean;
  }): OptimizeMeshPolygonsRunResult {
    const staticSimplification = options.staticSimplification === false
      ? null
      : options.staticSimplification ?? {};
    const steps: MeshOptimizationStep[] = [
      { kind: "baselineCandidates" },
      { kind: "initialLossyCandidates" },
    ];
    if (!options.useCandidateFirst) steps.push({ kind: "finalLossyCandidates" });
    if (staticSimplification) {
      steps.push({
        kind: "staticSimplificationCandidates",
        options: staticSimplification,
        stopOnAccept: options.useCandidateFirst,
      });
    }
    if (options.useCandidateFirst) steps.push({ kind: "finalLossyCandidates" });
    return this.runPlan({ steps });
  }

  private get best(): Polygon[] {
    return this.acceptor.polygons;
  }

  private get bestCost(): number {
    return this.acceptor.cost;
  }

  private runStaticSimplificationCandidates(options: OptimizeStaticSimplificationOptions = {}): boolean {
    if (this.meshResolution !== "lossy") return false;
    if (!shouldTryStaticSimplification(this.source, this.best)) return false;
    const rawRelaxed = simplifyTriangleMeshCandidate(this.source, options);
    if (!rawRelaxed) return false;

    for (const plan of this.staticSimplificationPlans(rawRelaxed)) {
      const simplified = resolveStaticSimplificationPlan(plan, options);
      if (!simplified) continue;
      if (this.generateStaticSimplificationCandidate(
        simplified,
        options,
        plan.skipInteriorCull,
      )) return true;
    }
    return false;
  }

  private staticSimplificationPlans(rawRelaxed: Polygon[]): StaticSimplificationPlan[] {
    const relaxedRawDrop = this.source.length - rawRelaxed.length;
    const plans: StaticSimplificationPlan[] = [];
    const visibleCullDrop = this.visiblePolygons && this.visiblePolygons !== this.source
      ? this.source.length - this.visiblePolygons.length
      : 0;

    if (
      this.visiblePolygons &&
      this.visiblePolygons !== this.source &&
      this.source.length >= VISIBLE_FIRST_MIN_SOURCE_POLYGONS &&
      visibleCullDrop >= VISIBLE_FIRST_MIN_CULLED_POLYGONS &&
      (
        relaxedRawDrop <= VISIBLE_FIRST_MAX_RELAXED_RAW_DROP ||
        visibleCullDrop >= relaxedRawDrop * VISIBLE_FIRST_MIN_CULL_TO_RELAXED_DROP_RATIO
      )
    ) {
      plans.push({
        source: this.visiblePolygons,
        skipInteriorCull: true,
      });
    }

    if (
      this.best.length >= SOURCE_FIRST_MIN_BASELINE_POLYGONS &&
      relaxedRawDrop <= SOURCE_FIRST_MAX_RELAXED_RAW_DROP &&
      hasSourceVertexKeys(this.source)
    ) {
      plans.push({
        source: this.source,
        vertexKeyMode: "source",
      });
    }

    plans.push({
      source: this.source,
      precomputed: rawRelaxed,
    });
    return plans;
  }

  private generateStaticSimplificationCandidate(
    candidate: Polygon[],
    options: OptimizeStaticSimplificationOptions,
    skipInteriorCull = false,
  ): boolean {
    const runOptions: OptimizeMeshPolygonsRunOptions = {
      requiredMaxPolygonCount: this.best.length - 1,
      skipExactRectCover: true,
      skipInteriorCull,
      simplifiedCandidate: true,
    };
    const workspace = this.workspace.workspaceFor(candidate, runOptions);
    const before = this.best;
    new MeshCandidateEngine(
      workspace,
      {
        meshResolution: "lossy",
        stopAtPolygonCount: staticSimplificationEarlyStopTarget(this.best.length, options),
      },
      runOptions,
      {
        acceptor: this.acceptor,
        costCandidateMode: "dom",
        seamCandidateMode: "dom",
        offerBaseline: true,
      },
    ).optimize();
    return this.best !== before;
  }

  private runPlan(plan: MeshOptimizationPlan): OptimizeMeshPolygonsRunResult {
    for (const step of plan.steps) {
      let stopAfterStep = false;
      if (step.kind === "baselineCandidates") {
        this.runBaselineCandidates();
      } else if (step.kind === "staticSimplificationCandidates") {
        stopAfterStep = this.runStaticSimplificationCandidates(step.options) && step.stopOnAccept;
      } else {
        if (!this.shouldRunLossyPipeline()) break;
        if (step.kind === "initialLossyCandidates") this.runInitialLossyPipeline();
        else this.runFinalLossyPipeline();
      }
      if (stopAfterStep || this.shouldStop()) break;
    }
    return this.result();
  }

  private runBaselineCandidates(): void {
    if (this.baselineCandidatesComplete) return;
    this.baselineCandidatesComplete = true;

    if (this.offerBaseline) {
      this.acceptCandidate(this.baseline);
      if (this.shouldStop()) return;
    }

    const initialRectCover = this.runOptions.skipExactRectCover === true
      ? false
      : this.meshResolution === "lossy" && this.options.rectCover === undefined
      ? automaticLossyRectCoverOptions(this.baseline)
      : this.options.rectCover;
    if (this.shouldStop()) return;

    const rectCovered = applyRectCoverCandidate(this.baseline, initialRectCover);
    if (rectCovered !== this.baseline) this.acceptCandidate(rectCovered);
    if (this.shouldStop()) return;

    if (
      this.meshResolution === "lossy" &&
      this.options.rectCover === undefined &&
      this.runOptions.skipExactRectCover !== true
    ) {
      const losslessRectCovered = applyRectCoverCandidate(this.baseline, undefined);
      if (losslessRectCovered !== this.baseline) this.acceptCandidate(losslessRectCovered);
    }
  }

  private shouldRunLossyPipeline(): boolean {
    return this.meshResolution === "lossy" &&
      !this.shouldStop() &&
      this.best.length > 1 &&
      this.bestCost > 1 + 1e-9;
  }

  private runInitialLossyPipeline(): void {
    if (this.initialLossyCandidatesComplete) return;
    this.initialLossyCandidatesComplete = true;

    const approximate = this.preprocess(DEFAULT_LOSSY_APPROXIMATE_OPTIONS);
    this.acceptCandidate(approximate);
    if (this.shouldStop()) return;

    if (
      this.options.rectCover === undefined &&
      this.source.length >= AUTOMATIC_APPROXIMATE_RECT_COVER_MIN_SOURCE_POLYGONS &&
      this.source.length <= AUTOMATIC_APPROXIMATE_RECT_COVER_MAX_SOURCE_POLYGONS
    ) {
      this.acceptCandidate(applyRectCoverCandidate(approximate, AUTOMATIC_APPROXIMATE_RECT_COVER_OPTIONS));
      if (this.shouldStop()) return;
    }

    if (this.options.rectCover !== undefined && this.options.rectCover !== false) {
      this.acceptCandidate(applyRectCoverCandidate(approximate, this.options.rectCover));
      if (this.shouldStop()) return;
    }
  }

  private runFinalLossyPipeline(): void {
    if (this.finalLossyCandidatesComplete) return;
    this.finalLossyCandidatesComplete = true;

    if (
      this.runOptions.simplifiedCandidate === true &&
      this.source.length > SIMPLIFIED_CANDIDATE_AGGRESSIVE_MAX_POLYGONS
    ) {
      return;
    }

    this.runAggressiveLossyVariants();
    if (this.shouldStop()) return;
    this.runLargeRectCoverCandidate();
  }

  private runAggressiveLossyVariants(): void {
    const skipLargeBaselineAggressive = (
      this.stopAtPolygonCount === undefined &&
      this.source.length >= LARGE_BASELINE_AGGRESSIVE_SKIP_MIN_POLYGONS &&
      this.best.length <= LARGE_BASELINE_AGGRESSIVE_SKIP_MAX_BEST_POLYGONS
    );
    let acceptedBaseAggressive = false;
    for (
      let variantIndex = skipLargeBaselineAggressive ? AGGRESSIVE_LOSSY_APPROXIMATE_VARIANTS.length : 0;
      variantIndex < AGGRESSIVE_LOSSY_APPROXIMATE_VARIANTS.length;
      variantIndex += 1
    ) {
      if (
        variantIndex === 1 &&
        !acceptedBaseAggressive
      ) continue;
      if (
        variantIndex === 1 &&
        this.runOptions.simplifiedCandidate === true &&
        this.source.length < SIMPLIFIED_CANDIDATE_CHAINED_AGGRESSIVE_MIN_POLYGONS
      ) continue;
      if (
        variantIndex === 2 &&
        !automaticWideLossyVariantCandidate(this.source)
      ) continue;
      const aggressive = this.preprocess(AGGRESSIVE_LOSSY_APPROXIMATE_VARIANTS[variantIndex]);
      let aggressiveCandidate = aggressive;
      if (
        this.options.rectCover === undefined &&
        this.source.length >= AUTOMATIC_APPROXIMATE_RECT_COVER_MIN_SOURCE_POLYGONS &&
        this.source.length <= AUTOMATIC_APPROXIMATE_RECT_COVER_MAX_SOURCE_POLYGONS
      ) {
        aggressiveCandidate = applyRectCoverCandidate(aggressive, AUTOMATIC_APPROXIMATE_RECT_COVER_OPTIONS);
      }
      if (this.options.rectCover !== undefined && this.options.rectCover !== false) {
        aggressiveCandidate = applyRectCoverCandidate(aggressive, this.options.rectCover);
      }
      const accepted = this.acceptSeamSafeCandidate(aggressiveCandidate, this.source.length);
      if (variantIndex === 0 && accepted) acceptedBaseAggressive = true;
      if (this.shouldStop()) return;
    }
  }

  private runLargeRectCoverCandidate(): void {
    if (this.options.rectCover !== undefined) return;
    const largeRectCovered = applyRectCoverCandidate(this.best, automaticLargeLossyRectCoverCandidate(this.best));
    if (largeRectCovered !== this.best) {
      this.acceptSeamSafeCandidate(largeRectCovered, this.best.length);
    }
  }

  private preprocess(normalizeGeometry: boolean | LossyApproximateOptions): Polygon[] {
    return this.workspace.preprocess(normalizeGeometry);
  }

  private result(): OptimizeMeshPolygonsRunResult {
    return { polygons: this.best, visiblePolygons: this.visiblePolygons };
  }

  private shouldStop(): boolean {
    return this.stopAtPolygonCount !== undefined &&
      this.best.length <= this.stopAtPolygonCount;
  }

  private acceptCandidate(candidate: Polygon[], cost = polygonRenderCost(candidate)): boolean {
    return this.emitCandidate({
      mode: this.costCandidateMode,
      polygons: candidate,
      cost,
    });
  }

  private acceptDomCandidate(candidate: Polygon[]): boolean {
    return this.emitCandidate({
      mode: "dom",
      polygons: candidate,
    });
  }

  private acceptSeamSafeCandidate(
    candidate: Polygon[],
    sourcePolygonCount: number,
    cost?: number,
  ): boolean {
    return this.emitCandidate({
      mode: this.seamCandidateMode,
      polygons: candidate,
      sourcePolygonCount,
      cost,
    });
  }

  private emitCandidate(candidate: MeshCandidateSubmission): boolean {
    return this.acceptor.accept({
      ...candidate,
      maxPolygonCount: candidate.maxPolygonCount ?? this.requiredMaxPolygonCount,
    });
  }
}

class MeshCandidateAcceptor {
  private best: Polygon[];
  private bestCost: number;
  private bestDiagnostics: BestSafetyDiagnostics;
  private readonly requiredMaxPolygonCount?: number;

  constructor(baseline: Polygon[], requiredMaxPolygonCount?: number) {
    this.best = baseline;
    this.bestCost = polygonRenderCost(baseline);
    this.bestDiagnostics = { polygons: baseline };
    this.requiredMaxPolygonCount = requiredMaxPolygonCount;
  }

  get polygons(): Polygon[] {
    return this.best;
  }

  get cost(): number {
    return this.bestCost;
  }

  accept(candidate: MeshCandidateSubmission): boolean {
    if (candidate.mode === "cost") {
      return this.acceptCostCandidate(candidate.polygons, candidate.cost);
    }
    if (candidate.mode === "dom") {
      return this.acceptDomCandidate(candidate.polygons, candidate.cost, candidate.maxPolygonCount);
    }
    return this.acceptSeamSafeCandidate(
      candidate.polygons,
      candidate.sourcePolygonCount ?? candidate.polygons.length,
      candidate.cost,
      candidate.maxPolygonCount,
    );
  }

  private acceptCostCandidate(
    candidate: Polygon[],
    cost = polygonRenderCost(candidate),
  ): boolean {
    if (cost >= this.bestCost) return false;
    this.commit(candidate, cost);
    return true;
  }

  private acceptDomCandidate(
    candidate: Polygon[],
    cost = polygonRenderCost(candidate),
    maxPolygonCount?: number,
  ): boolean {
    if (candidate.length >= this.best.length) return false;
    if (!this.withinMaxPolygonCount(candidate, maxPolygonCount)) return false;
    this.commit(candidate, cost);
    return true;
  }

  private acceptSeamSafeCandidate(
    candidate: Polygon[],
    sourcePolygonCount: number,
    cost?: number,
    maxPolygonCount?: number,
  ): boolean {
    if (candidate.length >= this.best.length) return false;
    if (!this.withinMaxPolygonCount(candidate, maxPolygonCount)) return false;
    const minGain = aggressiveLossyMinRenderCostGain(sourcePolygonCount);
    if (this.bestCost - candidate.length < minGain) return false;
    const candidateCost = cost ?? polygonRenderCost(candidate);
    const gain = this.bestCost - candidateCost;
    if (gain <= 0) return false;
    if (gain < minGain) return false;
    const candidateSeam = trySeamOverlapSafetyDiagnostics(candidate);
    if (!candidateSeam) return false;
    const baselineSeam = this.bestSeamDiagnostics();
    if (!baselineSeam) return false;
    if (seamDiagnosticsWorse(candidateSeam, baselineSeam)) return false;
    if (topologyGapDiagnosticsWorse(
      this.bestTopologyEdges(),
      this.bestTopologySelfDiagnostics(),
      candidate,
    )) return false;
    this.commit(candidate, candidateCost, candidateSeam);
    return true;
  }

  private withinMaxPolygonCount(candidate: Polygon[], maxPolygonCount?: number): boolean {
    const limit = maxPolygonCount ?? this.requiredMaxPolygonCount;
    return limit === undefined || candidate.length <= limit;
  }

  private commit(candidate: Polygon[], cost: number, seam?: SeamOverlapDiagnostics): void {
    this.best = candidate;
    this.bestCost = cost;
    this.bestDiagnostics = { polygons: candidate, seam };
  }

  private resetBestDiagnostics(seam?: SeamOverlapDiagnostics): void {
    this.bestDiagnostics = { polygons: this.best, seam };
  }

  private bestSeamDiagnostics(): SeamOverlapDiagnostics | null {
    if (this.bestDiagnostics.polygons !== this.best) this.resetBestDiagnostics();
    if (!this.bestDiagnostics.seam) {
      const seam = trySeamOverlapSafetyDiagnostics(this.best);
      if (!seam) return null;
      this.bestDiagnostics.seam = seam;
    }
    return this.bestDiagnostics.seam;
  }

  private bestTopologyEdges(): TopologyEdgeStats {
    if (this.bestDiagnostics.polygons !== this.best) this.resetBestDiagnostics();
    if (!this.bestDiagnostics.topologyEdges) {
      this.bestDiagnostics.topologyEdges = collectTopologyEdgeStats(this.best);
    }
    return this.bestDiagnostics.topologyEdges;
  }

  private bestTopologySelfDiagnostics(): TopologyGapDiagnostics {
    if (this.bestDiagnostics.polygons !== this.best) this.resetBestDiagnostics();
    if (!this.bestDiagnostics.topologySelf) {
      this.bestDiagnostics.topologySelf = topologySelfDiagnostics(this.bestTopologyEdges(), TOPOLOGY_GAP_TOLERANCE);
    }
    return this.bestDiagnostics.topologySelf;
  }
}

function polygonRenderCost(polygons: Polygon[]): number {
  let cost = 0;
  for (const polygon of polygons) {
    const vertexCount = polygon.vertices.length;
    const irregularPenalty = vertexCount <= 4 ? 0 : Math.min(4, vertexCount - 4) * 0.12;
    const texturePenalty = polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length ? 0.15 : 0;
    cost += 1 + irregularPenalty + texturePenalty;
  }
  return cost;
}

function trySeamOverlapSafetyDiagnostics(polygons: Polygon[]): SeamOverlapDiagnostics | null {
  try {
    return seamOverlapSafetyDiagnostics(polygons);
  } catch (error) {
    if (error instanceof RangeError && error.message === "Set maximum size exceeded") return null;
    throw error;
  }
}

function seamDiagnosticsWorse(
  candidate: SeamOverlapDiagnostics,
  baseline: SeamOverlapDiagnostics,
): boolean {
  return candidate.nearPairs > baseline.nearPairs ||
    candidate.unclosedPairs > baseline.unclosedPairs ||
    candidate.maxMeasuredGapPx > baseline.maxMeasuredGapPx + 1e-9 ||
    candidate.maxResidualGapPx > baseline.maxResidualGapPx + 1e-9;
}

function topologyGapDiagnosticsWorse(
  referenceEdges: TopologyEdgeStats,
  referenceDiagnostics: TopologyGapDiagnostics,
  candidate: Polygon[],
): boolean {
  const candidateEdges = collectTopologyEdgeStats(candidate);
  if (topologyExposesReferenceInternalEdge(referenceEdges, candidateEdges, TOPOLOGY_GAP_TOLERANCE)) return true;
  return boundaryTJunctionDiagnosticsWorse(
    candidateEdges.boundarySegments,
    TOPOLOGY_GAP_TOLERANCE,
    referenceDiagnostics,
  );
}

function topologyExposesReferenceInternalEdge(
  referenceEdges: TopologyEdgeStats,
  candidateEdges: TopologyEdgeStats,
  tolerance: number,
): boolean {
  if (referenceEdges.internalSegments.length === 0) return false;
  const internalIndex = topologyInternalSegmentIndex(referenceEdges, tolerance);

  for (const segment of candidateEdges.boundarySegments) {
    if (referenceEdges.boundaryKeys.has(segment.key)) continue;
    if (referenceEdges.internalKeys.has(segment.key)) return true;
    if (hasOverlappingSegment(segment, internalIndex, tolerance)) return true;
  }

  return false;
}

function topologyInternalSegmentIndex(
  edges: TopologyEdgeStats,
  tolerance: number,
): TopologySegmentIndex {
  if (!edges.internalIndex || edges.internalIndexTolerance !== tolerance) {
    edges.internalIndex = buildTopologySegmentIndex(edges.internalSegments, tolerance);
    edges.internalIndexTolerance = tolerance;
  }
  return edges.internalIndex;
}

function boundaryTJunctionDiagnosticsWorse(
  boundarySegments: TopologySegment[],
  tolerance: number,
  referenceDiagnostics: TopologyGapDiagnostics,
): boolean {
  const boundaryIndex = buildTopologySegmentIndex(boundarySegments, tolerance);
  const seenPairs = new Set<number>();
  let pairStride = 0;
  let tJunctionPairs = 0;
  let tJunctionLength = 0;
  for (const segment of boundarySegments) pairStride = Math.max(pairStride, segment.index + 1);
  for (const segment of boundarySegments) {
    for (const other of overlappingSegmentCandidates(segment, boundaryIndex, tolerance)) {
      if (other === segment || other.polygon === segment.polygon || other.key === segment.key) continue;
      const pairKey = segment.index < other.index
        ? segment.index * pairStride + other.index
        : other.index * pairStride + segment.index;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      const overlap = segmentOverlap(segment, other, tolerance);
      if (!overlap) continue;
      tJunctionPairs += 1;
      tJunctionLength += overlap.overlapLength;
      if (
        tJunctionPairs > referenceDiagnostics.tJunctionPairs ||
        tJunctionLength > referenceDiagnostics.tJunctionLength + 1e-9
      ) return true;
    }
  }
  return false;
}

function topologySelfDiagnostics(edges: TopologyEdgeStats, tolerance: number): TopologyGapDiagnostics {
  const diagnostics: TopologyGapDiagnostics = {
    tJunctionPairs: 0,
    tJunctionLength: 0,
  };
  addBoundaryTJunctionDiagnostics(diagnostics, edges.boundarySegments, tolerance);
  return diagnostics;
}

function addBoundaryTJunctionDiagnostics(
  diagnostics: TopologyGapDiagnostics,
  boundarySegments: TopologySegment[],
  tolerance: number,
): void {
  const boundaryIndex = buildTopologySegmentIndex(boundarySegments, tolerance);
  const seenPairs = new Set<number>();
  let pairStride = 0;
  for (const segment of boundarySegments) pairStride = Math.max(pairStride, segment.index + 1);
  for (const segment of boundarySegments) {
    for (const other of overlappingSegmentCandidates(segment, boundaryIndex, tolerance)) {
      if (other === segment || other.polygon === segment.polygon || other.key === segment.key) continue;
      const pairKey = segment.index < other.index
        ? segment.index * pairStride + other.index
        : other.index * pairStride + segment.index;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      const overlap = segmentOverlap(segment, other, tolerance);
      if (!overlap) continue;
      diagnostics.tJunctionPairs += 1;
      diagnostics.tJunctionLength += overlap.overlapLength;
    }
  }
}

function collectTopologyEdgeStats(polygons: Polygon[]): TopologyEdgeStats {
  const edges = new Map<string, { count: number; segment: TopologySegment }>();
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex += 1) {
    const vertices = polygons[polygonIndex].vertices;
    for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex += 1) {
      const a = vertices[edgeIndex];
      const b = vertices[(edgeIndex + 1) % vertices.length];
      const segment = topologySegment(edgeKey(a, b), polygonIndex, edgeIndex, a, b);
      if (!segment) continue;
      const current = edges.get(segment.key);
      if (current) current.count += 1;
      else edges.set(segment.key, { count: 1, segment });
    }
  }

  const boundaryKeys = new Set<string>();
  const internalKeys = new Set<string>();
  const boundarySegments: TopologySegment[] = [];
  const internalSegments: TopologySegment[] = [];
  let boundaryLength = 0;
  let index = 0;
  for (const edge of edges.values()) {
    const segment = { ...edge.segment, index };
    index += 1;
    if (edge.count === 1) {
      boundaryKeys.add(segment.key);
      boundarySegments.push(segment);
      boundaryLength += segment.length;
    } else {
      internalKeys.add(segment.key);
      internalSegments.push(segment);
    }
  }
  return { boundaryKeys, internalKeys, boundarySegments, internalSegments, boundaryLength };
}

function topologySegment(
  key: string,
  polygon: number,
  edge: number,
  a: Vec3,
  b: Vec3,
): TopologySegment | null {
  const delta = subVec(b, a);
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  if (length <= 1e-10) return null;
  const dir: Vec3 = [delta[0] / length, delta[1] / length, delta[2] / length];
  return {
    index: -1,
    key,
    polygon,
    edge,
    a,
    b,
    dir,
    length,
    minX: Math.min(a[0], b[0]),
    minY: Math.min(a[1], b[1]),
    minZ: Math.min(a[2], b[2]),
    maxX: Math.max(a[0], b[0]),
    maxY: Math.max(a[1], b[1]),
    maxZ: Math.max(a[2], b[2]),
  };
}

function buildTopologySegmentIndex(segments: TopologySegment[], tolerance: number): TopologySegmentIndex {
  const cellSize = Math.max(tolerance * 8, 0.5);
  const cells = new Map<string, TopologySegment[]>();
  for (const segment of segments) {
    addTopologySegmentToCells(cells, segment, cellSize, tolerance);
  }
  return { cellSize, cells };
}

function addTopologySegmentToCells(
  cells: Map<string, TopologySegment[]>,
  segment: TopologySegment,
  cellSize: number,
  padding: number,
) {
  const [minX, minY, minZ] = topologyCellCoords(
    [segment.minX - padding, segment.minY - padding, segment.minZ - padding],
    cellSize,
  );
  const [maxX, maxY, maxZ] = topologyCellCoords(
    [segment.maxX + padding, segment.maxY + padding, segment.maxZ + padding],
    cellSize,
  );
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const key = `${x},${y},${z}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push(segment);
        else cells.set(key, [segment]);
      }
    }
  }
}

function topologyCellCoords(point: Vec3, cellSize: number): [number, number, number] {
  return [
    Math.floor(point[0] / cellSize),
    Math.floor(point[1] / cellSize),
    Math.floor(point[2] / cellSize),
  ];
}

function overlappingSegmentCandidates(
  segment: TopologySegment,
  index: ReturnType<typeof buildTopologySegmentIndex>,
  tolerance: number,
): TopologySegment[] {
  const out: TopologySegment[] = [];
  const seen = new Set<TopologySegment>();
  const [minX, minY, minZ] = topologyCellCoords(
    [segment.minX - tolerance, segment.minY - tolerance, segment.minZ - tolerance],
    index.cellSize,
  );
  const [maxX, maxY, maxZ] = topologyCellCoords(
    [segment.maxX + tolerance, segment.maxY + tolerance, segment.maxZ + tolerance],
    index.cellSize,
  );
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const bucket = index.cells.get(`${x},${y},${z}`);
        if (!bucket) continue;
        for (const candidate of bucket) {
          if (seen.has(candidate)) continue;
          seen.add(candidate);
          out.push(candidate);
        }
      }
    }
  }
  return out;
}

function hasOverlappingSegment(
  segment: TopologySegment,
  index: ReturnType<typeof buildTopologySegmentIndex>,
  tolerance: number,
): boolean {
  for (const candidate of overlappingSegmentCandidates(segment, index, tolerance)) {
    const overlap = segmentOverlap(segment, candidate, tolerance);
    if (overlap) return true;
  }
  return false;
}

function segmentOverlap(
  a: TopologySegment,
  b: TopologySegment,
  tolerance: number,
): SegmentOverlapInfo | null {
  if (!topologySegmentBoundsOverlap(a, b, tolerance)) return null;
  if (Math.abs(dotVec(a.dir, b.dir)) < TOPOLOGY_MIN_PARALLEL_DOT) return null;

  const bStart = dotVec(subVec(b.a, a.a), a.dir);
  const bEnd = dotVec(subVec(b.b, a.a), a.dir);
  const overlapStart = Math.max(0, Math.min(bStart, bEnd));
  const overlapEnd = Math.min(a.length, Math.max(bStart, bEnd));
  const overlapLength = overlapEnd - overlapStart;
  if (overlapLength <= Math.max(TOPOLOGY_MIN_OVERLAP, Math.min(a.length, b.length) * 1e-4)) {
    return null;
  }

  const mid = [
    a.a[0] + a.dir[0] * ((overlapStart + overlapEnd) / 2),
    a.a[1] + a.dir[1] * ((overlapStart + overlapEnd) / 2),
    a.a[2] + a.dir[2] * ((overlapStart + overlapEnd) / 2),
  ] as Vec3;
  const projected = Math.max(0, Math.min(b.length, dotVec(subVec(mid, b.a), b.dir)));
  const closest: Vec3 = [
    b.a[0] + b.dir[0] * projected,
    b.a[1] + b.dir[1] * projected,
    b.a[2] + b.dir[2] * projected,
  ];
  const offset = distanceVec(mid, closest);
  return offset <= tolerance ? { overlapLength, offset } : null;
}

function topologySegmentBoundsOverlap(a: TopologySegment, b: TopologySegment, tolerance: number): boolean {
  return a.minX <= b.maxX + tolerance &&
    b.minX <= a.maxX + tolerance &&
    a.minY <= b.maxY + tolerance &&
    b.minY <= a.maxY + tolerance &&
    a.minZ <= b.maxZ + tolerance &&
    b.minZ <= a.maxZ + tolerance;
}

function aggressiveLossyMinRenderCostGain(sourcePolygonCount: number): number {
  return Math.max(
    AGGRESSIVE_LOSSY_MIN_RENDER_COST_GAIN,
    sourcePolygonCount * AGGRESSIVE_LOSSY_MIN_SOURCE_GAIN_RATIO,
  );
}

function staticSimplificationEarlyStopTarget(
  count: number,
  options: OptimizeStaticSimplificationOptions,
): number {
  const ratio = Number.isFinite(options.earlyStopDropRatio)
    ? Math.max(0, options.earlyStopDropRatio!)
    : DEFAULT_STATIC_SIMPLIFY_EARLY_STOP_DROP_RATIO;
  return Math.max(0, count - Math.max(1, Math.ceil(count * ratio)));
}

function hasSourceVertexKeys(polygons: Polygon[]): boolean {
  return polygons.some((polygon) => polygon.simplifySourceVertexKeys?.length === polygon.vertices.length);
}

function shouldTryStaticSimplification(polygons: Polygon[], baselineOptimized: Polygon[]): boolean {
  return polygons.length === 0 ||
    baselineOptimized.length / polygons.length > MIN_STATIC_SIMPLIFY_BASELINE_SOURCE_RATIO;
}

function simplifyTriangleMeshCandidate(
  source: Polygon[],
  options: OptimizeStaticSimplificationOptions,
  vertexKeyMode?: "relaxed" | "source",
): Polygon[] | null {
  const candidate = simplifyTriangleMeshPolygons(source, {
    ...options.simplifyTriangleMeshOptions,
    ...(vertexKeyMode ? { vertexKeyMode } : {}),
  });
  if (candidate === source || candidate.length >= source.length) return null;
  return candidate;
}

function resolveStaticSimplificationPlan(
  plan: StaticSimplificationPlan,
  options: OptimizeStaticSimplificationOptions,
): Polygon[] | null {
  if (plan.precomputed !== undefined) return plan.precomputed;
  return simplifyTriangleMeshCandidate(plan.source, options, plan.vertexKeyMode);
}

function applyRectCoverCandidate(
  polygons: Polygon[],
  setting: OptimizeMeshPolygonsOptions["rectCover"],
): Polygon[] {
  if (setting === false) return polygons;
  const options = resolveRectCoverOptions(polygons, setting);
  if (!options) return polygons;
  const covered = coverPlanarPolygons(polygons, options);
  return covered.length < polygons.length ? covered : polygons;
}

function resolveRectCoverOptions(
  polygons: Polygon[],
  setting: OptimizeMeshPolygonsOptions["rectCover"],
): CoverPlanarPolygonsOptions | null {
  if (setting && setting !== true) return setting;

  const explicit = setting === true;
  const polygonCount = polygons.length;
  if (polygonCount > 2200) return null;
  if (
    !explicit &&
    polygonCount >= DEFAULT_RECT_COVER_SMALL_AUTOMATIC_SKIP_MIN_POLYGONS &&
    polygonCount < DEFAULT_RECT_COVER_SMALL_AUTOMATIC_SKIP_MAX_POLYGONS
  ) return null;
  if (!explicit && polygonCount > DEFAULT_RECT_COVER_MAX_AUTOMATIC_POLYGONS) return null;
  if (!explicit && polygonCount <= 300) {
    return {
      ...DEFAULT_RECT_COVER_OPTIONS,
      maxCandidateAxes: 1,
    };
  }
  if (polygonCount > 300) {
    if (!explicit) {
      if (maxPolygonVertexCount(polygons) > 12) return null;
      if (polygonBoundaryEdgeCount(polygons) > DEFAULT_RECT_COVER_MAX_BOUNDARY_EDGES) return null;
    }
    return {
      ...DEFAULT_RECT_COVER_OPTIONS,
      maxCandidateAxes: Math.min(DEFAULT_RECT_COVER_OPTIONS.maxCandidateAxes ?? 24, 2),
    };
  }
  return DEFAULT_RECT_COVER_OPTIONS;
}

function automaticLossyRectCoverOptions(polygons: Polygon[]): CoverPlanarPolygonsOptions | false {
  if (polygons.length > AUTOMATIC_RECT_COVER_MAX_POLYGONS) return false;
  if (polygons.length === 0) return false;
  if (polygonTriangleCount(polygons) / polygons.length < AUTOMATIC_RECT_COVER_MIN_TRIANGLE_RATIO) {
    return false;
  }
  return AUTOMATIC_LOSSY_RECT_COVER_OPTIONS;
}

function automaticLargeLossyRectCoverCandidate(polygons: Polygon[]): CoverPlanarPolygonsOptions | false {
  if (polygons.length < LARGE_LOSSY_RECT_COVER_MIN_POLYGONS) return false;
  if (polygons.length > LARGE_LOSSY_RECT_COVER_MAX_POLYGONS) return false;
  if (maxPolygonVertexCount(polygons) <= 12) return false;
  if (polygonBoundaryEdgeCount(polygons) > LARGE_LOSSY_RECT_COVER_MAX_BOUNDARY_EDGES) return false;
  return LARGE_LOSSY_RECT_COVER_OPTIONS;
}

function automaticWideLossyVariantCandidate(polygons: Polygon[]): boolean {
  return polygons.length <= WIDE_LOSSY_VARIANT_MAX_SOURCE_POLYGONS;
}

function polygonTriangleCount(polygons: Polygon[]): number {
  let triangles = 0;
  for (const polygon of polygons) {
    if (polygon.vertices.length === 3) triangles += 1;
  }
  return triangles;
}

function maxPolygonVertexCount(polygons: Polygon[]): number {
  let max = 0;
  for (const polygon of polygons) {
    max = Math.max(max, polygon.vertices.length);
  }
  return max;
}

function polygonBoundaryEdgeCount(polygons: Polygon[]): number {
  const edges = new Map<string, number>();
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.vertices.length; i++) {
      const a = polygon.vertices[i];
      const b = polygon.vertices[(i + 1) % polygon.vertices.length];
      const key = edgeKey(a, b);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let boundary = 0;
  for (const count of edges.values()) {
    if (count === 1) boundary += 1;
  }
  return boundary;
}

function applyIndexFilter(polygons: Polygon[], filter: IndexFilter | undefined): Polygon[] {
  if (filter === undefined || filter === null) return polygons;
  return filter.map((index) => polygons[index]).filter((polygon): polygon is Polygon => !!polygon);
}

function keptIndexFilter(input: Polygon[], kept: Polygon[]): IndexFilter {
  if (kept === input) return null;
  if (kept.length === input.length && kept.every((polygon, index) => polygon === input[index])) {
    return null;
  }
  const keptSet = new Set(kept);
  const indices: number[] = [];
  for (let i = 0; i < input.length; i++) {
    if (keptSet.has(input[i])) indices.push(i);
  }
  return indices.length === input.length ? null : indices;
}

function dedupedPolygonsForMerge(polygons: Polygon[], cache?: PreprocessCache): Polygon[] {
  if (cache?.deduped) return cache.deduped;
  let filter = cache?.dedupedIndices;
  if (filter === undefined) {
    const dropped = findOverlappingPolygonDuplicates(polygons);
    if (dropped.size === 0) {
      filter = null;
    } else {
      filter = [];
      for (let i = 0; i < polygons.length; i++) {
        if (!dropped.has(i)) filter.push(i);
      }
    }
    if (cache) cache.dedupedIndices = filter;
  }
  const deduped = applyIndexFilter(polygons, filter);
  if (cache) cache.deduped = deduped;
  return deduped;
}

function interiorPolygonsForMerge(polygons: Polygon[], cache?: PreprocessCache): Polygon[] {
  if (cache?.skipInteriorCull) return polygons;
  if (cache?.interior) return cache.interior;
  let filter = cache?.interiorIndices;
  if (filter === undefined) {
    const kept = cullInteriorPolygons(polygons);
    filter = keptIndexFilter(polygons, kept);
    if (cache) cache.interiorIndices = filter;
  }
  const interior = applyIndexFilter(polygons, filter);
  if (cache) cache.interior = interior;
  return interior;
}

function preprocessModelPolygons(
  polygons: Polygon[],
  normalizeGeometry: boolean | LossyApproximateOptions,
  cache?: PreprocessCache,
): Polygon[] {
  // Dedup runs FIRST — catches inner/outer shell duplicates and coincident
  // doubled-up faces that importers emit as artifacts. Doing it before
  // cull + merge means everything downstream operates on the leaner set
  // and gets a free speedup as a bonus. Light-independent, runs once.
  const deduped = dedupedPolygonsForMerge(polygons, cache);
  const interior = interiorPolygonsForMerge(deduped, cache);
  const baseline = cache?.baseline ?? mergePolygons(interior);
  if (cache && !cache.baseline) cache.baseline = baseline;
  if (!normalizeGeometry) return baseline;

  const options = normalizeGeometry === true
    ? DEFAULT_NORMALIZE_OPTIONS
    : resolveNormalizeOptions(normalizeGeometry);
  if (options.isolatedPairs) {
    const paired = mergeIsolatedTrianglePairs(snappedInteriorPolygonsForMerge(deduped, cache), options, cache);
    let mergedPaired = mergePolygons(paired);
    if (
      cache?.snappedInteriorUsesBaselineFilter &&
      shouldRecheckSnappedInteriorCull(baseline, mergedPaired)
    ) {
      const exactPaired = mergeIsolatedTrianglePairs(
        snappedInteriorPolygonsForMerge(deduped, cache, true),
        options,
        cache,
      );
      const exactMergedPaired = mergePolygons(exactPaired);
      if (exactMergedPaired.length < mergedPaired.length) mergedPaired = exactMergedPaired;
    }
    return mergedPaired.length < baseline.length ? mergedPaired : baseline;
  }
  const normalizedGeometry = normalizeGeometryForMerge(deduped, options, cache);
  const normalizedInterior = cullInteriorPolygons(normalizedGeometry);
  const normalized = mergePolygons(normalizedInterior);
  return normalized.length < baseline.length ? normalized : baseline;
}

function snappedPolygonsForMerge(polygons: Polygon[], cache?: PreprocessCache): Polygon[] {
  if (!cache) return snapGeometryForMerge(polygons);
  if (!cache.snapped) cache.snapped = snapGeometryForMerge(polygons);
  return cache.snapped;
}

function snappedInteriorPolygonsForMerge(
  polygons: Polygon[],
  cache?: PreprocessCache,
  exactCull = false,
): Polygon[] {
  if (!cache) return cullInteriorPolygons(snapGeometryForMerge(polygons));
  if (exactCull && cache.snappedInteriorExact) return cache.snappedInteriorExact;
  if (!exactCull && cache.snappedInterior) return cache.snappedInterior;

  const snapped = snappedPolygonsForMerge(polygons, cache);
  if (exactCull) {
    if (snapped === polygons && cache.deduped === polygons && cache.interior) {
      cache.snappedInteriorExactIndices = cache.interiorIndices;
      cache.snappedInteriorExact = cache.interior;
      return cache.snappedInteriorExact;
    }
    const kept = cullInteriorPolygons(snapped);
    cache.snappedInteriorExactIndices = keptIndexFilter(snapped, kept);
    cache.snappedInteriorExact = kept;
    return cache.snappedInteriorExact;
  }

  if (!cache.snappedInterior) {
    if (snapped === polygons && cache.deduped === polygons && cache.interior) {
      cache.snappedInteriorIndices = cache.interiorIndices;
      cache.snappedInterior = cache.interior;
      cache.snappedInteriorUsesBaselineFilter = false;
      return cache.snappedInterior;
    }
    if (cache.reuseSnappedInteriorCull !== false && cache.interiorIndices !== undefined) {
      cache.snappedInteriorIndices = cache.interiorIndices;
      cache.snappedInterior = applyIndexFilter(snapped, cache.snappedInteriorIndices);
      cache.snappedInteriorUsesBaselineFilter = true;
      return cache.snappedInterior;
    }
    if (cache.snappedInteriorIndices === undefined) {
      const kept = cullInteriorPolygons(snapped);
      cache.snappedInteriorIndices = keptIndexFilter(snapped, kept);
      cache.snappedInterior = kept;
      cache.snappedInteriorExactIndices = cache.snappedInteriorIndices;
      cache.snappedInteriorExact = kept;
      cache.snappedInteriorUsesBaselineFilter = false;
    } else {
      cache.snappedInterior = applyIndexFilter(snapped, cache.snappedInteriorIndices);
    }
  }
  return cache.snappedInterior;
}

function shouldRecheckSnappedInteriorCull(baseline: Polygon[], candidate: Polygon[]): boolean {
  return candidate.length >= baseline.length;
}

function resolveNormalizeOptions(options: LossyApproximateOptions): ResolvedGeometryNormalizeOptions {
  return {
    maxAngleDeg: options.maxAngleDeg ?? DEFAULT_NORMALIZE_OPTIONS.maxAngleDeg,
    maxPlaneDisplacement: options.maxPlaneDisplacement ?? DEFAULT_NORMALIZE_OPTIONS.maxPlaneDisplacement,
    maxBoundaryDisplacement: options.maxBoundaryDisplacement ?? DEFAULT_NORMALIZE_OPTIONS.maxBoundaryDisplacement,
    isolatedPairs: options.isolatedPairs ?? DEFAULT_NORMALIZE_OPTIONS.isolatedPairs,
  };
}

function mergeIsolatedTrianglePairs(
  polygons: Polygon[],
  options: ResolvedGeometryNormalizeOptions,
  cache?: PreprocessCache,
): Polygon[] {
  const source = trianglePairSourceFor(polygons, cache);

  const candidates: PairCandidate[] = [];
  for (const prepared of preparedPairCandidatesFor(polygons, source)) {
    if (preparedPairCandidateMatchesOptions(prepared, options)) {
      candidates.push(prepared.candidate);
    }
  }
  const selected = choosePairCandidates(candidates);
  if (selected.length === 0) return polygons;

  return buildIsolatedTrianglePairOutput(polygons, selected);
}

function trianglePairSourceFor(
  polygons: Polygon[],
  cache?: PreprocessCache,
): TrianglePairSourceCache {
  if (cache?.trianglePairSource?.polygons === polygons) return cache.trianglePairSource;

  const metas = polygons.map((polygon): PlaneNormalizeMeta | null => {
    const plane = planeOfPolygon(polygon);
    if (!plane) return null;
    return {
      polygon,
      normal: plane.normal,
      area: plane.area,
      materialKey: materialKeyForPolygon(polygon),
    };
  });
  const edgeOwners = new Map<string, number[]>();
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    if (polygon.vertices.length !== 3 || !metas[i]) continue;
    for (let j = 0; j < polygon.vertices.length; j++) {
      const key = edgeKey(polygon.vertices[j], polygon.vertices[(j + 1) % polygon.vertices.length]);
      const owners = edgeOwners.get(key);
      if (owners) owners.push(i);
      else edgeOwners.set(key, [i]);
    }
  }

  const edgeOwnerPairs: Array<[number, number]> = [];
  for (const owners of edgeOwners.values()) {
    if (owners.length === 2) edgeOwnerPairs.push([owners[0], owners[1]]);
  }

  const source = { polygons, metas, edgeOwnerPairs };
  if (cache) cache.trianglePairSource = source;
  return source;
}

function preparedPairCandidatesFor(
  polygons: Polygon[],
  source: TrianglePairSourceCache,
): PreparedPairCandidate[] {
  if (source.preparedCandidates) return source.preparedCandidates;
  const prepared: PreparedPairCandidate[] = [];
  for (const [a, b] of source.edgeOwnerPairs) {
    const candidate = prepareTrianglePairCandidate(a, b, polygons, source.metas);
    if (candidate) prepared.push(candidate);
  }
  source.preparedCandidates = prepared;
  return prepared;
}

function preparedPairCandidateMatchesOptions(
  prepared: PreparedPairCandidate,
  options: ResolvedGeometryNormalizeOptions,
): boolean {
  const minNormalDot = Math.cos((options.maxAngleDeg * Math.PI) / 180);
  return prepared.normalDot >= minNormalDot &&
    prepared.maxDistance <= Math.min(options.maxPlaneDisplacement, options.maxBoundaryDisplacement);
}

function buildIsolatedTrianglePairOutput(
  polygons: Polygon[],
  selected: PairCandidate[],
): Polygon[] {
  const replacements = new Map<number, Polygon>();
  const skipped = new Set<number>();
  const vertexMoves = averagedVertexPositionMoves(selected.flatMap((candidate) => candidate.vertexMoves));
  for (const candidate of selected) {
    const outputIndex = Math.min(candidate.a, candidate.b);
    replacements.set(outputIndex, candidate.polygon);
    skipped.add(Math.max(candidate.a, candidate.b));
  }

  const output: Polygon[] = [];
  for (let i = 0; i < polygons.length; i++) {
    const replacement = replacements.get(i);
    if (replacement) {
      output.push(replacement);
      continue;
    }
    if (skipped.has(i)) continue;
    output.push(polygons[i]);
  }
  return vertexMoves.size > 0 ? applyVertexPositionMoves(output, vertexMoves) : output;
}

function choosePairCandidates(candidates: PairCandidate[]): PairCandidate[] {
  if (candidates.length > 3000) return choosePairCandidatesStatic(candidates);
  return choosePairCandidatesDynamic(candidates);
}

function choosePairCandidatesStatic(candidates: PairCandidate[]): PairCandidate[] {
  const pairDegrees = new Map<number, number>();
  for (const candidate of candidates) {
    pairDegrees.set(candidate.a, (pairDegrees.get(candidate.a) ?? 0) + 1);
    pairDegrees.set(candidate.b, (pairDegrees.get(candidate.b) ?? 0) + 1);
  }

  const sorted = [...candidates].sort((a, b) => {
    const degreeA = (pairDegrees.get(a.a) ?? 0) + (pairDegrees.get(a.b) ?? 0);
    const degreeB = (pairDegrees.get(b.a) ?? 0) + (pairDegrees.get(b.b) ?? 0);
    return degreeA - degreeB || a.score - b.score;
  });

  const used = new Set<number>();
  const selected: PairCandidate[] = [];
  for (const candidate of sorted) {
    if (used.has(candidate.a) || used.has(candidate.b)) continue;
    used.add(candidate.a);
    used.add(candidate.b);
    selected.push(candidate);
  }
  return selected;
}

function choosePairCandidatesDynamic(candidates: PairCandidate[]): PairCandidate[] {
  const incident = new Map<number, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const aIncident = incident.get(candidate.a);
    if (aIncident) aIncident.push(i);
    else incident.set(candidate.a, [i]);
    const bIncident = incident.get(candidate.b);
    if (bIncident) bIncident.push(i);
    else incident.set(candidate.b, [i]);
  }

  const selected: PairCandidate[] = [];
  const live = new Array(candidates.length).fill(true);
  const liveIncidentCount = new Map<number, number>();
  const heap = new PairCandidateRankHeap();

  for (const [polygon, list] of incident) liveIncidentCount.set(polygon, list.length);
  const liveDegree = (candidate: PairCandidate): number =>
    (liveIncidentCount.get(candidate.a) ?? 0) + (liveIncidentCount.get(candidate.b) ?? 0);
  const pushRank = (index: number): void => {
    const candidate = candidates[index];
    heap.push({
      degree: liveDegree(candidate),
      score: candidate.score,
      index,
    });
  };
  const invalidate = (index: number, changedPolygons: Set<number>): void => {
    if (!live[index]) return;
    live[index] = false;
    const candidate = candidates[index];
    for (const polygon of [candidate.a, candidate.b]) {
      liveIncidentCount.set(polygon, (liveIncidentCount.get(polygon) ?? 0) - 1);
      changedPolygons.add(polygon);
    }
  };

  for (let i = 0; i < candidates.length; i++) pushRank(i);

  while (heap.size() > 0) {
    const rank = heap.pop()!;
    if (!live[rank.index]) continue;

    const candidate = candidates[rank.index];
    const degree = liveDegree(candidate);
    if (degree !== rank.degree) {
      pushRank(rank.index);
      continue;
    }

    selected.push(candidate);

    const changedPolygons = new Set<number>();
    for (const polygon of [candidate.a, candidate.b]) {
      for (const index of incident.get(polygon) ?? []) {
        invalidate(index, changedPolygons);
      }
    }

    for (const polygon of changedPolygons) {
      for (const index of incident.get(polygon) ?? []) {
        if (live[index]) pushRank(index);
      }
    }
  }
  return selected;
}

class PairCandidateRankHeap {
  private items: PairCandidateRank[] = [];

  size(): number {
    return this.items.length;
  }

  push(item: PairCandidateRank): void {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (comparePairCandidateRanks(this.items[parent], this.items[index]) <= 0) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  pop(): PairCandidateRank | null {
    if (this.items.length === 0) return null;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let best = index;
        if (left < this.items.length && comparePairCandidateRanks(this.items[left], this.items[best]) < 0) best = left;
        if (right < this.items.length && comparePairCandidateRanks(this.items[right], this.items[best]) < 0) best = right;
        if (best === index) break;
        [this.items[index], this.items[best]] = [this.items[best], this.items[index]];
        index = best;
      }
    }
    return top;
  }
}

function comparePairCandidateRanks(a: PairCandidateRank, b: PairCandidateRank): number {
  return a.degree - b.degree || a.score - b.score || a.index - b.index;
}

function averagedVertexPositionMoves(moves: VertexPositionMove[]): Map<string, Vec3> {
  const totals = new Map<string, { x: number; y: number; z: number; count: number }>();
  for (const move of moves) {
    const total = totals.get(move.key);
    if (total) {
      total.x += move.target[0];
      total.y += move.target[1];
      total.z += move.target[2];
      total.count += 1;
    } else {
      totals.set(move.key, {
        x: move.target[0],
        y: move.target[1],
        z: move.target[2],
        count: 1,
      });
    }
  }

  const averaged = new Map<string, Vec3>();
  for (const [key, total] of totals) {
    averaged.set(key, [
      total.x / total.count,
      total.y / total.count,
      total.z / total.count,
    ]);
  }
  return averaged;
}

function vertexPositionMovesForProjection(source: Polygon[], projected: Polygon[]): VertexPositionMove[] {
  const moves: VertexPositionMove[] = [];
  for (let i = 0; i < source.length; i++) {
    const sourceVertices = source[i].vertices;
    const projectedVertices = projected[i]?.vertices;
    if (!projectedVertices || projectedVertices.length !== sourceVertices.length) continue;
    for (let j = 0; j < sourceVertices.length; j++) {
      moves.push({
        key: vertexKey(sourceVertices[j]),
        target: projectedVertices[j],
      });
    }
    const sourceTriangles = source[i].textureTriangles ?? [];
    const projectedTriangles = projected[i]?.textureTriangles ?? [];
    for (let j = 0; j < sourceTriangles.length; j++) {
      const projectedTriangle = projectedTriangles[j];
      if (!projectedTriangle) continue;
      for (let k = 0; k < sourceTriangles[j].vertices.length; k++) {
        moves.push({
          key: vertexKey(sourceTriangles[j].vertices[k]),
          target: projectedTriangle.vertices[k],
        });
      }
    }
  }
  return moves;
}

function textureTriangleVertexProjectionMoves(polygons: Polygon[], fit: PlaneFit): VertexPositionMove[] {
  const moves: VertexPositionMove[] = [];
  for (const polygon of polygons) {
    for (const triangle of polygon.textureTriangles ?? []) {
      for (const vertex of triangle.vertices) {
        moves.push({
          key: vertexKey(vertex),
          target: projectVecToPlane(vertex, fit),
        });
      }
    }
  }
  return moves;
}

function applyVertexPositionMoves(polygons: Polygon[], moves: Map<string, Vec3>): Polygon[] {
  return polygons.map((polygon) => {
    let changed = false;
    const moveVertex = (vertex: Vec3): Vec3 => {
      const target = moves.get(vertexKey(vertex));
      if (!target) return vertex;
      changed = true;
      return target;
    };
    const vertices = polygon.vertices.map(moveVertex);
    const textureTriangles = mapTextureTriangleVertices(polygon.textureTriangles, moveVertex);
    return changed ? {
      ...polygon,
      vertices,
      ...(textureTriangles ? { textureTriangles } : {}),
    } : polygon;
  });
}

function prepareTrianglePairCandidate(
  aIndex: number,
  bIndex: number,
  polygons: Polygon[],
  metas: Array<PlaneNormalizeMeta | null>,
): PreparedPairCandidate | null {
  const a = polygons[aIndex];
  const b = polygons[bIndex];
  const aMeta = metas[aIndex];
  const bMeta = metas[bIndex];
  if (!aMeta || !bMeta) return null;
  if (a.vertices.length !== 3 || b.vertices.length !== 3) return null;
  if (!canApproximatePairMerge(a, b, aMeta, bMeta)) return null;

  const shared = sharedEdgeIndices(a, b);
  if (!shared) return null;
  const [ai0, ai1, bi0, bi1] = shared;
  const bGoesSameDirection = (bi0 + 1) % b.vertices.length === bi1;
  if (bGoesSameDirection) return null;

  const normalDot = Math.abs(dotVec(aMeta.normal, bMeta.normal));
  const minNormalDot = Math.cos((PREPARED_PAIR_MAX_ANGLE_DEG * Math.PI) / 180);
  if (normalDot < minNormalDot) return null;

  const aThird = (ai1 + 1) % a.vertices.length;
  const bThird = 3 - bi0 - bi1;
  const ring = [
    a.vertices[ai1],
    a.vertices[aThird],
    a.vertices[ai0],
    b.vertices[bThird],
  ];
  const fit = fitPlaneForVertices(ring);
  if (!fit) return null;

  let maxDistance = 0;
  let squaredDistance = 0;
  for (const vertex of ring) {
    const distance = Math.abs(signedPlaneDistance(vertex, fit));
    maxDistance = Math.max(maxDistance, distance);
    squaredDistance += distance * distance;
  }
  if (maxDistance > PREPARED_PAIR_MAX_BOUNDARY_DISPLACEMENT) return null;

  const projected = ring.map((vertex) => projectVecToPlane(vertex, fit));
  if (!isConvexPolygon(projected, fit.normal)) return null;
  const projectedPlane = planeOfPolygon({ vertices: projected });
  if (
    !projectedPlane ||
    dotVec(projectedPlane.normal, aMeta.normal) < 0.2 ||
    dotVec(projectedPlane.normal, bMeta.normal) < 0.2
  ) {
    return null;
  }
  const polygon: Polygon = {
    vertices: ring,
    color: a.color,
    ...(a.doubleSided ? { doubleSided: true } : {}),
    ...(a.data ? { data: { ...a.data } } : {}),
  };
  if (canUseTexturedLossyMerge(a, b) && a.uvs && b.uvs && a.texture) {
    polygon.texture = a.texture;
    if (a.textureWrap) polygon.textureWrap = { ...a.textureWrap };
    if (a.textureAlphaMode) polygon.textureAlphaMode = a.textureAlphaMode;
    polygon.uvs = [
      [...a.uvs[ai1]] as Vec2,
      [...a.uvs[aThird]] as Vec2,
      [...a.uvs[ai0]] as Vec2,
      [...b.uvs[bThird]] as Vec2,
    ];
    const textureTriangles = textureTrianglesForPolygons([a, b]);
    if (textureTriangles?.length) polygon.textureTriangles = textureTriangles;
  }

  return {
    normalDot,
    maxDistance,
    candidate: {
      a: aIndex,
      b: bIndex,
      polygon,
      vertexMoves: [
        ...ring.map((vertex, index) => ({
          key: vertexKey(vertex),
          target: projected[index],
        })),
        ...textureTriangleVertexProjectionMoves([a, b], fit),
      ],
      score: squaredDistance / ring.length + maxDistance * 0.25 + (1 - normalDot) * 0.1,
    },
  };
}

function fitPlaneForVertices(vertices: Vec3[]): PlaneFit | null {
  if (vertices.length < 3) return null;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    nx += (current[1] - next[1]) * (current[2] + next[2]);
    ny += (current[2] - next[2]) * (current[0] + next[0]);
    nz += (current[0] - next[0]) * (current[1] + next[1]);
    px += current[0];
    py += current[1];
    pz += current[2];
  }
  const normal = normalizeVec([nx, ny, nz]);
  if (!normal) return null;
  return {
    normal,
    point: [px / vertices.length, py / vertices.length, pz / vertices.length],
  };
}

function isConvexPolygon(vertices: Vec3[], normal: Vec3): boolean {
  let sign = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const c = vertices[(i + 2) % vertices.length];
    const turn = dotVec(crossVec(subVec(b, a), subVec(c, b)), normal);
    if (Math.abs(turn) <= 1e-9) continue;
    const nextSign = turn > 0 ? 1 : -1;
    if (sign === 0) sign = nextSign;
    else if (sign !== nextSign) return false;
  }
  return true;
}

function normalizeGeometryForMerge(
  polygons: Polygon[],
  options: ResolvedGeometryNormalizeOptions,
  cache?: PreprocessCache,
): Polygon[] {
  const snapped = snappedPolygonsForMerge(polygons, cache);
  const planeEpsilon = planeFitEpsilon(snapped, options);
  if (planeEpsilon <= 0) return snapped;

  const metas = snapped.map((polygon): PlaneNormalizeMeta | null => {
    const plane = planeOfPolygon(polygon);
    if (!plane) return null;
    return {
      polygon,
      normal: plane.normal,
      area: plane.area,
      materialKey: materialKeyForPolygon(polygon),
    };
  });
  const adjacency = buildMergeAdjacency(snapped, metas);
  const assigned = new Set<number>();
  const output: Array<Polygon | undefined> = Array(snapped.length);
  const vertexMoves: VertexPositionMove[] = [];
  const writeOutput = (index: number, polygon: Polygon): void => {
    output[index] = polygon;
  };

  for (let i = 0; i < snapped.length; i++) {
    const meta = metas[i];
    if (assigned.has(i)) continue;
    if (!meta) {
      writeOutput(i, snapped[i]);
      continue;
    }

    const group = growPlaneGroup(i, metas, adjacency, assigned, planeEpsilon, options);
    for (const index of group) assigned.add(index);
    if (group.length < 2) {
      writeOutput(i, snapped[i]);
      continue;
    }

    const replacements = choosePlaneGroupReplacements(group, snapped, metas, adjacency, planeEpsilon, options);
    vertexMoves.push(...replacements.vertexMoves);
    for (const index of group) {
      writeOutput(index, replacements.polygons.get(index) ?? snapped[index]);
    }
  }

  const projected = output.flatMap((polygon) => polygon ? [polygon] : []);
  const moved = vertexMoves.length > 0
    ? applyVertexPositionMoves(projected, averagedVertexPositionMoves(vertexMoves))
    : projected;
  return snapGeometryForMerge(moved);
}

function snapGeometryForMerge(polygons: Polygon[]): Polygon[] {
  const geometryEpsilon = geometrySnapEpsilon(polygons);
  const uvEpsilon = 1e-4;
  if (geometryEpsilon <= 0) return polygons;

  const vertices = createVec3Snapper(geometryEpsilon);
  const uvs = createVec2Snapper(uvEpsilon);
  let anyChanged = false;

  const snapped = polygons.map((polygon) => {
    let changed = false;
    const snapVertex = (vertex: Vec3): Vec3 => {
      const next = vertices.snap(vertex);
      if (!eqVec(next, vertex)) changed = true;
      return next;
    };
    const snappedVertices = polygon.vertices.map(snapVertex);
    const snappedUvs = polygon.uvs && polygon.uvs.length === polygon.vertices.length
      ? polygon.uvs.map((uv) => {
        const next = uvs.snap(uv);
        if (!eqUv(next, uv)) changed = true;
        return next;
      })
      : undefined;
    const snappedTextureTriangles = mapTextureTriangleVertices(polygon.textureTriangles, snapVertex);
    if (!changed && !polygon.texture) return polygon;
    const snappedPolygon: Polygon = {
      ...polygon,
      vertices: snappedVertices,
      ...(snappedUvs ? { uvs: snappedUvs } : {}),
      ...(snappedTextureTriangles ? { textureTriangles: snappedTextureTriangles } : {}),
    };
    anyChanged = true;
    return {
      ...snappedPolygon,
      ...(snappedPolygon.texture
        ? { textureTriangles: textureTrianglesForPolygon(snappedPolygon) }
        : {}),
    };
  });
  return anyChanged ? snapped : polygons;
}

function textureTrianglesForPolygon(polygon: Polygon): TextureTriangle[] | undefined {
  if (!polygon.texture) return undefined;
  if (polygon.textureTriangles?.length) return cloneTextureTriangles(polygon.textureTriangles);
  if (polygon.uvs && polygon.uvs.length === polygon.vertices.length) {
    return fanTextureTriangles(polygon.vertices, polygon.uvs);
  }
  return undefined;
}

function textureTrianglesForPolygons(polygons: Polygon[]): TextureTriangle[] | undefined {
  const triangles = polygons.flatMap((polygon) => textureTrianglesForPolygon(polygon) ?? []);
  return triangles.length > 0 ? triangles : undefined;
}

function fanTextureTriangles(vertices: Vec3[], uvs: Vec2[]): TextureTriangle[] {
  const triangles: TextureTriangle[] = [];
  for (let i = 1; i < vertices.length - 1; i++) {
    triangles.push({
      vertices: [
        [...vertices[0]] as Vec3,
        [...vertices[i]] as Vec3,
        [...vertices[i + 1]] as Vec3,
      ],
      uvs: [
        [...uvs[0]] as Vec2,
        [...uvs[i]] as Vec2,
        [...uvs[i + 1]] as Vec2,
      ],
    });
  }
  return triangles;
}

function cloneTextureTriangles(triangles: TextureTriangle[]): TextureTriangle[] {
  return triangles.map((triangle) => ({
    vertices: triangle.vertices.map((vertex) => [...vertex] as Vec3) as [Vec3, Vec3, Vec3],
    uvs: triangle.uvs.map((uv) => [...uv] as Vec2) as [Vec2, Vec2, Vec2],
  }));
}

function mapTextureTriangleVertices(
  triangles: TextureTriangle[] | undefined,
  mapVertex: (vertex: Vec3) => Vec3,
): TextureTriangle[] | undefined {
  if (!triangles?.length) return undefined;
  return triangles.map((triangle) => ({
    vertices: triangle.vertices.map(mapVertex) as [Vec3, Vec3, Vec3],
    uvs: triangle.uvs.map((uv) => [...uv] as Vec2) as [Vec2, Vec2, Vec2],
  }));
}

function choosePlaneGroupReplacements(
  group: number[],
  polygons: Polygon[],
  metas: Array<PlaneNormalizeMeta | null>,
  adjacency: Map<number, Set<number>>,
  planeEpsilon: number,
  options: ResolvedGeometryNormalizeOptions,
): PlaneGroupReplacements {
  const fullGroup = projectedPlanePatchCandidate(group, polygons, metas, planeEpsilon, options);
  if (fullGroup) return replacementsForPlanePatch(fullGroup);
  return splitPlaneGroupIntoWinningPatches(group, polygons, metas, adjacency, planeEpsilon, options);
}

function splitPlaneGroupIntoWinningPatches(
  group: number[],
  polygons: Polygon[],
  metas: Array<PlaneNormalizeMeta | null>,
  adjacency: Map<number, Set<number>>,
  planeEpsilon: number,
  options: ResolvedGeometryNormalizeOptions,
): PlaneGroupReplacements {
  const groupSet = new Set(group);
  const candidates: PlanePatchCandidate[] = [];
  for (const a of group) {
    for (const b of adjacency.get(a) ?? []) {
      if (a >= b || !groupSet.has(b)) continue;
      const candidate = projectedPlanePatchCandidate([a, b], polygons, metas, planeEpsilon, options);
      if (candidate) candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const used = new Set<number>();
  const replacements = new Map<number, Polygon>();
  const vertexMoves: VertexPositionMove[] = [];
  for (const candidate of candidates) {
    if (candidate.indices.some((index) => used.has(index))) continue;
    vertexMoves.push(...candidate.vertexMoves);
    for (let i = 0; i < candidate.indices.length; i++) {
      const index = candidate.indices[i];
      used.add(index);
      replacements.set(index, polygons[index]);
    }
  }
  return { polygons: replacements, vertexMoves };
}

function replacementsForPlanePatch(candidate: PlanePatchCandidate): PlaneGroupReplacements {
  const replacements = new Map<number, Polygon>();
  for (let i = 0; i < candidate.indices.length; i++) {
    replacements.set(candidate.indices[i], candidate.source[i]);
  }
  return { polygons: replacements, vertexMoves: candidate.vertexMoves };
}

function projectedPlanePatchCandidate(
  group: number[],
  polygons: Polygon[],
  metas: Array<PlaneNormalizeMeta | null>,
  planeEpsilon: number,
  options: ResolvedGeometryNormalizeOptions,
): PlanePatchCandidate | null {
  const fit = fitPlaneForGroup(group, metas);
  if (!fit || !groupWithinPlaneBudget(group, metas, fit, planeEpsilon, options)) return null;

  const source = group.map((index) => polygons[index]);
  const projected = source.map((polygon) => projectPolygonToPlane(polygon, fit));
  const sourceCost = polygonRenderCost(mergePolygons(source));
  const projectedCost = polygonRenderCost(mergePolygons(projected));
  if (projectedCost >= sourceCost) return null;
  return {
    indices: group,
    source,
    projected,
    vertexMoves: vertexPositionMovesForProjection(source, projected),
    score: sourceCost - projectedCost,
  };
}

function planeFitEpsilon(
  polygons: Polygon[],
  options: ResolvedGeometryNormalizeOptions,
): number {
  const geometryEpsilon = geometrySnapEpsilon(polygons);
  if (geometryEpsilon <= 0) return 0;
  return options.maxPlaneDisplacement;
}

function geometrySnapEpsilon(polygons: Polygon[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const polygon of polygons) {
    for (const [x, y, z] of polygon.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }

  if (!Number.isFinite(minX)) return 0;
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  if (diagonal <= 0) return 0;
  return Math.min(0.025, Math.max(0.0001, diagonal * 0.00025));
}

function createVec3Snapper(epsilon: number) {
  const buckets = new Map<string, Vec3[]>();
  const cell = (value: number) => Math.floor(value / epsilon);
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

  return {
    snap(input: Vec3): Vec3 {
      const cx = cell(input[0]);
      const cy = cell(input[1]);
      const cz = cell(input[2]);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const bucket = buckets.get(key(cx + dx, cy + dy, cz + dz));
            if (!bucket) continue;
            for (const candidate of bucket) {
              if (distanceVec(input, candidate) <= epsilon) {
                return [candidate[0], candidate[1], candidate[2]];
              }
            }
          }
        }
      }

      const snapped: Vec3 = [input[0], input[1], input[2]];
      const bucketKey = key(cx, cy, cz);
      const bucket = buckets.get(bucketKey);
      if (bucket) bucket.push(snapped);
      else buckets.set(bucketKey, [snapped]);
      return snapped;
    },
  };
}

function createVec2Snapper(epsilon: number) {
  const buckets = new Map<string, Vec2[]>();
  const cell = (value: number) => Math.floor(value / epsilon);
  const key = (x: number, y: number) => `${x},${y}`;

  return {
    snap(input: Vec2): Vec2 {
      const cx = cell(input[0]);
      const cy = cell(input[1]);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = buckets.get(key(cx + dx, cy + dy));
          if (!bucket) continue;
          for (const candidate of bucket) {
            if (Math.hypot(input[0] - candidate[0], input[1] - candidate[1]) <= epsilon) {
              return [candidate[0], candidate[1]];
            }
          }
        }
      }

      const snapped: Vec2 = [input[0], input[1]];
      const bucketKey = key(cx, cy);
      const bucket = buckets.get(bucketKey);
      if (bucket) bucket.push(snapped);
      else buckets.set(bucketKey, [snapped]);
      return snapped;
    },
  };
}

function materialKeyForPolygon(polygon: Polygon): string {
  return [
    polygon.color ?? "#cccccc",
    polygon.texture ?? "",
    polygon.texture && polygon.textureWrap ? `${polygon.textureWrap.s}/${polygon.textureWrap.t}` : "",
    polygon.texture && polygon.textureAlphaMode ? polygon.textureAlphaMode : "",
    polygon.uvs ? "uv" : "plain",
    polygon.doubleSided === true ? "double-sided" : "single-sided",
  ].join("|");
}

function planeOfPolygon(polygon: Polygon): { normal: Vec3; area: number } | null {
  const vertices = polygon.vertices;
  if (!vertices || vertices.length < 3) return null;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  const origin = vertices[0];
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = subVec(vertices[i], origin);
    const b = subVec(vertices[i + 1], origin);
    const cross = crossVec(a, b);
    nx += cross[0];
    ny += cross[1];
    nz += cross[2];
  }

  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-10) return null;
  return {
    normal: [nx / len, ny / len, nz / len],
    area: len / 2,
  };
}

function buildMergeAdjacency(
  polygons: Polygon[],
  metas: Array<PlaneNormalizeMeta | null>,
): Map<number, Set<number>> {
  const edgeOwners = new Map<string, number[]>();
  const adjacency = new Map<number, Set<number>>();

  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    if (!metas[i] || polygon.vertices.length < 3) continue;
    for (let j = 0; j < polygon.vertices.length; j++) {
      const key = edgeKey(polygon.vertices[j], polygon.vertices[(j + 1) % polygon.vertices.length]);
      const owners = edgeOwners.get(key);
      if (owners) owners.push(i);
      else edgeOwners.set(key, [i]);
    }
  }

  for (const owners of edgeOwners.values()) {
    for (let a = 0; a < owners.length; a++) {
      for (let b = a + 1; b < owners.length; b++) {
        const ai = owners[a];
        const bi = owners[b];
        if (canShareMergePatch(polygons[ai], polygons[bi], metas[ai], metas[bi])) {
          addAdjacency(adjacency, ai, bi);
          addAdjacency(adjacency, bi, ai);
        }
      }
    }
  }

  return adjacency;
}

function canShareMergePatch(
  a: Polygon,
  b: Polygon,
  aMeta: PlaneNormalizeMeta | null,
  bMeta: PlaneNormalizeMeta | null,
): boolean {
  if (!aMeta || !bMeta) return false;
  if (aMeta.materialKey !== bMeta.materialKey) return false;
  if (!!a.uvs !== !!b.uvs) return false;
  if (hasTextureMergeState(a) || hasTextureMergeState(b)) return canUseTexturedLossyMerge(a, b);
  if (!a.uvs || !b.uvs) return true;

  const shared = sharedEdgeIndices(a, b);
  if (!shared) return false;
  const [ai0, ai1, bi0, bi1] = shared;
  return eqUv(a.uvs[ai0], b.uvs[bi0]) && eqUv(a.uvs[ai1], b.uvs[bi1]);
}

function canApproximatePairMerge(
  a: Polygon,
  b: Polygon,
  aMeta: PlaneNormalizeMeta,
  bMeta: PlaneNormalizeMeta,
): boolean {
  if (aMeta.materialKey !== bMeta.materialKey) return false;
  if (hasTextureMergeState(a) || hasTextureMergeState(b)) return canUseTexturedLossyMerge(a, b);
  return !a.uvs && !b.uvs && !a.textureTriangles?.length && !b.textureTriangles?.length;
}

function hasTextureMergeState(polygon: Polygon): boolean {
  return Boolean(polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length);
}

function canUseTexturedLossyMerge(a: Polygon, b: Polygon): boolean {
  if (!a.texture || !b.texture || a.texture !== b.texture) return false;
  if ((a.textureWrap?.s ?? "") !== (b.textureWrap?.s ?? "")) return false;
  if ((a.textureWrap?.t ?? "") !== (b.textureWrap?.t ?? "")) return false;
  if ((a.textureAlphaMode ?? "") !== (b.textureAlphaMode ?? "")) return false;
  if (a.material?.texture || b.material?.texture) return false;
  if (!a.uvs || !b.uvs) return false;
  if (a.uvs.length !== a.vertices.length || b.uvs.length !== b.vertices.length) return false;

  const shared = sharedEdgeIndices(a, b);
  if (!shared) return false;
  const [ai0, ai1, bi0, bi1] = shared;
  return eqUv(a.uvs[ai0], b.uvs[bi0]) && eqUv(a.uvs[ai1], b.uvs[bi1]);
}

function addAdjacency(adjacency: Map<number, Set<number>>, from: number, to: number): void {
  const values = adjacency.get(from);
  if (values) values.add(to);
  else adjacency.set(from, new Set([to]));
}

function growPlaneGroup(
  seed: number,
  metas: Array<PlaneNormalizeMeta | null>,
  adjacency: Map<number, Set<number>>,
  assigned: Set<number>,
  planeEpsilon: number,
  options: ResolvedGeometryNormalizeOptions,
): number[] {
  const group = [seed];
  const queued = new Set([seed]);
  const queue = [seed];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (assigned.has(next) || queued.has(next)) continue;
      const nextMeta = metas[next];
      const seedMeta = metas[seed];
      if (!nextMeta || !seedMeta) continue;
      if (nextMeta.materialKey !== seedMeta.materialKey) continue;
      if (!canJoinPlaneGroup([...group, next], metas, planeEpsilon, options)) continue;
      group.push(next);
      queued.add(next);
      queue.push(next);
    }
  }

  return group;
}

function canJoinPlaneGroup(
  group: number[],
  metas: Array<PlaneNormalizeMeta | null>,
  planeEpsilon: number,
  options: ResolvedGeometryNormalizeOptions,
): boolean {
  const fit = fitPlaneForGroup(group, metas);
  return !!fit && groupWithinPlaneBudget(group, metas, fit, planeEpsilon, options);
}

function fitPlaneForGroup(
  group: number[],
  metas: Array<PlaneNormalizeMeta | null>,
): PlaneFit | null {
  const seed = metas[group[0]];
  if (!seed) return null;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  let weightSum = 0;

  for (const index of group) {
    const meta = metas[index];
    if (!meta) return null;
    const direction = dotVec(seed.normal, meta.normal) < 0 ? -1 : 1;
    const weight = Math.max(meta.area, 1e-6);
    nx += meta.normal[0] * direction * weight;
    ny += meta.normal[1] * direction * weight;
    nz += meta.normal[2] * direction * weight;
    for (const vertex of meta.polygon.vertices) {
      px += vertex[0];
      py += vertex[1];
      pz += vertex[2];
      weightSum += 1;
    }
  }

  const normal = normalizeVec([nx, ny, nz]);
  if (!normal || weightSum === 0) return null;
  const boundaryVertices = groupBoundaryVertexKeys(group, metas);
  const boundaryD = planeOffsetRangeForVertices(group, metas, normal, boundaryVertices);
  if (boundaryD) {
    const d = (boundaryD.min + boundaryD.max) / 2;
    return {
      normal,
      point: [normal[0] * d, normal[1] * d, normal[2] * d],
      boundaryVertexKeys: boundaryVertices,
    };
  }

  return {
    normal,
    point: [px / weightSum, py / weightSum, pz / weightSum],
    boundaryVertexKeys: boundaryVertices,
  };
}

function planeOffsetRangeForVertices(
  group: number[],
  metas: Array<PlaneNormalizeMeta | null>,
  normal: Vec3,
  vertexKeys: Set<string>,
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;

  for (const index of group) {
    const meta = metas[index];
    if (!meta) continue;
    for (const vertex of meta.polygon.vertices) {
      if (!vertexKeys.has(vertexKey(vertex))) continue;
      const d = dotVec(vertex, normal);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
  }

  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function groupWithinPlaneBudget(
  group: number[],
  metas: Array<PlaneNormalizeMeta | null>,
  fit: PlaneFit,
  planeEpsilon: number,
  options: ResolvedGeometryNormalizeOptions,
): boolean {
  const normalDotMin = Math.cos((options.maxAngleDeg * Math.PI) / 180);
  const boundaryVertices = fit.boundaryVertexKeys ?? groupBoundaryVertexKeys(group, metas);
  for (const index of group) {
    const meta = metas[index];
    if (!meta) return false;
    if (Math.abs(dotVec(meta.normal, fit.normal)) < normalDotMin) return false;
    for (const vertex of meta.polygon.vertices) {
      const limit = boundaryVertices.has(vertexKey(vertex))
        ? options.maxBoundaryDisplacement
        : planeEpsilon;
      if (Math.abs(signedPlaneDistance(vertex, fit)) > limit) return false;
    }
  }
  return true;
}

function groupBoundaryVertexKeys(
  group: number[],
  metas: Array<PlaneNormalizeMeta | null>,
): Set<string> {
  const edgeCounts = new Map<string, { count: number; a: Vec3; b: Vec3 }>();

  for (const index of group) {
    const meta = metas[index];
    if (!meta) continue;
    const vertices = meta.polygon.vertices;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      const key = edgeKey(a, b);
      const current = edgeCounts.get(key);
      if (current) current.count += 1;
      else edgeCounts.set(key, { count: 1, a, b });
    }
  }

  const boundary = new Set<string>();
  for (const edge of edgeCounts.values()) {
    if (edge.count !== 1) continue;
    boundary.add(vertexKey(edge.a));
    boundary.add(vertexKey(edge.b));
  }
  return boundary;
}

function projectPolygonToPlane(polygon: Polygon, fit: PlaneFit): Polygon {
  const projectVertex = (vertex: Vec3): Vec3 => projectVecToPlane(vertex, fit);
  const textureTriangles = mapTextureTriangleVertices(polygon.textureTriangles, projectVertex);
  return {
    ...polygon,
    vertices: polygon.vertices.map(projectVertex),
    ...(textureTriangles ? { textureTriangles } : {}),
  };
}

function sharedEdgeIndices(a: Polygon, b: Polygon): [number, number, number, number] | null {
  for (let ai0 = 0; ai0 < a.vertices.length; ai0++) {
    const ai1 = (ai0 + 1) % a.vertices.length;
    for (let bi0 = 0; bi0 < b.vertices.length; bi0++) {
      const bi1 = (bi0 + 1) % b.vertices.length;
      if (eqVec(a.vertices[ai0], b.vertices[bi0]) && eqVec(a.vertices[ai1], b.vertices[bi1])) {
        return [ai0, ai1, bi0, bi1];
      }
      if (eqVec(a.vertices[ai0], b.vertices[bi1]) && eqVec(a.vertices[ai1], b.vertices[bi0])) {
        return [ai0, ai1, bi1, bi0];
      }
    }
  }
  return null;
}

function edgeKey(a: Vec3, b: Vec3): string {
  const ak = vertexKey(a);
  const bk = vertexKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function vertexKey(vertex: Vec3): string {
  return `${vertex[0]},${vertex[1]},${vertex[2]}`;
}

function eqVec(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function eqUv(a: Vec2, b: Vec2): boolean {
  return Math.abs(a[0] - b[0]) <= 1e-4 && Math.abs(a[1] - b[1]) <= 1e-4;
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dotVec(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function distanceVec(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function normalizeVec(value: Vec3): Vec3 | null {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= 1e-10) return null;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function signedPlaneDistance(vertex: Vec3, fit: PlaneFit): number {
  return dotVec(subVec(vertex, fit.point), fit.normal);
}

function projectVecToPlane(vertex: Vec3, fit: PlaneFit): Vec3 {
  const distance = signedPlaneDistance(vertex, fit);
  return [
    vertex[0] - fit.normal[0] * distance,
    vertex[1] - fit.normal[1] * distance,
    vertex[2] - fit.normal[2] * distance,
  ];
}
