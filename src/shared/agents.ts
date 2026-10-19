// Role catalog and session identity contracts, shared by main, renderer and read-only discovery.
import type { Effort, Harness } from './contract';
import type { AgentKnowhow, AgentPackIdentity } from './agent-pack';

import type { CharacterId } from './characters';
import type { ModelTier } from './roles';

/** The cartoon character a role is drawn as (renderer/lib/character-art.ts): fixed per role, never user content. */
export type AgentAvatar = { kind: 'character'; value: CharacterId };

/** Abstract tool classes. A definition only narrows what the engine and the user's settings already allow.
 *  shell-read = read-only commands only (agents/shell-readonly.ts); browser-read = navigate and read pages, no typing. */
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
  independent: boolean;
  /** the roles it may launch with agent_delegate */
  launches: string[];
  /** the brain's skills it loads at every launch (and may use; any other is refused, agents/role-gate.ts) */
  skills: string[];
}
/** The bounds of a role's "Contesto massimo" (the Claude engine accepts 100k..1M as its compaction window). */
export const MAX_CONTEXT_RANGE = { min: 100_000, max: 1_000_000 } as const;
/** Fields that change what a run does. Saving a change to any of them creates a new version. */
export const BEHAVIOUR_FIELDS = ['instructions', 'engine', 'model', 'effort', 'tools', 'permissionCeiling', 'knowhow', 'maxContext', 'tier', 'tierMax', 'independent', 'launches', 'skills'] as const;
export type AgentBehaviour = Pick<AgentDraft, (typeof BEHAVIOUR_FIELDS)[number]>;
export interface AgentProfile extends AgentDraft {
  id: string; createdAt: number; updatedAt: number;
  /** role = one of the nine roles; background = Pulse, a catalog entry that is never offered as a delegate */
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
}
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
/** Only `human` and `reviewed-evidence` count for keep-or-rollback (AGENTS-DESIGN §1.2, §4.4). */
export interface AgentRunOutcome {
  verdict: 'success' | 'partial' | 'fail' | 'unknown';
  basis: 'human' | 'reviewed-evidence' | 'orchestrator-opinion' | 'self-report' | 'unknown';
  at: number; by: string; note?: string;
}
export interface AgentRunCounters { questions: number; permissions: number; commands: number; reopened: number; contextPeak: number | null }
export interface AgentRunTokens { input: number; cacheRead: number; cacheWrite: number; output: number }
/** The run's agent_report (agents/delegation.ts): the child's self-report of its delegation contract. */
export interface AgentRunReport { at: number; outcome: 'done' | 'partial' | 'blocked'; verified: 'yes' | 'partial' | 'no'; summary: string; findings?: number; blocking?: number }
/** The user's corrections in the run (§5): (a) "[Reasoning correction]" messages, (b) a reopen of a run whose agent had
 *  reported. Missing on runs recorded before they were counted: unknown, never zero. */
export interface AgentRunCorrections { tagged: number; afterReport: number }
// Role metrics (AGENTS-DESIGN §5), computed in main (agents/run-metrics.ts) from agent-runs.json.
/** One §5 metric: n = the runs it rests on, coverage = n / ended runs (null: no ended run). */
export interface Metric { value: number | null; n: number; coverage: number | null }
export interface VersionMetrics {
  agentId: string;
  /** null = all versions */
  version: number | null;
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
/** One run = a chat started from a role (agent-runs.json is the source of truth; the chat keeps a mirror). */
export interface AgentRun {
  source?: 'chat' | 'oneshot';
  oneshot?: { engine: string; job: 'pulse' | 'headline'; fallback: boolean; costBasis: 'reported' | 'estimated' | 'unknown' };
  runId: string; chatId: string; agentId: string;
  version: number;
  goal: string; startedBy: 'user' | 'orchestrator' | 'parent' | 'app'; startedAt: number;
  /** the model tier and the model the run started on (role × skills × tier is the loop's unit of comparison) */
  tier?: ModelTier; model?: string | null;
  /** the run of the chat that delegated this one (agent_delegate), or of the run a Judge review is about */
  parentRunId?: string;
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
  /** time the chat spent running (not waiting on the user, a permission or the queue) while the run was open; missing on
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
  /** The nine roles in their fixed order, then the background entries (Pulse). */
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
