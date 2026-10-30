// Role catalog and session identity contracts, shared by main, renderer and read-only discovery.
import type { DelegationResult } from './delegation';
import type { Effort, Harness } from './contract';
import type { AgentKnowhow, AgentPackIdentity } from './agent-pack';

import type { CharacterId } from './characters';
import type { ModelTier } from './roles';
import type { RoleJudges } from './ppi';

/** One-shot purposes: the service and persisted run reader share this list so new jobs survive a restart. */
/** review = the nightly batch review (agents/judge-sample.ts, ADR 0203): a hidden run, never a chat */
export const ONE_SHOT_PURPOSES = ['pulse', 'headline', 'upgrade', 'phrases', 'guide', 'review'] as const;
export type OneShotPurpose = (typeof ONE_SHOT_PURPOSES)[number];

/** The cartoon character a role is drawn as (renderer/lib/character-art.ts): fixed per role, never user content. */
export type AgentAvatar = { kind: 'character'; value: CharacterId };

/** Abstract tool classes. A definition only narrows what the engine and the user's settings already allow.
 *  shell-read = read-only commands only (agents/tool-policy.ts readOnlyCommand); browser-read = navigate and read pages, no typing. */
export const TOOL_CLASSES = ['read', 'edit', 'shell', 'shell-read', 'web', 'browser', 'browser-read', 'mail-draft', 'calendar-read', 'brain-write', 'mcp'] as const;
export type ToolClass = (typeof TOOL_CLASSES)[number];
export interface AgentToolPolicy { allow: ToolClass[]; mcp?: string[] }
/** Upper bound for a run's permission mode. 'auto' and 'bypassPermissions' are deliberately not representable. */
export const PERMISSION_CEILINGS = ['plan', 'default', 'acceptEdits'] as const;
export type PermissionCeiling = (typeof PERMISSION_CEILINGS)[number];
/** The user's "Annulla" on a change the app applied (a maintenance change, a trial): back to `version` while the role
 *  is still at `expectedRevision`. */
export interface AgentUndo { agentId: string; expectedRevision: number; version: number }
export interface AgentEvidenceRef { kind: 'journal' | 'chat' | 'ai-error' | 'cost' | 'run' | 'feedback'; ref: string; at: number }
/** Who wrote a version: the shipped default, the user, or the app's maintenance (skills and role text, ADR 0083). */
export type AgentAuthor = 'default' | 'user' | 'maintenance';

