// The shapes behind ChatManager (manager.ts): its options, the per-chat record (Rec) and the small records its layers
// pass around. Split out of manager.ts (ADR 0200); only the chat manager's files import Rec.
import type { ChatCommand, ChatItem, ChatSummary, CursorReasoning, Effort, HandoffInfo, Harness, Lang, NewChat, PendingRequest, PermissionMode } from '../../shared/contract';
import type { Emitter } from '../ipc';
import type { HarnessSession, SessionOptions, SessionSink } from './session';
import type { HeldChildResult, PastSession } from './store';
import type { AdmissionLimits, LoadSampler } from './admission';
import type { ResolvedRole } from '../agents/catalog';
import type { AgentPolicy } from '../agents/tool-policy';
import type { UserTaskEvents, AgentRun } from '../../shared/agents';
import type { Checkpoint } from './checkpoints';
import type { AwayEntry } from './away-log';
import type { AgentChildrenReducer } from './agent-children';
import type { LampoCursor } from './lampo-context';
import type { Recall } from '../search/hybrid/recall';

/** Internal outbox receipts are tied to engine submission, never CPU queue admission. */
export interface SubmissionReceipt { beforeSubmit(): void; submitted(): void; failed(error: unknown): void }
/** Canonical root results by chat (user chats) and the Orchestrator's roots: built once per list() (resultIndex). */
export interface ResultIndex { byChat: Map<string, AgentRun[]>; roots: AgentRun[] }

export interface ChatManagerOptions {
  /** > 0: chats.json and agent-runs.json are written at most once per this many ms, asynchronously (one write per burst
   *  of changes, never blocking the main process on the disk); strict checkpoints, the quit and the exit write at once.
   *  0 / absent: every save is synchronous (unit tests read the files right after an action). */
  writeDelayMs?: number;
  /** first wait before a failed deferred write is tried again (doubles up to 60 s; default 2 s) */
  writeRetryMs?: number;
  /** a brief waits for this chat's next question (genui/artifacts.ts hasBrief, ADR 0150); absent = none asked for */
  briefReady?: (chatId: string) => boolean;
  /** the roles in a few lines, for the Orchestrator's first message of a session (agents/discovery.ts roleCatalogBrief) */
  roleCatalogBrief?: () => string;
  /** the language the user wants replies in (ADR 0120: locale.ts uiLang, the setting or Windows'); absent = not named */
  replyLang?: () => Lang;
  /** «Modalità notte» (ADR 0191): the user is away; questions get the recommended option, permissions are parked */
  away?: () => boolean;
  /** what the app chose or parked for the absent user (chats/away-log.ts), for the recap at their return */
  onAway?: (e: Omit<AwayEntry, 'at'>) => void;
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
  admission?: { priority?: (key: string) => number; sampler: LoadSampler; limits: () => AdmissionLimits; tickMs?: number; autoTick?: boolean };
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
  /** Idle-only budget-based engine freshness; does not infer quality degradation. Default off. */
  freshSessions?: () => boolean;
  /** Host-owned preparation sees the final narrowed policy before any delegated engine can start. */
  prepareDelegation?: (parent: ChatSummary, req: NewChat, policy: AgentPolicy | null, continuationOf?: string) => Promise<{ cwd: string; parentRunId: string | undefined; parentTaskVersion: number | undefined; bind?: (childId: string) => void }>;
  /** Unabridged authoritative workflow state, including decisions and unanswered context. Empty = no linked
   *  workflow; null or an exception = unsafe to continue, so retain the current engine. */
  continuationContext?: (chatId: string) => string | null;
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

export interface Rec {
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
  /** the open turn's edit-tool paths and whether a command that may write ran (receipts without a checkpoint, ADR 0186) */
  receiptTurn?: { files: string[]; mayWrite: boolean };
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
  /** «Modalità notte» (ADR 0191): the session that was told the user is away ('' = told, session not known yet) */
  awayTold?: string;
  /** the user's message being sent was said in the voice conversation (ADR 0152): its text, so only that delivery takes
   *  the spoken-reply line; voiceTold = the session whose context already has the rules */
  voiceText?: string;
  voiceTold?: string;
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
  /** Flash (ADR 0106): the Orchestrator's items its engine already got, by engine (a new engine gets them again) */
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
  /** its engine ended with an error or mid-turn (persisted): not finished, never closed by itself; cleared by a result */
  unfinished?: boolean;
  /** the last result saved before a restart (ADR 0134): read by the auto-close only, the summary starts without one */
  savedResult?: { at: number; isError: boolean; interrupted?: boolean };
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
  /** Previous session's archived note must reach the new engine before this marker is cleared (persisted). */
  continuationPending?: string | undefined;
  /** Deduplicates diagnostic deferrals for one session and reason; not an inferred quality score. */
  freshDeferred?: string | undefined;
  /** Exact request scope and user decisions, private to this chat; never shared through user-event tools. */
  continuationDecisions?: string | undefined;
  /** A text note cannot preserve an evicted history item or an image input; persist this conservative blocker. */
  continuityUnsafe?: true;
  /** Only this newly assigned run may cross a previously checked idle boundary before its first submission. */
  freshAssignmentRun?: string | undefined;
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
export interface ColdStep {
  h: HandoffInfo; old: string | null; at: number; idleMin: number; notePath: string;
  prev: { forkFrom: Rec['forkFrom']; costTotalUsd: Rec['costTotalUsd']; contextTokens: number | undefined; contextMaxTokens: number | undefined; coldNoteAt: number | undefined; after: Rec['after']; ctxSince: Rec['ctxSince'] };
}
/** what a root chat's clean result tells the Orchestrator (onCleanReport) */
export interface CleanReportNote { chatId: string; title: string; role: string; summary: string; at: number }
/** One message the user typed in a work chat (userWrote): what the Orchestrator and the parent learn. */
export interface UserWroteNote { eventId: string; seq: number; chatId: string; title: string; role: string | null; parentId: string | null; parentTitle: string | null; at: number; text: string }
