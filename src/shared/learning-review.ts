// Host-owned memory evidence and evaluation review DTOs shared by IPC, Brain review panels and offline tests.
// Imported datasets carry cases only: run evidence and promotion eligibility always come from the host stores.
import type { AgentRunOutcome, AgentRunReport } from './agents';

export interface LearningEvidenceRun { runId: string; agentId: string; goal: string; startedAt: number; endedAt?: number; reviewOf?: string; outcome?: AgentRunOutcome; report?: AgentRunReport }
export interface LearningEvidence { run: LearningEvidenceRun; reviews: LearningEvidenceRun[] }

export interface MemoryReviewScope { roleId: string; userId?: string; project?: string; repository?: string; environment?: string }
export type MemoryReviewStatus = 'observed' | 'proposed' | 'confirmed' | 'disputed' | 'retracted';
export interface MemoryReviewRecord {
  memoryId: string; scope: MemoryReviewScope; subject: string; predicate: string; value: string;
  sourceEventId: string; sourceRunId: string; observedAt: string; validFrom: string; validTo: string | null;
  status: MemoryReviewStatus; supersedes: string | null;
  verification?: { sourceEventId: string; sourceRunId: string; evidence: string };
  transitions?: { at: string; status: MemoryReviewStatus; reason?: string }[];
  derivedFiles?: string[];
}
export interface EvaluationCase { id: string; family: string; input: string; criteria: string[]; split: 'tuning' | 'holdout' }
export interface EvaluationDataset { id: string; name: string; origin: 'synthetic' | 'anonymized'; anonymized: true; cases: EvaluationCase[]; digest: string; createdAt: number }
export interface ReplayCaseResult { caseId: string; runId?: string; error?: string; passed: boolean | null }
export interface ReplayRecord {
  id: string; datasetId: string; datasetDigest: string; split: 'tuning' | 'holdout'; candidate?: { name: string; digest: string };
  startedAt: number; finishedAt?: number; status: 'running' | 'awaiting-review' | 'passed' | 'failed'; cases: ReplayCaseResult[];
}
export interface SkillCandidateView {
  name: string; text: string; digest: string; stepsReady: boolean; sourceRunIds: string[]; verifiedExampleRunIds: string[];
  eligibleReplayIds: string[]; promotionProblems: string[]; promoted: boolean;
}
export interface LearningReviewState { datasets: EvaluationDataset[]; replays: ReplayRecord[]; candidates: SkillCandidateView[]; replayAvailable: boolean }
export interface EvaluationMeasure { value: number | null; n: number; total: number }
export interface EvaluationSummary {
  tasks: number; quality: EvaluationMeasure; turns: EvaluationMeasure; costUsd: EvaluationMeasure; elapsedMs: EvaluationMeasure;
  tokens: { input: EvaluationMeasure; output: EvaluationMeasure; cacheRead: EvaluationMeasure; cacheWrite: EvaluationMeasure };
}
export interface ReplayComparison { before: EvaluationSummary; after: EvaluationSummary; pairedCases: number; comparable: boolean; note: string }