/** The editable part of a role (Brain → Agenti). Name, summary and character are fixed by the role. */
export interface AgentDraft {
  /** the role's default skills (and its own know-how files), loaded at every launch */
  knowhow?: AgentKnowhow;
  pack?: AgentPackIdentity;
  name: string;
  purpose: string;
  instructions: string;
  engine: Harness;
  /** null = the model of the role's tier on its engine (Impostazioni → Ruoli e deleghe), else this exact model */
  model: string | null;
  effort?: Effort;
  avatar: AgentAvatar;
  tools: AgentToolPolicy | null;
  permissionCeiling: PermissionCeiling | null;
  /** "Contesto massimo": the context (tokens) the role's chat may fill before its engine compacts it (issue #80);
   *  null/omitted = the user's setting (Impostazioni → compattazione). Honoured where the engine supports it
   *  (AgentModelChoice.maxContext; today the Claude engines, CLAUDE_CODE_AUTO_COMPACT_WINDOW). */
  maxContext?: number | null;
  tier: ModelTier;
  tierMax: ModelTier;
  /** the roles it may launch with agent_delegate */
  launches: string[];
  /** the brain's skills it loads at every launch (and may use; any other is refused, agents/role-gate.ts) */
  skills: string[];
}
/** The bounds of a role's "Contesto massimo" (the Claude engine accepts 100k..1M as its compaction window). */
export const MAX_CONTEXT_RANGE = { min: 100_000, max: 1_000_000 } as const;
/** Fields that change what a run does. Saving a change to any of them creates a new version. */
export const BEHAVIOUR_FIELDS = ['instructions', 'engine', 'model', 'effort', 'tools', 'permissionCeiling', 'knowhow', 'maxContext', 'tier', 'tierMax', 'launches', 'skills'] as const;
export type AgentBehaviour = Pick<AgentDraft, (typeof BEHAVIOUR_FIELDS)[number]>;
export interface AgentProfile extends AgentDraft {
  id: string; createdAt: number; updatedAt: number;
  /** role = one of the six roles (the Orchestrator and the five work roles); background = Pulse, a catalog entry that is never offered as a delegate */
  scope: 'role' | 'background';
  /** Highest version ever created. */
  version: number;
  /** The version new runs use; lower than `version` after a restore. The profile's behaviour fields are this version. */
  activeVersion: number;
  /** At most one open trial per role; no other behavioural change while it is open. */
  trial?: { version: number; baseline: number; startedAt: number };
  lastEditedBy: AgentAuthor;
  /** the user changed it from the defaults ("Ripristina predefinito" clears it) */
  userLocked: boolean;
}
export type AgentVersionState = 'active' | 'trial' | 'kept' | 'rejected' | 'superseded';
/** Immutable behaviour snapshot of one version (no avatar or images: history stays small). */
export interface AgentVersion {
  agentId: string; version: number; parentVersion: number | null;
  behaviour: AgentBehaviour; author: AgentAuthor; reason: string; at: number; state: AgentVersionState;
  /** what made it a new version (ADR 0186); missing on a version saved before */
  changed?: VersionedChange[];
  /** the changes made to it in place (ADR 0186: migrations, rebinds, tools or limits), newest last, at most AMENDS_KEPT */
  amended?: { at: number; by: AgentAuthor; reason: string }[];
}
export const AMENDS_KEPT = 5;
/** The only changes that make a new role version (ADR 0186): its text, its skills (and know-how), its model (engine,
 *  model, effort), its tier (and ceiling). Tools, permissions, launches and limits change the active version in place,
 *  and so do the app's migrations and engine rebinds: a version's runs then compare what the role does. */
export const VERSIONED_CHANGES = ['text', 'skills', 'model', 'tier'] as const;
export type VersionedChange = (typeof VERSIONED_CHANGES)[number];
/** The Orchestrator's role: it shapes the Orchestrator chat only and never starts a work chat. */
export const ORCHESTRATOR_AGENT_ID = 'orchestrator';
/** Frozen when a chat starts; editing the catalog never relabels existing sessions. catalog = a role's run, plain = a
 *  chat started without a role (the user's own permissions). */
export interface AgentOwnerSnapshot {
  id: string; name: string; purpose: string;
  /** absent on a plain chat */
  avatar?: AgentAvatar;
  engine: Harness; model: string | null; revision: number;
  source: 'catalog' | 'plain';
  /** Definition version the chat runs. */
  version?: number;
}
/** How a run ended: its work was marked completed (by agent_report, the Orchestrator or the user), its chat was closed, or it sat idle. */
export type AgentRunEnd = 'completed' | 'closed' | 'stale';
/** Only `human` and `reviewed-evidence` count for keep-or-rollback (AGENTS-DESIGN §1.2, §4.4). `receipts` = the app's
 *  deterministic verdict from what the run did (agents/receipts.ts, ADR 0130): repo checks run after the last change. */
