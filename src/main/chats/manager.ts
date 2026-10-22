// ChatManager = the ChatService of the app (src/main/services.ts): every chat the user runs inside the cockpit, on one of
// the engines of the registry (engines/registry.ts, ADR 0046; today Claude, embedded binary, and Cursor over ACP): it
// asks an engine's caps, never its name, and gets the session from engines/sessions.ts.
// It owns the chat records (summary, items capped at ~2000, open questions/permissions), starts one engine session per
// chat on demand, turns session reports into contract events (chat:updated, chat:item with replace for streaming,
// pending:added/resolved, chat:removed), persists the chats (store.ts) and restores them as 'closed' on start; the
// first message to a closed chat resumes it (Claude --resume after loading its past from the transcript, transcript.ts;
// Cursor session/load). A finished chat can be archived (closedAt: its process ends, the record and transcript stay,
// the palette lists it under "Chiuse", Ctrl+K) and reopened; a message to an archived chat reopens it. A turn cut by a quit or
// crash (persisted "working") resumes by itself on the next start (resumeInterrupted). An app Claude chat can be forked (a copy, never two writers on one transcript). There is
// one Orchestrator, created only by the user; one created with `replaces` takes that one's role (the old one goes on as a
// normal chat). Long chats:
// each chat carries its context size (Claude: get_context_usage; Cursor: an estimate); every Claude engine gets the
// compaction window (option compactWindowTokens, ADR 0031); continueChat ("Riprendi") opens a NEW chat from a hand-off
// note, linked to the old one (handoff.ts); a cold chat (idle, long, Claude) writes its note quietly while the cache is
// warm and a message after the cache expired goes on in a fresh session of the same chat (coldTick / coldSwitch, ADR
// 0031), counted with the other context numbers (context-stats.ts, contextStats()). Brain hooks
// (options onRateLimit, onTurnEnd, onWaiting, onDone; method isOwnSession) let wiring.ts feed the brain
// without this module knowing it. Wired in src/main/wiring.ts.
import { timersFor } from '../timers';
const { setInterval, clearInterval, clearTimeout } = timersFor('chats/manager');
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Answer, ChatCommand, ChatItem, ChatSummary, CliStatus, ContextStats, CursorReasoning, Effort, HandoffInfo, Harness, Lang, NewChat, PendingRequest, PermissionMode } from '../../shared/contract';
import { replyLangTurn } from './reply-lang';
import { sysEn, type SysCode, type SysParams } from '../../shared/sys';
import { checkImages } from './images';
import type { Emitter } from '../ipc';
import { errText, log } from '../log';
import type { ChatService } from '../services';
import { cliVersion, killTrees, killTreesWithin, resolveClaude } from './cli';
import { reapAfterQuit, reapEnabled, reapEngine, snapshotTrees } from './proctree';
import { jobGuard } from './jobguard';
import { AFTER_CALLS, CACHE_TTL_MS, coldArmed, coldRoute, continuityStep, type ColdView, ORCHESTRATOR_COMPACT, ORCHESTRATOR_PAUSE_COMPACT, romeDay } from './continuity';
import { autoHandoff, coldPrompt, continuePrompt, extractHandoff, HANDOFF_END, HANDOFF_START, handoffRequest, HandoffStore, nextTitle } from './handoff';
import { ContextCounters } from './context-stats';

/** The app's own message to a chat whose turn a restart cut (resumeInterrupted). */
export const RESUME_TEXT = "[second-brain] L'app è stata riavviata mentre lavoravi e il tuo turno si è interrotto. Riprendi da dove eri: prima rileggi lo stato (file, worktree, comandi che avevi lanciato), poi continua.";
import { cut, isUuid, nextId, type HarnessSession, type SessionOptions, type SessionPatch, type SessionSink } from './session';
import { ChatStore, type HeldChildResult, type PastSession, type StoredChat } from './store';
import { updateActivity } from '../update/activity';
import { BufferedSink, PLAIN_LAUNCH, WarmPool, type WarmEngine, type WarmLaunch } from './warm';
import { AdmissionQueue, type AdmissionLimits, type LoadSampler } from './admission';
import { AgentMayNotWake } from '../engines/policy';
import { isAppChat } from '../brain/routing';
import { engineOf, engineOrThrow } from '../engines/registry';
import { sessionFor } from '../engines/sessions';
import { ORCHESTRATOR_TITLE } from '../../shared/orchestrator';
import { isWorkRole, ROLE_DEFAULTS } from '../../shared/roles';
import { waitsForPeople, waitsForWork } from '../../shared/waiting';
import { claudeHome, findTranscript, readHistory } from './transcript';
import { orchestratorOwner, plainOwner, type ResolvedRole } from '../agents/catalog';
import { withinParent } from '../agents/worktrees';
import { FAIL_CLOSED, aboveCeiling, allowsClass, belowParent, browserAccess, claudeDefaultMode, claudeTools, COMMAND_TOOLS, commandsReadOnly, narrowest, readOnlyCommand, toolClassOf, within, type AgentPolicy, type BrowserAccess, type ReadScripts } from '../agents/tool-policy';
import { readOnlyTools } from '../agents/read-tools';
import { type UserTaskEvents, type TaskDeliveryPolicy, type AgentOwnerSnapshot, type AgentRun, type AgentRunEnd, type AgentRunOutcome, type AgentRunTags } from '../../shared/agents';
import { AgentRunStore, addSkill, addTurn, APP_MAX, endRun, REPO_MAX, SKILL_ID, SKILLS_MAX, staleDue, tagName, type RunLinks } from '../agents/runs';
import { reportOf } from '../agents/run-report';
import { gateRequest, runtimePluginName, SubagentGate } from '../agents/role-gate';
import { afterTree, KEEP as CHECKPOINTS_KEPT, prune as pruneCheckpoints, restore as restoreCheckpoint, snapshot as takeCheckpoint, turnFiles, type Checkpoint } from './checkpoints';
import { emptyReceipts, noteTool, noteTurnFiles, receiptVerdict } from '../agents/receipts';
import { autoPermit } from './auto-permit';
import { TurnToolBudget } from '../agents/orchestrator-budget';
import { APP_CHAT_TOOLS } from './app-tool-approval';
import { RESULT_OUTPUT_MAX, checkResult, resultMessage, type DelegationLimitHit, type DelegationResult, type TaskSource, type TaskAssignmentOptions } from '../../shared/delegation';
import { finishPlan, afterReport, PLAN_APPROVED, planChange, STRATEGY_FLOW, withClarified, withDelegated, withStep, type PlanStep, type StepState, type StrategyPlan } from '../../shared/strategy';
import { aiErrorRuns, runMetrics } from '../agents/run-metrics';
import { standings, withStandings } from '../agents/standing';
import { isCorrection } from '../../shared/correction';
import { AgentChildrenReducer } from './agent-children';
import { autoCloseNow, type AutoCloseCandidate } from './auto-close';
import type { AutoCloseWaiting } from '../../shared/auto-close';
import { effortValue, initialEffort, observeEffort, selectEffort, submitEffort } from './effort';
import { AgentAnalyticsCollector } from '../agents/collector';

import { orchestratorRole, roleFrame } from '../agents/orchestrator-role';
import { slug as slugTitle } from './mail';
import { splitMode } from '../../shared/newchat';
import { orchestratorContext, type LampoCursor } from './lampo-context';
import { recallWarning, type Recall } from '../search/hybrid/recall';
import { APP_EVENT_LABEL } from './orchestrator-wake';

/** Legacy entries have no ID: match their content until the first submission assigns one. */
function sameChildResult(a: HeldChildResult, b: HeldChildResult): boolean {
  return a.id && b.id ? a.id === b.id : a.title === b.title && a.message === b.message;
}
function uniqueChildResults(items: readonly HeldChildResult[]): HeldChildResult[] {
  const unique: HeldChildResult[] = [];
  for (const item of items) if (!unique.some(other => sameChildResult(item, other))) unique.push(item);
  return unique;
}

/** an engine started while the user typed (ChatManager.prewarm) and never written to ends after this */
const PREWARM_UNUSED_MS = 5 * 60_000;
/** Internal outbox receipts are tied to engine submission, never CPU queue admission. */
interface SubmissionReceipt { beforeSubmit(): void; submitted(): void; failed(error: unknown): void }

export interface ChatManagerOptions {
  suggestSkills?: (goal: string) => Promise<string[]>;
  /** the roles in a few lines, for the Orchestrator's first message of a session (agents/discovery.ts roleCatalogBrief) */
  roleCatalogBrief?: () => string;
  /** the language the user wants replies in (ADR 0120: locale.ts uiLang, the setting or Windows'); absent = not named */
  replyLang?: () => Lang;
  /** the review pack under a Sentinel's first message (agents/review-pack.ts): the change it checks, gathered with git */
  reviewPack?: (cwd: string) => Promise<string>;
  /** ADR 0103: record the files before each turn of a work chat in a git repository (checkpoints.ts); absent = off */
  checkpoints?: () => boolean;
  /** how long a child's result waits for its siblings' (default CHILD_RESULTS_MS) */
  childResultsMs?: number;
  /** the estimate line under a user's message to the Orchestrator (shared/task-estimate.ts estimateLine): its first model
   *  call acts on it instead of calling task_estimate; null = no line */
  requestEstimate?: (text: string) => string | null;
  /** the role a new chat runs (catalog.resolve), with the plugin of its launch (only the skills it was given) */
  resolveAgent?: (req: NewChat) => ResolvedRole & { assets?: { pluginDir: string; skillRoot: string } };
  /** the git worktrees of the repository at a folder (agents/worktrees.ts): a delegated chat may work in its parent's */
  worktrees?: (cwd: string) => Promise<string[]>;
  onAutoCloseActivity?: (chatId: string) => void;
  emitter: Pick<Emitter, 'emit'>;
  userData: string;
  /** per engine, its command override (a .mjs fake for tests); absent = the installed one (cli.ts) */
  enginePaths?: Partial<Record<Harness, string>>;
  /** may a chat start on this engine now (the user's engineOn.* switches); absent = every engine may */
  engineOn?: (h: Harness) => boolean;
  /** may an agent's message wake a stopped chat on this engine («Gli Orchestrator possono usare X», engines/policy.ts) */
  agentsMayOpen?: (h: Harness) => boolean;
  /** the user's API key for this engine (engines/service.ts keyFor), read only when its process or request starts */
  keyFor?: (h: Harness) => string | null;
  /** app version, for the engines' clientInfo */
  appVersion?: string;
  /** per-chat MCP endpoint of the app (browser tools); null/undefined = none passed */
  mcpUrlFor?: ((chatId: string) => string | null) | null;
  /** the app-control MCP for the Orchestrator only: its own /mcp/app/o/<id>/<token> */
  appMcpUrl?: ((orchestratorId: string) => string | null) | null;
  /** the app-managed MCP servers a chat is given (ADR 0086, mcp-servers/service.ts launch): gateway endpoints, and the
   *  managed ids it may not use (Claude refuses them by name) */
  extMcp?: ((chatId: string) => { servers: { name: string; url: string }[]; denied: string[] }) | null;
  /** where Claude Code keeps transcripts (default ~/.claude or CLAUDE_CONFIG_DIR) */
  claudeHome?: string;
  maxItems?: number;
  env?: NodeJS.ProcessEnv;
  /** Past-error context for engines without Claude's prompt hook; bounded to 300 ms before delivery. */
  recall?: (text: string) => Promise<Recall>;
  extraArgs?: string[];
  /** keep one Claude engine started ahead for the next new chat in the same folder (warm.ts); default off */
  prewarm?: boolean;
  /** ms after a new Claude chat (or the app's start) before the next waiting engine starts (default 5 s / 20 s) */
  prewarmDelayMs?: number;
  /** the CPU-aware queue (ADR 0036): agents' starts and turns wait while the machine is busy; absent = never wait */
  admission?: { sampler: LoadSampler; limits: () => AdmissionLimits; tickMs?: number; autoTick?: boolean };
  /** custom session factory (tests, future engines) */
  sessionFactory?: (harness: Harness, opts: SessionOptions, sink: SessionSink) => HarnessSession;

  // ---- hooks for the brain (wiring.ts connects them; a throwing hook is logged, never breaks a chat) ----
  /** every stream-json `rate_limit_event` and every get_usage answer (→ BrainService.ingestRateLimits) */
  onRateLimit?: (msg: unknown) => void;
  /** the models a CLI session offers (→ BrainService.recordModels, for the Settings page) */
  onModels?: (harness: Harness, list: { id: string; name: string }[]) => void;
  /** a turn ended (→ the job ledger: real cost and time) */
  onTurnEnd?: (info: TurnEndInfo) => void;
  /** Once per actual run end (not per turn): the improvement loop evaluates the role's trial again. */
  onRunEnded?: (run: AgentRun) => void;
  /** The user's verdict landed on a run (run:outcome), also on one that had already ended: its trial is evaluated again. */
  onRunOutcome?: (run: AgentRun) => void;
  /** a question or permission opened in an app chat (→ feed "chat waiting") */
  onWaiting?: (chatId: string, pending: PendingRequest) => void;
  /** a turn ended with nothing pending: the chat is idle again (→ feed "chat done") */
  onDone?: (chatId: string) => void;
  /** the CLI died in the middle of a turn, with an error and no result (→ feed "chat finita con errore") */
  onCrash?: (chatId: string, error: string) => void;
  /** the user's reasoning and fast for every ACP chat, read at each session start (settings orchestratorChats.*) */
  acpModelConfig?: () => { reasoning: CursorReasoning | ''; fast: boolean } | null;
  /** min ms between two get_usage asks after turns (default 60 s) */
  usageEveryMs?: number;

  // ---- long chats (settings compactWindowTokens / contextHandoff / coldHandoffMin; the brain's mem.mjs) ----
  /** the auto-compact window of every Claude engine, read at each start (0 = the user's Claude settings decide) */
  compactWindowTokens?: () => number;
  /** the invisible continuation of cold chats (ADR 0031; default off here, wiring reads the setting) */
  coldHandoff?: () => boolean;
  /** «Orchestrators corte» (ADR 0051): an Orchestrator with a context from an earlier day compacts it once on a new day (default off
   *  here, wiring reads the setting orchestratorDayCompact) */
  orchestratorDayCompact?: () => boolean;
  /** ms after the last call before an idle long chat writes its cold note (default 50 min) */
  coldIdleMs?: () => number;
  /** tests: how long an engine started while the user typed waits for a message (default PREWARM_UNUSED_MS) */
  prewarmUnusedMs?: number;
  /** how long the prompt cache lives after its last use (default 55 min; tests shorten it) */
  cacheTtlMs?: number;
  /** ms between two checks of the cold chats (default 60 s; 0 = no timer, tests call coldTick) */
  coldEveryMs?: number;
  /** ms between two checks for stale agent runs (default 10 min; 0 = no timer, tests call staleRuns) */
  runEveryMs?: number;
  /** absolute path of the brain's mem.mjs, when it has one: the hand-off request asks to update the now.md line too */
  memTool?: () => string | null;
  /** the brain folder: a brain-write role (no edit) may edit only inside it (agents/role-gate.ts) */
  brainRoot?: () => string | null;
  /** how long a chat may take to write its hand-off before the app builds one itself (default 5 min) */
  handoffTimeoutMs?: number;
}

export interface HandoffOptions {
  reason?: 'manual' | 'threshold' | 'finished' | 'continue' | 'cold';
  /** false = never start a stopped engine for it (an agent asking about a Cursor chat): a token-free note instead */
  allowStart?: boolean;
  /** false = never ask the chat, even a running one: always the token-free note (the automatic closing of finished
   *  chats, owner 2026-10-11: no turn and no tokens at close) */
  ask?: boolean;
}

export interface TurnEndInfo {
  chatId: string;
  sessionId: string | null;
  harness: Harness;
  model: string | null;
  effort: Effort | null;
  /** only on the first turn of the job (the brain stores its length and kind, never the text) */
  firstPrompt?: string;
  costUsd: number;
  durationMs: number;
  turns: number;
  isError: boolean;
  /** the assistant's texts of this turn, joined (reply rules: chats/reply-rules.ts) */
  reply?: string;
}

/** The assistant's texts since the last user message (the turn that just ended), joined. */
export function turnReply(items: readonly ChatItem[]): string {
  const out: string[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'user') break;
    if (it.kind === 'assistant') out.unshift(it.text);
  }
  return out.join('\n\n');
}

/** Work still runs behind an idle prompt: background tasks the engine counts, or a final answer that says it waits
 *  for them (the engine's count missed a resumed agent on 2026-10-16). Such a chat is never closed nor released. */
export const workBehind = (s: Pick<ChatSummary, 'background' | 'waitsOnWork' | 'work'>): boolean => (s.background ?? 0) > 0 || !!s.waitsOnWork || !!s.work && s.work.status !== 'completed';

/** The scheduler's reason for each waiting kind (Italian, as its other reasons; the tile shows its own label). */
export const WAITING_REASON: Record<AutoCloseWaiting, string> = {
  answer: 'In attesa di una tua risposta', permission: 'In attesa di un tuo permesso', command: 'In attesa di un tuo comando',
  user: 'In attesa dell’utente', colleagues: 'In attesa dei colleghi', work: 'In attesa del lavoro in corso',
  report: 'In attesa del report finale', mail: 'In attesa di posta', browser: 'In attesa di te nel browser',
};

/** The final answer of the turn that just ended ('' when it wrote none). */
export function lastAnswer(items: readonly ChatItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'user') break;
    if (it.kind === 'assistant' && it.text.trim()) return it.text;
  }
  return '';
}

interface Rec {
  s: ChatSummary;
  createdAt: number;
  /** Result receipts bind delayed engine accounting to the run that produced them. */
  turnAccounting?: { seen: Set<string>; pending: (AgentRun | null)[] };
  /** its latest report to its Orchestrator (send_to_chat, or a run-report block): a clean idle after it completes the
   *  assignment (#86, ADR 0084); never persisted */
  report?: { text: string; at: number; blocked?: boolean };
  /** a delegated child asked its parent (agent_ask_parent) and no agent message reached it since: its turn ending
   *  without agent_report waits for the answer, it does not owe the report yet (#152) */
  askedParentAt?: number;
  /** a delegated child was told once that its turn ended without agent_report (#152): the next such end closes it */
  reportNudged?: boolean;
  /** the run whose done-criteria the engine was already given (taskHint, #170) */
  criteriaTold?: string;
  /** a root chat's agent_report for its current assignment (reportRoot): one per assignment */
  rootReportAt?: number;
  /** a root chat's result held until its turn ends (reportRoot, #123): the report and the turn end are one news */
  userTaskEvents?: UserTaskEvents;
  heldResult?: { local?: boolean; note: CleanReportNote; message: string; quiet: boolean; userWaits: boolean };
  /** a root chat the Orchestrator opened or assigned in a turn the user's own message started: the user waits for its
   *  answer, so its clean result shows as the app's notice in the Orchestrator's chat (#123); never persisted */
  userWaits?: boolean;
  /** the Orchestrator: its current (or last) turn was started by the user's own message, not by app news or mail */
  turnFromUser?: boolean;
  /** the app completed its assignment from that report: a new message from its Orchestrator assigns it again */
  autoCompleted?: boolean;
  agentInstructions?: string;
  agentAssets?: { pluginDir: string; skillRoot: string };
  /** ADR 0103: the files before each recent turn (checkpoints.ts), newest last; its repository's top folder (null = not
   *  a git work tree: no checkpoints); a note for the next message after the user undid a turn */
  checkpoints?: Checkpoint[];
  /** the turn going on now has its own checkpoint (auto-permit lets edits and commands through only then) */
  turnCheckpoint?: boolean;
  /** the session whose first API call was counted already (context-stats.ts cache) */
  cacheSession?: string;
  gitRoot?: string | null;
  /** child results a quit held back (shutdown), sent after the next start (resumeInterrupted) */
  heldResults?: HeldChildResult[];
  /** the end-of-turn record of the last checkpoint, while git writes it (recordTurnEnd) */
  afterPending?: Promise<void> | undefined;
  /** the run's receipts (ADR 0130): tool rows already noted, the checkpoint whose turn files are in, a turn's files
   *  still being read (the verdict waits for them) */
  receiptRows?: Set<string>;
  receiptCp?: Checkpoint;
  receiptsBusy?: boolean;
  undoNote?: string;
  /** the roles this chat's role may launch (resolved at creation; absent = unknown, e.g. a chat saved before) */
  launches?: string[];
  /** the skills its launch gave it (role defaults, linked and the launch's own): the role gate allows only these */
  skills?: string[];
  /** the agent's tool policy and permission ceiling, frozen at start like its instructions (A2) */
  policy?: AgentPolicy | null;
  /** a delegated chat's ancestors' catalog roles (parent first), frozen at its creation and persisted: its managed MCP
   *  access stays bounded by them after the parent closes or is pruned (ADR 0086) */
  mcpAncestors?: (string | null)[];
  /** the agent's "Contesto massimo" (tokens): the compaction window of its engine instead of the user's setting (#80) */
  maxContext?: number;
  /** the session whose context holds the role text and that text's hash (persisted): sent once per context, again only
   *  in a new session, after a compaction or when the role text changed */
  rolePrimed?: { session: string; sig: string } | undefined;
  /** the reply language this chat was last told (persisted, ADR 0120): a change goes in one line on its next turn */
  replyLang?: Lang;
  /** the role text was compared with rolePrimed since the engine started */
  roleChecked?: boolean;
  children?: AgentChildrenReducer;
  deliveryHolds?: number;
  activityRevision?: number;
  autoActivityAt?: number;
  autoClosing?: boolean;
  autoEnding?: boolean;
  /** last start or message: an idle engine is released this long after it (releaseIdle) */
  activeAt?: number;
  /** last transcript item: a delegated child's stall check (agents/delegation.ts stalledMin) */
  eventAt?: number;
  /** its engine is ending because it sat idle: the chat stays 'idle', the next message waits for it, then resumes */
  releasing?: Promise<void> | undefined;
  /** permissionMode null = no choice: the CLI follows the user's settings.json (ADR 0002) */
  choice: { model: string | null; effort: Effort | null; permissionMode: PermissionMode | null };
  forkFrom?: string;
  worktree: boolean;
  /** the chat was created with "Worktree separato": its work is in a worktree the CLI made, not in cwd */
  inWorktree?: boolean;
  costTotalUsd: number;
  /** Lampo (ADR 0106): the Orchestrator's items its engine already got, by engine (a new engine gets them again) */
  lampoSeen?: { session: HarnessSession; cursor: LampoCursor } | undefined;
  items: ChatItem[];
  pending: Map<string, PendingRequest>;
  session: HarnessSession | null;
  /** the "/" commands its engine reported (in memory: a new engine reports them again) */
  commands?: ChatCommand[];
  /** engines ended while the chat went on (model or Orchestrator change, continued): their tools are reaped at the real close */
  kept?: HarnessSession[];
  historyLoaded: boolean;
  /** a job not started yet (a chat created in this run): its first send gets the first prompt */
  jobNew: boolean;
  firstPrompt: string | null;
  /** a turn ran since the last onDone */
  turnSinceDone: boolean;
  /** a resumed session still opening (sends wait for it) */
  opening?: Promise<void> | undefined;
  /** an archive closing the session (a send waits for it, then reopens the chat on a new session) */
  archiving?: Promise<void> | undefined;
  /** a turn is running (persisted): set when the CLI reports running/waiting, cleared by its result, a CLI exit
   *  while the app runs, or an archive; still set after a quit or crash = resume it on the next start */
  working?: boolean;
  /** close the session when this turn ends, so the next message reopens it (Cursor: the new --model; a former Orchestrator:
   *  without the app-control tools) */
  reopen?: boolean;
  /** the end of the last real turn (not a hand-off turn): a hand-off older than this is stale */
  lastTurnAt: number;
  /** a hand-off turn in flight: the assistant texts it produced, and who waits for them; quiet = a cold note (ADR
   *  0031): its items stay out of the tile */
  handoffTurn?: { texts: Map<string, string>; done: (text: string | null) => void; quiet?: boolean } | undefined;
  /** the saved hand-off is a cold note written at this time (persisted): a message after the cache expired goes on
   *  in a fresh session from it */
  coldNoteAt?: number | undefined;
  /** the lastTurnAt the cold note was asked for (once per idle stretch, even when it failed) */
  coldAskedFor?: number | undefined;
  /** when the context in force began: the first real turn since the session start or the last compaction (persisted) */
  ctxSince?: number | undefined;
  /** the Rome day an Orchestrator was last asked for its day compaction (once a day, even when it failed) */
  dayCompactOn?: string | undefined;
  /** the sessions before its cold continuations, oldest first (persisted; their transcripts show folded above) */
  pastSessions?: PastSession[];
  /** a cold continuation switching sessions: a second message waits for it */
  switching?: Promise<ColdStep | null> | undefined;
  /** archived by the auto-close while it waited for its cold note: its engine ends once the note is written */
  closeAfterCold?: boolean;
  /** the next API calls count as "after" a continuation or a compaction (ADR 0031 counters) */
  after?: { kind: 'continuation' | 'compaction'; left: number } | undefined;
  /** the last hand-off turn ended in an error or was stopped by the user: a "Riprendi" waiting on it is cancelled */
  handoffStopped?: boolean;
  /** request ids its agent run already counted (a request the engine reports again is one request) */
  runSeen?: Set<string>;
  /** the last time nothing waited on the user any more: a run's stale clock pauses while a request is open */
  idleSince?: number;
  /** open "Comando da eseguire" requests (run/asks.ts keeps them, not r.pending): they pause the stale clock too */
  commandsOpen?: Set<string>;
  /** since when the chat runs a turn of its open agent run (its execution time; not persisted: a quit cuts the turn) */
  runningSince?: number;
  /** when the current turn started running: a run ended during it (completed by its Orchestrator) still takes its report */
  turnAt?: number;
  /** its run (this id) was pruned into the rollups: counted there only (the mirror stays in chats.json) */
  runPruned?: string;
}

/** A cold switch in flight (coldSwitch → ensureSession → coldDone / coldUndo): the note, the old session, what to restore. */
interface ColdStep {
  h: HandoffInfo; old: string | null; at: number; idleMin: number; notePath: string;
  prev: { forkFrom: Rec['forkFrom']; costTotalUsd: Rec['costTotalUsd']; contextTokens: number | undefined; contextMaxTokens: number | undefined; coldNoteAt: number | undefined; after: Rec['after'] };
}

/** The divider of a cold continuation (ADR 0031): the same id live and when the history is read again. */
const coldDivider = (fromSession: string, at: number, notePath: string): ChatItem => ({
  kind: 'system', id: `cont-${fromSession}`, at, level: 'info', continued: { notePath, ...(isUuid(fromSession) ? { session: fromSession } : {}) },
  text: sysEn('coldContinued'), code: 'coldContinued',
});

/** A system ChatItem from a code + params (sys.ts): text is the English rendering, for agents, logs and old items. */
function sysItem<C extends SysCode>(code: C, params: SysParams | undefined, level: 'info' | 'warn' | 'error'): ChatItem {
  return { kind: 'system', id: nextId('s'), at: Date.now(), text: sysEn(code, params), level, code, params };
}

const MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'];
/** chat-endpoint tools the Orchestrator can never use (chatToolShown): it does not delegate, report, ask a parent or
 *  rate a child (its chats are roots: agent_child_feedback takes only a child's run), and
 *  agent_catalog / agent_learn_propose are on its own endpoint already */
const ORCHESTRATOR_HIDDEN: ReadonlySet<string> = new Set(['plan_propose', 'plan_update', 'agent_delegate', 'agent_assign_task', 'agent_task_events', 'agent_report', 'agent_ask_parent', 'agent_answer_child', 'agent_children', 'agent_child_feedback', 'agent_catalog', 'agent_learn_propose',
  // it saves scripts with brain_script_save on its own endpoint
  'brain_script_add']);
/** the tools only a chat that may delegate can use (chatToolShown): a role that launches no role (Scout, Judge) never
 *  sees them (~1 500 tokens of schemas in every call, each call refused) */
const DELEGATING_ONLY: ReadonlySet<string> = new Set(['agent_delegate', 'agent_assign_task', 'agent_task_events', 'agent_children', 'agent_answer_child', 'agent_child_feedback', 'agent_catalog', 'skills_suggest']);
/** the Strategist's plan tools (agents/strategy-tools.ts): shown only where a plan with the user exists */
const PLAN_TOOLS: ReadonlySet<string> = new Set(['plan_propose', 'plan_update']);
/** a root chat's deliverable longer than this reaches the Orchestrator as where to read it, not whole (it is the chat's answer
 *  there; the Orchestrator re-reads every message in each later turn) */
const ORCHESTRATOR_OUTPUT_MAX = 800;
/** «Lampo», the quick lane (ADR 0105): its title, tools and frame */
export const LAMPO_TITLE = 'Flash';
const LAMPO_POLICY: AgentPolicy = { tools: { allow: ['read', 'web'] }, ceiling: 'plan' };
/** the chat-endpoint tools Lampo never sees (chatToolShown), beside every agent_* tool */
const LAMPO_HIDDEN: ReadonlySet<string> = new Set([...APP_CHAT_TOOLS, 'brain_script_add', 'brain_query_add', 'skills_suggest']);
const LAMPO_FRAME = 'You are Flash, the quick lane of the user\'s second-brain app. Answer fast and briefly, in the user\'s language, from what you know and quick reads (Read, Grep, Glob, the web). Like a "btw": each question may come with the Orchestrator\'s conversation since you last looked; use it to answer about the work in progress, never act on it or answer it. You change nothing and start no work: no edits, no commands, no plans. When a request needs changes, many steps or other chats, say so in one line: the user hands it to the Orchestrator with «Fanne un lavoro».';
/** A role launch with Claude's sub-agent tool (tool-policy.ts claudeTools) gets the role gate's sub-agent rule as a
 *  PreToolUse hook: Claude starts a sub-agent without a permission request (role-gate.ts SubagentGate). */
const subagentGateFor = (tools: AgentPolicy['tools'] | null | undefined): Pick<SessionOptions, 'preToolUse'> =>
  tools && claudeTools(tools).includes('Agent') ? { preToolUse: new SubagentGate() } : {};
/** how long a child's result waits for its siblings' before it goes to the parent alone */
const CHILD_RESULTS_MS = 60_000;
/** what a root chat's clean result tells the Orchestrator (onCleanReport) */
export interface CleanReportNote { chatId: string; title: string; role: string; summary: string; at: number }
/** archived chats kept (the oldest beyond this leave the app; their transcripts stay where the CLI keeps them) */
const MAX_ARCHIVED = 60;
/** the user's words carried in a note (ADR 0083: the user's own message, never the child's) */
export const USER_NOTE_MAX = 300;
export const USER_NOTES_LABEL = "[nota dell'app · l'utente ha scritto direttamente in chat che hai delegato: tienine conto nel piano, non disfare ciò che le ha chiesto]";
/** One message the user typed in a work chat (userWrote): what the Orchestrator and the parent learn. */
export interface UserWroteNote { eventId: string; seq: number; chatId: string; title: string; role: string | null; parentId: string | null; parentTitle: string | null; at: number; text: string }
export const userNoteLine = (n: Pick<UserWroteNote, 'title' | 'role' | 'at' | 'text'>): string =>
  `- ${n.role ?? 'Chat'} «${n.title}», ${new Date(n.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}: «${n.text}»`;
