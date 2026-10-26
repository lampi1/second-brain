// Versioned reusable flow contracts shared by the host, Orchestrator tools and the decision UI.
// Definitions describe work; only host evidence and exact user decisions advance execution.
import type { FlowAutomationSnapshot, FlowAutomationConfig } from './flow-automation';
import type { AgentAvatar } from './agents';
import type { ModelTier, WorkRoleId } from './roles';
import type { Effort } from './contract';
export interface FlowScope { project?: string; areaPath?: string }
export interface FlowStep {
  id: string; title: string; kind: 'check' | 'agent' | 'approval' | 'manual'; instructions: string;
  /** Approved complete role prompt. Packaged workers do not load ambient brain memory or skills. */
  agentPrompt?: string;
  /** Package asset ids this step may read; their exact contents ship with this version. */
  assets?: string[];
  inputs: string[]; action?: { kind: 'builtin' | 'script' | 'query' | 'action'; ref: string; hash?: string };
  evidence: string[]; timeoutMs: number; maxAttempts: number;
  effect: 'read-only' | 'code' | 'external-write' | 'production'; reviewOf?: string; workspaceInput?: string;
  /** A host-controlled adapter, authorized by the exact automatic-flow grant. */
  adapter?: 'devops-write' | 'test-db-read';
  /** Exact-version approval for this step only; never a production grant. */
  writeVia?: 'browser'; browserTargets?: string[];
  /** Explicit test DB read capability; may accompany a DevOps write adapter, with both grants required. */
  testDbRead?: true;
  /** Hold the exact approved test environment for this step, including BEFORE/AFTER checks. */
  testEnvironment?: string;
  /** An agent step's role: the bound chat must run it. Absent = the Orchestrator picks the role. */
  role?: WorkRoleId;
  /** An agent step's model tier (at most the role's tierMax; needs role): the bound chat must run on it. Absent = the role's own choice. */
  tier?: ModelTier;
  /** The user's pick for experiments (needs role): the engine and model this agent step runs on, over the role's own
   *  (ADR 0155). Absent = the role's engine and the tier's model. */
  engine?: string; model?: string; effort?: Effort;
  /** What the runner does when this step fails and attempts remain: retry itself (default) or send the work back to an
   *  earlier step with the failure as its feedback. Only the last failure needs the user (ADR 0155). */
  onFail?: { goto: string };
  /** The environment a script/query step targets: a prod step never runs by itself, the user clicks «Esegui». */
  env?: 'test' | 'prod';
  /** script/query arguments: name → literal or {{param}} / {{input}} / {{attachment:name}} placeholders */
  args?: Record<string, string>;
}
/** A typed run parameter, validated before the run starts (ADR 0155). */
export interface FlowParam {
  name: string; label?: string; type: 'string' | 'int' | 'list' | 'file' | 'enum' | 'env';
  options?: string[]; required?: boolean; default?: string;
}
export interface FlowAsset {
  id: string; kind: 'script' | 'query' | 'checklist' | 'reference'; content: string; sha256: string;
  /** Authoring provenance only; never resolved at runtime. */
  source?: { path: string; sha256: string };
}
export interface FlowOutput {
  id: string; description: string; kind: 'lesson' | 'report';
  /** An explicit append-only brain projection; otherwise the output stays in the run. */
  brainPath?: string;
}
/** Portable production intent. It is a design contract, not an execution grant. */
export interface RoutineProductionIntent {
  id: string; operation: 'db-read' | 'db-write' | 'deploy'; targetId: string;
  recipeAssetId: string; recipeSha256: string; timeoutMs: number;
  maxRows?: number; maxAffectedRows?: number; rollbackAssetId?: string;
}
export interface FlowPackage {
  schema: 1; assets: FlowAsset[]; outputs: FlowOutput[];
  production?: RoutineProductionIntent[];
  /** Required operation names are intent, never authority: automation approval grants them separately. */
  requiredOps: string[];
  history?: true;
  /** First agent must call flow_intake before any external write; skip stays silent. */
  intake?: true;
  downgrade?: { lessonOutput: string; removeTag: string; addTag: string; state: string };
}
export interface FlowDefinition {
  id: string; title: string; description: string; category?: string; aliases: string[];
  scope: FlowScope; steps: FlowStep[];
  /** typed parameters the user gives at start (or a trigger fills); steps read them as {{name}} */
  params?: FlowParam[];
  package?: FlowPackage;
}
export interface FlowDraft {
  definition: FlowDefinition; revision: number; updatedAt: number;
  status: 'proposed' | 'rejected' | 'active'; feedback?: string;
}
export interface FlowVersion { definition: FlowDefinition; version: number; draftRevision: number; digest: string; activatedAt: number }
export interface FlowReceipt {
  id: string; stepId: string; kind: 'check' | 'agent-report' | 'user'; at: number;
  summary: string; chatId?: string; reportId?: string; evidence: string[];
}
export interface FlowAgentBinding { chatId: string; chatRunId: string; taskVersion: number;
  /** What the host read from the chat at bind (never stored): its role, the tier it launched on, whether its model came from the routing table's row instead of that tier. */
  launched?: { roleId?: string; tier?: ModelTier; fromTable?: boolean; packageDigest?: string; promptHash?: string; engine?: string; model?: string | null; effort?: string } }