export interface AgentRunOutcome {
  verdict: 'success' | 'partial' | 'fail' | 'unknown';
  basis: 'human' | 'reviewed-evidence' | 'receipts' | 'orchestrator-opinion' | 'self-report' | 'unknown';
  at: number; by: string; note?: string;
}
export interface AgentRunCounters { questions: number; permissions: number; commands: number; reopened: number; contextPeak: number | null }
export interface AgentRunTokens { input: number; cacheRead: number; cacheWrite: number; output: number }
/** The immutable result attached to one task version and run. */
export type CanonicalResult = DelegationResult & { at: number; taskId: string; runId: string; taskVersion: number };
/** The run's agent_report (agents/delegation.ts): the child's self-report of its delegation contract. */
export interface AgentRunReport { canonical?: CanonicalResult; at: number; outcome: 'done' | 'partial' | 'blocked'; verified: 'yes' | 'partial' | 'no'; summary: string; findings?: number; blocking?: number;
  /** an independent review's verdict on the run it reviews (agents/judge-sample.ts: a Sentinel's, a Judge's before ADR 0100) */
  verdict?: 'success' | 'partial' | 'fail';
  /** given with agent_report (its result was delivered to the parent or the Orchestrator as a message), not a
   *  run-report block in a reply */
  via?: 'agent_report' }
/** One shell command a run's agent ran (agents/receipts.ts): its text (cut), its exit code (null = the engine did not
 *  say), when it started; check = it runs a repo check (tests, typecheck, lint); masked = a pipe, `||`, `;` or `&`
 *  around it, so its exit code is not the check's. */
export interface AgentRunCommand { cmd: string; exit: number | null; at: number; check?: true; masked?: true }
export type ReceiptResult = 'pass' | 'fail' | 'unknown';
/** Why the receipts decided what they did (agents/receipts.ts receiptVerdict). */
export type ReceiptReason = 'checks-passed' | 'check-failed' | 'claims-unverified' | 'not-code' | 'files-unknown' | 'own-tests' | 'no-check-after-change' | 'criteria-unmet';
/** What the run did, recorded while it was open (ADR 0130), bounded: the commands with their exit codes, the files its
 *  turns changed (from the per-turn checkpoints, ADR 0103), commits and PRs it made; the deterministic verdict at its end. */
export interface AgentRunReceipts {
  /** oldest first, at most RECEIPT_COMMANDS (a check outlives other commands); more = the ones left out */
  commands: AgentRunCommand[]; more: number;
  /** repo-relative paths, at most RECEIPT_FILES; filesMore = the ones left out */
  files: string[]; filesMore: number;
  /** a turn's changes were recorded (filesKnown); a turn's were not (filesGap: not git, checkpoints off, git failed) */
  filesKnown: boolean; filesGap: boolean;
  /** over all changed files, not only the kept ones: a test or check config, a code file (not docs) */
  testsTouched: boolean; codeTouched: boolean;
  /** when a file last changed (an edit tool, or the end of a turn whose files changed without one); null = never */
  lastChangeAt: number | null;
  commits: number; prs: number;
  /** set once the run ended and its last turn's files are in */
  verdict?: { result: ReceiptResult; reason: ReceiptReason; at: number };
}
/** The user's corrections in the run (§5): (a) "[Reasoning correction]" messages, (b) a reopen of a run whose agent had
 *  reported. Missing on runs recorded before they were counted: unknown, never zero. */
export interface AgentRunCorrections { tagged: number; afterReport: number }
// Role metrics (AGENTS-DESIGN §5), computed in main (agents/run-metrics.ts) from agent-runs.json.
/** One §5 metric: n = the runs it rests on, coverage = n / ended runs (null: no ended run). */
export interface Metric { value: number | null; n: number; coverage: number | null }
/** Delivery observations on retained canonical results only; historical/pruned results are not inferred. */
export interface DeliveryMetrics {
  reported: number; instrumented: number; delivered: number;
  coverage: number | null; rate: number | null;
  displayLatencyMs: { median: number | null; n: number };
  /** Unique observed batches submitted to an engine, not completed syntheses or model invocations. */
  synthesisSubmissions: number | null;
}
export interface VersionMetrics {
  delivery?: DeliveryMetrics;
  agentId: string;
  /** null = all versions */
  version: number | null;
  ended: number;
  successRate: Metric;
  opinion: { value: number | null; n: number }; selfReport: { value: number | null; n: number };
  correctionsPerRun: Metric;
  reworkRate: Metric;
  /** total: the cost of every run with a known cost (its n), null when an older saved summary did not keep it (#125) */
  costPerRun: { median: Metric; p90: number | null; total: number | null };
  tokensPerRun: Record<keyof AgentRunTokens, Metric>;
  timeToDone: { elapsed: Metric; execution: Metric };
  questionsPerRun: Metric; commandsPerRun: Metric;
  reviews: { reviewer: { agentId: string; version: number }; runs: number; findingsPerRun: number; blockingPerRun: Metric }[];
  /** the all-versions row only: PPI success with every automatic judgment, and the Sentinel's agreement with the user
   *  (shared/ppi.ts, ADR 0197); absent on version rows and from an older main */
  judges?: RoleJudges;
}
export interface AgentMetrics { agentId: string; versions: VersionMetrics[]; all: VersionMetrics | null; open: number;
  /** level and performance on the agent card (agents/standing.ts), over all its runs whatever the filter */
  standing?: AgentStanding }
