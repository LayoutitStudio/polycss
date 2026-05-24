export type SeamOverlapCandidateKind = "true-gap" | "connected-facet" | "material-boundary";

export interface SeamOverlapCandidate { kind: SeamOverlapCandidateKind; aPolygon: number; aEdge: number; bPolygon: number; bEdge: number; aColor?: string; bColor?: string; aMaterialKey: string; bMaterialKey: string; gapPx: number; spanPx: number; aStartPx: number; aEndPx: number; bStartPx: number; bEndPx: number; targetClosurePx: number; appliedClosurePx: number; residualGapPx: number; residualTargetPx: number; }

export interface SeamOverlapDiagnostics { exactPairs: number; nearPairs: number; patchedPolygons: number; patchedEdges: number; maxMeasuredGapPx: number; maxAppliedAmountPx: number; unclosedPairs: number; maxResidualGapPx: number; }

export interface SeamOverlapOptions { overlapPx?: number; maxGapPx?: number; capacityScale?: number; }

export interface SeamFacetSplitOptions { rotX?: number; rotY?: number; viewAware?: boolean; passes?: number; budget?: number; }

export type SeamFacetSplitCandidateReason = "component-anchor" | "global-outlier" | "local-follow-up" | "shared-polygon" | "below-threshold";

export interface SeamFacetSplitCandidate { key: string; aPolygon: number; aEdge: number; bPolygon: number; bEdge: number; color?: string; materialKey: string; lengthPx: number; projectedLengthPx: number; score: number; normalRisk: number; shapeRisk: number; viewRisk: number; component: number; marginalCost: number; selected: boolean; reason: SeamFacetSplitCandidateReason; }

export interface SeamFacetSplitReport { candidates: SeamFacetSplitCandidate[]; selectedPolygons: number; selectedEdges: number; addedPolygons: number; }