export interface FlowVerifiedReport extends FlowAgentBinding { id: string; summary: string; evidence: string[]; completed: boolean; roleId?: string; reviewOf?: string }
export interface FlowStepRun {
  stepId: string; status: 'pending' | 'ready' | 'running' | 'approval' | 'blocked' | 'completed' | 'cancelled';
  attempts: number; startedAt?: number; chatId?: string; chatRunId?: string; taskVersion?: number;
  historyText?: string;
  reason?: string; receipt?: FlowReceipt; decisionPending?: boolean;
}
/** Durable query evidence. Never stores raw SQL, credentials, raw driver errors or database result rows. */
export interface FlowTestDbEvidence {
  id: string; runId: string; stepId: string; chatRunId: string; taskVersion: number; targetId: string; database: string; queryHash: string;
  at: number; status: 'pending' | 'ok' | 'error'; finishedAt?: number; rowCount?: number; truncated?: boolean;
}
export interface FlowRun {
  id: string; revision: number; flowId: string; flowVersion: number; definitionDigest: string;
  ownerOrchestratorId: string; subjectKey: string; scope: FlowScope; inputs: Record<string, string>;
  status: 'active' | 'approval' | 'blocked' | 'completed' | 'cancelled'; currentStep: number; steps: FlowStepRun[];
  createdAt: number; updatedAt: number;
  testDbEvidence?: FlowTestDbEvidence[];
  /** Host dispatch observations plus explicitly agent-reported effects; no inference of remote atomicity. */
  browserWrites?: { stepId: string; chatRunId: string; taskVersion: number; at: number; dispatched: number; outcome: 'pending' | 'done' | 'partial' | 'not-done'; reportId?: string; evidence: string[] }[];
  /** Host event timeline; never model-invented execution or hidden chain of thought. */
  /** Historical exact approval; never used as live execution authority. */
  approval?: { ruleId: string; ruleRevision: number; approvedAt: number; config: FlowAutomationConfig; sha256: string };
  trace?: { id: string; at: number; kind: 'transition' | 'output' | 'cleanup' | 'pause' | 'decision'; stepId?: string; message: string }[];
  dossierPath?: string;
  settlementError?: string;
  outputs?: { id: string; at: number; content: string; sha256: string; brainPath?: string; projectedAt?: number }[];
  history?: { id: string; stepId: string; at: number; text: string; status: 'pending' | 'sent'; reason?: string; mentionReason?: 'intake' | 'block' | 'downgrade' | 'final' }[];
  intake?: 'accepted' | 'skipped';
  verdict?: { kind: 'ai-fixable'; at: number; stepId: string };
  disposition?: { kind: 'needs-human' | 'skipped'; lesson?: boolean; reason: string; at: number; cleanup: 'pending' | 'complete'; phase: number; error?: string };
  cancellation?: { at: number; reason: string; by: 'user' | 'orchestrator' | 'routine'; expectedRevision: number; interruption?: 'pending' | 'confirmed' };
  restartOf?: { runId: string; branchRunId?: string; stepId: string; expectedRevision: number; mode: 'from-start' | 'from-step' };
  pendingCancellation?: { revision: number; requestedAt: number; reason?: string };
  recoveryFeedback?: { kind: 'cancel' | 'restart'; at: number; message: string; deliveredAt?: number };
  pendingRecovery?: { mode: 'from-start' | 'from-step'; stepId?: string; revision: number; requestedAt: number; targetVersion: number; targetDigest: string; automationRule?: { id: string; revision: number } };
  /** The user's pause: the runner starts nothing new for this run until «Riprendi» (ADR 0155). */
  paused?: { at: number };
  /** Files or pasted lists given at start: stored next to the state, hashed, read by steps as {{attachment:name}}. */
  attachments?: FlowAttachment[];
  /** One receipt per script or query run, by the runner or by the user's «Esegui». */
  receipts?: FlowCommandReceipt[];
  /** What the runner did by itself: retries and send-backs, newest last (bounded). */
  heal?: FlowHealEntry[];
  /** A prod step's exact command waiting for the user's «Esegui» (never run by the runner). */
  awaitingUser?: { stepId: string; command: string; at: number };
  /** The work item title as the trigger or the start dialog saw it. */
  title?: string;
}
export interface FlowAttachment { name: string; sha256: string; size: number; lines: number; at: number }
export interface FlowCommandReceipt {
  id: string; stepId: string; kind: 'script' | 'query'; ref: string; command: string; args: Record<string, string>;
  sha256: string; env: 'test' | 'prod'; startedAt: number; endedAt?: number; exitCode?: number | null;
  output: string; by: 'runner' | 'user';
}
export interface FlowHealEntry { at: number; stepId: string; action: 'retry' | 'goto' | 'resume'; to?: string; attempt: number; reason: string; progress?: string }
/** One line of the Dry-run: every step resolved, nothing executed. */
export interface FlowDryRunStep {
  stepId: string; title: string; kind: FlowStep['kind']; who: string; command?: string; prod: boolean; auto: boolean; problems: string[];
}
export interface FlowDryRun { flowId: string; version: number; steps: FlowDryRunStep[]; problems: string[] }
/** One row of app_flow_overview: what a routine run is doing, in plain words. */
export interface FlowOverviewRow {
  runId: string; flow: string; version: number; workItem?: { title: string; url?: string }; step?: string; state: string;
  blocker?: string; updatedAt: number; next: string;
}
export interface FlowSnapshot {
  contextKey: string; drafts: FlowDraft[]; versions: FlowVersion[]; active: Record<string, number>;
  runs: FlowRun[]; storageError?: string; automation?: FlowAutomationSnapshot;
  /** The work roles as the catalog and the routing table resolve them now, for showing each agent step's role and model. */
  roles?: Partial<Record<WorkRoleId, FlowRoleInfo>>;
  /** The engines a step may run on and their models, for the per-step picker. */
  engines?: { id: string; name: string; models: string[] }[];
  /** The runner's state: running here, or another app holds the lock. */
  runner?: { owner: 'here' | 'other'; active: number };
}
/** A role's launch facts: its own fixed model (null = none) and, per tier, the model the routing table gives on its engine. */
export interface FlowRoleInfo { engine?: string; name: string; avatar: AgentAvatar; tier: ModelTier; tierMax: ModelTier; model: string | null; models: Partial<Record<ModelTier, string | null>> }
export interface FlowMatch { status: 'none' | 'match' | 'ambiguous'; candidates: FlowVersion[] }
export interface FlowPropose { definition: FlowDefinition; expectedRevision: number }
export interface FlowActivate { id: string; expectedRevision: number; answer: 'yes' | 'no' | 'other'; feedback?: string }
/** The user's tier pick on one agent step (null = leave it to the role): from the exact draft revision or active version
 * shown, it only ever yields a new proposed draft revision that the existing approval modal activates (or not). */