/** The card's «Lavori conclusi»: the agent's ended runs, or its standing's count when that is larger. The Orchestrator
 *  has no run of its own (its count is the ended root jobs it opened, ADR 0097) and Flash none at all (its answers,
 *  ADR 0131): reading only `all.ended` showed 0 for both however much they did. */
export const completedRuns = (m: AgentMetrics | null | undefined): number => Math.max(m?.all?.ended ?? 0, m?.standing?.runs ?? 0);
/** The agent card's level (from the XP of its verified successful runs, ADR 0100, 0131) and performance % (a Bayesian
 *  estimate of its verdicts weighted by trust and recency): agents/standing.ts. */
export interface AgentStanding {
  /** ended runs (kept + rolled up); for Flash, its answers */
  runs: number;
  /** verified successful runs (the user's verdict, a verified review's, the receipts', a verified parent's for a delegated
   *  child, the later outcome's for a Sentinel's review: standing.ts earnedVerdict, ADR 0125) */
  wins: number;
  /** the level's XP: each verified success weighted by the size of its job, 1..5 (agents/xp.ts, ADR 0131) */
  xp: number;
  level: number;
  /** XP where this level starts, and where the next one does (null at the top level) */
  levelAt: number; nextAt: number | null;
  /** 0..1 of the way to the next level (1 at the top) */
  progress: number;
  /** 0..1, the posterior mean; null while too few verdicts or too wide a spread ("in rodaggio") */
  performance: number | null;
  /** the 90% spread (±, 0..1) of the estimate; null = no verdict */
  spread: number | null;
  /** runs with a weighted verdict (never the agent's own word), and the minimum before the performance can show */
  evaluated: number; minRuns: number;
  /** where the verdicts came from: the user, an independent review, the app's receipts (ADR 0130), a review graded by what
   *  happened later, the facts, the Orchestrator, the Orchestrator's decision signals (ADR 0131), a verified parent
   *  (chain), Flash's answer outcomes (quick), the agent itself (the last one is counted here but weighs nothing) */
  sources: { human: number; review: number; receipts: number; graded: number; facts: number; orchestrator: number; decision: number; chain: number; quick: number; self: number };
}
/** One run = a chat started from a role (agent-runs.json is the source of truth; the chat keeps a mirror). */
/** App delivery observations. Engine submission is recorded only after session.send succeeds. */
export type TaskDeliveryPolicy = 'display' | 'notify' | 'synthesize';
/** Complete user-authored task instructions; sequence IDs are authoritative across restarts. */
export interface UserTaskEvent { seq: number; id: string; at: number; text: string; taskId?: string; taskVersion?: number }
export interface UserTaskEvents { events: UserTaskEvent[]; latestSeq: number; acknowledgedSeq: number }
export interface AgentRunDelivery {
  policy: TaskDeliveryPolicy; reportedAt: number; attempts: number;
  deliveredAt?: number; displayedAt?: number;
  synthesisBatchId?: string; synthesisSubmittedAt?: number;
  synthesisRequestedAt?: number; synthesisPending?: boolean;
}
export interface AgentRun {
  /** Exact launch roots; absent on historical runs whose project scope cannot be recovered safely. */
  scope?: { brainRoot: string; projectRoot: string };
  /** Actual settled execution turns; absent for historical runs. */
  turns?: number;
  delivery?: AgentRunDelivery;
  taskId?: string; taskVersion?: number;
  taskContract?: { goal: string; doneWhen: string[]; deliveryPolicy?: TaskDeliveryPolicy; reportExpected?: boolean };
  /** Snapshot captured before launch; missing means historical suggestions are unknown. */
  skillSuggestions?: { at: number; suggested: string[]; used: string[] };
  source?: 'chat' | 'oneshot';
  /** Host-captured origin of this task, independent of who originally opened its reusable chat. Missing = unknown. */
  requestOrigin?: 'user' | 'agent' | 'app';
  oneshot?: { engine: string; job: OneShotPurpose; fallback: boolean; costBasis: 'reported' | 'estimated' | 'unknown';
    /** the engine answered within its limits (agents/oneshot.ts); absent = recorded before it was kept */
    ok?: boolean };
  runId: string; chatId: string; agentId: string;
  version: number;
  goal: string; startedBy: 'user' | 'orchestrator' | 'parent' | 'app'; startedAt: number;
  /** the model tier and the model the run started on (role × skills × tier is the loop's unit of comparison) */
  tier?: ModelTier; model?: string | null;
  /** the run of the chat that delegated this one (agent_delegate), or of the run an independent review (a Sentinel's) is about */
  parentRunId?: string;
  reviewOf?: string; reworkOf?: string;
  /** the run of the chat this one continues (the hand-off "Continua in una nuova chat"): does not imply correction or rework */
  continuedFrom?: string;
  endedAt?: number; endReason?: AgentRunEnd;
  outcome?: AgentRunOutcome;
  counters: AgentRunCounters;
  /** settled turns while the run was open; null = its engine reports no cost */
  costUsd: number | null;
  /** null = a turn reported no token usage (or a backfilled run): unknown, never a partial sum */
  tokens: AgentRunTokens | null;
  report?: AgentRunReport;
  corrections?: AgentRunCorrections;
  /** time the chat spent running (not waiting on the user, a permission or the queue) while the run was open; missing on
   *  runs recorded before it was measured */
  executionMs?: number;
  /** what the run was about (AGENTS-DESIGN §4.8), set at start and frozen at its end; missing on runs recorded before tags
   *  existed: unknown in every filter, never a match */
  tags?: AgentRunTags;
  /** what the run did, with its deterministic verdict (ADR 0130); missing on runs before it and on one-shots */
  receipts?: AgentRunReceipts;
  /** a Strategist's plan with the user on this run (ADR 0108, 0131): plans proposed, «Cambia qualcosa» asked, when the
   *  user approved one; a decision signal for the Orchestrator */
  plan?: AgentRunPlan;
  /** the nightly batch review's own run (agents/judge-sample.ts, ADR 0203): the runs it reviewed, each with the verdict
   *  and verification the Sentinel gave it (absent = it gave none); written by the app from the parsed answer */
  reviewBatch?: ReviewBatchEntry[];
}
export interface ReviewBatchEntry { runId: string; verdict?: 'success' | 'partial' | 'fail'; verified?: 'yes' | 'partial' | 'no' }
export interface AgentRunPlan { proposals: number; changes: number; approvedAt?: number; /** approved by the app for the absent user (ADR 0191): no decision signal */ byApp?: boolean }
/** skills = skill ids it started with plus the ones its engine loaded while open; app = the product it is about;
 *  repo = the name of the git top-level folder of its cwd (null outside a repository). */
