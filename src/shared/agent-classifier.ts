// Advisory routing results shared by the local scorer, MCP discovery and the start dialog; never permissions.
export interface AgentCandidate {
  id: string;
  score: number;
  why: { field: 'name' | 'whenToUse' | 'purpose' | 'instructions' | 'pastRun'; runId?: string };
}
export interface AgentClassification {
  candidates: AgentCandidate[];
  mode: 'hybrid' | 'words';
  threshold: number;
  noneCloseEnough: boolean;
  proposal: 'ask-user-to-create' | null;
}

export type ClassifierMode = AgentClassification['mode'];
/** The starting thresholds per channel. hybrid: never measured on the real model (multilingual-e5's cosine sits in
 *  0.7–1.0 even for unrelated texts, so only the user's own confirmed runs can place it); words: the best cut on the
 *  hand-labelled requests of test/fixtures/classifiers (its scores are lower: four matched topic words are full marks). */
export const DEFAULT_CLASSIFIER_THRESHOLDS: Readonly<Record<ClassifierMode, number>> = { hybrid: 60, words: 20 };
/** Fewest confirmed runs of one channel before a threshold is suggested (below it the quantile is mostly noise). */
export const CALIBRATION_MIN_RUNS = 20;
/** Share of confirmed right matches a suggested threshold may leave below it (split conformal, α = 0.1). */
export const CALIBRATION_ALPHA = 0.1;
/** How one channel's threshold stands against the user's confirmed runs (agents/classifier-calibration.ts). */
export interface ClassifierCalibration {
  mode: ClassifierMode;
  /** in force now: the approved value, else the default */
  threshold: number;
  defaultThreshold: number;
  /** the user's approved value; null = default */
  approved: number | null;
  /** confirmed successful runs of a routable specialist that this channel scored */
  n: number;
  /** share of those runs where that agent ranked first; null = no runs */
  rank1: number | null;
  /** share of those runs at or above the threshold in force, and at or above the suggested one */
  coverageNow: number | null;
  coverageSuggested: number | null;
  /** null = fewer than CALIBRATION_MIN_RUNS runs */
  suggested: number | null;
  /** a suggestion worth a decision: far enough from the threshold in force and not dismissed for this value */
  pending: boolean;
}
export type ClassifierDecision = { mode: ClassifierMode; decision: 'apply'; value: number } | { mode: ClassifierMode; decision: 'dismiss'; value: number } | { mode: ClassifierMode; decision: 'reset' };
