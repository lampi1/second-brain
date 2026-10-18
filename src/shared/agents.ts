// Agent catalog and session identity contracts, shared by main, renderer and read-only discovery.
import type { Effort, Harness } from './contract';
import type { AgentKnowhow, AgentPackIdentity } from './agent-pack';
import { ROLE_GLYPHS } from './agent-glyphs';

/** Untrusted routing declarations. Never authorization, verified capability or executable configuration. */
export interface AgentManifest {
  whenToUse?: string;
  whenNotToUse?: string;
  input?: string;
  output?: string;
  declaredTools?: string[];
  accessScopes?: string[];
  successCriteria?: string[];
}

export const AGENT_SYMBOLS = ['briefcase', 'search', 'pen', 'chart', 'compass', 'code', 'spark', 'bug', 'eye', 'globe', 'server', 'mail', 'calendar', 'book', 'shield', 'wrench', 'check', ...ROLE_GLYPHS] as const;
export type AgentSymbol = (typeof AGENT_SYMBOLS)[number];
export const AGENT_TONES = ['blue', 'violet', 'amber', 'teal', 'red', 'slate', 'cyan', 'pink', 'indigo', 'green'] as const;
export type AgentTone = (typeof AGENT_TONES)[number];
/** Raster data only. Main validates bytes, decoding and dimensions before persistence. */
export type AgentAvatar = { kind: 'symbol'; value: AgentSymbol; tone?: AgentTone } | { kind: 'image'; dataUrl: string };

export const AGENT_CATEGORIES = ['development', 'ops', 'personal', 'other'] as const;
export type AgentCategory = (typeof AGENT_CATEGORIES)[number];
/** Abstract tool classes. A definition only narrows what the engine and Brother's settings already allow. */
export const TOOL_CLASSES = ['read', 'edit', 'shell', 'web', 'browser', 'mail-draft', 'calendar-read', 'brain-write', 'mcp'] as const;
export type ToolClass = (typeof TOOL_CLASSES)[number];
export interface AgentToolPolicy { allow: ToolClass[]; mcp?: string[] }
/** Upper bound for a run's permission mode. 'auto' and 'bypassPermissions' are deliberately not representable. */
export const PERMISSION_CEILINGS = ['plan', 'default', 'acceptEdits'] as const;
export type PermissionCeiling = (typeof PERMISSION_CEILINGS)[number];
export interface AgentEvidenceRef { kind: 'journal' | 'chat' | 'ai-error' | 'cost' | 'run' | 'feedback'; ref: string; at: number }
export type AgentOrigin =
  | { kind: 'preset'; presetId: string; presetRevision: number }
  | { kind: 'user' }
  | { kind: 'orchestrator'; reason: string; evidence: AgentEvidenceRef[] };
export type AgentAuthor = 'user' | 'orchestrator' | 'preset' | 'migration';

export interface AgentDraft {
  knowhow?: AgentKnowhow;
  pack?: AgentPackIdentity;
  name: string;
  purpose: string;
  instructions: string;
  manifest?: AgentManifest;
  engine: Harness;
  /** null = the engine's own default, explicitly unknown until reported by the session. */
  model: string | null;
  effort?: Effort;
  avatar: AgentAvatar;
  /** One line, what the agent is. Omitted by older clients: the purpose stands in. */
  role?: string;
  category?: AgentCategory;
  /** null/omitted = inherit the engine defaults, as before definitions could narrow tools. */
  tools?: AgentToolPolicy | null;
  /** null/omitted = inherit Brother's own permission settings. */
  permissionCeiling?: PermissionCeiling | null;
}
/** The agents.json v1 record, still produced by the legacy routing import and read by the v1 → v2 migration. */
export type AgentProfileV1 = AgentDraft & { id: string; createdAt: number; updatedAt: number };
/** Fields that change what a run does. Saving a change to any of them creates a new version. */
export const BEHAVIOUR_FIELDS = ['instructions', 'manifest', 'engine', 'model', 'effort', 'tools', 'permissionCeiling', 'knowhow'] as const;
export type AgentBehaviour = Pick<AgentDraft, 'instructions' | 'manifest' | 'engine' | 'model' | 'effort' | 'tools' | 'permissionCeiling' | 'knowhow'>;
export interface AgentProfile extends AgentDraft {
  /** Canonical behaviour digest at the last packaged install/update; absent on legacy/user definitions. */
  presetHash?: string;
  /** Background presets are visible/editable, but never offered as task delegates. */
  routable?: boolean;
  id: string; createdAt: number; updatedAt: number;
  role: string;
  category: AgentCategory;
  tools: AgentToolPolicy | null;
  permissionCeiling: PermissionCeiling | null;
  origin: AgentOrigin;
  /** Highest version ever created. */
  version: number;
  /** The version new runs use; lower than `version` after a restore. The profile's behaviour fields are this version. */
  activeVersion: number;
  /** At most one open trial per agent; no other behavioural change while it is open. */
  trial?: { version: number; baseline: number; startedAt: number };
  /** Created on the fly for a task (AGENTS-DESIGN §4.7): on trial until its runs keep or retire it. A retired agent keeps
   *  it while archived (the 14-day no-recreate check); one kept by the evaluator loses it; one kept by Brother (Tieni, an
   *  edit, a restore) keeps it with `keptBy: 'brother'`, which ends the probation. */
  probation?: AgentProbation;
  lastEditedBy: AgentAuthor;
  /** Brother edited it: the Orchestrator may only propose changes. */
  userLocked: boolean;
  status: 'active' | 'archived';
  archivedAt?: number;
}
/** since = when the probation began. It names its cause: requestItemId = the task message that asked for the agent (A7
 *  sets it), or source = the reviewed agent pack it was imported from. */