export interface AgentRunTags { skills: string[]; app: string | null; repo: string | null }
/** What the judging switch costs a day (main/agents/judge-sample.ts judgingEstimate, ADR 0203: a sample of the runs,
 *  reviewed in one hidden batch a night, under a daily cap). */
export interface JudgingEstimate {
  /** finished root runs a day that no free signal decides (last 7 days): the ones the sample is drawn from */
  runsPerDay: number;
  /** finished root runs a day that their receipts decide with no review (ADR 0130): zero tokens */
  receiptsPerDay: number;
  /** of runsPerDay, the ones a day the sample picks (25% per role, 10% for a steady one) */
  sampledPerDay: number;
  /** what reviewing one run has cost so far (past nightly batches per run, else past single reviews); null = no data */
  reviewUsd: number | null;
  /** min(sampledPerDay × reviewUsd, capUsd); null = no data */
  perDayUsd: number | null;
  /** the daily cap on reviews (Settings.judgingCapUsd) */
  capUsd: number;
  /** how many costs reviewUsd is made of */
  basis: number;
  /** the last nightly batch: when it ended, how many runs it judged, what it cost; null = none yet */
  lastBatch: { at: number; runs: number; costUsd: number | null } | null;
}
/** Metric filters (all optional; together they must all match). */
export interface AgentMetricsFilter { since?: number; skill?: string; app?: string; repo?: string }
export interface AgentModelChoice {
  engine: Harness; label: string; enabled: boolean; trusted: boolean; effort: boolean;
  /** the engine honours a role's maxContext ("Contesto massimo"); absent = no */
  maxContext?: boolean;
  models: { id: string; name: string }[];
  source: 'observed' | 'registry' | 'unknown';
  /** Model discovery does not prove installation or login. */
  installed: boolean | null; authenticated: boolean | null;
  defaultModel: boolean;
  /** Known models do not imply the adapter can select them. */
  modelSelectable: boolean;
  modelReason: string | null;
}
export interface AgentCatalog {
  /** The six roles in their fixed order, then the background entries (Pulse). */
  profiles: AgentProfile[];
  models: AgentModelChoice[];
  problem: string | null;
}

