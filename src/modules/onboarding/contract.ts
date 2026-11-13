// Onboarding's public boundary, consumed by the main host and both renderer entry points.
export type Harness = 'claude' | 'codex' | 'cursor';
export type Provider = 'github' | 'azure' | 'jira';
export interface Evidence { kind: 'workspace' | 'repo' | 'cli' | 'config'; path: string; source: string; checkedAt: string; remoteHosts?: string[]; login: 'unknown' }
export interface Discovery { evidence: Evidence[]; limited: boolean; skipped: number }
export interface Request { project: string; provider: Provider; harnesses: Harness[]; organization?: string }
export interface Change { harness: Harness; path: string; beforeHash: string; diff: string }
export interface Plan { id: string; provider: Provider; project: string; changes: Change[]; pending: string[]; endpoint: string; login: 'official-harness'; catalogVersion: string }
export interface Connection { harness: Harness; status: 'pending' | 'verified' | 'failed'; checkedAt: string; detail: string }
export interface Applied { id: string; project: string; provider: Provider; connections: Connection[] }
export interface OnboardingPort {
  current(): Promise<Applied | null>;
  discover(): Promise<Discovery>;
  prepare(request: Request): Promise<Plan>;
  apply(planId: string): Promise<Applied>;
  undo(operationId: string): Promise<void>;
  test(operationId: string): Promise<Connection[]>;
}