export interface AgentProbation { since: number; requestItemId?: string; source?: AgentProbationSource; keptBy?: 'brother' }
export interface AgentProbationSource { kind: 'import'; packId: string; revision: number }
/** Still being judged: a probation Brother has not ended. */
export const inProbation = (p: Pick<AgentProfile, 'probation'>): boolean => p.probation !== undefined && p.probation.keptBy === undefined;
/** How a probation ended, written on the version that was active then. */
export interface AgentProbationDecision { decision: 'kept' | 'retired'; by: 'brother' | 'evaluator'; reason: string; at: number }
export type AgentVersionState = 'active' | 'trial' | 'kept' | 'rejected' | 'superseded';
/** Immutable behaviour snapshot of one version (no avatar or images: history stays small). */
export interface AgentVersion {
  agentId: string; version: number; parentVersion: number | null;
  behaviour: AgentBehaviour; author: AgentAuthor; reason: string; at: number; state: AgentVersionState;
  probation?: AgentProbationDecision;
}
/** The built-in agent a chat started without an agent runs as (AGENTS-DESIGN §4.7): it can never be archived. */
export const GENERAL_AGENT_ID = 'default-general';
/** The coordinator preset: it shapes the Orchestrator chat only and never starts a work chat. */
export const ORCHESTRATOR_AGENT_ID = 'default-orchestrator';
/** Frozen when a chat starts; editing the catalog never relabels existing sessions. */
export interface AgentOwnerSnapshot {
  id: string; name: string; purpose: string; avatar: AgentAvatar;
  engine: Harness; model: string | null; revision: number;
  source: 'catalog' | 'legacy' | 'routed';
  /** Definition version the chat runs. Absent on chats started before versions existed (= v0 legacy). */
  version?: number;
}
/** How a run ended: its work was marked completed (by the Orchestrator or Brother), its chat was closed, or it sat idle. */
export type AgentRunEnd = 'completed' | 'closed' | 'stale';
/** Only `human` and `reviewed-evidence` count for keep-or-rollback (AGENTS-DESIGN §1.2, §4.4). */
export interface AgentRunOutcome {
  verdict: 'success' | 'partial' | 'fail' | 'unknown';
  basis: 'human' | 'reviewed-evidence' | 'orchestrator-opinion' | 'self-report' | 'unknown';
  at: number; by: string; note?: string;
}
export interface AgentRunCounters { questions: number; permissions: number; commands: number; reopened: number; contextPeak: number | null }
export interface AgentRunTokens { input: number; cacheRead: number; cacheWrite: number; output: number }
/** The fenced `run-report` block an agent ends its run with (AGENTS-DESIGN §3 preamble): the latest one of the run.
 *  `ok: false` = a block was there but did not parse; no block at all leaves the field out. */
export type AgentRunReport =
  | { ok: true; at: number; outcome: 'done' | 'partial' | 'blocked'; verified: 'yes' | 'partial' | 'no'; summary: string; findings?: number; blocking?: number }
  | { ok: false; at: number };