export interface FlowStepTierEdit { flowId: string; base: { version: number } | { draftRevision: number }; stepId: string; tier: ModelTier | null }
export interface FlowStart { flowId: string; flowVersion: number; subjectKey: string; scope: FlowScope; inputs: Record<string, string>; title?: string; attachments?: FlowAttachment[] }
/** The owner of a run the app's runner started (the Routine page, a trigger): no Orchestrator needed (ADR 0155). */
export const APP_OWNER = 'app';
/** The user's start from the Routine page: one work item (id or link) and/or attachments, plus typed params. */
export interface FlowStartItem { flowId: string; workItem?: string; params?: Record<string, string>; attachments?: { name: string; content: string }[]; dryRun?: boolean }
/** A work item before a manual start: `why` = what the trigger's filters would say (a warning, the user may still start
 *  it), `blocking` = why it cannot start here (another project than the routine's approved trigger, a run already active). */
export interface FlowItemPreview { id: number; title: string; type: string; state: string; areaPath: string; tags: string[]; url: string; revision: number; matches: boolean; why: string[]; blocking: string[]; activeRun?: string }
/** The user's engine/model pick on one agent step (null = back to the role's). Applied at once as a new version. */
export interface FlowStepModelEdit { flowId: string; version: number; stepId: string; engine: string | null; model: string | null; effort?: Effort | null }
export interface FlowReport { runId: string; expectedRevision: number; stepId: string; reportId: string }
export interface FlowDecision { runId: string; expectedRevision: number; stepId: string; answer: 'yes' | 'no' | 'other'; feedback?: string }
/** Explicit controls preserve the original run and pin the exact version reviewed by the user. */
export interface FlowCancel { runId: string; expectedRevision: number; reason?: string }
export interface FlowRestart { runId: string; expectedRevision: number; mode: 'from-start' | 'from-step'; stepId?: string; acknowledgeEffects: boolean; targetVersion: number; targetDigest: string; automationRule?: { id: string; revision: number } }
export type FlowRestartProposal = Omit<FlowRestart, 'acknowledgeEffects'>;
export interface FlowRestartDecision { runId: string; expectedRevision: number; answer: 'yes' | 'no' | 'other'; feedback?: string }
/** Binds a renderer decision to the brain whose proposal was actually displayed. */
export type FlowContext<T> = T & { contextKey: string };