export type SetupGuide = { stage: 'choosing' | 'fallback' } | { stage: 'connecting' | 'guided'; engine: 'claude' | 'codex' | 'cursor'; chatId: string };
export interface SetupDraft {
  step: number;
  work: '' | 'employee' | 'independent' | 'other';
  goals: string;
  tools: string;
  style: 'balanced' | 'concise' | 'detailed';
  /** Explicit engine preferences; never a trust or login grant. */
  engines?: string[];
  guide?: SetupGuide;
  /** the me.md answers the owner gave in this run (unanswered ones are read from me.md), written on confirm */
  profile?: SetupProfile;
}
export interface SetupProfile { name?: string; role?: string; language?: string; areas?: string; style?: SetupDraft['style'] }
export interface SetupState {
  version: 1;
  status: 'new' | 'existing' | 'draft' | 'completed' | 'skipped';
  preferences: SetupDraft;
  updatedAt: number;
}

export type ChildState = 'running' | 'waiting' | 'completed' | 'failed' | 'stopped' | 'unknown';
/** A provider observation, never a fabricated native id or a count of arbitrary tool calls. */
export interface ChildObservation {
  key: string;
  nativeId: string | null;
  toolCallId: string | null;
  parentNativeId: string | null;
  kind: 'agent' | 'shell' | 'unknown';
  state: ChildState;
  task: string | null;
  /** The agent type the engine was asked to run the child as (Claude's subagent_type, Cursor's subagentType), as the
   *  engine sent it; the UI matches it to an app agent (lib/agent-children.ts childAgent). Missing = not reported. */
  agentType?: string | null;
  observedAt: number;
  source: 'live' | 'replay';
  /** When the app first saw this child (its start as far as the app knows: the first event's time, kept across the
   *  later updates). Missing on rows saved before it existed: the UI shows the observation time then. */
  startedAt?: number;
}
export interface AgentChildren {
  coverage: 'unknown' | 'partial' | 'complete';
  /** Counts of observed provider agents. null = an actual active/total census is unavailable. */
  active: number | null;
  total: number | null;
  observedActive: number;
  observedTotal: number;
  observedAt: number;
  children: ChildObservation[];
}