/** A saved chat's owner: its snapshot, else a plain chat's (the Orchestrator always shows the Orchestrator's face). */
export function restoredOwner(c: Pick<StoredChat, 'agent' | 'harness' | 'model' | 'isOrchestrator'>): AgentOwnerSnapshot {
  const owner = c.agent ?? plainOwner(c.harness, c.model);
  return c.isOrchestrator && owner.id !== 'orchestrator' ? orchestratorOwner(c.harness, c.model) : owner;
}
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** A model id as the CLIs take it; never starting with '-', which an ACP CLI would read as one of its flags. */
const MODEL_ID = /^[\w.:@/[\]][\w.:@/=[\],-]{0,119}$/;

/** The run tags a new chat asks for (AGENTS-DESIGN §4.8): refused before anything starts when out of shape. */
export function startTags(req: Pick<NewChat, 'skills' | 'app'>): Omit<AgentRunTags, 'repo'> {
  if (req.skills !== undefined && (!Array.isArray(req.skills) || req.skills.some(s => typeof s !== 'string' || !SKILL_ID.test(s)))) throw new Error('Skill non valide: usa id minuscoli (lettere, cifre, - e _) fino a 80 caratteri.');
  const skills = [...new Set(req.skills ?? [])];
  if (skills.length > SKILLS_MAX) throw new Error(`Al massimo ${SKILLS_MAX} skill per chat.`);
  const app = typeof req.app === 'string' ? req.app.trim() : req.app;
  if (app !== undefined && app !== '' && !tagName(app, APP_MAX)) throw new Error(`App non valida: una riga fino a ${APP_MAX} caratteri.`);
  return { skills, app: app || null };
}
/** git top-level folder names per cwd: found by walking up to a `.git` entry (no git process), cached for the session. */
const repoCache = new Map<string, string | null>();
export function repoOf(cwd: string): string | null {
  const key = path.resolve(cwd);
  const known = repoCache.get(key);
  if (known !== undefined) return known;
  let found: string | null = null;
  for (let dir = key; ;) {
    try { if (fs.existsSync(path.join(dir, '.git'))) { const name = path.basename(dir); found = tagName(name, REPO_MAX) ? name : null; break; } } catch { break; }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (repoCache.size >= 256) repoCache.delete(repoCache.keys().next().value!);
  repoCache.set(key, found);
  return found;
}

export class ChatManager implements ChatService {
  readonly submissionReceipts = true;
  readonly analytics: AgentAnalyticsCollector;
  /** agent-runs.json: the runs of chats started from catalog agents (AGENTS-DESIGN §1.2, §5) */
  readonly runs: AgentRunStore;
  private runTimer: NodeJS.Timeout | null = null;
  private chats = new Map<string, Rec>();
  private deliveries = new Map<string, Promise<void>>();
  private synthesizing = new Set<string>();
  private synthesisRetry = new Map<string, NodeJS.Timeout>();
  /** Flash moving to its card's engine (flashFollow): the new chat's id, for a question sent meanwhile */
  private flashMoving: Promise<string> | undefined;
  /** notes for a chat's next message (the user wrote in one of its delegated children): they ride along, no turn of their own */
  private notesFor = new Map<string, string[]>();
  private userWroteListeners: ((n: UserWroteNote) => void)[] = [];
  private cleanReportListeners: ((n: CleanReportNote) => boolean)[] = [];
  /** children's results waiting for their siblings', per parent (queueChildResult) */
  private childResults = new Map<string, { items: HeldChildResult[]; timer: NodeJS.Timeout | null }>();
  /** "Riprendi" in flight per old chat: a double click or two agents get the same new chat, never two. */
  private continuing = new Map<string, Promise<ChatSummary>>();
  private store: ChatStore;
  private handoffs: HandoffStore;
  private home: string;
  private max: number;
  private version: string | null = null;
  private probing = false;
  private killedPids = new Set<number>();
  private quitting = false; // shutdown started: a CLI exit now is the quit's, its cut turn resumes on the next start
  private coalesce = new Map<string, { items: Map<string, ChatItem>; timer: NodeJS.Timeout }>();
  private lastUsageAt = 0;
  private usageTimer: NodeJS.Timeout | null = null;
  private lastUsageChat: string | null = null;
  private coldTimer: NodeJS.Timeout | null = null;
  private readonly counters: ContextCounters;
  private readonly onExit = (): void => { this.killAll(true); };
  /** the CPU queue (ADR 0036); null = not wired: everything runs at once */
  private readonly admission: AdmissionQueue | null;
  // no engine is started ahead while the machine is busy or chats wait in the CPU queue (ADR 0036)
  /** the chat id of the warm engine being spawned now (spawnWarm), before the pool holds it */
  private warmChat: string | null = null;
  /** the launch of each waiting engine by its chat id, until a chat adopts it */
  private readonly warmViews = new Map<string, WarmLaunch>();
  private readonly warm = new WarmPool({ spawn: (cwd, launch) => this.spawnWarm(cwd, launch), enabled: () => !!this.opts.prewarm && !this.quitting && !updateActivity.frozen && !this.admission?.busy() && this.opts.engineOn?.('claude') !== false });

  constructor(private readonly opts: ChatManagerOptions) {
    this.analytics = new AgentAnalyticsCollector(opts.userData);
    this.runs = new AgentRunStore(opts.userData);
    if (this.runs.problem) log.warn('chats', 'agent runs file unreadable', { cause: this.runs.problem, hint: 'move agent-runs.json aside to record runs again' });
    // a pruned run lives on in the rollups only: a chat mirror of it would be adopted back and counted twice
    this.runs.onPrune = ids => {
      let any = false;
      for (const r of this.chats.values()) if (r.s.run && ids.has(r.s.run.runId)) { r.runPruned = r.s.run.runId; delete r.s.run; delete r.runningSince; any = true; this.updated(r); }
      if (any) this.persist();
    };
    this.store = new ChatStore(opts.userData);
    this.admission = opts.admission ? new AdmissionQueue({ ...opts.admission, onChange: () => this.refreshQueued() }) : null;
    this.handoffs = new HandoffStore(opts.userData);
    this.counters = new ContextCounters(opts.userData);
    this.home = opts.claudeHome ?? claudeHome();
    this.max = opts.maxItems ?? 2000;
    const stored = this.store.load();
    for (const c of stored) this.chats.set(c.id, this.restore(c));
    if (stored.some(c => !c.agent)) this.persist();
    process.on('exit', this.onExit); // Windows keeps orphaned children alive: kill them when the app dies
    // the plan windows stay fresh in the top bar even while a long turn runs (get_usage spends no model call)
    if (opts.onRateLimit) { this.usageTimer = setInterval(() => this.askUsage(), opts.usageEveryMs ?? 60000); this.usageTimer.unref?.(); }
    if ((opts.coldEveryMs ?? 60_000) > 0) { this.coldTimer = setInterval(() => this.coldTick(), opts.coldEveryMs ?? 60_000); this.coldTimer.unref?.(); }
    if ((opts.runEveryMs ?? 600_000) > 0) { this.runTimer = setInterval(() => this.staleRuns(), opts.runEveryMs ?? 600_000); this.runTimer.unref?.(); }
    if (opts.prewarm) {
      const last = [...this.chats.values()].filter(r => !!engineOf(r.s.harness)?.caps.warm && r.s.origin === 'app' && !r.s.isOrchestrator).sort((a, b) => b.createdAt - a.createdAt)[0];
      if (last && fs.existsSync(last.s.cwd)) this.warm.schedule(last.s.cwd, opts.prewarmDelayMs ?? 20000);
      // the Orchestrator's engine resumes ahead of the user's first message of the day: no 10-17 s start then, and an idle
      // engine makes no model call
      const t = setTimeout(() => this.prewarmOrchestrator(), opts.prewarmDelayMs ?? 20000);
      t.unref?.();
    }
    const claude = resolveClaude(opts.enginePaths?.claude ?? null);
    log.info('chats', 'manager ready', { data: { restored: this.chats.size, claude: claude ? `${claude.source}: ${claude.path}` : 'not found', overrides: opts.enginePaths ?? null } });
  }

  // ---- ChatService ----

  list(): ChatSummary[] {
    return [...this.chats.values()].sort((a, b) => a.createdAt - b.createdAt).map(r => { this.refreshTaskSummary(r); return { ...r.s }; });
  }

  items(chatId: string): ChatItem[] {
    const r = this.chats.get(chatId);
    if (!r) return [];
    this.ensureHistory(r);
    return r.items.slice();
  }

  /** Full instructions plus an optimistic cursor; reading never marks them acknowledged. */
  userEvents(chatId: string, afterSeq = 0): UserTaskEvents {
    const ledger = this.need(chatId).userTaskEvents ?? { events: [], latestSeq: 0, acknowledgedSeq: 0 };
    if (ledger.latestSeq === Number.MAX_SAFE_INTEGER) throw new Error('The persisted user event ledger is invalid; restore it before assigning work.');
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || afterSeq > ledger.latestSeq) throw new Error('Invalid event cursor.');
    return structuredClone({ ...ledger, events: ledger.events.filter(event => event.seq > afterSeq) });
  }

  private refreshTaskSummary(r: Rec): void {
    if (r.userTaskEvents) r.s.userEvents = { latestSeq: r.userTaskEvents.latestSeq, acknowledgedSeq: r.userTaskEvents.acknowledgedSeq };
    if (!r.s.isOrchestrator) {
      const local = this.runs.list().filter(run => run.chatId === r.s.id && run.startedBy === 'user' && !run.parentRunId && run.report?.canonical);
      r.s.availableResultIds = local.filter(run => !run.delivery?.synthesisSubmittedAt).map(run => run.runId);
      r.s.pendingResultIds = local.filter(run => !run.delivery?.displayedAt || run.delivery?.synthesisPending).map(run => run.runId);
      return;
    }
    const roots = this.runs.list().filter(run => run.startedBy === 'orchestrator' && !run.parentRunId && run.report?.canonical && !this.chats.get(run.chatId)?.s.parentId);
    r.s.availableResultIds = roots.filter(run => !run.delivery?.synthesisSubmittedAt).map(run => run.runId);
    r.s.pendingResultIds = roots.filter(run => !run.delivery?.displayedAt || run.delivery?.synthesisPending).map(run => run.runId);
  }

  /** The commands its engine reported, null when it has not reported any yet (the caller falls back to the disk). */
  commands(chatId: string): ChatCommand[] | null {
    return this.chats.get(chatId)?.commands ?? null;
  }

  /** The tool policy and ceiling this chat runs with (null = none: the engine's own gates); agent_delegate bounds a child by it. */
  agentPolicy(chatId: string): AgentPolicy | null { const p = this.chats.get(chatId)?.policy; return p ? structuredClone(p) : null; }
  pending(): PendingRequest[] {
    return [...this.chats.values()].flatMap(r => [...r.pending.values()]).sort((a, b) => a.at - b.at);
  }

  /** links = the run links an Orchestrator tool sets (A7): refused before anything starts when one names an unknown run. */
  /** by: who asks; 'app' = one of the app's own jobs (the Judge's sampled reviews): like an agent, its run says startedBy 'app' */
  async create(req: NewChat, by: 'user' | 'agent' | 'app' = 'user', inherited?: { owner: AgentOwnerSnapshot; instructions: string; policy?: AgentPolicy | null; assets?: { pluginDir: string; skillRoot: string }; skills?: string[]; maxContext?: number }, links: RunLinks = {}, opts: { boundByOrchestrator?: boolean; continuation?: boolean } = {}): Promise<ChatSummary> {
    const createdT0 = Date.now();
    this.deliveryPolicy(req.deliveryPolicy, !!req.parentId);
    if (req.doneWhen && (req.doneWhen.length > 12 || req.doneWhen.some(x => typeof x !== 'string' || !x.trim() || x.length > 300))) throw new Error('Invalid task criteria.');
    updateActivity.assertOpen();
    links = { ...links, ...(req.parentRunId !== undefined ? { parentRunId: req.parentRunId } : {}), ...(req.reviewOf !== undefined ? { reviewOf: req.reviewOf } : {}), ...(req.reworkOf !== undefined ? { reworkOf: req.reworkOf } : {}) };
    if (req.goal !== undefined && (typeof req.goal !== 'string' || !req.goal.trim() || req.goal.length > 2000)) throw new Error('Run goal must contain 1 to 2000 characters.');
    if (Object.values(links).some(v => v !== undefined)) this.runs.checkLinks(links);
    const asked = startTags(req);
    if (req.quick) {
      if (by !== 'user' || req.orchestrator || req.parentId || req.roleId) throw new Error('Flash: only the user opens it, as a plain chat.');
      const current = this.list().find(c => c.quick && !c.closedAt);
      if (current) return current;
      req = { ...req, title: LAMPO_TITLE, permissionMode: 'plan' };
    }
    if (req.orchestrator) {
      if (by !== 'user') throw new Error('Only the user can create the Orchestrator.');
      const current = this.list().find(c => c.isOrchestrator && !c.closedAt);
      // one Orchestrator: only a replacement of the current one (Cambia motore, Ricomincia) creates another
      if (current && req.replaces !== current.id) return current;
      req = { ...req, orchestrator: true, title: ORCHESTRATOR_TITLE };
    }
    const agent: Pick<ResolvedRole, 'request' | 'owner' | 'instructions' | 'policy' | 'maxContext' | 'tier'> & { skills?: string[]; launches?: string[]; assets?: { pluginDir: string; skillRoot: string } } = inherited ? { ...inherited, policy: inherited.policy ?? null, request: req }
      // Lampo reads and answers: read and web tools only, plan mode (no edit, no command, no popup), its own short frame
      // Flash (ADR 0107): its card's engine, model and instructions, under the fixed frame and the read-only policy
      : req.quick ? this.flashAgent(req)
      : this.opts.resolveAgent?.(req) ?? { request: req, owner: plainOwner(req.harness, req.model ?? null), instructions: '', policy: null };
    req = agent.request;
    // a delegated chat (agent_delegate): only an agent's, under a live parent, in the parent's folder, linked to its run
    const delegator = req.parentId !== undefined ? await this.delegator(req, by, opts.continuation === true) : undefined;
    if (delegator?.s.run) links = { ...links, parentRunId: delegator.s.run.runId };
    // never wider than the chat it comes from: a fork of its session (and an Orchestrator renewed without a role policy).
    // A root chat the Orchestrator opens is bound by its own role (and the user's defaults), not by the Orchestrator's
    // policy: the Orchestrator plans, the Artisan it starts writes (ADR 0083)
    const forkSrc = req.resumeSessionId?.trim() ? [...this.chats.values()].find(r => r.s.sessionId === req.resumeSessionId?.trim()) : undefined;
    // a chat from the unauthenticated /mcp/app mount (any local process can call it) runs no wider than the Orchestrator
    const bound = opts.boundByOrchestrator ? [...this.chats.values()].find(r => r.s.isOrchestrator && !r.s.closedAt) : undefined;
    if (opts.boundByOrchestrator && !bound) throw new Error('Senza un Orchestrator aperto questo endpoint non apre chat.');
    // a new Orchestrator the user starts (Ricomincia, Cambia motore) runs its role as the catalog says now (the user edits
    // it in Agenti, ADR 0085): the old chat's frozen policy bounds it only when the role has none
    const renewed = req.orchestrator && by === 'user' && !!agent.policy;
    const parent = delegator ?? forkSrc ?? (req.replaces && !renewed ? this.chats.get(req.replaces) : undefined) ?? bound;
    // a delegated chat: its role's policy, below its parent's, narrowed again by the contract's tool classes. A chat from
    // the unauthenticated mount reads only, in plan mode, whatever the Orchestrator may (ADR 0085: the Orchestrator's
    // default is every permission, the mount is any local process)
    const policy = delegator ? narrowest(belowParent(agent.policy, delegator.policy, this.modeFor(delegator)), req.delegation?.tools ? { tools: { allow: req.delegation.tools }, ceiling: null } : null)
      : narrowest(agent.policy, parent === bound && bound ? narrowest(bound.policy, FAIL_CLOSED) : parent?.policy);
    // an explicit mode above the agent's ceiling runs at the ceiling (the chat shows the mode it really has)
    if (policy && req.permissionMode && aboveCeiling(req.permissionMode, policy.ceiling)) req = { ...req, permissionMode: policy.ceiling! };
    const engine = engineOrThrow(req.harness);
    this.needOn(engine.id);
    const caps = engine.caps;
    const cwd = typeof req.cwd === 'string' ? req.cwd.trim() : '';
    if (!cwd || !path.isAbsolute(cwd) || !fs.existsSync(cwd)) throw new Error(`Cartella non valida: ${cwd || '(vuota)'}`);
    if (req.permissionMode && !MODES.includes(req.permissionMode)) throw new Error(`Modalità permessi non valida: ${req.permissionMode}`);
    if (req.effort && !EFFORTS.includes(req.effort)) throw new Error(`Effort non valido: ${req.effort}`);
    if (!caps.effort && req.effort) throw new Error(`L’effort non si imposta con ${engine.label}: scegli il modello.`);
    if (req.model !== undefined && !MODEL_ID.test(req.model)) throw new Error(`Modello non valido: ${req.model}`);
    // only a copy of one of the app's own Claude chats (ADR 0010: no sessions from other apps; never two writers)
    const forkOf = req.resumeSessionId?.trim() || null;
    if (forkOf) {
      const src = [...this.chats.values()].find(r => r.s.sessionId === forkOf);
      if (!req.fork || !caps.fork || !isUuid(forkOf) || !src || src.s.harness !== req.harness) throw new Error('Si può solo duplicare (fork) una chat dell’app, sullo stesso motore, se il motore lo permette.');
    }

    // a new Claude chat adopts an engine already waiting in its folder and launched like it (warm.ts): no 10-25 s
    // start-up. A role's tools, ceiling, skills plugin and "Contesto massimo" are fixed when the engine starts (#80), so
    // only an engine launched with the same ones fits (launchSig)
    // a delegated chat takes only an engine launched for a child of the same role under the same role chain: its
    // endpoint lists the child's tools (agent_ask_parent) and its managed MCP servers are bounded by those ancestors
    const warmable = caps.warm && !forkOf && !req.worktree && !req.orchestrator && req.permissionMode !== 'bypassPermissions';
    const ancestors = delegator ? this.mcpContext(delegator.s.id)?.roles ?? null : undefined;
    const role = agent.owner?.source === 'catalog' ? agent.owner.id : null;
    const launch = this.warmLaunch(policy, agent.assets, agent.maxContext, delegator ? (ancestors ? { role, launches: agent.launches ?? null, child: { ancestors } } : undefined)
      : policy ? { role, launches: agent.launches ?? null } : undefined);
    // a child whose parent has no known role chain starts cold, as before (fail closed: no managed server)
    const childOk = !delegator || !!ancestors;
    const warm = warmable && childOk ? this.warm.take(cwd, launch.sig) : null;
    const id = warm?.chatId ?? `c_${crypto.randomBytes(5).toString('hex')}`;
    const now = Date.now();
    // `replaces`: the new Orchestrator takes the role, the old one goes on as a normal chat (history kept, never deleted)
    const old = req.orchestrator && req.replaces ? this.chats.get(req.replaces) : undefined;
    if (req.orchestrator && req.replaces && !old?.s.isOrchestrator) throw new Error('L’Orchestrator da sostituire non c’è più.');
    const title = req.title?.trim() || (req.prompt?.trim() ? cut(req.prompt, 50) : forkOf ? 'Fork' : 'Nuova chat');
    // an agent's chat with a prompt starts with its first message, through the CPU queue (ADR 0036); a warm engine is
    // already running: adopting it is no new start (its first turn still asks the queue)
    const given = req.prompt?.trim() ? req.prompt : null;
    // a Sentinel checks a change: the app gathers it (branch, base, commits, files, diff) instead of 5-15 git calls
    const pack = given && agent.owner.source === 'catalog' && agent.owner.id === 'sentinel' && this.opts.reviewPack
      ? await this.opts.reviewPack(cwd).catch(e => { log.warn('chats', 'review pack not gathered', { cause: errText(e), hint: 'the Sentinel reads the change itself' }); return ''; }) : '';
    // a Strategist the Orchestrator opens for the user (its «Strategist» send mode) asks the user, proposes a plan and
    // shows its progress on its strip (ADR 0108): the app's fixed flow follows the request, the plan starts asking
    const strategist = by === 'agent' && agent.owner.source === 'catalog' && agent.owner.id === 'strategist' && !delegator && !req.orchestrator;
    const prompt = given && pack ? `${given}\n\n${pack}` : given && strategist ? `${given}\n\n${STRATEGY_FLOW}` : given;
    // a root chat the Orchestrator opens while answering the user's own message is the user's request: like his own
    // messages (ADR 0036) it never waits for the CPU queue (a start of 10-25 s was then followed by the queue's wait)
    const forUser = by === 'agent' && !delegator && !req.orchestrator && this.orchestratorAnswering();
    const viaQueue = by !== 'user' && !forUser && !!prompt && !!this.admission;
    const r: Rec = {
      s: {
        agent: agent.owner,
        ...(by !== 'user' ? {work:{status:'assigned' as const,updatedAt:now}} : {}),
        effortStatus: initialEffort(caps.effort, req.effort ?? null),
        id, harness: req.harness, origin: 'app', title, cwd, sessionId: forkOf || !caps.transcript ? null : warm?.sessionId ?? crypto.randomUUID(),
        model: req.model ?? null, effort: req.effort ?? null, permissionMode: req.permissionMode ?? null,
        // a chat that goes through the queue has started nothing yet: 'starting' only with an engine on its way (a queued
        // chat that went starting → idle read as a finished turn: the Orchestrator was told "ha finito il turno", 2026-10-14)
        state: viaQueue && !warm ? 'idle' : 'starting', costUsd: 0, pending: 0, isOrchestrator: !!req.orchestrator, lastText: '', updatedAt: now, browserTabIds: [],
        ...(req.quick ? { quick: true as const } : {}),
        ...(caps.cost ? {} : { costKnown: false as const }),
        ...(req.route ? { route: req.route } : {}),
        ...(delegator ? { parentId: delegator.s.id, ...(req.delegation ? { delegation: req.delegation } : {}) } : {}),
        ...(strategist && given ? { plan: { phase: 'asking' as const, clarified: [], steps: [], at: now } } : {}),
      },
      createdAt: now,
      agentInstructions: agent.instructions,
      ...(agent.assets ? { agentAssets: agent.assets } : {}),
      ...(agent.assets && agent.skills ? { skills: agent.skills } : {}),
      ...(agent.launches && agent.owner.source === 'catalog' ? { launches: [...agent.launches] } : {}),
      ...(policy ? { policy } : {}),
      // a delegated chat freezes its parent's role chain now (a parent with no chain: the child has none either and,
      // once the parent is gone, no managed MCP server at all)
      ...(delegator && this.mcpContext(delegator.s.id) ? { mcpAncestors: this.mcpContext(delegator.s.id)!.roles } : {}),
      ...(agent.maxContext ? { maxContext: agent.maxContext } : {}),
      choice: { model: req.model ?? null, effort: req.effort ?? null, permissionMode: req.permissionMode ?? null },
      ...(forkOf ? { forkFrom: forkOf } : {}),
      worktree: !!req.worktree && caps.worktree,
      ...(req.worktree && caps.worktree ? { inWorktree: true } : {}),
      costTotalUsd: 0,
      items: [], pending: new Map(), session: null, historyLoaded: false,
      jobNew: true, firstPrompt: null, turnSinceDone: false, lastTurnAt: 0,
    };
    if (agent.owner.source === 'catalog' && !req.orchestrator) this.startRun(r, { agentId: agent.owner.id, version: agent.owner.version ?? 1, goal: req.goal ?? prompt ?? title, startedBy: delegator ? 'parent' : by === 'app' ? 'app' : by === 'agent' ? 'orchestrator' : 'user', costKnown: caps.cost, ...links,
      tags: { ...asked, repo: repoOf(cwd) }, ...(agent.tier ? { tier: agent.tier } : {}), model: req.model ?? null });
    if (r.s.run) { r.s.run.taskContract = { ...(by === 'app' && req.doneWhen !== undefined ? { reportExpected: true } : {}), goal: r.s.run.goal, doneWhen: req.doneWhen ?? req.delegation?.doneWhen ?? [], deliveryPolicy: this.deliveryPolicy(req.deliveryPolicy, !!delegator) }; this.runSave(); }
    if (r.s.run?.startedBy === 'app' && r.s.run.reviewOf && r.s.run.taskContract?.reportExpected && !r.s.work) r.s.work = { status: 'assigned', updatedAt: now };
    if (r.s.run && this.opts.suggestSkills) {
      try { r.s.run.skillSuggestions = { at: now, suggested: await this.opts.suggestSkills(r.s.run.goal), used: [] }; this.runSave(); }
      catch (e) { log.warn('chats', 'skill suggestion snapshot unavailable', { cause: errText(e), hint: 'the launch continues without a suggestion snapshot' }); }
    }
    // the Orchestrator opened it while answering the user's own message: the user waits for what it finds (#123)
    if (by === 'agent' && !delegator && r.s.run?.startedBy === 'orchestrator') r.userWaits = this.orchestratorAnswering();
    this.chats.set(id, r);
    if (r.s.isOrchestrator) { this.restoreRootNotices(); this.resumeRootSyntheses(); for (const worker of this.chats.values()) if (worker.heldResult && !this.midTurn(worker)) this.releaseResult(worker); }
    if (old) {
      this.demoteOrchestrator(old);
      // two chats titled "Orchestrator" would make its mailbox ambiguous (mail.ts liveChats): the old one gives the name up
      if (slugTitle(old.s.title) === slugTitle(title)) old.s.title = `Orchestrator precedente · ${old.s.id.slice(2)}`;
    }
    this.ensureHistory(r); // a fork shows the past it starts from
    this.persist();
    log.info('chats', 'chat created', { chat: id, data: { harness: req.harness, cwd, fork: !!forkOf, model: r.choice.model, permissionMode: r.choice.permissionMode, orchestrator: r.s.isOrchestrator, warm: !!warm, prepMs: Date.now() - createdT0, queued: viaQueue } });
    this.updated(r);
    if (warm) this.adoptWarm(r, warm); else if (!viaQueue) this.startSession(r);
    // the next chat like this one finds an engine waiting (a role's own launch; an Orchestrator, fork or bypass chat: a plain one)
    if (caps.warm) this.warm.schedule(cwd, this.opts.prewarmDelayMs ?? 5000, warmable && childOk ? launch : PLAIN_LAUNCH);
    // the chat exists from here on: a failed first send shows as state 'error' + lastError, not as a lost chat
    if (prompt) {
      // a delegated chat's contract says who sent it (the parent's title), like mail between chats
      const from = delegator?.s.title;
      try { await (viaQueue ? this.gate(r, () => this.deliver(id, prompt, undefined, false, from, false, undefined, this.taskHint(r, prompt, { kind: 'app' }))) : this.send(id, prompt, undefined, false, from, false, { kind: by === 'user' ? 'user' : 'app' })); } catch (e) {
        if (!r.s.lastError) r.s.lastError = errText(e);
        this.updated(r);
      }
    }
    return { ...r.s };
  }

  /** The live chat a delegated chat starts under (agent_delegate): it exists, is open and is not the Orchestrator (the
   *  Orchestrator opens root chats with app_create_chat), and the child's folder lies inside the parent's. */
  /** continuation: "Riprendi" of a delegated chat, by whoever clicks it: the successor is the same child of the same parent */
  private async delegator(req: NewChat, by: 'user' | 'agent' | 'app', continuation = false): Promise<Rec> {
    const parent = req.parentId ? this.chats.get(req.parentId) : undefined;
    if ((by !== 'agent' && !continuation) || !parent || parent.s.closedAt || parent.s.isOrchestrator) throw new Error('Delega rifiutata: la chat che delega non è una chat di lavoro aperta.');
    const cwd = typeof req.cwd === 'string' ? req.cwd.trim() : '';
    // the parent's folder, or a worktree of its repository (agents/worktrees.ts); git is asked only when it matters, and
    // the parent may have closed meanwhile
    if (!within(parent.s.cwd, cwd) && !withinParent(parent.s.cwd, cwd, this.opts.worktrees ? await this.opts.worktrees(parent.s.cwd) : [])) {
      throw new Error(`Delega rifiutata: la cartella deve stare dentro quella del genitore (${parent.s.cwd}) o in un worktree del suo repository.`);
    }
    if (parent.s.closedAt) throw new Error('Delega rifiutata: la chat che delega non è una chat di lavoro aperta.');
    return parent;
  }

  /** A message, optionally with images (pasted screenshots; checked here: images.ts). Text may be empty with images.
   *  resumed = the app's own "riprendi" after a restart (keeps the tile's mark; any other message clears it);
   *  from = not the user's: the sender shown above the bubble (another chat's title, the Orchestrator);
   *  liveOnly = mail (chats/mail.ts): never into a chat that has no engine or is closing, never reopens one */
  async send(chatId: string, text: string, images?: unknown, resumed = false, from?: string, liveOnly = false, source?: TaskSource, receipt?: SubmissionReceipt): Promise<void> {
    updateActivity.assertOpen();
    const r = this.need(chatId);
    // Flash follows its card (ADR 0107): the user's question goes to a Flash on the card's engine and model
    if (r.s.quick && from === undefined && !resumed && (!source || source.kind === 'user')) {
      const next = await this.flashFollow(r);
      if (next !== chatId) return this.send(next, text, images, resumed, from, liveOnly, source, receipt);
    }
    if (!(typeof text === 'string' && text.trim()) && !checkImages(images).length) throw new Error('Messaggio vuoto.');
    this.autoActivity(r);
    this.needAgentMay(r, from);
    if (!resumed && !liveOnly && r.s.run?.report?.via === 'agent_report' && this.midTurn(r) && (from === undefined && (!source || source.kind === 'user') || source?.kind === 'chat')) throw new Error('Il risultato è in fase di consegna: attendi la fine del turno e riprova.');
    if (!resumed && !liveOnly && r.s.run && (r.s.run.endedAt !== undefined || r.s.run.report?.via === 'agent_report' && !this.midTurn(r)) &&
      (from === undefined && (!source || source.kind === 'user') || source?.kind === 'chat' && (source.chatId === this.openOrchestrator()?.s.id || source.chatId === r.s.parentId))) {
      if (source?.kind === 'chat' && (source.chatId === this.openOrchestrator()?.s.id || (r.userTaskEvents?.latestSeq ?? 0) > (r.userTaskEvents?.acknowledgedSeq ?? 0))) throw new Error('Use app_assign_task for a follow-up; it checks role, project and current task version.');
      this.beginAssignment(r, text, { mode: isCorrection(text) ? 'rework' : 'continue', source: source ?? { kind: 'user' } });
    }
    // its parent's message (agent_answer_child, from = the parent's title) reached it: the answer it waited for
    if (from !== undefined && r.s.parentId && from === this.chats.get(r.s.parentId)?.s.title) delete r.askedParentAt;
    if (!resumed && from === undefined && (!source || source.kind === 'user')) this.userWrote(chatId, text);
    // Flash's outcomes (ADR 0131, zero tokens): the user's question to Flash decides its last answer (a correction, the
    // same question again); the user's own message to the Orchestrator may hand one over
    if (!resumed && from === undefined && (!source || source.kind === 'user') && typeof text === 'string' && (r.s.quick || r.s.isOrchestrator)) {
      this.runs.flashEvent({ kind: r.s.quick ? 'asked' : 'handed', text, at: Date.now() });
    }
    // what the engine must know for agent_report goes to the engine only, never into the user's bubble (#158, #170)
    const hint = !resumed && !liveOnly ? this.taskHint(r, text, source) : '';
    // a new assignment from the Orchestrator: whether the user waits for it is decided again (#123)
    if (from !== undefined && !r.s.parentId && !r.s.isOrchestrator && r.s.run?.startedBy === 'orchestrator' && source?.kind === 'chat' && source.chatId === this.openOrchestrator()?.s.id) r.userWaits = this.orchestratorAnswering();
    if (!this.admission) return this.deliver(chatId, text, images, resumed, from, liveOnly, receipt, hint);
    // the user's own message never waits (ADR 0036): what waited for this chat goes first, now, then this one
    if (!resumed && from === undefined) {
      this.admission.admitNow(chatId);
      return this.deliver(chatId, text, images, resumed, from, liveOnly, receipt, hint);
    }
    // an agent's message (another chat, the Orchestrator, the app's own resume): checked now
    if (liveOnly && ((!r.session && r.s.state !== 'idle') || r.archiving || r.s.closedAt)) throw new Error('La chat non è attiva: la posta resta da leggere.');
    if (!(typeof text === 'string' && text.trim()) && !checkImages(images).length) throw new Error('Messaggio vuoto.');
    // a message between chats (mail, app_send_to_chat) to a chat still open never waits for the load either (the owner,
    // 16/10 "Tutte subito", ADR 0064: mail kept unread while the CPU was over lost the race to every new sample, for
    // hours, and reached the chat only when the user wrote): what waited for this chat goes first, then this one
    if (!resumed && !r.s.closedAt) {
      this.admission.admitNow(chatId);
      return this.deliver(chatId, text, images, resumed, from, liveOnly, receipt, hint);
    }
    // the app's own resume, or an agent reopening a closed chat (a new engine): it may wait for the load
    if (r.s.closedAt && !r.archiving) this.unarchive(r); // back on the grid now: its tile shows that it waits
    return this.gate(r, () => this.deliver(chatId, text, images, resumed, from, liveOnly, receipt, hint));
  }

  /** a turn runs in a live engine: a message joins it (a chat cut by a restart has working set but no engine) */
  private midTurn(r: Rec): boolean {
    return !!r.session && (r.working === true || r.session.busy);
  }

  /** Agent work through the CPU queue (ADR 0036): runs now (the promise is the delivery's) or waits, and then resolves
   *  at once; a later failure lands on the chat (lastError). A chat in the middle of a turn never waits: the message
   *  joins its running work. */
  private gate(r: Rec, deliver: () => Promise<void>): Promise<void> {
    const adm = this.admission;
    // a chat mid-turn takes the message at once, unless earlier work of its own still waits (never overtaken)
    if (!adm || (this.midTurn(r) && !adm.entry(r.s.id))) return deliver();
    let now: Promise<void> | undefined;
    let late = false;
    // a chat on the app itself waits behind the work chats' (the user, 2026-10-14)
    const q = adm.request(r.s.id, r.session ? 'turn' : 'start', () => {
      const p = deliver();
      if (late) p.catch(e => this.lateFailed(r, e)); else now = p;
    }, isAppChat(r.s.title) || r.s.route?.area === 'App');
    if (!q) return now ?? Promise.resolve();
    late = true;
    log.info('chats', 'agent work queued: the machine is busy', { chat: r.s.id, data: { kind: q.kind, position: q.position, app: !!q.app, ...adm.load() } });
    return Promise.resolve();
  }

  /** A queued delivery failed when it finally ran: the chat shows it (nobody awaits that promise any more). */
  private lateFailed(r: Rec, e: unknown): void {
    log.warn('chats', 'queued message not delivered', { chat: r.s.id, cause: errText(e), hint: 'the chat shows the error; write to it to retry' });
    if (this.chats.get(r.s.id) !== r) return;
    r.s.lastError = errText(e);
    delete r.s.resumedAt;
    this.updated(r);
  }

  /** The queue moved or the load changed: each chat's "In coda" line follows. */
  private refreshQueued(): void {
    const adm = this.admission;
    if (!adm) return;
    const load = adm.load();
    const waiting = new Map(adm.list().map(e => [e.key, e]));
    for (const r of this.chats.values()) {
      const e = waiting.get(r.s.id);
      const was = r.s.queued;
      if (!e) { if (was) { delete r.s.queued; this.updated(r); } continue; }
      if (was && was.position === e.position && was.kind === e.kind && was.cpu === load.cpu && was.freeRam === load.freeRam) continue;
      r.s.queued = { kind: e.kind, position: e.position, since: e.since, cpu: load.cpu, freeRam: load.freeRam };
      this.updated(r);
    }
  }

  admitNow(chatId: string): boolean {
    this.need(chatId);
    const ok = !!this.admission?.admitNow(chatId);
    if (ok) log.info('chats', 'queued chat started now by the user', { chat: chatId });
    return ok;
  }

  queueState(): ReturnType<ChatService['queueState']> {
    const adm = this.admission;
    if (!adm) return null;
    return { ...adm.load(), enabled: this.opts.admission!.limits().enabled, waiting: adm.list().map(e => ({ chatId: e.key, kind: e.kind, position: e.position, since: e.since })) };
  }

  /** The delivery of a message (send() decided it goes now). One at a time per chat, on every engine: a later message
   *  whose steps end sooner (a faster recall, no checkpoint to take) never reaches the engine before an earlier one, so
   *  the engine reads them in the transcript's order (#127: the user's message and a child's mail at once). */
  /** The lines a role chat needs for agent_report and never saw (#170): its done-criteria, exactly as stored, once per
   *  assignment (a delegation's own prompt already lists them), and the task version after a follow-up. Engine only. */
  private taskHint(r: Rec, text: string, source?: TaskSource): string {
    const run = r.s.run;
    if (!run || r.s.isOrchestrator) return '';
    const lines: string[] = [];
    const criteria = run.taskContract?.doneWhen ?? [];
    if (criteria.length && r.criteriaTold !== run.runId) {
      r.criteriaTold = run.runId;
      if (!criteria.every(c => text.includes(`- ${c}`))) lines.push('Done when (agent_report doneWhen: one entry per line below, criterion copied exactly):', ...criteria.map(c => `- ${c}`));
    }
    if ((run.taskVersion ?? 1) > 1 && source?.kind !== 'app') lines.push(`Task version ${run.taskVersion}: include taskVersion: ${run.taskVersion} in agent_report.`);
    return lines.length ? `\n\n[${lines.join('\n')}]` : '';
  }

  private deliver(chatId: string, text: string, images?: unknown, resumed = false, from?: string, liveOnly = false, receipt?: SubmissionReceipt, hint = ''): Promise<void> {
    const run = () => this.deliverNow(chatId, text, images, resumed, from, liveOnly, receipt, hint).catch(error => { receipt?.failed(error); throw error; });
    const previous = this.deliveries.get(chatId);
    const delivery = previous ? previous.catch(() => {}).then(run) : run();
    this.deliveries.set(chatId, delivery);
    const done = () => { if (this.deliveries.get(chatId) === delivery) this.deliveries.delete(chatId); };
    void delivery.then(done, done);
    return delivery;
  }

  private async deliverNow(chatId: string, text: string, images?: unknown, resumed = false, from?: string, liveOnly = false, receipt?: SubmissionReceipt, hint = ''): Promise<void> {
    updateActivity.assertOpen();
    const r = this.need(chatId);
    const releaseDelivery = this.holdActivity(chatId);
    // where the time goes between Enter and the engine: logged as `timing: before send`
    const t0 = Date.now(), lap: Record<string, number> = {};
    try {
    // an engine released for idleness still gets its mail: the chat resumes for it (ensureSession below)
    if (liveOnly && ((!r.session && r.s.state !== 'idle') || r.archiving || r.s.closedAt)) throw new Error('La chat non è attiva: la posta resta da leggere.');
    const t = typeof text === 'string' ? text.trim() : '';
    const imgs = checkImages(images);
    if (!t && !imgs.length) throw new Error('Messaggio vuoto.');
    if (!resumed && r.s.resumedAt) { delete r.s.resumedAt; this.updated(r); }
    this.ensureHistory(r);
    const warning = engineOf(r.s.harness)?.kind === 'claude' ? '' : await recallWarning(t, this.opts.recall);
    if (this.quitting || this.chats.get(chatId) !== r) throw new Error('La chat non è attiva.');
    if (liveOnly && ((!r.session && r.s.state !== 'idle') || r.archiving || r.s.closedAt)) throw new Error('La chat non è attiva: la posta resta da leggere.');
    if (r.archiving) await r.archiving; // never into a session that is closing: the archive ends first, then this reopens
    this.needAgentMay(r, from); // again: the engine may have been released while the message waited in the queue
    if (r.s.closedAt) this.unarchive(r); // a message (the user's, or an agent's through app_send_to_chat) reopens it
    // a cold chat (ADR 0031): after the cache expired the message goes on in a fresh session from its note
    let lapT = Date.now();
    const cold = await this.coldSwitch(r);
    lap.coldMs = Date.now() - lapT;
    const hadEngine = !!r.session;
    lapT = Date.now();
    try {
      await this.ensureSession(r);
      lap.engineMs = Date.now() - lapT;
      if (!r.session) throw new Error(r.s.lastError ?? 'Avvio della chat non riuscito.');
      if (liveOnly && engineOf(r.s.harness)?.kind !== 'claude' && (r.session.busy || r.s.state !== 'idle')) throw new Error('La chat sta lavorando: la posta resta da leggere fino al prossimo turno.');
    } catch (e) {
      if (cold) this.coldUndo(r, cold); // the note stays for the next message
      throw e;
    }
    if (cold) this.coldDone(r, cold); // the fresh session started: the divider goes above the message
    // a message into the old session makes the note stale (a turn cut before its result would leave it "fresh")
    else if (r.coldNoteAt) { r.coldNoteAt = undefined; this.persist(); }
    const thumbs = imgs.flatMap(im => (im.thumb ? [im.thumb] : []));
    // who started the Orchestrator's turn: the user's own words (never the app's news, labelled "[…"), or the app; a
    // message into a running turn joins it, and only the user's own makes it his (#123)
    if (r.s.isOrchestrator) { const own = !from && !resumed && !!t && (!t.startsWith('[') || splitMode(t).mode !== null); if (own) r.turnFromUser = true; else if (!this.midTurn(r)) r.turnFromUser = false; }
    this.addItem(r, { kind: 'user', id: nextId('u'), at: Date.now(), text: t, ...(imgs.length ? { images: imgs.length } : {}), ...(thumbs.length ? { thumbs } : {}), ...(from ? { from: from.slice(0, 80) } : {}) }, false);
    r.activeAt = Date.now();
    if (r.jobNew) this.startJob(r, t || `[${imgs.length} immagini]`);
    const text0 = cold ? coldPrompt({ ...r.s, ...(r.inWorktree ? { inWorktree: true } : {}) }, cold.h, t) : t;
    // what the user wrote in its children since its last message rides along (shown in its transcript already)
    const notes = this.notesFor.get(chatId);
    if (notes?.length) this.notesFor.delete(chatId);
    const noted0 = notes?.length ? `${USER_NOTES_LABEL}\n${notes.join('\n')}\n\n${text0}` : text0;
    // the user put the files back before the last turn: the chat learns it with its next message
    const noted = r.undoNote ? `${r.undoNote}\n\n${noted0}` : noted0;
    r.undoNote = undefined;
    // the user's own request to the Orchestrator carries the app's estimate (zero tokens), never the app's news or mail
    const estimate = r.s.isOrchestrator && !from && !resumed && t && !t.startsWith('[') ? this.requestEstimate(t) : null;
    const asked0 = estimate ? `${noted}\n\n${estimate}` : noted;
    // Lampo is a "btw" (ADR 0106): the user's question carries what the Orchestrator said and did since it last looked
    const lampo = r.s.quick && !from && !resumed ? this.lampoContext(r) : null;
    const body = lampo ? `${lampo.text}${asked0}` : asked0;
    // the role once per context: the Orchestrator's with the role catalog, a role chat's composed instructions; a
    // resumed session already holds it in its history, so it goes again only when the text changed or was compacted away
    const roleText = r.s.isOrchestrator ? `${orchestratorRole(r.agentInstructions || undefined, this.opts.roleCatalogBrief?.())}\n\n`
      : r.agentInstructions ? `${roleFrame(r.s.agent?.name ?? 'Chat', r.agentInstructions)}\n\n` : '';
    const roleSig = roleText ? crypto.createHash('sha256').update(roleText).digest('hex').slice(0, 16) : '';
    // a changed text is checked once per engine start (as before this, never mid-session: a catalog edit would resend it)
    const role = roleText && (!r.rolePrimed || (!r.roleChecked && r.rolePrimed.sig !== roleSig)) ? roleText : '';
    r.roleChecked = true;
    // the reply language (ADR 0120): with the role text, and once on the first turn after the user changed it
    const wantLang = this.opts.replyLang?.(), langHint = replyLangTurn(wantLang, role ? undefined : r.replyLang, !!role);
    // the files as they are before this turn (ADR 0103): what the user can put back with «Annulla l'ultimo turno»
    if (!this.midTurn(r)) r.turnCheckpoint = false;
    lapT = Date.now();
    if (this.opts.checkpoints?.() && !r.s.isOrchestrator && !r.s.quick && !this.midTurn(r)) await this.checkpoint(r);
    lap.checkpointMs = Date.now() - lapT;
    try {
      receipt?.beforeSubmit();
      r.session.send(`${role}${warning}${body}${hint}${langHint}`, imgs);
      receipt?.submitted();
      log.info('chats', 'timing: before send', { chat: r.s.id, data: { totalMs: Date.now() - t0, ...lap, engineStarted: !hadEngine, cold: !!cold, harness: r.s.harness } });
      if (langHint) { r.replyLang = wantLang; if (!role) this.persist(); }
      if (lampo) r.lampoSeen = { session: r.session, cursor: lampo.seen }; // seen only once it went
      if (role) { r.rolePrimed = { session: r.s.sessionId ?? '', sig: roleSig }; this.persist(); }
    } catch (e) {
      throw new Error(`Messaggio non inviato: ${errText(e)}`);
    }
    // queued behind a quiet note turn: the engine reports no new "running", the tile shows the work from here
    if (r.handoffTurn?.quiet && r.s.state === 'idle') { r.s.state = 'running'; this.updated(r); }
    // queued behind a hand-off turn the CLI reports no new "running": mark the work here, resumed after a restart
    if (r.handoffTurn && !r.working) { r.working = true; this.persist(); }
    if (r.s.lastError) { delete r.s.lastError; this.updated(r); }
    } finally { releaseDelivery(); }
  }

  /** Flash's start (ADR 0105, 0107): what its card says (engine, model, instructions), always under LAMPO_FRAME and
   *  LAMPO_POLICY, whatever the card holds */
  private flashAgent(req: NewChat): Pick<ResolvedRole, 'request' | 'owner' | 'instructions' | 'policy'> {
    const asked = this.opts.resolveAgent?.(req);
    // a card on an engine that is off: Flash stays on the engine it was asked on, with the card's instructions
    const card = asked && asked.request.harness !== req.harness && this.opts.engineOn?.(asked.request.harness) === false
      ? { ...asked, request: req, owner: { ...plainOwner(req.harness, req.model ?? null), name: asked.owner.name } } : asked;
    const own = card?.instructions.trim();
    return { request: { ...(card?.request ?? req), title: LAMPO_TITLE, permissionMode: 'plan' }, owner: card?.owner ?? { ...plainOwner(req.harness, req.model ?? null), name: LAMPO_TITLE },
      instructions: own ? `${LAMPO_FRAME}\n\n${own}` : LAMPO_FRAME, policy: LAMPO_POLICY };
  }

  /** Flash as its card says now (ADR 0107), before the user's question: another engine = a new Flash on it (the old one
   *  closes; the Orchestrator's conversation goes again with the question); another model = changed in place; other
   *  instructions = sent again with the next message. Mid-turn nothing changes. The id the question goes to. */
  private async flashFollow(r: Rec): Promise<string> {
    // one move at a time: a second question while Flash changes engine goes where the first one went
    if (this.flashMoving) return this.flashMoving;
    if (r.working || r.session?.busy || r.s.closedAt) return r.s.id;
    const card = this.flashAgent({ harness: r.s.harness, cwd: r.s.cwd, quick: true });
    const want = card.request.model ?? null;
    if (card.request.harness !== r.s.harness) {
      const move = this.flashMove(r, card.request.harness, want);
      this.flashMoving = move;
      try { return await move; } finally { this.flashMoving = undefined; }
    }
    if (want !== (r.s.model ?? null)) await this.set(r.s.id, { model: want ?? '' });
    const effort = card.request.effort;
    if (effort && effort !== r.s.effort && engineOf(r.s.harness)?.caps.effort) await this.set(r.s.id, { effort }).catch(e => log.warn('chats', 'Flash effort not applied', { chat: r.s.id, cause: errText(e), hint: 'it stays as it was' }));
    if (card.instructions !== r.agentInstructions) { r.agentInstructions = card.instructions; r.roleChecked = false; this.persist(); }
    if (r.s.agent && (r.s.agent.name !== card.owner.name || r.s.agent.model !== want)) { r.s.agent = { ...r.s.agent, name: card.owner.name, model: want }; this.updated(r); }
    return r.s.id;
  }

  /** Flash on its card's new engine: the old one is archived (its answers stay), then the new one opens; if it cannot
   *  open, the old one comes back and takes the question. */
  private async flashMove(r: Rec, harness: Harness, model: string | null): Promise<string> {
    await this.archive(r.s.id);
    try {
      const next = await this.create({ harness, cwd: r.s.cwd, quick: true, ...(model ? { model } : {}) });
      log.info('chats', 'Flash moved to the engine of its card', { chat: next.id, data: { from: r.s.harness, to: harness, old: r.s.id } });
      return next.id;
    } catch (e) {
      log.warn('chats', 'Flash not moved to its card\'s engine', { chat: r.s.id, cause: errText(e), hint: 'the old Flash answers' });
      if (this.chats.get(r.s.id) === r && r.s.closedAt) this.unarchive(r);
      return r.s.id;
    }
  }

  /** Lampo's view of the Orchestrator's conversation (ADR 0106): what is new for its engine, read only */
  private lampoContext(r: Rec): ReturnType<typeof orchestratorContext> | null {
    const o = [...this.chats.values()].find(x => x.s.isOrchestrator && !x.s.closedAt);
    if (!o || !r.session) return null;
    this.ensureHistory(o);
    return orchestratorContext(o.items, r.lampoSeen?.session === r.session ? r.lampoSeen.cursor : null);
  }

  private autoActivity(r: Rec): void {
    r.autoActivityAt = autoCloseNow(); r.activityRevision = (r.activityRevision ?? 0) + 1;
    this.opts.onAutoCloseActivity?.(r.s.id);
  }

  /** Main-only reservation held before delivery/mail takes its first asynchronous step. */
  holdActivity(chatId: string): () => void {
    const r = this.need(chatId); this.autoActivity(r);
    r.deliveryHolds = (r.deliveryHolds ?? 0) + 1;
    let released = false;
    return () => { if (!released) { released = true; r.deliveryHolds = Math.max(0, (r.deliveryHolds ?? 1) - 1); this.autoActivity(r); } };
  }

  /** Main guards, combined with mailbox/command/browser holds by wiring. Unknown children are never zero.
   *  externalHold: true / a waiting kind = held by wiring (a waiting kind also names the "In attesa di…" label). */
  /** A delegation tree closes as one (owner, 2026-10-21: «in una chat ad albero dopo 2 minuti che hanno finito tutti»):
   *  a chat of a tree is ready only when every open chat of its tree is, and its clock starts at the tree's last activity. */
  autoCloseCandidates(externalHold: (chatId: string) => boolean | AutoCloseWaiting = () => true): AutoCloseCandidate[] {
    const own = this.ownAutoCloseCandidates(externalHold);
    const rootOf = (id: string): string => {
      let cur = id;
      for (let i = 0; i < 50; i++) { const up = this.chats.get(cur)?.s.parentId; if (!up || !this.chats.has(up)) break; cur = up; }
      return cur;
    };
    const trees = new Map<string, AutoCloseCandidate[]>();
    for (const c of own) { const root = rootOf(c.id); trees.set(root, [...trees.get(root) ?? [], c]); }
    for (const root of this.treeActivity.keys()) if (!trees.has(root)) this.treeActivity.delete(root);
    return own.map(c => {
      const root = rootOf(c.id), tree = trees.get(root)!;
      // a lone chat, unless what is left of a tree whose other chats closed first
      if (tree.length < 2 && !this.treeActivity.has(root)) return c;
      // only a member still at work holds the tree: one that ended with an error, a Stop or no result never closes by
      // itself and must not keep its tree open forever
      if (c.eligible && tree.some(x => !x.eligible && this.atWork(x.id))) return { ...c, eligible: false, reason: 'Si chiude insieme al resto dell’albero, quando hanno finito tutti' };
      // the tree's last activity only grows: a member closing first never restarts the others' clock (its own closing
      // touches are left out, so a closing member never pushes its siblings' deadline)
      const at = Math.max(this.treeActivity.get(root) ?? 0, ...tree.filter(x => { const r = this.chats.get(x.id); return !r?.autoClosing && !r?.autoEnding; }).map(x => x.activityAt));
      this.treeActivity.set(root, at);
      return { ...c, activityAt: at };
    });
  }
  private readonly treeActivity = new Map<string, number>();
  /** A chat still doing or waiting for something: running, a pending request, a turn or a delivery under way. */
  private atWork(id: string): boolean {
    const r = this.chats.get(id);
    if (!r || r.s.closedAt) return false;
    const c = r.s;
    return c.state === 'running' || c.state === 'starting' || c.state === 'waiting' || r.pending.size > 0 || !!r.working || !!r.session?.busy ||
      !!r.deliveryHolds || !!c.queued || !!r.opening || !!c.waitsOn || c.plan?.phase === 'proposed' || workBehind(c) || (c.agentChildren?.active ?? 0) > 0;
  }

  private ownAutoCloseCandidates(externalHold: (chatId: string) => boolean | AutoCloseWaiting): AutoCloseCandidate[] {
    return [...this.chats.values()].filter(r => !r.s.closedAt).map(r => {
      const c = r.s, child = c.agentChildren;
      let held: boolean | AutoCloseWaiting = true;
      try { held = externalHold(c.id); } catch { /* fail closed */ }
      const eligible = !this.quitting && !updateActivity.frozen && !c.isOrchestrator && !c.quick && !held &&
        (c.state === 'idle' || r.autoClosing && c.state === 'closed') && !!c.lastResult && !c.lastResult.isError && !c.lastResult.interrupted && !c.lastError &&
        !r.working && !r.session?.busy && r.pending.size === 0 && !workBehind(c) && !c.waitsOn && c.plan?.phase !== 'proposed' && !c.queued && !r.deliveryHolds &&
        !r.opening && !r.releasing && !r.switching && !r.handoffTurn && (!r.archiving || r.autoClosing) &&
        child?.coverage === 'complete' && child.active === 0 && !child.children.some(x => x.state === 'running' || x.state === 'waiting' || x.state === 'unknown');
      const waitingFor = eligible || c.isOrchestrator || c.quick ? undefined : this.waitingOf(r, held);
      return { id: c.id, eligible: !!eligible, stamp: `${r.activityRevision ?? 0}:${r.lastTurnAt}:${c.lastResult?.at ?? 0}:${c.pending}:${c.model ?? ''}:${c.work?.status ?? ''}:${c.waitsOn ?? ''}`,
        activityAt: r.autoActivityAt ??= autoCloseNow(), ...(waitingFor ? { waitingFor } : {}),
        reason: waitingFor ? WAITING_REASON[waitingFor] : child?.coverage !== 'complete' ? 'Sottoagenti non completamente osservabili: chiusura sospesa' : 'Attività o stato da verificare' };
    });
  }

  /** What a held work chat waits for, the most urgent first (#86): the user's answers before running work, running
   *  work before a missing report. undefined = held for another reason (busy, starting, an error, ...). */
  private waitingOf(r: Rec, external: boolean | AutoCloseWaiting): AutoCloseWaiting | undefined {
    const c = r.s, pend = [...r.pending.values()];
    if (pend.some(p => p.type === 'permission')) return 'permission';
    if (pend.some(p => p.type === 'question')) return 'answer';
    if (c.plan?.phase === 'proposed') return 'answer'; // its plan waits for «Approva e parti» (ADR 0108)
    if (external === 'command' || external === 'browser') return external;
    if (c.waitsOn) return c.waitsOn;
    if (r.session?.busy || r.working || c.state === 'running' || c.state === 'starting') return undefined;
    if ((c.background ?? 0) > 0 || c.waitsOnWork || this.observedChildrenBusy(r) || (c.agentChildren?.active ?? 0) > 0 || external === 'work') return 'work';
    if (c.work?.status === 'waiting-mail' || external === 'mail') return 'mail';
    if (c.work?.status === 'assigned' && c.lastResult && !c.lastResult.isError && !c.lastResult.interrupted) return 'report';
    return undefined;
  }

  /** No renderer flag can authorize this path. The scheduler supplies a current, main-owned reservation. */
  async archiveAutomatic(chatId: string, stillValid: () => boolean): Promise<boolean> {
    const r = this.need(chatId);
    const eligible = (): boolean => this.autoCloseCandidates(() => false).find(c => c.id === chatId)?.eligible === true;
    if (!stillValid() || !eligible() || r.archiving || r.autoClosing || r.pending.size || r.deliveryHolds) return false;
    r.autoClosing = true;
    let authorized = false;
    const valid = (): boolean => stillValid() && eligible() && this.chats.get(chatId) === r && !r.pending.size && !r.deliveryHolds && !r.session?.busy && !r.working && !workBehind(r.s);
    const sess = r.session;
    const run = (async () => {
      if (!valid()) return;
      try { await this.ensureHandoff(chatId, { ask: false, allowStart: false }); } catch { return; }
      if (!valid()) return;
      if (sess) { r.autoEnding = true; await sess.close(); if (!valid()) return; this.reapKept(r); }
      authorized = true;
    })();
    r.archiving = run;
    try {
      await run;
      if (!authorized || !valid()) return false;
      this.flushItems(chatId);
      r.s.closedAt = Date.now(); r.s.closedBy = 'auto'; r.s.state = 'closed';
      this.endRunOf(r, 'closed', r.s.closedAt);
      this.pruneArchived(); this.persist(); this.updated(r);
      return true;
    } finally { r.archiving = undefined; r.autoClosing = false; r.autoEnding = false; }
  }

  async answer(chatId: string, requestId: string, answer: Answer): Promise<void> {
    const r = this.need(chatId);
    if (!r.pending.has(requestId)) throw new Error('Questa richiesta non è più aperta.');
    if (!r.session) { this.dropPending(r, requestId); throw new Error('La chat non è più attiva: la richiesta è scaduta.'); }
    const req = r.pending.get(requestId)!;
    const ok = r.session.answer(requestId, answer);
    if (!ok) { this.dropPending(r, requestId); return; }
    // a Strategist still asking: the answer is one more thing its strip shows as already clear (ADR 0108)
    const plan = r.s.plan;
    if (plan && (plan.phase === 'asking' || plan.phase === 'revising') && answer.kind === 'question' && req.questions?.length) {
      const next = withClarified(plan, req.questions, answer.answers);
      if (next !== plan) { r.s.plan = next; this.persist(); this.updated(r); }
    }
  }

  /** plan_propose (agents/strategy-tools.ts): the Strategist's plan waits for the user's ok on its strip. */
  planPropose(chatId: string, steps: PlanStep[], doneWhen?: string): StrategyPlan {
    const r = this.need(chatId), plan = r.s.plan;
    if (!plan) throw new Error('plan_propose: only a Strategist the Orchestrator or the user started has a plan with the user.');
    if (plan.phase === 'running' || plan.phase === 'done') throw new Error('plan_propose: the plan is approved and under way; update its steps with plan_update.');
    if (plan.phase === 'proposed') throw new Error('plan_propose: your plan already waits for the user. End your turn: the answer arrives as a message.');
    r.s.plan = { phase: 'proposed', clarified: plan.clarified, ...(plan.asked ? { asked: plan.asked } : {}), steps, ...(doneWhen ? { doneWhen } : {}), at: Date.now() };
    // the run keeps the plan's fate: a decision signal for the Orchestrator (standing.ts, ADR 0131)
    const run = r.s.run;
    if (run && run.endedAt === undefined) { run.plan = { ...(run.plan ?? { proposals: 0, changes: 0 }), proposals: (run.plan?.proposals ?? 0) + 1 }; this.runSave(); }
    this.persist();
    this.updated(r);
    log.info('chats', 'plan proposed', { chat: chatId, data: { steps: steps.length } });
    return structuredClone(r.s.plan);
  }

  /** plan_update: a step the Strategist does itself (or corrects) moves on. */
  planUpdate(chatId: string, i: number, state: StepState): StrategyPlan {
    const r = this.need(chatId), plan = r.s.plan;
    if (!plan || (plan.phase !== 'running' && plan.phase !== 'done')) throw new Error('plan_update: the user has not approved a plan yet.');
    r.s.plan = withStep(plan, i, state, Date.now());
    this.persist();
    this.updated(r);
    return structuredClone(r.s.plan);
  }

  /** The plan of a chat (agent_delegate reads it: no delegation before the user's ok, a `step` within its steps). */
  planOf(chatId: string): StrategyPlan | null { const p = this.chats.get(chatId)?.s.plan; return p ? structuredClone(p) : null; }

  /** agent_delegate with a `step`: those children work on it. */
  planDelegated(chatId: string, i: number, chatIds: string[]): void {
    const r = this.chats.get(chatId), plan = r?.s.plan;
    if (!r || !plan || !plan.steps[i] || !chatIds.length) return;
    // A new execution of this step must not wait on siblings from an older parent assignment.
    const current = { ...plan, steps: plan.steps.map((step, k) => k !== i || !step.chatIds ? step : { ...step, chatIds: step.chatIds.filter(id => chatIds.includes(id) || this.chats.get(id)?.s.run?.parentRunId === r.s.run?.runId) }) };
    r.s.plan = withDelegated(current, i, chatIds, Date.now());
    this.persist();
    this.updated(r);
  }

  /** The user's click on a proposed plan (chat:plan): «Approva e parti» or «Cambia qualcosa» with what to change; the
   *  Strategist gets it as the user's message. «Basta domande» is an answer to its open question (renderer). */
  async planDecide(chatId: string, decision: 'approve' | 'change', at: number, text?: string): Promise<void> {
    const r = this.need(chatId), plan = r.s.plan;
    if (!plan || plan.phase !== 'proposed') throw new Error('Questo piano non aspetta più una risposta.');
    if (plan.at !== at) throw new Error('Il piano è cambiato nel frattempo: rileggilo.');
    const change = typeof text === 'string' ? text.trim() : '';
    if (decision === 'change' && (!change || change.length > 2000)) throw new Error('Scrivi cosa cambiare (al massimo 2000 caratteri).');
    if (decision !== 'approve' && decision !== 'change') throw new Error('Scelta non valida.');
    // the phase moves first (a second click finds it decided) and comes back if the message does not reach the Strategist
    r.s.plan = { ...plan, phase: decision === 'approve' ? 'running' : 'revising', at: Date.now() };
    this.persist();
    this.updated(r);
    try { await this.send(chatId, decision === 'approve' ? PLAN_APPROVED : planChange(change), undefined, false, undefined, false, { kind: 'user' }); } catch (e) {
      if (r.s.plan?.phase === (decision === 'approve' ? 'running' : 'revising')) { r.s.plan = plan; this.persist(); this.updated(r); }
      throw e;
    }
    // the user's click on the run's plan: approved as proposed, or a change asked (standing.ts decisionSignals, ADR 0131)
    const run = r.s.run;
    if (run && run.endedAt === undefined) {
      const p = run.plan ?? { proposals: 1, changes: 0 };
      run.plan = decision === 'approve' ? { ...p, approvedAt: p.approvedAt ?? Date.now() } : { ...p, changes: p.changes + 1 };
      this.runSave();
    }
    log.info('chats', 'plan decided', { chat: chatId, data: { decision } });
  }

  /** Interrupts whenever a process exists, whatever the shown state says (an interrupt on an idle CLI is harmless). */
  async stop(chatId: string, keepQueued = false): Promise<void> {
    const r = this.need(chatId);
    if (!r.session) return;
    try { await r.session.interrupt({ keepQueued, byUser: true }); } catch (e) {
      log.warn('chats', 'interrupt failed', { chat: chatId, data: errText(e) });
      throw new Error(`Stop non riuscito: ${errText(e)}`);
    }
  }

  /** Interrupts every live session; returns how many were working. */
  async stopAll(): Promise<number> {
    const live = [...this.chats.values()].filter(r => r.session);
    const busy = live.filter(r => r.session?.busy).length;
    await Promise.allSettled(live.map(r => r.session?.interrupt({ byUser: true })));
    log.info('chats', 'stop all', { data: { live: live.length, busy } });
    return busy;
  }

  /** Removes the chat from the app (its process ends; the transcript stays where the CLI keeps it). */
  async close(chatId: string): Promise<void> {
    const r = this.need(chatId);
    this.admission?.drop(chatId); // its waiting work goes with it
    const sess = r.session;
    if (sess) await sess.close();
    this.reapKept(r);
    for (const id of [...r.pending.keys()]) this.dropPending(r, id);
    this.flushItems(chatId);
    this.endRunOf(r, 'closed');
    this.chats.delete(chatId);
    this.persist();
    log.info('chats', 'chat closed', { chat: chatId });
    this.opts.emitter.emit('chat:removed', { chatId });
  }

  /** The chat goes on in a new process: the old one ends, but a dev server it started stays for the next turn
   *  (owner, 2026-10-12); its tools are reaped when the chat really closes (reapKept). */
  private closeKeeping(r: Rec, sess: HarnessSession): Promise<void> {
    (r.kept ??= []).push(sess);
    return sess.close(undefined, true);
  }

  /** The chat really closes (✕, Ctrl+W, Chiudi, auto close): the engines it outlived leave nothing behind either. */
  private reapKept(r: Rec): void {
    for (const s of r.kept?.splice(0) ?? []) {
      if (s.root && reapEnabled()) void reapEngine(s.root, { chatId: r.s.id, what: 'a previous engine of this chat' });
    }
  }

  /** Archives a finished work chat: its process ends gracefully, the record stays (closedAt) and reopen() brings it
   *  back with its history. auto = the UI's auto-close: refused if the chat went back to work meanwhile. undoable = the
   *  user's ✕ with its «Annulla» (#168): the run ends only when the close is final (chat:close, or 15 s with no reopen),
   *  so an Annulla gets the chat back with its run still open. */
  async archive(chatId: string, opts: { auto?: boolean; undoable?: boolean } = {}): Promise<ChatSummary> {
    const r = this.need(chatId);
    // the Orchestrator never closes (its title is the mail address the brain's rules and the chats write to)
    if (r.s.isOrchestrator) throw new Error('L’Orchestrator non si chiude: per ripartire usa Pulisci.');
    if (r.archiving) await r.archiving;
    if (r.s.closedAt) return { ...r.s };
    if (opts.auto && (r.session?.busy || r.pending.size > 0 || workBehind(r.s) || r.s.queued)) throw new Error('La chat è tornata al lavoro: resta aperta.');
    if (opts.auto) throw new Error('La chiusura automatica richiede il timer verificato dal processo principale.');
    // closed by hand while an agent's message waited in the CPU queue: that message is dropped with the chat's work
    if (this.admission?.drop(chatId)) log.info('chats', 'queued work dropped: the chat was archived', { chat: chatId });
    const sess = r.session;
    const note = opts.auto && r.lastTurnAt > 0;
    // a long Claude chat that still waits for its cold note keeps its engine until it wrote it (never a turn at close:
    // the note comes at its usual time, coldTick; ADR 0031)
    const keep = !!opts.auto && !!sess?.alive && this.coldOn() && coldArmed(this.coldView(r), Date.now(), this.ttl());
    if (sess || note) {
      // one promise for the whole close, set before any await: a message sent meanwhile waits for it, then reopens
      r.archiving = (async () => {
        // the auto-close leaves the token-free hand-off for a later "Riprendi" (ADR 0014: never a turn at close)
        if (note) {
          try { await this.ensureHandoff(chatId, { ask: false }); } catch (e) {
            log.warn('chats', 'hand-off before the auto-close not written', { chat: chatId, cause: errText(e), hint: '"Riprendi" on this chat writes it then' });
          }
        }
        // the user's ✕ stops a running turn at once (#168): the engine's exit may take seconds, its work must not
        if (sess && !opts.auto && sess.busy) await sess.interrupt({ byUser: true }).catch(e => log.info('chats', 'interrupt at close failed', { chat: chatId, data: errText(e) }));
        if (sess && !keep) { await sess.close(); this.reapKept(r); }
      })();
      try { await r.archiving; } finally { r.archiving = undefined; }
    }
    for (const id of [...r.pending.keys()]) this.dropPending(r, id);
    this.flushItems(chatId);
    r.s.closedAt = Date.now();
    r.s.closedBy = opts.auto ? 'auto' : 'user';
    if (opts.undoable && !opts.auto) {
      const at = r.s.closedAt;
      const t = setTimeout(() => { if (this.chats.get(chatId) === r && r.s.closedAt === at) this.endRunOf(r, 'closed', at); }, 15_000);
      t.unref?.();
    } else this.endRunOf(r, 'closed', r.s.closedAt);
    r.working = false;
    if (keep) r.closeAfterCold = true;
    if (r.s.state !== 'error') r.s.state = 'closed';
    delete r.s.background; delete r.s.waitsOnWork; delete r.s.waitsOn;
    this.pruneArchived();
    this.persist();
    log.info('chats', 'chat archived', { chat: chatId, data: { auto: !!opts.auto, ...(keep ? { engineKeptForColdNote: true } : {}) } });
    this.updated(r);
    return { ...r.s };
  }

  /** Back on the grid; the session resumes on the next message (Claude --resume, Cursor session/load). */
  async reopen(chatId: string): Promise<ChatSummary> {
    const r = this.need(chatId);
    if (r.s.closedAt) this.unarchive(r);
    return { ...r.s };
  }

  /** The user typed in this chat himself (chat:send only, ADR 0083): so that nothing conflicts, the Orchestrator learns it
   *  as quiet news (orchestrator-wake.ts, its own listener) and, for a delegated chat, its parent gets the same note with
   *  its next message (and a line in its transcript now). The user's own words go, never the child's. */
  userWrote(chatId: string, text: string): void {
    const r = this.chats.get(chatId);
    if (!r || r.s.isOrchestrator || r.s.quick) return;
    const ledger = r.userTaskEvents ?? { events: [], latestSeq: 0, acknowledgedSeq: 0 };
    if (ledger.latestSeq === Number.MAX_SAFE_INTEGER) throw new Error('The user event ledger is invalid; the instruction cannot be recorded safely.');
    const at = Date.now(), seq = ledger.latestSeq + 1, eventId = crypto.randomUUID();
    const event = { seq, id: eventId, at, text, ...(r.s.run ? { taskId: r.s.run.taskId ?? r.s.run.runId, taskVersion: r.s.run.taskVersion ?? 1 } : {}) };
    r.userTaskEvents = { ...ledger, latestSeq: seq, events: [...ledger.events, event] };
    this.persist(true); this.updated(r);
    const parent = r.s.parentId ? this.chats.get(r.s.parentId) : undefined;
    const note: UserWroteNote = { eventId, seq, chatId, title: r.s.title, role: r.s.agent?.name ?? null, parentId: parent?.s.id ?? null, parentTitle: parent?.s.title ?? null, at, text };
    if (parent && !parent.s.closedAt) {
      const list = [...(this.notesFor.get(parent.s.id) ?? []), userNoteLine(note)];
      this.notesFor.set(parent.s.id, list);
      this.addItem(parent, sysItem('userWroteChild', { role: note.role ?? 'Chat', title: note.title }, 'info'), false);
      this.updated(parent);
    }
    for (const fn of this.userWroteListeners) { try { fn(note); } catch (e) { log.warn('chats', 'user note listener failed', { chat: chatId, cause: errText(e), hint: 'the Orchestrator may not learn of this message' }); } }
  }
  /** orchestrator-wake.ts: told of every message the user typed in a work chat */
  onUserWrote(fn: (n: UserWroteNote) => void): void { this.userWroteListeners.push(fn); }
  /** A root chat's clean result (done, every criterion met, no question): a listener that returns true took it as quiet
   *  news for the Orchestrator (orchestrator-wake.ts cleanReport); else it goes as a message, as any other result. */
  onCleanReport(fn: (n: CleanReportNote) => boolean): void { this.cleanReportListeners.push(fn); }
  /** the notes waiting for this chat's next message (tests, diagnostics) */
  notesWaiting(chatId: string): readonly string[] { return this.notesFor.get(chatId) ?? []; }

  /** An explicit assignment reuses the conversation, but creates a separately accountable task run. */
  async assignTask(chatId: string, prompt: string, options: TaskAssignmentOptions = {}): Promise<void> {
    const r = this.need(chatId);
    if (!prompt.trim()) throw new Error('Task prompt is required.');
    if (options.expectedVersion !== undefined && options.expectedVersion !== (r.s.run?.taskVersion ?? 1)) throw new Error('Task version changed; refresh before assigning.');
    const source = options.source ?? { kind: 'user' as const };
    if (source.kind === 'chat') {
      if (source.chatId !== this.openOrchestrator()?.s.id && source.chatId !== r.s.parentId) throw new Error('Only the owning Orchestrator or parent can assign this chat.');
      if (source.chatId === r.s.parentId) {
        const parent = this.need(source.chatId);
        if (parent.s.closedAt || !parent.s.run || parent.s.run.endedAt !== undefined || parent.s.run.report?.via === 'agent_report') throw new Error('The parent assignment is over; its owner must explicitly continue it before it can assign children.');
      }
      const events = this.userEvents(chatId);
      if ((events.latestSeq > events.acknowledgedSeq || options.expectedEventSeq !== undefined) && options.expectedEventSeq !== events.latestSeq) throw new Error(`Unread user instructions: read ${source.chatId === r.s.parentId ? 'agent_task_events' : 'app_task_events'} and pass expectedEventSeq ${events.latestSeq} before assigning.`);
    }
    if (options.planStep !== undefined) {
      const plan = r.s.parentId ? this.chats.get(r.s.parentId)?.s.plan : undefined;
      if (source.kind !== 'chat' || source.chatId !== r.s.parentId || !plan || !['running', 'done'].includes(plan.phase) || !Number.isSafeInteger(options.planStep) || !plan.steps[options.planStep]) throw new Error('Invalid or unapproved parent plan step.');
    }
    if (this.midTurn(r) || r.pending.size || r.s.queued || r.opening || r.releasing || r.switching || r.archiving || this.deliveries.has(chatId)) throw new Error('The chat is busy or has queued work; wait before assigning another task.');
    this.beginAssignment(r, prompt, options);
    if (options.mode === 'new-task' && r.s.plan) prompt += `\n\n${STRATEGY_FLOW}`;
    if (options.planStep !== undefined && r.s.parentId) this.planDelegated(r.s.parentId, options.planStep, [chatId]);
    if (source.kind === 'chat' && r.userTaskEvents) { r.userTaskEvents.acknowledgedSeq = r.userTaskEvents.latestSeq; this.persist(true); this.updated(r); }
    const from = source.kind === 'chat' ? this.need(source.chatId).s.title : source.kind === 'app' ? 'App' : undefined;
    await this.send(chatId, prompt, undefined, false, from, false, source);
  }

  private beginAssignment(r: Rec, prompt: string, options: TaskAssignmentOptions): void {
    if (r.heldResult) { this.releaseResult(r); if (r.heldResult) throw new Error('The previous result awaits an Orchestrator; deliver it before assigning again.'); }
    const previous = r.s.run;
    if (!previous) throw new Error('Only role chats can receive tasks.');
    delete r.reportNudged; // a new assignment owes its own report (#152)
    const mode = options.mode ?? 'continue', at = Date.now();
    this.deliveryPolicy(options.deliveryPolicy, !!r.s.parentId);
    if (options.doneWhen && (options.doneWhen.length > 12 || options.doneWhen.some(x => typeof x !== 'string' || !x.trim() || x.length > 300))) throw new Error('Invalid task criteria.');
    this.finishRun(previous, previous.report ? 'completed' : 'closed', at);
    const next = this.runs.start({ chatId: r.s.id, agentId: previous.agentId, version: previous.version,
      goal: prompt, startedBy: previous.startedBy, startedAt: at, costKnown: previous.costUsd !== null,
      tags: previous.tags ? { ...previous.tags, skills: [] } : undefined, tier: previous.tier, model: previous.model,
      ...(r.s.parentId && this.chats.get(r.s.parentId)?.s.run ? { parentRunId: this.chats.get(r.s.parentId)!.s.run!.runId } : {}),
      ...(mode === 'rework' ? { reworkOf: previous.runId } : {}) });
    const brainRoot = this.opts.brainRoot?.();
    if (brainRoot) next.scope = { brainRoot: path.resolve(brainRoot), projectRoot: path.resolve(r.s.cwd) };
    next.taskId = mode === 'new-task' ? next.runId : previous.taskId ?? previous.runId;
    next.taskVersion = (previous.taskVersion ?? 1) + 1;
    next.taskContract = { ...(previous.taskContract?.reportExpected ? { reportExpected: true } : {}), deliveryPolicy: this.deliveryPolicy(options.deliveryPolicy ?? previous.taskContract?.deliveryPolicy, !!r.s.parentId), goal: prompt, doneWhen: options.doneWhen ?? (mode === 'new-task' ? [] : previous.taskContract?.doneWhen ?? r.s.delegation?.doneWhen ?? []) };
    if (mode === 'continue') next.continuedFrom = previous.runId;
    r.s.run = next;
    if (mode === 'new-task' && r.s.plan) r.s.plan = { phase: 'asking', clarified: [], steps: [], at };
    if (this.opts.suggestSkills) void this.opts.suggestSkills(prompt).then(suggested => {
      next.skillSuggestions = { at, suggested, used: [...(next.tags?.skills ?? [])] }; this.runSave(); this.persist();
    }).catch(e => log.warn('chats', 'skill suggestion snapshot unavailable', { cause: errText(e), hint: 'the task continues without a snapshot' }));
    r.s.work = { status: 'assigned', updatedAt: at };
    if (r.s.delegation) r.s.delegation = { ...r.s.delegation, goal: prompt, doneWhen: next.taskContract.doneWhen, at, result: undefined };
    delete r.rootReportAt; delete r.report; delete r.autoCompleted; delete r.runSeen;
    r.idleSince = at;
    if (r.s.state === 'running' && !r.handoffTurn) r.runningSince = at;
    this.runSave(); this.persist(true); this.updated(r);
  }

  /** Neutral follow-ups never count as corrections. Only an explicit correction does. */
  resumedByUser(chatId: string, text?: string): void {
    const r = this.chats.get(chatId), run = r?.s.run;
    if (!r || !run || text === undefined) return;
    if (isCorrection(text) && r.s.run?.corrections) { r.s.run.corrections.tagged++; this.runSave(); this.persist(); }
  }

  /** The §5 metrics per agent and version (A6): runs kept plus the rollups of the pruned ones. `aiErrors` = the brain's
   *  ai-errors.md text (its lines naming a run, seen by Brother, are a secondary column); undefined = not read. */
  runMetrics(opts: { aiErrors?: string; since?: number; skill?: string; app?: string; repo?: string } = {}): ReturnType<typeof runMetrics> {
    // a failed write (a locked file, a full disk, an unreadable store) still answers from memory
    try { this.runs.flush(); } catch (e) { log.warn('chats', 'agent runs not saved', { cause: errText(e), hint: 'the next run change writes them again' }); }
    const runs = this.runs.list(), rollups = this.runs.rolledUp();
    const live = (run: AgentRun) => { const r = this.chats.get(run.chatId); return !!r && !r.s.closedAt && r.s.run?.runId === run.runId; };
    const metrics = runMetrics(runs, { rollups, live, ...(opts.aiErrors !== undefined ? { aiErrors: aiErrorRuns(opts.aiErrors) } : {}), ...(opts.since !== undefined ? { since: opts.since } : {}),
      filter: { ...(opts.skill !== undefined ? { skill: opts.skill } : {}), ...(opts.app !== undefined ? { app: opts.app } : {}), ...(opts.repo !== undefined ? { repo: opts.repo } : {}) } });
    // the card's level and performance are the agent's whole record, whatever the filter
    const standing = standings(runs, rollups, Date.now(), this.runs.flashLog());
    return withStandings(metrics, standing);
  }

  /** The user's verdict on an agent run (thumbs up / down / partly; the UI's only, never an agent tool): basis human;
   *  an open run ends as completed, an ended one keeps how it ended. */
  markRun(chatId: string, verdict: AgentRunOutcome['verdict'], note?: string): ChatSummary {
    const r = this.need(chatId);
    const run = r.s.run;
    if (!run) throw new Error('Questa chat non è un’esecuzione di un Agente.');
    if (!['success', 'partial', 'fail', 'unknown'].includes(verdict)) throw new Error('Esito non valido.');
    const text = typeof note === 'string' ? note.trim().slice(0, 600) : '';
    run.outcome = { verdict, basis: 'human', at: Date.now(), by: 'user', ...(text ? { note: text } : {}) };
    this.finishRun(run, 'completed');
    this.runSave(); this.persist(); this.updated(r);
    this.hook('agent lifecycle', () => this.opts.onRunOutcome?.(structuredClone(run)));
    return { ...r.s };
  }

  /** A "Comando da eseguire" request (run/asks.ts keeps it, not the engine): counted once on the chat's open run. */
  commandAsked(chatId: string, requestId: string): void {
    const r = this.chats.get(chatId);
    if (!r) return;
    this.countRequest(r, { id: requestId, type: 'command' });
    (r.commandsOpen ??= new Set()).add(requestId);
  }
  /** That request left (run, "Non serve", the chat went on): when nothing else waits, the stale clock starts again. */
  commandDone(chatId: string, requestId: string): void {
    const r = this.chats.get(chatId);
    if (!r?.commandsOpen?.delete(requestId)) return;
    if (!r.commandsOpen.size && !r.pending.size) this.idleAgain(r);
  }

  /** Ends the open runs with no turn and nothing waiting on the user for STALE_MS (the timer; tests call it). */
  staleRuns(now = Date.now()): number {
    let n = 0;
    for (const r of this.chats.values()) {
      const run = r.s.run;
      if (!run || run.endedAt !== undefined) continue;
      const waiting = r.pending.size > 0 || !!r.commandsOpen?.size || !!r.working || !!r.session?.busy || !!r.s.queued;
      if (!staleDue(run, Math.max(run.startedAt, r.lastTurnAt, r.idleSince ?? 0, r.activeAt ?? 0), waiting, now)) continue;
      this.finishRun(run, 'stale', now); n++;
    }
    if (n) { this.runSave(); this.persist(); }
    return n;
  }

  /** After a start: every chat whose turn the last quit or crash cut (working still set) resumes by itself with
   *  RESUME_TEXT and the "ripresa dopo il riavvio" mark (resumedAt). Chats that had finished stay closed. */
  resumeInterrupted(): number {
    this.restoreRootNotices();
    this.resumeRootSyntheses();
    for (const r of this.chats.values()) if (r.heldResult && !r.working) this.releaseResult(r);
    // child results the last quit held back reach their parent now, as one batch
    for (const r of this.chats.values()) {
      const held = r.heldResults?.filter(item => !item.runId || !this.runs.get(item.runId)?.delivery?.synthesisSubmittedAt);
      const removed = (r.heldResults?.length ?? 0) !== (held?.length ?? 0);
      r.heldResults = held;
      if (removed) this.persist(true);
      if (!held?.length) continue;
      this.childResults.set(r.s.id, { items: held, timer: null });
      this.flushChildResults(r.s.id);
    }
    const cut = [...this.chats.values()].filter(r => r.working && !r.s.closedAt);
    for (const r of cut) {
      r.s.resumedAt = Date.now();
      this.updated(r);
      log.info('chats', 'resuming a chat cut by the restart', { chat: r.s.id });
      this.send(r.s.id, RESUME_TEXT, undefined, true, undefined, false, { kind: 'app' }).catch(e => {
        log.warn('chats', 'resume after restart failed', { chat: r.s.id, cause: errText(e), hint: 'the chat stays closed: a message from the user resumes it' });
        if (r.s.resumedAt) { delete r.s.resumedAt; this.updated(r); }
      });
    }
    return cut.length;
  }

  async set(chatId: string, patch: { model?: string; effort?: Effort; permissionMode?: PermissionMode; title?: string; workStatus?: 'assigned'|'waiting-mail'|'completed' }): Promise<ChatSummary> {
    const r = this.need(chatId);
    const sess = r.session;
    if(patch.workStatus !== undefined){
      if(Object.keys(patch).some(key=>key!=='workStatus'))throw new Error('Aggiorna lo stato incarico separatamente dalle altre impostazioni.');
      if(!['assigned','waiting-mail','completed'].includes(patch.workStatus))throw new Error('Stato incarico non valido.');
      const previous=r.s.work;
      this.autoActivity(r);
      r.s.work={status:patch.workStatus,updatedAt:Date.now()};
      try{this.persist(true);}catch(error){r.s.work=previous;throw error;}
      if (patch.workStatus === 'completed' && r.s.run && r.s.run.endedAt === undefined) { this.endRunOf(r, 'completed'); this.persist(); }
    }
    const later: string[] = [];
    const apply = async (what: string, fn: (() => Promise<void>) | undefined): Promise<void> => {
      if (!sess || !fn) return;
      try { await fn(); } catch (e) { later.push(what); log.warn('chats', 'setting not applied live', { chat: chatId, data: { what, error: errText(e) } }); }
    };
    if (patch.title !== undefined) {
      const t = patch.title.trim();
      if (!t) throw new Error('Titolo vuoto.');
      r.s.title = t;
      await apply('title', sess ? () => sess.rename(t) : undefined);
    }
    if (patch.model !== undefined) {
      const m = patch.model.trim() || null;
      if (m && !MODEL_ID.test(m)) throw new Error(`Modello non valido: ${m}`);
      this.hook('analytics', () => this.analytics.patch(r.s, { modelObserved: null }));
      r.choice.model = m; r.s.model = m;
      const engine = engineOrThrow(r.s.harness);
      if (!engine.caps.liveModel) {
        // never live (Cursor's session/set_model writes the user's config): reopen the session with --model, same history
        if (sess && !sess.busy) await this.closeKeeping(r, sess);
        else if (sess) r.reopen = true; // after this turn
        if (sess) this.addItem(r, sysItem('modelChangeQueued', { model: m ?? '', label: engine.label, reopen: r.reopen ? 1 : 0 }, 'info'), false);
      } else await apply('model', sess ? () => sess.setModel(m) : undefined);
    }
    if (patch.effort !== undefined) {
      if (!EFFORTS.includes(patch.effort)) throw new Error(`Effort non valido: ${patch.effort}`);
      const engine = engineOrThrow(r.s.harness);
      if (!engine.caps.effort) throw new Error(`L’effort non si imposta con ${engine.label}: scegli il modello.`);
      const e = patch.effort, before = { choice: r.choice.effort, effort: r.s.effort, status: r.s.effortStatus };
      r.choice.effort = e; r.s.effort = e;
      r.s.effortStatus = selectEffort(r.s.effortStatus ?? initialEffort(engine.caps.effort, null), e);
      // an ACP model that offers no such effort refuses now, in words, and the chat keeps what it had (nothing to retry)
      if (sess && engine.kind === 'acp') {
        try { await sess.setEffort(e); } catch (err) {
          r.choice.effort = before.choice; r.s.effort = before.effort; r.s.effortStatus = before.status;
          throw err;
        }
      } else await apply('effort', sess ? () => sess.setEffort(e) : undefined);
    }
    if (patch.permissionMode !== undefined) {
      if (!MODES.includes(patch.permissionMode)) throw new Error(`Modalità permessi non valida: ${patch.permissionMode}`);
      const pm = patch.permissionMode;
      if (aboveCeiling(pm, r.policy?.ceiling ?? null)) throw new Error(`Questo Agente ha come limite la modalità «${r.policy!.ceiling}». Per alzarlo modifica l’Agente.`);
      r.choice.permissionMode = pm; r.s.permissionMode = pm;
      await apply('permissionMode', sess ? () => sess.setPermissionMode(pm) : undefined);
    }
    if (later.length) this.addItem(r, sysItem('appliedLater', { items: later.join(',') }, 'warn'), false);
    this.persist();
    log.info('chats', 'chat settings', { chat: chatId, data: { ...patch, title: patch.title ? '(changed)' : undefined } });
    this.updated(r);
    return { ...r.s };
  }

  // ---- long chats: hand-off and "Riprendi" ----

  /** The saved hand-off of a chat, or null. */
  readHandoff(chatId: string, session?: string): HandoffInfo | null {
    this.need(chatId);
    return this.handoffs.read(chatId, session);
  }

  /** The chat writes its hand-off now: one short turn, its answer saved as <userData>/handoffs/<chatId>.md. A chat that
   *  cannot be asked (no turn yet, a stopped engine with allowStart false, a failed or malformed answer) gets a
   *  token-free note built by the app (source 'auto'). Refused while the chat works or waits for the user. */
  async handoff(chatId: string, opts: HandoffOptions = {}): Promise<HandoffInfo> {
    const r = this.need(chatId);
    if (r.handoffTurn) throw new Error('La chat sta già facendo un turno breve dell’app (passaggio di consegne o riassunto): riprova tra poco.');
    this.ensureHistory(r);
    const hasTurns = r.lastTurnAt > 0 || r.items.some(i => i.kind === 'result' || i.kind === 'user');
    if (hasTurns && (r.session?.busy || r.pending.size > 0)) throw new Error('La chat sta lavorando o ti aspetta: il passaggio si scrive quando ha finito il turno.');
    // an archived chat is never started for its hand-off (it has no tile for the turn): the app writes the note
    const canAsk = hasTurns && !r.s.closedAt && opts.ask !== false && (opts.allowStart !== false || !!r.session?.alive);
    let text: string | null = null;
    if (canAsk) {
      try { text = await this.askHandoff(r, opts.reason ?? 'manual'); } catch (e) {
        log.warn('chats', 'hand-off turn failed', { chat: chatId, data: errText(e) });
      }
    }
    if (this.chats.get(chatId) !== r) throw new Error('Chat chiusa mentre scriveva il passaggio.');
    // "Riprendi" whose hand-off turn was stopped or failed: nothing saved (a later "Riprendi" asks the chat again)
    if (r.handoffStopped && opts.reason === 'continue') throw new Error('Ripresa annullata: il passaggio di consegne si è interrotto (fermato o in errore). Riprova quando vuoi.');
    const info = this.handoffs.write(chatId, {
      title: r.s.title, text: text ?? autoHandoff(r.s, r.items), at: Date.now(), source: text ? 'chat' : 'auto',
      ...(r.s.contextTokens ? { contextTokens: r.s.contextTokens } : {}),
    });
    r.s.handoffAt = info.at; r.s.handoffSource = info.source;
    {
      const code = info.source === 'chat' ? 'handoffSavedChat' : 'handoffSavedAuto';
      this.addItem(r, { kind: 'system', id: nextId('s'), at: info.at, level: 'info', text: sysEn(code), code }, false);
    }
    this.persist();
    this.updated(r);
    log.info('chats', 'hand-off saved', { chat: chatId, data: { source: info.source, reason: opts.reason ?? 'manual', chars: info.text.length, contextTokens: r.s.contextTokens ?? null } });
    return info;
  }

  /** "Riprendi": a NEW chat on the same engine, folder and choices that starts from the hand-off (written first when
   *  missing or older than the last turn). The old chat's process ends; it stays readable, linked both ways.
   *  promptPrefix: a label put before the prompt (an agent's request is marked as not the user's). */
  continueChat(chatId: string, opts: { allowStart?: boolean; promptPrefix?: string } = {}): Promise<ChatSummary> {
    const running = this.continuing.get(chatId);
    if (running) return running;
    const p = this.doContinue(chatId, opts).finally(() => this.continuing.delete(chatId));
    this.continuing.set(chatId, p);
    return p;
  }

  private async doContinue(chatId: string, opts: { allowStart?: boolean; promptPrefix?: string }): Promise<ChatSummary> {
    const r = this.need(chatId);
    if (r.s.isOrchestrator) throw new Error('L’Orchestrator non si riprende così: usa «Ricomincia da capo» dal suo menu.');
    const next = r.s.continuedBy && this.chats.get(r.s.continuedBy.id);
    if (next) return { ...next.s };
    // never two agents on the same files: the old chat must have finished its turn (a fresh note does not cover this one)
    const hasTurns = r.lastTurnAt > 0 || r.items.some(i => i.kind === 'result' || i.kind === 'user');
    if (r.handoffTurn || (hasTurns && (r.session?.busy || r.pending.size > 0))) throw new Error('La chat sta lavorando o ti aspetta: si riprende quando ha finito il turno.');
    const saved = this.handoffs.read(chatId);
    const fresh = saved && saved.at >= r.lastTurnAt ? saved : null;
    r.handoffStopped = false;
    const h = fresh ?? await this.handoff(chatId, { reason: 'continue', ...(opts.allowStart === false ? { allowStart: false } : {}) });
    const taken = [...this.chats.values()].map(x => x.s.title);
    // a delegated chat goes on as the same child: under its parent, with its contract, its result still the parent's
    // (never a root chat that escapes the limits or that the Orchestrator could read, ADR 0083)
    const parentRec = r.s.parentId ? this.chats.get(r.s.parentId) : undefined;
    if (r.s.parentId && !parentRec) throw new Error('La chat che l’ha delegata non c’è più: questa non si riprende da sola.');
    const c = await this.create({
      harness: r.s.harness, cwd: r.s.cwd, title: nextTitle(r.s.title, taken),
      ...(r.choice.model ? { model: r.choice.model } : {}), ...(r.choice.effort ? { effort: r.choice.effort } : {}), ...(r.choice.permissionMode ? { permissionMode: r.choice.permissionMode } : {}),
      // a routed job stays one outcome across hand-offs: the new chat writes on the first chat's ledger line
      ...(r.s.route ? { route: { ...r.s.route, ledgerId: r.s.route.ledgerId ?? `app:${r.s.id}`, handoffs: (r.s.route.handoffs ?? 0) + 1 } } : {}),
      prompt: `${opts.promptPrefix ? `${opts.promptPrefix}\n\n` : ''}${continuePrompt({ ...r.s, ...(r.inWorktree ? { inWorktree: true } : {}) }, h)}`,
      ...(parentRec ? { parentId: parentRec.s.id, ...(r.s.delegation ? { delegation: structuredClone(r.s.delegation) } : {}) } : {}),
    }, 'user', { owner: r.s.agent ?? plainOwner(r.s.harness, r.choice.model), instructions: r.agentInstructions ?? '', policy: r.policy ?? null, assets: r.agentAssets, ...(r.skills ? { skills: [...r.skills] } : {}), ...(r.maxContext ? { maxContext: r.maxContext } : {}) },
    {}, { continuation: !!parentRec });
    const nr = this.chats.get(c.id);
    // the worktree hint follows the chain (A → B → C)
    if (nr) { nr.s.continuedFrom = { id: r.s.id, title: r.s.title }; if (r.inWorktree) nr.inWorktree = true; this.updated(nr); }
    // the agent's work goes on in a new run: the old one counts as reworked (§5)
    if (nr?.s.run && r.s.run && this.runs.get(r.s.run.runId)) { nr.s.run.continuedFrom = r.s.run.runId; this.runSave(); }
    r.s.continuedBy = { id: c.id, title: c.title };
    this.addItem(r, sysItem('continuedIn', { title: c.title }, 'info'), false);
    this.persist();
    this.updated(r);
    // its context is not re-read any more: the process ends now, or when the turn that just wrote the hand-off settles
    if (r.session && !r.session.busy) await this.closeKeeping(r, r.session);
    else if (r.session) r.reopen = true;
    log.info('chats', 'chat continued in a new one', { chat: chatId, data: { next: c.id, handoff: h.source, fresh: !!fresh } });
    return { ...(nr?.s ?? c) };
  }

  /** Writes the hand-off when it is missing or older than the last turn (the auto-close calls it before archiving). */
  async ensureHandoff(chatId: string, opts: HandoffOptions = {}): Promise<HandoffInfo> {
    const r = this.need(chatId);
    const saved = this.handoffs.read(chatId);
    if (saved && saved.at >= r.lastTurnAt) return saved;
    return this.handoff(chatId, { reason: 'finished', ...opts });
  }

  // ---- cold chats: the invisible continuation (ADR 0031) ----

  /** How the Claude chats used their context (zero tokens: from the usage the engines report). */
  contextStats(): ContextStats { return this.counters.snapshot(); }

  private coldOn(): boolean { return !!this.opts.coldHandoff?.(); }
  private ttl(): number { return this.opts.cacheTtlMs ?? CACHE_TTL_MS; }

  private coldView(r: Rec): ColdView {
    return {
      harness: r.s.harness, isOrchestrator: r.s.isOrchestrator, continuedBy: r.s.continuedBy,
      // an archived chat kept alive for its note counts as idle (archive: closeAfterCold)
      state: r.closeAfterCold && r.s.closedAt && r.s.state === 'closed' ? 'idle' : r.s.state,
      // a final answer that waits for its work counts as one more background task: no note, no fresh session
      pending: r.pending.size, background: (r.s.background ?? 0) + (r.s.waitsOnWork ? 1 : 0) + (r.s.work && r.s.work.status !== 'completed' ? 1 : 0) + (this.observedChildrenBusy(r) ? 1 : 0), busy: !!r.session?.busy, alive: !!r.session?.alive, handoffTurn: !!r.handoffTurn,
      contextTokens: r.s.contextTokens ?? 0, lastTurnAt: r.lastTurnAt, noteAt: r.coldNoteAt ?? 0,
      lastCallAt: Math.max(r.lastTurnAt, r.coldNoteAt ?? 0), askedFor: r.coldAskedFor,
    };
  }

  /** Every minute (coldEveryMs): each idle long Claude chat whose cache is about to expire writes its note quietly;
   *  an archived chat kept for its note whose chance passed ends its engine. Returns how many were asked. */
  coldTick(now = Date.now()): number {
    if (updateActivity.frozen) return 0;
    if (this.quitting) return 0;
    const on = this.coldOn(), idle = this.opts.coldIdleMs?.() ?? 50 * 60_000, day = !!this.opts.orchestratorDayCompact?.();
    let n = 0;
    for (const r of this.chats.values()) {
      if ((r.deliveryHolds ?? 0) > 0 || this.observedChildrenBusy(r)) continue;
      const v = this.coldView(r);
      const step = continuityStep({ ...v, ctxSince: r.ctxSince, askedOn: r.dayCompactOn }, now, { cold: on, day, idleMs: idle, ttlMs: this.ttl() });
      if (step === 'note') { n++; void this.coldNote(r); continue; }
      if (step === 'compact') { n++; void this.orchestratorCompact(r, now); continue; }
      if (step === 'pause') { n++; r.coldAskedFor = r.lastTurnAt; void this.orchestratorCompact(r, now, ORCHESTRATOR_PAUSE_COMPACT); continue; }
      if (r.closeAfterCold && !r.handoffTurn && (!on || !coldArmed(v, now, this.ttl()))) void this.endKept(r);
    }
    return n;
  }

  /** One quiet hand-off turn on the warm cache: nothing shows in the tile; the note is saved only when the chat wrote
   *  it (a token-free note is no base for a continuation: the next message then resumes the old session). */
  private async coldNote(r: Rec): Promise<void> {
    r.coldAskedFor = r.lastTurnAt;
    const ctx = r.s.contextTokens ?? 0;
    log.info('chats', 'cold chat: asking its note while the cache is warm', { chat: r.s.id, data: { contextTokens: ctx, idleMin: Math.round((Date.now() - Math.max(r.lastTurnAt, r.coldNoteAt ?? 0)) / 60000) } });
    let text: string | null = null;
    try { text = await this.askHandoff(r, 'cold', true); } catch (e) {
      log.warn('chats', 'cold note turn failed', { chat: r.s.id, cause: errText(e), hint: 'the next message resumes the old session (one cold re-read)' });
    }
    if (this.chats.get(r.s.id) !== r) return;
    if (text) {
      const info = this.handoffs.write(r.s.id, { title: r.s.title, text, at: Date.now(), source: 'chat', ...(ctx ? { contextTokens: ctx } : {}) });
      r.s.handoffAt = info.at; r.s.handoffSource = 'chat';
      // a message queued behind the quiet turn goes on in the old session: the note is no base for it
      if (!r.working) r.coldNoteAt = info.at;
      this.counters.note(r.s.id, 'written', { contextTokens: ctx, chars: info.text.length });
      this.persist();
      this.updated(r);
    } else log.info('chats', 'cold note not written', { chat: r.s.id, data: { stopped: !!r.handoffStopped } });
    if (r.closeAfterCold) await this.endKept(r);
  }

  /** An Orchestrator's day compaction (continuity.ts orchestratorDayDue): one quiet `/compact` turn with what to keep; the engine's compact_boundary
   *  shows in the tile («Contesto compattato») and starts its context's day again. Same chat, same session. */
  private async orchestratorCompact(r: Rec, now: number, prompt = ORCHESTRATOR_COMPACT): Promise<void> {
    r.dayCompactOn = romeDay(now);
    const sess = r.session;
    if (!sess) return;
    log.info('chats', 'Orchestrator: compacting a context from an earlier day', { chat: r.s.id, data: { contextTokens: r.s.contextTokens ?? null, since: r.ctxSince ?? null } });
    this.addItem(r, sysItem('dayCompactStart', undefined, 'info'), false);
    const out = await this.quietTurn(r, sess, prompt, true).catch((e: unknown) => {
      log.warn('chats', 'Orchestrator day compaction not sent', { chat: r.s.id, cause: errText(e), hint: 'it still compacts by itself at its window (compactWindowTokens); tomorrow it tries again' });
      return null;
    });
    if (out !== null) return;
    log.info('chats', 'Orchestrator day compaction did not finish', { chat: r.s.id, data: { contextTokens: r.s.contextTokens ?? null } });
    this.addItem(r, sysItem('dayCompactFailed', undefined, 'warn'), false);
  }

  /** The engine an auto-close kept for the cold note ends now (the chat stays archived). */
  private async endKept(r: Rec): Promise<void> {
    r.closeAfterCold = false;
    const sess = r.session;
    // the note's result comes a moment before the engine reports idle
    for (let i = 0; i < 50 && sess?.busy && r.session === sess && r.s.closedAt; i++) await new Promise(res => setTimeout(res, 200));
    if (!r.s.closedAt || !sess || sess.busy || r.session !== sess || r.pending.size > 0 || (r.deliveryHolds ?? 0) > 0 || this.unsettledChildren(r)) return;
    await sess.close();
    this.reapKept(r);
  }

  /** A message to a cold chat whose cache expired: the old session ends, a fresh one (new session id, same chat,
   *  title and choices) will start from the note. Returns the step the first message carries (send commits it with
   *  coldDone once the engine started, or undoes it with coldUndo when it did not), null when the chat
   *  goes on as usual. A second message meanwhile waits for the switch. */
  private async coldSwitch(r: Rec): Promise<ColdStep | null> {
    if (r.switching) { await r.switching; return null; }
    if (!this.coldOn() || this.unsettledChildren(r) || !coldRoute(this.coldView(r), Date.now(), this.ttl())) return null;
    const h = this.handoffs.read(r.s.id);
    if (!h || h.source !== 'chat' || h.at < r.lastTurnAt) { r.coldNoteAt = undefined; return null; }
    const run = (async (): Promise<ColdStep | null> => {
      if (r.releasing) await r.releasing;
      if (this.unsettledChildren(r) || !coldRoute(this.coldView(r), Date.now(), this.ttl())) return null;
      const revision = r.activityRevision;
      if (r.session) {
        r.autoEnding = true;
        try { await this.closeKeeping(r, r.session); } finally { r.autoEnding = false; }
      }
      if (r.activityRevision !== revision || this.unsettledChildren(r) || r.pending.size > 0 || workBehind(r.s)) return null;
      const now = Date.now(), old = r.s.sessionId;
      const step: ColdStep = {
        h, old, at: now, idleMin: Math.round((now - Math.max(r.lastTurnAt, r.coldNoteAt ?? 0)) / 60000),
        prev: { forkFrom: r.forkFrom, costTotalUsd: r.costTotalUsd, contextTokens: r.s.contextTokens, contextMaxTokens: r.s.contextMaxTokens, coldNoteAt: r.coldNoteAt, after: r.after },
        notePath: isUuid(old) ? this.handoffs.archive(r.s.id, old) : h.path,
      };
      if (isUuid(old)) { (r.pastSessions ??= []).push({ sessionId: old, at: now, notePath: step.notePath }); r.pastSessions.splice(0, Math.max(0, r.pastSessions.length - 20)); }
      r.s.sessionId = crypto.randomUUID();
      delete r.forkFrom;
      r.costTotalUsd = 0; // the new session's own running total starts from zero
      delete r.s.contextTokens; delete r.s.contextMaxTokens;
      r.coldNoteAt = undefined;
      r.after = { kind: 'continuation', left: AFTER_CALLS };
      return step;
    })();
    r.switching = run;
    try { return await run; } finally { r.switching = undefined; }
  }

  /** The fresh session started: the divider folds the old session, the note counts as used. */
  private coldDone(r: Rec, c: ColdStep): void {
    this.addItem(r, coldDivider(c.old ?? 'x', c.at, c.notePath), false);
    this.counters.note(r.s.id, 'used', { idleMin: c.idleMin, contextTokens: c.h.contextTokens ?? null });
    this.persist();
    this.updated(r);
    log.info('chats', 'cold chat continued in a fresh session', { chat: r.s.id, data: { idleMin: c.idleMin, from: c.old, to: r.s.sessionId, contextTokens: c.h.contextTokens ?? null } });
  }

  /** The fresh session did not start: back to the old one, the note kept for the next message. */
  private coldUndo(r: Rec, c: ColdStep): void {
    if (r.session) return; // an engine on the new id runs: keep it
    if (c.old) r.s.sessionId = c.old;
    if (isUuid(c.old)) r.pastSessions?.pop();
    if (c.prev.forkFrom) r.forkFrom = c.prev.forkFrom;
    r.costTotalUsd = c.prev.costTotalUsd;
    if (c.prev.contextTokens !== undefined) r.s.contextTokens = c.prev.contextTokens;
    if (c.prev.contextMaxTokens !== undefined) r.s.contextMaxTokens = c.prev.contextMaxTokens;
    r.coldNoteAt = c.prev.coldNoteAt;
    r.after = c.prev.after;
    this.persist();
    this.updated(r);
    log.warn('chats', 'cold continuation not started', { chat: r.s.id, cause: r.s.lastError ?? 'engine did not start', hint: 'the note stays: the next message tries the fresh session again' });
  }

  /** App quit. Every CLI gets its tree killed at once, idle ones too: one that ended cleanly would leave its MCP
   *  servers and shells running, and the reap after an exit (a 3-40 s process list) does not finish before the app is
   *  gone (owner, 2026-10-12). Busy turns are lost at quit anyway; transcripts are already on disk. We wait for the
   *  kills to land, because taskkill /T needs claude.exe alive to find its children and takes 1-3.5 s to start on
   *  Windows (15-40 s on a loaded one); then one more kill for anything left, awaited without blocking the main
   *  process. Resolves within `capMs` (under the app's 6 s quit cap, index.ts): what is still alive then is the
   *  orphan sweep's on the next start. */
  async shutdown(graceMs = 800, capMs = 5500): Promise<void> {
    const end = Date.now() + capMs;
    this.quitting = true;
    for (const timer of this.synthesisRetry.values()) clearTimeout(timer);
    this.synthesisRetry.clear();
    // child results still waiting for their siblings: kept on the parent, sent after the next start (resumeInterrupted)
    for (const [parentId, q] of this.childResults) {
      const parent = this.chats.get(parentId);
      if (parent && q.items.length) parent.heldResults = uniqueChildResults([...(parent.heldResults ?? []), ...q.items]);
    }
    this.persist();
    this.warm.stop();
    this.admission?.stop(); // what still waits is lost with the run; a cut turn (working) resumes on the next start anyway
    const live = [...this.chats.values()].map(r => r.session).concat(this.warm.engines.map(w => w.session)).filter((x): x is HarnessSession => !!x && x.alive);
    // the engines outside a Job Object: what they started, pictured now (WMI is slow) for the kill at the cap
    // each of these spawns a process (WMI's PowerShell, a taskkill per engine): the slowest says what one costs now
    let spawnMs = 0;
    const timed = <T>(f: () => T): T => { const t = Date.now(); try { return f(); } finally { spawnMs = Math.max(spawnMs, Date.now() - t); } };
    const kids = timed(() => snapshotTrees(process.platform === 'win32' ? live.filter(x => !jobGuard.has(x.jobHandle)).flatMap(x => (x.pid ? [x.pid] : [])) : [], capMs));
    for (const x of live) timed(() => x.killNow());
    const closes = Promise.allSettled(live.map(x => x.close(graceMs)));
    // timed from the start, not from here, and the last kill keeps room for what it spawns (the reaper) at this load:
    // a fixed 1 s let the quit end 146 ms past the app's 6 s cap at full CPU (2026-10-14)
    const last = Math.max(1000, 3 * spawnMs);
    await Promise.race([closes, new Promise(r => setTimeout(r, Math.max(0, Math.min(end - capMs + graceMs + 4500, end - last) - Date.now())).unref())]);
    await this.killLeft(Math.max(0, end - Date.now()), kids, spawnMs);
    if (this.usageTimer) clearInterval(this.usageTimer);
    if (this.coldTimer) clearInterval(this.coldTimer);
    if (this.runTimer) clearInterval(this.runTimer);
    for (const q of this.childResults.values()) if (q.timer) clearTimeout(q.timer); // the results stay on the children (agent_children)
    this.counters.flush();
    if (!this.runs.problem) try { this.runs.flush(); } catch (e) { log.warn('chats', 'agent runs not saved at quit', { cause: errText(e) }); }
    process.off('exit', this.onExit);
    log.info('chats', 'manager stopped', { data: { sessions: live.length, left: live.filter(x => x.alive).length, ms: Date.now() - end + capMs, spawnMs } });
  }

  /** The engines running now and their chats, the waiting warm engine included (its chat id is the next chat's), plus
   *  the chats still open (the orphan sweep's owners, sweep.ts). */
  engines(): { live: { chatId: string; pid: number }[]; open: string[] } {
    const all = [...this.chats.values()];
    return {
      live: all.flatMap(r => (r.session?.alive && r.session.pid ? [{ chatId: r.s.id, pid: r.session.pid }] : []))
        .concat(this.warm.engines.flatMap(w => (w.session.alive && w.session.pid ? [{ chatId: w.chatId, pid: w.session.pid }] : []))),
      open: all.filter(r => !r.s.closedAt).map(r => r.s.id),
    };
  }

  /** Ends the engines of chats idle for `idleMs` (setting engineIdleMin): no turn, question, queue, background task or
   *  hand-off, never an Orchestrator; idle counts from the last send, turn or end of a background task (activeAt). The chat stays on the grid as idle; its next message resumes it (ensureSession). Each
   *  engine ends like a ✕ (its tools reaped, its job released). Returns how many were released. */
  releaseIdle(idleMs: number, now = Date.now()): number {
    if (idleMs <= 0 || this.quitting || updateActivity.frozen) return 0;
    let n = 0;
    for (const r of this.chats.values()) {
      const sess = r.session;
      if (!sess?.alive || sess.busy || r.releasing || r.archiving || r.opening || r.switching || r.autoClosing || (r.deliveryHolds ?? 0) > 0 || this.unsettledChildren(r) || r.handoffTurn || r.s.closedAt || r.s.isOrchestrator || r.s.quick) continue;
      if (r.s.state !== 'idle' || r.pending.size > 0 || workBehind(r.s)) continue;
      if (now - Math.max(r.activeAt ?? 0, r.lastTurnAt) < idleMs) continue;
      // a long chat waiting for its cold note keeps its engine: a resumed one would miss the cache (ADR 0031)
      if (this.coldOn() && coldArmed(this.coldView(r), now, this.ttl())) continue;
      n++;
      log.info('chats', 'idle engine released', { chat: r.s.id, data: { idleMin: Math.round((now - Math.max(r.activeAt ?? 0, r.lastTurnAt)) / 60000), pid: sess.pid } });
      // like a model change: a dev server or local stack it started stays until the chat really closes (reapKept)
      r.releasing = this.closeKeeping(r, sess).finally(() => { r.releasing = undefined; });
    }
    return n;
  }

  /** Unknown or partial observations are not evidence that a provider has no work left behind. */
  private unsettledChildren(r: Rec): boolean {
    const children = r.s.agentChildren;
    return !children || children.coverage !== 'complete' || children.active === null || children.active > 0 || this.observedChildrenBusy(r);
  }
  private observedChildrenBusy(r: Rec): boolean {
    return (r.s.agentChildren?.children.some(child => ['running', 'waiting', 'unknown'].includes(child.state)) ?? false) || this.delegatedBusy(r.s.id);
  }
  /** A delegated child still owes this chat its result (open, no agent_report yet): the parent waits for it. */
  private delegatedBusy(parentId: string): boolean {
    for (const c of this.chats.values()) if (c.s.parentId === parentId && !c.s.closedAt && c.s.delegation && !c.s.delegation.result) return true;
    return false;
  }

  /** The chats this one delegated (agent_delegate), oldest first. */
  delegatedBy(parentId: string): ChatSummary[] {
    return this.list().filter(c => c.parentId === parentId);
  }

  /** A delegated chat's agent_report (agents/delegation.ts checked it): the result is kept on the chat and its run, its
   *  assignment completes at the end of this turn, and the parent gets it as a message at once (it reopens a closed
   *  parent). At most one per delegation. */
  reportDelegation(chatId: string, result: DelegationResult): { parentId: string; delivered: boolean } {
    const r = this.need(chatId), d = r.s.delegation, parentId = r.s.parentId;
    if (!d || !parentId) throw new Error('agent_report: only a delegated chat reports (agent_delegate started it); report to the Orchestrator with send_to_chat.');
    if (result.verdict !== undefined || result.verified !== undefined) throw new Error('Delegated reports cannot claim independent review fields.');
    this.checkReportVersion(r, result);
    if (r.s.plan && result.outcome !== 'blocked') r.s.plan = finishPlan(r.s.plan, Date.now());
    if (d.result) throw new Error('agent_report: this delegation already has its result: the first report was saved and nothing else is needed. Stop here.');
    const at = Date.now(), met = result.doneWhen.filter(x => x.met).length;
    // the user changed the child's goal in its chat: the card shows the user's goal, the contract's stays as originalGoal
    const goal = result.goalChangedByUser && result.newGoal ? { goal: result.newGoal, originalGoal: d.originalGoal ?? d.goal } : {};
    r.s.delegation = { ...d, ...goal, result: { outcome: result.outcome, summary: result.summary, at, doneWhen: result.doneWhen.map(x => ({ criterion: x.criterion, met: x.met })) } };
    const run = r.s.run;
    if (run) {
      run.delivery = { policy: 'synthesize', reportedAt: at, attempts: 0 };
      run.report = { at, outcome: result.outcome, verified: met === result.doneWhen.length ? 'yes' : met ? 'partial' : 'no', summary: cut(result.summary, 140), via: 'agent_report', canonical: { ...structuredClone(result), at, taskId: run.taskId ?? run.runId, runId: run.runId, taskVersion: run.taskVersion ?? 1 } };
      this.runSave();
    }
    r.report = { text: result.summary, at, ...(result.outcome === 'blocked' ? { blocked: true } : {}) };
    // the deliverable is written only in the report now: its summary is the chat's last line (strip, digest, notices)
    r.s.lastText = cut(result.summary, 300);
    this.persist();
    this.updated(r);
    const parent = this.chats.get(parentId);
    // the parent Strategist's step for this child: done once every chat of the step reported done (ADR 0108)
    if (parent?.s.plan && (!run?.parentRunId || run.parentRunId === parent.s.run?.runId)) {
      // a sibling gone without a result (closed by the user) counts as not done: the step shows blocked, never stuck
      const next = afterReport(parent.s.plan, chatId, id => { const c = this.chats.get(id); return c ? (!c.s.run?.parentRunId || c.s.run.parentRunId === parent.s.run?.runId ? c.s.delegation?.result?.outcome : undefined) : 'blocked'; }, at);
      if (next !== parent.s.plan) { parent.s.plan = next; this.persist(); }
    }
    if (parent) {
      this.updated(parent); // its waiting on this child may be over
      this.queueChildResult(parentId, r.s.title, `[task ${run?.runId ?? chatId}]\n${resultMessage(d.role, r.s.title, result)}`, run?.runId);
    }
    log.info('chats', 'delegation reported', { chat: chatId, data: { parent: parentId, outcome: result.outcome, met, criteria: result.doneWhen.length } });
    return { parentId, delivered: !!parent };
  }

  /** agent_ask_parent (agents/delegation.ts): the child waits for its parent's answer, not on its report (#152). */
  askedParent(chatId: string): void {
    const r = this.chats.get(chatId);
    if (r) r.askedParentAt = Date.now();
  }

  /** A delegated child that owes its result and has nothing left that would bring it (#152): its turn ended clean and
   *  idle, with no question, permission, own child, background task or parent's answer pending, and its last answer
   *  does not wait for a person. The first time it is told, once, to call agent_report (with the full tool name, #144);
   *  the second time, or when its engine died with an error, the app closes the delegation itself: a result "blocked",
   *  noReport, its last answer as output, every criterion not met, delivered to the parent like a report, so the
   *  parent wakes and the tree's counters agree. */
  private owedReport(r: Rec, why: 'idle' | 'exit'): void {
    const d = r.s.delegation;
    if (!d || !r.s.parentId || d.result || r.s.closedAt || this.quitting || r.archiving || this.chats.get(r.s.id) !== r) return;
    // whatever ended the turn, a child still waiting on its parent's answer, its own children or a request owes nothing yet
    if (r.pending.size > 0 || r.askedParentAt !== undefined || this.delegatedBusy(r.s.id) || (r.s.agentChildren?.active ?? 0) > 0) return;
    if (why === 'idle') {
      const last = r.s.lastResult;
      if (!last || last.isError || last.interrupted || r.session?.busy || r.working || r.pending.size > 0 || r.s.queued || r.handoffTurn || r.deliveryHolds) return;
      if ((r.s.background ?? 0) > 0 || r.s.waitsOn || r.s.waitsOnWork || r.askedParentAt !== undefined || this.delegatedBusy(r.s.id) || (r.s.agentChildren?.active ?? 0) > 0) return;
      if (r.s.plan?.phase === 'proposed' || r.s.plan?.phase === 'asking' || r.s.plan?.phase === 'revising') return;
      if (!r.reportNudged) {
        r.reportNudged = true;
        log.info('chats', 'delegated chat ended its turn without agent_report: told once', { chat: r.s.id, data: { parent: r.s.parentId } });
        const text = `${APP_EVENT_LABEL}\nIl tuo turno è finito senza agent_report e il tuo genitore aspetta il risultato. Chiamalo ora una volta: agent_report del server MCP second-brain (in Claude Code mcp__second-brain__agent_report; se è differito, caricalo prima con ToolSearch), con outcome done, partial o blocked e doneWhen per ogni criterio. Se stai aspettando una persona, chiedilo con il pannello delle domande.`;
        void this.send(r.s.id, text, undefined, false, 'second-brain', false, { kind: 'app' }).catch(e => {
          log.warn('chats', 'report reminder not delivered', { chat: r.s.id, cause: errText(e), hint: 'the delegation is closed without a report instead' });
          this.closeWithoutReport(r, 'idle');
        });
        return;
      }
    }
    this.closeWithoutReport(r, why);
  }

  private closeWithoutReport(r: Rec, why: 'idle' | 'exit'): void {
    const d = r.s.delegation, run = r.s.run;
    if (!d || !r.s.parentId || d.result || r.s.closedAt) return;
    const criteria = run?.taskContract?.doneWhen ?? d.doneWhen, answer = lastAnswer(r.items).trim();
    const result: DelegationResult = {
      outcome: 'blocked', summary: why === 'exit' ? 'Finita con un errore del motore, senza agent_report.' : 'Finita senza agent_report: il risultato è il suo ultimo messaggio.',
      output: answer ? answer.slice(0, RESULT_OUTPUT_MAX) : '(nessun testo)', doneWhen: criteria.map(criterion => ({ criterion, met: false, evidence: 'non riportato: la chat è finita senza agent_report' })),
      ...((run?.taskVersion ?? 1) > 1 ? { taskVersion: run!.taskVersion! } : {}),
    };
    try { this.reportDelegation(r.s.id, result); }
    catch (e) { log.warn('chats', 'delegation not closed without report', { chat: r.s.id, cause: errText(e), hint: 'the parent sees the child as stopped; close it by hand' }); return; }
    r.s.delegation = { ...r.s.delegation!, result: { ...r.s.delegation!.result!, noReport: true } };
    this.endRunOf(r, 'closed');
    this.persist();
    this.updated(r);
    log.warn('chats', 'delegated chat ended without agent_report', { chat: r.s.id, cause: why === 'exit' ? 'its engine stopped with an error' : 'two turns ended without agent_report', hint: 'its last answer went to the parent as a blocked result', data: { parent: r.s.parentId } });
  }

  /** A child's result for its parent: while siblings still owe theirs, it waits (at most CHILD_RESULTS_MS) so the parent
   *  reads the batch in one turn instead of one turn per child, each re-reading its whole context. */
  private queueChildResult(parentId: string, title: string, message: string, runId?: string): void {
    const q = this.childResults.get(parentId) ?? { items: [], timer: null };
    if (q.items.some(item => item.title === title && item.message === message)) return;
    const item: HeldChildResult = { id: runId ? `result-${runId}` : crypto.randomUUID(), ...(runId ? { runId } : {}), title, message };
    q.items.push(item);
    const parent = this.chats.get(parentId);
    if (parent) {
      const held = parent.heldResults ?? [];
      if (!held.some(item => item.title === title && item.message === message)) held.push(item);
      parent.heldResults = held; this.persist(true);
    }
    this.childResults.set(parentId, q);
    if (!this.delegatedBusy(parentId)) { this.flushChildResults(parentId); return; }
    if (!q.timer) { q.timer = setTimeout(() => this.flushChildResults(parentId), this.opts.childResultsMs ?? CHILD_RESULTS_MS); q.timer.unref?.(); }
  }

  private flushChildResults(parentId: string): void {
    const q = this.childResults.get(parentId);
    if (!q) return;
    this.childResults.delete(parentId);
    if (q.timer) clearTimeout(q.timer);
    const parent = this.chats.get(parentId);
    if (!parent || !q.items.length) return;
    parent.heldResults = uniqueChildResults([...(parent.heldResults ?? []), ...q.items]);
    // A restored queue may alias heldResults. Freeze this batch before asynchronous engine startup;
    // later reports must never join its acknowledgment without joining its submitted message body.
    const batch: readonly HeldChildResult[] = uniqueChildResults(q.items).map(item => {
      const held = parent.heldResults!.find(other => sameChildResult(item, other))!;
      held.id ??= crypto.randomUUID();
      return Object.freeze({ ...held });
    });
    const from = [...new Set(batch.map(x => x.title))].join(', ');
    this.persist(true);
    const batchId = crypto.randomUUID();
    let acknowledged = false, retrying = false;
    const failed = (e: unknown) => {
      if (acknowledged || retrying) return;
      retrying = true;
      const parent = this.chats.get(parentId);
      if (parent && !this.quitting) {
        const retry = this.childResults.get(parentId) ?? { items: [], timer: null };
        for (const item of batch) if (!retry.items.some(x => x.id === item.id)) retry.items.push(item);
        if (!retry.timer) { retry.timer = setTimeout(() => this.flushChildResults(parentId), this.opts.childResultsMs ?? CHILD_RESULTS_MS); retry.timer.unref?.(); }
        this.childResults.set(parentId, retry);
      }
      log.warn('chats', 'delegation result not delivered', { chat: parentId, cause: errText(e), hint: 'the durable outbox retries delivery' });
    };
    const receipt: SubmissionReceipt = {
      beforeSubmit: () => {
        for (const item of batch) { const run = item.runId ? this.runs.get(item.runId) : undefined; if (run?.delivery) run.delivery.attempts++; }
        this.runSave();
      },
      submitted: () => {
        acknowledged = true;
        const at = Date.now();
        for (const item of batch) { const run = item.runId ? this.runs.get(item.runId) : undefined; if (run?.delivery) Object.assign(run.delivery, { deliveredAt: at, synthesisSubmittedAt: at, synthesisBatchId: batchId }); }
        this.runSave();
        const parent = this.chats.get(parentId);
        if (parent) { parent.heldResults = parent.heldResults?.filter(item => !batch.some(sent => sent.id === item.id)); this.persist(true); }
      },
      failed,
    };
    void this.send(parentId, batch.map(x => x.message).join('\n\n'), undefined, false, from, false, { kind: 'app' }, receipt).catch(failed);
  }

  /** agent_report from a root role chat the Orchestrator opened (app_create_chat, issue #93): its result is kept on its run
   *  like a delegated chat's and reaches the open Orchestrator as a message (its own chats report to it, ADR 0083 §6);
   *  the turn's end then settles the assignment as a mailed report does. At most one per assignment. */
  reportRoot(chatId: string, result: DelegationResult): { orchestratorId: string | null; delivered: boolean } {
    const r = this.need(chatId), run = r.s.run;
    if (r.s.isOrchestrator || r.s.parentId || r.s.delegation || !run || !(['orchestrator', 'user'].includes(run.startedBy) || run.startedBy === 'app' && run.taskContract?.reportExpected)) throw new Error('agent_report: only a role task with an explicit report contract may report.');
    const review = run.startedBy === 'app' && !!run.reviewOf && ['sentinel', 'judge'].includes(run.agentId);
    if ((result.verdict !== undefined || result.verified !== undefined) && !review) throw new Error('Review fields require an app-owned independent reviewer run.');
    if (review && (!['success', 'partial', 'fail'].includes(result.verdict ?? '') || !['yes', 'partial', 'no'].includes(result.verified ?? ''))) throw new Error('Independent reviews require explicit verdict and verified fields.');
    if (review && (run.endedAt !== undefined || r.s.closedAt)) throw new Error('The review assignment has already ended.');
    this.checkReportVersion(r, result);
    if (r.s.plan && result.outcome !== 'blocked') r.s.plan = finishPlan(r.s.plan, Date.now());
    if (run.report?.via === 'agent_report' || r.rootReportAt !== undefined && r.rootReportAt >= (r.s.work?.updatedAt ?? 0)) throw new Error('agent_report: this assignment already has its result: the first report was saved and nothing else is needed. Stop here.');
    const at = Date.now(), met = result.doneWhen.filter(x => x.met).length;
    {
      const policy = run.startedBy === 'orchestrator' ? this.deliveryPolicy(run.taskContract?.deliveryPolicy) : 'display';
      run.delivery = { policy, reportedAt: at, attempts: 0, ...(policy === 'synthesize' ? { synthesisRequestedAt: at, synthesisPending: true } : {}) };
      run.report = { at, outcome: result.outcome, verified: review ? result.verified! : !result.doneWhen.length ? 'no' : met === result.doneWhen.length ? 'yes' : met ? 'partial' : 'no', ...(review ? { verdict: result.verdict! } : {}), summary: cut(result.summary, 140), via: 'agent_report', canonical: { ...structuredClone(result), at, taskId: run.taskId ?? run.runId, runId: run.runId, taskVersion: run.taskVersion ?? 1 } };
      this.runSave();
    }
    r.report = { text: result.summary, at, ...(result.outcome === 'blocked' ? { blocked: true } : {}) };
    // the deliverable is written only in the report now: its summary is the chat's last line (strip, digest, notices)
    r.s.lastText = cut(result.summary, 300);
    r.rootReportAt = at;
    this.persist();
    this.updated(r);
    const orchestrator = this.openOrchestrator();
    const role = r.s.agent?.id;
    // a clean result (done, every criterion met, no question) is quiet news: the user reads it in the chat, the
    // Orchestrator gets it with its next turn instead of a turn of its own (median ~0.18 $ each, zero-token-audit round 3).
    // When the user waits for it (he asked the Orchestrator, which opened this chat for him), the app also says so in the
    // Orchestrator's chat, with the summary and Apri: a notice, never a turn (#123, the owner 2026-10-21: «mi basta la
    // notifica nella chat dell'orchestrator, non aggiungere un passaggio»)
    if (orchestrator && run.startedBy === 'orchestrator') this.updated(orchestrator);
    const local = run.startedBy !== 'orchestrator';
    if (!r.s.work) r.s.work = { status: 'assigned', updatedAt: run.startedAt };
    const waits = !!r.userWaits;
    if (isWorkRole(role)) {
      // held until the chat's turn ends (#123): the report and the turn end are one news, and neither the Orchestrator nor
      // the notice says it while the chat still shows as running
      r.heldResult = { ...(local ? { local: true } : {}), note: { chatId, title: r.s.title, role: ROLE_DEFAULTS[role].name, summary: result.summary, at }, quiet: run.delivery?.policy === 'notify', userWaits: waits,
        message: resultMessage(role, r.s.title, result, { outputMax: ORCHESTRATOR_OUTPUT_MAX }) };
      this.persist(true);
      if (!this.midTurn(r)) this.releaseResult(r);
    }
    log.info('chats', 'root chat reported', { chat: chatId, data: { orchestrator: orchestrator?.s.id ?? null, outcome: result.outcome, met, criteria: result.doneWhen.length, userWaits: waits } });
    return { orchestratorId: local ? null : orchestrator?.s.id ?? null, delivered: local || !!orchestrator };
  }

  /** Explicit user/Orchestrator request; child output remains private to its parent. Admission never acknowledges it. */
  async synthesizeResult(runId: string, source: TaskSource): Promise<void> {
    const orchestrator = this.openOrchestrator(), run = this.runs.get(runId), result = run?.report?.canonical;
    if (!orchestrator) throw new Error('Open an Orchestrator before requesting synthesis.');
    if (source.kind !== 'user' && !(source.kind === 'chat' && source.chatId === orchestrator.s.id)) throw new Error('Only the user or current Orchestrator may request root synthesis.');
    if (!run || !result || !(run.startedBy === 'orchestrator' || run.startedBy === 'user' && source.kind === 'user') || run.parentRunId || this.chats.get(run.chatId)?.s.parentId) throw new Error('Only a root task result is available for synthesis.');
    if (run.delivery?.synthesisSubmittedAt || this.synthesizing.has(runId)) return;
    const worker = this.chats.get(run.chatId);
    if (worker?.s.run?.runId === runId && (worker.working || this.midTurn(worker))) throw new Error('The worker is still finishing this result.');
    const role = run.agentId;
    if (!isWorkRole(role)) throw new Error('Unknown root task role.');
    const timer = this.synthesisRetry.get(runId);
    if (timer) clearTimeout(timer);
    this.synthesisRetry.delete(runId);
    const delivery = run.delivery ?? { policy: 'synthesize' as const, reportedAt: result.at, attempts: 0 };
    run.delivery = delivery;
    delivery.policy = 'synthesize'; delivery.synthesisRequestedAt ??= Date.now(); delivery.synthesisPending = true;
    this.synthesizing.add(runId); this.runSave(); this.persist(true); this.updated(orchestrator); if (worker) this.updated(worker);
    let submitted = false, failedOnce = false;
    const failed = (error: unknown) => {
      if (submitted || failedOnce) return; failedOnce = true;
      this.synthesizing.delete(runId);
      this.updated(orchestrator);
      if (!this.quitting && !this.synthesisRetry.has(runId)) {
        const retry = setTimeout(() => {
          this.synthesisRetry.delete(runId);
          const current = this.openOrchestrator();
          if (current) void this.synthesizeResult(runId, run.startedBy === 'user' ? { kind: 'user' } : { kind: 'chat', chatId: current.s.id }).catch(e => log.warn('chats', 'synthesis retry deferred', { cause: errText(e), hint: 'the request remains pending' }));
        }, Math.min(30_000, 1000 * Math.max(1, delivery.attempts)));
        retry.unref?.(); this.synthesisRetry.set(runId, retry);
      }
      log.warn('chats', 'root synthesis not submitted', { chat: orchestrator.s.id, cause: errText(error), hint: 'the persisted request retries; its full result remains visible' });
    };
    const receipt: SubmissionReceipt = {
      beforeSubmit: () => { delivery.attempts++; this.runSave(); },
      submitted: () => {
        submitted = true; this.synthesizing.delete(runId);
        Object.assign(delivery, { synthesisPending: false, synthesisSubmittedAt: Date.now(), synthesisBatchId: `root-${runId}`, deliveredAt: Date.now() });
        this.runSave(); this.persist(true); this.updated(orchestrator); if (worker) this.updated(worker);
      },
      failed,
    };
    const message = `[richiesta esplicita di sintesi · task ${result.taskId}, versione ${result.taskVersion}, run ${runId}]\nSintetizza il risultato per l'utente usando il risultato completo e le prove qui sotto.\n${resultMessage(role, worker?.s.title ?? run.goal, result)}`;
    try { await this.send(orchestrator.s.id, message, undefined, false, worker?.s.title ?? run.agentId, false, { kind: 'app' }, receipt); }
    catch (error) { failed(error); throw error; }
  }

  private resumeRootSyntheses(): void {
    const orchestrator = this.openOrchestrator();
    if (!orchestrator) return;
    for (const run of this.runs.list()) {
      if (run.delivery?.policy !== 'synthesize' || run.delivery.synthesisSubmittedAt || !(run.startedBy === 'orchestrator' || run.startedBy === 'user' && run.delivery.synthesisRequestedAt !== undefined) || run.parentRunId) continue;
      const worker = this.chats.get(run.chatId);
      if (worker?.s.parentId || worker?.s.run?.runId === run.runId && (worker.working || this.midTurn(worker))) continue;
      void this.synthesizeResult(run.runId, run.startedBy === 'user' ? { kind: 'user' } : { kind: 'chat', chatId: orchestrator.s.id }).catch(e => log.warn('chats', 'synthesis delivery deferred', { cause: errText(e), hint: 'the persisted result stays available' }));
    }
  }

  private deliveryPolicy(value: TaskDeliveryPolicy | undefined, child = false): TaskDeliveryPolicy {
    if (value !== undefined && !['display', 'notify', 'synthesize'].includes(value)) throw new Error('Unknown task delivery policy.');
    return value ?? (child ? 'synthesize' : 'display');
  }

  private checkReportVersion(r: Rec, result: DelegationResult): void {
    // Pre-versioning runs acquire identity before canonical serialization; readRun checks the pair strictly.
    if (r.s.run) { r.s.run.taskId ??= r.s.run.runId; r.s.run.taskVersion ??= 1; }
    const version = r.s.run?.taskVersion ?? 1;
    if ((version > 1 || result.taskVersion !== undefined) && result.taskVersion !== version) throw new Error(`agent_report: stale or missing taskVersion; current taskVersion is ${version}.`);
    if (r.s.run?.taskContract) checkResult(result, r.s.run.taskContract.doneWhen);
  }

  /** App notices are rebuilt from every retained root run, never from a delegated/private result. */
  private restoreRootNotices(): void {
    const orchestrator = this.openOrchestrator(), changed = new Set<Rec>();
    for (const run of this.runs.list().slice().sort((a, b) => a.startedAt - b.startedAt)) {
      const result = run.report?.canonical, worker = this.chats.get(run.chatId);
      if (!result || run.parentRunId || worker?.s.parentId || worker?.s.isOrchestrator) continue;
      const local = run.startedBy === 'user' || run.startedBy === 'app' && run.taskContract?.reportExpected;
      const target = run.startedBy === 'orchestrator' ? orchestrator : local ? worker : undefined;
      if (!target || worker?.s.run?.runId === run.runId && (worker.working || this.midTurn(worker))) continue;
      const id = `result-${result.runId}-${result.at}`;
      if (target.items.some(item => item.id === id)) continue;
      const title = worker?.s.title ?? run.goal, role = worker?.s.agent?.name ?? run.agentId;
      const notice = { ...sysItem('resultReady', { role, title, summary: result.summary, chatId: run.chatId }, 'info'), id, result };
      this.addItem(target, notice, false); changed.add(target);
      if (run.delivery) { run.delivery.displayedAt ??= Date.now(); run.delivery.deliveredAt ??= run.delivery.displayedAt; }
    }
    this.runSave();
    for (const target of changed) this.updated(target);
  }

  /** The open Orchestrator, if any. */
  private openOrchestrator(): Rec | undefined { return [...this.chats.values()].find(c => c.s.isOrchestrator && !c.s.closedAt); }

  /** The open Orchestrator is answering the user's own message now (its turn started from it, and it is in that turn). */
  private orchestratorAnswering(): boolean { const o = this.openOrchestrator(); return !!o?.turnFromUser && this.midTurn(o); }

  /** A root chat's held result goes now (its turn ended, or it stopped): quiet news (orchestrator-wake.ts cleanReport) when
   *  clean, else a message that wakes the Orchestrator; once. A clean one the user waits for also leaves the app's notice in
   *  the Orchestrator's chat (sys resultReady: the summary and the chat to open; no turn, no token). */
  private releaseResult(r: Rec): void {
    const held = r.heldResult;
    if (!held) return;
    const orchestrator = held.local ? r : this.openOrchestrator();
    if (!orchestrator) return; // durable outbox retries when an Orchestrator is available
    const canonical = r.s.run?.report?.canonical;
    const id = `result-${canonical?.runId ?? r.s.id}-${held.note.at}`;
    if (!orchestrator.items.some(item => item.id === id)) {
      const notice = { ...sysItem('resultReady', { role: held.note.role, title: held.note.title, summary: held.note.summary, chatId: r.s.id }, 'info'), id, ...(canonical ? { result: canonical } : {}) };
      this.addItem(orchestrator, notice, false);
      this.updated(orchestrator);
    }
    if (r.s.run?.delivery) { r.s.run.delivery.displayedAt ??= Date.now(); r.s.run.delivery.deliveredAt ??= r.s.run.delivery.displayedAt; this.runSave(); }
    // Display is unconditional and token-free. Event preferences only control the optional quiet digest.
    if (!held.local && held.quiet) this.cleanReportListeners.some(fn => { try { return fn(held.note); } catch { return false; } });
    delete r.heldResult; delete r.userWaits;
    this.persist(true); this.updated(orchestrator);
    if (!held.local && r.s.run?.delivery?.policy === 'synthesize') this.resumeRootSyntheses();
  }

  /** agent_delegate refused by a delegation limit: the parent's transcript says so and the chat carries the mark. */
  limitNotice(chatId: string, kind: DelegationLimitHit['kind'], limit: number): void {
    const r = this.chats.get(chatId);
    if (!r) return;
    r.s.limitHit = { kind, limit, at: Date.now() };
    this.addItem(r, sysItem(kind === 'depth' ? 'delegationDepth' : 'delegationParallel', { limit }, 'warn'), false);
    this.updated(r);
  }

  /** Synchronous last resort (before app.exit, will-quit, process exit): a detached taskkill /T for every CLI process
   *  still alive, never waited for (it finishes the tree after the app is gone; the CLI itself dies with libuv's
   *  kill-on-close job). Never blocks: the bounded wait is shutdown's (killLeft). No-op when nothing is alive.
   *  `sync`: the process exits right now (its 'exit' event). Otherwise (before app.exit: shutdown may have hit its cap
   *  before killLeft) the guard's helper stays for the quit's booster (jobguard.ts quit). */
  killAll(sync = false): void {
    const loose = this.takeLeft(sync);
    if (loose.length) killTrees(loose.map(x => x.pid), { fallback: () => { for (const x of loose) x.killNow(); } });
  }

  /** shutdown's last kill: like killAll, then waits (without blocking) at most `ms` for those processes to die; the
   *  ones still alive go with what `kids` pictured them starting. */
  private async killLeft(ms: number, kids: (pid: number) => number[], spawnMs: number): Promise<void> {
    const loose = this.takeLeft(false);
    const started = new Map(loose.map(x => [x.pid, x.startedAt ?? 0]));
    // their tree kill (taskkill /T) already runs since shutdown's killNow: no second one to spawn
    if (loose.length) await killTreesWithin(loose.map(x => x.pid), ms, { started: { spawnMs }, kids, after: (pids, at) => reapAfterQuit(pids.map(pid => ({ pid, created: started.get(pid) ?? 0, exited: at }))) });
  }

  /** The CLI processes still alive and not killed yet, marked killed; engines in a Job Object end with the guard's
   *  handles (kill-on-close, no taskkill), so only the others ("loose") are returned. `sync`: no await may follow
   *  (process exit), so the guard's helper is ended at once; otherwise it closes the jobs and stays for the quit's
   *  booster (jobguard.ts quit). */
  private takeLeft(sync: boolean): HarnessSession[] {
    // a killed pid stays "alive" until the loop runs 'close' again: never taskkill it twice (1-40 s each)
    const left = [...this.chats.values()].map(r => r.session).concat(this.warm.engines.map(w => w.session)).filter((x): x is HarnessSession => !!x && x.alive && !x.gone && !!x.pid && !this.killedPids.has(x.pid));
    if (!left.length) return [];
    log.warn('chats', 'killing CLI processes still alive at quit', { data: { pids: left.map(x => x.pid) } });
    for (const x of left) if (x.pid) this.killedPids.add(x.pid);
    const loose = left.filter(x => !jobGuard.has(x.jobHandle));
    if (loose.length < left.length) { if (sync) jobGuard.stop(); else void jobGuard.closeAll(); }
    return loose;
  }

  /** Claude engine status: found, path, version (from a session or the background `claude --version`). */
  cliStatus(): CliStatus {
    const p = resolveClaude(this.opts.enginePaths?.claude ?? null)?.path ?? null;
    const found = !!p && fs.existsSync(p);
    if (found && !this.version && !this.probing) {
      this.probing = true;
      void cliVersion(p).then(v => { if (v && !this.version) { this.version = v; log.info('chats', 'claude CLI', { data: { path: p, version: v } }); } });
    }
    return { found, path: p, version: this.version, loggedIn: null };
  }

  /** The app runs this session (full id or an id prefix of 8+ chars, as chats.mjs prints): the brain's poll skips it. */
  isOwnSession(idOrPrefix: string): boolean {
    const p = String(idOrPrefix ?? '').trim().toLowerCase();
    if (p.length < 8) return false;
    return [...this.chats.values()].some(r => !!r.s.sessionId && r.s.sessionId.toLowerCase().startsWith(p));
  }

  // ---- internals ----

  /** Calls a brain hook; a hook that throws is logged and never breaks the chat. */
  private hook(name: string, fn: () => void): void {
    try { fn(); } catch (e) {
      log.error('chats', `hook ${name} failed`, { cause: errText(e), hint: 'fix the listener wired in src/main/wiring.ts; the chat itself is unaffected' });
    }
  }

  /** First send of a job: the first prompt for the ledger. */
  private startJob(r: Rec, prompt: string): void {
    r.jobNew = false;
    r.firstPrompt = prompt;
  }

  /** Starts the chat's engine if it is not running (a resumed Cursor chat: waits until its replayed past has landed). */
  private async ensureSession(r: Rec): Promise<void> {
    updateActivity.assertOpen();
    if (r.releasing) await r.releasing; // never into an engine released for idleness: it ends, then this resumes
    if (!r.session) {
      this.needOn(r.s.harness);
      this.startSession(r);
      // a resumed chat on an engine that replays its past while it opens (ACP): let it land before this message, in order
      const started = r.session as HarnessSession | null;
      if (started?.ready && engineOf(r.s.harness)?.caps.transcript === false && isUuid(r.s.sessionId)) r.opening = started.ready;
    }
    if (r.opening) { await r.opening; r.opening = undefined; }
  }

  /** One hand-off turn: the request goes to the chat (shown as a short line, not as the user's message) and the
   *  answer's text between the markers comes back; null when the chat ended, timed out or answered off format. */
  private async askHandoff(r: Rec, reason: NonNullable<HandoffOptions['reason']>, quiet = false): Promise<string | null> {
    await this.ensureSession(r);
    const sess = r.session;
    if (!sess) return null;
    // a cold note never runs a tool (no now.md line): one short answer on a warm cache
    const text = handoffRequest({ title: r.s.title, reason, contextTokens: r.s.contextTokens ?? null, memTool: quiet ? null : this.opts.memTool?.() ?? null });
    const out = await this.quietTurn(r, sess, text, quiet, () => {
      if (quiet) return;
      r.s.handoffBusy = true;
      this.addItem(r, sysItem('handoffAsking', undefined, 'info'), false);
      this.updated(r);
    });
    return out === null ? null : extractHandoff(out);
  }

  /** One turn of the app's own (a hand-off, an Orchestrator's day compaction), not of the job: its assistant texts come back
   *  joined, null when it was stopped, failed or timed out (then interrupted, its late items still swallowed); `quiet` =
   *  its items stay out of the tile but the system lines. `before` runs once the turn is armed, before the text goes. */
  private quietTurn(r: Rec, sess: HarnessSession, text: string, quiet: boolean, before?: () => void): Promise<string | null> {
    const answer = new Promise<string | null>(resolve => {
      // no answer in time (e.g. a permission nobody answers): the turn is stopped, so a late answer is never taken as a real turn
      const timer = setTimeout(() => {
        finish(null);
        // the stopped turn's last items still belong to the hand-off (markers hidden, not a job turn), then it is over
        // (never for long: a failed interrupt or a CLI that never answers must not block the chat's next turns)
        const drain = (): void => { clearTimeout(expire); if (r.handoffTurn?.done === drain) r.handoffTurn = undefined; };
        const expire = setTimeout(drain, 30_000);
        expire.unref();
        r.handoffTurn = { texts: new Map(), done: drain, ...(quiet ? { quiet } : {}) };
        sess.interrupt().catch(e => { drain(); log.debug('chats', 'hand-off turn not interrupted', { chat: r.s.id, data: errText(e) }); });
      }, this.opts.handoffTimeoutMs ?? 300_000);
      timer.unref();
      const finish = (t: string | null): void => {
        clearTimeout(timer);
        if (r.handoffTurn?.done !== finish) return;
        r.handoffTurn = undefined;
        delete r.s.handoffBusy;
        this.updated(r);
        resolve(t);
      };
      r.handoffTurn = { texts: new Map(), done: finish, ...(quiet ? { quiet } : {}) };
    });
    before?.();
    try { sess.send(text); } catch (e) { r.handoffTurn?.done(null); return Promise.reject(e); }
    return answer;
  }

  /** A chat sent mail (send_to_chat): to the Orchestrator it is its report (#86, ADR 0084), read at its turn's end. */
  noteMail(chatId: string, toChatId: string | null, text: string): void {
    const r = this.chats.get(chatId), to = toChatId ? this.chats.get(toChatId) : undefined;
    if (!r || !to || r.s.isOrchestrator || !to.s.isOrchestrator) return;
    r.report = { text, at: Date.now() };
    // mailed while idle (a tool call never runs outside a turn, but a late hook might): settle it now
    if (r.s.state === 'idle' && !r.session?.busy && r.s.lastResult) { this.settleReport(r); this.updated(r); }
  }

  /** At a clean turn end: who its last answer and report say it waits for (waitsOn) and, for an assigned worker that
   *  reported and waits for nobody, its assignment completed and its agent run ended "completed" (#86, ADR 0084). The
   *  auto-close then closes it after the delay (closedBy "auto"); a question, permission or background task holds it. */
  private settleReport(r: Rec, item?: Extract<ChatItem, { kind: 'result' }>): void {
    const answer = lastAnswer(r.items), report = r.report;
    const fresh = report && (report.at >= (r.s.work?.updatedAt ?? 0));
    const who = waitsForPeople(answer) ?? (fresh ? waitsForPeople(report.text) : null);
    if (who) r.s.waitsOn = who; else delete r.s.waitsOn;
    if (fresh && !r.s.waitsOnWork && waitsForWork(report.text)) r.s.waitsOnWork = true;
    const clean = item ? !item.isError && !item.interrupted : !!r.s.lastResult && !r.s.lastResult.isError && !r.s.lastResult.interrupted;
    if (!fresh || !clean || report.blocked || who || r.s.waitsOnWork || r.s.work?.status !== 'assigned' || r.pending.size > 0 || (r.s.background ?? 0) > 0) return;
    r.s.work = { status: 'completed', updatedAt: Date.now() };
    r.autoCompleted = true;
    this.autoActivity(r);
    this.endRunOf(r, 'completed');
    try { this.persist(true); } catch (e) { log.warn('chats', 'completed assignment not saved', { chat: r.s.id, cause: errText(e), hint: 'it is saved with the next change' }); }
    log.info('chats', 'assignment completed by its final report', { chat: r.s.id });
  }

  /** A result arrived: the job ledger gets the turn; the plan windows are refreshed now and then. */
  private turnEnded(r: Rec, item: Extract<ChatItem, { kind: 'result' }>): void {
    const handoffTurn = r.handoffTurn;
    const accounting = r.turnAccounting ??= { seen: new Set(), pending: [] };
    if (!accounting.seen.has(item.id)) {
      accounting.seen.add(item.id);
      accounting.pending.push(handoffTurn ? null : r.s.run ?? null);
    }
    if (handoffTurn) {
      // stopped or failed (max tokens, cancelled): a cut answer is not a hand-off; the app writes its own note
      // a hand-off cut by a network error is given up too: Cursor's automatic "continua" would write it as a job turn
      const cut = item.isError || !!item.interrupted;
      if (cut) { r.handoffStopped = true; r.session?.noRetry?.(); }
      handoffTurn.done(cut ? null : [...handoffTurn.texts.values()].join('\n\n'));
      return; // not a turn of the job: no ledger entry
    }
    r.turnSinceDone = true; r.lastTurnAt = item.at;
    r.ctxSince ??= item.at;
    this.recordTurnEnd(r);
    r.s.lastResult = { at: item.at, isError: item.isError, ...(item.interrupted ? { interrupted: true } : {}) };
    // "Aspetto la QA…": its work still runs, whatever the engine counts (shared/waiting.ts, the chats of 2026-10-16)
    if (waitsForWork(lastAnswer(r.items))) r.s.waitsOnWork = true; else delete r.s.waitsOnWork;
    // the agent's run-report, if this turn ends with one (the latest wins; a turn without one keeps the last); a run
    // ended during this turn (its Orchestrator marked it completed) still takes it
    const run = r.s.run, turnAt = r.turnAt;
    this.receiptTurn(r, turnAt, item.at);
    // still running after the result: a queued turn follows at once (no state change starts it), and it starts now
    if (r.s.state === 'running') r.turnAt = item.at; else delete r.turnAt;
    const reply = turnReply(r.items), runReport = reportOf(reply, item.at);
    if (run && (run.endedAt === undefined || (turnAt !== undefined && run.endedAt >= turnAt))) {
      if (runReport && run.report?.via !== 'agent_report') { run.report = runReport; this.runSave(); }
    }
    // a run-report block is a final report too (the Orchestrator reads it with the turn's end): "blocked" waits on it
    if (runReport) r.report = { text: runReport.summary, at: item.at, ...(runReport.outcome === 'blocked' ? { blocked: true } : {}) };
    this.settleReport(r, item);
    const first = r.firstPrompt;
    r.firstPrompt = null;
    const on = this.opts.onTurnEnd;
    if (on) {
      const info: TurnEndInfo = {
        chatId: r.s.id, sessionId: r.s.sessionId, harness: r.s.harness, model: r.s.model, effort: r.s.effort,
        ...(first ? { firstPrompt: first } : {}),
        costUsd: item.costUsd, durationMs: item.durationMs, turns: item.turns, isError: item.isError,
        reply: turnReply(r.items),
      };
      this.hook('onTurnEnd', () => on(info));
    }
    this.askUsage(r);
  }

  /** Asks a live Claude session for get_usage, at most once per usageEveryMs: the plan windows for the top bar and, in
   *  a running turn, its real cost so far (claude.ts). Busy chats take turns, so each one's live cost gets corrected. */
  private askUsage(prefer?: Rec): void {
    const rate = this.opts.onRateLimit;
    if (!rate || Date.now() - this.lastUsageAt < (this.opts.usageEveryMs ?? 60000)) return;
    const live = (x: Rec | undefined): x is Rec => !!x?.session?.alive && !!engineOf(x.s.harness)?.caps.usage;
    const all = [...this.chats.values()].filter(live);
    const busy = all.filter(x => x.session?.busy);
    const next = busy.length ? busy[(busy.findIndex(x => x.s.id === this.lastUsageChat) + 1) % busy.length] : undefined;
    const r = live(prefer) ? prefer : next ?? all[0];
    if (!r?.session) return;
    this.lastUsageAt = Date.now();
    this.lastUsageChat = r.s.id;
    r.session.usage().then(u => { if (u) this.hook('onRateLimit', () => rate(u)); })
      .catch(e => log.debug('chats', 'get_usage not answered', { chat: r.s.id, data: errText(e) }));
  }

  /** The Orchestrator role moves elsewhere: the chat stays as a normal one. Its live process keeps the app-control tools it
   *  was started with, so it is closed now (idle) or after this turn: the next message resumes it without them. */
  private demoteOrchestrator(r: Rec): void {
    r.s.isOrchestrator = false;
    this.persist();
    const sess = r.session;
    if (sess && !sess.busy && r.pending.size === 0) void this.closeKeeping(r, sess);
    else if (sess) r.reopen = true;
    log.info('chats', 'orchestrator role moved away', { chat: r.s.id });
    this.updated(r);
  }

  private unarchive(r: Rec): void {
    // an engine the auto-close kept for its cold note is live again: idle release and the cold timer see it
    if (r.closeAfterCold && r.session?.alive && r.s.state === 'closed') r.s.state = r.session.busy ? 'running' : 'idle';
    r.closeAfterCold = false;
    delete r.s.closedAt;
    delete r.s.closedBy;
    this.persist();
    log.info('chats', 'chat reopened', { chat: r.s.id });
    this.updated(r);
  }

  /** Only the newest MAX_ARCHIVED archived chats stay in the app. */
  private pruneArchived(): void {
    const old = [...this.chats.values()].filter(r => r.s.closedAt).sort((a, b) => (b.s.closedAt ?? 0) - (a.s.closedAt ?? 0)).slice(MAX_ARCHIVED);
    for (const r of old) {
      this.chats.delete(r.s.id);
      this.opts.emitter.emit('chat:removed', { chatId: r.s.id });
    }
  }

  /** A chat started from a role is a run; a store that cannot record leaves the chat as it is (logged). */
  private startRun(r: Rec, s: Omit<Parameters<AgentRunStore['start']>[0], 'chatId' | 'startedAt'>): void {
    if (this.runs.problem) return;
    try {
      r.s.run = this.runs.start({ ...s, chatId: r.s.id, startedAt: r.createdAt });
      const brainRoot = this.opts.brainRoot?.();
      if (brainRoot) r.s.run.scope = { brainRoot: path.resolve(brainRoot), projectRoot: path.resolve(r.s.cwd) };
      r.s.run.taskId = r.s.run.runId; r.s.run.taskVersion = 1;
      this.runSave();
      r.idleSince = r.createdAt;
    } catch (e) { log.warn('chats', 'agent run not recorded', { chat: r.s.id, cause: errText(e), hint: 'the chat works; this run is missing from the agent metrics' }); }
  }

  /** Ends a run and, below it, every open run it spawned (a child never ends its parent). */
  private finishRun(run: AgentRun | undefined, reason: AgentRunEnd, at = Date.now()): void {
    if (!run || run.endedAt !== undefined) return;
    const r = this.chats.get(run.chatId), mine = !!r && r.s.run === run;
    if (mine) this.ranUntil(r!, at);
    endRun(run, reason, at);
    // the receipts' verdict now, unless a turn's files are still coming (receiptTurn settles it then)
    if (mine && !r!.receiptsBusy && r!.turnAt === undefined) this.settleReceipts(run);
    this.hook('agent lifecycle', () => this.opts.onRunEnded?.(structuredClone(run)));
    log.info('chats', 'agent run ended', { chat: run.chatId, data: { runId: run.runId, reason } });
    for (const child of this.runs.children(run.runId)) this.finishRun(child, 'closed', at);
    if (!mine) return;
    // its cost, tokens and time now live in the run: the analytics row may be pruned when the archive is full
    this.hook('analytics', () => this.analytics.rolledUp(r!.s));
    this.updated(r!);
  }
  /** A running turn of the open run stops counting at `at` (a state change, or the run's end). */
  private ranUntil(r: Rec, at: number): void {
    const run = r.s.run, since = r.runningSince;
    delete r.runningSince;
    if (since === undefined || !run || run.endedAt !== undefined || typeof run.executionMs !== 'number') return;
    run.executionMs += Math.max(0, at - since);
    this.runs.touch();
  }
  private endRunOf(r: Rec, reason: AgentRunEnd, at = Date.now()): void {
    if (!r.s.run || r.s.run.endedAt !== undefined) return;
    this.finishRun(r.s.run, reason, at);
    this.runSave();
  }
  /** Nothing waits on the user any more: an open run's stale clock starts again from now (kept in chats.json). */
  private idleAgain(r: Rec): void {
    r.idleSince = Date.now();
    if (r.s.run && r.s.run.endedAt === undefined) this.persist();
  }
  private runSave(): void {
    if (this.runs.problem) return;
    try { this.runs.save(); } catch (e) { log.warn('chats', 'agent runs not saved', { cause: errText(e), hint: 'the next run change writes them again' }); }
  }

  /** The role gate (agents/role-gate.ts) on a request before it reaches the user: an assigned skill is allowed at once,
   *  an unassigned one, an engine sub-agent other than a search and a request beyond the delegating chat's permissions
   *  are refused, visibly. True = answered here. */
  private gated(r: Rec, req: Omit<PendingRequest, 'chatId'>): boolean {
    const owner = r.s.agent, parent = r.s.parentId ? this.chats.get(r.s.parentId) : undefined;
    if (owner?.source !== 'catalog' || r.s.isOrchestrator) return false;
    const verdict = gateRequest(req, { role: { id: owner.id, name: owner.name }, skills: r.skills ?? [],
      rewrite: engineOf(r.s.harness)?.kind === 'claude',
      policy: r.policy ?? null, brainRoot: this.opts.brainRoot?.() ?? null, readScripts: this.readScripts(r),
      ...(r.agentAssets ? { plugin: runtimePluginName(r.agentAssets.pluginDir) } : {}),
      ...(r.s.parentId ? { parent: { policy: parent ? parent.policy ?? null : r.policy ?? null, title: parent?.s.title ?? r.s.parentId } } : {}) });
    if (verdict.kind === 'pass') return false;
    if (verdict.kind === 'allow') {
      r.session?.answer(req.id, { kind: 'permission', allow: true }, verdict.patch);
      log.info('chats', 'role gate allowed', { chat: r.s.id, data: { tool: req.tool, qualified: !!verdict.patch } });
      return true;
    }
    this.addItem(r, sysItem(verdict.code, verdict.params, 'warn'), false);
    r.session?.answer(req.id, { kind: 'permission', allow: false, message: verdict.message });
    log.info('chats', 'role gate refused', { chat: r.s.id, data: { tool: req.tool, code: verdict.code } });
    return true;
  }

  /** A role that may only read commands (shell-read): a command it asks to run that does not only read is refused at
   *  once, visibly, and never reaches the user, unless a delegating chat that may run any command is above it (beyond
   *  the role, within the parent: the user's call; one beyond the parent never got here, gated). One that reads, or
   *  that the user decides, reaches the user without "always" (a rule would let later commands through unchecked). */
  private refusedCommand(r: Rec, req: Omit<PendingRequest, 'chatId'>): boolean {
    if (req.type !== 'permission' || !COMMAND_TOOLS.includes(req.tool) || !commandsReadOnly(r.policy)) return false;
    const command = (req.input as { command?: unknown } | null)?.command;
    const parent = r.s.parentId ? this.chats.get(r.s.parentId) : undefined;
    const parentRuns = !!parent && !commandsReadOnly(parent.policy) && allowsClass(parent.policy, 'shell');
    if (readOnlyCommand(command, this.readScripts(r)) || parentRuns) { req.noAlways = true; delete req.alwaysRules; return false; }
    const shown = typeof command === 'string' ? command.slice(0, 120) : req.tool;
    log.info('chats', 'command refused: read-only role', { chat: r.s.id, data: { tool: req.tool } });
    this.addItem(r, sysItem('commandReadOnly', { command: shown }, 'warn'), false);
    r.session?.answer(req.id, { kind: 'permission', allow: false, message: `This role may only run commands that read (shell-read): ${shown} was refused. Use a reading command, or report what you need to your parent.` });
    return true;
  }

  /** ADR 0103: the app answers a permission request itself (chats/auto-permit.ts): normal work inside the chat's folder
   *  passes, a destructive command is refused visibly with its reason, anything else reaches the user. True = answered. */
  private autoPermitted(r: Rec, req: Omit<PendingRequest, 'chatId'>): boolean {
    // a class the role was not given, or a writing command of a role that may only read commands, stays the user's call
    // (Cursor and Codex do not enforce the role's tools themselves)
    const c = toolClassOf(req.tool);
    const command = (req.input as { command?: unknown } | null)?.command;
    if (r.policy?.tools && c && !allowsClass(r.policy, c)) return false;
    if (COMMAND_TOOLS.includes(req.tool) && commandsReadOnly(r.policy) && !readOnlyCommand(command, this.readScripts(r))) return false;
    const v = autoPermit(req, { cwd: r.s.cwd, ceiling: r.policy?.ceiling ?? null, undoable: !!r.turnCheckpoint, readScripts: this.readScripts(r) });
    if (v.kind === 'ask') return false;
    if (v.kind === 'allow') {
      r.session?.answer(req.id, { kind: 'permission', allow: true });
      log.info('chats', 'auto-permit allowed', { chat: r.s.id, data: { tool: req.tool } });
      return true;
    }
    this.addItem(r, sysItem('commandDestructive', { command: v.shown, reason: v.reason }, 'warn'), false);
    r.session?.answer(req.id, { kind: 'permission', allow: false, message: v.message });
    log.info('chats', 'auto-permit refused', { chat: r.s.id, data: { tool: req.tool } });
    return true;
  }

  /** Records the chat's files before a turn (checkpoints.ts); a folder outside git is asked once, a failure never holds
   *  the message. */
  private async checkpoint(r: Rec): Promise<void> {
    if (r.gitRoot === null) return;
    try {
      const cp = await takeCheckpoint(r.s.cwd, `refs/sb/checkpoints/${r.s.id}/${Date.now()}`);
      if (!cp) { r.gitRoot = null; return; }
      r.gitRoot = cp.root;
      r.turnCheckpoint = true;
      const list = r.checkpoints ??= [];
      list.push(cp);
      if (list.length > CHECKPOINTS_KEPT) list.shift();
      r.s.checkpointAt = cp.at;
      this.updated(r);
      void pruneCheckpoints(cp.root, `refs/sb/checkpoints/${r.s.id}/`).catch(() => {});
    } catch (e) {
      log.warn('chats', 'checkpoint before the turn not taken', { chat: r.s.id, cause: errText(e), hint: 'this turn cannot be undone from the app; git itself still has the committed work' });
    }
  }

  /** «Annulla l'ultimo turno» (ADR 0103): the files back as they were before the chat's last turn. Never while it works. */
  /** The files when the turn ended (Checkpoint.after): the undo puts back only what this turn changed. */
  private recordTurnEnd(r: Rec): void {
    const cp = r.checkpoints?.at(-1);
    if (!cp || cp.after || r.afterPending) return;
    r.afterPending = afterTree(cp.root).then(tree => { if (tree) cp.after = tree; }).finally(() => { r.afterPending = undefined; });
  }

  /** A finished tool row of the open run (or of the turn it ended in) goes into its receipts (agents/receipts.ts,
   *  ADR 0130): a command and its exit code, an edit, a PR. Each row once. */
  private noteReceipt(r: Rec, item: Extract<ChatItem, { kind: 'tool' }>): void {
    const run = r.s.run!;
    if (item.status === 'running' || run.source === 'oneshot' || (run.endedAt !== undefined && (r.turnAt === undefined || run.endedAt < r.turnAt))) return;
    const seen = r.receiptRows ??= new Set();
    if (seen.has(item.id) || !noteTool(run.receipts ??= emptyReceipts(), item)) return;
    seen.add(item.id);
    if (seen.size > 500) seen.delete(seen.values().next().value!);
    this.runs.touch();
  }
  /** A turn of the run ended: the files it changed go into the receipts once git recorded its end (recordTurnEnd); a
   *  turn without its own checkpoint is a gap (files unknown). An ended run gets its verdict once they are in. */
  private receiptTurn(r: Rec, turnAt: number | undefined, end: number): void {
    const run = r.s.run;
    if (!run || run.source === 'oneshot' || (run.endedAt !== undefined && (turnAt === undefined || run.endedAt < turnAt))) return;
    const rc = run.receipts ??= emptyReceipts(), cp = r.checkpoints?.at(-1);
    if (!r.turnCheckpoint || !cp || r.receiptCp === cp) { noteTurnFiles(rc, null, 0, end); this.receiptsIn(r, run); return; }
    r.receiptCp = cp; r.receiptsBusy = true;
    void (async () => {
      let files: string[] | null = null;
      try { await r.afterPending; if (cp.after) files = await turnFiles(cp); } catch (e) { log.debug('chats', 'turn files not read for the receipts', { chat: r.s.id, data: errText(e) }); }
      noteTurnFiles(rc, files, cp.at, end);
      r.receiptsBusy = false;
      this.receiptsIn(r, run);
    })();
  }
  private receiptsIn(r: Rec, run: AgentRun): void {
    if (run.endedAt !== undefined && !r.receiptsBusy) this.settleReceipts(run); else this.runs.touch();
  }
  /** The run's deterministic verdict at its end (receipts.ts receiptVerdict), once. */
  private settleReceipts(run: AgentRun): void {
    const rc = run.receipts;
    if (!rc || rc.verdict) return;
    rc.verdict = { ...receiptVerdict({ receipts: rc, ...(run.report ? { report: run.report } : {}), doneWhen: run.taskContract?.doneWhen ?? [] }), at: Date.now() };
    this.runSave();
  }

  async undoTurn(chatId: string): Promise<{ restored: number; removed: number }> {
    const r = this.need(chatId);
    if (this.midTurn(r) || r.pending.size > 0) throw new Error('La chat sta lavorando: fermala prima di annullare il suo ultimo turno.');
    if (this.unsettledChildren(r)) throw new Error('Le chat che questa ha avviato lavorano ancora: aspetta che finiscano prima di annullare il turno.');
    const cp = r.checkpoints?.at(-1);
    if (!cp) throw new Error('Niente da annullare: questa chat non lavora in un repository git, o non ha ancora fatto un turno da quando l’app è aperta.');
    // another chat working in the same repository now: its files would move under it
    for (const o of this.chats.values()) if (o !== r && o.gitRoot === cp.root && this.midTurn(o)) throw new Error(`«${o.s.title}» sta lavorando nella stessa cartella: aspetta che finisca prima di annullare il turno.`);
    await r.afterPending;
    const out = await restoreCheckpoint(cp, `refs/sb/undo/${r.s.id}/${Date.now()}`);
    void pruneCheckpoints(cp.root, `refs/sb/undo/${r.s.id}/`, 10).catch(() => {});
    r.checkpoints!.pop();
    const prev = r.checkpoints!.at(-1)?.at;
    if (prev === undefined) delete r.s.checkpointAt; else r.s.checkpointAt = prev;
    const kept = out.skipped.length ? ` ${out.skipped.length} file cambiati di nuovo dopo il turno sono rimasti come sono.` : '';
    r.undoNote = `[nota dell'app · l'utente ha annullato il tuo ultimo turno: i file che avevi cambiato sono tornati com'erano prima (${out.restored.length} ripristinati, ${out.removed.length} rimossi).${kept} Le modifiche di quel turno non ci sono più.]`;
    this.addItem(r, sysItem('turnUndone', { restored: out.restored.length, removed: out.removed.length, skipped: out.skipped.length }, 'info'), false);
    this.updated(r);
    log.info('chats', 'turn undone: files restored from the checkpoint', { chat: r.s.id, data: { restored: out.restored.length, removed: out.removed.length, skipped: out.skipped.length } });
    return { restored: out.restored.length, removed: out.removed.length };
  }

  /** The brain's declared read-only tools (read-only-tools.md), resolved from the chat's folder (issue #93). */
  private readScripts(r: Rec): ReadScripts {
    return { cwd: r.s.cwd, paths: readOnlyTools(this.opts.brainRoot?.() ?? null) };
  }

  /** Each request once per run, by its id: question, permission or command. */
  private countRequest(r: Rec, req: Pick<PendingRequest, 'id' | 'type'>): void {
    const run = r.s.run;
    if (!run || run.endedAt !== undefined || r.pending.has(req.id)) return;
    const seen = r.runSeen ??= new Set();
    if (seen.has(req.id)) return;
    seen.add(req.id);
    if (seen.size > 1000) seen.delete(seen.values().next().value!);
    run.counters[req.type === 'question' ? 'questions' : req.type === 'permission' ? 'permissions' : 'commands']++;
    this.runSave();
  }

  /** When this chat's context last began again (a new session or a compaction); undefined = unknown. */
  contextSince(chatId: string): number | undefined { return this.chats.get(chatId)?.ctxSince; }

  /** Starts the open Orchestrator's engine (a resume, no message) when it has none: what the user writes first finds it up. */
  private prewarmOrchestrator(): void {
    const lampo = [...this.chats.values()].find(x => x.s.quick && !x.s.closedAt);
    if (lampo && !lampo.session && !this.quitting && engineOf(lampo.s.harness)?.caps.warm && this.opts.engineOn?.(lampo.s.harness) !== false && fs.existsSync(lampo.s.cwd))
      this.ensureSession(lampo).catch(e => log.warn('chats', 'Lampo engine not started ahead', { chat: lampo.s.id, cause: errText(e), hint: 'it starts with the first message' }));
    const r = [...this.chats.values()].find(x => x.s.isOrchestrator && !x.s.closedAt);
    if (!r || r.session || this.quitting || updateActivity.frozen || !engineOf(r.s.harness)?.caps.warm || this.opts.engineOn?.(r.s.harness) === false || !fs.existsSync(r.s.cwd)) return;
    log.info('chats', 'Orchestrator engine started ahead of the first message', { chat: r.s.id });
    this.ensureSession(r).catch(e => log.warn('chats', 'Orchestrator engine not started ahead', { chat: r.s.id, cause: errText(e), hint: 'it starts with the first message as before' }));
  }

  /** The user started typing in a chat with no engine (restored after a restart, or its engine ended): it resumes
   *  now (a resume, no message, no tokens), so the CLI's start-up (10-25 s measured in ADR 0025, more on a busy Windows
   *  PC) runs while the user types instead of after the Enter. Never for a chat whose next message goes, or will soon
   *  go, to a fresh session (coldRoute: the switch starts that one), nor for one closed, queued, closing or opening.
   *  An engine nobody writes to within PREWARM_UNUSED_MS ends again (no Claude engine is released for idleness while
   *  its sub-agents cannot be observed, so nothing else would end it). True = an engine starts. */
  prewarm(chatId: string): boolean {
    const r = this.chats.get(chatId);
    if (!r || r.session || r.releasing || r.archiving || r.switching || r.opening || r.s.closedAt || r.s.state === 'error') return false;
    if (this.quitting || updateActivity.frozen || this.admission?.entry(r.s.id)) return false;
    if (!engineOf(r.s.harness)?.caps.warm || this.opts.engineOn?.(r.s.harness) === false || !isUuid(r.s.sessionId) || !fs.existsSync(r.s.cwd)) return false;
    const now = Date.now();
    if (this.coldOn() && coldRoute(this.coldView(r), now + (this.opts.prewarmUnusedMs ?? PREWARM_UNUSED_MS), this.ttl())) return false;
    // never a quiet cold-note turn on an engine started only for this: without it the chat could not write one either
    r.coldAskedFor = r.lastTurnAt;
    r.activeAt = now;
    const turns = r.lastTurnAt;
    log.info('chats', 'engine started while the user types', { chat: r.s.id });
    this.ensureSession(r).catch(e => log.warn('chats', 'engine not started ahead of the message', { chat: r.s.id, cause: errText(e), hint: 'it starts with the message, as before' }));
    const sess = r.session as HarnessSession | null;
    if (sess) setTimeout(() => {
      if (this.quitting || this.chats.get(chatId) !== r || r.session !== sess || !sess.alive || sess.busy || r.working || r.lastTurnAt !== turns) return;
      if (r.releasing || r.archiving || r.switching || r.pending.size > 0 || (r.deliveryHolds ?? 0) > 0 || this.deliveries.has(chatId)) return;
      log.info('chats', 'engine started while typing ended unused', { chat: r.s.id });
      r.releasing = this.closeKeeping(r, sess).finally(() => { r.releasing = undefined; });
    }, this.opts.prewarmUnusedMs ?? PREWARM_UNUSED_MS).unref();
    return true;
  }

  /** The app's estimate line for a request, or null: an estimate that fails never holds the message. */
  private requestEstimate(text: string): string | null {
    try { return this.opts.requestEstimate?.(text) ?? null; } catch (e) {
      log.warn('chats', 'request estimate failed', { cause: errText(e), hint: 'the Orchestrator gets the message without it and may call task_estimate' });
      return null;
    }
  }

  private need(chatId: string): Rec {
    const r = this.chats.get(chatId);
    if (!r) throw new Error('Chat non trovata.');
    return r;
  }

  private restore(c: StoredChat): Rec {
    const restored = new AgentChildrenReducer(c.agentChildren);
    restored.end();
    const children = new AgentChildrenReducer(restored.snapshot());
    if (engineOf(c.harness)?.kind === 'api') children.coverage('complete');
    // agent-runs.json is the source of truth; a mirror it does not know (a lost or reset file) is taken back
    // (not one already pruned into the rollups: that mirror is dropped, and the chat remembers it was pruned)
    const run = c.run && (this.runs.get(c.run.runId) ?? (this.runs.problem ? c.run : this.runs.adopt(c.run)));
    const runPruned = run ? undefined : c.run ? c.run.runId : c.runPruned;
    return {
      ...(runPruned ? { runPruned } : {}),
      s: {
        agent: restoredOwner(c),
        ...(run ? { run } : {}),
        ...(c.work ? {work:c.work} : {}),
        effortStatus: initialEffort(!!engineOf(c.harness)?.caps.effort, c.effort),
        agentChildren: children.snapshot(),
        id: c.id, harness: c.harness, origin: 'app', title: c.quick ? LAMPO_TITLE : c.title, cwd: c.cwd, sessionId: c.sessionId, model: c.model, effort: c.effort,
        permissionMode: c.permissionMode, state: 'closed', costUsd: 0, pending: 0, isOrchestrator: c.isOrchestrator, ...(c.quick ? { quick: true } : {}), lastText: '', updatedAt: c.closedAt ?? c.createdAt, browserTabIds: [],
        ...(engineOf(c.harness)?.caps.cost ? {} : { costKnown: false as const }),
        ...(c.context ? { contextTokens: c.context.tokens, ...(c.context.max ? { contextMaxTokens: c.context.max } : {}), ...(c.context.estimated ? { contextEstimated: true } : {}) } : {}),
        ...(c.handoffAt ? { handoffAt: c.handoffAt, handoffSource: c.handoffSource ?? 'chat' } : {}),
        ...(c.continuedFrom ? { continuedFrom: c.continuedFrom } : {}), ...(c.continuedBy ? { continuedBy: c.continuedBy } : {}),
        ...(c.closedAt ? { closedAt: c.closedAt, closedBy: c.closedBy ?? 'auto' } : {}),
        ...(c.route ? { route: c.route } : {}),
        ...(c.parentId ? { parentId: c.parentId } : {}),
        ...(c.delegation ? { delegation: c.delegation } : {}),
        ...(c.plan ? { plan: c.plan } : {}),
      },
      createdAt: c.createdAt,
      agentInstructions: c.agentInstructions ?? '',
      ...(c.agentAssets ? { agentAssets: c.agentAssets } : {}),
      ...(c.agentSkills ? { skills: c.agentSkills } : {}),
      ...(c.agentPolicy ? { policy: c.agentPolicy } : {}),
      ...(c.agentMaxContext ? { maxContext: c.agentMaxContext } : {}),
      children,
      choice: { model: c.model, effort: c.effort, permissionMode: c.permissionMode },
      ...(c.forkFrom ? { forkFrom: c.forkFrom } : {}),
      worktree: false,
      ...(c.inWorktree ? { inWorktree: true } : {}),
      costTotalUsd: c.costTotalUsd ?? 0,
      ...(c.userTaskEvents ? { userTaskEvents: c.userTaskEvents } : {}),
      ...(c.heldResult ? { heldResult: c.heldResult } : {}),
      ...(c.rootReportAt ? { rootReportAt: c.rootReportAt } : {}),
      ...(c.userWaits ? { userWaits: true } : {}),
      ...(c.autoCompleted ? { autoCompleted: true } : {}),
      working: c.working === true, ...(c.heldResults?.length ? { heldResults: c.heldResults } : {}),
      items: [], pending: new Map(), session: null, historyLoaded: false,
      jobNew: false, firstPrompt: null, turnSinceDone: false, // a restored chat continues a job begun in an earlier run
      lastTurnAt: c.lastTurnAt ?? 0,
      ...(c.run && c.runIdleSince ? { idleSince: c.runIdleSince } : {}),
      ...(c.coldNoteAt ? { coldNoteAt: c.coldNoteAt } : {}),
      // saved before ctxSince existed: its last turn is the latest its context can have begun
      ...(c.ctxSince || c.lastTurnAt ? { ctxSince: c.ctxSince ?? c.lastTurnAt } : {}),
      ...(c.rolePrimed ? { rolePrimed: c.rolePrimed } : {}),
      ...(c.replyLang ? { replyLang: c.replyLang } : {}),
      ...(c.pastSessions?.length ? { pastSessions: c.pastSessions } : {}),
      ...(c.mcpAncestors ? { mcpAncestors: c.mcpAncestors } : {}),
    };
  }

  private persist(strict = false): void {
    const rows: StoredChat[] = [...this.chats.values()].map(r => ({
      id: r.s.id, harness: r.s.harness, cwd: r.s.cwd, sessionId: r.s.sessionId, ...(r.forkFrom ? { forkFrom: r.forkFrom } : {}),
      ...(r.s.agent ? { agent: r.s.agent, agentInstructions: r.agentInstructions ?? '' } : {}),
      ...(r.agentAssets ? { agentAssets: r.agentAssets } : {}),
      ...(r.skills ? { agentSkills: r.skills } : {}),
      ...(r.policy ? { agentPolicy: r.policy } : {}),
      ...(r.maxContext ? { agentMaxContext: r.maxContext } : {}),
      ...(r.s.run ? { run: r.s.run, ...(r.idleSince ? { runIdleSince: r.idleSince } : {}) } : r.runPruned ? { runPruned: r.runPruned } : {}),
      ...(r.s.agentChildren ? { agentChildren: r.s.agentChildren } : {}),
      ...(r.s.work ? {work:r.s.work} : {}),
      title: r.s.title, model: r.choice.model, effort: r.choice.effort, permissionMode: r.choice.permissionMode, isOrchestrator: r.s.isOrchestrator,
      ...(r.s.quick ? { quick: true as const } : {}),
      createdAt: r.createdAt, costTotalUsd: r.costTotalUsd, ...(r.inWorktree ? { inWorktree: true } : {}),
      ...(r.lastTurnAt ? { lastTurnAt: r.lastTurnAt } : {}),
      ...(r.coldNoteAt ? { coldNoteAt: r.coldNoteAt } : {}),
      ...(r.ctxSince ? { ctxSince: r.ctxSince } : {}),
      ...(r.rolePrimed?.session ? { rolePrimed: r.rolePrimed } : {}),
      ...(r.replyLang ? { replyLang: r.replyLang } : {}),
      ...(r.pastSessions?.length ? { pastSessions: r.pastSessions } : {}),
      ...(r.s.contextTokens ? { context: { tokens: r.s.contextTokens, ...(r.s.contextMaxTokens ? { max: r.s.contextMaxTokens } : {}), ...(r.s.contextEstimated ? { estimated: true } : {}) } } : {}),
      ...(r.s.handoffAt ? { handoffAt: r.s.handoffAt, handoffSource: r.s.handoffSource ?? 'chat' } : {}),
      ...(r.s.continuedFrom ? { continuedFrom: r.s.continuedFrom } : {}), ...(r.s.continuedBy ? { continuedBy: r.s.continuedBy } : {}),
      ...(r.s.closedAt ? { closedAt: r.s.closedAt, closedBy: r.s.closedBy ?? 'auto' } : {}),
      ...(r.working ? { working: true as const } : {}),
      ...(r.userTaskEvents ? { userTaskEvents: r.userTaskEvents } : {}),
      ...(r.heldResult ? { heldResult: r.heldResult } : {}),
      ...(r.rootReportAt ? { rootReportAt: r.rootReportAt } : {}),
      ...(r.userWaits ? { userWaits: true } : {}),
      ...(r.autoCompleted ? { autoCompleted: true } : {}),
      ...(r.heldResults?.length ? { heldResults: r.heldResults } : {}),
      ...(r.s.route ? { route: r.s.route } : {}),
      ...(r.s.parentId ? { parentId: r.s.parentId } : {}),
      ...(r.s.delegation ? { delegation: r.s.delegation } : {}),
      ...(r.s.plan ? { plan: r.s.plan } : {}),
      ...(r.mcpAncestors ? { mcpAncestors: r.mcpAncestors } : {}),
    }));
    if (strict) this.store.checkpoint(rows); else this.store.save(rows);
  }

  /** Explicit update consent permits closing idle CLI sessions, including partially observable providers.
   * Unlike automatic archive, this does not assert a complete child census or delete/archive any chat. */
  updateReadiness(): string | null {
    for (const r of this.chats.values()) {
      const c = r.s;
      if (r.working || r.session?.busy || c.state === 'running' || c.state === 'starting' || c.pending || c.queued || workBehind(c) ||
        r.pending.size || r.deliveryHolds || r.opening || r.releasing || r.switching || r.archiving || r.handoffTurn ||
        c.agentChildren?.children.some(x => x.state === 'running' || x.state === 'waiting')) return 'Una chat ha attività o richieste in corso. Attendi prima di aggiornare.';
    }
    return null;
  }
  checkpointForUpdate(): void {
    if (!updateActivity.frozen) throw new Error('Salvataggio chat richiesto senza pausa aggiornamento.');
    const problem = this.updateReadiness(); if (problem) throw new Error(problem);
    for (const id of this.chats.keys()) this.flushItems(id);
    this.persist(true);
  }

  private updated(r: Rec): void {
    this.refreshTaskSummary(r);
    const now = Date.now();
    r.s.updatedAt = now;
    // work time: starting or running counts; waiting for the user, idle, closed do not
    const working = (r.s.state === 'starting' || r.s.state === 'running') && !r.handoffTurn; // a hand-off turn is no work of the job
    if (working && r.s.workSince === undefined) r.s.workSince = now;
    else if (!working && r.s.workSince !== undefined) {
      r.s.workMs = (r.s.workMs ?? 0) + now - r.s.workSince;
      delete r.s.workSince;
    }
    this.flushItems(r.s.id); // streamed words held for the next step reach the UI before the new state ("finito")
    this.opts.emitter.emit('chat:updated', { ...r.s });
  }

  /** When the chat last produced anything: a transcript item, a state change or a send (agents/delegation.ts stalledMin). */
  lastEventAt(chatId: string): number | undefined {
    const r = this.chats.get(chatId);
    return r ? Math.max(r.eventAt ?? 0, r.activeAt ?? 0, r.s.updatedAt) : undefined;
  }

  /** Work time so far (the span in progress included). */
  workMs(chatId: string): number {
    const s = this.chats.get(chatId)?.s;
    return s ? (s.workMs ?? 0) + (s.workSince !== undefined ? Date.now() - s.workSince : 0) : 0;
  }

  private addItem(r: Rec, item: ChatItem, replace: boolean): void {
    r.eventAt = Date.now();
    let rep = false;
    if (replace) {
      for (let i = r.items.length - 1; i >= 0; i--) if (r.items[i]?.id === item.id) { r.items[i] = item; rep = true; break; }
    }
    if (!rep) {
      r.items.push(item);
      if (r.items.length > this.max) r.items.splice(0, r.items.length - this.max);
    }
    this.emitItem(r.s.id, item, rep);
  }

  /** Streaming without flooding IPC: newer versions of the same item within 100 ms collapse into one event (at most
   *  10 flushes a second per chat: the screen shows streamed text in steps, "Lag nell'app" 2026-10-12). A new item
   *  first flushes what is pending, so the order on screen is kept. */
  private emitItem(chatId: string, item: ChatItem, replace: boolean): void {
    if (replace) {
      let b = this.coalesce.get(chatId);
      if (!b) {
        const timer = setTimeout(() => this.flushItems(chatId), 100);
        timer.unref();
        b = { items: new Map(), timer };
        this.coalesce.set(chatId, b);
      }
      b.items.set(item.id, item);
      return;
    }
    this.flushItems(chatId);
    this.opts.emitter.emit('chat:item', { chatId, item, replace: false });
  }

  private flushItems(chatId: string): void {
    const b = this.coalesce.get(chatId);
    if (!b) return;
    clearTimeout(b.timer);
    this.coalesce.delete(chatId);
    for (const item of b.items.values()) this.opts.emitter.emit('chat:item', { chatId, item, replace: true });
  }

  private dropPending(r: Rec, requestId: string): void {
    if (!r.pending.delete(requestId)) return;
    if (!r.pending.size && !r.commandsOpen?.size) this.idleAgain(r);
    this.hook('analytics', () => this.analytics.resolved(r.s, requestId));
    r.s.pending = r.pending.size;
    this.opts.emitter.emit('pending:resolved', { chatId: r.s.id, requestId });
    this.updated(r);
  }

  /** Loads the transcript's past once (resumed or forked chats), before any new item. */
  private ensureHistory(r: Rec): void {
    if (r.historyLoaded) return;
    r.historyLoaded = true;
    if (!engineOf(r.s.harness)?.caps.transcript) return;
    // the sessions before its cold continuations come first, each closed by its divider (ADR 0031)
    const past: ChatItem[] = [];
    for (const p of r.pastSessions ?? []) {
      const f = findTranscript(p.sessionId, r.s.cwd, this.home);
      try { if (f) past.push(...readHistory(f, { cwd: r.s.cwd, maxItems: this.max }).items); } catch (e) {
        log.warn('chats', 'past session not readable', { chat: r.s.id, data: { file: f, error: errText(e) } });
      }
      past.push(coldDivider(p.sessionId, p.at, p.notePath));
    }
    if (past.length) r.items = [...past, ...r.items].slice(-this.max);
    const sid = r.s.sessionId ?? r.forkFrom;
    if (!sid) return;
    const file = findTranscript(sid, r.s.cwd, this.home);
    if (!file) return;
    try {
      const h = readHistory(file, { cwd: r.s.cwd, maxItems: this.max });
      r.items = [...past, ...h.items, ...r.items.slice(past.length)].slice(-this.max);
      if (!r.s.lastText && h.lastText) r.s.lastText = h.lastText;
      // the CLI restores a session's spend on resume (2.1.277+): its total is the baseline for per-turn costs
      if (h.costTotalUsd !== null && !r.costTotalUsd) r.costTotalUsd = h.costTotalUsd;
      if (h.title && (r.s.title === 'Nuova chat' || r.s.title === 'Fork')) r.s.title = r.forkFrom ? `${h.title} (fork)` : h.title;
      log.info('chats', 'history loaded', { chat: r.s.id, data: { items: h.items.length, file: path.basename(file) } });
    } catch (e) {
      log.warn('chats', 'history not readable', { chat: r.s.id, data: { file, error: errText(e) } });
    }
  }

  /** min(ceiling, Brother's mode) for this start. Claude without a chat choice follows his settings, so their default is
   *  read here (passing --permission-mode replaces it); other engines narrow through their own options (ceiling). */
  private modeFor(r: Rec): PermissionMode | null {
    const ceiling = r.policy?.ceiling ?? null, chosen = r.choice.permissionMode;
    if (!ceiling) return chosen;
    const brother = chosen ?? (engineOf(r.s.harness)?.kind === 'claude' ? claudeDefaultMode(r.s.cwd, { ...process.env, ...this.opts.env }) : null);
    return brother && aboveCeiling(brother, ceiling) ? ceiling : chosen;
  }

  /** Which of the app's browser tools the chat's role may use (tool-policy.ts browserAccess): the per-chat MCP serves
   *  all of them, only the reading ones, or none. */
  browserAccess(chatId: string): BrowserAccess {
    const r = this.chats.get(chatId);
    // the Orchestrator delegates browsing like any other work (ADR 0090): its 24 browser tools (~4 200 tokens of schemas)
    // were in every one of its calls
    if (r?.s.isOrchestrator) return 'none';
    const warm = r ? undefined : this.warmViews.get(chatId);
    if (warm?.view) return browserAccess({ tools: warm.toolPolicy ?? null, ceiling: warm.ceiling ?? null });
    return browserAccess(r?.policy);
  }

  /** Whether a chat sees one of the tools added to its own endpoint: only those its kind could never use are left out
   *  (refused for that kind of chat, or already on its own endpoint), so nothing that works today is lost. The
   *  Orchestrator opens root chats with app_create_chat, reports to no one and has catalog and lessons on its own
   *  endpoint (second-brain-app); a chat with no parent has no one to ask. */
  chatToolShown(chatId: string, tool: string): boolean {
    const r = this.chats.get(chatId), s = r?.s;
    // a waiting engine launched for a role: what that role's root chat would see (it lists tools once, at start)
    const warm = r ? undefined : this.warmViews.get(chatId)?.view;
    if (warm) return !(DELEGATING_ONLY.has(tool) && warm.launches?.length === 0) && (tool !== 'agent_ask_parent' || !!warm.child) && !PLAN_TOOLS.has(tool);
    if (!r || !s) return true;
    if (s.isOrchestrator) return !ORCHESTRATOR_HIDDEN.has(tool);
    // Lampo starts no work (ADR 0105): no mail to other chats, no delegation, no report, no saved script
    if (s.quick) return !LAMPO_HIDDEN.has(tool) && !tool.startsWith('agent_');
    if (tool === 'agent_ask_parent' && !s.parentId) return false;
    // the plan with the user: only a Strategist root chat has one (ADR 0108)
    if (PLAN_TOOLS.has(tool)) return !!s.plan;
    // a role that launches nobody; launches unknown (a chat saved before they were kept) = shown, as before
    if (DELEGATING_ONLY.has(tool) && r.launches?.length === 0) return false;
    // App background jobs report only when their creation explicitly supplied a task contract.
    if (tool === 'agent_report' && !s.parentId && s.run?.startedBy === 'app' && !s.run.taskContract?.reportExpected) return false;
    return true;
  }

  private mcpConfig(chatId: string): string | null {
    const url = this.opts.mcpUrlFor?.(chatId) ?? null;
    const app = this.appMcpFor(this.chats.get(chatId));
    const servers: Record<string, { type: 'http'; url: string }> = {};
    if (url) servers['second-brain'] = { type: 'http', url };
    if (app) servers['second-brain-app'] = { type: 'http', url: app };
    for (const ext of this.opts.extMcp?.(chatId).servers ?? []) servers[ext.name] ??= { type: 'http', url: ext.url };
    return Object.keys(servers).length ? JSON.stringify({ mcpServers: servers }) : null;
  }

  /** The chat as the MCP access sees it (ADR 0086): its role and each parent's, own first, and its tool policy; null =
   *  not a chat of this app. A chat whose parent is gone keeps the parent's place as no role (its policy, narrowed at
   *  start by that parent, still holds). */
  mcpContext(chatId: string, seen = new Set<string>()): { roles: (string | null)[]; policy: AgentPolicy | null } | null {
    const r = this.chats.get(chatId);
    // a warm engine's chat does not exist yet: no role and no parent until a chat adopts it (a role's launch only fixes
    // its tool list, which the engine enforces itself); once adopted, its real role is read at every gateway call
    if (!r) {
      const warm = this.warmViews.get(chatId);
      if (warm?.view && (this.warmChat === chatId || this.warm.has(chatId))) return { roles: [warm.view.role, ...(warm.view.child?.ancestors ?? [])], policy: { tools: warm.toolPolicy ?? null, ceiling: warm.ceiling ?? null } };
      return this.warmChat === chatId || this.warm.has(chatId) ? { roles: [null], policy: null } : null;
    }
    const policy = r.policy ?? null, own = r.s.agent?.source === 'catalog' ? r.s.agent.id : null;
    if (!r.s.parentId) return { roles: [own], policy };
    // a child is bounded by its ancestors' roles: the chain frozen at its creation, else (saved before it existed) the
    // live parents; a parent that is gone with no frozen chain = fail closed (no managed server), never a wider child
    if (r.mcpAncestors) return { roles: [own, ...r.mcpAncestors], policy };
    seen.add(chatId);
    if (seen.has(r.s.parentId) || seen.size > 16) return null;
    const up = this.mcpContext(r.s.parentId, seen);
    return up ? { roles: [own, ...up.roles], policy } : null;
  }

  /** the app-control endpoint of an Orchestrator, null for any other chat */
  private appMcpFor(r: Rec | undefined): string | null {
    if (!r) return null;
    if (r.s.isOrchestrator) return this.opts.appMcpUrl?.(r.s.id) ?? null;
    return null;
  }

  private startSession(r: Rec): void {
    r.s.effortStatus = initialEffort(!!engineOf(r.s.harness)?.caps.effort, r.choice.effort);
    const chatId = r.s.id;
    let sessionId = r.s.sessionId;
    let resume = false, fork = false;
    const engine = engineOrThrow(r.s.harness);
    if (!engine.caps.transcript) resume = isUuid(sessionId); // session/load; a new one gets its id from session/new
    else if (!sessionId && r.forkFrom) { sessionId = r.forkFrom; resume = true; fork = true; }
    else if (isUuid(sessionId) && findTranscript(sessionId, r.s.cwd, this.home)) resume = true;
    else if (!isUuid(sessionId)) { sessionId = crypto.randomUUID(); r.s.sessionId = sessionId; this.persist(); }
    // the role text is in the context only when this very session resumes (a fork of an external one never had it)
    if (!resume || fork || !r.rolePrimed || r.rolePrimed.session !== sessionId) r.rolePrimed = undefined;
    r.roleChecked = false;
    const past = resume ? r.children?.snapshot() : undefined;
    r.children = new AgentChildrenReducer(past);
    r.children.coverage(engine.kind === 'api' ? 'complete' : 'unknown');
    r.s.agentChildren = r.children.snapshot();
    const extraArgs = this.extraArgsFor(r.s.harness, chatId, r);
    const opts: SessionOptions = {
      chatId, cwd: r.s.cwd, model: r.choice.model, effort: r.choice.effort, permissionMode: this.modeFor(r), title: r.s.title,
      ...(r.policy ? { toolPolicy: r.policy.tools, ceiling: r.policy.ceiling } : {}),
      ...(r.agentAssets ? { agentAssets: r.agentAssets } : {}),
      // the Orchestrator's turn stays short: a few workspace calls, then it delegates (ADR 0090, issue #98)
      // a role chat with the sub-agent tool: only the Explore search, since Claude asks no permission to start one
      ...(engine.kind !== 'claude' ? {} : r.s.isOrchestrator ? { preToolUse: new TurnToolBudget() }
        : subagentGateFor(r.policy?.tools)),
      sessionId, resume, fork, worktree: r.worktree && !resume, mcpConfig: this.mcpConfig(chatId), costBaseUsd: r.costTotalUsd,
      compactWindowTokens: r.maxContext ?? this.compactWindow(),
      // Native subagents inherit this environment: a per-chat model cannot prove a memory event's producer.
      env: { ...this.opts.env, SB_EVENT_CONTEXT: '' }, ...(extraArgs ? { extraArgs } : {}),
    };
    r.worktree = false; // created once; a resume re-enters it
    let sess: HarnessSession | null = null;
    const sink = this.sinkFor(r, () => sess);
    r.s.state = 'starting';
    r.activeAt = Date.now();
    delete r.s.lastError;
    sess = this.newSession(engine.id, opts, sink, r);
    r.session = sess;
    this.updated(r);
    sess.start();
  }

  /** pre-allowed on Claude: the Orchestrator's app-control tools (/mcp/app), and every chat's mail to other chats and
   *  delegation tools (app-tool-approval.ts; mail is text only, labelled as not the user's; the auto-mode classifier sometimes refused the same message sent
   *  with Bash, 12/10). r = undefined: a warm engine (warm.ts), never an Orchestrator. */
  private extraArgsFor(harness: Harness, chatId: string, r: Rec | undefined): string[] | null {
    const allowed = !engineOf(harness)?.caps.preAllow ? [] : [
      ...(this.appMcpFor(r) ? ['mcp__second-brain-app'] : []),
      ...(this.opts.mcpUrlFor?.(chatId) && !r?.s.quick ? APP_CHAT_TOOLS.map(t => `mcp__second-brain__${t}`) : []),
    ];
    // the managed MCP servers this chat may not use: refused by name, also when the user's own Claude config has one so named
    const denied = engineOf(harness)?.kind === 'claude' ? (this.opts.extMcp?.(chatId).denied ?? []).map(id => `mcp__${id}`) : [];
    const extra = [...(allowed.length ? ['--allowedTools', allowed.join(',')] : []), ...(denied.length ? ['--disallowedTools', denied.join(',')] : [])];
    return this.opts.extraArgs || extra.length ? [...(this.opts.extraArgs ?? []), ...extra] : null;
  }

  /** An agent's message (from = its sender) never wakes a stopped chat (closed, or its engine released for idleness) on
   *  an engine the Orchestrators may not use: it would resume that engine for an agent. A running chat gets it as before. */
  private needAgentMay(r: Rec, from: string | undefined): void {
    if (from === undefined || r.session || this.opts.agentsMayOpen?.(r.s.harness) !== false) return;
    throw new AgentMayNotWake(r.s.harness);
  }

  /** Refuses an engine the user switched off (Impostazioni → Motori): nothing starts on it, whoever asks. */
  private needOn(h: Harness): void {
    if (this.opts.engineOn?.(h) === false) throw new Error(`${engineOrThrow(h).label} è spento nelle impostazioni: riaccendilo in Impostazioni → Motori.`);
  }

  /** A session on an engine: the test factory if given, else the engine's own adapter (engines/sessions.ts). The Orchestrator
   *  on any engine gets the app-control tools (app_create_chat…); r = undefined: a warm engine, never an Orchestrator. */
  private newSession(harness: Harness, opts: SessionOptions, sink: SessionSink, r: Rec | undefined): HarnessSession {
    if (this.opts.sessionFactory) return this.opts.sessionFactory(harness, opts, sink);
    const override = this.opts.enginePaths?.[harness];
    return sessionFor(engineOrThrow(harness), opts, sink, {
      userData: this.opts.userData, mcpUrl: this.opts.mcpUrlFor?.(opts.chatId) ?? null, appMcpUrl: this.appMcpFor(r),
      extMcp: this.opts.extMcp?.(opts.chatId).servers ?? [],
      showReplay: !r?.items.length, acpModelConfig: this.acpModelConfig(), key: () => this.opts.keyFor?.(harness) ?? null,
      ...(override ? { path: override } : {}), ...(this.opts.appVersion ? { appVersion: this.opts.appVersion } : {}),
    });
  }

  /** A Claude engine for the next new chat in cwd: its chat id, session id and MCP endpoint are chosen now; no model,
   *  effort, mode or title (the user's defaults until the chat sends its own as control requests). */
  private spawnWarm(cwd: string, launch: WarmLaunch): WarmEngine | null {
    if (updateActivity.frozen) return null;
    const chatId = `c_${crypto.randomBytes(5).toString('hex')}`;
    const sessionId = crypto.randomUUID();
    // its launch asks mcpContext before the pool holds it: the id is known as the warm engine's meanwhile
    this.warmChat = chatId;
    // its endpoint lists tools for the launch's role until a chat adopts it (chatToolShown, browserAccess, mcpContext)
    this.warmViews.set(chatId, launch);
    for (const k of [...this.warmViews.keys()].slice(0, Math.max(0, this.warmViews.size - 8))) this.warmViews.delete(k);
    try { return this.spawnWarmAs(chatId, sessionId, cwd, launch); } finally { this.warmChat = null; }
  }

  private spawnWarmAs(chatId: string, sessionId: string, cwd: string, launch: WarmLaunch): WarmEngine {
    const extraArgs = this.extraArgsFor('claude', chatId, undefined);
    const opts: SessionOptions = {
      chatId, cwd, model: null, effort: null, permissionMode: null, title: null, sessionId, resume: false, fork: false, worktree: false,
      ...(launch.toolPolicy !== undefined || launch.ceiling !== undefined ? { toolPolicy: launch.toolPolicy ?? null, ceiling: launch.ceiling ?? null } : {}),
      ...(launch.agentAssets ? { agentAssets: launch.agentAssets } : {}), ...subagentGateFor(launch.toolPolicy),
      mcpConfig: this.mcpConfig(chatId), costBaseUsd: 0, compactWindowTokens: launch.compactWindowTokens ?? this.compactWindow(),
      env: { ...this.opts.env, SB_EVENT_CONTEXT: '' }, ...(extraArgs ? { extraArgs } : {}),
    };
    const sink = new BufferedSink();
    const session = this.newSession('claude', opts, sink, undefined);
    session.start();
    return { chatId, sessionId, cwd, session, sink, at: Date.now() };
  }

  /** How a chat's engine is launched, as far as a waiting engine must match it: its role's tools and ceiling, its skills
   *  plugin and its own context window; nothing of these = a plain launch (sig ''). */
  private warmLaunch(policy: AgentPolicy | null | undefined, assets: { pluginDir: string; skillRoot: string } | undefined, maxContext: number | undefined, view?: WarmLaunch['view']): WarmLaunch {
    if (!policy && !assets && !maxContext && !view) return PLAIN_LAUNCH;
    const fields = { toolPolicy: policy?.tools ?? null, ceiling: policy?.ceiling ?? null, ...(assets ? { agentAssets: assets } : {}), ...(maxContext ? { compactWindowTokens: maxContext } : {}), ...(view ? { view } : {}) };
    return { sig: crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex').slice(0, 16), ...fields };
  }

  /** The new chat r takes the waiting engine: what it reported so far is replayed into the chat, then the chat's own
   *  choices go as control requests; a send waits for them (r.opening). A refused choice → a fresh engine with flags. */
  private adoptWarm(r: Rec, w: WarmEngine): void {
    const sess = w.session;
    this.warmViews.delete(w.chatId);
    r.session = sess;
    r.s.state = 'starting';
    r.activeAt = Date.now();
    delete r.s.lastError;
    w.sink.attach(this.sinkFor(r, () => sess));
    this.updated(r);
    const c = r.choice;
    const title = r.s.title !== 'Nuova chat' ? r.s.title : null;
    log.info('chats', 'warm engine adopted', { chat: r.s.id, data: { waitedMs: Date.now() - w.at, state: sess.state, model: c.model, effort: c.effort, permissionMode: c.permissionMode } });
    r.opening = (async () => {
      try {
        // a warm engine still starting: its start-up must not eat the controls' own timeout
        await sess.ready;
        if (c.model) await sess.setModel(c.model);
        if (c.effort) await sess.setEffort(c.effort);
        // the mode the chat would be launched with (its choice, or the user's default clamped to its ceiling: a
        // delegated chat's is its parent's mode), never the waiting engine's default above that ceiling
        const mode = this.modeFor(r);
        if (mode) await sess.setPermissionMode(mode);
      } catch (e) {
        log.warn('chats', 'warm engine refused the chat choices: starting a fresh one', { chat: r.s.id, data: errText(e) });
        if (r.session === sess) {
          r.session = null;
          void sess.close();
          r.s.sessionId = crypto.randomUUID(); // never two engines on one session id
          this.startSession(r);
        }
        return;
      }
      // the name the CLI keeps for /resume (a cold start passes --name); never blocks the first message
      if (title) sess.rename(title).catch(e => log.warn('chats', 'warm engine rename failed', { chat: r.s.id, data: errText(e) }));
    })();
  }

  /** The chat's side of a session: every report lands in r while current() is r's session. */
  private sinkFor(r: Rec, current: () => HarnessSession | null): SessionSink {
    const chatId = r.s.id;
    const live = (): boolean => { const sess = current(); return !!sess && r.session === sess && this.chats.get(chatId) === r; };
    return {
      item: (item, replace) => {
        if (!live()) return;
        this.hook('analytics', () => this.analytics.item(r.s, item, replace));
        this.autoActivity(r);
        if (r.handoffTurn && item.kind === 'assistant') {
          r.handoffTurn.texts.set(item.id, item.text);
          // the markers are for the app: the transcript shows the note without them
          item = { ...item, text: item.text.split('\n').filter(l => l.trim() !== HANDOFF_START && l.trim() !== HANDOFF_END).join('\n') };
        }
        // a cold note's turn stays out of the tile (ADR 0031): only its result settles the turn
        if (r.handoffTurn?.quiet && item.kind !== 'system') { if (item.kind === 'result' && !replace) this.turnEnded(r, item); return; }
        this.addItem(r, item, replace);
        // a skill Claude loaded while the run is open joins its tags (only Claude reports skills as a tool)
        if (item.kind === 'tool' && item.name === 'Skill' && r.s.harness === 'claude' && r.s.run) {
          const input = item.input as { skill?: unknown; command?: unknown } | null;
          if (addSkill(r.s.run, input?.skill ?? input?.command)) { if (r.s.run.skillSuggestions) r.s.run.skillSuggestions.used = [...r.s.run.tags!.skills]; this.runs.touch(); this.runSave(); }
        }
        if (item.kind === 'tool' && r.s.run) this.noteReceipt(r, item);
        if (item.kind === 'result' && !replace) this.turnEnded(r, item);
      },
      pending: req => {
        if (!live()) return;
        if (this.gated(r, req) || this.refusedCommand(r, req) || this.autoPermitted(r, req)) return;
        this.hook('analytics', () => this.analytics.pending(r.s, req));
        this.autoActivity(r);
        const full: PendingRequest = { ...req, chatId };
        this.countRequest(r, req);
        r.pending.set(req.id, full);
        r.s.pending = r.pending.size;
        this.opts.emitter.emit('pending:added', full);
        this.updated(r);
        const on = this.opts.onWaiting;
        if (on) this.hook('onWaiting', () => on(chatId, full));
      },
      rateLimit: msg => { const on = this.opts.onRateLimit; if (live() && on) this.hook('onRateLimit', () => on(msg)); },
      commands: list => { if (live()) r.commands = list; },
      models: list => { const on = this.opts.onModels; if (live() && on) this.hook('onModels', () => on(r.s.harness, list)); },
      children: observation => {
        if (!live()) return;
        this.autoActivity(r);
        const children = r.children ??= new AgentChildrenReducer();
        if (!children.observe(observation)) return;
        r.s.agentChildren = children.snapshot(); this.persist(); this.updated(r);
      },
      childrenCoverage: (coverage, reason) => {
        if (!live()) return;
        const children = r.children ??= new AgentChildrenReducer();
        if (reason === 'exit' && r.autoEnding && children.snapshot().coverage === 'complete' && children.snapshot().active === 0) return;
        children.coverage(coverage); r.s.agentChildren = children.snapshot(); this.persist(); this.updated(r);
      },
      resolved: id => { if (this.chats.get(chatId) === r) this.dropPending(r, id); },
      changed: p => { if (live()) this.applyPatch(r, p); },
      exit: ({ error }) => {
        const sess = current();
        if (!sess || this.chats.get(chatId) !== r || r.session !== sess) return;
        this.hook('analytics', () => this.analytics.end(r.s));
        r.session = null;
        const verifiedEmpty = r.autoEnding && !error && r.children?.snapshot().coverage === 'complete' && r.children.snapshot().active === 0;
        if (engineOf(r.s.harness)?.kind !== 'api' && !verifiedEmpty) r.children?.end();
        if (r.children) r.s.agentChildren = r.children.snapshot();
        // gone mid-turn (crash, close, kill): no result will settle the estimate, which stays as spent (no "≈")
        delete r.s.costLiveUsd;
        delete r.turnAt; // its turn is over, result or not
        r.handoffTurn?.done(null);
        delete r.s.background; // its background tasks died with it
        // died mid-turn with an error while the app runs: no result will come, so no onDone either; tell the brain now
        const crashed = !!error && r.working && !this.quitting;
        if (!this.quitting) r.working = false; // a crash while the app runs shows as an error, it is not resumed later
        if (error) r.s.lastError = error;
        if (error) delete r.s.resumedAt; // a resume that failed is no "ripresa": the error shows alone
        if (r.s.state !== 'error') r.s.state = error ? 'error' : r.releasing ? 'idle' : 'closed';
        this.persist();
        this.updated(r);
        this.releaseResult(r); // its engine is gone: a held result never waits for a turn end that will not come
        if (error) this.owedReport(r, 'exit'); // a delegated child that died owes nothing more: its parent is told (#152)
        const onCrash = this.opts.onCrash;
        if (crashed && error && onCrash) this.hook('onCrash', () => onCrash(chatId, error));
      },
    };
  }

  /** the compaction window for the next Claude engine (setting compactWindowTokens; 0 = the user's settings) */
  private compactWindow(): number {
    try { return this.opts.compactWindowTokens?.() ?? 0; } catch { return 0; }
  }

  private acpModelConfig(): { reasoning: CursorReasoning | ''; fast: boolean } | null {
    try { return this.opts.acpModelConfig?.() ?? null; } catch (e) { log.warn('chats', 'ACP model settings not read', { data: errText(e) }); return null; }
  }

  private applyPatch(r: Rec, p: SessionPatch): void {
    this.hook('analytics', () => this.analytics.patch(r.s, p));
    if (!(r.autoClosing || r.autoEnding) || p.state !== 'closed') this.autoActivity(r);
    let save = false;
    if ('effortSubmitted' in p) r.s.effortStatus = submitEffort(r.s.effortStatus ?? initialEffort(!!engineOf(r.s.harness)?.caps.effort, r.choice.effort), p.effortSubmitted);
    if ('effortObserved' in p) r.s.effortStatus = observeEffort(r.s.effortStatus ?? initialEffort(!!engineOf(r.s.harness)?.caps.effort, r.choice.effort), p.effortObserved);
    if ('effortSessionDefault' in p) r.s.effortStatus = { ...(r.s.effortStatus ?? initialEffort(!!engineOf(r.s.harness)?.caps.effort, r.choice.effort)), sessionDefault: effortValue(p.effortSessionDefault) };
    if (p.state) {
      const was = r.s.state;
      // a cold note's turn is invisible (ADR 0031): the tile stays as it was
      if (!(r.handoffTurn?.quiet && (p.state === 'running' || p.state === 'starting'))) r.s.state = p.state;
      // a hand-off turn is not the chat's work: never resumed after a restart
      if ((p.state === 'running' || p.state === 'waiting') && !r.working && !r.handoffTurn) { r.working = true; save = true; }
      // idle only once the CLI's queue is empty: a queued turn starts with no state change, so not cleared per result
      if (p.state === 'idle' && r.working) { r.working = false; save = true; }
      // the turn is over and nothing waits for the user: "done" (once per turn, never at boot)
      if (p.state === 'idle' && was !== 'idle' && r.turnSinceDone && r.pending.size === 0) {
        r.turnSinceDone = false;
        const on = this.opts.onDone;
        if (on) this.hook('onDone', () => on(r.s.id));
        this.owedReport(r, 'idle');
      }
      // a Cursor model change or an Orchestrator role change asked mid-turn: reopen now that the turn is over
      if (p.state === 'idle' && r.reopen && r.session && !r.session.busy) {
        r.reopen = false;
        void this.closeKeeping(r, r.session);
      }
    }
    if (p.sessionId && p.sessionId !== r.s.sessionId) {
      r.s.sessionId = p.sessionId; delete r.forkFrom; save = true;
      if (r.rolePrimed) r.rolePrimed = { ...r.rolePrimed, session: p.sessionId }; // same engine, same context: a new id only
    }
    if (p.model) r.s.model = p.model;
    // shown, never persisted: only the user's own choice (create / chat:set) is saved and used on the next start,
    // so a mode the CLI took from a suggestion or ExitPlanMode does not outlive this process
    if (p.permissionMode) r.s.permissionMode = p.permissionMode;
    // second guard: a mode the engine took on its own (ExitPlanMode, a suggestion, its settings) above the ceiling is
    // set back at once
    if (p.permissionMode && r.policy && aboveCeiling(p.permissionMode, r.policy.ceiling) && r.session) {
      const ceiling = r.policy.ceiling!;
      log.warn('chats', 'agent mode above its ceiling, set back', { chat: r.s.id, data: { mode: p.permissionMode, ceiling } });
      r.s.permissionMode = ceiling;
      void r.session.setPermissionMode(ceiling).catch(e => log.error('chats', 'agent ceiling not restored', { chat: r.s.id, cause: errText(e), hint: 'stop the chat: its mode is above the agent ceiling' }));
    }
    if (p.effort !== undefined) r.s.effort = p.effort;
    if (p.contextTokens !== undefined) r.s.contextTokens = p.contextTokens;
    const run = r.s.run;
    // A fresh submission also starts a turn while Claude is still running after its previous result (delayed idle).
    if ('effortSubmitted' in p && !r.handoffTurn) r.turnAt = Date.now();
    if (p.state === 'running' && !r.handoffTurn) r.turnAt ??= Date.now();
    // out of the turn with no result (a crash, a clean exit mid-turn): the next turn starts its own clock
    else if (p.state === 'idle' || p.state === 'error' || p.state === 'closed') delete r.turnAt;
    // execution time: only while running (waiting on Brother, a permission or the queue is not), never a hand-off note
    if (p.state && run && run.endedAt === undefined) {
      if (p.state === 'running' && !r.handoffTurn) r.runningSince ??= Date.now();
      else if (p.state !== 'running') this.ranUntil(r, Date.now());
    }
    if (run && run.endedAt === undefined) {
      if (p.contextTokens !== undefined && p.contextTokens > (run.counters.contextPeak ?? 0)) { run.counters.contextPeak = p.contextTokens; this.runs.touch(); }
    }
    if (p.turnCostUsd !== undefined) {
      // Engines publish result before accounting. Completion or reassignment can happen between the two.
      const owner = r.turnAccounting ? r.turnAccounting.pending.shift() : run;
      if (owner) { addTurn(owner, p.costKnown === false ? null : p.turnCostUsd, p.turnTokens, !!r.turnAccounting); this.runs.touch(); this.runSave(); }
      // Flash answered (a turn's result): what the user does next decides it (agents/flash-outcomes.ts, ADR 0131)
      if (r.s.quick) this.runs.flashEvent({ kind: 'answered', at: Date.now() });
    }
    if (p.contextMaxTokens !== undefined) r.s.contextMaxTokens = p.contextMaxTokens;
    if (p.turnCostUsd !== undefined || p.liveCostUsd !== undefined) {
      // costUsd = settled turns + the running turn's estimate; a result settles it (its real cost replaces the estimate)
      const live = r.s.costLiveUsd ?? 0;
      const settled = r.s.costUsd - live + (p.turnCostUsd ?? 0);
      const next = p.liveCostUsd ?? (p.turnCostUsd !== undefined ? 0 : live);
      r.s.costUsd = Math.round((settled + next) * 1e6) / 1e6;
      if (next > 0) r.s.costLiveUsd = Math.round(next * 1e6) / 1e6; else delete r.s.costLiveUsd;
    }
    if (p.contextEstimated === true) r.s.contextEstimated = true;
    else if (p.contextEstimated === false) delete r.s.contextEstimated;
    if (p.costKnown === true) delete r.s.costKnown;
    else if (p.costKnown === false && !r.s.costUsd) r.s.costKnown = false;
    if (p.totalCostUsd !== undefined) { r.costTotalUsd = p.totalCostUsd; save = true; }
    if (p.lastText !== undefined) r.s.lastText = p.lastText;
    if (p.background !== undefined) {
      if (p.background > 0) r.s.background = p.background;
      else if (r.s.background) { delete r.s.background; r.s.backgroundEndedAt = r.activeAt = Date.now(); }
    }
    if (p.version) this.version = p.version;
    if (p.call) {
      const a = r.after;
      if (a) { a.left--; if (a.left <= 0) r.after = undefined; }
      // the prompt cache per kind of chat, and whether a new session found its prefix cached (ContextStats.cache)
      const first = r.cacheSession !== r.s.sessionId;
      r.cacheSession = r.s.sessionId ?? undefined;
      this.counters.call(r.s.id, p.call, a ? a.kind : null, { kind: r.s.isOrchestrator ? 'orchestrator' : r.s.parentId ? 'child' : 'root', first });
    }
    if (p.compacted) {
      this.counters.compaction(r.s.id, p.compacted.pre, p.compacted.post);
      r.after = { kind: 'compaction', left: AFTER_CALLS };
      // the context starts again from its summary: an Orchestrator's next day compaction counts from now
      r.ctxSince = Date.now(); save = true;
      r.rolePrimed = undefined; // the summary may have dropped the role text: the next message carries it again
    }
    if (p.contextTokens !== undefined && p.contextTokens > 0) save = true; // the meter of a closed chat survives a restart
    if (save) this.persist();
    this.updated(r);
    // the turn that reported is over: its result goes now, after the chat shows as finished (#123)
    if (r.heldResult && p.state && p.state !== 'running' && p.state !== 'starting' && !this.midTurn(r)) this.releaseResult(r);
    // the Orchestrator's turn ended: a later turn the CLI starts by itself is not the user's (#123)
    if (r.s.isOrchestrator && r.turnFromUser && p.state && p.state !== 'running' && p.state !== 'starting' && !this.midTurn(r)) r.turnFromUser = false;
  }
}
