// Read-only routine readiness, version observations and explicit evaluation cases shared by host, tools and UI.
export interface RoutineCheck { id: string; stepId?: string; state: 'pass' | 'fail' | 'unknown' | 'user'; detail: string }
export interface RoutineReadiness { flowId: string; version: number; digest: string; at: number; checks: RoutineCheck[]; ready: boolean; coverage: string[] }
export interface RoutineVersionStats { version: number; digest: string; runs: number; completed: number; blocked: number; cancelled: number; skipped: number; needsHuman: number; retries: number; observedDecisions: number; terminalElapsedMs: number | null; completeEvidence: number }
export interface RoutineComparison { flowId: string; versions: RoutineVersionStats[]; comparableSubjects: number; caveats: string[] }
export interface RoutineEvalCase { id: string; subjectKey: string; expected: 'completed' | 'needs-human' | 'skipped' | 'blocked'; evidence: { stepId: string; label: string }[]; split: 'tuning' | 'holdout' }
export interface RoutineEvalSuite { id: string; flowId: string; cases: RoutineEvalCase[]; digest: string; createdAt: number }
export interface RoutineEvalResult { suiteId: string; suiteDigest: string; flowVersion: number; definitionDigest: string; at: number; cases: { id: string; split: 'tuning' | 'holdout'; state: 'pass' | 'fail' | 'unknown'; runId?: string; reasons: string[] }[]; coverage: string[] }
export type RoutineWorkbenchRequest = { op: 'readiness'; flowId: string; version: number; inputs?: Record<string, string> } | { op: 'compare'; flowId: string } | { op: 'suites'; flowId: string } | { op: 'suite-save'; suite: Omit<RoutineEvalSuite, 'digest' | 'createdAt'> } | { op: 'evaluate'; suiteId: string; version: number };
export interface RoutineWorkbenchResult { readiness?: RoutineReadiness; comparison?: RoutineComparison; suites?: RoutineEvalSuite[]; evaluation?: RoutineEvalResult }