/** Brother's corrections in the run (§5): (a) "[Reasoning correction]" messages, (b) his reopen of a run whose agent had
 *  reported. Missing on runs recorded before they were counted: unknown, never zero. */
export interface AgentRunCorrections { tagged: number; afterReport: number }
// Agent metrics (AGENTS-DESIGN §5), computed in main (agents/run-metrics.ts) from agent-runs.json.
/** One §5 metric: n = the runs it rests on, coverage = n / ended runs (null: no ended run). */
export interface Metric { value: number | null; n: number; coverage: number | null }
export interface VersionMetrics {
  agentId: string;
  /** null = all versions from 1 up (v0 left out) */
  version: number | null;
  legacy: boolean;
  ended: number;
  successRate: Metric;
  opinion: { value: number | null; n: number }; selfReport: { value: number | null; n: number };
  correctionsPerRun: Metric;
  aiErrorsPerRun: Metric;
  reworkRate: Metric;
  costPerRun: { median: Metric; p90: number | null };
  tokensPerRun: Record<keyof AgentRunTokens, Metric>;
  contextPeak: { median: Metric; max: number | null; ofWindow: number | null };
  timeToDone: { elapsed: Metric; execution: Metric };
  questionsPerRun: Metric; permissionsPerRun: Metric; commandsPerRun: Metric;
  reviews: { reviewer: { agentId: string; version: number }; runs: number; findingsPerRun: number; blockingPerRun: Metric }[];
}
export interface AgentMetrics { agentId: string; versions: VersionMetrics[]; all: VersionMetrics | null; open: number }
/** One run = a chat started from an agent definition (agent-runs.json is the source of truth; the chat keeps a mirror). */
export interface AgentRun {
  source?: 'chat' | 'oneshot';
  oneshot?: { engine: string; job: 'pulse' | 'headline'; fallback: boolean; costBasis: 'reported' | 'estimated' | 'unknown' };
  runId: string; chatId: string; agentId: string;
  /** pinned at start; 0 = started before versions existed (v0 legacy: never a baseline) */
  version: number;
  goal: string; startedBy: 'user' | 'orchestrator'; startedAt: number;
  /** a reviewer run of an implementer run, or a child started by agent_spawn */
  parentRunId?: string;
  /** the parent run that spawned it: it ends when the parent ends */
  spawnedBy?: string;
  reviewOf?: string; reworkOf?: string;
  /** the run of the chat this one continues (the hand-off "Continua in una nuova chat"): counts as rework of it */
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
  /** time the chat spent running (not waiting on Brother, a permission or the queue) while the run was open; missing on
   *  runs recorded before it was measured */
  executionMs?: number;
  /** what the run was about (AGENTS-DESIGN §4.8), set at start and frozen at its end; missing on runs recorded before tags
   *  existed: unknown in every filter, never a match */
  tags?: AgentRunTags;
}
/** skills = skill ids it started with plus the ones its engine loaded while open; app = the product it is about;
 *  repo = the name of the git top-level folder of its cwd (null outside a repository). */
export interface AgentRunTags { skills: string[]; app: string | null; repo: string | null }
/** Metric filters (all optional; together they must all match). */
export interface AgentMetricsFilter { since?: number; skill?: string; app?: string; repo?: string }
export interface AgentModelChoice {
  engine: Harness; label: string; enabled: boolean; trusted: boolean; effort: boolean;
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
  /** Read-only candidates. Applying one uses the normal explicit user save (or fork-on-edit). */
  presetUpdates?: { agentId: string; presetRevision: number; draft: AgentDraft; differences: { field: string; before: unknown; after: unknown }[] }[];
  /** Active definitions only: the launchable ones. */
  profiles: AgentProfile[];
  archived: AgentProfile[];
  models: AgentModelChoice[];
  problem: string | null;
  legacyRouting: { preserved: true; imported: number; remaining: number };
  imageGeneration: { available: false; reason: string };
}

export type SetupGuide = { stage: 'choosing' | 'fallback' } | { stage: 'connecting' | 'guided'; engine: 'claude' | 'codex' | 'cursor'; chatId: string };
export interface SetupDraft {
  step: number;
  work: '' | 'employee' | 'independent' | 'other';
  goals: string;
  tools: string;
  style: 'balanced' | 'concise' | 'detailed';
  agentIds: string[];
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
